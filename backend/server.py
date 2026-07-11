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
from pydantic import BaseModel, Field, EmailStr, ConfigDict


# --------------- Setup ---------------
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

JWT_ALGORITHM = "HS256"
JWT_ACCESS_MINUTES = 60 * 24 * 7  # 7 days, family app


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
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
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0, "pin_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# --------------- Models ---------------
class RegisterInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class PinInput(BaseModel):
    pin: str = Field(min_length=4, max_length=4, pattern=r"^\d{4}$")


class ChildInput(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    age: Optional[int] = Field(default=None, ge=1, le=25)
    avatar_color: str = "#FF9D23"
    avatar_emoji: str = "🦁"


class ChildUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: Optional[str] = None
    age: Optional[int] = None
    avatar_color: Optional[str] = None
    avatar_emoji: Optional[str] = None


class TaskInput(BaseModel):
    child_id: str
    title: str = Field(min_length=1, max_length=120)
    description: str = ""
    points: int = Field(ge=0, le=1000, default=10)
    penalty_points: int = Field(ge=0, le=1000, default=0)
    due_date: Optional[str] = None  # ISO date string
    recurrence: Literal["none", "daily", "weekly"] = "none"
    icon: str = "star"


class TaskUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: Optional[str] = None
    description: Optional[str] = None
    points: Optional[int] = None
    penalty_points: Optional[int] = None
    due_date: Optional[str] = None
    recurrence: Optional[Literal["none", "daily", "weekly"]] = None
    icon: Optional[str] = None


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
@api.post("/auth/register")
async def register(payload: RegisterInput, response: Response):
    email = payload.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = new_id()
    doc = {
        "id": user_id,
        "email": email,
        "name": payload.name,
        "password_hash": hash_password(payload.password),
        "pin_hash": None,
        "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    token = create_access_token(user_id, email)
    response.set_cookie(
        key="access_token", value=token, httponly=True, secure=False,
        samesite="lax", max_age=JWT_ACCESS_MINUTES * 60, path="/",
    )
    return {"id": user_id, "email": email, "name": payload.name, "has_pin": False, "token": token}


@api.post("/auth/login")
async def login(payload: LoginInput, response: Response):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user["id"], email)
    response.set_cookie(
        key="access_token", value=token, httponly=True, secure=False,
        samesite="lax", max_age=JWT_ACCESS_MINUTES * 60, path="/",
    )
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "has_pin": bool(user.get("pin_hash")),
        "token": token,
    }


@api.post("/auth/logout")
async def logout(response: Response, user: dict = Depends(get_current_user)):
    response.delete_cookie("access_token", path="/")
    return {"success": True}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    full = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    return {
        "id": full["id"],
        "email": full["email"],
        "name": full["name"],
        "has_pin": bool(full.get("pin_hash")),
    }


# --------------- Parent PIN ---------------
@api.post("/parent/pin")
async def set_pin(payload: PinInput, user: dict = Depends(get_current_user)):
    await db.users.update_one({"id": user["id"]}, {"$set": {"pin_hash": hash_password(payload.pin)}})
    return {"success": True, "has_pin": True}


