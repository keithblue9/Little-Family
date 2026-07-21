from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import re
import json
import math
import uuid
import random
import asyncio
import logging
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, status, Query
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator


# --------------- Setup ---------------
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# Serverless platforms (Vercel) can freeze a Python process between
# invocations and later resume it under a *different* asyncio event loop.
# A Motor client created under the old loop becomes unusable ("Event loop is
# closed" / "attached to a different loop"), which shows up as random,
# hard-to-reproduce 401s and failed writes. We track which loop our client
# is bound to and transparently recreate it if the running loop changed.
# (Skipped for the mongomock client used in tests — it has no loop affinity
# and recreating it would wipe the in-memory test database every request.)
_client_loop_id = None


def _is_mongomock(obj) -> bool:
    return any("mongomock" in str(klass) for klass in type(obj).__mro__)


def _ensure_db_bound_to_current_loop():
    global client, db, _client_loop_id
    if _is_mongomock(client):
        return  # test double — no loop binding concerns
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop_id = id(loop)
    if _client_loop_id != loop_id:
        client = AsyncIOMotorClient(mongo_url)
        db = client[os.environ["DB_NAME"]]
        _client_loop_id = loop_id

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


_TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def validate_due_time(value):
    """Accept 'HH:MM' 24-hour strings, or None. Raises 422-style error otherwise."""
    if value in (None, ""):
        return None
    if not _TIME_RE.match(value):
        raise HTTPException(status_code=422, detail="Format jam harus HH:MM (contoh 18:00)")
    return value


# --------------- Auth Dependency ---------------
async def _enforce_maintenance_mode(member_id: str):
    """Raise 503 if the app is in maintenance mode and this member isn't the
    one exempt account (whoever switched it on). Checked centrally in
    get_current_user so it applies to every protected endpoint immediately —
    an already-logged-in session gets locked out on its very next request,
    not just at the next login."""
    config = await db.app_config.find_one({"parent_id": FAMILY_ID}) or {}
    if not config.get("maintenance_mode"):
        return
    if member_id == config.get("maintenance_exempt_member_id"):
        return
    message = config.get("maintenance_message") or "Aplikasi sedang nonaktif sementara. Hubungi orang tua untuk info lebih lanjut."
    raise HTTPException(status_code=503, detail=message)


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
        await _enforce_maintenance_mode(member["id"])
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


class LevelTierInput(BaseModel):
    title: str = Field(min_length=1, max_length=40)
    emoji: str = Field(default="⭐", max_length=10)
    min_xp: int = Field(ge=0, le=1000000)


class AppConfigInput(BaseModel):
    app_name: Optional[str] = None
    default_theme: Optional[Literal["clean", "candy", "mermaid", "cyber", "galaxy"]] = None
    slideshow_background_url: Optional[str] = None
    slideshow_background_image: Optional[str] = None  # base64 data URL (uploaded image)
    rupiah_per_point: Optional[int] = Field(default=None, ge=1, le=1000000)
    skip_cost_points: Optional[int] = Field(default=None, ge=0, le=100000)
    daily_point_goal: Optional[int] = Field(default=None, ge=0, le=10000)
    # Per-weekday minimum point goals (Mon=0..Sun=6). Dict of "0".."6" -> int.
    # When a day isn't set, falls back to the dynamic sum-of-required or daily_point_goal.
    weekday_goals: Optional[dict] = None
    # Three Chikybanks (BusyKid): auto-split earned points by percentage
    chiky_save_pct: Optional[int] = Field(default=None, ge=0, le=100)
    chiky_spend_pct: Optional[int] = Field(default=None, ge=0, le=100)
    chiky_share_pct: Optional[int] = Field(default=None, ge=0, le=100)
    # Early-completion bonus: extra % of a task's points awarded when the kid
    # finishes it BEFORE its due_time. 0 = feature off. Configurable per family.
    early_bonus_pct: Optional[int] = Field(default=None, ge=0, le=100)
    # Kartu Bebas (freeze card) economy — how many per week, and which weekday
    # the count resets on (0=Monday .. 6=Sunday, ISO). Was hardcoded.
    freeze_cards_per_week: Optional[int] = Field(default=None, ge=0, le=7)
    freeze_reset_weekday: Optional[int] = Field(default=None, ge=0, le=6)
    # Custom label overrides: { "label_key": "custom text" }. Empty string = hide.
    custom_labels: Optional[dict] = None
    # Vacation/pause mode: while on, recurring (daily/weekly) tasks don't spawn
    # their next occurrence on approval, so the routine picks back up cleanly
    # instead of piling up missed days. Template itself is untouched.
    vacation_mode: Optional[bool] = None
    vacation_note: Optional[str] = Field(default=None, max_length=100)
    # Notifications: instant per-task push is OFF by default (replaced by the
    # morning/evening digest below) since it can spam parents with an active kid.
    # Parents who prefer instant pings can flip this back on.
    instant_task_notifications: Optional[bool] = None
    language: Optional[Literal["id", "en"]] = None
    # Parent-editable level ladder (title/emoji/XP threshold per level),
    # ordered lowest-to-highest — the kid's level system reads this instead of
    # a fixed hardcoded list. Position in the list IS the level number
    # (index 0 = level 1), so there's no separate "level number" field to
    # keep in sync.
    level_titles: Optional[List[LevelTierInput]] = None

    # --- Virtual pet (Tamagotchi-style) economy — parent-configurable ---
    feed_per_point: Optional[int] = Field(default=None, ge=0, le=100)  # pakan earned per point earned
    feed_cost_per_meal: Optional[int] = Field(default=None, ge=1, le=1000)  # pakan spent per "Beri Makan" tap
    pet_neglect_days: Optional[int] = Field(default=None, ge=1, le=365)  # days un-fed before a pet "passes away"
    pet_stage_names: Optional[List[str]] = None  # exactly 4: egg/baby/teen/adult stage labels
    pet_stage_thresholds: Optional[List[float]] = None  # (legacy, level-ratio based) kept for back-compat
    # Growth is now driven by how many times the pet has been FED, not by the
    # kid's level. Exactly 3 ascending positive ints: feeds needed to reach
    # Bayi, Remaja, Dewasa respectively (stage 0 "Telur" is 0 feeds).
    pet_stage_feed_thresholds: Optional[List[int]] = None

    @field_validator("pet_stage_names")
    @classmethod
    def _validate_pet_stage_names(cls, v):
        if v is None:
            return v
        if len(v) != 4:
            raise ValueError("Harus ada tepat 4 nama tahap pertumbuhan")
        cleaned = [s.strip()[:30] for s in v]
        if any(not s for s in cleaned):
            raise ValueError("Setiap tahap pertumbuhan butuh nama")
        return cleaned

    @field_validator("pet_stage_feed_thresholds")
    @classmethod
    def _validate_pet_feed_thresholds(cls, v):
        if v is None:
            return v
        if len(v) != 3:
            raise ValueError("Harus ada tepat 3 ambang batas pakan (Bayi, Remaja, Dewasa)")
        f1, f2, f3 = v
        if not (1 <= f1 < f2 < f3 <= 100000):
            raise ValueError("Ambang pakan harus menaik: 1 ≤ Bayi < Remaja < Dewasa")
        return [int(f1), int(f2), int(f3)]

    @field_validator("pet_stage_thresholds")
    @classmethod
    def _validate_pet_stage_thresholds(cls, v):
        if v is None:
            return v
        if len(v) != 2:
            raise ValueError("Harus ada tepat 2 ambang batas pertumbuhan")
        t1, t2 = v
        if not (0 < t1 < t2 < 1):
            raise ValueError("Ambang batas harus 0 < tahap-2 < tahap-3 < 1")
        return [float(t1), float(t2)]

    @field_validator("level_titles")
    @classmethod
    def _validate_level_ladder(cls, v):
        if v is None:
            return v
        if not (1 <= len(v) <= 20):
            raise ValueError("Jumlah level harus antara 1 dan 20")
        if v[0].min_xp != 0:
            raise ValueError("Level pertama harus mulai dari 0 XP")
        for i in range(1, len(v)):
            if v[i].min_xp <= v[i - 1].min_xp:
                raise ValueError("XP tiap level harus lebih besar dari level sebelumnya")
        return v


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

# 10 cute pet options for the Tamagotchi-style virtual pet system.
PET_TYPE = Literal["chicken", "bird", "rabbit", "cat", "dragon", "hedgehog", "squirrel", "panda", "fox", "turtle"]

# Cosmetic accessories a kid can equip on their pet — purely for delight, no
# economy impact, so validation here is light (known keys + a sane count cap)
# rather than a strict server-enforced unlock system.
PET_ACCESSORY_KEYS = {"glasses", "sunglasses", "hat", "crown", "bow", "scarf", "flower", "bandana"}


def _validate_pet_accessories(v):
    if v is None:
        return v
    if len(v) > 4:
        raise ValueError("Maksimal 4 aksesori sekaligus")
    unknown = set(v) - PET_ACCESSORY_KEYS
    if unknown:
        raise ValueError(f"Aksesori tidak dikenal: {', '.join(unknown)}")
    return v


class ChildInput(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    age: Optional[int] = Field(default=None, ge=1, le=25)
    avatar_color: str = "#FF9D23"
    avatar_emoji: str = "🦁"
    mbti: Optional[MBTI_TYPES] = None
    quest_theme: Optional[Literal["space", "garden", "ninja", "rainbow", "ocean"]] = None


class ChildUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: Optional[str] = None
    age: Optional[int] = None
    avatar_color: Optional[str] = None
    avatar_emoji: Optional[str] = None
    mbti: Optional[MBTI_TYPES] = None
    quest_theme: Optional[Literal["space", "garden", "ninja", "rainbow", "ocean"]] = None
    savings_goal_name: Optional[str] = Field(default=None, max_length=60)
    savings_goal_amount: Optional[int] = Field(default=None, ge=0, le=1000000000)
    sound_theme: Optional[Literal["ding", "fanfare", "chime", "drum"]] = None
    pet_type: Optional[PET_TYPE] = None
    pet_equipped: Optional[List[str]] = None
    _check_pet_equipped = field_validator("pet_equipped")(classmethod(lambda cls, v: _validate_pet_accessories(v)))


class RoutineTemplateTaskInput(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    points: int = Field(ge=0, le=1000, default=10)
    duration_minutes: Optional[int] = Field(default=None, ge=1, le=1440)
    due_time: Optional[str] = None
    task_style: Optional[TASK_STYLE] = None


class RoutineTemplateInput(BaseModel):
    label: str = Field(min_length=1, max_length=60)
    emoji: str = Field(default="📋", max_length=10)
    desc: str = Field(default="", max_length=150)
    tasks: List[RoutineTemplateTaskInput] = Field(min_length=1, max_length=15)


# The 5 templates that used to be hardcoded on the frontend — now just the
# seed data for a family's first-ever GET, after which they're fully
# editable/deletable rows like anything else the parent creates.
_DEFAULT_ROUTINE_TEMPLATES = [
    {
        "label": "Rutinitas Pagi", "emoji": "🌅", "desc": "Bangun sampai siap beraktivitas",
        "tasks": [
            {"title": "Bangun pagi & rapikan tempat tidur", "points": 10, "duration_minutes": 10, "due_time": "06:00", "task_style": "routine"},
            {"title": "Sikat gigi & cuci muka", "points": 5, "duration_minutes": 5, "due_time": "06:15", "task_style": "routine"},
            {"title": "Mandi pagi", "points": 10, "duration_minutes": 15, "due_time": "06:45", "task_style": "routine"},
            {"title": "Sarapan", "points": 5, "duration_minutes": 20, "due_time": "07:15", "task_style": "routine"},
        ],
    },
    {
        "label": "Rutinitas Sore", "emoji": "🌇", "desc": "Pulang aktivitas sampai makan malam",
        "tasks": [
            {"title": "Rapikan tas & seragam", "points": 5, "duration_minutes": 10, "due_time": "16:00", "task_style": "routine"},
            {"title": "Mandi sore", "points": 10, "duration_minutes": 15, "due_time": "17:00", "task_style": "routine"},
            {"title": "Bantu siapkan makan malam", "points": 10, "duration_minutes": 20, "due_time": "18:30", "task_style": "helper"},
        ],
    },
    {
        "label": "Rutinitas Malam", "emoji": "🌙", "desc": "Beres-beres sampai tidur",
        "tasks": [
            {"title": "Rapikan mainan & meja belajar", "points": 10, "duration_minutes": 15, "due_time": "19:30", "task_style": "routine"},
            {"title": "Siapkan perlengkapan besok", "points": 5, "duration_minutes": 10, "due_time": "20:00", "task_style": "routine"},
            {"title": "Sikat gigi sebelum tidur", "points": 5, "duration_minutes": 5, "due_time": "20:30", "task_style": "routine"},
        ],
    },
    {
        "label": "Waktu Belajar", "emoji": "📚", "desc": "PR, membaca, dan mengaji",
        "tasks": [
            {"title": "Kerjakan PR / tugas sekolah", "points": 15, "duration_minutes": 45, "task_style": "learning"},
            {"title": "Membaca buku 15 menit", "points": 10, "duration_minutes": 15, "task_style": "learning"},
            {"title": "Mengaji / hafalan", "points": 15, "duration_minutes": 20, "task_style": "learning"},
        ],
    },
    {
        "label": "Beres-Beres Rumah", "emoji": "🧹", "desc": "Bantu kebersihan rumah bersama",
        "tasks": [
            {"title": "Sapu kamar sendiri", "points": 10, "duration_minutes": 15, "task_style": "helper"},
            {"title": "Bantu cuci piring", "points": 10, "duration_minutes": 15, "task_style": "helper"},
            {"title": "Buang sampah", "points": 5, "duration_minutes": 5, "task_style": "helper"},
        ],
    },
]


class TaskInput(BaseModel):
    # Assignment: pick 1 kid, several kids, or leave empty = broadcast to ALL kids.
    # `child_id` is kept for backward compatibility (equivalent to target_children=[child_id]).
    child_id: Optional[str] = None
    target_children: Optional[List[str]] = None
    title: str = Field(min_length=1, max_length=120)
    description: str = ""
    points: int = Field(ge=0, le=1000, default=10)
    penalty_points: int = Field(ge=0, le=1000, default=0)
    is_bonus: bool = False  # true = counts as bonus above the daily goal, not required
    due_date: Optional[str] = None       # ISO date string
    due_time: Optional[str] = None       # "HH:MM" 24h deadline within the day
    duration_minutes: Optional[int] = Field(default=None, ge=1, le=1440)
    date_key: Optional[str] = None       # "YYYY-MM-DD" — which daily slot this belongs to
    weekdays: Optional[List[int]] = None  # [0-6] Mon-Sun; create one copy per upcoming matching day
    recurrence: Literal["none", "daily", "weekly"] = "none"
    icon: str = "star"
    order: Optional[int] = Field(default=None, ge=1)
    task_style: Optional[TASK_STYLE] = None
    photo_required: bool = False  # kid must attach a photo to mark this complete
    coop: bool = False  # true = a single shared task worked on together by target_children,
                         # not one copy per kid; points split evenly among participants on approval
    # "Bonus jika bersama": a SIMPLER alternative to full co-op — the task
    # stays an ordinary individual task (one copy per kid via broadcast), but
    # when completing it the kid self-reports whether they did it together
    # with a sibling; if yes, they earn this extra bonus on top of the normal
    # points. No second task needed for things like "Sholat Subuh Berjamaah".
    together_bonus_enabled: bool = False
    together_bonus_points: Optional[int] = Field(default=None, ge=1, le=1000)

    @model_validator(mode="after")
    def _validate_bonus_and_coop_exclusivity(self):
        # field_validator alone doesn't reliably fire when a field is left at
        # its default (Pydantic v2 skips validators on unset/default values
        # unless validate_default=True is set per-field) — a model-level
        # check after all fields resolve is the robust way to enforce this.
        if self.together_bonus_enabled and not self.together_bonus_points:
            raise ValueError("Tentukan poin bonus jika opsi 'dilakukan bersama' diaktifkan")
        if self.together_bonus_enabled and self.coop:
            raise ValueError("Pilih salah satu: Misi Bersama (Co-op) atau Bonus Dilakukan Bersama, tidak keduanya")
        return self


class TaskUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: Optional[str] = None
    description: Optional[str] = None
    points: Optional[int] = None
    penalty_points: Optional[int] = None
    is_bonus: Optional[bool] = None
    due_date: Optional[str] = None
    due_time: Optional[str] = None
    duration_minutes: Optional[int] = Field(default=None, ge=1, le=1440)
    date_key: Optional[str] = None
    recurrence: Optional[Literal["none", "daily", "weekly"]] = None
    icon: Optional[str] = None
    order: Optional[int] = Field(default=None, ge=1)
    task_style: Optional[TASK_STYLE] = None
    photo_required: Optional[bool] = None
    together_bonus_enabled: Optional[bool] = None
    together_bonus_points: Optional[int] = Field(default=None, ge=1, le=1000)


class RedeemMoneyInput(BaseModel):
    child_id: str
    points: int = Field(ge=1, le=1000000)


class CharityRequestInput(BaseModel):
    child_id: str
    points: int = Field(ge=1, le=1000000)
    note: str = Field(default="", max_length=200)


class SelfPasscodeInput(BaseModel):
    old_passcode: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")
    new_passcode: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class SelfProfileInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    avatar_emoji: Optional[str] = Field(default=None, max_length=10)
    avatar_color: Optional[str] = Field(default=None, max_length=20)
    quest_theme: Optional[Literal["space", "garden", "ninja", "rainbow", "ocean"]] = None
    # BusyKid-inspired savings goal: what the child is saving toward.
    savings_goal_name: Optional[str] = Field(default=None, max_length=60)
    savings_goal_amount: Optional[int] = Field(default=None, ge=0, le=1000000000)
    sound_theme: Optional[Literal["ding", "fanfare", "chime", "drum"]] = None
    pet_type: Optional[PET_TYPE] = None
    pet_equipped: Optional[List[str]] = None
    _check_pet_equipped = field_validator("pet_equipped")(classmethod(lambda cls, v: _validate_pet_accessories(v)))


class RewardInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = ""
    cost_points: int = Field(ge=1, le=100000)
    icon: str = "gift"
    image: str = ""  # optional base64 data URL, same storage pattern as slideshow bg

    @field_validator("image")
    @classmethod
    def _validate_reward_image(cls, v):
        if v and len(v) > 2_000_000:  # ~1.4MB decoded — client should downscale first
            raise ValueError("Gambar terlalu besar (maks ~1.4MB). Coba gambar yang lebih kecil.")
        return v


class RewardUpdate(BaseModel):
    # All optional so the parent can edit just one field (e.g. only the cost)
    # without having to resend the whole reward. Unset fields are left as-is.
    model_config = ConfigDict(extra="ignore")
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=500)
    cost_points: Optional[int] = Field(default=None, ge=1, le=100000)
    icon: Optional[str] = None
    image: Optional[str] = None  # "" clears the image; None leaves it unchanged

    @field_validator("image")
    @classmethod
    def _validate_reward_image_upd(cls, v):
        if v and len(v) > 2_000_000:
            raise ValueError("Gambar terlalu besar (maks ~1.4MB). Coba gambar yang lebih kecil.")
        return v


class RewardSuggestionInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=200)
    suggested_cost_points: Optional[int] = Field(default=None, ge=1, le=100000)


