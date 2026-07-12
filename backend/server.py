from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import uuid
import logging
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, status
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict


# --------------- Setup ---------------
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

JWT_ALGORITHM = "HS256"
JWT_ACCESS_MINUTES = 60 * 24 * 30  # 30 days, shared family device

# Single-family app: all data is scoped under one constant family id.
FAMILY_ID = "family-default"

DEFAULT_PASSCODE = "123456"  # seeded members start with this; must be changed


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


def create_access_token(member_id: str, role: str) -> str:
    payload = {
        "sub": member_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=JWT_ACCESS_MINUTES),
        "type": "access",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


# --------------- Auth Dependency ---------------
async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        member = await db.members.find_one({"id": payload["sub"]}, {"_id": 0, "passcode_hash": 0, "passcode_plain": 0})
        if not member:
            raise HTTPException(status_code=401, detail="Member not found")
        return member
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def require_parent(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "parent":
        raise HTTPException(status_code=403, detail="Only parents can do this")
    return user


# --------------- Models ---------------
class MemberLoginInput(BaseModel):
    member_id: str
    passcode: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class MemberPasscodeInput(BaseModel):
    passcode: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class MemberProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: Optional[str] = None
    age: Optional[int] = None
    avatar_color: Optional[str] = None
    avatar_emoji: Optional[str] = None


class ChildPasscodeInput(BaseModel):
    passcode: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class ChildThemeInput(BaseModel):
    theme: Literal["clean", "candy", "mermaid", "cyber", "galaxy"]


class AppConfigInput(BaseModel):
    app_name: Optional[str] = None
    default_theme: Optional[Literal["clean", "candy", "mermaid", "cyber", "galaxy"]] = None
    slideshow_background_url: Optional[str] = None
    rupiah_per_point: Optional[int] = Field(default=None, ge=1, le=1000000)
    skip_cost_points: Optional[int] = Field(default=None, ge=0, le=100000)


class ReminderInput(BaseModel):
    child_id: str
    task_id: str
    time: str  # HH:MM format
    message: Optional[str] = None


class PushSubscriptionInput(BaseModel):
    subscription: dict  # Web Push API subscription object


class AchievementInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = ""
    icon: str = "⭐"
    threshold_points: int = Field(ge=0)


MBTI_TYPES = Literal[
    "INTJ-T", "INTJ-A", "INTP-T", "INTP-A", "ENTJ-T", "ENTJ-A", "ENTP-T", "ENTP-A",
    "INFJ-T", "INFJ-A", "INFP-T", "INFP-A", "ENFJ-T", "ENFJ-A", "ENFP-T", "ENFP-A",
    "ISTJ-T", "ISTJ-A", "ISFJ-T", "ISFJ-A", "ESTJ-T", "ESTJ-A", "ESFJ-T", "ESFJ-A",
    "ISTP-T", "ISTP-A", "ISFP-T", "ISFP-A", "ESTP-T", "ESTP-A", "ESFP-T", "ESFP-A",
]

# Task "styles" — how a quest is framed. Certain MBTI types respond better to
# certain framings, which the parent UI uses to suggest a fit per child.
TASK_STYLE = Literal["challenge", "helper", "creative", "routine", "learning", "social"]


class ChildInput(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    age: Optional[int] = Field(default=None, ge=1, le=25)
    avatar_color: str = "#FF9D23"
    avatar_emoji: str = "🦁"
    mbti: Optional[MBTI_TYPES] = None


class ChildUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: Optional[str] = None
    age: Optional[int] = None
    avatar_color: Optional[str] = None
    avatar_emoji: Optional[str] = None
    mbti: Optional[MBTI_TYPES] = None


class TaskInput(BaseModel):
    child_id: str
    title: str = Field(min_length=1, max_length=120)
    description: str = ""
    points: int = Field(ge=0, le=1000, default=10)
    penalty_points: int = Field(ge=0, le=1000, default=0)
    due_date: Optional[str] = None  # ISO date string
    recurrence: Literal["none", "daily", "weekly"] = "none"
    icon: str = "star"
    order: Optional[int] = Field(default=None, ge=1)
    task_style: Optional[TASK_STYLE] = None


class TaskUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: Optional[str] = None
    description: Optional[str] = None
    points: Optional[int] = None
    penalty_points: Optional[int] = None
    due_date: Optional[str] = None
    recurrence: Optional[Literal["none", "daily", "weekly"]] = None
    icon: Optional[str] = None
    order: Optional[int] = Field(default=None, ge=1)
    task_style: Optional[TASK_STYLE] = None


class RedeemMoneyInput(BaseModel):
    child_id: str
    points: int = Field(ge=1, le=1000000)


class SelfPasscodeInput(BaseModel):
    old_passcode: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")
    new_passcode: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class SelfProfileInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    avatar_emoji: Optional[str] = Field(default=None, max_length=10)
    avatar_color: Optional[str] = Field(default=None, max_length=20)


class RewardInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = ""
    cost_points: int = Field(ge=1, le=100000)
    icon: str = "gift"


class ConsequenceInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = ""
    points_deducted: int = Field(ge=0, le=1000, default=0)


class ApplyConsequenceInput(BaseModel):
    child_id: str
    consequence_id: str
    task_id: Optional[str] = None
    notes: str = ""


# --------------- App ---------------
app = FastAPI(title="My Lil Famz API")
api = APIRouter(prefix="/api")


# --------------- Auth Endpoints ---------------
@api.get("/auth/members")
async def list_members():
    """Public: list family members to show on the login picker (no passcodes)."""
    members = await db.members.find({}, {"_id": 0, "passcode_hash": 0, "passcode_plain": 0}).to_list(20)
    order = {"parent": 0, "child": 1}
    members.sort(key=lambda m: (order.get(m.get("role"), 2), m.get("created_at", "")))
    return members


@api.post("/auth/login")
async def login(payload: MemberLoginInput, response: Response):
    member = await db.members.find_one({"id": payload.member_id})
    if not member or not member.get("passcode_hash"):
        raise HTTPException(status_code=401, detail="Member not found")
    if not verify_password(payload.passcode, member["passcode_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect passcode")
    token = create_access_token(member["id"], member["role"])
    response.set_cookie(
        key="access_token", value=token, httponly=True, secure=True,
        samesite="lax", max_age=JWT_ACCESS_MINUTES * 60, path="/",
    )
    return {
        "id": member["id"],
        "name": member["name"],
        "role": member["role"],
        "avatar_emoji": member.get("avatar_emoji", "🦁"),
        "avatar_color": member.get("avatar_color", "#FF9D23"),
        "is_default_passcode": member.get("passcode_is_default", False),
        "token": token,
    }


@api.post("/auth/logout")
async def logout(response: Response, user: dict = Depends(get_current_user)):
    response.delete_cookie("access_token", path="/")
    return {"success": True}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {
        "id": user["id"],
        "name": user["name"],
        "role": user["role"],
        "age": user.get("age"),
        "avatar_emoji": user.get("avatar_emoji", "🦁"),
        "avatar_color": user.get("avatar_color", "#FF9D23"),
    }


# --------------- Member Passcode Management (parents only) ---------------
def _passcode_set_fields(role: str, passcode: str, is_default: bool) -> dict:
    """Children's passcodes stay parent-viewable (family app, kids forget codes).
    Parents' passcodes are hash-only for their own privacy."""
    fields = {
        "passcode_hash": hash_password(passcode),
        "passcode_is_default": is_default,
    }
    if role == "child":
        fields["passcode_plain"] = passcode
    else:
        fields["passcode_plain"] = None
    return fields


@api.post("/members/{member_id}/passcode")
async def set_member_passcode(member_id: str, payload: MemberPasscodeInput, user: dict = Depends(require_parent)):
    member = await db.members.find_one({"id": member_id})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    await db.members.update_one(
        {"id": member_id},
        {"$set": _passcode_set_fields(member["role"], payload.passcode, False)},
    )
    await log_activity(FAMILY_ID, member_id if member["role"] == "child" else None, "passcode_updated", {"member_name": member["name"]})
    return {"success": True}


@api.post("/members/{member_id}/reset-passcode")
async def reset_member_passcode(member_id: str, user: dict = Depends(require_parent)):
    member = await db.members.find_one({"id": member_id})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    await db.members.update_one(
        {"id": member_id},
        {"$set": _passcode_set_fields(member["role"], DEFAULT_PASSCODE, True)},
    )
    await log_activity(FAMILY_ID, member_id if member["role"] == "child" else None, "passcode_reset", {"member_name": member["name"]})
    return {"success": True, "default_passcode": DEFAULT_PASSCODE}


@api.get("/admin/members-passcodes")
async def get_members_passcode_status(user: dict = Depends(require_parent)):
    members = await db.members.find({}, {"_id": 0}).to_list(20)
    order = {"parent": 0, "child": 1}
    members.sort(key=lambda m: (order.get(m.get("role"), 2), m.get("created_at", "")))
    return [
        {
            "member_id": m["id"],
            "name": m["name"],
            "role": m["role"],
            "has_passcode": bool(m.get("passcode_hash")),
            "is_default": m.get("passcode_is_default", False),
            # Only children's codes are exposed to parents.
            "passcode_plain": m.get("passcode_plain") if m.get("role") == "child" else None,
        }
        for m in members
    ]


# --------------- Self-Service Profile (any logged-in member) ---------------
@api.post("/me/passcode")
async def change_own_passcode(payload: SelfPasscodeInput, user: dict = Depends(get_current_user)):
    member = await db.members.find_one({"id": user["id"]})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    if not verify_password(payload.old_passcode, member["passcode_hash"]):
        raise HTTPException(status_code=401, detail="Passcode lama salah")
    await db.members.update_one(
        {"id": user["id"]},
        {"$set": _passcode_set_fields(member["role"], payload.new_passcode, False)},
    )
    await log_activity(FAMILY_ID, user["id"] if member["role"] == "child" else None, "passcode_updated", {"member_name": member["name"], "by": "self"})
    return {"success": True}


@api.patch("/me/profile")
async def update_own_profile(payload: SelfProfileInput, user: dict = Depends(get_current_user)):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if updates:
        await db.members.update_one({"id": user["id"]}, {"$set": updates})
        # Children have a mirrored row used by tasks/points logic.
        await db.children.update_one({"id": user["id"]}, {"$set": updates})
    member = await db.members.find_one({"id": user["id"]}, {"_id": 0, "passcode_hash": 0, "passcode_plain": 0})
    return member


# --------------- Points → Money (Tukar Poin) ---------------
@api.post("/points/redeem-money")
async def redeem_points_for_money(payload: RedeemMoneyInput, user: dict = Depends(get_current_user)):
    """Child (or parent on their behalf) converts points into a cash payout request."""
    if user["role"] == "child" and user["id"] != payload.child_id:
        raise HTTPException(status_code=403, detail="Kids can only redeem their own points")

    child = await db.children.find_one({"id": payload.child_id})
    if not child:
        raise HTTPException(status_code=404, detail="Child not found")
    if child.get("points", 0) < payload.points:
        raise HTTPException(status_code=400, detail="Poin tidak cukup")

    config = await db.app_config.find_one({"parent_id": FAMILY_ID}) or {}
    rate = int(config.get("rupiah_per_point", 100))
    rupiah = payload.points * rate

    await db.children.update_one({"id": payload.child_id}, {"$inc": {"points": -payload.points}})
    doc = {
        "id": new_id(),
        "parent_id": FAMILY_ID,
        "child_id": payload.child_id,
        "child_name": child["name"],
        "points": payload.points,
        "rupiah": rupiah,
        "rate": rate,
        "status": "pending",  # pending -> paid / cancelled
        "created_at": now_iso(),
        "paid_at": None,
    }
    await db.money_redemptions.insert_one(doc)
    doc.pop("_id", None)
    await log_activity(FAMILY_ID, payload.child_id, "money_redeemed", {"points": payload.points, "rupiah": rupiah})
    return doc


@api.get("/money-redemptions")
async def list_money_redemptions(child_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = {"parent_id": FAMILY_ID}
    if user["role"] == "child":
        query["child_id"] = user["id"]
    elif child_id:
        query["child_id"] = child_id
    items = await db.money_redemptions.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
    return items


@api.post("/money-redemptions/{redemption_id}/pay")
async def pay_money_redemption(redemption_id: str, user: dict = Depends(require_parent)):
    r = await db.money_redemptions.find_one({"id": redemption_id, "parent_id": FAMILY_ID})
    if not r:
        raise HTTPException(status_code=404, detail="Redemption not found")
    if r["status"] != "pending":
        raise HTTPException(status_code=400, detail="Already processed")
    await db.money_redemptions.update_one({"id": redemption_id}, {"$set": {"status": "paid", "paid_at": now_iso()}})
    await log_activity(FAMILY_ID, r["child_id"], "money_paid", {"rupiah": r["rupiah"], "points": r["points"]})
    return {"success": True}


@api.post("/money-redemptions/{redemption_id}/cancel")
async def cancel_money_redemption(redemption_id: str, user: dict = Depends(require_parent)):
    """Cancel a pending payout and refund the points."""
    r = await db.money_redemptions.find_one({"id": redemption_id, "parent_id": FAMILY_ID})
    if not r:
        raise HTTPException(status_code=404, detail="Redemption not found")
    if r["status"] != "pending":
        raise HTTPException(status_code=400, detail="Already processed")
    await db.children.update_one({"id": r["child_id"]}, {"$inc": {"points": r["points"]}})
    await db.money_redemptions.update_one({"id": redemption_id}, {"$set": {"status": "cancelled"}})
    await log_activity(FAMILY_ID, r["child_id"], "money_redemption_cancelled", {"points": r["points"]})
    return {"success": True}


# --------------- Helpers ---------------
async def log_activity(parent_id: str, child_id: Optional[str], action: str, details: dict):
    await db.activity.insert_one({
        "id": new_id(),
        "parent_id": parent_id,
        "child_id": child_id,
        "action": action,
        "details": details,
        "created_at": now_iso(),
    })


async def award_badges(parent_id: str, child_id: str):
    """Award badges based on child's stats."""
    child = await db.children.find_one({"id": child_id, "parent_id": parent_id})
    if not child:
        return []
    existing = await db.badges.find({"child_id": child_id}).to_list(200)
    earned_keys = {b["key"] for b in existing}
    new_badges = []
    lifetime = child.get("lifetime_points", 0)
    streak = child.get("streak_days", 0)
    tasks_completed = child.get("tasks_completed", 0)

    rules = [
        ("first_step", "First Step", "Complete your first task!", tasks_completed >= 1),
        ("ten_tasks", "Task Master", "Completed 10 tasks", tasks_completed >= 10),
        ("fifty_tasks", "Chore Champion", "Completed 50 tasks", tasks_completed >= 50),
        ("hundred_points", "Point Collector", "Earned 100 lifetime points", lifetime >= 100),
        ("five_hundred_points", "Star Saver", "Earned 500 lifetime points", lifetime >= 500),
        ("streak_3", "3-Day Streak", "3 days in a row!", streak >= 3),
        ("streak_7", "Week Warrior", "7 days in a row!", streak >= 7),
    ]
    for key, name, desc, condition in rules:
        if condition and key not in earned_keys:
            b = {
                "id": new_id(),
                "child_id": child_id,
                "parent_id": parent_id,
                "key": key,
                "name": name,
                "description": desc,
                "earned_at": now_iso(),
            }
            await db.badges.insert_one(b)
            new_badges.append({k: v for k, v in b.items() if k != "_id"})
    return new_badges


async def get_child_or_404(parent_id: str, child_id: str) -> dict:
    child = await db.children.find_one({"id": child_id, "parent_id": parent_id}, {"_id": 0})
    if not child:
        raise HTTPException(status_code=404, detail="Child not found")
    return child


# --------------- Personality (MBTI) ---------------
# Kid-friendly personality profiles. Focus on how each type likes to work so
# the app can frame quests in a way that motivates that specific child.
PERSONALITY_PROFILES = {
    "INTJ-T": {
        "nickname": "Sang Ahli Strategi",
        "emoji": "🧠",
        "color": "#6366F1",
        "summary": "Mandiri, suka merencanakan, dan senang tantangan yang butuh berpikir.",
        "likes": ["Tujuan jangka panjang yang jelas", "Kebebasan menyelesaikan dengan caranya sendiri", "Tantangan logika & strategi"],
        "best_styles": ["challenge", "learning"],
        "motivation": "Kamu jenius strategi! Selesaikan misi ini dengan caramu sendiri. 🧩",
        "encourage_done": "Rencana hebat berjalan sempurna! Kamu memang ahli strategi. 🎯",
    },
    "ESFJ-T": {
        "nickname": "Sang Penolong Ceria",
        "emoji": "💛",
        "color": "#F472B6",
        "summary": "Ramah, suka membantu, dan senang dihargai atas kebaikannya.",
        "likes": ["Tugas membantu keluarga", "Langkah-langkah yang jelas", "Pujian & pengakuan"],
        "best_styles": ["helper", "social", "routine"],
        "motivation": "Keluarga senang dengan bantuanmu! Yuk selesaikan misi ini bersama. 🤗",
        "encourage_done": "Kamu luar biasa membantu! Semua bangga padamu. 🌟",
    },
}

STYLE_META = {
    "challenge": {"label": "Tantangan", "emoji": "⚔️", "desc": "Misi seru yang butuh usaha & strategi"},
    "helper": {"label": "Membantu", "emoji": "🤝", "desc": "Membantu keluarga atau orang lain"},
    "creative": {"label": "Kreatif", "emoji": "🎨", "desc": "Berkreasi & berekspresi"},
    "routine": {"label": "Rutin", "emoji": "🔁", "desc": "Kebiasaan baik sehari-hari"},
    "learning": {"label": "Belajar", "emoji": "📚", "desc": "Menambah ilmu & keterampilan"},
    "social": {"label": "Sosial", "emoji": "👥", "desc": "Bermain & berbagi bersama"},
}


def suggested_style_for_mbti(mbti):
    profile = PERSONALITY_PROFILES.get(mbti or "")
    if profile and profile.get("best_styles"):
        return profile["best_styles"][0]
    return None


def personality_for(mbti):
    if not mbti:
        return None
    p = PERSONALITY_PROFILES.get(mbti)
    if not p:
        # Unknown-but-valid type: return a neutral profile so the UI still works.
        return {
            "nickname": mbti,
            "emoji": "✨",
            "color": "#94A3B8",
            "summary": "Setiap anak istimewa dengan caranya sendiri.",
            "likes": [],
            "best_styles": [],
            "motivation": "Ayo selesaikan misimu, kamu hebat! ✨",
            "encourage_done": "Kerja bagus! 🎉",
        }
    return p


@api.get("/personality/types")
async def list_personality_types(user: dict = Depends(get_current_user)):
    """All MBTI options for the parent dropdown, with the two fully-authored
    profiles surfaced richly."""
    all_types = list(MBTI_TYPES.__args__)  # type: ignore[attr-defined]
    return {
        "types": all_types,
        "profiles": PERSONALITY_PROFILES,
        "styles": STYLE_META,
    }


@api.get("/children/{child_id}/personality")
async def get_child_personality(child_id: str, user: dict = Depends(get_current_user)):
    child = await db.children.find_one({"id": child_id}, {"_id": 0})
    if not child:
        raise HTTPException(status_code=404, detail="Child not found")
    profile = personality_for(child.get("mbti"))
    return {
        "child_id": child_id,
        "mbti": child.get("mbti"),
        "profile": profile,
        "suggested_styles": profile["best_styles"] if profile else [],
    }


# --------------- Children ---------------
@api.get("/children")
async def list_children(user: dict = Depends(get_current_user)):
    children = await db.children.find({"parent_id": FAMILY_ID}, {"_id": 0}).to_list(100)
    children.sort(key=lambda c: c.get("created_at", ""))
    return children


@api.post("/children")
async def create_child(payload: ChildInput, user: dict = Depends(require_parent)):
    child_id = new_id()
    doc = {
        "id": child_id,
        "parent_id": FAMILY_ID,
        "name": payload.name,
        "age": payload.age,
        "avatar_color": payload.avatar_color,
        "avatar_emoji": payload.avatar_emoji,
        "mbti": payload.mbti,
        "points": 0,
        "lifetime_points": 0,
        "streak_days": 0,
        "last_completion_date": None,
        "tasks_completed": 0,
        "created_at": now_iso(),
    }
    await db.children.insert_one(doc)
    doc.pop("_id", None)

    # Every child also gets a login-capable family member profile with a default passcode.
    await db.members.insert_one({
        "id": child_id,
        "name": payload.name,
        "role": "child",
        "age": payload.age,
        "avatar_color": payload.avatar_color,
        "avatar_emoji": payload.avatar_emoji,
        "passcode_hash": hash_password(DEFAULT_PASSCODE),
        "passcode_is_default": True,
        "passcode_plain": DEFAULT_PASSCODE,
        "theme_preference": "clean",
        "created_at": now_iso(),
    })

    await log_activity(FAMILY_ID, doc["id"], "child_created", {"name": payload.name})
    return doc


@api.patch("/children/{child_id}")
async def update_child(child_id: str, payload: ChildUpdate, user: dict = Depends(require_parent)):
    await get_child_or_404(FAMILY_ID, child_id)
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if updates:
        await db.children.update_one({"id": child_id}, {"$set": updates})
        await db.members.update_one({"id": child_id}, {"$set": updates})
    updated = await db.children.find_one({"id": child_id}, {"_id": 0})
    return updated


@api.delete("/children/{child_id}")
async def delete_child(child_id: str, user: dict = Depends(require_parent)):
    await get_child_or_404(FAMILY_ID, child_id)
    await db.children.delete_one({"id": child_id})
    await db.members.delete_one({"id": child_id, "role": "child"})
    await db.tasks.delete_many({"child_id": child_id})
    await db.badges.delete_many({"child_id": child_id})
    await db.redemptions.delete_many({"child_id": child_id})
    await db.applied_consequences.delete_many({"child_id": child_id})
    return {"success": True}


# --------------- Tasks ---------------
@api.get("/tasks")
async def list_tasks(child_id: Optional[str] = None, status_filter: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = {"parent_id": FAMILY_ID}
    if child_id:
        query["child_id"] = child_id
    if status_filter:
        query["status"] = status_filter
    tasks = await db.tasks.find(query, {"_id": 0}).to_list(1000)
    tasks.sort(key=lambda t: (t.get("status") != "pending", t.get("due_date") or "9999"))
    return tasks


@api.post("/tasks")
async def create_task(payload: TaskInput, user: dict = Depends(require_parent)):
    await get_child_or_404(FAMILY_ID, payload.child_id)

    # Treasure-hunt ordering: default to the end of this child's quest line.
    order = payload.order
    if order is None:
        last = await db.tasks.find({"child_id": payload.child_id}).sort("order", -1).to_list(1)
        order = (last[0].get("order", 0) + 1) if last else 1

    # Default the task style from the child's personality if the parent didn't pick one.
    task_style = payload.task_style
    if task_style is None:
        child = await db.children.find_one({"id": payload.child_id})
        task_style = suggested_style_for_mbti(child.get("mbti") if child else None)

    doc = {
        "id": new_id(),
        "parent_id": FAMILY_ID,
        "child_id": payload.child_id,
        "title": payload.title,
        "description": payload.description,
        "points": payload.points,
        "penalty_points": payload.penalty_points,
        "due_date": payload.due_date,
        "recurrence": payload.recurrence,
        "icon": payload.icon,
        "order": order,
        "task_style": task_style,
        "status": "pending",  # pending -> completed (waiting approval) -> approved / rejected / missed / skipped
        "completed_at": None,
        "approved_at": None,
        "created_at": now_iso(),
    }
    await db.tasks.insert_one(doc)
    doc.pop("_id", None)
    await log_activity(FAMILY_ID, payload.child_id, "task_created", {"title": payload.title, "points": payload.points})
    return doc


@api.patch("/tasks/{task_id}")
async def update_task(task_id: str, payload: TaskUpdate, user: dict = Depends(require_parent)):
    task = await db.tasks.find_one({"id": task_id, "parent_id": FAMILY_ID})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if updates:
        await db.tasks.update_one({"id": task_id}, {"$set": updates})
    return await db.tasks.find_one({"id": task_id}, {"_id": 0})


@api.delete("/tasks/{task_id}")
async def delete_task(task_id: str, user: dict = Depends(require_parent)):
    res = await db.tasks.delete_one({"id": task_id, "parent_id": FAMILY_ID})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"success": True}


async def get_next_actionable_task(child_id: str) -> Optional[dict]:
    """The lowest-order task still blocking the quest line (pending or rejected)."""
    open_tasks = await db.tasks.find(
        {"child_id": child_id, "status": {"$in": ["pending", "rejected"]}}
    ).sort("order", 1).to_list(1)
    return open_tasks[0] if open_tasks else None


@api.post("/tasks/{task_id}/complete")
async def complete_task(task_id: str, user: dict = Depends(get_current_user)):
    """Kid marks a task complete → awaits parent approval. Treasure-hunt rule:
    only the next task in the sequence can be completed."""
    task = await db.tasks.find_one({"id": task_id, "parent_id": FAMILY_ID})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task["status"] not in ("pending", "rejected"):
        raise HTTPException(status_code=400, detail="Task cannot be completed in current state")

    nxt = await get_next_actionable_task(task["child_id"])
    if nxt and nxt["id"] != task_id:
        raise HTTPException(
            status_code=409,
            detail=f"Selesaikan dulu misi sebelumnya: \"{nxt['title']}\" (atau lewati dengan poin)",
        )

    await db.tasks.update_one({"id": task_id}, {"$set": {"status": "completed", "completed_at": now_iso()}})
    await log_activity(FAMILY_ID, task["child_id"], "task_completed", {"task_id": task_id, "title": task["title"]})
    return await db.tasks.find_one({"id": task_id}, {"_id": 0})


@api.post("/tasks/{task_id}/skip")
async def skip_task(task_id: str, user: dict = Depends(get_current_user)):
    """Pay points to skip a blocking task and unlock the next one."""
    task = await db.tasks.find_one({"id": task_id, "parent_id": FAMILY_ID})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task["status"] not in ("pending", "rejected"):
        raise HTTPException(status_code=400, detail="Only open tasks can be skipped")

    nxt = await get_next_actionable_task(task["child_id"])
    if nxt and nxt["id"] != task_id:
        raise HTTPException(status_code=409, detail="Hanya misi terdepan yang bisa dilewati")

    config = await db.app_config.find_one({"parent_id": FAMILY_ID}) or {}
    cost = int(config.get("skip_cost_points", 20))

    child = await db.children.find_one({"id": task["child_id"]})
    if not child:
        raise HTTPException(status_code=404, detail="Child not found")
    if child.get("points", 0) < cost:
        raise HTTPException(status_code=400, detail=f"Poin tidak cukup. Butuh {cost} poin untuk melewati misi ini.")

    await db.children.update_one({"id": child["id"]}, {"$inc": {"points": -cost}})
    await db.tasks.update_one({"id": task_id}, {"$set": {"status": "skipped", "completed_at": now_iso()}})
    await log_activity(FAMILY_ID, child["id"], "task_skipped", {"task_id": task_id, "title": task["title"], "cost": cost})
    updated = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    return {"task": updated, "points_spent": cost}


@api.post("/tasks/{task_id}/approve")
async def approve_task(task_id: str, user: dict = Depends(require_parent)):
    task = await db.tasks.find_one({"id": task_id, "parent_id": FAMILY_ID})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task["status"] != "completed":
        raise HTTPException(status_code=400, detail="Task must be completed first")

    child = await db.children.find_one({"id": task["child_id"]})
    if not child:
        raise HTTPException(status_code=404, detail="Child not found")

    # Update streak
    today = datetime.now(timezone.utc).date().isoformat()
    last_date = child.get("last_completion_date")
    if last_date == today:
        streak = child.get("streak_days", 0)
    elif last_date == (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat():
        streak = child.get("streak_days", 0) + 1
    else:
        streak = 1

    points = task["points"]
    await db.children.update_one(
        {"id": task["child_id"]},
        {
            "$inc": {"points": points, "lifetime_points": points, "tasks_completed": 1},
            "$set": {"last_completion_date": today, "streak_days": streak},
        },
    )

    if task["recurrence"] in ("daily", "weekly"):
        # Create next occurrence
        next_due = None
        if task.get("due_date"):
            try:
                base = datetime.fromisoformat(task["due_date"].replace("Z", "+00:00"))
                delta = timedelta(days=1 if task["recurrence"] == "daily" else 7)
                next_due = (base + delta).isoformat()
            except Exception:
                next_due = None
        new_task = {
            **{k: v for k, v in task.items() if k != "_id"},
            "id": new_id(),
            "status": "pending",
            "completed_at": None,
            "approved_at": None,
            "due_date": next_due,
            "created_at": now_iso(),
        }
        await db.tasks.insert_one(new_task)

    await db.tasks.update_one(
        {"id": task_id},
        {"$set": {"status": "approved", "approved_at": now_iso()}},
    )
    new_badges = await award_badges(FAMILY_ID, task["child_id"])
    await log_activity(FAMILY_ID, task["child_id"], "task_approved", {"task_id": task_id, "points": points})
    return {"task": await db.tasks.find_one({"id": task_id}, {"_id": 0}), "new_badges": new_badges}


@api.post("/tasks/{task_id}/reject")
async def reject_task(task_id: str, user: dict = Depends(require_parent)):
    task = await db.tasks.find_one({"id": task_id, "parent_id": FAMILY_ID})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await db.tasks.update_one({"id": task_id}, {"$set": {"status": "pending", "completed_at": None}})
    await log_activity(FAMILY_ID, task["child_id"], "task_rejected", {"task_id": task_id})
    return await db.tasks.find_one({"id": task_id}, {"_id": 0})


@api.post("/tasks/{task_id}/miss")
async def mark_task_missed(task_id: str, user: dict = Depends(require_parent)):
    """Parent marks task as missed → apply penalty."""
    task = await db.tasks.find_one({"id": task_id, "parent_id": FAMILY_ID})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    penalty = task.get("penalty_points", 0)
    if penalty > 0:
        await db.children.update_one({"id": task["child_id"]}, {"$inc": {"points": -penalty}})
    await db.tasks.update_one({"id": task_id}, {"$set": {"status": "missed"}})
    await log_activity(FAMILY_ID, task["child_id"], "task_missed", {"task_id": task_id, "penalty": penalty})
    return await db.tasks.find_one({"id": task_id}, {"_id": 0})


# --------------- Child Quick-Switch Passcode (uses members collection) ---------------
@api.post("/children/{child_id}/validate-passcode")
async def validate_child_passcode(child_id: str, payload: ChildPasscodeInput):
    """Used by the in-app child picker for a parent to quickly switch into a kid's view
    without fully logging out. Validates against that child's own member passcode."""
    member = await db.members.find_one({"id": child_id, "role": "child"})
    if not member:
        raise HTTPException(status_code=404, detail="Child not found")
    if not member.get("passcode_hash"):
        raise HTTPException(status_code=400, detail="Passcode not set for this child")
    if not verify_password(payload.passcode, member["passcode_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect passcode")
    return {"success": True, "child_id": child_id, "name": member["name"]}


# --------------- Child Theme (Stage 2) ---------------
@api.post("/children/{child_id}/theme")
async def set_child_theme(child_id: str, payload: ChildThemeInput, user: dict = Depends(get_current_user)):
    child = await get_child_or_404(FAMILY_ID, child_id)
    await db.children.update_one({"id": child_id}, {"$set": {"theme_preference": payload.theme}})
    await log_activity(FAMILY_ID, child_id, "theme_changed", {"theme": payload.theme, "child_name": child["name"]})
    return {"success": True, "theme": payload.theme}


@api.get("/children/{child_id}/theme")
async def get_child_theme(child_id: str, user: dict = Depends(get_current_user)):
    child = await get_child_or_404(FAMILY_ID, child_id)
    return {"theme": child.get("theme_preference", "clean")}


# --------------- App Config (Stage 2) ---------------
@api.post("/config")
async def set_app_config(payload: AppConfigInput, user: dict = Depends(require_parent)):
    config_doc = await db.app_config.find_one({"parent_id": FAMILY_ID})
    if config_doc:
        update_data = {k: v for k, v in payload.model_dump().items() if v is not None}
        if update_data:
            await db.app_config.update_one({"parent_id": FAMILY_ID}, {"$set": update_data})
    else:
        config = {
            "id": new_id(),
            "parent_id": FAMILY_ID,
            "app_name": payload.app_name or "My Lil Famz",
            "default_theme": payload.default_theme or "clean",
            "slideshow_background_url": payload.slideshow_background_url or "",
            "rupiah_per_point": payload.rupiah_per_point if payload.rupiah_per_point is not None else 100,
            "skip_cost_points": payload.skip_cost_points if payload.skip_cost_points is not None else 20,
            "created_at": now_iso(),
        }
        await db.app_config.insert_one(config)
    await log_activity(FAMILY_ID, None, "config_updated", {"changes": payload.model_dump()})
    return {"success": True}


@api.get("/config")
async def get_app_config(user: dict = Depends(get_current_user)):
    config = await db.app_config.find_one({"parent_id": FAMILY_ID})
    if not config:
        return {
            "app_name": "My Lil Famz",
            "default_theme": "clean",
            "slideshow_background_url": "",
            "rupiah_per_point": 100,
            "skip_cost_points": 20,
        }
    return {
        "app_name": config.get("app_name", "My Lil Famz"),
        "default_theme": config.get("default_theme", "clean"),
        "slideshow_background_url": config.get("slideshow_background_url", ""),
        "rupiah_per_point": int(config.get("rupiah_per_point", 100)),
        "skip_cost_points": int(config.get("skip_cost_points", 20)),
    }


# --------------- Child Profile Photo (Stage 3) ---------------
@api.post("/children/{child_id}/profile-photo")
async def set_child_profile_photo(child_id: str, photo_url: str, user: dict = Depends(get_current_user)):
    child = await get_child_or_404(FAMILY_ID, child_id)
    await db.children.update_one({"id": child_id}, {"$set": {"profile_photo_url": photo_url}})
    await log_activity(FAMILY_ID, child_id, "profile_photo_updated", {"child_name": child["name"]})
    return {"success": True, "photo_url": photo_url}


# --------------- Reminders (Stage 3) ---------------
@api.post("/reminders")
async def create_reminder(payload: ReminderInput, user: dict = Depends(require_parent)):
    child = await get_child_or_404(FAMILY_ID, payload.child_id)
    task = await db.tasks.find_one({"id": payload.task_id, "child_id": payload.child_id})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    reminder = {
        "id": new_id(),
        "parent_id": FAMILY_ID,
        "child_id": payload.child_id,
        "task_id": payload.task_id,
        "time": payload.time,
        "message": payload.message or f"Reminder: {task['title']}",
        "enabled": True,
        "created_at": now_iso(),
    }
    await db.reminders.insert_one(reminder)
    reminder.pop("_id", None)
    await log_activity(FAMILY_ID, payload.child_id, "reminder_created", {"task_id": payload.task_id, "time": payload.time})
    return reminder


@api.get("/reminders")
async def list_reminders(child_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = {"parent_id": FAMILY_ID}
    if child_id:
        query["child_id"] = child_id
    reminders = await db.reminders.find(query, {"_id": 0}).to_list(200)
    return reminders


@api.delete("/reminders/{reminder_id}")
async def delete_reminder(reminder_id: str, user: dict = Depends(require_parent)):
    reminder = await db.reminders.find_one({"id": reminder_id, "parent_id": FAMILY_ID})
    if not reminder:
        raise HTTPException(status_code=404, detail="Reminder not found")
    await db.reminders.delete_one({"id": reminder_id})
    return {"success": True}


@api.post("/reminders/{reminder_id}/toggle")
async def toggle_reminder(reminder_id: str, user: dict = Depends(require_parent)):
    reminder = await db.reminders.find_one({"id": reminder_id, "parent_id": FAMILY_ID})
    if not reminder:
        raise HTTPException(status_code=404, detail="Reminder not found")
    new_state = not reminder.get("enabled", True)
    await db.reminders.update_one({"id": reminder_id}, {"$set": {"enabled": new_state}})
    return {"success": True, "enabled": new_state}


# --------------- Rewards ---------------
@api.get("/rewards")
async def list_rewards(user: dict = Depends(get_current_user)):
    rewards = await db.rewards.find({"parent_id": FAMILY_ID}, {"_id": 0}).to_list(200)
    rewards.sort(key=lambda r: r.get("cost_points", 0))
    return rewards


@api.post("/rewards")
async def create_reward(payload: RewardInput, user: dict = Depends(require_parent)):
    doc = {
        "id": new_id(),
        "parent_id": FAMILY_ID,
        "name": payload.name,
        "description": payload.description,
        "cost_points": payload.cost_points,
        "icon": payload.icon,
        "created_at": now_iso(),
    }
    await db.rewards.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.delete("/rewards/{reward_id}")
async def delete_reward(reward_id: str, user: dict = Depends(require_parent)):
    res = await db.rewards.delete_one({"id": reward_id, "parent_id": FAMILY_ID})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Reward not found")
    return {"success": True}


@api.post("/rewards/{reward_id}/redeem")
async def redeem_reward(reward_id: str, child_id: str, user: dict = Depends(get_current_user)):
    reward = await db.rewards.find_one({"id": reward_id, "parent_id": FAMILY_ID})
    if not reward:
        raise HTTPException(status_code=404, detail="Reward not found")
    child = await get_child_or_404(FAMILY_ID, child_id)
    if child["points"] < reward["cost_points"]:
        raise HTTPException(status_code=400, detail="Not enough points")
    await db.children.update_one({"id": child_id}, {"$inc": {"points": -reward["cost_points"]}})
    redemption = {
        "id": new_id(),
        "parent_id": FAMILY_ID,
        "child_id": child_id,
        "reward_id": reward_id,
        "reward_name": reward["name"],
        "cost_points": reward["cost_points"],
        "status": "pending",  # pending -> fulfilled
        "created_at": now_iso(),
        "fulfilled_at": None,
    }
    await db.redemptions.insert_one(redemption)
    redemption.pop("_id", None)
    await log_activity(FAMILY_ID, child_id, "reward_redeemed", {"reward": reward["name"], "cost": reward["cost_points"]})
    return redemption


@api.get("/redemptions")
async def list_redemptions(child_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = {"parent_id": FAMILY_ID}
    if child_id:
        query["child_id"] = child_id
    items = await db.redemptions.find(query, {"_id": 0}).to_list(500)
    items.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    return items


@api.post("/redemptions/{redemption_id}/fulfill")
async def fulfill_redemption(redemption_id: str, user: dict = Depends(require_parent)):
    red = await db.redemptions.find_one({"id": redemption_id, "parent_id": FAMILY_ID})
    if not red:
        raise HTTPException(status_code=404, detail="Redemption not found")
    await db.redemptions.update_one({"id": redemption_id}, {"$set": {"status": "fulfilled", "fulfilled_at": now_iso()}})
    return await db.redemptions.find_one({"id": redemption_id}, {"_id": 0})


# --------------- Consequences ---------------
@api.get("/consequences")
async def list_consequences(user: dict = Depends(get_current_user)):
    items = await db.consequences.find({"parent_id": FAMILY_ID}, {"_id": 0}).to_list(200)
    return items


@api.post("/consequences")
async def create_consequence(payload: ConsequenceInput, user: dict = Depends(require_parent)):
    doc = {
        "id": new_id(),
        "parent_id": FAMILY_ID,
        "name": payload.name,
        "description": payload.description,
        "points_deducted": payload.points_deducted,
        "created_at": now_iso(),
    }
    await db.consequences.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.delete("/consequences/{consequence_id}")
async def delete_consequence(consequence_id: str, user: dict = Depends(require_parent)):
    res = await db.consequences.delete_one({"id": consequence_id, "parent_id": FAMILY_ID})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Consequence not found")
    return {"success": True}


@api.post("/consequences/apply")
async def apply_consequence(payload: ApplyConsequenceInput, user: dict = Depends(require_parent)):
    cons = await db.consequences.find_one({"id": payload.consequence_id, "parent_id": FAMILY_ID})
    if not cons:
        raise HTTPException(status_code=404, detail="Consequence not found")
    await get_child_or_404(FAMILY_ID, payload.child_id)
    if cons["points_deducted"] > 0:
        await db.children.update_one({"id": payload.child_id}, {"$inc": {"points": -cons["points_deducted"]}})
    applied = {
        "id": new_id(),
        "parent_id": FAMILY_ID,
        "child_id": payload.child_id,
        "consequence_id": payload.consequence_id,
        "consequence_name": cons["name"],
        "points_deducted": cons["points_deducted"],
        "task_id": payload.task_id,
        "notes": payload.notes,
        "created_at": now_iso(),
    }
    await db.applied_consequences.insert_one(applied)
    applied.pop("_id", None)
    await log_activity(FAMILY_ID, payload.child_id, "consequence_applied", {"name": cons["name"], "deducted": cons["points_deducted"]})
    return applied


@api.get("/applied-consequences")
async def list_applied_consequences(child_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = {"parent_id": FAMILY_ID}
    if child_id:
        query["child_id"] = child_id
    items = await db.applied_consequences.find(query, {"_id": 0}).to_list(500)
    items.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    return items


# --------------- Badges ---------------
@api.get("/badges")
async def list_badges(child_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = {"parent_id": FAMILY_ID}
    if child_id:
        query["child_id"] = child_id
    items = await db.badges.find(query, {"_id": 0}).to_list(500)
    items.sort(key=lambda r: r.get("earned_at", ""), reverse=True)
    return items


# --------------- Activity / Stats ---------------
@api.get("/activity")
async def list_activity(child_id: Optional[str] = None, limit: int = 50, user: dict = Depends(get_current_user)):
    query = {"parent_id": FAMILY_ID}
    if child_id:
        query["child_id"] = child_id
    items = await db.activity.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return items


@api.get("/stats/dashboard")
async def dashboard_stats(user: dict = Depends(get_current_user)):
    children = await db.children.find({"parent_id": FAMILY_ID}, {"_id": 0}).to_list(100)
    total_tasks = await db.tasks.count_documents({"parent_id": FAMILY_ID})
    pending_approval = await db.tasks.count_documents({"parent_id": FAMILY_ID, "status": "completed"})
    approved_today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    approved_today = await db.tasks.count_documents({
        "parent_id": FAMILY_ID,
        "status": "approved",
        "approved_at": {"$gte": approved_today_start},
    })
    total_points = sum(c.get("points", 0) for c in children)
    return {
        "children_count": len(children),
        "total_tasks": total_tasks,
        "pending_approval": pending_approval,
        "approved_today": approved_today,
        "total_points": total_points,
    }


# --------------- Push Notifications (Stage 4) ---------------
@api.post("/push/subscribe")
async def subscribe_to_push(payload: PushSubscriptionInput, user: dict = Depends(get_current_user)):
    """Subscribe to push notifications"""
    sub_doc = {
        "id": new_id(),
        "parent_id": FAMILY_ID,
        "subscription": payload.subscription,
        "created_at": now_iso(),
    }
    await db.push_subscriptions.insert_one(sub_doc)
    return {"success": True, "message": "Subscribed to notifications"}


@api.post("/push/unsubscribe")
async def unsubscribe_from_push(payload: PushSubscriptionInput, user: dict = Depends(get_current_user)):
    """Unsubscribe from push notifications"""
    await db.push_subscriptions.delete_one({
        "parent_id": FAMILY_ID,
        "subscription.endpoint": payload.subscription.get("endpoint")
    })
    return {"success": True, "message": "Unsubscribed from notifications"}


@api.get("/push/subscriptions")
async def get_push_subscriptions(user: dict = Depends(get_current_user)):
    """Get all push subscriptions for user"""
    subs = await db.push_subscriptions.find(
        {"parent_id": FAMILY_ID}, 
        {"_id": 0}
    ).to_list(100)
    return subs


# --------------- Leaderboard & Gamification (Stage 4) ---------------
@api.get("/leaderboard")
async def get_leaderboard(user: dict = Depends(get_current_user)):
    """Get leaderboard of all children by points"""
    children = await db.children.find(
        {"parent_id": FAMILY_ID}, 
        {"_id": 0}
    ).sort("points", -1).to_list(100)
    
    leaderboard = []
    for idx, child in enumerate(children, 1):
        leaderboard.append({
            "rank": idx,
            "id": child["id"],
            "name": child["name"],
            "points": child.get("points", 0),
            "lifetime_points": child.get("lifetime_points", 0),
            "avatar_emoji": child.get("avatar_emoji", "🦁"),
            "avatar_color": child.get("avatar_color", "#FF9D23"),
        })
    return leaderboard


@api.post("/achievements")
async def create_achievement(payload: AchievementInput, user: dict = Depends(require_parent)):
    """Create new achievement milestone"""
    achievement = {
        "id": new_id(),
        "parent_id": FAMILY_ID,
        "name": payload.name,
        "description": payload.description,
        "icon": payload.icon,
        "threshold_points": payload.threshold_points,
        "created_at": now_iso(),
    }
    await db.achievements.insert_one(achievement)
    achievement.pop("_id", None)
    return achievement


@api.get("/achievements")
async def list_achievements(user: dict = Depends(get_current_user)):
    """List all achievement milestones"""
    achievements = await db.achievements.find(
        {"parent_id": FAMILY_ID}, 
        {"_id": 0}
    ).to_list(100)
    return achievements


@api.get("/achievements/earned")
async def get_earned_achievements(child_id: str, user: dict = Depends(get_current_user)):
    """Get achievements earned by a child"""
    child = await get_child_or_404(FAMILY_ID, child_id)
    child_points = child.get("points", 0)
    
    achievements = await db.achievements.find(
        {"parent_id": FAMILY_ID}, 
        {"_id": 0}
    ).to_list(100)
    
    earned = []
    for ach in achievements:
        if child_points >= ach["threshold_points"]:
            earned.append({**ach, "earned": True, "earned_at": now_iso()})
    
    return earned


@api.delete("/achievements/{achievement_id}")
async def delete_achievement(achievement_id: str, user: dict = Depends(require_parent)):
    """Delete an achievement"""
    result = await db.achievements.delete_one({
        "id": achievement_id, 
        "parent_id": FAMILY_ID
    })
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Achievement not found")
    return {"success": True}


# --------------- Analytics (Stage 4) ---------------
@api.get("/analytics/child/{child_id}")
async def get_child_analytics(child_id: str, user: dict = Depends(get_current_user)):
    """Get detailed analytics for a child"""
    child = await get_child_or_404(FAMILY_ID, child_id)
    
    # Get task statistics
    total_tasks = await db.tasks.count_documents({"child_id": child_id})
    completed_tasks = await db.tasks.count_documents({"child_id": child_id, "status": "approved"})
    pending_tasks = await db.tasks.count_documents({"child_id": child_id, "status": "pending"})
    missed_tasks = await db.tasks.count_documents({"child_id": child_id, "status": "missed"})
    
    # Calculate completion rate
    completion_rate = (completed_tasks / total_tasks * 100) if total_tasks > 0 else 0
    
    # Get recent activity
    recent_activity = await db.activity.find(
        {"child_id": child_id, "parent_id": FAMILY_ID},
        {"_id": 0}
    ).sort("created_at", -1).to_list(10)
    
    # Get rewards redeemed
    redeemed = await db.redemptions.count_documents({
        "child_id": child_id,
        "parent_id": FAMILY_ID,
        "status": "fulfilled"
    })
    
    return {
        "child_id": child_id,
        "child_name": child["name"],
        "current_points": child.get("points", 0),
        "lifetime_points": child.get("lifetime_points", 0),
        "stats": {
            "total_tasks": total_tasks,
            "completed_tasks": completed_tasks,
            "pending_tasks": pending_tasks,
            "missed_tasks": missed_tasks,
            "completion_rate": round(completion_rate, 2),
            "rewards_redeemed": redeemed,
        },
        "recent_activity": recent_activity,
    }


@api.get("/analytics/family")
async def get_family_analytics(user: dict = Depends(get_current_user)):
    """Get family-wide analytics"""
    children = await db.children.find(
        {"parent_id": FAMILY_ID}, 
        {"_id": 0}
    ).to_list(100)
    
    total_family_points = sum(c.get("points", 0) for c in children)
    total_family_tasks = await db.tasks.count_documents({"parent_id": FAMILY_ID})
    total_approved = await db.tasks.count_documents({
        "parent_id": FAMILY_ID,
        "status": "approved"
    })
    
    return {
        "children_count": len(children),
        "total_family_points": total_family_points,
        "total_tasks_created": total_family_tasks,
        "total_tasks_approved": total_approved,
        "average_points_per_child": round(total_family_points / len(children), 2) if children else 0,
        "family_completion_rate": round(total_approved / total_family_tasks * 100, 2) if total_family_tasks > 0 else 0,
    }


# --------------- Health ---------------
@api.get("/")
async def root():
    return {"message": "My Lil Famz API", "status": "ok"}


async def seed_default_family():
    """First-run only: create the 4 fixed family members if none exist yet."""
    existing_count = await db.members.count_documents({})
    if existing_count > 0:
        return

    # First run of the new member-based system. Clear any leftover data from the
    # previous email/password prototype so the fixed family starts clean and the
    # mirrored children collection matches the seeded members exactly.
    for coll in (
        "users", "children", "tasks", "rewards", "consequences", "redemptions",
        "applied_consequences", "badges", "activity", "reminders",
        "push_subscriptions", "achievements", "app_config", "money_redemptions",
    ):
        await db[coll].delete_many({})

    default_hash = hash_password(DEFAULT_PASSCODE)
    ts = now_iso()

    parents = [
        {"id": new_id(), "name": "Abi", "role": "parent", "avatar_emoji": "👨", "avatar_color": "#4DB8FF"},
        {"id": new_id(), "name": "Ummi", "role": "parent", "avatar_emoji": "👩", "avatar_color": "#F472B6"},
    ]
    children = [
        {"id": new_id(), "name": "Adskhan", "role": "child", "age": 11, "avatar_emoji": "🦸‍♂️", "avatar_color": "#4DB8FF", "mbti": "INTJ-T"},
        {"id": new_id(), "name": "Syila", "role": "child", "age": 8, "avatar_emoji": "🦋", "avatar_color": "#F472B6", "mbti": "ESFJ-T"},
    ]

    for p in parents:
        await db.members.insert_one({
            **p,
            "passcode_hash": default_hash,
            "passcode_is_default": True,
            "created_at": ts,
        })

    for c in children:
        await db.members.insert_one({
            **c,
            "passcode_hash": default_hash,
            "passcode_is_default": True,
            "passcode_plain": DEFAULT_PASSCODE,
            "theme_preference": "clean",
            "created_at": ts,
        })
        # Mirror into children collection so existing task/reward/points logic works unchanged.
        await db.children.insert_one({
            "id": c["id"],
            "parent_id": FAMILY_ID,
            "name": c["name"],
            "age": c["age"],
            "avatar_color": c["avatar_color"],
            "avatar_emoji": c["avatar_emoji"],
            "mbti": c.get("mbti"),
            "points": 0,
            "lifetime_points": 0,
            "streak_days": 0,
            "last_completion_date": None,
            "tasks_completed": 0,
            "created_at": ts,
        })


async def migrate_existing_data():
    """Idempotent backfills for databases seeded by earlier versions."""
    # 1. Children still on the default passcode get their plain code recorded
    #    so parents can view it (new behavior).
    await db.members.update_many(
        {"role": "child", "passcode_is_default": True, "passcode_plain": {"$exists": False}},
        {"$set": {"passcode_plain": DEFAULT_PASSCODE}},
    )
    # 2. Tasks created before the treasure-hunt update get sequential order
    #    per child based on creation time.
    async for child in db.children.find({}, {"id": 1}):
        tasks = await db.tasks.find({"child_id": child["id"]}).sort("created_at", 1).to_list(1000)
        max_order = max((t.get("order") or 0 for t in tasks), default=0)
        for t in tasks:
            if t.get("order") is None:
                max_order += 1
                await db.tasks.update_one({"id": t["id"]}, {"$set": {"order": max_order}})


    # 3. Assign personality types to the two known children if not yet set.
    mbti_by_name = {"Adskhan": "INTJ-T", "Syila": "ESFJ-T"}
    for name, mbti in mbti_by_name.items():
        await db.children.update_many(
            {"name": name, "$or": [{"mbti": {"$exists": False}}, {"mbti": None}]},
            {"$set": {"mbti": mbti}},
        )
        await db.members.update_many(
            {"name": name, "role": "child", "$or": [{"mbti": {"$exists": False}}, {"mbti": None}]},
            {"$set": {"mbti": mbti}},
        )


# --------------- Startup ---------------
@app.on_event("startup")
async def startup():
    await db.members.create_index("id", unique=True)
    await db.children.create_index("parent_id")
    await db.tasks.create_index([("parent_id", 1), ("child_id", 1)])
    await db.rewards.create_index("parent_id")
    await db.consequences.create_index("parent_id")
    await db.activity.create_index([("parent_id", 1), ("created_at", -1)])
    await db.app_config.create_index("parent_id", unique=True)
    await db.reminders.create_index([("parent_id", 1), ("child_id", 1)])
    await db.push_subscriptions.create_index("parent_id")
    await db.achievements.create_index("parent_id")
    await seed_default_family()
    await migrate_existing_data()


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)