@api.post("/parent/pin/verify")
async def verify_pin(payload: PinInput, user: dict = Depends(get_current_user)):
    full = await db.users.find_one({"id": user["id"]})
    if not full.get("pin_hash"):
        raise HTTPException(status_code=400, detail="PIN not set")
    if not verify_password(payload.pin, full["pin_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect PIN")
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


# --------------- Children ---------------
@api.get("/children")
async def list_children(user: dict = Depends(get_current_user)):
    children = await db.children.find({"parent_id": user["id"]}, {"_id": 0}).to_list(100)
    children.sort(key=lambda c: c.get("created_at", ""))
    return children


@api.post("/children")
async def create_child(payload: ChildInput, user: dict = Depends(get_current_user)):
    doc = {
        "id": new_id(),
        "parent_id": user["id"],
        "name": payload.name,
        "age": payload.age,
        "avatar_color": payload.avatar_color,
        "avatar_emoji": payload.avatar_emoji,
        "points": 0,
        "lifetime_points": 0,
        "streak_days": 0,
        "last_completion_date": None,
        "tasks_completed": 0,
        "created_at": now_iso(),
    }
    await db.children.insert_one(doc)
    doc.pop("_id", None)
    await log_activity(user["id"], doc["id"], "child_created", {"name": payload.name})
    return doc


@api.patch("/children/{child_id}")
async def update_child(child_id: str, payload: ChildUpdate, user: dict = Depends(get_current_user)):
    await get_child_or_404(user["id"], child_id)
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if updates:
        await db.children.update_one({"id": child_id}, {"$set": updates})
    updated = await db.children.find_one({"id": child_id}, {"_id": 0})
    return updated


@api.delete("/children/{child_id}")
async def delete_child(child_id: str, user: dict = Depends(get_current_user)):
    await get_child_or_404(user["id"], child_id)
    await db.children.delete_one({"id": child_id})
    await db.tasks.delete_many({"child_id": child_id})
    await db.badges.delete_many({"child_id": child_id})
    await db.redemptions.delete_many({"child_id": child_id})
    await db.applied_consequences.delete_many({"child_id": child_id})
    return {"success": True}


# --------------- Tasks ---------------
@api.get("/tasks")
async def list_tasks(child_id: Optional[str] = None, status_filter: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = {"parent_id": user["id"]}
    if child_id:
        query["child_id"] = child_id
    if status_filter:
        query["status"] = status_filter
    tasks = await db.tasks.find(query, {"_id": 0}).to_list(1000)
    tasks.sort(key=lambda t: (t.get("status") != "pending", t.get("due_date") or "9999"))
    return tasks


@api.post("/tasks")
async def create_task(payload: TaskInput, user: dict = Depends(get_current_user)):
    await get_child_or_404(user["id"], payload.child_id)
    doc = {
        "id": new_id(),
        "parent_id": user["id"],
        "child_id": payload.child_id,
        "title": payload.title,
        "description": payload.description,
        "points": payload.points,
        "penalty_points": payload.penalty_points,
        "due_date": payload.due_date,
        "recurrence": payload.recurrence,
        "icon": payload.icon,
        "status": "pending",  # pending -> completed (waiting approval) -> approved / rejected / missed
        "completed_at": None,
        "approved_at": None,
        "created_at": now_iso(),
    }
    await db.tasks.insert_one(doc)
    doc.pop("_id", None)
    await log_activity(user["id"], payload.child_id, "task_created", {"title": payload.title, "points": payload.points})
    return doc


@api.patch("/tasks/{task_id}")
async def update_task(task_id: str, payload: TaskUpdate, user: dict = Depends(get_current_user)):
    task = await db.tasks.find_one({"id": task_id, "parent_id": user["id"]})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if updates:
        await db.tasks.update_one({"id": task_id}, {"$set": updates})
    return await db.tasks.find_one({"id": task_id}, {"_id": 0})


@api.delete("/tasks/{task_id}")
async def delete_task(task_id: str, user: dict = Depends(get_current_user)):
    res = await db.tasks.delete_one({"id": task_id, "parent_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"success": True}


@api.post("/tasks/{task_id}/complete")
async def complete_task(task_id: str, user: dict = Depends(get_current_user)):
    """Kid marks a task complete → awaits parent approval."""
    task = await db.tasks.find_one({"id": task_id, "parent_id": user["id"]})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task["status"] not in ("pending", "rejected"):
        raise HTTPException(status_code=400, detail="Task cannot be completed in current state")
    await db.tasks.update_one({"id": task_id}, {"$set": {"status": "completed", "completed_at": now_iso()}})
    await log_activity(user["id"], task["child_id"], "task_completed", {"task_id": task_id, "title": task["title"]})
    return await db.tasks.find_one({"id": task_id}, {"_id": 0})


@api.post("/tasks/{task_id}/approve")
async def approve_task(task_id: str, user: dict = Depends(get_current_user)):
    task = await db.tasks.find_one({"id": task_id, "parent_id": user["id"]})
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
    new_badges = await award_badges(user["id"], task["child_id"])
    await log_activity(user["id"], task["child_id"], "task_approved", {"task_id": task_id, "points": points})
    return {"task": await db.tasks.find_one({"id": task_id}, {"_id": 0}), "new_badges": new_badges}


@api.post("/tasks/{task_id}/reject")
async def reject_task(task_id: str, user: dict = Depends(get_current_user)):
    task = await db.tasks.find_one({"id": task_id, "parent_id": user["id"]})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await db.tasks.update_one({"id": task_id}, {"$set": {"status": "pending", "completed_at": None}})
    await log_activity(user["id"], task["child_id"], "task_rejected", {"task_id": task_id})
    return await db.tasks.find_one({"id": task_id}, {"_id": 0})


@api.post("/tasks/{task_id}/miss")
async def mark_task_missed(task_id: str, user: dict = Depends(get_current_user)):
    """Parent marks task as missed → apply penalty."""
    task = await db.tasks.find_one({"id": task_id, "parent_id": user["id"]})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    penalty = task.get("penalty_points", 0)
    if penalty > 0:
        await db.children.update_one({"id": task["child_id"]}, {"$inc": {"points": -penalty}})
    await db.tasks.update_one({"id": task_id}, {"$set": {"status": "missed"}})
    await log_activity(user["id"], task["child_id"], "task_missed", {"task_id": task_id, "penalty": penalty})
    return await db.tasks.find_one({"id": task_id}, {"_id": 0})


# --------------- Rewards ---------------
@api.get("/rewards")
async def list_rewards(user: dict = Depends(get_current_user)):
    rewards = await db.rewards.find({"parent_id": user["id"]}, {"_id": 0}).to_list(200)
    rewards.sort(key=lambda r: r.get("cost_points", 0))
    return rewards


@api.post("/rewards")
async def create_reward(payload: RewardInput, user: dict = Depends(get_current_user)):
    doc = {
        "id": new_id(),
        "parent_id": user["id"],
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
async def delete_reward(reward_id: str, user: dict = Depends(get_current_user)):
    res = await db.rewards.delete_one({"id": reward_id, "parent_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Reward not found")
    return {"success": True}


@api.post("/rewards/{reward_id}/redeem")
async def redeem_reward(reward_id: str, child_id: str, user: dict = Depends(get_current_user)):
    reward = await db.rewards.find_one({"id": reward_id, "parent_id": user["id"]})
    if not reward:
        raise HTTPException(status_code=404, detail="Reward not found")
    child = await get_child_or_404(user["id"], child_id)
    if child["points"] < reward["cost_points"]:
        raise HTTPException(status_code=400, detail="Not enough points")
    await db.children.update_one({"id": child_id}, {"$inc": {"points": -reward["cost_points"]}})
    redemption = {
        "id": new_id(),
        "parent_id": user["id"],
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
    await log_activity(user["id"], child_id, "reward_redeemed", {"reward": reward["name"], "cost": reward["cost_points"]})
    return redemption


@api.get("/redemptions")
async def list_redemptions(child_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = {"parent_id": user["id"]}
    if child_id:
        query["child_id"] = child_id
    items = await db.redemptions.find(query, {"_id": 0}).to_list(500)
    items.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    return items


@api.post("/redemptions/{redemption_id}/fulfill")
async def fulfill_redemption(redemption_id: str, user: dict = Depends(get_current_user)):
    red = await db.redemptions.find_one({"id": redemption_id, "parent_id": user["id"]})
    if not red:
        raise HTTPException(status_code=404, detail="Redemption not found")
    await db.redemptions.update_one({"id": redemption_id}, {"$set": {"status": "fulfilled", "fulfilled_at": now_iso()}})
    return await db.redemptions.find_one({"id": redemption_id}, {"_id": 0})


# --------------- Consequences ---------------
@api.get("/consequences")
async def list_consequences(user: dict = Depends(get_current_user)):
    items = await db.consequences.find({"parent_id": user["id"]}, {"_id": 0}).to_list(200)
    return items


@api.post("/consequences")
async def create_consequence(payload: ConsequenceInput, user: dict = Depends(get_current_user)):
    doc = {
        "id": new_id(),
        "parent_id": user["id"],
        "name": payload.name,
        "description": payload.description,
        "points_deducted": payload.points_deducted,
        "created_at": now_iso(),
    }
    await db.consequences.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.delete("/consequences/{consequence_id}")
async def delete_consequence(consequence_id: str, user: dict = Depends(get_current_user)):
    res = await db.consequences.delete_one({"id": consequence_id, "parent_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Consequence not found")
    return {"success": True}


@api.post("/consequences/apply")
async def apply_consequence(payload: ApplyConsequenceInput, user: dict = Depends(get_current_user)):
    cons = await db.consequences.find_one({"id": payload.consequence_id, "parent_id": user["id"]})
    if not cons:
        raise HTTPException(status_code=404, detail="Consequence not found")
    await get_child_or_404(user["id"], payload.child_id)
    if cons["points_deducted"] > 0:
        await db.children.update_one({"id": payload.child_id}, {"$inc": {"points": -cons["points_deducted"]}})
    applied = {
        "id": new_id(),
        "parent_id": user["id"],
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
    await log_activity(user["id"], payload.child_id, "consequence_applied", {"name": cons["name"], "deducted": cons["points_deducted"]})
    return applied


@api.get("/applied-consequences")
async def list_applied_consequences(child_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = {"parent_id": user["id"]}
    if child_id:
        query["child_id"] = child_id
    items = await db.applied_consequences.find(query, {"_id": 0}).to_list(500)
    items.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    return items


# --------------- Badges ---------------
@api.get("/badges")
async def list_badges(child_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = {"parent_id": user["id"]}
    if child_id:
        query["child_id"] = child_id
    items = await db.badges.find(query, {"_id": 0}).to_list(500)
    items.sort(key=lambda r: r.get("earned_at", ""), reverse=True)
    return items


# --------------- Activity / Stats ---------------
@api.get("/activity")
async def list_activity(child_id: Optional[str] = None, limit: int = 50, user: dict = Depends(get_current_user)):
    query = {"parent_id": user["id"]}
    if child_id:
        query["child_id"] = child_id
    items = await db.activity.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return items


@api.get("/stats/dashboard")
async def dashboard_stats(user: dict = Depends(get_current_user)):
    children = await db.children.find({"parent_id": user["id"]}, {"_id": 0}).to_list(100)
    total_tasks = await db.tasks.count_documents({"parent_id": user["id"]})
    pending_approval = await db.tasks.count_documents({"parent_id": user["id"], "status": "completed"})
    approved_today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    approved_today = await db.tasks.count_documents({
        "parent_id": user["id"],
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


# --------------- Health ---------------
@api.get("/")
async def root():
    return {"message": "My Lil Famz API", "status": "ok"}


# --------------- Startup ---------------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.children.create_index("parent_id")
    await db.tasks.create_index([("parent_id", 1), ("child_id", 1)])
    await db.rewards.create_index("parent_id")
    await db.consequences.create_index("parent_id")
    await db.activity.create_index([("parent_id", 1), ("created_at", -1)])


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