class RewardSuggestionReview(BaseModel):
    cost_points: Optional[int] = Field(default=None, ge=1, le=100000)  # parent can adjust before approving
    note: str = Field(default="", max_length=200)


class PetResetRequestInput(BaseModel):
    reason: str = Field(default="", max_length=200)


class PetResetReview(BaseModel):
    note: str = Field(default="", max_length=200)


class ConsequenceInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = ""
    points_deducted: int = Field(ge=0, le=1000, default=0)


class ConsequenceUpdate(BaseModel):
    # Partial edit — same pattern as RewardUpdate. Note: editing a consequence's
    # deduction does NOT retroactively change already-applied deductions; it only
    # affects future applications (matches how editing a reward's cost works).
    model_config = ConfigDict(extra="ignore")
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=500)
    points_deducted: Optional[int] = Field(default=None, ge=0, le=1000)


class ApplyConsequenceInput(BaseModel):
    child_id: str
    consequence_id: str
    task_id: Optional[str] = None
    notes: str = ""


class ViewLinkInput(BaseModel):
    label: str = Field(default="Kakek & Nenek", max_length=60)
    child_ids: Optional[List[str]] = None  # None/empty = all children


class ChallengeInput(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=300)
    participant_ids: List[str] = Field(min_length=1)
    target_points: int = Field(ge=1, le=1000000)  # combined points goal across all participants
    start_date: str  # YYYY-MM-DD
    end_date: str    # YYYY-MM-DD
    reward_description: str = Field(default="", max_length=200)


# --------------- App ---------------
app = FastAPI(title="My Lil Famz API")
api = APIRouter(prefix="/api")


@app.middleware("http")
async def rebind_db_middleware(request: Request, call_next):
    """Runs before every request; see _ensure_db_bound_to_current_loop above."""
    _ensure_db_bound_to_current_loop()
    return await call_next(request)


# --------------- Auth Endpoints ---------------
@api.get("/auth/members")
async def list_members():
    """Public: list family members to show on the login picker (no passcodes)."""
    members = await db.members.find({}, {"_id": 0, "passcode_hash": 0, "passcode_plain": 0}).to_list(20)
    order = {"parent": 0, "child": 1}
    members.sort(key=lambda m: (order.get(m.get("role"), 2), m.get("created_at", "")))
    return members


@api.get("/auth/branding")
async def public_branding():
    """Public: app name, login background, and custom labels for the login screen
    (no auth needed so branding shows before sign-in)."""
    config = await db.app_config.find_one({"parent_id": FAMILY_ID}) or {}
    return {
        "app_name": config.get("app_name", "My Lil Famz"),
        "slideshow_background_url": config.get("slideshow_background_url", ""),
        "slideshow_background_image": config.get("slideshow_background_image", ""),
        "custom_labels": config.get("custom_labels", {}) or {},
        "language": config.get("language", "id"),
    }


@api.post("/auth/login")
async def login(payload: MemberLoginInput, response: Response):
    member = await db.members.find_one({"id": payload.member_id})
    if not member or not member.get("passcode_hash"):
        raise HTTPException(status_code=401, detail="Member not found")
    if not verify_password(payload.passcode, member["passcode_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect passcode")
    await _enforce_maintenance_mode(member["id"])
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
        "mbti": user.get("mbti"),
        "quest_theme": user.get("quest_theme"),
        "sound_theme": user.get("sound_theme", "ding"),
        "pet_type": user.get("pet_type"),
        "pet_equipped": user.get("pet_equipped", []),
        "feed_balance": user.get("feed_balance", 0),
        "feed_lifetime": user.get("feed_lifetime", 0),
        "savings_goal_name": user.get("savings_goal_name"),
        "savings_goal_amount": user.get("savings_goal_amount"),
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

    # Pet choice is permanent once alive — "ganti" only becomes possible again
    # after the current pet has passed away from neglect (see _pet_is_dead).
    # A fresh pick always starts that pet's own journey from zero: feed stats,
    # accessories, and the fed/chosen timestamps reset, even if switching away
    # from a pet that was still alive isn't allowed in the first place.
    if "pet_type" in updates:
        current = await db.children.find_one({"id": user["id"]}) or {}
        config = await db.app_config.find_one({"parent_id": FAMILY_ID}) or {}
        if current.get("pet_type") and not _pet_is_dead(current, config):
            raise HTTPException(
                status_code=400,
                detail="Peliharaanmu masih hidup dan sehat — belum bisa ganti dulu ya, rawat dia sampai besar! 💛",
            )
        now = now_iso()
        updates["pet_chosen_at"] = now
        updates["pet_last_fed_at"] = now
        updates["pet_feed_count"] = 0
        updates["feed_balance"] = 0
        updates["feed_lifetime"] = 0
        updates["pet_equipped"] = []

    if updates:
        await db.members.update_one({"id": user["id"]}, {"$set": updates})
        # Children have a mirrored row used by tasks/points logic.
        await db.children.update_one({"id": user["id"]}, {"$set": updates})
        # Picking a new pet resolves any lingering reset request for this kid.
        if "pet_type" in updates:
            await db.pet_reset_requests.update_many(
                {"child_id": user["id"], "status": "pending"},
                {"$set": {"status": "approved", "reviewed_at": now_iso(), "review_note": "Anak sudah memilih peliharaan baru"}},
            )
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
    # Cash-out draws from the BELANJA (spend) bucket — the pot meant for
    # everyday spending money. Deduct from both the spend bucket and the
    # headline points total to keep them in sync.
    if child.get("chiky_spend", 0) < payload.points:
        raise HTTPException(status_code=400, detail="Poin belanja tidak cukup")

    config = await db.app_config.find_one({"parent_id": FAMILY_ID}) or {}
    rate = int(config.get("rupiah_per_point", 100))
    rupiah = payload.points * rate

    await db.children.update_one({"id": payload.child_id}, {"$inc": {"points": -payload.points, "chiky_spend": -payload.points}})
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
    await db.children.update_one({"id": r["child_id"]}, {"$inc": {"points": r["points"], "chiky_spend": r["points"]}})
    await db.money_redemptions.update_one({"id": redemption_id}, {"$set": {"status": "cancelled"}})
    await log_activity(FAMILY_ID, r["child_id"], "money_redemption_cancelled", {"points": r["points"]})
    return {"success": True}


# --------------- Sedekah (Charity) requests ---------------
@api.post("/charity/request")
async def request_charity(payload: CharityRequestInput, user: dict = Depends(get_current_user)):
    """A kid asks to give some of their SEDEKAH (share) points to charity. The
    points are converted to rupiah at the family rate and held as a pending
    request; a parent approves and hands over the cash to be donated. Points
    leave the child's balance immediately (so they can't double-spend), and are
    refunded if the parent rejects."""
    if user["role"] == "child" and user["id"] != payload.child_id:
        raise HTTPException(status_code=403, detail="Kamu hanya bisa bersedekah dari poinmu sendiri")
    child = await db.children.find_one({"id": payload.child_id, "parent_id": FAMILY_ID})
    if not child:
        raise HTTPException(status_code=404, detail="Child not found")
    if child.get("chiky_share", 0) < payload.points:
        raise HTTPException(status_code=400, detail="Poin sedekah tidak cukup")
    config = await db.app_config.find_one({"parent_id": FAMILY_ID}) or {}
    rate = int(config.get("rupiah_per_point", 100))
    rupiah = payload.points * rate
    await db.children.update_one({"id": payload.child_id}, {"$inc": {"points": -payload.points, "chiky_share": -payload.points}})
    doc = {
        "id": new_id(), "parent_id": FAMILY_ID, "child_id": payload.child_id,
        "child_name": child["name"], "points": payload.points, "rupiah": rupiah, "rate": rate,
        "note": payload.note, "status": "pending", "review_note": "",
        "created_at": now_iso(), "reviewed_at": None,
    }
    await db.charity_requests.insert_one(doc)
    doc.pop("_id", None)
    await log_activity(FAMILY_ID, payload.child_id, "charity_requested", {"points": payload.points, "rupiah": rupiah})
    await send_push_to({"role": "parent"}, title="Permintaan sedekah 🤲", body=f'{child["name"]} ingin bersedekah {payload.points} poin.', url="/parent")
    return doc


@api.get("/charity-requests")
async def list_charity_requests(child_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = {"parent_id": FAMILY_ID}
    if user["role"] == "child":
        query["child_id"] = user["id"]
    elif child_id:
        query["child_id"] = child_id
    items = await db.charity_requests.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
    return items


@api.post("/charity-requests/{request_id}/approve")
async def approve_charity_request(request_id: str, user: dict = Depends(require_parent)):
    """Parent confirms they've handed over the cash to be donated."""
    req = await db.charity_requests.find_one({"id": request_id, "parent_id": FAMILY_ID})
    if not req:
        raise HTTPException(status_code=404, detail="Permintaan tidak ditemukan")
    if req["status"] != "pending":
        raise HTTPException(status_code=400, detail="Permintaan ini sudah diproses")
    await db.charity_requests.update_one({"id": request_id}, {"$set": {"status": "approved", "reviewed_at": now_iso()}})
    await log_activity(FAMILY_ID, req["child_id"], "charity_approved", {"points": req["points"], "rupiah": req["rupiah"]})
    await send_push_to({"role": "child", "member_id": req["child_id"]}, title="Sedekahmu diterima! 🤲", body="Terima kasih sudah berbagi kebaikan 💛", url=f"/kid/{req['child_id']}")
    return await db.charity_requests.find_one({"id": request_id}, {"_id": 0})


@api.post("/charity-requests/{request_id}/reject")
async def reject_charity_request(request_id: str, user: dict = Depends(require_parent)):
    """Parent declines the request and refunds the sedekah points."""
    req = await db.charity_requests.find_one({"id": request_id, "parent_id": FAMILY_ID})
    if not req:
        raise HTTPException(status_code=404, detail="Permintaan tidak ditemukan")
    if req["status"] != "pending":
        raise HTTPException(status_code=400, detail="Permintaan ini sudah diproses")
    await db.children.update_one({"id": req["child_id"]}, {"$inc": {"points": req["points"], "chiky_share": req["points"]}})
    await db.charity_requests.update_one({"id": request_id}, {"$set": {"status": "rejected", "reviewed_at": now_iso()}})
    await log_activity(FAMILY_ID, req["child_id"], "charity_rejected", {"points": req["points"]})
    return await db.charity_requests.find_one({"id": request_id}, {"_id": 0})


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


# Single source of truth for all possible badges — used both to check/award
# them and to show a full "sticker book" (earned + locked) to the kid.
BADGE_CATALOG = [
    {"key": "first_step", "name": "First Step", "desc": "Complete your first task!", "emoji": "🌱"},
    {"key": "ten_tasks", "name": "Task Master", "desc": "Completed 10 tasks", "emoji": "🎯"},
    {"key": "fifty_tasks", "name": "Chore Champion", "desc": "Completed 50 tasks", "emoji": "🏆"},
    {"key": "hundred_points", "name": "Point Collector", "desc": "Earned 100 lifetime points", "emoji": "💎"},
    {"key": "five_hundred_points", "name": "Star Saver", "desc": "Earned 500 lifetime points", "emoji": "⭐"},
    {"key": "streak_3", "name": "3-Day Streak", "desc": "3 days in a row!", "emoji": "🔥"},
    {"key": "streak_7", "name": "Week Warrior", "desc": "7 days in a row!", "emoji": "🗓️"},
]


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

    condition_by_key = {
        "first_step": tasks_completed >= 1,
        "ten_tasks": tasks_completed >= 10,
        "fifty_tasks": tasks_completed >= 50,
        "hundred_points": lifetime >= 100,
        "five_hundred_points": lifetime >= 500,
        "streak_3": streak >= 3,
        "streak_7": streak >= 7,
    }
    rules = [(b["key"], b["name"], b["desc"], condition_by_key[b["key"]]) for b in BADGE_CATALOG]
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


@api.get("/badges/catalog")
async def get_badge_catalog(user: dict = Depends(get_current_user)):
    """All possible badges (earned or not) — powers the 'sticker book' view
    showing locked silhouettes alongside earned ones."""
    return BADGE_CATALOG


async def get_child_or_404(parent_id: str, child_id: str) -> dict:
    child = await db.children.find_one({"id": child_id, "parent_id": parent_id}, {"_id": 0})
    if not child:
        raise HTTPException(status_code=404, detail="Child not found")
    return child


# --------------- View-only Links (grandparents / extended family) ---------------
@api.post("/view-links")
async def create_view_link(payload: ViewLinkInput, user: dict = Depends(require_parent)):
    """Parent creates a shareable read-only link — no login required to view it.
    Never exposes passcodes, approve/edit actions, or anything beyond progress
    and achievements."""
    if payload.child_ids:
        for cid in payload.child_ids:
            await get_child_or_404(FAMILY_ID, cid)
    doc = {
        "id": new_id(),
        "parent_id": FAMILY_ID,
        "token": uuid.uuid4().hex,  # unguessable, separate from any internal id
        "label": payload.label,
        "child_ids": payload.child_ids or [],  # empty = all children
        "revoked": False,
        "created_at": now_iso(),
        "last_viewed_at": None,
        "view_count": 0,
    }
    await db.view_links.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/view-links")
async def list_view_links(user: dict = Depends(require_parent)):
    links = await db.view_links.find({"parent_id": FAMILY_ID}, {"_id": 0, "token": 0}).sort("created_at", -1).to_list(50)
    # Token is deliberately excluded from the list view (already shown once at
    # creation time) to reduce how often the raw shareable secret appears in
    # API responses; the share URL itself is handled client-side right after creation.
    return links


@api.get("/view-links/{link_id}/token")
async def get_view_link_token(link_id: str, user: dict = Depends(require_parent)):
    """Parent can re-fetch the share URL's token later (e.g. to re-share or
    regenerate a QR code) without needing to recreate the whole link."""
    link = await db.view_links.find_one({"id": link_id, "parent_id": FAMILY_ID}, {"_id": 0})
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")
    return {"token": link["token"]}


@api.delete("/view-links/{link_id}")
async def revoke_view_link(link_id: str, user: dict = Depends(require_parent)):
    """Revoking is a soft-delete (flip revoked=True) rather than removing the
    document, so the parent can still see it existed in their link history."""
    await db.view_links.update_one({"id": link_id, "parent_id": FAMILY_ID}, {"$set": {"revoked": True}})
    return {"success": True}


@api.get("/public/view/{token}")
async def public_view_by_token(token: str):
    """Fully public, no auth: read-only family progress for whoever holds this
    link. Returns only what a proud grandparent should see — points, streaks,
    badges, recent approved missions — never passcodes, settings, or anything
    that can change state."""
    link = await db.view_links.find_one({"token": token}, {"_id": 0})
    if not link or link.get("revoked"):
        raise HTTPException(status_code=404, detail="Link tidak ditemukan atau sudah dicabut")

    await db.view_links.update_one(
        {"token": token},
        {"$set": {"last_viewed_at": now_iso()}, "$inc": {"view_count": 1}},
    )

    child_ids = link.get("child_ids") or []
    query = {"parent_id": FAMILY_ID}
    if child_ids:
        query["id"] = {"$in": child_ids}
    kids = await db.children.find(query, {"_id": 0}).to_list(50)

    out = []
    for k in kids:
        badges = await db.badges.find({"child_id": k["id"]}, {"_id": 0}).sort("earned_at", -1).to_list(20)
        recent = await db.tasks.find(
            {"status": "approved", "$or": [{"child_id": k["id"]}, {"is_coop": True, "coop_participants": k["id"]}]},
            {"_id": 0},
        ).sort("approved_at", -1).to_list(10)
        out.append({
            "id": k["id"],
            "name": k["name"],
            "avatar_emoji": k.get("avatar_emoji"),
            "avatar_color": k.get("avatar_color"),
            "points": k.get("points", 0),
            "lifetime_points": k.get("lifetime_points", 0),
            "streak_days": k.get("streak_days", 0),
            "tasks_completed": k.get("tasks_completed", 0),
            "badges": badges,
            "recent_missions": [
                {"title": t["title"], "points": t["points"], "approved_at": t.get("approved_at"),
                 "completion_photo_url": t.get("completion_photo_url")}
                for t in recent
            ],
        })
    return {"family_label": link.get("label", "Keluarga"), "children": out}


# --------------- Family Challenges ---------------
@api.post("/challenges")
async def create_challenge(payload: ChallengeInput, user: dict = Depends(require_parent)):
    if payload.end_date < payload.start_date:
        raise HTTPException(status_code=422, detail="Tanggal selesai harus setelah tanggal mulai")
    for cid in payload.participant_ids:
        await get_child_or_404(FAMILY_ID, cid)  # 404s if any participant doesn't exist
    doc = {
        "id": new_id(),
        "parent_id": FAMILY_ID,
        "title": payload.title,
        "description": payload.description,
        "participant_ids": payload.participant_ids,
        "target_points": payload.target_points,
        "start_date": payload.start_date,
        "end_date": payload.end_date,
        "reward_description": payload.reward_description,
        "status": "active",  # active -> completed | expired | cancelled
        "created_at": now_iso(),
    }
    await db.challenges.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def _challenge_progress(ch: dict) -> dict:
    """Combined points earned by all participants within the challenge window."""
    participant_set = set(ch["participant_ids"])
    tasks = await db.tasks.find({
        "date_key": {"$gte": ch["start_date"], "$lte": ch["end_date"]},
        "status": "approved",
        "$or": [
            {"child_id": {"$in": ch["participant_ids"]}},
            {"is_coop": True, "coop_participants": {"$in": ch["participant_ids"]}},
        ],
    }, {"_id": 0}).to_list(5000)
    earned = 0
    for t in tasks:
        if t.get("is_coop"):
            # Only count each challenge participant's own share — avoids
            # double-counting the task's full points if one participant did it
            # together with a sibling who isn't part of this challenge.
            for pid in (t.get("coop_participants") or []):
                if pid in participant_set:
                    earned += _child_share_of_task(t, pid)
        elif t.get("child_id") in participant_set:
            earned += t.get("points", 0)
    percent = min(100, int((earned / ch["target_points"]) * 100)) if ch["target_points"] else 100
    today = _today_key()
    is_expired = ch["status"] == "active" and today > ch["end_date"] and earned < ch["target_points"]
    is_completed_now = ch["status"] == "active" and earned >= ch["target_points"]
    return {
        **ch,
        "earned_points": earned,
        "percent": percent,
        "goal_met": earned >= ch["target_points"],
        "computed_status": "completed" if (ch["status"] == "completed" or is_completed_now) else ("expired" if is_expired else ch["status"]),
    }


@api.get("/challenges")
async def list_challenges(user: dict = Depends(get_current_user)):
    """Parents see all challenges; kids only see ones they participate in."""
    query = {"parent_id": FAMILY_ID}
    if user["role"] == "child":
        query["participant_ids"] = user["id"]
    challenges = await db.challenges.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
    out = []
    for ch in challenges:
        enriched = await _challenge_progress(ch)
        # Persist a freshly-detected completion/expiry so it's stable on next read.
        if enriched["computed_status"] != ch["status"]:
            await db.challenges.update_one({"id": ch["id"]}, {"$set": {"status": enriched["computed_status"]}})
            enriched["status"] = enriched["computed_status"]
        out.append(enriched)
    return out


@api.delete("/challenges/{challenge_id}")
async def delete_challenge(challenge_id: str, user: dict = Depends(require_parent)):
    await db.challenges.delete_one({"id": challenge_id, "parent_id": FAMILY_ID})  # idempotent
    return {"success": True}


# --------------- Growth Trail (portfolio timeline) ---------------
@api.get("/children/{child_id}/growth-trail")
async def child_growth_trail(child_id: str, user: dict = Depends(get_current_user)):
    """Chronological highlight reel for one child: badges earned, photo-verified
    missions, and streak/points milestones — auto-compiled from data that
    already exists elsewhere, so there's nothing new for parents to maintain."""
    child = await get_child_or_404(FAMILY_ID, child_id)

    events = []

    badges = await db.badges.find({"child_id": child_id}, {"_id": 0}).to_list(100)
    for b in badges:
        events.append({
            "type": "badge", "date": b.get("earned_at"),
            "title": b.get("name", "Badge"), "detail": b.get("description", ""),
            "icon": None,
        })

    photo_tasks = await db.tasks.find(
        {
            "status": "approved", "completion_photo_url": {"$ne": None},
            "$or": [{"child_id": child_id}, {"is_coop": True, "coop_participants": child_id}],
        },
        {"_id": 0},
    ).sort("approved_at", -1).to_list(50)
    for t in photo_tasks:
        events.append({
            "type": "photo", "date": t.get("approved_at"),
            "title": t.get("title", "Misi"), "detail": f"+{t.get('points', 0)} poin",
            "image": t.get("completion_photo_url"),
        })

    # Milestones: every 100 lifetime points and every 7-day streak multiple,
    # inferred from current totals (we don't have historical snapshots, so
    # these show as "reached" milestones dated at the most recent approval
    # that would have crossed them — approximate but good enough for a keepsake).
    lifetime = child.get("lifetime_points", 0)
    streak = child.get("streak_days", 0)
    milestone_marker_date = None
    last_approved = await db.tasks.find_one(
        {"child_id": child_id, "status": "approved"}, {"_id": 0}, sort=[("approved_at", -1)]
    )
    if last_approved:
        milestone_marker_date = last_approved.get("approved_at")
    for threshold in (100, 250, 500, 1000, 2500, 5000):
        if lifetime >= threshold:
            events.append({
                "type": "milestone", "date": milestone_marker_date,
                "title": f"{threshold} Poin Sepanjang Masa!", "detail": "Milestone poin",
            })
    for threshold in (7, 14, 30, 60, 100):
        if streak >= threshold:
            events.append({
                "type": "milestone", "date": milestone_marker_date,
                "title": f"Streak {threshold} Hari!", "detail": "Konsisten luar biasa",
            })

    events.sort(key=lambda e: e.get("date") or "", reverse=True)
    return {
        "child": {"id": child["id"], "name": child["name"], "avatar_emoji": child.get("avatar_emoji"), "avatar_color": child.get("avatar_color")},
        "events": events,
    }


# --------------- Sibling Cheers ---------------
CHEER_COOLDOWN_MINUTES = 30  # per (sender, recipient) pair — keeps it a genuine gesture, not spam


class CheerInput(BaseModel):
    emoji: str = Field(default="👏", max_length=8)
    message: str = Field(default="", max_length=100)


@api.post("/children/{child_id}/cheer")
async def cheer_sibling(child_id: str, payload: CheerInput, user: dict = Depends(get_current_user)):
    """A kid sends a quick cheer/encouragement to a sibling — visible on the
    recipient's own page, with a push notification. Cooldown per pair keeps
    it meaningful rather than a button to mash."""
    if user["role"] != "child":
        raise HTTPException(status_code=422, detail="Hanya anak yang bisa mengirim semangat")
    if user["id"] == child_id:
        raise HTTPException(status_code=422, detail="Tidak bisa mengirim semangat ke diri sendiri")
    recipient = await get_child_or_404(FAMILY_ID, child_id)

    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=CHEER_COOLDOWN_MINUTES)).isoformat()
    recent = await db.cheers.find_one({
        "parent_id": FAMILY_ID, "from_child_id": user["id"], "to_child_id": child_id,
        "created_at": {"$gte": cutoff},
    })
    if recent:
        raise HTTPException(status_code=429, detail=f"Sudah kirim semangat ke {recipient['name']} baru-baru ini — coba lagi nanti ya!")

    doc = {
        "id": new_id(), "parent_id": FAMILY_ID,
        "from_child_id": user["id"], "from_child_name": user["name"],
        "to_child_id": child_id, "emoji": payload.emoji, "message": payload.message,
        "created_at": now_iso(),
    }
    await db.cheers.insert_one(doc)
    doc.pop("_id", None)
    await send_push_to(
        {"role": "child", "member_id": child_id},
        title=f"{user['name']} menyemangatimu! {payload.emoji}",
        body=payload.message or "Semangat terus!",
        url=f"/kid/{child_id}",
    )
    return doc


@api.get("/children/{child_id}/cheers")
async def list_cheers_received(child_id: str, user: dict = Depends(get_current_user)):
    await get_child_or_404(FAMILY_ID, child_id)
    cheers = await db.cheers.find({"parent_id": FAMILY_ID, "to_child_id": child_id}, {"_id": 0}).sort("created_at", -1).to_list(20)
    return cheers


# --------------- Weekly Report ---------------
@api.get("/family/weekly-report")
async def family_weekly_report(user: dict = Depends(require_parent)):
    """Summary of the last 7 days: per-child points, tasks, streaks, goal hits."""
    now = _now_local()
    today = now.strftime("%Y-%m-%d")
    week_ago = (now - timedelta(days=6)).strftime("%Y-%m-%d")

    kids = await db.children.find({"parent_id": FAMILY_ID}, {"_id": 0}).to_list(100)
    report = []
    for k in kids:
        tasks = await db.tasks.find({
            "date_key": {"$gte": week_ago, "$lte": today},
            "$or": [{"child_id": k["id"]}, {"is_coop": True, "coop_participants": k["id"]}],
        }, {"_id": 0}).to_list(2000)

        approved = [t for t in tasks if t.get("status") == "approved"]
        completed = [t for t in tasks if t.get("status") in ("completed", "approved")]
        total_points = sum(_child_share_of_task(t, k["id"]) for t in approved)

        # Per-day breakdown
        days = {}
        for d_offset in range(7):
            dk = (now - timedelta(days=6 - d_offset)).strftime("%Y-%m-%d")
            day_tasks = [t for t in tasks if t.get("date_key") == dk]
            day_earned = sum(_child_share_of_task(t, k["id"]) for t in day_tasks if t.get("status") in ("completed", "approved"))
            days[dk] = {
                "total": len(day_tasks),
                "done": len([t for t in day_tasks if t.get("status") in ("completed", "approved", "skipped")]),
                "earned": day_earned,
            }

        report.append({
            "child": {
                "id": k["id"], "name": k["name"],
                "avatar_emoji": k.get("avatar_emoji"), "avatar_color": k.get("avatar_color"),
                "mbti": k.get("mbti"), "points": k.get("points", 0),
                "streak_days": k.get("streak_days", 0),
                "chiky_save": k.get("chiky_save", 0),
                "chiky_spend": k.get("chiky_spend", 0),
                "chiky_share": k.get("chiky_share", 0),
            },
            "week_points": total_points,
            "week_tasks_done": len(completed),
            "week_tasks_total": len(tasks),
            "days": days,
        })

    return {
        "period_start": week_ago,
        "period_end": today,
        "children": report,
    }


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
    "ENFJ-T": {
        "nickname": "Sang Pemimpin Hangat",
        "emoji": "🌟",
        "color": "#F472B6",
        "summary": "Karismatik, empatik, dan senang menginspirasi serta membantu orang lain.",
        "likes": ["Membantu & menyemangati orang lain", "Tugas bersama keluarga", "Apresiasi & pengakuan tulus"],
        "best_styles": ["helper", "social", "creative"],
        "motivation": "Kamu pemimpin yang hangat! Semangatmu menular ke seluruh keluarga. 🌟",
        "encourage_done": "Luar biasa! Kepemimpinan dan kebaikanmu membuat semua bangga. 💫",
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
    config = await db.app_config.find_one({"parent_id": FAMILY_ID}) or {}
    for c in children:
        c["pet_is_dead"] = _pet_is_dead(c, config)
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
        "best_streak_days": 0,
        "last_completion_date": None,
        "tasks_completed": 0,
        "freeze_cards_available": FREEZE_CARDS_PER_WEEK,
        "freeze_card_week": None,
        "pet_type": None,  # kid picks on first visit to the pet feature
        "pet_chosen_at": None,
        "pet_last_fed_at": None,
        "pet_feed_count": 0,
        "feed_balance": 0,
        "feed_lifetime": 0,
        "pet_equipped": [],
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
    # Parents can override a child's pet anytime (e.g. fixing a mistake) —
    # unlike the kid's own /me/profile pet_type change, this isn't locked by
    # the "alive" check, but it still starts that pet's journey fresh.
    if "pet_type" in updates:
        now = now_iso()
        updates["pet_chosen_at"] = now
        updates["pet_last_fed_at"] = now
        updates["pet_feed_count"] = 0
        updates["feed_balance"] = 0
        updates["feed_lifetime"] = 0
        updates["pet_equipped"] = []
    if updates:
        await db.children.update_one({"id": child_id}, {"$set": updates})
        await db.members.update_one({"id": child_id}, {"$set": updates})
    updated = await db.children.find_one({"id": child_id}, {"_id": 0})
    return updated


@api.post("/children/{child_id}/reset-points")
async def reset_child_points(child_id: str, user: dict = Depends(require_parent)):
    """Wipe a child's scoreboard back to zero — for clearing out test data or
    starting a fresh season. Resets current & lifetime points, streaks, tasks
    completed, pet-feed currency, and the freeze-card allotment; also clears
    that child's redemption and applied-consequence history so the Leaderboard
    and Uang & Poin pages start clean. Does NOT delete the child, their tasks,
    passcode, avatar, pet choice, or theme — only the earned/spent scoreboard."""
    await get_child_or_404(FAMILY_ID, child_id)
    await db.children.update_one(
        {"id": child_id},
        {"$set": {
            "points": 0,
            "lifetime_points": 0,
            "streak_days": 0,
            "best_streak_days": 0,
            "last_completion_date": None,
            "tasks_completed": 0,
            "feed_balance": 0,
            "feed_lifetime": 0,
            "freeze_cards_available": FREEZE_CARDS_PER_WEEK,
            "freeze_card_week": None,
        }},
    )
    # Clear scoreboard-affecting history so the numbers genuinely start from 0.
    await db.redemptions.delete_many({"child_id": child_id})
    await db.applied_consequences.delete_many({"child_id": child_id})
    await log_activity(FAMILY_ID, child_id, "points_reset", {})
    return await db.children.find_one({"id": child_id}, {"_id": 0})


@api.post("/children/reset-all-points")
async def reset_all_children_points(user: dict = Depends(require_parent)):
    """Same as reset-points but for EVERY child at once — handy after a testing
    phase to bring the whole family's scoreboard back to zero in one tap."""
    kids = await db.children.find({"parent_id": FAMILY_ID}, {"id": 1}).to_list(100)
    for k in kids:
        await db.children.update_one(
            {"id": k["id"]},
            {"$set": {
                "points": 0, "lifetime_points": 0, "streak_days": 0,
                "best_streak_days": 0, "last_completion_date": None,
                "tasks_completed": 0, "feed_balance": 0, "feed_lifetime": 0,
                "freeze_cards_available": FREEZE_CARDS_PER_WEEK, "freeze_card_week": None,
            }},
        )
        await db.redemptions.delete_many({"child_id": k["id"]})
        await db.applied_consequences.delete_many({"child_id": k["id"]})
        await log_activity(FAMILY_ID, k["id"], "points_reset", {})
    return {"success": True, "count": len(kids)}


async def _clear_child_pet(child_id: str):
    """Shared pet-wipe used by both the parent's direct reset and the
    approve-a-request flow, so the two can never drift apart."""
    await db.children.update_one(
        {"id": child_id},
        {"$set": {
            "pet_type": None,
            "pet_chosen_at": None,
            "pet_last_fed_at": None,
            "pet_feed_count": 0,
            "feed_balance": 0,
            "feed_lifetime": 0,
            "pet_equipped": [],
        }},
    )
    await db.members.update_one(
        {"id": child_id},
        {"$set": {"pet_type": None, "pet_equipped": []}},
    )


@api.post("/children/{child_id}/reset-pet")
async def reset_child_pet(child_id: str, user: dict = Depends(require_parent)):
    """Clear a child's virtual pet entirely — sends them back to the picker
    screen with a completely blank slate, bypassing the usual 'wait for it to
    pass away' permanence rule. For parents fixing a mistake, clearing test
    data, or letting a kid start over without an actual neglect wait. Does NOT
    touch points/streaks/level — only the pet itself and its feed economy."""
    await get_child_or_404(FAMILY_ID, child_id)
    await _clear_child_pet(child_id)
    # Clear any still-pending reset request now that it's been actioned directly.
    await db.pet_reset_requests.update_many(
        {"child_id": child_id, "status": "pending"},
        {"$set": {"status": "approved", "reviewed_at": now_iso(), "review_note": "Direset langsung oleh orang tua"}},
    )
    await log_activity(FAMILY_ID, child_id, "pet_reset", {})
    return await db.children.find_one({"id": child_id}, {"_id": 0})


# --------------- Pet reset REQUESTS (kid asks, parent approves) ---------------
@api.post("/me/request-pet-reset")
async def request_pet_reset(payload: PetResetRequestInput, user: dict = Depends(get_current_user)):
    """A kid asks to swap their (still-alive) pet for a new one. Because pets
    are meant to be a lasting responsibility, the kid can't just reset on their
    own — they submit a request and a parent decides. Only one pending request
    per child at a time."""
    if user["role"] != "child":
        raise HTTPException(status_code=422, detail="Hanya anak yang bisa mengajukan ganti peliharaan")
    child = await get_child_or_404(FAMILY_ID, user["id"])
    if not child.get("pet_type"):
        raise HTTPException(status_code=400, detail="Kamu belum punya peliharaan untuk diganti")
    existing = await db.pet_reset_requests.find_one({"child_id": user["id"], "status": "pending"})
    if existing:
        raise HTTPException(status_code=400, detail="Kamu sudah punya permintaan yang menunggu persetujuan")
    doc = {
        "id": new_id(), "parent_id": FAMILY_ID, "child_id": user["id"],
        "child_name": child.get("name", ""), "current_pet": child.get("pet_type"),
        "reason": payload.reason, "status": "pending", "review_note": "",
        "created_at": now_iso(), "reviewed_at": None,
    }
    await db.pet_reset_requests.insert_one(doc)
    doc.pop("_id", None)
    await send_push_to({"role": "parent"}, title="Permintaan ganti peliharaan 🐾", body=f'{child.get("name","Anak")} ingin ganti peliharaan.', url="/parent")
    return doc


@api.get("/pet-reset-requests")
async def list_pet_reset_requests(user: dict = Depends(get_current_user)):
    query = {"parent_id": FAMILY_ID}
    if user["role"] == "child":
        query["child_id"] = user["id"]  # kids see only their own
    items = await db.pet_reset_requests.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
    return items


@api.post("/pet-reset-requests/{request_id}/approve")
async def approve_pet_reset_request(request_id: str, payload: PetResetReview, user: dict = Depends(require_parent)):
    req = await db.pet_reset_requests.find_one({"id": request_id, "parent_id": FAMILY_ID})
    if not req:
        raise HTTPException(status_code=404, detail="Permintaan tidak ditemukan")
    if req["status"] != "pending":
        raise HTTPException(status_code=400, detail="Permintaan ini sudah diproses")
    await _clear_child_pet(req["child_id"])
    await db.pet_reset_requests.update_one(
        {"id": request_id},
        {"$set": {"status": "approved", "review_note": payload.note, "reviewed_at": now_iso()}},
    )
    await log_activity(FAMILY_ID, req["child_id"], "pet_reset", {"via": "request"})
    await send_push_to({"role": "child", "member_id": req["child_id"]}, title="Boleh ganti peliharaan! 🎉", body="Yuk pilih peliharaan barumu di menu Profil.", url=f"/kid/{req['child_id']}")
    return await db.pet_reset_requests.find_one({"id": request_id}, {"_id": 0})


@api.post("/pet-reset-requests/{request_id}/reject")
async def reject_pet_reset_request(request_id: str, payload: PetResetReview, user: dict = Depends(require_parent)):
    req = await db.pet_reset_requests.find_one({"id": request_id, "parent_id": FAMILY_ID})
    if not req:
        raise HTTPException(status_code=404, detail="Permintaan tidak ditemukan")
    if req["status"] != "pending":
        raise HTTPException(status_code=400, detail="Permintaan ini sudah diproses")
    await db.pet_reset_requests.update_one(
        {"id": request_id},
        {"$set": {"status": "rejected", "review_note": payload.note, "reviewed_at": now_iso()}},
    )
    await send_push_to({"role": "child", "member_id": req["child_id"]}, title="Tentang permintaan peliharaanmu", body=payload.note or "Rawat dulu peliharaanmu yang sekarang ya 💛", url=f"/kid/{req['child_id']}")
    return await db.pet_reset_requests.find_one({"id": request_id}, {"_id": 0})


@api.delete("/pet-reset-requests/{request_id}")
async def delete_pet_reset_request(request_id: str, user: dict = Depends(get_current_user)):
    """Kid can withdraw their own pending request; parent can clear any."""
    query = {"id": request_id, "parent_id": FAMILY_ID}
    if user["role"] == "child":
        query["child_id"] = user["id"]
        query["status"] = "pending"
    await db.pet_reset_requests.delete_one(query)
    return {"success": True}


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
async def list_tasks(
    child_id: Optional[str] = None,
    status_filter: Optional[str] = None,
    date_key: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    query = {"parent_id": FAMILY_ID}
    if child_id:
        # Match either "this is their individual task" OR "this is a co-op task
        # they're one of the participants in" (co-op tasks store child_id as
        # just the primary owner, so a plain child_id match alone would miss them).
        query["$or"] = [{"child_id": child_id}, {"is_coop": True, "coop_participants": child_id}]
    if status_filter:
        query["status"] = status_filter
    if date_key:
        query["date_key"] = date_key
    _UNDO_FIELDS = {
        "_undo_prev_streak": 0, "_undo_prev_last_completion": 0, "_undo_points_awarded": 0,
        "_undo_chiky_save": 0, "_undo_chiky_spend": 0, "_undo_chiky_share": 0, "_undo_spawned_next_id": 0,
        "_undo_used_freeze_card": 0, "_undo_prev_freeze_available": 0, "_undo_prev_freeze_week": 0,
        "_undo_coop_snapshots": 0, "_undo_prev_best_streak": 0, "_undo_feed_earned": 0, "_undo_miss_penalty": 0,
        "_undo_free_prev_available": 0, "_undo_free_prev_week": 0,
    }
    tasks = await db.tasks.find(query, {"_id": 0, **_UNDO_FIELDS}).to_list(2000)
    tasks.sort(key=lambda t: (t.get("date_key") or "", t.get("order") or 0))
    return tasks


def validate_date_key(value):
    if value in (None, ""):
        return None
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", value):
        raise HTTPException(status_code=422, detail="Format tanggal harus YYYY-MM-DD")
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=422, detail="Tanggal tidak valid")
    return value


def _today_key() -> str:
    # Family lives in Indonesia (GMT+7). Using UTC here caused tasks created
    # after local midnight to be filed under the previous day. The frontend
    # sends explicit local date_keys for anything user-facing; this is only a
    # fallback, but it should still match the family's wall clock.
    return (datetime.now(timezone.utc) + timedelta(hours=7)).strftime("%Y-%m-%d")


async def _build_task_doc(
    child_id: str,
    payload: TaskInput,
    date_key: Optional[str],
    order: Optional[int],
    broadcast_id: Optional[str],
) -> dict:
    """Assemble a task document for one child. Order is per-child within its date_key."""
    if order is None:
        last = await db.tasks.find(
            {"child_id": child_id, "date_key": date_key}
        ).sort("order", -1).to_list(1)
        order = (last[0].get("order", 0) + 1) if last else 1

    task_style = payload.task_style
    if task_style is None:
        child = await db.children.find_one({"id": child_id})
        task_style = suggested_style_for_mbti(child.get("mbti") if child else None)

    return {
        "id": new_id(),
        "parent_id": FAMILY_ID,
        "child_id": child_id,
        "broadcast_id": broadcast_id,  # groups tasks created together for edit/delete
        "title": payload.title,
        "description": payload.description,
        "points": payload.points,
        "penalty_points": payload.penalty_points,
        "is_bonus": payload.is_bonus,
        "due_date": payload.due_date,
        "due_time": validate_due_time(payload.due_time),
        "duration_minutes": payload.duration_minutes,
        "date_key": date_key,
        "recurrence": payload.recurrence,
        "icon": payload.icon,
        "order": order,
        "task_style": task_style,
        "photo_required": payload.photo_required,
        "completion_photo_url": None,
        "is_coop": False,
        "coop_participants": [],
        "coop_completed_by": None,
        "together_bonus_enabled": payload.together_bonus_enabled,
        "together_bonus_points": payload.together_bonus_points,
        "done_together": None,  # kid's self-reported answer once they complete the task
        "freed_with_card": False,  # true if unblocked via Kartu Bebas instead of actually finishing
        "timer_started_at": None,
        "timer_completed_at": None,
        "status": "pending",  # pending -> completed (waiting approval) -> approved / rejected / missed / skipped
        "completed_at": None,
        "approved_at": None,
        "created_at": now_iso(),
    }


@api.post("/tasks")
async def create_task(payload: TaskInput, user: dict = Depends(require_parent)):
    # Resolve target children set:
    #   - `target_children` explicit list wins
    #   - else `child_id` (backward-compat)
    #   - else empty -> broadcast to ALL children (family-wide daily chore)
    targets = payload.target_children
    if not targets and payload.child_id:
        targets = [payload.child_id]
    if not targets:
        all_kids = await db.children.find({"parent_id": FAMILY_ID}, {"id": 1}).to_list(100)
        targets = [k["id"] for k in all_kids]
    if not targets:
        raise HTTPException(status_code=400, detail="Belum ada anak — tambahkan anak dulu")

    # Validate all target children exist
    for cid in targets:
        await get_child_or_404(FAMILY_ID, cid)

    # Resolve which date_keys to create on.
    #   - `weekdays` (Mon=0..Sun=6): create on the nearest upcoming date for each
    #     selected weekday (so "Senin & Rabu" makes this week's Mon and Wed).
    #   - else `date_key` (explicit single date)
    #   - else today.
    date_keys = []
    if payload.weekdays:
        valid_wds = sorted(set(w for w in payload.weekdays if 0 <= w <= 6))
        if not valid_wds:
            raise HTTPException(status_code=422, detail="Hari tidak valid")
        base = _now_local().date()
        for wd in valid_wds:
            days_ahead = (wd - base.weekday()) % 7  # 0 = today if matches
            target = base + timedelta(days=days_ahead)
            date_keys.append(target.strftime("%Y-%m-%d"))
    else:
        date_keys = [validate_date_key(payload.date_key) or _today_key()]

    multi = len(targets) > 1 or len(date_keys) > 1
    broadcast_id = new_id() if multi else None

    if payload.coop:
        if len(targets) < 2:
            raise HTTPException(status_code=422, detail="Misi bersama butuh minimal 2 anak")
        created = []
        for dk in date_keys:
            doc = await _build_task_doc(targets[0], payload, dk, payload.order, broadcast_id)
            # Co-op tasks are always bonus-type: since ONE shared task can't
            # cleanly occupy a specific sequence slot in two different kids'
            # individual quest lines at once, forcing bonus sidesteps that
            # entirely — it shows up as an extra "do this together" activity
            # without blocking or reordering anyone's required missions.
            doc["is_bonus"] = True
            doc["is_coop"] = True
            doc["coop_participants"] = targets
            doc["coop_completed_by"] = None
            await db.tasks.insert_one(doc)
            doc.pop("_id", None)
            created.append(doc)
            for cid in targets:
                await log_activity(FAMILY_ID, cid, "task_created", {"title": payload.title, "points": payload.points, "date_key": dk, "coop": True})
        return created[0] if len(created) == 1 else {"broadcast_id": broadcast_id, "tasks": created, "count": len(created)}

    created = []
    for dk in date_keys:
        for cid in targets:
            doc = await _build_task_doc(cid, payload, dk, payload.order, broadcast_id)
            await db.tasks.insert_one(doc)
            doc.pop("_id", None)
            created.append(doc)
            await log_activity(FAMILY_ID, cid, "task_created", {"title": payload.title, "points": payload.points, "date_key": dk})

    # Backward-compatible response: single copy keeps object shape; multi returns list.
    return created[0] if len(created) == 1 else {"broadcast_id": broadcast_id, "tasks": created, "count": len(created)}


@api.patch("/tasks/{task_id}")
async def update_task(task_id: str, payload: TaskUpdate, user: dict = Depends(require_parent)):
    task = await db.tasks.find_one({"id": task_id, "parent_id": FAMILY_ID})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Fields the parent is allowed to explicitly clear (set back to empty).
    clearable = {"due_date", "due_time", "duration_minutes", "task_style"}
    raw = payload.model_dump(exclude_unset=True)

    updates = {}
    for k, v in raw.items():
        if v is not None:
            updates[k] = v
        elif k in clearable:
            updates[k] = None  # explicit clear

    if "due_time" in updates and updates["due_time"] is not None:
        updates["due_time"] = validate_due_time(updates["due_time"])

    # Editing a member of a broadcast group forks it: this child's copy becomes
    # independent (loses broadcast_id) so the parent can customize just this one
    # while the siblings stay as they were. Matches the requested template behavior.
    if updates and task.get("broadcast_id"):
        updates["broadcast_id"] = None

    if updates:
        await db.tasks.update_one({"id": task_id}, {"$set": updates})
    return await db.tasks.find_one({"id": task_id}, {"_id": 0})


@api.delete("/tasks/{task_id}")
async def delete_task(task_id: str, user: dict = Depends(require_parent)):
    # Idempotent: deleting a task that's already gone (double-click, stale list)
    # is not an error — the desired end state ("task doesn't exist") is met.
    await db.tasks.delete_one({"id": task_id, "parent_id": FAMILY_ID})
    return {"success": True}


@api.get("/children/{child_id}/day-progress")
async def child_day_progress(
    child_id: str,
    date_key: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Snapshot of one child's daily quest progress for a specific date.
    Used both by the kid (own progress) and the parent (monitoring)."""
    await get_child_or_404(FAMILY_ID, child_id)
    dk = validate_date_key(date_key) or _today_key()

    tasks = await db.tasks.find(
        {"parent_id": FAMILY_ID, "date_key": dk,
         "$or": [{"child_id": child_id}, {"is_coop": True, "coop_participants": child_id}]},
        {"_id": 0},
    ).to_list(500)
    tasks.sort(key=lambda t: (bool(t.get("is_bonus")), t.get("order") or 0))

    config = await db.app_config.find_one({"parent_id": FAMILY_ID}) or {}

    required = [t for t in tasks if not t.get("is_bonus")]
    bonus = [t for t in tasks if t.get("is_bonus")]

    def earned(bucket):
        return sum(_child_share_of_task(t, child_id) for t in bucket if t.get("status") in ("completed", "approved"))

    required_earned = earned(required)
    bonus_earned = earned(bonus)
    total_earned = required_earned + bonus_earned

    # Daily goal is DYNAMIC: the sum of the day's required-task points. That way
    # the target always reflects the actual work assigned for the day. If no
    # required tasks exist for the day, fall back to the configured default so
    # the progress card still shows something sensible.
    required_total = sum(t.get("points", 0) for t in required)
    # Goal priority:
    #   1. Explicit per-weekday minimum target set by parent (Senin=X, etc.)
    #   2. Dynamic: sum of the day's required-task points
    #   3. Configured global default
    weekday_goals = config.get("weekday_goals") or {}
    try:
        wd = str(datetime.strptime(dk, "%Y-%m-%d").weekday())  # "0".."6"
    except Exception:
        wd = None
    if wd is not None and weekday_goals.get(wd) is not None:
        daily_goal = int(weekday_goals[wd])
    elif required_total > 0:
        daily_goal = required_total
    else:
        daily_goal = int(config.get("daily_point_goal", 50))

    finished_required = sum(1 for t in required if t.get("status") in ("completed", "approved", "skipped"))
    perfect_day = len(required) > 0 and finished_required == len(required)
    perfect_claim = await db.perfect_day_claims.find_one({"child_id": child_id, "date_key": dk})

    return {
        "child_id": child_id,
        "date_key": dk,
        "daily_goal": daily_goal,
        "required_total": required_total,
        "required_earned": required_earned,
        "bonus_earned": bonus_earned,
        "total_earned": total_earned,
        "goal_met": total_earned >= daily_goal,
        "goal_percent": min(100, int((total_earned / daily_goal) * 100)) if daily_goal else 100,
        "required_count": len(required),
        "required_done": finished_required,
        "bonus_count": len(bonus),
        "vacation_mode": bool(config.get("vacation_mode", False)),
        "perfect_day": perfect_day,
        "perfect_day_claimed": bool(perfect_claim),
        "tasks": tasks,
    }


@api.post("/children/{child_id}/claim-perfect-day")
async def claim_perfect_day(child_id: str, user: dict = Depends(get_current_user)):
    """Mystery Box: if every required mission for TODAY is done, the kid can
    open one surprise bonus (small random points) — once per day. Not a
    gambling mechanic, just a little unexpected delight for a fully productive
    day. Only the child themselves can claim their own box."""
    if user["role"] == "child" and user["id"] != child_id:
        raise HTTPException(status_code=403, detail="Ini bukan kotak misterimu")
    await get_child_or_404(FAMILY_ID, child_id)

    today = _today_key()
    already = await db.perfect_day_claims.find_one({"child_id": child_id, "date_key": today})
    if already:
        raise HTTPException(status_code=400, detail="Kotak misteri hari ini sudah dibuka")

    tasks = await db.tasks.find({
        "parent_id": FAMILY_ID, "date_key": today, "is_bonus": {"$ne": True},
        "$or": [{"child_id": child_id}, {"is_coop": True, "coop_participants": child_id}],
    }, {"_id": 0}).to_list(500)
    if not tasks:
        raise HTTPException(status_code=400, detail="Belum ada misi wajib hari ini")
    if any(t.get("status") not in ("completed", "approved", "skipped") for t in tasks):
        raise HTTPException(status_code=400, detail="Selesaikan semua misi wajib hari ini dulu")

    bonus = random.randint(2, 8)
    await db.children.update_one({"id": child_id}, {"$inc": {"points": bonus, "lifetime_points": bonus}})
    await db.perfect_day_claims.insert_one({
        "id": new_id(), "parent_id": FAMILY_ID, "child_id": child_id,
        "date_key": today, "bonus": bonus, "claimed_at": now_iso(),
    })
    await log_activity(FAMILY_ID, child_id, "perfect_day_claimed", {"bonus": bonus})
    return {"bonus": bonus}


PET_FEED_COST = 5  # feed currency consumed per "beri makan" tap


def _pet_is_dead(child: dict, config: dict) -> bool:
    """A pet 'passes away' from neglect if it hasn't been fed in
    `pet_neglect_days` (parent-configurable). Purely a lazy/derived check —
    computed fresh on every read rather than needing a background job, the
    same pattern as the weekly freeze-card refill. A child with no pet at all
    is not considered 'dead' (there's simply nothing to mourn yet)."""
    if not child.get("pet_type"):
        return False
    last_interaction = child.get("pet_last_fed_at") or child.get("pet_chosen_at")
    if not last_interaction:
        return False  # legacy data from before these timestamps existed — don't retroactively kill it
    try:
        last_dt = datetime.fromisoformat(last_interaction.replace("Z", "+00:00"))
    except Exception:
        return False
    days_since = (datetime.now(timezone.utc) - last_dt).days
    neglect_days = int(config.get("pet_neglect_days", 14))
    return days_since >= neglect_days


@api.post("/children/{child_id}/feed-pet")
async def feed_pet(child_id: str, user: dict = Depends(get_current_user)):
    """Kid taps 'Beri Makan' to feed their virtual pet — consumes feed_balance
    (earned alongside points on task approval at the family's configured
    rate), completely separate from the spendable points economy. Only the
    child themselves can feed their own pet. Feeding is also what keeps the
    pet alive — go too long without it and the pet passes away (see
    _pet_is_dead), after which it can't be fed until a new one is chosen."""
    if user["role"] == "child" and user["id"] != child_id:
        raise HTTPException(status_code=403, detail="Ini bukan hewan peliharaanmu")
    child = await get_child_or_404(FAMILY_ID, child_id)
    config = await db.app_config.find_one({"parent_id": FAMILY_ID}) or {}

    if not child.get("pet_type"):
        raise HTTPException(status_code=400, detail="Kamu belum punya peliharaan — pilih dulu ya!")
    if _pet_is_dead(child, config):
        raise HTTPException(status_code=400, detail="Peliharaanmu sudah pergi 💔 — pilih peliharaan baru untuk mulai lagi.")

    feed_cost = int(config.get("feed_cost_per_meal", PET_FEED_COST))
    balance = int(child.get("feed_balance", 0))
    if balance < feed_cost:
        raise HTTPException(status_code=400, detail=f"Butuh {feed_cost} pakan untuk memberi makan — selesaikan misi dulu ya!")

    await db.children.update_one(
        {"id": child_id},
        {"$inc": {"feed_balance": -feed_cost, "pet_feed_count": 1}, "$set": {"pet_last_fed_at": now_iso()}},
    )
    await log_activity(FAMILY_ID, child_id, "pet_fed", {"cost": feed_cost})
    updated = await db.children.find_one({"id": child_id}, {"_id": 0})
    return {
        "feed_balance": updated.get("feed_balance", 0),
        "feed_lifetime": updated.get("feed_lifetime", 0),
        "pet_feed_count": updated.get("pet_feed_count", 0),
    }


@api.get("/children/{child_id}/month-progress")
async def child_month_progress(
    child_id: str,
    year: int,
    month: int = Query(ge=1, le=12),
    user: dict = Depends(get_current_user),
):
    """Calendar-heatmap data: per-day earned points & goal status for a whole month.
    Lighter than looping day-progress — aggregates directly from the tasks collection."""
    await get_child_or_404(FAMILY_ID, child_id)
    if not (1 <= month <= 12):
        raise HTTPException(status_code=422, detail="Bulan tidak valid")
    if not (2000 <= year <= 2100):
        raise HTTPException(status_code=422, detail="Tahun tidak valid")

    start_key = f"{year:04d}-{month:02d}-01"
    next_month = month + 1 if month < 12 else 1
    next_year = year if month < 12 else year + 1
    end_key = f"{next_year:04d}-{next_month:02d}-01"  # exclusive upper bound

    tasks = await db.tasks.find({
        "parent_id": FAMILY_ID,
        "date_key": {"$gte": start_key, "$lt": end_key},
        "$or": [{"child_id": child_id}, {"is_coop": True, "coop_participants": child_id}],
    }, {"_id": 0, "date_key": 1, "points": 1, "status": 1, "is_bonus": 1, "is_coop": 1, "coop_participants": 1, "child_id": 1}).to_list(5000)

    config = await db.app_config.find_one({"parent_id": FAMILY_ID}) or {}
    weekday_goals = config.get("weekday_goals") or {}
    default_goal = int(config.get("daily_point_goal", 50))

    by_day = {}
    for t in tasks:
        dk = t["date_key"]
        by_day.setdefault(dk, {"required": [], "bonus": []})
        (by_day[dk]["bonus"] if t.get("is_bonus") else by_day[dk]["required"]).append(t)

    days = {}
    for dk, buckets in by_day.items():
        req = buckets["required"]
        bon = buckets["bonus"]
        earned = sum(_child_share_of_task(t, child_id) for t in (req + bon) if t.get("status") in ("completed", "approved"))
        required_total = sum(t.get("points", 0) for t in req)
        try:
            wd = str(datetime.strptime(dk, "%Y-%m-%d").weekday())
        except Exception:
            wd = None
        if wd is not None and weekday_goals.get(wd) is not None:
            goal = int(weekday_goals[wd])
        elif required_total > 0:
            goal = required_total
        else:
            goal = default_goal
        days[dk] = {
            "earned": earned,
            "goal": goal,
            "goal_met": earned >= goal if goal else True,
            "percent": min(100, int((earned / goal) * 100)) if goal else 100,
            "task_count": len(req) + len(bon),
        }

    return {"child_id": child_id, "year": year, "month": month, "days": days}


@api.get("/family/day-progress")
async def family_day_progress(
    date_key: Optional[str] = None,
    user: dict = Depends(require_parent),
):
    """One-shot summary of every child's day, for the parent dashboard."""
    dk = validate_date_key(date_key) or _today_key()
    kids = await db.children.find({"parent_id": FAMILY_ID}, {"_id": 0}).to_list(100)
    out = []
    for k in kids:
        # Reuse the per-child computation
        summary = await child_day_progress(k["id"], dk, user)  # type: ignore[arg-type]
        out.append({"child": {
            "id": k["id"],
            "name": k["name"],
            "avatar_emoji": k.get("avatar_emoji"),
            "avatar_color": k.get("avatar_color"),
            "mbti": k.get("mbti"),
            "quest_theme": k.get("quest_theme"),
            "points": k.get("points", 0),
        }, **summary})
    return {"date_key": dk, "children": out}


async def get_next_actionable_task(child_id: str, date_key: Optional[str] = None) -> Optional[dict]:
    """The lowest-order task still blocking today's quest line for this child.
    Bonus tasks (is_bonus=True) don't block."""
    query = {"child_id": child_id, "status": {"$in": ["pending", "rejected"]}, "is_bonus": {"$ne": True}}
    if date_key:
        query["date_key"] = date_key
    open_tasks = await db.tasks.find(query).sort("order", 1).to_list(1)
    return open_tasks[0] if open_tasks else None


def _now_local():
    """Family wall-clock (GMT+7)."""
    return datetime.now(timezone.utc) + timedelta(hours=7)


FREEZE_CARDS_PER_WEEK = 3  # default "Kartu Bebas" weekly allotment; now overridable per-family via config


def _current_week_key(reset_weekday: int = 0) -> str:
    """Identifier for the current freeze-card cycle. The cycle is a 7-day
    window that rolls over on `reset_weekday` (0=Mon..6=Sun). We compute it as
    the date of the most recent reset weekday, so changing the reset day shifts
    the boundary cleanly without cards ever accumulating."""
    now = _now_local()
    # days since the most recent reset weekday (Python weekday(): Mon=0..Sun=6)
    delta = (now.weekday() - reset_weekday) % 7
    cycle_start = (now - timedelta(days=delta)).strftime("%Y-%m-%d")
    return f"cycle:{cycle_start}"


async def _freeze_config() -> tuple:
    """(per_week, reset_weekday) from app config, with sane fallbacks."""
    cfg = await db.app_config.find_one({"parent_id": FAMILY_ID}) or {}
    per_week = int(cfg.get("freeze_cards_per_week", FREEZE_CARDS_PER_WEEK))
    reset_weekday = int(cfg.get("freeze_reset_weekday", 0))
    return per_week, reset_weekday


def _refill_freeze_card_if_new_week(child: dict, per_week: int = FREEZE_CARDS_PER_WEEK, reset_weekday: int = 0) -> int:
    """How many 'Kartu Bebas' this child has available RIGHT NOW, accounting
    for the weekly refill. Does not write to the DB — the caller folds the
    (possibly refilled, possibly about-to-be-consumed) count into its own
    $set. Config-driven allotment + reset day."""
    current_week = _current_week_key(reset_weekday)
    stored_week = child.get("freeze_card_week")
    if stored_week != current_week:
        return per_week  # new cycle — fresh allotment, never carries over unused cards
    # Clamp to the configured max in case the parent lowered the allotment mid-cycle.
    return min(int(child.get("freeze_cards_available", per_week)), per_week)


def _assert_child_owns_task(user: dict, task: dict):
    """A child may only act on their own tasks — or, for a co-op task, any task
    they're listed as a participant in. Parents bypass this (they call these
    endpoints far less often, but nothing stops a parent from testing as a kid)."""
    if user["role"] != "child":
        return
    if task.get("is_coop"):
        if user["id"] not in (task.get("coop_participants") or []):
            raise HTTPException(status_code=403, detail="Ini bukan misimu")
    elif task.get("child_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Ini bukan misimu")


@api.post("/tasks/{task_id}/start")
async def start_task_timer(task_id: str, user: dict = Depends(get_current_user)):
    """Kid clicks Start → records timer_started_at. A required task can be
    started any time on its OWN day, as long as it's the next one in sequence
    (bonuses can be started any time and never block the sequence). We no longer
    gate on the due_time 'window' — kids may work ahead of schedule. Overshooting
    the due_time turns the task time-stuck (rescued via Kartu Bebas / skip),
    handled separately at finish time."""
    task = await db.tasks.find_one({"id": task_id, "parent_id": FAMILY_ID})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    _assert_child_owns_task(user, task)
    if task["status"] not in ("pending", "rejected"):
        raise HTTPException(status_code=400, detail="Misi tidak bisa dimulai")

    # Can only act on tasks for today — not past or future days.
    date_key = task.get("date_key")
    if date_key:
        today = _now_local().strftime("%Y-%m-%d")
        if date_key < today:
            raise HTTPException(status_code=409, detail="Misi ini sudah lewat harinya")
        if date_key > today:
            raise HTTPException(status_code=409, detail="Misi ini belum waktunya (hari yang akan datang)")

    # Required tasks must be the next in line; bonuses are free to start anytime.
    if not task.get("is_bonus"):
        nxt = await get_next_actionable_task(task["child_id"], task.get("date_key"))
        if nxt and nxt["id"] != task_id:
            raise HTTPException(
                status_code=409,
                detail=f"Selesaikan dulu misi sebelumnya: \"{nxt['title']}\"",
            )

    await db.tasks.update_one({"id": task_id}, {"$set": {"timer_started_at": now_iso()}})
    return await db.tasks.find_one({"id": task_id}, {"_id": 0})


class TaskCompleteInput(BaseModel):
    photo_url: Optional[str] = None
    done_together: Optional[bool] = None  # answers the "was this done together?" prompt, when applicable


class TaskApproveInput(BaseModel):
    # A short note and/or voice clip (base64 data URL, same pattern as photo
    # proof) the parent can attach when approving — a little personal
    # encouragement alongside the automatic points.
    encouragement_message: Optional[str] = Field(default=None, max_length=300)
    encouragement_voice_url: Optional[str] = None


def _check_duration_not_exceeded(task):
    """If the task has a duration and a running timer, block Finish once that
    duration has elapsed since Start — mirrors the frontend's disabled-button
    behavior so a direct API call can't bypass it. The kid's way forward once
    overdue is Skip (still available), not a late Finish."""
    started = task.get("timer_started_at")
    duration = task.get("duration_minutes")
    if not started or not duration:
        return  # no duration set, or timer never started — nothing to enforce
    try:
        start_dt = datetime.fromisoformat(started.replace("Z", "+00:00"))
    except Exception:
        return
    now = datetime.now(timezone.utc) if start_dt.tzinfo else datetime.utcnow()
    elapsed_min = (now - start_dt).total_seconds() / 60
    if elapsed_min > duration:
        raise HTTPException(
            status_code=409,
            detail=f"Waktu {duration} menit sudah habis — lewati misi ini untuk lanjut ke misi berikutnya.",
        )


@api.post("/tasks/{task_id}/complete")
async def complete_task(task_id: str, payload: TaskCompleteInput = TaskCompleteInput(), user: dict = Depends(get_current_user)):
    """Kid marks a task complete → awaits parent approval. Treasure-hunt rule:
    only the next non-bonus task in the day's sequence can be completed.
    If the task requires a photo, one must be attached to complete it."""
    task = await db.tasks.find_one({"id": task_id, "parent_id": FAMILY_ID})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    _assert_child_owns_task(user, task)
    if task["status"] not in ("pending", "rejected"):
        raise HTTPException(status_code=400, detail="Task cannot be completed in current state")

    if not task.get("is_bonus"):
        nxt = await get_next_actionable_task(task["child_id"], task.get("date_key"))
        if nxt and nxt["id"] != task_id:
            raise HTTPException(
                status_code=409,
                detail=f"Selesaikan dulu misi sebelumnya: \"{nxt['title']}\" (atau lewati dengan poin)",
            )

    _check_duration_not_exceeded(task)

    if task.get("photo_required") and not payload.photo_url:
        raise HTTPException(status_code=422, detail="Misi ini butuh foto sebagai bukti sebelum selesai")

    if task.get("together_bonus_enabled") and payload.done_together is None:
        raise HTTPException(status_code=422, detail="Jawab dulu: apakah misi ini dilakukan bersama?")

    await db.tasks.update_one(
        {"id": task_id},
        {"$set": {
            "status": "completed", "completed_at": now_iso(), "timer_completed_at": now_iso(),
            "completion_photo_url": payload.photo_url,
            "coop_completed_by": user["id"] if task.get("is_coop") else task.get("coop_completed_by"),
            "done_together": payload.done_together if task.get("together_bonus_enabled") else None,
        }},
    )
    await log_activity(FAMILY_ID, task["child_id"], "task_completed", {"task_id": task_id, "title": task["title"]})
    config_for_notify = await db.app_config.find_one({"parent_id": FAMILY_ID}) or {}
    if config_for_notify.get("instant_task_notifications"):
        child = await db.children.find_one({"id": task["child_id"]})
        child_name = child["name"] if child else "Anak"
        await send_push_to(
            {"role": "parent"},
            title=f"{child_name} menyelesaikan misi! 🎉",
            body=f'"{task["title"]}" menunggu untuk dicek dan disetujui.',
            url="/parent",
        )
    return await db.tasks.find_one({"id": task_id}, {"_id": 0})


def _task_is_time_stuck(task: dict) -> bool:
    """True when a REQUIRED task is blocked purely by time running out — either
    (a) the kid started it but the duration elapsed before they could finish,
    or (b) they never started it and the due_time window has already closed.
    This is exactly the situation 'Kartu Bebas' (Freeze Card) exists to rescue
    — as opposed to a kid simply not wanting to do a task that's still well
    within its window, which is what the points-cost Skip is for."""
    started = task.get("timer_started_at")
    duration = task.get("duration_minutes")
    if started and duration:
        try:
            start_dt = datetime.fromisoformat(started.replace("Z", "+00:00"))
            now_utc = datetime.now(timezone.utc) if start_dt.tzinfo else datetime.utcnow()
            elapsed_min = (now_utc - start_dt).total_seconds() / 60
            if elapsed_min > duration:
                return True
        except Exception:
            pass
    due_time = task.get("due_time")
    if due_time and not started:
        try:
            now_local = _now_local()
            dh, dm = map(int, due_time.split(":"))
            if now_local.hour * 60 + now_local.minute > dh * 60 + dm:
                return True
        except Exception:
            pass
    return False


@api.post("/tasks/{task_id}/skip")
async def skip_task(task_id: str, user: dict = Depends(get_current_user)):
    """Pay points to skip a blocking task and unlock the next one."""
    task = await db.tasks.find_one({"id": task_id, "parent_id": FAMILY_ID})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    _assert_child_owns_task(user, task)
    if task["status"] not in ("pending", "rejected"):
        raise HTTPException(status_code=400, detail="Only open tasks can be skipped")

    # Bonus tasks (including co-op, which are always bonus) aren't part of the
    # required sequence, so they can be skipped any time — matches the same
    # exemption complete_task already has. Only required tasks must be "next".
    if not task.get("is_bonus"):
        nxt = await get_next_actionable_task(task["child_id"], task.get("date_key"))
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


@api.post("/tasks/{task_id}/free-with-card")
async def free_task_with_card(task_id: str, user: dict = Depends(get_current_user)):
    """'Kartu Bebas' as a stuck-task rescue: when a required task's Finish
    button is disabled because time ran out (either mid-timer or the window
    closed before it was ever started), this unblocks the sequence for free —
    spending a weekly freeze card instead of the usual points-cost Skip. Only
    usable when the task is genuinely time-stuck, not as a free shortcut
    around a task the kid simply hasn't gotten to yet."""
    task = await db.tasks.find_one({"id": task_id, "parent_id": FAMILY_ID})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    _assert_child_owns_task(user, task)
    if task["status"] not in ("pending", "rejected"):
        raise HTTPException(status_code=400, detail="Hanya misi yang masih aktif yang bisa dibebaskan")
    if task.get("is_bonus"):
        raise HTTPException(status_code=422, detail="Misi bonus tidak menghalangi urutan — tidak perlu kartu bebas")

    nxt = await get_next_actionable_task(task["child_id"], task.get("date_key"))
    if nxt and nxt["id"] != task_id:
        raise HTTPException(status_code=409, detail="Hanya misi terdepan yang bisa dibebaskan")

    if not _task_is_time_stuck(task):
        raise HTTPException(status_code=422, detail="Misi ini belum macet karena waktu — masih bisa dikerjakan atau dilewati dengan poin")

    child = await db.children.find_one({"id": task["child_id"]})
    if not child:
        raise HTTPException(status_code=404, detail="Child not found")

    per_week, reset_weekday = await _freeze_config()
    available = _refill_freeze_card_if_new_week(child, per_week, reset_weekday)
    if available < 1:
        raise HTTPException(status_code=400, detail="Kartu Bebas minggu ini sudah habis")

    current_week = _current_week_key(reset_weekday)
    prev_available = int(child.get("freeze_cards_available", per_week))
    prev_week = child.get("freeze_card_week")
    await db.children.update_one(
        {"id": child["id"]},
        {"$set": {"freeze_cards_available": available - 1, "freeze_card_week": current_week}},
    )
    await db.tasks.update_one(
        {"id": task_id},
        {"$set": {
            "status": "skipped", "completed_at": now_iso(), "freed_with_card": True,
            "_undo_free_prev_available": prev_available, "_undo_free_prev_week": prev_week,
        }},
    )
    await log_activity(FAMILY_ID, child["id"], "task_freed_with_card", {"task_id": task_id, "title": task["title"]})
    updated = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    return {"task": updated, "freeze_cards_available": available - 1}


@api.post("/tasks/{task_id}/undo-free-with-card")
async def undo_free_task_with_card(task_id: str, user: dict = Depends(require_parent)):
    """Reverses a mistaken 'bebaskan dengan kartu' tap — refunds the card and
    returns the task to pending. Parent-only, matching the other undo actions."""
    task = await db.tasks.find_one({"id": task_id, "parent_id": FAMILY_ID})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not task.get("freed_with_card"):
        raise HTTPException(status_code=400, detail="Misi ini tidak dibebaskan dengan kartu bebas")

    prev_available = task.get("_undo_free_prev_available", FREEZE_CARDS_PER_WEEK)
    prev_week = task.get("_undo_free_prev_week")
    await db.children.update_one(
        {"id": task["child_id"]},
        {"$set": {"freeze_cards_available": prev_available, "freeze_card_week": prev_week}},
    )
    await db.tasks.update_one(
        {"id": task_id},
        {
            "$set": {"status": "pending", "completed_at": None, "freed_with_card": False},
            "$unset": {"_undo_free_prev_available": "", "_undo_free_prev_week": ""},
        },
    )
    await log_activity(FAMILY_ID, task["child_id"], "task_freed_with_card_undone", {"task_id": task_id})
    return await db.tasks.find_one({"id": task_id}, {"_id": 0})


def _child_share_of_task(task: dict, child_id: str) -> int:
    """How many points THIS child actually earned from a task. For a normal
    task that's just task.points; for a co-op task the total is split evenly
    (remainder to the first few participants, matching the exact logic used
    at approval time), so reports don't double- or over-count a partner's share."""
    if not task.get("is_coop"):
        return task.get("points", 0)
    participants = task.get("coop_participants") or [task.get("child_id")]
    if child_id not in participants:
        return 0
    n = len(participants)
    base_share = task.get("points", 0) // n
    remainder = task.get("points", 0) - base_share * n
    idx = participants.index(child_id)
    return base_share + (1 if idx < remainder else 0)


def _early_completion_bonus(task: dict, base_points: int, config: dict) -> int:
    """Extra points for finishing a task BEFORE its due_time. Returns the bonus
    (rounded, at least 1 if the pct would round to 0 but is configured > 0), or
    0 when there's no due_time, no completion timestamp, it wasn't actually
    early, or the feature is turned off (early_bonus_pct == 0)."""
    pct = int(config.get("early_bonus_pct", 10))
    if pct <= 0:
        return 0
    due_time = task.get("due_time")
    completed_at = task.get("completed_at")
    date_key = task.get("date_key")
    if not due_time or not completed_at:
        return 0
    try:
        # completed_at is a UTC ISO string; convert to family local (GMT+7),
        # then compare against the due_time on the task's own local day.
        comp_dt = datetime.fromisoformat(completed_at.replace("Z", "+00:00"))
        if comp_dt.tzinfo:
            comp_local = comp_dt.astimezone(timezone.utc).replace(tzinfo=None) + timedelta(hours=7)
        else:
            comp_local = comp_dt + timedelta(hours=7)
        dh, dm = map(int, due_time.split(":"))
        base_date = date_key or comp_local.strftime("%Y-%m-%d")
        y, mo, d = map(int, base_date.split("-"))
        due_dt = comp_local.replace(year=y, month=mo, day=d, hour=dh, minute=dm, second=0, microsecond=0)
        if comp_local < due_dt:
            bonus = round(base_points * pct / 100)
            return max(bonus, 1) if base_points > 0 else 0
    except Exception:
        return 0
    return 0


async def _apply_approval_rewards(child_id: str, points: int, config: dict) -> dict:
    """Applies streak/freeze-card/Chikybank updates for ONE child earning
    `points` from an approval. Returns a snapshot describing exactly what
    changed, so a later undo can reverse precisely this — used for both the
    normal single-child path and, once per participant, for co-op tasks."""
    child = await db.children.find_one({"id": child_id})
    today = _today_key()
    yesterday = (_now_local() - timedelta(days=1)).strftime("%Y-%m-%d")
    last_date = child.get("last_completion_date")
    per_week = int(config.get("freeze_cards_per_week", FREEZE_CARDS_PER_WEEK))
    reset_weekday = int(config.get("freeze_reset_weekday", 0))
    current_week = _current_week_key(reset_weekday)
    prev_freeze_week = child.get("freeze_card_week")
    prev_freeze_available = int(child.get("freeze_cards_available", per_week))
    prev_streak = child.get("streak_days", 0)
    prev_last_completion = last_date

    used_freeze_card = False
    new_freeze_available = prev_freeze_available
    new_freeze_week = prev_freeze_week

    if last_date == today:
        streak = child.get("streak_days", 0)
    elif last_date == yesterday:
        streak = child.get("streak_days", 0) + 1
    else:
        available_now = _refill_freeze_card_if_new_week(child, per_week, reset_weekday)
        if prev_freeze_week != current_week:
            new_freeze_week = current_week
            new_freeze_available = available_now
        if available_now > 0:
            streak = child.get("streak_days", 0) + 1
            used_freeze_card = True
            new_freeze_available = available_now - 1
        else:
            streak = 1

    save_pct = int(config.get("chiky_save_pct", 40))
    spend_pct = int(config.get("chiky_spend_pct", 40))
    share_pct = int(config.get("chiky_share_pct", 20))
    total_pct = save_pct + spend_pct + share_pct or 100
    p_save = round(points * save_pct / total_pct)
    p_spend = round(points * spend_pct / total_pct)
    p_share = points - p_save - p_spend  # remainder goes to share to avoid rounding loss

    prev_best_streak = int(child.get("best_streak_days", 0))
    new_best_streak = max(prev_best_streak, streak)

    # Virtual pet "feed" currency — earned alongside points at the family's
    # configured rate (default 1:1), separate from the spendable points
    # economy (feeding never touches points).
    feed_earned = round(points * float(config.get("feed_per_point", 1)))

    await db.children.update_one(
        {"id": child_id},
        {
            "$inc": {
                "points": points, "lifetime_points": points, "tasks_completed": 1,
                "chiky_save": p_save, "chiky_spend": p_spend, "chiky_share": p_share,
                "feed_balance": feed_earned, "feed_lifetime": feed_earned,
            },
            "$set": {
                "last_completion_date": today, "streak_days": streak,
                "freeze_cards_available": new_freeze_available, "freeze_card_week": new_freeze_week,
                "best_streak_days": new_best_streak,
            },
        },
    )
    return {
        "child_id": child_id, "points": points,
        "chiky_save": p_save, "chiky_spend": p_spend, "chiky_share": p_share,
        "prev_streak": prev_streak, "prev_last_completion": prev_last_completion,
        "used_freeze_card": used_freeze_card,
        "prev_freeze_available": prev_freeze_available, "prev_freeze_week": prev_freeze_week,
        "prev_best_streak": prev_best_streak,
        "feed_earned": feed_earned,
    }


async def _spawn_recurrence_if_due(task: dict, config: dict) -> Optional[str]:
    """Shared recurrence-spawn logic (used by both normal and co-op approval
    paths). Returns the new task's id, or None if nothing was spawned."""
    if task["recurrence"] not in ("daily", "weekly") or config.get("vacation_mode"):
        return None
    delta_days = 1 if task["recurrence"] == "daily" else 7
    next_date_key = None
    if task.get("date_key"):
        try:
            base_day = datetime.strptime(task["date_key"], "%Y-%m-%d")
            next_date_key = (base_day + timedelta(days=delta_days)).strftime("%Y-%m-%d")
        except Exception:
            next_date_key = None
    if not next_date_key:
        next_date_key = (_now_local() + timedelta(days=delta_days)).strftime("%Y-%m-%d")

    next_due = None
    if task.get("due_date"):
        try:
            base = datetime.fromisoformat(task["due_date"].replace("Z", "+00:00"))
            next_due = (base + timedelta(days=delta_days)).isoformat()
        except Exception:
            next_due = None

    match_query = {
        "title": task["title"], "date_key": next_date_key,
        "recurrence": task["recurrence"], "status": {"$in": ["pending", "rejected"]},
    }
    if task.get("is_coop"):
        match_query["is_coop"] = True
        match_query["coop_participants"] = task.get("coop_participants")
    else:
        match_query["child_id"] = task["child_id"]

    existing = await db.tasks.find_one(match_query)
    if existing:
        return None

    spawned_id = new_id()
    new_task = {
        **{k: v for k, v in task.items() if k != "_id"},
        "id": spawned_id,
        "status": "pending",
        "completed_at": None,
        "approved_at": None,
        "due_date": next_due,
        "date_key": next_date_key,
        "timer_started_at": None,
        "timer_completed_at": None,
        "coop_completed_by": None,
        "completion_photo_url": None,  # was previously carried over from the just-approved instance — a fresh day shouldn't start with yesterday's photo already attached
        "done_together": None,  # same bug: a fresh day's "was this done together?" answer must start unset, not inherit yesterday's
        "freed_with_card": False,  # same reasoning — a fresh day hasn't been freed by anything yet
        "created_at": now_iso(),
    }
    await db.tasks.insert_one(new_task)
    return spawned_id


@api.post("/tasks/{task_id}/approve")
async def approve_task(task_id: str, payload: TaskApproveInput = TaskApproveInput(), user: dict = Depends(require_parent)):
    task = await db.tasks.find_one({"id": task_id, "parent_id": FAMILY_ID})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task["status"] != "completed":
        raise HTTPException(status_code=400, detail="Task must be completed first")

    if payload.encouragement_voice_url and len(payload.encouragement_voice_url) > 2_000_000:
        raise HTTPException(status_code=413, detail="Pesan suara terlalu besar (maks ~1.5MB)")

    config = await db.app_config.find_one({"parent_id": FAMILY_ID}) or {}

    if task.get("is_coop"):
        participants = task.get("coop_participants") or [task["child_id"]]
        for cid in participants:
            if not await db.children.find_one({"id": cid}):
                raise HTTPException(status_code=404, detail="Child not found")
        n = len(participants)
        base_share = task["points"] // n
        remainder = task["points"] - base_share * n
        snapshots = []
        for i, cid in enumerate(participants):
            share = base_share + (1 if i < remainder else 0)  # remainder spread across first few
            snap = await _apply_approval_rewards(cid, share, config)
            snapshots.append(snap)

        spawned_next_id = await _spawn_recurrence_if_due(task, config)

        await db.tasks.update_one(
            {"id": task_id},
            {"$set": {
                "status": "approved",
                "approved_at": now_iso(),
                "_undo_coop_snapshots": snapshots,
                "_undo_spawned_next_id": spawned_next_id,
                "encouragement_message": payload.encouragement_message,
                "encouragement_voice_url": payload.encouragement_voice_url,
            }},
        )
        new_badges = []
        for cid in participants:
            new_badges += await award_badges(FAMILY_ID, cid)
            await log_activity(FAMILY_ID, cid, "task_approved", {"task_id": task_id, "points": task["points"], "coop": True})
        if payload.encouragement_message or payload.encouragement_voice_url:
            for cid in participants:
                await send_push_to(
                    {"role": "child", "member_id": cid},
                    title="Ada pesan semangat untukmu! 💌",
                    body=payload.encouragement_message or "Dengarkan pesan suara dari orang tuamu!",
                    url=f"/kid/{cid}",
                )
        return {"task": await db.tasks.find_one({"id": task_id}, {"_id": 0}), "new_badges": new_badges}

    # --- Normal single-child path ---
    child = await db.children.find_one({"id": task["child_id"]})
    if not child:
        raise HTTPException(status_code=404, detail="Child not found")

    together_bonus_awarded = 0
    if task.get("together_bonus_enabled") and task.get("done_together") is True:
        together_bonus_awarded = task.get("together_bonus_points") or 0
    early_bonus_awarded = _early_completion_bonus(task, task["points"], config)
    points = task["points"] + together_bonus_awarded + early_bonus_awarded
    snap = await _apply_approval_rewards(task["child_id"], points, config)
    spawned_next_id = await _spawn_recurrence_if_due(task, config)

    await db.tasks.update_one(
        {"id": task_id},
        {
            "$set": {
                "status": "approved",
                "approved_at": now_iso(),
                # Snapshot needed to precisely reverse this approval later.
                "_undo_prev_streak": snap["prev_streak"],
                "_undo_prev_last_completion": snap["prev_last_completion"],
                "_undo_points_awarded": points,
                "early_bonus_awarded": early_bonus_awarded,
                "together_bonus_awarded": together_bonus_awarded,
                "_undo_chiky_save": snap["chiky_save"],
                "_undo_chiky_spend": snap["chiky_spend"],
                "_undo_chiky_share": snap["chiky_share"],
                "_undo_spawned_next_id": spawned_next_id,
                "_undo_used_freeze_card": snap["used_freeze_card"],
                "_undo_prev_freeze_available": snap["prev_freeze_available"],
                "_undo_prev_freeze_week": snap["prev_freeze_week"],
                "_undo_prev_best_streak": snap["prev_best_streak"],
                "_undo_feed_earned": snap["feed_earned"],
                "encouragement_message": payload.encouragement_message,
                "encouragement_voice_url": payload.encouragement_voice_url,
            }
        },
    )
    new_badges = await award_badges(FAMILY_ID, task["child_id"])
    await log_activity(FAMILY_ID, task["child_id"], "task_approved", {"task_id": task_id, "points": points})
    if payload.encouragement_message or payload.encouragement_voice_url:
        await send_push_to(
            {"role": "child", "member_id": task["child_id"]},
            title="Ada pesan semangat untukmu! 💌",
            body=payload.encouragement_message or "Dengarkan pesan suara dari orang tuamu!",
            url=f"/kid/{task['child_id']}",
        )
    return {"task": await db.tasks.find_one({"id": task_id}, {"_id": 0}), "new_badges": new_badges}


UNDO_WINDOW_MINUTES = 30


@api.post("/tasks/{task_id}/undo-approval")
async def undo_task_approval(task_id: str, user: dict = Depends(require_parent)):
    """Reverse a mistaken approval within a short window: refunds the points/Chikybank
    split, restores the previous streak, and removes the auto-spawned next
    occurrence if it's still untouched (so recurrence doesn't double up)."""
    task = await db.tasks.find_one({"id": task_id, "parent_id": FAMILY_ID})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task["status"] != "approved":
        raise HTTPException(status_code=400, detail="Hanya tugas yang sudah disetujui yang bisa dibatalkan")
    if not task.get("approved_at"):
        raise HTTPException(status_code=400, detail="Tidak ada catatan waktu persetujuan")

    approved_at = datetime.fromisoformat(task["approved_at"].replace("Z", "+00:00"))
    now = datetime.now(timezone.utc) if approved_at.tzinfo else datetime.utcnow()
    elapsed_min = (now - approved_at).total_seconds() / 60
    if elapsed_min > UNDO_WINDOW_MINUTES:
        raise HTTPException(status_code=409, detail=f"Batas waktu membatalkan sudah lewat ({UNDO_WINDOW_MINUTES} menit)")

    if task.get("is_coop"):
        snapshots = task.get("_undo_coop_snapshots") or []
        total_points = 0
        for snap in snapshots:
            await db.children.update_one(
                {"id": snap["child_id"]},
                {
                    "$inc": {
                        "points": -snap["points"], "lifetime_points": -snap["points"], "tasks_completed": -1,
                        "chiky_save": -snap["chiky_save"], "chiky_spend": -snap["chiky_spend"], "chiky_share": -snap["chiky_share"],
                        "feed_balance": -snap.get("feed_earned", 0), "feed_lifetime": -snap.get("feed_earned", 0),
                    },
                    "$set": {
                        "streak_days": snap["prev_streak"],
                        "last_completion_date": snap["prev_last_completion"],
                        "freeze_cards_available": snap["prev_freeze_available"],
                        "freeze_card_week": snap["prev_freeze_week"],
                        "best_streak_days": snap.get("prev_best_streak", 0),
                    },
                },
            )
            total_points += snap["points"]

        spawned_id = task.get("_undo_spawned_next_id")
        if spawned_id:
            spawned = await db.tasks.find_one({"id": spawned_id})
            if spawned and spawned.get("status") == "pending" and not spawned.get("timer_started_at"):
                await db.tasks.delete_one({"id": spawned_id})

        await db.tasks.update_one(
            {"id": task_id},
            {
                "$set": {"status": "completed", "approved_at": None},
                "$unset": {"_undo_coop_snapshots": "", "_undo_spawned_next_id": "", "encouragement_message": "", "encouragement_voice_url": ""},
            },
        )
        await log_activity(FAMILY_ID, task["child_id"], "task_approval_undone", {"task_id": task_id, "points_reversed": total_points, "coop": True})
        return await db.tasks.find_one({"id": task_id}, {"_id": 0})

    points = task.get("_undo_points_awarded", task.get("points", 0))
    p_save = task.get("_undo_chiky_save", 0)
    p_spend = task.get("_undo_chiky_spend", 0)
    p_share = task.get("_undo_chiky_share", 0)
    feed_earned = task.get("_undo_feed_earned", 0)

    await db.children.update_one(
        {"id": task["child_id"]},
        {
            "$inc": {
                "points": -points,
                "lifetime_points": -points,
                "tasks_completed": -1,
                "chiky_save": -p_save,
                "chiky_spend": -p_spend,
                "chiky_share": -p_share,
                "feed_balance": -feed_earned,
                "feed_lifetime": -feed_earned,
            },
            "$set": {
                "streak_days": task.get("_undo_prev_streak", 0),
                "last_completion_date": task.get("_undo_prev_last_completion"),
                "freeze_cards_available": task.get("_undo_prev_freeze_available", 1),
                "freeze_card_week": task.get("_undo_prev_freeze_week"),
                "best_streak_days": task.get("_undo_prev_best_streak", 0),
            },
        },
    )

    # Remove the auto-spawned next occurrence if it's still untouched (parent
    # hasn't started/edited it) — otherwise leave it alone to avoid clobbering
    # something the family already interacted with.
    spawned_id = task.get("_undo_spawned_next_id")
    if spawned_id:
        spawned = await db.tasks.find_one({"id": spawned_id})
        if spawned and spawned.get("status") == "pending" and not spawned.get("timer_started_at"):
            await db.tasks.delete_one({"id": spawned_id})

    await db.tasks.update_one(
        {"id": task_id},
        {
            "$set": {"status": "completed", "approved_at": None},
            "$unset": {
                "_undo_prev_streak": "", "_undo_prev_last_completion": "",
                "_undo_points_awarded": "", "_undo_chiky_save": "", "_undo_chiky_spend": "",
                "_undo_chiky_share": "", "_undo_spawned_next_id": "",
                "_undo_used_freeze_card": "", "_undo_prev_freeze_available": "", "_undo_prev_freeze_week": "",
                "_undo_prev_best_streak": "",
                "_undo_feed_earned": "",
                "encouragement_message": "", "encouragement_voice_url": "",
            },
        },
    )
    await log_activity(FAMILY_ID, task["child_id"], "task_approval_undone", {"task_id": task_id, "points_reversed": points})
    return await db.tasks.find_one({"id": task_id}, {"_id": 0})


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
    if task["status"] not in ("pending", "rejected"):
        # Without this guard, calling /miss twice (double-tap, retry after a
        # slow network response) would deduct the penalty a second time.
        raise HTTPException(status_code=400, detail="Misi ini sudah diproses — tidak bisa ditandai terlewat lagi")
    penalty = task.get("penalty_points", 0)
    if penalty > 0:
        await db.children.update_one({"id": task["child_id"]}, {"$inc": {"points": -penalty}})
    await db.tasks.update_one({"id": task_id}, {"$set": {"status": "missed", "_undo_miss_penalty": penalty}})
    await log_activity(FAMILY_ID, task["child_id"], "task_missed", {"task_id": task_id, "penalty": penalty})
    return await db.tasks.find_one({"id": task_id}, {"_id": 0})


@api.post("/tasks/{task_id}/undo-miss")
async def undo_task_missed(task_id: str, user: dict = Depends(require_parent)):
    """Reverses a mistaken 'Terlewat' tap: refunds the penalty and returns the
    task to pending so it's actionable again. No time window — unlike undoing
    an approval (which affects streak/freeze-card state that only makes sense
    to unwind quickly), a missed-task correction is safe to make anytime."""
    task = await db.tasks.find_one({"id": task_id, "parent_id": FAMILY_ID})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task["status"] != "missed":
        raise HTTPException(status_code=400, detail="Hanya misi berstatus 'Terlewat' yang bisa dibatalkan")
    penalty = task.get("_undo_miss_penalty", task.get("penalty_points", 0))
    if penalty > 0:
        await db.children.update_one({"id": task["child_id"]}, {"$inc": {"points": penalty}})
    await db.tasks.update_one(
        {"id": task_id},
        {"$set": {"status": "pending"}, "$unset": {"_undo_miss_penalty": ""}},
    )
    await log_activity(FAMILY_ID, task["child_id"], "task_missed_undone", {"task_id": task_id, "penalty_refunded": penalty})
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
# Default level ladder — mirrors what was previously hardcoded on the
# frontend (frontend/src/lib/levels.js), now just the starting point for a
# family's own editable config.
_DEFAULT_LEVEL_TITLES = [
    {"title": "Pemula", "emoji": "🌱", "min_xp": 0},
    {"title": "Petualang", "emoji": "🧭", "min_xp": 50},
    {"title": "Ksatria Muda", "emoji": "🗡️", "min_xp": 150},
    {"title": "Ksatria Madya", "emoji": "⚔️", "min_xp": 350},
    {"title": "Ksatria Utama", "emoji": "🛡️", "min_xp": 700},
    {"title": "Pahlawan", "emoji": "🦸", "min_xp": 1200},
    {"title": "Pahlawan Legendaris", "emoji": "👑", "min_xp": 2000},
    {"title": "Juara Sejati", "emoji": "🏅", "min_xp": 3500},
    {"title": "Master Misi", "emoji": "🌟", "min_xp": 6000},
    {"title": "Legenda Keluarga", "emoji": "💫", "min_xp": 10000},
]

# Default pet growth-stage labels & thresholds — mirrors what was previously
# hardcoded (frontend/src/lib/pets.js STAGE_NAMES + the 0.25/0.6 ratios),
# now editable per family via app_config.
_DEFAULT_PET_STAGE_NAMES = ["Telur", "Bayi", "Remaja", "Dewasa"]
_DEFAULT_PET_STAGE_THRESHOLDS = [0.25, 0.6]
# Feeds needed to reach Bayi / Remaja / Dewasa. Growth is feed-count driven.
_DEFAULT_PET_FEED_THRESHOLDS = [3, 8, 15]


@api.post("/config")
async def set_app_config(payload: AppConfigInput, user: dict = Depends(require_parent)):
    config_doc = await db.app_config.find_one({"parent_id": FAMILY_ID})
    if config_doc:
        update_data = {k: v for k, v in payload.model_dump().items() if v is not None}
        # Merge dict-typed fields so partial updates don't wipe existing keys.
        for dict_field in ("custom_labels", "weekday_goals"):
            if dict_field in update_data:
                merged = dict(config_doc.get(dict_field) or {})
                merged.update(update_data[dict_field])
                # Drop keys explicitly set to None (allows clearing a single label)
                merged = {k: v for k, v in merged.items() if v is not None}
                update_data[dict_field] = merged
        if update_data:
            await db.app_config.update_one({"parent_id": FAMILY_ID}, {"$set": update_data})
    else:
        # First-ever config write for this family: start from the same defaults
        # get_app_config uses, then apply whatever the payload actually sent.
        # (Previously this branch only copied a handful of legacy fields, so
        # anything added later — vacation_mode, Chikybank split, weekday_goals,
        # custom_labels, background image — would be silently dropped if it
        # happened to be the very first settings change a family ever made.)
        defaults = {
            "app_name": "My Lil Famz",
            "default_theme": "clean",
            "slideshow_background_url": "",
            "slideshow_background_image": "",
            "rupiah_per_point": 100,
            "skip_cost_points": 20,
            "daily_point_goal": 50,
            "weekday_goals": {},
            "chiky_save_pct": 40,
            "chiky_spend_pct": 40,
            "chiky_share_pct": 20,
            "early_bonus_pct": 10,
            "freeze_cards_per_week": FREEZE_CARDS_PER_WEEK,
            "freeze_reset_weekday": 0,
            "custom_labels": {},
            "vacation_mode": False,
            "vacation_note": "",
            "instant_task_notifications": False,
            "language": "id",
            "level_titles": _DEFAULT_LEVEL_TITLES,
            "feed_per_point": 1,
            "feed_cost_per_meal": 5,
            "pet_neglect_days": 14,
            "pet_stage_names": _DEFAULT_PET_STAGE_NAMES,
            "pet_stage_thresholds": _DEFAULT_PET_STAGE_THRESHOLDS,
            "pet_stage_feed_thresholds": _DEFAULT_PET_FEED_THRESHOLDS,
        }
        incoming = {k: v for k, v in payload.model_dump().items() if v is not None}
        config = {"id": new_id(), "parent_id": FAMILY_ID, "created_at": now_iso(), **defaults, **incoming}
        await db.app_config.insert_one(config)
    await log_activity(FAMILY_ID, None, "config_updated", {"changes": payload.model_dump()})
    return {"success": True}


class MaintenanceToggleInput(BaseModel):
    enabled: bool
    message: str = Field(default="", max_length=300)


@api.get("/maintenance-status")
async def maintenance_status():
    """Public, unauthenticated — lets the frontend show a friendly 'app is
    paused' screen even for someone who isn't logged in (or whose session just
    got locked out), without needing a valid token first."""
    config = await db.app_config.find_one({"parent_id": FAMILY_ID}) or {}
    return {
        "enabled": bool(config.get("maintenance_mode")),
        "message": config.get("maintenance_message") or "Aplikasi sedang nonaktif sementara. Hubungi orang tua untuk info lebih lanjut.",
    }


@api.post("/maintenance/toggle")
async def toggle_maintenance(payload: MaintenanceToggleInput, user: dict = Depends(require_parent)):
    """Turn maintenance mode on/off. Turning it ON locks out every account
    EXCEPT the parent who just turned it on (recorded automatically) — so
    whoever flips the switch keeps access, everyone else (other parent, both
    kids) is blocked from their very next request until it's turned back off."""
    updates = {"maintenance_mode": payload.enabled, "maintenance_message": payload.message}
    if payload.enabled:
        updates["maintenance_exempt_member_id"] = user["id"]
        updates["maintenance_enabled_by_name"] = user.get("name", "")
        updates["maintenance_enabled_at"] = now_iso()
    else:
        updates["maintenance_exempt_member_id"] = None
    existing = await db.app_config.find_one({"parent_id": FAMILY_ID})
    if existing:
        await db.app_config.update_one({"parent_id": FAMILY_ID}, {"$set": updates})
    else:
        await db.app_config.insert_one({"id": new_id(), "parent_id": FAMILY_ID, "created_at": now_iso(), **updates})
    await log_activity(FAMILY_ID, None, "maintenance_toggled", {"enabled": payload.enabled, "by": user.get("name")})
    return {"success": True, "enabled": payload.enabled}


@api.get("/config")
async def get_app_config(user: dict = Depends(get_current_user)):
    config = await db.app_config.find_one({"parent_id": FAMILY_ID})
    if not config:
        return {
            "app_name": "My Lil Famz",
            "default_theme": "clean",
            "slideshow_background_url": "",
            "slideshow_background_image": "",
            "rupiah_per_point": 100,
            "skip_cost_points": 20,
            "daily_point_goal": 50,
            "weekday_goals": {},
            "chiky_save_pct": 40,
            "chiky_spend_pct": 40,
            "chiky_share_pct": 20,
            "early_bonus_pct": 10,
            "freeze_cards_per_week": FREEZE_CARDS_PER_WEEK,
            "freeze_reset_weekday": 0,
            "custom_labels": {},
            "vacation_mode": False,
            "vacation_note": "",
            "instant_task_notifications": False,
            "language": "id",
            "level_titles": _DEFAULT_LEVEL_TITLES,
            "feed_per_point": 1,
            "feed_cost_per_meal": 5,
            "pet_neglect_days": 14,
            "pet_stage_names": _DEFAULT_PET_STAGE_NAMES,
            "pet_stage_thresholds": _DEFAULT_PET_STAGE_THRESHOLDS,
            "pet_stage_feed_thresholds": _DEFAULT_PET_FEED_THRESHOLDS,
        }
    return {
        "app_name": config.get("app_name", "My Lil Famz"),
        "default_theme": config.get("default_theme", "clean"),
        "slideshow_background_url": config.get("slideshow_background_url", ""),
        "slideshow_background_image": config.get("slideshow_background_image", ""),
        "rupiah_per_point": int(config.get("rupiah_per_point", 100)),
        "skip_cost_points": int(config.get("skip_cost_points", 20)),
        "daily_point_goal": int(config.get("daily_point_goal", 50)),
        "weekday_goals": config.get("weekday_goals", {}) or {},
        "chiky_save_pct": int(config.get("chiky_save_pct", 40)),
        "chiky_spend_pct": int(config.get("chiky_spend_pct", 40)),
        "chiky_share_pct": int(config.get("chiky_share_pct", 20)),
        "early_bonus_pct": int(config.get("early_bonus_pct", 10)),
        "freeze_cards_per_week": int(config.get("freeze_cards_per_week", FREEZE_CARDS_PER_WEEK)),
        "freeze_reset_weekday": int(config.get("freeze_reset_weekday", 0)),
        "maintenance_mode": bool(config.get("maintenance_mode", False)),
        "maintenance_message": config.get("maintenance_message", ""),
        "maintenance_enabled_by_name": config.get("maintenance_enabled_by_name", ""),
        "maintenance_enabled_at": config.get("maintenance_enabled_at"),
        "custom_labels": config.get("custom_labels", {}) or {},
        "vacation_mode": bool(config.get("vacation_mode", False)),
        "vacation_note": config.get("vacation_note", ""),
        "instant_task_notifications": bool(config.get("instant_task_notifications", False)),
        "language": config.get("language", "id"),
        "level_titles": config.get("level_titles") or _DEFAULT_LEVEL_TITLES,
        "feed_per_point": int(config.get("feed_per_point", 1)),
        "feed_cost_per_meal": int(config.get("feed_cost_per_meal", 5)),
        "pet_neglect_days": int(config.get("pet_neglect_days", 14)),
        "pet_stage_names": config.get("pet_stage_names") or _DEFAULT_PET_STAGE_NAMES,
        "pet_stage_thresholds": config.get("pet_stage_thresholds") or _DEFAULT_PET_STAGE_THRESHOLDS,
        "pet_stage_feed_thresholds": config.get("pet_stage_feed_thresholds") or _DEFAULT_PET_FEED_THRESHOLDS,
    }


# --------------- Child Profile Photo (Stage 3) ---------------
class ProfilePhotoInput(BaseModel):
    photo_url: Optional[str] = None


@api.post("/children/{child_id}/profile-photo")
async def set_child_profile_photo(child_id: str, payload: ProfilePhotoInput, user: dict = Depends(get_current_user)):
    child = await get_child_or_404(FAMILY_ID, child_id)
    await db.children.update_one({"id": child_id}, {"$set": {"profile_photo_url": payload.photo_url}})
    await log_activity(FAMILY_ID, child_id, "profile_photo_updated", {"child_name": child["name"]})
    return {"success": True, "photo_url": payload.photo_url}


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
    # Idempotent — see delete_task.
    await db.reminders.delete_one({"id": reminder_id, "parent_id": FAMILY_ID})
    return {"success": True}


@api.post("/reminders/{reminder_id}/toggle")
async def toggle_reminder(reminder_id: str, user: dict = Depends(require_parent)):
    reminder = await db.reminders.find_one({"id": reminder_id, "parent_id": FAMILY_ID})
    if not reminder:
        raise HTTPException(status_code=404, detail="Reminder not found")
    new_state = not reminder.get("enabled", True)
    await db.reminders.update_one({"id": reminder_id}, {"$set": {"enabled": new_state}})
    return {"success": True, "enabled": new_state}


# --------------- Routine Templates (parent-editable) ---------------
@api.get("/routine-templates")
async def list_routine_templates(user: dict = Depends(get_current_user)):
    """The 5 starter templates are seeded into this family's own editable
    collection on first access — after that, they're just rows the parent
    can rename, retask, or delete like anything else they create."""
    existing_count = await db.routine_templates.count_documents({"parent_id": FAMILY_ID})
    if existing_count == 0:
        for tpl in _DEFAULT_ROUTINE_TEMPLATES:
            await db.routine_templates.insert_one({
                "id": new_id(), "parent_id": FAMILY_ID,
                "label": tpl["label"], "emoji": tpl["emoji"], "desc": tpl["desc"],
                "tasks": tpl["tasks"], "created_at": now_iso(),
            })
    templates = await db.routine_templates.find({"parent_id": FAMILY_ID}, {"_id": 0}).sort("created_at", 1).to_list(100)
    return templates


@api.post("/routine-templates")
async def create_routine_template(payload: RoutineTemplateInput, user: dict = Depends(require_parent)):
    doc = {
        "id": new_id(), "parent_id": FAMILY_ID,
        "label": payload.label, "emoji": payload.emoji, "desc": payload.desc,
        "tasks": [t.model_dump() for t in payload.tasks],
        "created_at": now_iso(),
    }
    await db.routine_templates.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.patch("/routine-templates/{template_id}")
async def update_routine_template(template_id: str, payload: RoutineTemplateInput, user: dict = Depends(require_parent)):
    existing = await db.routine_templates.find_one({"id": template_id, "parent_id": FAMILY_ID})
    if not existing:
        raise HTTPException(status_code=404, detail="Template not found")
    await db.routine_templates.update_one(
        {"id": template_id},
        {"$set": {
            "label": payload.label, "emoji": payload.emoji, "desc": payload.desc,
            "tasks": [t.model_dump() for t in payload.tasks],
        }},
    )
    return await db.routine_templates.find_one({"id": template_id}, {"_id": 0})


@api.delete("/routine-templates/{template_id}")
async def delete_routine_template(template_id: str, user: dict = Depends(require_parent)):
    await db.routine_templates.delete_one({"id": template_id, "parent_id": FAMILY_ID})  # idempotent
    return {"success": True}


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
        "image": payload.image or "",
        "created_at": now_iso(),
    }
    await db.rewards.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.patch("/rewards/{reward_id}")
async def update_reward(reward_id: str, payload: RewardUpdate, user: dict = Depends(require_parent)):
    """Edit an existing reward in place (name / description / cost / icon).
    Changing the cost only affects FUTURE redemptions — points already spent
    on past redemptions are untouched, matching parents' mental model of
    'this is what it costs from now on'."""
    reward = await db.rewards.find_one({"id": reward_id, "parent_id": FAMILY_ID})
    if not reward:
        raise HTTPException(status_code=404, detail="Reward not found")
    # description can legitimately be cleared to ""; only name/cost/icon are
    # skipped when None (unset). exclude_unset lets us tell "sent empty" apart
    # from "not sent at all".
    raw = payload.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None}
    if updates:
        await db.rewards.update_one({"id": reward_id}, {"$set": updates})
    return await db.rewards.find_one({"id": reward_id}, {"_id": 0})


@api.delete("/rewards/{reward_id}")
async def delete_reward(reward_id: str, user: dict = Depends(require_parent)):
    # Idempotent — see delete_task.
    await db.rewards.delete_one({"id": reward_id, "parent_id": FAMILY_ID})
    return {"success": True}


# --------------- Reward Suggestions (kid proposes, parent reviews) ---------------
@api.post("/reward-suggestions")
async def suggest_reward(payload: RewardSuggestionInput, user: dict = Depends(get_current_user)):
    """A kid proposes something they'd like added to the reward shop. Parents
    review and either approve (creating the real reward) or reject it."""
    if user["role"] != "child":
        raise HTTPException(status_code=422, detail="Hanya anak yang bisa mengusulkan hadiah")
    doc = {
        "id": new_id(), "parent_id": FAMILY_ID, "child_id": user["id"],
        "name": payload.name, "description": payload.description,
        "suggested_cost_points": payload.suggested_cost_points,
        "status": "pending", "review_note": "",
        "created_at": now_iso(), "reviewed_at": None,
    }
    await db.reward_suggestions.insert_one(doc)
    doc.pop("_id", None)
    await send_push_to({"role": "parent"}, title="Usulan hadiah baru! 🎁", body=f'{user["name"]} mengusulkan "{payload.name}"', url="/parent")
    return doc


@api.get("/reward-suggestions")
async def list_reward_suggestions(user: dict = Depends(get_current_user)):
    query = {"parent_id": FAMILY_ID}
    if user["role"] == "child":
        query["child_id"] = user["id"]  # kids only see their own suggestions
    items = await db.reward_suggestions.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
    return items


@api.post("/reward-suggestions/{suggestion_id}/approve")
async def approve_reward_suggestion(suggestion_id: str, payload: RewardSuggestionReview, user: dict = Depends(require_parent)):
    sug = await db.reward_suggestions.find_one({"id": suggestion_id, "parent_id": FAMILY_ID})
    if not sug:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    if sug["status"] != "pending":
        raise HTTPException(status_code=400, detail="Usulan ini sudah diproses")
    cost = payload.cost_points or sug.get("suggested_cost_points")
    if not cost:
        raise HTTPException(status_code=422, detail="Tentukan harga poin untuk hadiah ini")

    reward_doc = {
        "id": new_id(), "parent_id": FAMILY_ID, "name": sug["name"],
        "description": sug.get("description", ""), "cost_points": cost,
        "icon": "gift", "created_at": now_iso(),
    }
    await db.rewards.insert_one(reward_doc)
    await db.reward_suggestions.update_one(
        {"id": suggestion_id},
        {"$set": {"status": "approved", "review_note": payload.note, "reviewed_at": now_iso(), "created_reward_id": reward_doc["id"]}},
    )
    await send_push_to({"role": "child", "member_id": sug["child_id"]}, title="Usulan hadiahmu diterima! 🎉", body=f'"{sug["name"]}" sekarang ada di toko hadiah.', url=f"/kid/{sug['child_id']}")
    reward_doc.pop("_id", None)
    return {"suggestion": await db.reward_suggestions.find_one({"id": suggestion_id}, {"_id": 0}), "reward": reward_doc}


@api.post("/reward-suggestions/{suggestion_id}/reject")
async def reject_reward_suggestion(suggestion_id: str, payload: RewardSuggestionReview, user: dict = Depends(require_parent)):
    sug = await db.reward_suggestions.find_one({"id": suggestion_id, "parent_id": FAMILY_ID})
    if not sug:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    if sug["status"] != "pending":
        raise HTTPException(status_code=400, detail="Usulan ini sudah diproses")
    await db.reward_suggestions.update_one(
        {"id": suggestion_id},
        {"$set": {"status": "rejected", "review_note": payload.note, "reviewed_at": now_iso()}},
    )
    await send_push_to({"role": "child", "member_id": sug["child_id"]}, title="Tentang usulan hadiahmu", body=payload.note or f'"{sug["name"]}" belum bisa disetujui kali ini.', url=f"/kid/{sug['child_id']}")
    return await db.reward_suggestions.find_one({"id": suggestion_id}, {"_id": 0})


@api.delete("/reward-suggestions/{suggestion_id}")
async def delete_reward_suggestion(suggestion_id: str, user: dict = Depends(get_current_user)):
    """A kid can withdraw their own still-pending suggestion; a parent can
    clean up any suggestion regardless of status."""
    query = {"id": suggestion_id, "parent_id": FAMILY_ID}
    if user["role"] == "child":
        query["child_id"] = user["id"]
        query["status"] = "pending"
    await db.reward_suggestions.delete_one(query)  # idempotent
    return {"success": True}


@api.post("/rewards/{reward_id}/redeem")
async def redeem_reward(reward_id: str, child_id: str, user: dict = Depends(get_current_user)):
    if user["role"] == "child" and user["id"] != child_id:
        raise HTTPException(status_code=403, detail="Kamu hanya bisa menukar untuk dirimu sendiri")
    reward = await db.rewards.find_one({"id": reward_id, "parent_id": FAMILY_ID})
    if not reward:
        raise HTTPException(status_code=404, detail="Reward not found")
    child = await get_child_or_404(FAMILY_ID, child_id)
    cost = reward["cost_points"]
    # Rewards are bought from the SAVINGS (Tabungan) bucket — that's the pot
    # earmarked for "things you're saving up for". We deduct from both the
    # savings bucket and the headline points total (which is the sum of all
    # three buckets) to keep them consistent.
    if child.get("chiky_save", 0) < cost:
        raise HTTPException(status_code=400, detail="Tabungan belum cukup untuk menukar hadiah ini")
    await db.children.update_one({"id": child_id}, {"$inc": {"points": -cost, "chiky_save": -cost}})
    redemption = {
        "id": new_id(),
        "parent_id": FAMILY_ID,
        "child_id": child_id,
        "reward_id": reward_id,
        "reward_name": reward["name"],
        "cost_points": cost,
        "status": "pending",  # pending -> fulfilled
        "created_at": now_iso(),
        "fulfilled_at": None,
    }
    await db.redemptions.insert_one(redemption)
    redemption.pop("_id", None)
    await log_activity(FAMILY_ID, child_id, "reward_redeemed", {"reward": reward["name"], "cost": cost})
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


@api.post("/redemptions/{redemption_id}/cancel")
async def cancel_redemption(redemption_id: str, user: dict = Depends(require_parent)):
    """Cancel a pending reward redemption and refund the cost back into the
    child's Tabungan (savings) bucket — the same pot it was spent from."""
    red = await db.redemptions.find_one({"id": redemption_id, "parent_id": FAMILY_ID})
    if not red:
        raise HTTPException(status_code=404, detail="Redemption not found")
    if red["status"] != "pending":
        raise HTTPException(status_code=400, detail="Penukaran ini sudah diproses")
    cost = red.get("cost_points", 0)
    await db.children.update_one({"id": red["child_id"]}, {"$inc": {"points": cost, "chiky_save": cost}})
    await db.redemptions.update_one({"id": redemption_id}, {"$set": {"status": "cancelled"}})
    await log_activity(FAMILY_ID, red["child_id"], "reward_redemption_cancelled", {"cost": cost})
    return {"success": True}


# --------------- Reward Wishlist ---------------
class WishlistInput(BaseModel):
    reward_id: str


@api.post("/wishlist")
async def add_wishlist_item(payload: WishlistInput, user: dict = Depends(get_current_user)):
    """A kid marks a reward as something they're saving up for. Parents can add
    on a kid's behalf too (e.g. helping a younger child set a goal)."""
    reward = await db.rewards.find_one({"id": payload.reward_id, "parent_id": FAMILY_ID})
    if not reward:
        raise HTTPException(status_code=404, detail="Reward not found")
    child_id = user["id"] if user["role"] == "child" else None
    if not child_id:
        raise HTTPException(status_code=422, detail="Tentukan anak (parent tidak punya wishlist sendiri)")
    existing = await db.wishlist_items.find_one({"parent_id": FAMILY_ID, "child_id": child_id, "reward_id": payload.reward_id})
    if existing:
        existing.pop("_id", None)
        return existing  # idempotent: already wishlisted, return as-is
    doc = {
        "id": new_id(), "parent_id": FAMILY_ID, "child_id": child_id,
        "reward_id": payload.reward_id, "created_at": now_iso(),
    }
    await db.wishlist_items.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/wishlist")
async def list_wishlist(child_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = {"parent_id": FAMILY_ID}
    if user["role"] == "child":
        query["child_id"] = user["id"]  # kids only ever see their own wishlist
    elif child_id:
        query["child_id"] = child_id
    items = await db.wishlist_items.find(query, {"_id": 0}).to_list(200)

    # Enrich with reward + progress info so the frontend doesn't need a second round-trip.
    config = await db.app_config.find_one({"parent_id": FAMILY_ID}) or {}
    daily_goal = int(config.get("daily_point_goal", 50))
    save_pct = int(config.get("chiky_save_pct", 40))
    spend_pct = int(config.get("chiky_spend_pct", 40))
    share_pct = int(config.get("chiky_share_pct", 20))
    total_pct = (save_pct + spend_pct + share_pct) or 100
    # Expected savings earned per day if the child hits their daily point goal —
    # used to estimate "about N days to go". Deterministic and easy to explain
    # (no dependency on messy historical data).
    expected_daily_savings = daily_goal * save_pct / total_pct

    out = []
    for item in items:
        reward = await db.rewards.find_one({"id": item["reward_id"], "parent_id": FAMILY_ID}, {"_id": 0})
        if not reward:
            continue  # reward was deleted since being wishlisted; skip silently
        child = await db.children.find_one({"id": item["child_id"], "parent_id": FAMILY_ID}, {"_id": 0})
        # Rewards are bought from Tabungan (savings), so progress is measured
        # against the savings bucket, not the headline points total.
        savings = child.get("chiky_save", 0) if child else 0
        cost = reward["cost_points"]
        percent = min(100, int((savings / cost) * 100)) if cost else 100
        remaining = max(0, cost - savings)
        days_estimate = None
        if remaining > 0 and expected_daily_savings > 0:
            days_estimate = math.ceil(remaining / expected_daily_savings)
        out.append({
            **item, "reward": reward, "current_points": savings,
            "percent": percent, "goal_met": savings >= cost,
            "remaining": remaining, "days_estimate": days_estimate,
        })
    return out


@api.delete("/wishlist/{item_id}")
async def remove_wishlist_item(item_id: str, user: dict = Depends(get_current_user)):
    query = {"id": item_id, "parent_id": FAMILY_ID}
    if user["role"] == "child":
        query["child_id"] = user["id"]  # kids can only remove their own wishlist entries
    await db.wishlist_items.delete_one(query)  # idempotent
    return {"success": True}


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


@api.patch("/consequences/{consequence_id}")
async def update_consequence(consequence_id: str, payload: ConsequenceUpdate, user: dict = Depends(require_parent)):
    """Edit an existing consequence (name / description / deduction). Editing
    the deduction affects only FUTURE applications — points already deducted
    from past applications stay as they were."""
    cons = await db.consequences.find_one({"id": consequence_id, "parent_id": FAMILY_ID})
    if not cons:
        raise HTTPException(status_code=404, detail="Consequence not found")
    raw = payload.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None}
    if updates:
        await db.consequences.update_one({"id": consequence_id}, {"$set": updates})
    return await db.consequences.find_one({"id": consequence_id}, {"_id": 0})


@api.delete("/consequences/{consequence_id}")
async def delete_consequence(consequence_id: str, user: dict = Depends(require_parent)):
    # Idempotent — see delete_task.
    await db.consequences.delete_one({"id": consequence_id, "parent_id": FAMILY_ID})
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


@api.get("/push/vapid-public-key")
async def get_vapid_public_key():
    """Public: the VAPID public key browsers need to create a push subscription.
    Empty string if the server doesn't have push notifications configured yet —
    frontend should treat that as 'feature unavailable' rather than erroring."""
    return {"key": os.environ.get("VAPID_PUBLIC_KEY", "")}


# --------------- Push Notifications (Stage 4) ---------------
@api.post("/push/subscribe")
async def subscribe_to_push(payload: PushSubscriptionInput, user: dict = Depends(get_current_user)):
    """Subscribe to push notifications. Tagged with member_id/role so server-sent
    notifications (task completed, mission reminders) can target the right people."""
    endpoint = payload.subscription.get("endpoint")
    # Replace any existing subscription for this exact endpoint+member (re-subscribe
    # after permission reset shouldn't create duplicates).
    await db.push_subscriptions.delete_many({"parent_id": FAMILY_ID, "subscription.endpoint": endpoint})
    sub_doc = {
        "id": new_id(),
        "parent_id": FAMILY_ID,
        "member_id": user["id"],
        "role": user["role"],
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


def _vapid_configured() -> bool:
    return bool(os.environ.get("VAPID_PRIVATE_KEY") and os.environ.get("VAPID_PUBLIC_KEY"))


async def send_push_to(query: dict, title: str, body: str, url: str = "/"):
    """Best-effort push send to every subscription matching `query`. Silently
    no-ops if VAPID keys aren't configured (feature simply stays off), and
    prunes subscriptions the browser has invalidated (410/404 responses)."""
    if not _vapid_configured():
        return
    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        return  # pywebpush not installed in this environment
    subs = await db.push_subscriptions.find({"parent_id": FAMILY_ID, **query}, {"_id": 0}).to_list(200)
    payload = json.dumps({"title": title, "body": body, "url": url})
    for s in subs:
        try:
            webpush(
                subscription_info=s["subscription"],
                data=payload,
                vapid_private_key=os.environ["VAPID_PRIVATE_KEY"],
                vapid_claims={"sub": os.environ.get("VAPID_CONTACT_EMAIL", "mailto:admin@example.com")},
            )
        except WebPushException as e:
            status_code = getattr(e.response, "status_code", None)
            if status_code in (404, 410):
                await db.push_subscriptions.delete_one({"subscription.endpoint": s["subscription"].get("endpoint")})
        except Exception:
            pass  # never let a notification failure break the calling request


@api.get("/badge-count")
async def get_badge_count(user: dict = Depends(get_current_user)):
    """Count to show on the PWA home-screen icon badge (navigator.setAppBadge).
    True native widgets aren't available to web PWAs — this is the closest
    equivalent: parents see tasks awaiting approval, kids see today's open misi."""
    if user["role"] == "parent":
        count = await db.tasks.count_documents({"parent_id": FAMILY_ID, "status": "completed"})
    else:
        today = _today_key()
        count = await db.tasks.count_documents({
            "parent_id": FAMILY_ID, "child_id": user["id"], "date_key": today,
            "status": {"$in": ["pending", "rejected"]},
        })
    return {"count": count}


CRON_SECRET_ENV = "CRON_SECRET"


@api.get("/cron/send-reminders")
async def cron_send_reminders(request: Request):
    """Scheduled job (Vercel Cron) — pushes a reminder to a kid when one of
    their time-boxed missions is starting soon. Protected by comparing the
    Authorization header against CRON_SECRET; Vercel injects this header
    automatically for its own Cron Job calls when that env var is set, so the
    secret never needs to appear in vercel.json (which is committed to the repo)."""
    expected = os.environ.get(CRON_SECRET_ENV)
    auth_header = request.headers.get("authorization", "")
    if not expected or auth_header != f"Bearer {expected}":
        raise HTTPException(status_code=403, detail="Invalid or missing cron secret")

    now = _now_local()
    today = now.strftime("%Y-%m-%d")
    now_min = now.hour * 60 + now.minute

    candidates = await db.tasks.find({
        "parent_id": FAMILY_ID, "date_key": today, "status": {"$in": ["pending", "rejected"]},
        "due_time": {"$ne": None},
    }, {"_id": 0}).to_list(500)

    sent = 0
    for t in candidates:
        try:
            dh, dm = map(int, t["due_time"].split(":"))
        except Exception:
            continue
        due_min = dh * 60 + dm
        # Fire once, in the 10-minute window starting 15 minutes before due_time.
        if 5 <= (due_min - now_min) <= 15:
            await send_push_to(
                {"role": "child", "member_id": t["child_id"]},
                title="Sebentar lagi waktunya! ⏰",
                body=f'"{t["title"]}" harus dimulai sebelum jam {t["due_time"]}.',
                url=f"/kid/{t['child_id']}",
            )
            sent += 1
    return {"checked": len(candidates), "reminders_sent": sent}


@api.get("/cron/send-digest")
async def cron_send_digest(request: Request):
    """Scheduled job (same GitHub Actions runner as reminders, called every 15
    min) — sends a morning 'here's today's missions' digest and an evening
    'here's how today went' summary to parents, ONCE each per day, instead of
    a push for every single task completion (which gets spammy with an active
    kid). Guarded by CRON_SECRET the same way /cron/send-reminders is, and by
    a digest_log entry so repeated 15-min cron ticks within the same hour
    don't send the same digest multiple times."""
    expected = os.environ.get(CRON_SECRET_ENV)
    auth_header = request.headers.get("authorization", "")
    if not expected or auth_header != f"Bearer {expected}":
        raise HTTPException(status_code=403, detail="Invalid or missing cron secret")

    now = _now_local()
    today = now.strftime("%Y-%m-%d")
    sent = []
    kids = await db.children.find({"parent_id": FAMILY_ID}, {"_id": 0}).to_list(50)

    if now.hour == 7 and not await db.digest_log.find_one({"date_key": today, "type": "morning"}):
        lines = []
        for k in kids:
            count = await db.tasks.count_documents({
                "parent_id": FAMILY_ID, "date_key": today, "status": {"$in": ["pending", "rejected"]},
                "is_bonus": {"$ne": True},
                "$or": [{"child_id": k["id"]}, {"is_coop": True, "coop_participants": k["id"]}],
            })
            if count:
                lines.append(f"{k['name']}: {count} misi")
        if lines:
            await send_push_to(
                {"role": "parent"}, title="Misi hari ini ☀️",
                body=", ".join(lines), url="/parent",
            )
        await db.digest_log.insert_one({"date_key": today, "type": "morning", "sent_at": now_iso()})
        sent.append("morning")

    if now.hour == 20 and not await db.digest_log.find_one({"date_key": today, "type": "evening"}):
        lines = []
        for k in kids:
            required = await db.tasks.count_documents({
                "parent_id": FAMILY_ID, "date_key": today, "is_bonus": {"$ne": True},
                "$or": [{"child_id": k["id"]}, {"is_coop": True, "coop_participants": k["id"]}],
            })
            done = await db.tasks.count_documents({
                "parent_id": FAMILY_ID, "date_key": today, "is_bonus": {"$ne": True},
                "status": {"$in": ["approved", "completed", "skipped"]},
                "$or": [{"child_id": k["id"]}, {"is_coop": True, "coop_participants": k["id"]}],
            })
            pct = int((done / required) * 100) if required else 100
            lines.append(f"{k['name']} {pct}%")
        pending_approval = await db.tasks.count_documents({"parent_id": FAMILY_ID, "status": "completed"})
        body = ", ".join(lines)
        if pending_approval:
            body += f" — {pending_approval} menunggu dicek"
        await send_push_to(
            {"role": "parent"}, title="Rangkuman hari ini 🌙",
            body=body, url="/parent",
        )
        await db.digest_log.insert_one({"date_key": today, "type": "evening", "sent_at": now_iso()})
        sent.append("evening")

    # Streak warning — fires an hour after the parent's evening digest, so kids
    # get one last gentle nudge before bedtime if their daily goal isn't met
    # yet. Only sent to kids who actually have something left to do (skips
    # anyone with zero required missions today) and phrases the streak framing
    # only when they actually have a streak worth protecting.
    if now.hour == 21 and not await db.digest_log.find_one({"date_key": today, "type": "streak_warning"}):
        for k in kids:
            required = await db.tasks.count_documents({
                "parent_id": FAMILY_ID, "date_key": today, "is_bonus": {"$ne": True},
                "$or": [{"child_id": k["id"]}, {"is_coop": True, "coop_participants": k["id"]}],
            })
            if not required:
                continue
            done = await db.tasks.count_documents({
                "parent_id": FAMILY_ID, "date_key": today, "is_bonus": {"$ne": True},
                "status": {"$in": ["approved", "completed", "skipped"]},
                "$or": [{"child_id": k["id"]}, {"is_coop": True, "coop_participants": k["id"]}],
            })
            if done >= required:
                continue  # goal already met, nothing to warn about
            streak = k.get("streak_days", 0)
            body = (
                f"Sayang banget kalau streak {streak} harimu putus — yuk selesaikan misi yang tersisa!"
                if streak > 0 else
                "Masih ada misi yang belum selesai hari ini — yuk selesaikan sebelum tidur!"
            )
            await send_push_to(
                {"role": "child", "member_id": k["id"]},
                title="Sebentar lagi malam nih! 🌙", body=body, url=f"/kid/{k['id']}",
            )
        await db.digest_log.insert_one({"date_key": today, "type": "streak_warning", "sent_at": now_iso()})
        sent.append("streak_warning")

    return {"sent": sent}


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
    """Delete an achievement (idempotent — see delete_task)."""
    await db.achievements.delete_one({
        "id": achievement_id,
        "parent_id": FAMILY_ID
    })
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
        {"id": new_id(), "name": "Syila", "role": "child", "age": 8, "avatar_emoji": "🦋", "avatar_color": "#F472B6", "mbti": "ENFJ-T"},
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
            "best_streak_days": 0,
            "last_completion_date": None,
            "tasks_completed": 0,
            "freeze_cards_available": FREEZE_CARDS_PER_WEEK,
            "freeze_card_week": None,
            "pet_type": None,
            "pet_chosen_at": None,
            "pet_last_fed_at": None,
            "pet_feed_count": 0,
            "feed_balance": 0,
            "feed_lifetime": 0,
            "pet_equipped": [],
            "created_at": ts,
        })


async def migrate_existing_data():
    """Idempotent backfills for databases seeded by earlier versions.

    Guarded by a persisted schema-version marker: the expensive collection-wide
    sweeps below only run when the DB hasn't yet been migrated to the current
    version. On serverless this matters a lot — without the marker, every cold
    container would re-scan every task/child even though there's nothing left
    to backfill, which is the main source of 'every menu loads slowly'."""
    SCHEMA_VERSION = 4
    marker = await db.app_config.find_one({"_schema_marker": True})
    if marker and int(marker.get("schema_version", 0)) >= SCHEMA_VERSION:
        return  # already migrated — skip all the sweeps entirely

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
    #    Syila was briefly seeded as ESFJ-T; correct her to ENFJ-T.
    await db.children.update_many({"name": "Syila", "mbti": "ESFJ-T"}, {"$set": {"mbti": "ENFJ-T"}})
    await db.members.update_many({"name": "Syila", "role": "child", "mbti": "ESFJ-T"}, {"$set": {"mbti": "ENFJ-T"}})

    mbti_by_name = {"Adskhan": "INTJ-T", "Syila": "ENFJ-T"}
    for name, mbti in mbti_by_name.items():
        await db.children.update_many(
            {"name": name, "$or": [{"mbti": {"$exists": False}}, {"mbti": None}]},
            {"$set": {"mbti": mbti}},
        )
        await db.members.update_many(
            {"name": name, "role": "child", "$or": [{"mbti": {"$exists": False}}, {"mbti": None}]},
            {"$set": {"mbti": mbti}},
        )

    # 4. Ensure new task fields exist on older tasks.
    await db.tasks.update_many(
        {"due_time": {"$exists": False}}, {"$set": {"due_time": None}}
    )
    await db.tasks.update_many(
        {"duration_minutes": {"$exists": False}}, {"$set": {"duration_minutes": None}}
    )
    await db.tasks.update_many(
        {"is_bonus": {"$exists": False}}, {"$set": {"is_bonus": False}}
    )
    await db.tasks.update_many(
        {"broadcast_id": {"$exists": False}}, {"$set": {"broadcast_id": None}}
    )
    await db.tasks.update_many(
        {"timer_started_at": {"$exists": False}}, {"$set": {"timer_started_at": None, "timer_completed_at": None}}
    )
    # date_key backfill: derive from created_at, else from due_date, else today.
    async for t in db.tasks.find({"date_key": {"$in": [None, ""]}}, {"id": 1, "created_at": 1, "due_date": 1}):
        dk = None
        for src in (t.get("due_date"), t.get("created_at")):
            if src and isinstance(src, str) and len(src) >= 10:
                dk = src[:10]
                break
        if not dk:
            dk = _today_key()
        await db.tasks.update_one({"id": t["id"]}, {"$set": {"date_key": dk}})
    await db.tasks.update_many(
        {"date_key": {"$exists": False}}, {"$set": {"date_key": _today_key()}}
    )

    # 5. Rebrand: "piggy bank" split fields renamed to "Chikybank" (chiky_*).
    #    Copy any pre-existing values across so nobody's saved balance vanishes
    #    just because we renamed the feature. Safe to run repeatedly — once the
    #    chiky_* field exists, the $exists filter skips that document.
    async for child in db.children.find(
        {"$or": [{"piggy_save": {"$exists": True}}, {"piggy_spend": {"$exists": True}}, {"piggy_share": {"$exists": True}}],
         "chiky_save": {"$exists": False}},
        {"id": 1, "piggy_save": 1, "piggy_spend": 1, "piggy_share": 1},
    ):
        await db.children.update_one(
            {"id": child["id"]},
            {"$set": {
                "chiky_save": child.get("piggy_save", 0),
                "chiky_spend": child.get("piggy_spend", 0),
                "chiky_share": child.get("piggy_share", 0),
            }},
        )
    async for cfg in db.app_config.find(
        {"$or": [{"piggy_save_pct": {"$exists": True}}, {"piggy_spend_pct": {"$exists": True}}, {"piggy_share_pct": {"$exists": True}}],
         "chiky_save_pct": {"$exists": False}},
        {"id": 1, "piggy_save_pct": 1, "piggy_spend_pct": 1, "piggy_share_pct": 1},
    ):
        await db.app_config.update_one(
            {"id": cfg["id"]},
            {"$set": {
                "chiky_save_pct": cfg.get("piggy_save_pct", 40),
                "chiky_spend_pct": cfg.get("piggy_spend_pct", 40),
                "chiky_share_pct": cfg.get("piggy_share_pct", 20),
            }},
        )

    # 6. Personal-best streak: backfill from the current streak so an existing
    #    12-day streak doesn't suddenly show "best: 0" the day this shipped.
    async for child in db.children.find({"best_streak_days": {"$exists": False}}, {"id": 1, "streak_days": 1}):
        await db.children.update_one(
            {"id": child["id"]},
            {"$set": {"best_streak_days": int(child.get("streak_days", 0))}},
        )

    # 7. Freeze cards + virtual pet: any child doc predating these features
    #    (including the originally-seeded family, which built its children
    #    mirror by hand before these fields existed) gets sane defaults so
    #    `"field" in child` checks and raw API responses are complete rather
    #    than relying entirely on .get()-with-default everywhere.
    await db.children.update_many(
        {"freeze_cards_available": {"$exists": False}},
        {"$set": {"freeze_cards_available": FREEZE_CARDS_PER_WEEK, "freeze_card_week": None}},
    )
    # The freeze-card cycle key format changed (ISO-week → reset-weekday cycle).
    # Clear the stored week marker so everyone gets a clean, correctly-formatted
    # refill on their next check rather than trying to match an old-format key.
    await db.children.update_many(
        {"freeze_card_week": {"$not": {"$regex": "^cycle:"}}},
        {"$set": {"freeze_card_week": None}},
    )
    await db.children.update_many(
        {"pet_type": {"$exists": False}},
        {"$set": {"pet_type": None, "feed_balance": 0, "feed_lifetime": 0}},
    )
    await db.children.update_many(
        {"pet_equipped": {"$exists": False}},
        {"$set": {"pet_equipped": []}},
    )
    await db.children.update_many(
        {"pet_feed_count": {"$exists": False}},
        {"$set": {"pet_feed_count": 0}},
    )
    # Existing pets (chosen before permanence/death tracking existed) get a
    # "chosen now" timestamp so they're not incorrectly considered neglected —
    # this is idempotent (only touches docs missing the field, never overwrites).
    await db.children.update_many(
        {"pet_type": {"$ne": None}, "pet_chosen_at": {"$exists": False}},
        {"$set": {"pet_chosen_at": now_iso(), "pet_last_fed_at": now_iso()}},
    )
    await db.children.update_many(
        {"pet_type": None, "pet_chosen_at": {"$exists": False}},
        {"$set": {"pet_chosen_at": None, "pet_last_fed_at": None}},
    )

    # Stamp the schema marker so future cold starts skip all of the above.
    await db.app_config.update_one(
        {"_schema_marker": True},
        {"$set": {"_schema_marker": True, "schema_version": 4, "parent_id": "__schema_marker__"}},
        upsert=True,
    )


# --------------- Startup ---------------
# On Vercel's serverless runtime the ASGI app is imported fresh per cold
# container, and FastAPI's startup event fires each time a new container boots.
# Index creation + seeding + the (potentially collection-wide) migration are
# expensive, so we must never run them more than once per container, and we
# must never let them block or re-run on warm requests. This guard ensures the
# heavy init runs exactly once per process lifetime; a failure won't wedge the
# app (it logs and lets requests proceed — indexes/migrations are best-effort
# backfills, not correctness-critical for a running server).
_init_done = False
_init_lock = asyncio.Lock()


async def _run_one_time_init():
    global _init_done
    if _init_done:
        return
    async with _init_lock:
        if _init_done:  # double-checked after acquiring the lock
            return
        try:
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
            await db.pet_reset_requests.create_index([("parent_id", 1), ("status", 1)])
            await seed_default_family()
            await migrate_existing_data()
        except Exception as e:  # noqa: BLE001 — never let init crash request handling
            logging.getLogger("uvicorn.error").warning("one-time init skipped: %s", e)
        finally:
            _init_done = True


@app.on_event("startup")
async def startup():
    # Kick off init in the background so the container can start serving
    # immediately; the first request won't block on migrations.
    await _run_one_time_init()


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


app.include_router(api)


@app.middleware("http")
async def ensure_initialized(request: Request, call_next):
    # Vercel's serverless ASGI adapter doesn't always fire FastAPI's startup
    # lifespan event, which would leave indexes uncreated (→ slow collection
    # scans). This runs the guarded one-time init on the first request to a
    # fresh container; the _init_done flag makes every subsequent request a
    # no-op, so there's no per-request cost once warm.
    if not _init_done:
        await _run_one_time_init()
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)
