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
from typing import List, Optional, Literal, Dict

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, status, Query
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator


# --------------- Setup ---------------
mongo_url = os.environ["MONGO_URL"]
def _make_client(url: str) -> AsyncIOMotorClient:
    """Connection settings tuned for a serverless host.

    A cold container pays for DNS, TLS and auth before it can answer anything,
    and the defaults are built for long-lived servers. A small pool that is
    never culled means a warm container keeps its connection instead of
    re-handshaking, and the shorter timeouts fail fast rather than leaving a
    child staring at a spinner when Atlas is briefly unreachable.
    """
    return AsyncIOMotorClient(
        url,
        maxPoolSize=10,          # serverless runs one request at a time
        minPoolSize=0,
        maxIdleTimeMS=270000,    # keep the socket for the container's lifetime
        serverSelectionTimeoutMS=8000,
        connectTimeoutMS=8000,
        socketTimeoutMS=20000,
        retryWrites=True,
    )


client = _make_client(mongo_url)
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
# Set as soon as the background schema pass is queued, so it is never queued twice.
_init_scheduled = False


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
        # Close the outgoing client first. Without this every rebind leaked its
        # connections: Atlas kept them open until the cluster's connection limit
        # was reached, at which point requests start failing intermittently —
        # which is exactly what "sering error" looks like from the outside.
        old_client = client
        client = _make_client(mongo_url)
        db = client[os.environ["DB_NAME"]]
        _client_loop_id = loop_id
        try:
            old_client.close()
        except Exception:  # noqa: BLE001 — a failed close must never break a request
            pass

JWT_ALGORITHM = "HS256"
JWT_ACCESS_MINUTES = 60 * 24 * 30  # 30 days, shared family device

# Single-family app: all data is scoped under one constant family id.
FAMILY_ID = "family-default"

DEFAULT_PASSCODE = "123456"  # seeded members start with this; must be changed
# Default "Terlambat" reason options — parents can add/remove/edit freely, no
# cap on how many. Excused reasons (not the kid's fault) cost nothing; at-fault
# reasons earn a Kartu Hukuman and forfeit the task's points.
DEFAULT_LATE_REASONS = [
    {"id": "macet", "label": "Kena macet / urusan di luar rumah", "gives_penalty_card": False, "award_points": True},
    {"id": "acara", "label": "Ada acara sekolah / keluarga", "gives_penalty_card": False, "award_points": True},
    {"id": "bangun", "label": "Terlambat bangun", "gives_penalty_card": True, "award_points": False},
    {"id": "lupa", "label": "Lupa / keasyikan main", "gives_penalty_card": True, "award_points": False},
]
DEFAULT_PENALTY_CARD_THRESHOLD = 3

# When the Kartu Hukuman threshold is reached the child owes a real-world
# consequence. "choice" lets them pick which one (ownership beats being
# sentenced); "auto" assigns one for them. Either way it must be served by
# `punishment_deadline_weekday` (default Sunday) or the overdue action lands.
DEFAULT_PUNISHMENT_OPTIONS = [
    {"id": "no_tv", "label": "Tidak nonton TV", "description": "Tidak menonton TV selama satu hari penuh."},
    {"id": "no_gadget", "label": "Tidak main gadget", "description": "Tidak memakai HP/tablet untuk main selama satu hari."},
    {"id": "extra_chore", "label": "Tugas rumah tambahan", "description": "Mengerjakan satu tugas rumah ekstra yang dipilih Abi/Ummi."},
    {"id": "early_bed", "label": "Tidur lebih awal", "description": "Tidur satu jam lebih awal dari biasanya."},
]
DEFAULT_PUNISHMENT_MODE = "choice"
DEFAULT_PUNISHMENT_DEADLINE_WEEKDAY = 6  # Sunday
DEFAULT_PUNISHMENT_OVERDUE_ACTION = "reset_points"

# The kid's day as sections. Each section is one checklist with one deadline
# (its finish time); missions without a section land in a trailing "Kapan
# Saja" group so nothing is ever invisible. Ranges may not overlap.
DEFAULT_DAY_SEGMENTS = [
    {"id": "pagi", "label": "Pagi", "emoji": "🌅", "start_time": "00:00", "end_time": "09:59"},
    {"id": "siang", "label": "Siang", "emoji": "☀️", "start_time": "10:00", "end_time": "14:59"},
    {"id": "sore", "label": "Sore", "emoji": "🌇", "start_time": "15:00", "end_time": "17:59"},
    {"id": "malam", "label": "Malam", "emoji": "🌙", "start_time": "18:00", "end_time": "23:59"},
]


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



# --------------- Auth Dependency ---------------
async def _enforce_maintenance_mode(member_id: str):
    """Raise 503 if the app is in maintenance mode and this member isn't the
    one exempt account (whoever switched it on). Checked centrally in
    get_current_user so it applies to every protected endpoint immediately —
    an already-logged-in session gets locked out on its very next request,
    not just at the next login."""
    config = await get_config_cached()
    if not config.get("maintenance_mode"):
        return
    if member_id == config.get("maintenance_exempt_member_id"):
        return
    message = config.get("maintenance_message") or "Aplikasi sedang nonaktif sementara. Hubungi orang tua untuk info lebih lanjut."
    raise HTTPException(status_code=503, detail=message)


# Every authenticated request used to re-read the member document — one extra
# round trip to the database on every single API call. Members change rarely
# (profile edits, passcode changes), and every write below clears this cache.
_MEMBER_CACHE: dict = {}
_MEMBER_TTL_SECONDS = 60.0


def _invalidate_member_cache():
    _MEMBER_CACHE.clear()


async def _get_member_cached(member_id: str):
    import time as _t
    now = _t.monotonic()
    hit = _MEMBER_CACHE.get(member_id)
    if hit and now - hit[0] < _MEMBER_TTL_SECONDS:
        return dict(hit[1])
    member = await db.members.find_one({"id": member_id}, {"_id": 0, "passcode_hash": 0, "passcode_plain": 0})
    if member:
        _MEMBER_CACHE[member_id] = (now, member)
    else:
        _MEMBER_CACHE.pop(member_id, None)
    return dict(member) if member else None


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
        member = await _get_member_cached(payload["sub"])
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


class LateReasonOption(BaseModel):
    id: Optional[str] = None
    label: str = Field(min_length=1, max_length=120)
    gives_penalty_card: bool = False   # True → picking this earns a Kartu Hukuman
    award_points: bool = True          # False → kid may continue but earns 0 points


class DaySegment(BaseModel):
    id: Optional[str] = None
    label: str = Field(min_length=1, max_length=40)
    emoji: str = Field(default="", max_length=8)
    start_time: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    end_time: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")


class SegmentStartOverrideInput(BaseModel):
    """Per-child, per-weekday start time for a section.

    Kids don't share one clock: one gets home from an activity at 18:50 while a
    sibling starts at 18:00, and it differs by weekday. Only the START moves —
    the section's END stays shared, since "when the day is over" is a household
    rule rather than a personal one.
    Shape: {segment_id: {"0".."6": "HH:MM"}}; a missing weekday falls back to
    the section's global start time.
    """
    starts: Dict[str, Dict[str, str]] = Field(default_factory=dict)
    # Optional personal FINISH per section per weekday (same shape). Lets a
    # school-day morning close at 06:15 while the weekend runs to 11:59.
    # None = leave the stored finishes untouched.
    ends: Optional[Dict[str, Dict[str, str]]] = None


class ExamPeriodInput(BaseModel):
    child_id: str
    exam_start: str                      # first day of the exams themselves
    exam_end: str
    flex_start: Optional[str] = None     # defaults to the day before exam_start
    flex_end: Optional[str] = None       # defaults to the day before exam_end
    pivot_task_titles: List[str] = Field(default_factory=list, max_length=10)
    note: str = Field(default="", max_length=200)


class PointsAdjustInput(BaseModel):
    # Positive to award, negative to deduct. Zero is pointless, so it's refused.
    points: int = Field(ge=-100000, le=100000)
    reason: str = Field(default="", max_length=200)



class ExamRejectInput(BaseModel):
    penalty_points: int = Field(default=100, ge=0, le=10000)
    note: str = Field(default="", max_length=200)


class PunishmentOption(BaseModel):
    id: Optional[str] = None
    label: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=300)


class PunishmentChooseInput(BaseModel):
    option_id: str


class PenaltyCardsSetInput(BaseModel):
    penalty_cards: int = Field(ge=0, le=999)


class AppConfigInput(BaseModel):
    app_name: Optional[str] = None
    default_theme: Optional[Literal["clean", "candy", "mermaid", "cyber", "galaxy"]] = None
    slideshow_background_url: Optional[str] = None
    slideshow_background_image: Optional[str] = None  # base64 data URL (uploaded image)
    rupiah_per_point: Optional[int] = Field(default=None, ge=1, le=1000000)
    daily_point_goal: Optional[int] = Field(default=None, ge=0, le=10000)
    # Per-weekday minimum point goals (Mon=0..Sun=6). Dict of "0".."6" -> int.
    # When a day isn't set, falls back to the dynamic sum-of-required or daily_point_goal.
    weekday_goals: Optional[dict] = None
    # Three Chikybanks (BusyKid): auto-split earned points by percentage
    chiky_save_pct: Optional[int] = Field(default=None, ge=0, le=100)
    chiky_spend_pct: Optional[int] = Field(default=None, ge=0, le=100)
    chiky_share_pct: Optional[int] = Field(default=None, ge=0, le=100)
    # Family combo: when EVERY kid finishes all their required tasks on the
    # same day, each gets this bonus. 0 = off.
    family_combo_bonus_points: Optional[int] = Field(default=None, ge=0, le=1000)
    # "Terlambat" system: configurable reason options + how many Kartu Hukuman
    # trigger a real-world consequence. Unlimited number of options.
    late_reasons: Optional[List[LateReasonOption]] = None
    penalty_card_threshold: Optional[int] = Field(default=None, ge=1, le=50)
    # What happens once the Kartu Hukuman threshold is reached.
    punishment_mode: Optional[Literal["auto", "choice"]] = None
    punishment_options: Optional[List[PunishmentOption]] = None
    punishment_deadline_weekday: Optional[int] = Field(default=None, ge=0, le=6)
    punishment_overdue_action: Optional[Literal["reset_points", "pet_dies", "none"]] = None
    # Kid timeline sections (Pagi/Siang/Sore/Malam...). Fully editable: rename,
    # re-time, add or remove as many as the family wants.
    day_segments: Optional[List[DaySegment]] = None
    # How long after a section's (personal) start time a child may still begin
    # the first mission without it counting as late.
    segment_late_grace_minutes: Optional[int] = Field(default=None, ge=0, le=15)
    # Award points the moment a mission is marked done, instead of queueing it
    # for a parent to approve one by one. The parent still sees everything and
    # can undo/deduct — review after the fact rather than gatekeeping.
    auto_approve_tasks: Optional[bool] = None
    # Points deducted when a parent rejects a claimed exam day as untrue.
    exam_false_claim_penalty: Optional[int] = Field(default=None, ge=0, le=10000)
    # --- Honesty --------------------------------------------------------
    # Extra points when a child, asked about a mission, admits it wasn't done.
    honesty_bonus_points: Optional[int] = Field(default=None, ge=0, le=100)
    # Surprise checks: after a section, sometimes one ticked mission is
    # picked and the child is asked for a photo of it.
    spot_checks_enabled: Optional[bool] = None
    # How many days a second correction puts a child under closer watch.
    probation_days: Optional[int] = Field(default=None, ge=1, le=14)
    # Corrections older than this no longer count toward the next level.
    strike_window_days: Optional[int] = Field(default=None, ge=1, le=60)
    # the count resets on (0=Monday .. 6=Sunday, ISO). Was hardcoded.
    # Custom label overrides: { "label_key": "custom text" }. Empty string = hide.
    custom_labels: Optional[dict] = None
    # Vacation/pause mode: while on, the weekly routine builds no new days, so
    # nothing piles up as missed; it picks back up when switched off.
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
    # Big-button, one-mission-at-a-time screen with spoken instructions for
    # children who can't read the checklist comfortably yet.
    simple_mode: Optional[bool] = None
    _check_pet_equipped = field_validator("pet_equipped")(classmethod(lambda cls, v: _validate_pet_accessories(v)))



# Written summaries ("tulis apa yang sudah kamu pelajari"): a mission can ask
# the child to put what they did into their own words before it counts.
SUMMARY_MIN_WORDS_DEFAULT = 15
SUMMARY_MIN_WORDS_FLOOR = 3
SUMMARY_MIN_WORDS_CAP = 300
SUMMARY_MAX_CHARS = 5000
_SUMMARY_FIELDS = ("summary_required", "summary_prompt", "summary_min_words")
# Other kinds of proof a mission can ask for. All of them travel from the
# routine onto each day's missions unchanged.
_PROOF_FIELDS = _SUMMARY_FIELDS + (
    "summary_questions",       # up to 3 questions, each answered separately (a small quiz)
    "photo_required",          # an "after" photo before it can be ticked
    "before_photo_required",   # …and a "before" one too
    "reading",                 # a reading mission: the child notes the page they reached
    "reading_book",            # optional fixed book title
    "steps",                   # a small checklist inside the mission
    "pet_care",                # food (default) / water / play — which pet need its reward feeds
    "timed",                   # a stopwatch: the child taps Mulai, then Selesai
)
MAX_STEPS = 10
MAX_QUESTIONS = 3


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
    # Estimated minutes — information for the parent and child only. Nothing
    # is timed per mission: the section's finish time is the only deadline.
    duration_minutes: Optional[int] = Field(default=None, ge=1, le=1440)
    date_key: Optional[str] = None       # "YYYY-MM-DD" — which day this one-off mission is for
    weekdays: Optional[List[int]] = None  # [0-6] Mon-Sun; one copy on each upcoming matching day
    # Which part of the day this belongs to (Pagi/Siang/Sore/Malam…). Only the
    # section carries a clock; missions just hold their place in its list.
    segment_id: Optional[str] = None
    icon: str = "star"
    order: Optional[int] = Field(default=None, ge=1)
    task_style: Optional[TASK_STYLE] = None
    photo_required: bool = False  # kid must attach a photo to mark this complete
    summary_required: bool = False  # kid must write a short summary before ticking it
    summary_prompt: Optional[str] = Field(default=None, max_length=200)
    summary_min_words: Optional[int] = Field(default=None, ge=SUMMARY_MIN_WORDS_FLOOR, le=SUMMARY_MIN_WORDS_CAP)
    summary_questions: Optional[List[str]] = Field(default=None, max_length=MAX_QUESTIONS)
    before_photo_required: bool = False
    reading: bool = False
    reading_book: Optional[str] = Field(default=None, max_length=120)
    pet_care: Optional[Literal["food", "water", "play"]] = None  # which pet need the reward feeds
    timed: Optional[bool] = None  # a stopwatch for this activity: starts on "Mulai", stops on "Selesai"
    steps: Optional[List[str]] = Field(default=None, max_length=MAX_STEPS)
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
    duration_minutes: Optional[int] = Field(default=None, ge=1, le=1440)
    date_key: Optional[str] = None
    icon: Optional[str] = None
    order: Optional[int] = Field(default=None, ge=1)
    task_style: Optional[TASK_STYLE] = None
    photo_required: Optional[bool] = None
    summary_required: Optional[bool] = None
    summary_prompt: Optional[str] = Field(default=None, max_length=200)
    summary_min_words: Optional[int] = Field(default=None, ge=SUMMARY_MIN_WORDS_FLOOR, le=SUMMARY_MIN_WORDS_CAP)
    summary_questions: Optional[List[str]] = Field(default=None, max_length=MAX_QUESTIONS)
    before_photo_required: Optional[bool] = None
    reading: Optional[bool] = None
    reading_book: Optional[str] = Field(default=None, max_length=120)
    pet_care: Optional[Literal["food", "water", "play"]] = None  # which pet need the reward feeds
    timed: Optional[bool] = None  # a stopwatch for this activity: starts on "Mulai", stops on "Selesai"
    steps: Optional[List[str]] = Field(default=None, max_length=MAX_STEPS)
    together_bonus_enabled: Optional[bool] = None
    together_bonus_points: Optional[int] = Field(default=None, ge=1, le=1000)
    # These were missing, so editing a task silently discarded them and the
    # task snapped back to "Kapan Saja" (no section) on every save.
    segment_id: Optional[str] = None


class RedeemMoneyInput(BaseModel):
    child_id: str
    points: int = Field(ge=1, le=1000000)


class CharityRequestInput(BaseModel):
    child_id: str
    points: int = Field(ge=1, le=1000000)
    note: str = Field(default="", max_length=200)



class OffDayInput(BaseModel):
    start_date: str
    end_date: Optional[str] = None  # None/empty = single day
    note: str = Field(default="", max_length=100)
    # Optional section boundaries, so a break can begin and end part-way
    # through a day: "off from Friday afternoon until Monday morning" leaves
    # Friday's morning intact and lets Monday resume at midday. Omitted = the
    # whole of that day is off.
    start_segment_id: Optional[str] = None
    end_segment_id: Optional[str] = None


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
    config = await get_config_cached()
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
    _invalidate_member_cache()
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
    _invalidate_member_cache()
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
    _invalidate_member_cache()
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
        config = await get_config_cached()
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
        updates["pet_path"] = None
        updates["pet_last_watered_at"] = now
        updates["pet_last_played_at"] = now

    if updates:
        await db.members.update_one({"id": user["id"]}, {"$set": updates})
        _invalidate_member_cache()
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

    config = await get_config_cached()
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
    config = await get_config_cached()
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
    # Behaviour, not just points.
    {"key": "honest_1", "name": "Berani Jujur", "desc": "Mengaku sendiri saat tugas belum dikerjakan", "emoji": "🙏"},
    {"key": "honest_5", "name": "Jujur Sejati", "desc": "5 kali jujur mengaku", "emoji": "💎"},
    {"key": "spot_5", "name": "Lolos Cek Kejutan", "desc": "Lolos 5 cek kejutan", "emoji": "📸"},
    {"key": "comeback", "name": "Bangkit Lagi", "desc": "Lulus masa pengawasan tanpa koreksi baru", "emoji": "🌱"},
    {"key": "on_time_7", "name": "Tepat Waktu", "desc": "7 kali berturut-turut menyelesaikan satu bagian tepat waktu", "emoji": "⏰"},
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
        "honest_1": int(child.get("honest_admits") or 0) >= 1,
        "honest_5": int(child.get("honest_admits") or 0) >= 5,
        "spot_5": int(child.get("spot_passes") or 0) >= 5,
        "comeback": int(child.get("probations_passed") or 0) >= 1,
        "on_time_7": int(child.get("best_section_streak") or 0) >= 7,
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
                 "completion_photo_url": _media_ref("task", t.get("id"), "completion_photo_url",
                                                    t.get("completion_photo_url"))}
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
    }, {"_id": 0, "child_id": 1, "is_coop": 1, "coop_participants": 1, "points": 1,
        "coop_points_split": 1, "together_bonus_awarded": 1, "early_bonus_awarded": 1}).to_list(None)
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
            "image": _media_ref("task", t.get("id"), "completion_photo_url", t.get("completion_photo_url")),
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
    # One read for the whole family's week, split per child in memory.
    _week = await db.tasks.find({
        "parent_id": FAMILY_ID, "date_key": {"$gte": week_ago, "$lte": today},
    }, {"_id": 0, **{f: 0 for f in ("completion_photo_url", "encouragement_voice_url")}}).to_list(None)
    report = []
    for k in kids:
        tasks = [t for t in _week if t.get("child_id") == k["id"]
                 or (t.get("is_coop") and k["id"] in (t.get("coop_participants") or []))]

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
    config = await get_config_cached()
    for c in children:
        c["pet_is_dead"] = _pet_is_dead(c, config)
    return _with_media_refs("child", children)


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
        "penalty_cards": 0,
        "pet_force_dead": False,

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
    _invalidate_member_cache()

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
        _invalidate_member_cache()
    updated = await db.children.find_one({"id": child_id}, {"_id": 0})
    return updated


@api.post("/children/{child_id}/reset-points")
async def reset_child_points(child_id: str, user: dict = Depends(require_parent)):
    """Wipe a child's scoreboard back to zero — for clearing out test data or
    starting a fresh season. Resets current & lifetime points, streaks, tasks
    completed, pet-feed currency, and penalty cards; also clears
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
            "penalty_cards": 0,
            "pet_force_dead": False,
            "feed_balance": 0,
            "feed_lifetime": 0,
            # The three Chikybank buckets ARE the points, split three ways —
            # zeroing the total while leaving them behind made the wallet drift
            # permanently out of step with the balance shown above it.
            "chiky_save": 0,
            "chiky_spend": 0,
            "chiky_share": 0,
        }},
    )
    # Clear scoreboard-affecting history so the numbers genuinely start from 0.
    await db.redemptions.delete_many({"child_id": child_id})
    await db.applied_consequences.delete_many({"child_id": child_id})
    await log_activity(FAMILY_ID, child_id, "points_reset", {})
    return await db.children.find_one({"id": child_id}, {"_id": 0})


@api.post("/children/{child_id}/rebalance-buckets")
async def rebalance_buckets(child_id: str, user: dict = Depends(require_parent)):
    """Re-split a child's Chikybank so the three buckets add up to their actual
    points again.

    Older resets zeroed the points total but left the buckets untouched, so a
    wallet could drift permanently out of step with the balance shown above it.
    This recomputes the split from the current points using the family's
    configured percentages — no points are created or destroyed.
    """
    child = await get_child_or_404(FAMILY_ID, child_id)
    config = await get_config_cached()
    total = max(0, int(child.get("points", 0)))
    save_pct = int(config.get("chiky_save_pct", 40))
    spend_pct = int(config.get("chiky_spend_pct", 40))
    share_pct = int(config.get("chiky_share_pct", 20))
    total_pct = save_pct + spend_pct + share_pct or 100
    p_save = round(total * save_pct / total_pct)
    p_spend = round(total * spend_pct / total_pct)
    p_share = total - p_save - p_spend  # remainder, so the three always sum exactly
    before = {
        "chiky_save": int(child.get("chiky_save", 0)),
        "chiky_spend": int(child.get("chiky_spend", 0)),
        "chiky_share": int(child.get("chiky_share", 0)),
    }
    await db.children.update_one({"id": child_id}, {"$set": {
        "chiky_save": p_save, "chiky_spend": p_spend, "chiky_share": p_share,
    }})
    await log_activity(FAMILY_ID, child_id, "buckets_rebalanced", {"before": before, "points": total})
    return {
        "success": True, "points": total, "before": before,
        "after": {"chiky_save": p_save, "chiky_spend": p_spend, "chiky_share": p_share},
    }


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
                "tasks_completed": 0,
                "penalty_cards": 0, "feed_balance": 0, "feed_lifetime": 0,
                # Same as the single-child reset: the buckets are the points,
                # so they have to go to zero together.
                "chiky_save": 0, "chiky_spend": 0, "chiky_share": 0,
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
    _invalidate_member_cache()


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
    _invalidate_member_cache()
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
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    include_open: bool = False,
    user: dict = Depends(get_current_user),
):
    # The parent's list makes sure today and tomorrow are built (cheap once
    # warm — see _ensure_days_ready); further days are built when opened.
    await _ensure_days_ready()
    query = {"parent_id": FAMILY_ID}
    # A date window keeps the payload proportional to what's on screen instead
    # of the family's whole history. include_open also returns anything still
    # waiting on a parent (completed / held) from outside the window, so an old
    # approval can never silently drop off the list.
    sd = validate_date_key(start_date) if start_date else None
    ed = validate_date_key(end_date) if end_date else None
    if (start_date and not sd) or (end_date and not ed):
        raise HTTPException(status_code=422, detail="Rentang tanggal tidak valid")
    if sd or ed:
        rng: dict = {}
        if sd:
            rng["$gte"] = sd
        if ed:
            rng["$lte"] = ed
        if include_open:
            query["$and"] = [{"$or": [
                {"date_key": rng}, {"date_key": None}, {"status": "completed"},
            ]}]
        else:
            query["date_key"] = rng
    if child_id:
        # Match either "this is their individual task" OR "this is a co-op task
        # they're one of the participants in" (co-op tasks store child_id as
        # just the primary owner, so a plain child_id match alone would miss them).
        query.setdefault("$and", []).append(
            {"$or": [{"child_id": child_id}, {"is_coop": True, "coop_participants": child_id}]})
    if status_filter:
        query["status"] = status_filter
    if date_key:
        query["date_key"] = date_key
    _UNDO_FIELDS = {
        "_undo_prev_streak": 0, "_undo_prev_last_completion": 0, "_undo_points_awarded": 0,
        "_undo_chiky_save": 0, "_undo_chiky_spend": 0, "_undo_chiky_share": 0, "_undo_spawned_next_id": 0,
        "_undo_coop_snapshots": 0, "_undo_prev_best_streak": 0, "_undo_feed_earned": 0, "_undo_miss_penalty": 0,
        "_undo_free_prev_available": 0, "_undo_free_prev_week": 0,
    }
    tasks = await db.tasks.find(query, {"_id": 0, **_UNDO_FIELDS}).to_list(10000)
    tasks.sort(key=lambda t: (t.get("date_key") or "", t.get("order") or 0))
    return _with_media_refs("task", tasks)


@api.post("/days/{date_key}/prepare")
async def prepare_day(date_key: str, user: dict = Depends(require_parent)):
    """Build one upcoming day now (default template + repeating series), so a
    parent planning ahead sees and can edit it. Days are otherwise built only
    when they become today/tomorrow. Idempotent."""
    dk = validate_date_key(date_key)
    if not dk:
        raise HTTPException(status_code=422, detail="Tanggal tidak valid")
    today = _today_key()
    limit = (datetime.strptime(today, "%Y-%m-%d") + timedelta(days=62)).strftime("%Y-%m-%d")
    if dk < today:
        return {"date_key": dk, "created": 0, "past": True}
    if dk > limit:
        raise HTTPException(status_code=422, detail="Maksimal 62 hari ke depan")
    created = await _ensure_days_ready([dk])
    return {"date_key": dk, "created": created}


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
        "segment_id": payload.segment_id,
        "duration_minutes": payload.duration_minutes,
        "date_key": date_key,
        "recurrence": "none",
        "icon": payload.icon,
        "order": order,
        "task_style": task_style,
        "photo_required": payload.photo_required,
        "summary_required": payload.summary_required,
        "summary_prompt": (payload.summary_prompt or "").strip() or None,
        "summary_min_words": payload.summary_min_words,
        "summary_questions": _clean_list(payload.summary_questions),
        "before_photo_required": payload.before_photo_required,
        "reading": payload.reading,
        "reading_book": (payload.reading_book or "").strip() or None,
        "pet_care": payload.pet_care or None,
        "timed": bool(payload.timed),
        "steps": _clean_list(payload.steps),
        "completion_photo_url": None,
        "is_coop": False,
        "coop_participants": [],
        "coop_completed_by": None,
        "together_bonus_enabled": payload.together_bonus_enabled,
        "together_bonus_points": payload.together_bonus_points,
        "done_together": None,  # kid's self-reported answer once they complete the task
        "late_ack": False,          # kid explained a missed deadline via the Terlambat flow
        "late_reason_id": None,
        "late_reason_label": None,
        "late_no_points": False,    # at-fault lateness → task still doable, but worth 0
        "late_penalized": False,    # this task earned the kid a Kartu Hukuman
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

    # Build those days from the routine BEFORE adding to them: a hand-made
    # mission on a not-yet-built day would otherwise make the default template
    # think the day was already set up and skip it.
    _today_ct = _today_key()
    _limit_ct = (datetime.strptime(_today_ct, "%Y-%m-%d") + timedelta(days=62)).strftime("%Y-%m-%d")
    _prep = [d for d in date_keys if d and _today_ct <= d <= _limit_ct]
    if _prep:
        await _ensure_days_ready(_prep)

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
    _invalidate_days_ready()
    task = await db.tasks.find_one({"id": task_id, "parent_id": FAMILY_ID})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Fields the parent is allowed to explicitly clear (set back to empty).
    # Sending null for these means "clear it" (back to Kapan Saja / the family
    # default), as opposed to "leave it alone" — which is what omitting does.
    clearable = {"duration_minutes", "task_style", "segment_id", "summary_prompt", "summary_min_words",
                 "summary_questions", "reading_book", "steps"}
    raw = payload.model_dump(exclude_unset=True)

    updates = {}
    for k, v in raw.items():
        if v is not None:
            updates[k] = v
        elif k in clearable:
            updates[k] = None  # explicit clear

    # Editing a member of a broadcast group forks it: this child's copy becomes
    # independent (loses broadcast_id) so the parent can customize just this one
    # while the siblings stay as they were. Matches the requested template behavior.
    for f in ("summary_questions", "steps"):
        if f in updates:
            updates[f] = _clean_list(updates[f])
    if "steps" in updates:
        updates["steps_done"] = [False] * len(updates["steps"] or [])
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
    _child_doc = await get_child_or_404(FAMILY_ID, child_id)
    dk = validate_date_key(date_key) or _today_key()
    await _ensure_day_built(dk)
    # Keep repeating series alive on the kid's side too — they're often the
    # first to open the app on a new day. Normally a background nudge; only an
    # EMPTY near day is built inline, because a serverless host may freeze the
    # process before a background task finishes and the child would see nothing.
    _dp_q = {"parent_id": FAMILY_ID, "date_key": dk,
             "$or": [{"child_id": child_id}, {"is_coop": True, "coop_participants": child_id}]}
    tasks = await db.tasks.find(_dp_q, {"_id": 0}).to_list(500)
    if not tasks and dk in _near_days():
        if await _ensure_days_ready([dk], trust_marker=False):
            tasks = await db.tasks.find(_dp_q, {"_id": 0}).to_list(500)
    else:
        _schedule_materialize()
    # Parked "off" tasks (parent declared this an off day) are invisible to the
    # quest line — they can't be started, missed, or penalized.
    tasks = [t for t in tasks if t.get("status") != "off"]
    tasks.sort(key=lambda t: (bool(t.get("is_bonus")), t.get("order") or 0))
    is_off = await _is_off_day(dk)
    combo_award = await db.family_combo_awards.find_one({"parent_id": FAMILY_ID, "date_key": dk}, {"_id": 0})
    await _refresh_segments_cache()
    _cfg_shared = await get_config_cached()
    await _sweep_overdue_punishments()
    # Sections as THIS child experiences them today: the start time is their
    # personal one where a parent set one, so the kid's timeline shows the hour
    # that actually applies to them rather than the household default.
    _segs_for_kid = await _get_day_segments()
    _kid_doc_seg = _child_doc  # loaded above; re-reading it cost a round trip
    effective_segments = []
    for _sg in _segs_for_kid:
        _eff = _effective_segment_start(_sg, _kid_doc_seg, dk)
        effective_segments.append({
            **_sg,
            "start_time": _fmt_min(_eff),
            "general_start_time": _sg["start_time"],
            "is_personal": _fmt_min(_eff) != _sg["start_time"],
        })

    # Missions carry no clock of their own any more — their section does. The
    # parent's views only need each mission's section start for this child.
    _tasks_with_availability = []
    for _t in tasks:
        _sg_t = _segment_for_task(_t, _segs_for_kid)
        _tasks_with_availability.append({
            **_t,
            "effective_start_time": _fmt_min(_effective_segment_start(_sg_t, _kid_doc_seg, dk)) if _sg_t else None,
        })
    active_punishment = await db.punishments.find_one({
        "parent_id": FAMILY_ID, "child_id": child_id,
        "status": {"$in": ["pending_choice", "assigned"]},
    }, {"_id": 0})

    config = _cfg_shared

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
        "is_off_day": is_off,
        "family_combo": combo_award,
        "active_punishment": active_punishment,
        "segments": effective_segments,
        "tasks": _with_media_refs("task", _tasks_with_availability),
        "perfect_day": perfect_day,
        "perfect_day_claimed": bool(perfect_claim),
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
    same weekly-cycle pattern. A child with no pet at all
    is not considered 'dead' (there's simply nothing to mourn yet)."""
    if not child.get("pet_type"):
        return False
    if child.get("pet_force_dead"):
        # Killed deliberately as an overdue-punishment consequence, not by neglect.
        return True
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
    config = await get_config_cached()

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
    before, after = _pet_stage(child, config), _pet_stage(updated, config)
    if after[0] > before[0]:
        await _pet_log(child_id, "stage", f"Peliharaanmu naik ke tahap {after[1]} 🎉", "🌟")
    return {
        "feed_balance": updated.get("feed_balance", 0),
        "feed_lifetime": updated.get("feed_lifetime", 0),
        "pet_feed_count": updated.get("pet_feed_count", 0),
        "stage_up": after[0] > before[0], "stage_name": after[1],
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

    config = await get_config_cached()
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


# --------------- Day sections ---------------
async def _get_day_segments() -> list:
    config = await get_config_cached()
    return config.get("day_segments") or DEFAULT_DAY_SEGMENTS


def _segment_for_task(task: dict, segments: list) -> Optional[dict]:
    """The section a task lives in (None = 'Kapan Saja'). An old mission
    made before sections existed falls into the section its old deadline sat
    in, so history still groups sensibly."""
    sid = task.get("segment_id")
    if sid:
        return next((s for s in segments if s.get("id") == sid), None)
    if task.get("due_time"):
        m = _hhmm_to_min(task["due_time"])
        return next(
            (s for s in segments if _hhmm_to_min(s["start_time"]) <= m <= _hhmm_to_min(s["end_time"])),
            None,
        )
    return None



# "Hari santai" ranges (school holidays and the like), refreshed alongside the
# section cache so the sync timing helpers can consult them.
_RELAXED_CACHE: dict = {"ranges": []}


def _is_relaxed(date_key: Optional[str]) -> bool:
    return bool(date_key) and any(r["start_date"] <= date_key <= r["end_date"] for r in _RELAXED_CACHE["ranges"])


def _effective_segment_start(segment: dict, child: Optional[dict], date_key: Optional[str]) -> int:
    """Minutes-into-day when THIS child's section begins on THIS date.

    Falls back to the section's shared start whenever the child has no override
    for that weekday, so partial configuration is always safe. On a relaxed day
    personal times are set aside and the shared ones apply.
    """
    base = _hhmm_to_min(segment["start_time"])
    if not child or not date_key or _is_relaxed(date_key):
        return base
    overrides = (child.get("segment_starts") or {}).get(segment.get("id")) or {}
    try:
        wd = str(datetime.strptime(date_key, "%Y-%m-%d").weekday())
    except Exception:
        return base
    val = overrides.get(wd)
    if not val:
        return base
    try:
        return _hhmm_to_min(val)
    except Exception:
        return base


def _effective_segment_end(segment: dict, child: Optional[dict], date_key: Optional[str]) -> int:
    """Minutes-into-day when THIS child's section closes on THIS date: the
    child's personal finish for that weekday, else the section's shared end.
    A personal finish is never later than the shared end nor before the
    child's start that day."""
    base = _hhmm_to_min(segment["end_time"])
    if not child or not date_key or _is_relaxed(date_key):
        return base
    overrides = (child.get("segment_ends") or {}).get(segment.get("id")) or {}
    try:
        wd = str(datetime.strptime(date_key, "%Y-%m-%d").weekday())
        val = overrides.get(wd)
        if not val:
            return base
        m = _hhmm_to_min(val)
    except Exception:
        return base
    return max(_effective_segment_start(segment, child, date_key), min(m, base))


def _fmt_min(m: int) -> str:
    m = max(0, min(int(m), 23 * 60 + 59))
    return f"{m // 60:02d}:{m % 60:02d}"



def _validate_day_segments(segments: list):
    """Segments must be sane before they're stored: each range forward-going,
    no two overlapping. Overlap would make a task's section ambiguous, which
    silently duplicates or hides it in the kid's timeline."""
    if not segments:
        raise HTTPException(status_code=422, detail="Minimal harus ada satu bagian waktu")
    for seg in segments:
        if not seg.get("id"):
            seg["id"] = new_id()[:8]
        if _hhmm_to_min(seg["start_time"]) > _hhmm_to_min(seg["end_time"]):
            raise HTTPException(status_code=422, detail=f'Bagian "{seg.get("label")}": jam mulai harus sebelum jam selesai')
    ordered = sorted(segments, key=lambda x: _hhmm_to_min(x["start_time"]))
    for a, b in zip(ordered, ordered[1:]):
        if _hhmm_to_min(b["start_time"]) <= _hhmm_to_min(a["end_time"]):
            raise HTTPException(
                status_code=422,
                detail=f'Bagian "{a.get("label")}" dan "{b.get("label")}" waktunya bertabrakan',
            )


def _hhmm_to_min(hhmm: str) -> int:
    h, m = map(int, hhmm.split(":"))
    return h * 60 + m



# --------------- Off days (hari libur tugas) ---------------
async def _rebalance_child_buckets(child_id: str, config: dict) -> None:
    """Re-split the Chikybank so the three buckets always sum to the points.
    Called after any adjustment that moves the total on its own."""
    child = await db.children.find_one({"id": child_id})
    if not child:
        return
    total = max(0, int(child.get("points", 0)))
    save_pct = int(config.get("chiky_save_pct", 40))
    spend_pct = int(config.get("chiky_spend_pct", 40))
    share_pct = int(config.get("chiky_share_pct", 20))
    total_pct = save_pct + spend_pct + share_pct or 100
    p_save = round(total * save_pct / total_pct)
    p_spend = round(total * spend_pct / total_pct)
    await db.children.update_one({"id": child_id}, {"$set": {
        "chiky_save": p_save, "chiky_spend": p_spend, "chiky_share": total - p_save - p_spend,
    }})


async def _active_exam_flex(child_id: str, date_key: str) -> Optional[dict]:
    """The exam period covering this child on this day, if any (and not rejected)."""
    return await db.exam_periods.find_one({
        "parent_id": FAMILY_ID, "child_id": child_id, "status": {"$ne": "rejected"},
        "flex_start": {"$lte": date_key}, "flex_end": {"$gte": date_key},
    }, {"_id": 0})



@api.post("/exam-periods")
async def create_exam_period(payload: ExamPeriodInput, user: dict = Depends(get_current_user)):
    """Declare an exam period. Study runs long on the days BEFORE each exam, so
    the flexible window defaults to H-1 of the whole range — a Tuesday-to-
    Thursday exam relaxes Monday to Wednesday. Either a parent or the child can
    raise it, and it takes effect immediately: asking a child to wait for
    approval on the evening they need to study defeats the purpose. It's logged
    plainly, and a parent who finds it untrue can reject it."""
    if user["role"] == "child" and user["id"] != payload.child_id:
        raise HTTPException(status_code=403, detail="Kamu hanya bisa mengajukan untuk dirimu sendiri")
    await get_child_or_404(FAMILY_ID, payload.child_id)

    ex_start = validate_date_key(payload.exam_start)
    ex_end = validate_date_key(payload.exam_end)
    if not ex_start or not ex_end:
        raise HTTPException(status_code=422, detail="Tanggal ujian tidak valid (YYYY-MM-DD)")
    if ex_end < ex_start:
        raise HTTPException(status_code=422, detail="Tanggal selesai ujian harus sesudah tanggal mulai")

    _d = lambda k, n: (datetime.strptime(k, "%Y-%m-%d") + timedelta(days=n)).strftime("%Y-%m-%d")
    fl_start = validate_date_key(payload.flex_start) if payload.flex_start else _d(ex_start, -1)
    fl_end = validate_date_key(payload.flex_end) if payload.flex_end else _d(ex_end, -1)
    if not fl_start or not fl_end:
        raise HTTPException(status_code=422, detail="Rentang hari belajar tidak valid")
    if fl_end < fl_start:
        raise HTTPException(status_code=422, detail="Rentang hari belajar terbalik")
    if (datetime.strptime(fl_end, "%Y-%m-%d") - datetime.strptime(fl_start, "%Y-%m-%d")).days > 30:
        raise HTTPException(status_code=422, detail="Rentang belajar maksimal 31 hari")

    # One live claim per child: stacking them would turn this into a permanent
    # "no rules" mode rather than an exception for a real exam week.
    existing = await db.exam_periods.find_one({
        "parent_id": FAMILY_ID, "child_id": payload.child_id, "status": {"$ne": "rejected"},
        "flex_end": {"$gte": _today_key()},
    })
    if existing:
        raise HTTPException(status_code=409, detail="Sudah ada Hari Ujian yang aktif. Hapus dulu yang lama kalau mau ganti.")

    child = await db.children.find_one({"id": payload.child_id}, {"_id": 0})
    doc = {
        "id": new_id(), "parent_id": FAMILY_ID, "child_id": payload.child_id,
        "child_name": (child or {}).get("name", ""),
        "exam_start": ex_start, "exam_end": ex_end,
        "flex_start": fl_start, "flex_end": fl_end,
        "pivot_task_titles": [t.strip() for t in payload.pivot_task_titles if t.strip()],
        "note": payload.note.strip(),
        "created_by": user.get("name", ""), "created_by_role": user["role"],
        "status": "active", "created_at": now_iso(),
    }
    await db.exam_periods.insert_one(doc)
    doc.pop("_id", None)
    await log_activity(FAMILY_ID, payload.child_id, "exam_period_declared", {
        "exam": f"{ex_start}..{ex_end}", "flex": f"{fl_start}..{fl_end}",
        "pivots": doc["pivot_task_titles"], "by": user.get("name", ""),
    })
    if user["role"] == "child":
        await send_push_to({"role": "parent"}, title="Hari Ujian didaftarkan 📚",
                           body=f'{doc["child_name"]} menandai ujian {ex_start} s/d {ex_end}. Cek kalau tidak sesuai.',
                           url="/parent")
    return doc


@api.get("/exam-periods")
async def list_exam_periods(child_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = {"parent_id": FAMILY_ID}
    if user["role"] == "child":
        query["child_id"] = user["id"]
    elif child_id:
        query["child_id"] = child_id
    return await db.exam_periods.find(query, {"_id": 0}).sort("created_at", -1).to_list(50)


@api.delete("/exam-periods/{exam_id}")
async def delete_exam_period(exam_id: str, user: dict = Depends(get_current_user)):
    doc = await db.exam_periods.find_one({"id": exam_id, "parent_id": FAMILY_ID})
    if not doc:
        raise HTTPException(status_code=404, detail="Hari Ujian tidak ditemukan")
    if user["role"] == "child" and user["id"] != doc["child_id"]:
        raise HTTPException(status_code=403, detail="Bukan milikmu")
    await db.exam_periods.delete_one({"id": exam_id})
    await log_activity(FAMILY_ID, doc["child_id"], "exam_period_removed", {"by": user.get("name", "")})
    return {"success": True}


@api.post("/exam-periods/{exam_id}/reject")
async def reject_exam_period(exam_id: str, payload: ExamRejectInput = ExamRejectInput(), user: dict = Depends(require_parent)):
    """Parent judges a claimed exam period untrue. The relaxation stops and the
    configured penalty is deducted — points already earned that day are left
    alone, since the deduction is the consequence for the lie itself."""
    doc = await db.exam_periods.find_one({"id": exam_id, "parent_id": FAMILY_ID})
    if not doc:
        raise HTTPException(status_code=404, detail="Hari Ujian tidak ditemukan")
    if doc.get("status") == "rejected":
        raise HTTPException(status_code=400, detail="Hari Ujian ini sudah ditolak")
    config = await get_config_cached()
    penalty = payload.penalty_points if payload.penalty_points is not None else int(config.get("exam_false_claim_penalty", 100))

    await db.exam_periods.update_one({"id": exam_id}, {"$set": {
        "status": "rejected", "rejected_at": now_iso(),
        "rejected_by": user.get("name", ""), "reject_note": payload.note,
        "penalty_points": penalty,
    }})
    if penalty > 0:
        await db.children.update_one({"id": doc["child_id"]}, {"$inc": {"points": -penalty}})
        await _rebalance_child_buckets(doc["child_id"], config)
    await log_activity(FAMILY_ID, doc["child_id"], "exam_period_rejected", {
        "penalty": penalty, "by": user.get("name", ""), "note": payload.note,
    })
    await send_push_to({"role": "child", "member_id": doc["child_id"]},
                       title="Hari Ujian ditolak", body=f"Poinmu dikurangi {penalty}. Yuk jujur ya lain kali.",
                       url=f"/kid/{doc['child_id']}")
    return await db.exam_periods.find_one({"id": exam_id}, {"_id": 0})


# ---------------- Day templates ----------------
# A routine is defined once per KIND of day ("Hari Biasa", "Tanggal Merah"),
# broken down by weekday and section. Real dates then just point at a template.
# Before this, a school holiday falling on a Monday meant rebuilding that day
# mission by mission; now it's one assignment.


@api.get("/export/weekly-xlsx")
async def export_weekly_xlsx(
    template_id: Optional[str] = None,
    start_date: Optional[str] = None,
    user: dict = Depends(require_parent),
):
    """Download the week's routine as a formatted spreadsheet.

    Two sources, because both are useful: pass a template_id to export the
    routine as designed, or a start_date to export the actual missions on the
    calendar for that week. Each child gets their own sheet, grouped by section
    with a row per mission and running point totals.
    """
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter
    from fastapi.responses import StreamingResponse
    import io

    segments = await _get_day_segments()
    seg_pos = {sg["id"]: i for i, sg in enumerate(sorted(segments, key=lambda x: _hhmm_to_min(x["start_time"])))}
    seg_name = {sg["id"]: f'{sg.get("emoji", "")} {sg["label"]}'.strip() for sg in segments}
    kids = await db.children.find({"parent_id": FAMILY_ID}, {"_id": 0}).to_list(50)
    if not kids:
        raise HTTPException(status_code=400, detail="Belum ada anak untuk diekspor")

    WEEKDAYS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]

    # Gather rows as {weekday: {child_id: [task-like dicts]}}
    by_day: dict = {i: {k["id"]: [] for k in kids} for i in range(7)}
    title = ""
    if template_id:
        tpl = await db.day_templates.find_one({"id": template_id, "parent_id": FAMILY_ID})
        if not tpl:
            raise HTTPException(status_code=404, detail="Template tidak ditemukan")
        title = tpl.get("name", "Template")
        slots = await db.template_tasks.find(
            {"parent_id": FAMILY_ID, "template_id": template_id}, {"_id": 0}
        ).to_list(5000)
        for sl in slots:
            targets = [sl["child_id"]] if sl.get("child_id") else [k["id"] for k in kids]
            for cid in targets:
                if cid in by_day[sl["weekday"]]:
                    by_day[sl["weekday"]][cid].append(sl)
    else:
        start = validate_date_key(start_date) if start_date else _today_key()
        if not start:
            raise HTTPException(status_code=422, detail="Tanggal tidak valid (YYYY-MM-DD)")
        # Snap back to the Monday of that week so the sheet always reads Mon–Sun.
        monday = datetime.strptime(start, "%Y-%m-%d") - timedelta(
            days=datetime.strptime(start, "%Y-%m-%d").weekday()
        )
        title = f'Minggu {monday.strftime("%d %b %Y")}'
        for i in range(7):
            dk = (monday + timedelta(days=i)).strftime("%Y-%m-%d")
            rows = await db.tasks.find(
                {"parent_id": FAMILY_ID, "date_key": dk, "status": {"$ne": "off"}}, {"_id": 0}
            ).to_list(2000)
            for t in rows:
                for cid in (t.get("coop_participants") or [t.get("child_id")]):
                    if cid in by_day[i]:
                        by_day[i][cid].append(t)

    wb = Workbook()
    wb.remove(wb.active)
    HEAD_FILL = PatternFill("solid", fgColor="1F4E5F")
    SEG_FILL = PatternFill("solid", fgColor="DCE6F1")
    THIN = Side(style="thin", color="9CA3AF")
    BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
    HEADERS = ["Kategori", "Urutan", "Aktivitas", "Durasi", "Point Utama", "Point Bonus", "Total Point"]

    for kid in kids:
        ws = wb.create_sheet(kid["name"][:31])
        ws["A1"] = kid["name"]
        ws["A1"].font = Font(name="Arial", bold=True, size=13)
        ws["C1"] = title
        ws["C1"].font = Font(name="Arial", italic=True, size=10, color="6B7280")
        row = 3

        for wd in range(7):
            tasks = by_day[wd][kid["id"]]
            if not tasks:
                continue
            ws.cell(row=row, column=1, value=WEEKDAYS[wd]).font = Font(name="Arial", bold=True, size=12)
            row += 1

            for col, h in enumerate(HEADERS, start=1):
                cell = ws.cell(row=row, column=col, value=h)
                cell.font = Font(name="Arial", bold=True, color="FFFFFF")
                cell.fill = HEAD_FILL
                cell.alignment = Alignment(horizontal="center", vertical="center")
                cell.border = BORDER
            header_row = row
            row += 1

            tasks.sort(key=lambda t: (seg_pos.get(t.get("segment_id"), 999), t.get("order") or 0))
            first_data_row = row
            current_seg = "__none__"
            for t in tasks:
                sid = t.get("segment_id")
                if sid != current_seg:
                    current_seg = sid
                    label = seg_name.get(sid, "✨ Kapan Saja")
                    c = ws.cell(row=row, column=1, value=label)
                    c.font = Font(name="Arial", bold=True)
                    for col in range(1, len(HEADERS) + 1):
                        ws.cell(row=row, column=col).fill = SEG_FILL
                        ws.cell(row=row, column=col).border = BORDER
                    row += 1

                bonus = t.get("together_bonus_points") if t.get("together_bonus_enabled") else None
                values = [
                    "",
                    t.get("order") or "",
                    t.get("title", ""),
                    f'{t.get("duration_minutes")} menit' if t.get("duration_minutes") else "",
                    t.get("points") or 0,
                    bonus or "",
                ]
                for col, v in enumerate(values, start=1):
                    c = ws.cell(row=row, column=col, value=v)
                    c.font = Font(name="Arial", size=11)
                    c.border = BORDER
                    if col in (2, 4, 5, 6):
                        c.alignment = Alignment(horizontal="center")
                # Total stays a live formula so the sheet recalculates if edited.
                tc = ws.cell(row=row, column=7, value=f"=E{row}+N(F{row})")
                tc.font = Font(name="Arial", size=11)
                tc.border = BORDER
                tc.alignment = Alignment(horizontal="center")
                row += 1

            # Per-day totals, also as formulas
            ws.cell(row=row, column=3, value=f"Total {WEEKDAYS[wd]}").font = Font(name="Arial", bold=True)
            for col in (5, 7):
                letter = get_column_letter(col)
                tc = ws.cell(row=row, column=col, value=f"=SUM({letter}{first_data_row}:{letter}{row - 1})")
                tc.font = Font(name="Arial", bold=True)
                tc.alignment = Alignment(horizontal="center")
                tc.border = BORDER
            ws.cell(row=header_row, column=1)  # keep reference readable
            row += 2

        for col, width in enumerate([16, 9, 46, 12, 13, 13, 13], start=1):
            ws.column_dimensions[get_column_letter(col)].width = width
        ws.freeze_panes = "A3"

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    fname = f'jadwal-{title.lower().replace(" ", "-")}.xlsx'
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ================= Weekly routine + exceptions =================
# The schedule is now defined once as a WEEK: weekday x section -> an ordered
# checklist. Real days are built from it lazily, the first time anyone looks at
# that day. Exceptions bend specific dates without touching the routine:
#   - Libur            -> existing off-days (whole day, or from/to a section)
#   - Jadwal hari lain -> a date (range) borrows another weekday's routine
#   - Aktivitas khusus -> one-off activities added to particular dates
# Durations are informational only: they tell the child roughly how long each
# activity should take; the section's start and end are the only clock.

def _clean_list(items: Optional[List[str]]) -> Optional[List[str]]:
    """Trim, drop blanks, keep order; None when nothing is left."""
    out = [str(x).strip()[:120] for x in (items or []) if str(x).strip()]
    return out or None


class RoutineSlotInput(BaseModel):
    weekdays: List[int] = Field(min_length=1, max_length=7)
    segment_id: Optional[str] = None          # None = Kapan Saja
    child_id: Optional[str] = None            # None = every child
    title: str = Field(min_length=1, max_length=120)
    duration_minutes: Optional[int] = Field(default=None, ge=1, le=600)
    points: int = Field(default=10, ge=0, le=10000)
    is_bonus: bool = False
    # The child must write what they did/learned before it can be ticked.
    summary_required: bool = False
    summary_prompt: Optional[str] = Field(default=None, max_length=200)
    summary_min_words: Optional[int] = Field(default=None, ge=SUMMARY_MIN_WORDS_FLOOR, le=SUMMARY_MIN_WORDS_CAP)
    summary_questions: Optional[List[str]] = Field(default=None, max_length=MAX_QUESTIONS)
    photo_required: Optional[bool] = None
    before_photo_required: Optional[bool] = None
    reading: Optional[bool] = None
    reading_book: Optional[str] = Field(default=None, max_length=120)
    pet_care: Optional[Literal["food", "water", "play"]] = None  # which pet need the reward feeds
    timed: Optional[bool] = None  # a stopwatch for this activity: starts on "Mulai", stops on "Selesai"
    steps: Optional[List[str]] = Field(default=None, max_length=MAX_STEPS)


class RoutineSlotUpdate(BaseModel):
    segment_id: Optional[str] = None
    child_id: Optional[str] = None
    title: Optional[str] = Field(default=None, min_length=1, max_length=120)
    duration_minutes: Optional[int] = Field(default=None, ge=1, le=600)
    points: Optional[int] = Field(default=None, ge=0, le=10000)
    is_bonus: Optional[bool] = None
    summary_required: Optional[bool] = None
    summary_prompt: Optional[str] = Field(default=None, max_length=200)
    summary_min_words: Optional[int] = Field(default=None, ge=SUMMARY_MIN_WORDS_FLOOR, le=SUMMARY_MIN_WORDS_CAP)
    summary_questions: Optional[List[str]] = Field(default=None, max_length=MAX_QUESTIONS)
    photo_required: Optional[bool] = None
    before_photo_required: Optional[bool] = None
    reading: Optional[bool] = None
    reading_book: Optional[str] = Field(default=None, max_length=120)
    pet_care: Optional[Literal["food", "water", "play"]] = None  # which pet need the reward feeds
    timed: Optional[bool] = None  # a stopwatch for this activity: starts on "Mulai", stops on "Selesai"
    steps: Optional[List[str]] = Field(default=None, max_length=MAX_STEPS)


class RoutineMoveInput(BaseModel):
    direction: Literal["up", "down"]


class RoutineCopyInput(BaseModel):
    from_weekday: int = Field(ge=0, le=6)
    to_weekdays: List[int] = Field(min_length=1, max_length=7)
    replace: bool = True


class RoutineSwapInput(BaseModel):
    start_date: str
    end_date: Optional[str] = None
    use_weekday: int = Field(ge=0, le=6)
    note: str = Field(default="", max_length=100)


class RoutineExtraInput(BaseModel):
    start_date: str
    end_date: Optional[str] = None
    segment_id: Optional[str] = None
    child_id: Optional[str] = None
    title: str = Field(min_length=1, max_length=120)
    duration_minutes: Optional[int] = Field(default=None, ge=1, le=600)
    points: int = Field(default=10, ge=0, le=10000)
    note: str = Field(default="", max_length=100)


ROUTINE_MAX_SPAN_DAYS = 62


async def _routine_template(create: bool = True) -> Optional[dict]:
    tpl = await db.day_templates.find_one({"parent_id": FAMILY_ID, "is_routine": True}, {"_id": 0})
    if tpl or not create:
        return tpl
    tpl = {"id": new_id(), "parent_id": FAMILY_ID, "name": "Rutinitas Mingguan", "emoji": "🗓️",
           "description": "", "is_default": False, "is_routine": True, "created_at": now_iso()}
    await db.day_templates.insert_one(tpl)
    tpl.pop("_id", None)
    return tpl


def _date_span(start: str, end: Optional[str]) -> List[str]:
    s = validate_date_key(start)
    e = validate_date_key(end) if end else s
    if not s or not e:
        raise HTTPException(status_code=422, detail="Tanggal tidak valid (YYYY-MM-DD)")
    if e < s:
        raise HTTPException(status_code=422, detail="Tanggal akhir harus sesudah/sama dengan tanggal mulai")
    d0 = datetime.strptime(s, "%Y-%m-%d")
    n = (datetime.strptime(e, "%Y-%m-%d") - d0).days + 1
    if n > ROUTINE_MAX_SPAN_DAYS:
        raise HTTPException(status_code=422, detail=f"Maksimal {ROUTINE_MAX_SPAN_DAYS} hari sekaligus")
    return [(d0 + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(n)]


async def _check_segment_and_child(segment_id: Optional[str], child_id: Optional[str]):
    if segment_id:
        await _refresh_segments_cache()
        if not any(sg["id"] == segment_id for sg in await _get_day_segments()):
            raise HTTPException(status_code=404, detail="Bagian waktu tidak ditemukan")
    if child_id:
        await get_child_or_404(FAMILY_ID, child_id)


async def _ensure_day_built(dk: str) -> int:
    """Create a day's activities from the routine, once. Past days are never
    back-filled, and the build is idempotent per routine slot, so a repeat or a
    race can't produce duplicates."""
    if not dk or dk < _today_key():
        return 0
    if (await get_config_cached()).get("vacation_mode"):
        return 0  # paused: no new days are built until the family is back
    tpl = await _routine_template(create=False)
    if not tpl:
        return 0
    if await db.day_builds.find_one({"parent_id": FAMILY_ID, "date_key": dk}):
        return 0
    try:
        await db.day_builds.insert_one({"parent_id": FAMILY_ID, "date_key": dk, "built_at": now_iso()})
    except Exception:  # noqa: BLE001 — another request is building this day
        return 0
    try:
        swap = await db.routine_swaps.find_one(
            {"parent_id": FAMILY_ID, "start_date": {"$lte": dk}, "end_date": {"$gte": dk}}, {"_id": 0})
        weekday = swap["use_weekday"] if swap else datetime.strptime(dk, "%Y-%m-%d").weekday()
        slots = await db.template_tasks.find(
            {"parent_id": FAMILY_ID, "template_id": tpl["id"], "weekday": weekday}, {"_id": 0}).to_list(2000)
        if not slots:
            return 0
        await _refresh_segments_cache()
        segments = await _get_day_segments()
        offs = await _off_days_covering(dk)
        existing = {(t.get("from_routine_slot_id"), t.get("child_id")) for t in await db.tasks.find(
            {"parent_id": FAMILY_ID, "date_key": dk, "from_routine_slot_id": {"$exists": True}},
            {"_id": 0, "from_routine_slot_id": 1, "child_id": 1}).to_list(5000)}
        kids = [k["id"] for k in await db.children.find({"parent_id": FAMILY_ID}, {"_id": 0, "id": 1}).to_list(50)]
        docs = []
        for sl in slots:
            rank = _segment_rank(segments, sl.get("segment_id"))
            if any(_off_covers(o, dk, rank, segments) for o in offs):
                continue
            for cid in ([sl["child_id"]] if sl.get("child_id") else kids):
                if (sl["id"], cid) in existing:
                    continue
                docs.append({
                    "id": new_id(), "parent_id": FAMILY_ID, "child_id": cid,
                    "title": sl["title"], "description": sl.get("description", ""),
                    "points": sl.get("points", 10), "penalty_points": 0,
                    "duration_minutes": sl.get("duration_minutes"),
                    "segment_id": sl.get("segment_id"), "order": sl.get("order") or 1,
                    "is_bonus": bool(sl.get("is_bonus")), "date_key": dk,
                    "recurrence": "none", "status": "pending", "created_at": now_iso(),
                    "from_routine_slot_id": sl["id"], "from_routine": True,
                    **{f: sl.get(f) for f in _PROOF_FIELDS},
                })
        if docs:
            await db.tasks.insert_many(docs)
        return len(docs)
    except Exception:
        await db.day_builds.delete_many({"parent_id": FAMILY_ID, "date_key": dk})
        raise


async def _invalidate_days(start: str, end: Optional[str] = None, include_today: bool = True) -> int:
    """Forget built days so they rebuild from the current routine/exceptions.
    Only untouched routine activities are removed, never anything a child has
    started or ticked, and never a section already in progress."""
    _invalidate_days_ready()  # the routine/exceptions changed: re-check near days
    today = _today_key()
    lo = start if start > today else (today if include_today else
                                      (datetime.strptime(today, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d"))
    q_dates = {"$gte": lo} if end is None else {"$gte": lo, "$lte": end}
    if end is not None and end < lo:
        return 0
    started = {(s["child_id"], s["date_key"], s["segment_id"]) for s in await db.segment_sessions.find(
        {"parent_id": FAMILY_ID, "date_key": q_dates, "started_at": {"$nin": [None, ""]}},
        {"_id": 0, "child_id": 1, "date_key": 1, "segment_id": 1}).to_list(5000)}
    rows = await db.tasks.find({
        "parent_id": FAMILY_ID, "date_key": q_dates, "from_routine": True,
        "status": {"$in": ["pending", "rejected"]}, "checked": {"$ne": True},
    }, {"_id": 0, "id": 1, "child_id": 1, "date_key": 1, "segment_id": 1}).to_list(20000)
    doomed = [r["id"] for r in rows
              if (r["child_id"], r["date_key"], r.get("segment_id") or ANYTIME_SEGMENT_ID) not in started]
    if doomed:
        await db.tasks.delete_many({"parent_id": FAMILY_ID, "id": {"$in": doomed}})
    await db.day_builds.delete_many({"parent_id": FAMILY_ID, "date_key": q_dates})
    return len(doomed)


async def _migrate_legacy_to_routine() -> Optional[dict]:
    """One-time conversion of the old per-task schedule into the weekly routine.

    Repeating missions (daily/weekly) and any default-template slots become
    routine activities. Identical activities for every child are merged into one
    'Semua anak' row; exact duplicates collapse. Untouched FUTURE copies of the
    old repeating missions are removed (the routine rebuilds them); today and
    anything already worked on is left exactly as it is.
    """
    if await db.app_meta.find_one({"_id": "routine_migrated"}):
        return None
    tpl = await _routine_template(create=True)
    today = _today_key()
    summary = {"slots": 0, "removed_future": 0, "sources": 0}
    if not await db.template_tasks.find_one({"parent_id": FAMILY_ID, "template_id": tpl["id"]}):
        await _refresh_segments_cache()
        segments = await _get_day_segments()
        kids = [k["id"] for k in await db.children.find({"parent_id": FAMILY_ID}, {"_id": 0, "id": 1}).to_list(50)]
        cands = []
        legacy = await db.tasks.find(
            {"parent_id": FAMILY_ID, "recurrence": {"$in": ["daily", "weekly"]}}, {"_id": 0}).to_list(20000)
        latest: dict = {}
        for t in legacy:
            seg = _segment_for_task(t, segments)
            wds = list(range(7)) if t.get("recurrence") == "daily" else \
                [datetime.strptime(t["date_key"], "%Y-%m-%d").weekday()] if t.get("date_key") else []
            owners = t.get("coop_participants") or [t.get("child_id")]
            for wd in wds:
                for cid in owners:
                    key = (wd, seg["id"] if seg else None, t.get("title"), cid, bool(t.get("is_bonus")))
                    if key not in latest or (t.get("date_key") or "") > (latest[key].get("date_key") or ""):
                        latest[key] = {**t, "_wd": wd, "_seg": seg["id"] if seg else None, "_cid": cid}
        for t in latest.values():
            cands.append({"weekday": t["_wd"], "segment_id": t["_seg"], "child_id": t["_cid"],
                          "title": t.get("title"), "points": t.get("points", 10),
                          "duration_minutes": t.get("duration_minutes"),
                          "is_bonus": bool(t.get("is_bonus")), "order": t.get("order") or 0})
        dflt = await db.day_templates.find_one(
            {"parent_id": FAMILY_ID, "is_default": True, "is_routine": {"$ne": True}}, {"_id": 0})
        if dflt:
            for sl in await db.template_tasks.find(
                    {"parent_id": FAMILY_ID, "template_id": dflt["id"]}, {"_id": 0}).to_list(5000):
                for cid in ([sl["child_id"]] if sl.get("child_id") else kids):
                    cands.append({"weekday": sl["weekday"], "segment_id": sl.get("segment_id"),
                                  "child_id": cid, "title": sl["title"], "points": sl.get("points", 10),
                                  "duration_minutes": sl.get("duration_minutes"),
                                  "is_bonus": bool(sl.get("is_bonus")), "order": sl.get("order") or 0})
        summary["sources"] = len(cands)
        groups: dict = {}
        for c in cands:
            k = (c["weekday"], c["segment_id"], c["title"], c["is_bonus"], c["points"], c["duration_minutes"])
            g = groups.setdefault(k, {**c, "children": set(), "order": c["order"]})
            g["children"].add(c["child_id"])
            g["order"] = min(g["order"], c["order"]) if g["order"] else c["order"]
        rows = []
        for g in groups.values():
            if set(kids) and set(kids) <= g["children"]:
                rows.append({**g, "child_id": None})
            else:
                rows.extend({**g, "child_id": cid} for cid in sorted(c for c in g["children"] if c))
        rows.sort(key=lambda r: (r["weekday"], str(r["segment_id"]), r["order"] or 0, r["title"]))
        counters: dict = {}
        docs = []
        for r in rows:
            n = counters.get((r["weekday"], r["segment_id"]), 0) + 1
            counters[(r["weekday"], r["segment_id"])] = n
            docs.append({"id": new_id(), "parent_id": FAMILY_ID, "template_id": tpl["id"],
                         "weekday": r["weekday"], "segment_id": r["segment_id"], "child_id": r["child_id"],
                         "title": r["title"], "points": r["points"], "duration_minutes": r["duration_minutes"],
                         "is_bonus": r["is_bonus"], "order": n, "created_at": now_iso()})
        if docs:
            await db.template_tasks.insert_many(docs)
        summary["slots"] = len(docs)
        res = await db.tasks.delete_many({
            "parent_id": FAMILY_ID, "date_key": {"$gt": today},
            "$or": [{"recurrence": {"$in": ["daily", "weekly"]}}, {"from_template_id": {"$exists": True}}],
            "status": {"$in": ["pending", "rejected"]}, "checked": {"$ne": True},
            "timer_started_at": {"$in": [None, ""]},
        })
        summary["removed_future"] = res.deleted_count
        await db.tasks.update_many({"parent_id": FAMILY_ID, "recurrence": {"$in": ["daily", "weekly"]}},
                                   {"$set": {"recurrence": "none", "migrated_to_routine": True}})
    # Today already has its missions; mark it built so nothing is doubled.
    if await db.tasks.find_one({"parent_id": FAMILY_ID, "date_key": today}):
        try:
            await db.day_builds.insert_one({"parent_id": FAMILY_ID, "date_key": today, "built_at": now_iso()})
        except Exception:  # noqa: BLE001
            pass
    await db.app_meta.update_one({"_id": "routine_migrated"},
                                 {"$set": {"at": now_iso(), **summary}}, upsert=True)
    await log_activity(FAMILY_ID, None, "routine_migrated", summary)
    return summary


# Fields that only meant something to the old per-mission flow (a clock per
# mission, snoozing, holds, overtime, repeating series). Open missions lose
# them; finished ones keep them as history.
_LEGACY_TASK_FIELDS = (
    "due_time", "due_date", "max_snooze_minutes", "min_duration_minutes", "rush_message",
    "overtime_allowed", "overtime_bonus_points", "snooze_until", "snooze_count",
    "hold_status", "hold_reason", "hold_minutes", "hold_requested_at", "hold_until",
    "timer_started_at", "timer_completed_at",
)
# Settings that steered that flow.
_LEGACY_CONFIG_FIELDS = (
    "min_gap_seconds", "flash_threshold_pct", "pacing_bonus_points", "notify_parent_on_start",
    "auto_start_next", "snooze_options_minutes", "duration_warning_minutes",
    "bonus_follows_sequence", "max_idle_minutes", "overtime_bonus_interval_minutes",
    "hold_auto_reject_minutes", "early_bonus_pct", "skip_cost_points", "last_materialize_at",
)


async def _cleanup_legacy_schedule() -> Optional[dict]:
    """One-time removal of the old schedule machinery's leftovers, after the
    weekly routine took over. Everything removed is copied to `legacy_archive`
    first, so nothing is lost."""
    if await db.app_meta.find_one({"_id": "legacy_cleanup_v1"}):
        return None
    summary: dict = {}
    routine = await _routine_template(create=False)
    rid = routine["id"] if routine else None

    async def archive(kind: str, coll, query: dict) -> int:
        rows = await coll.find(query, {"_id": 0}).to_list(None)
        if rows:
            await db.legacy_archive.insert_many(
                [{"kind": kind, "archived_at": now_iso(), "doc": r} for r in rows])
            await coll.delete_many(query)
        return len(rows)

    old_tpl_ids = [t["id"] for t in await db.day_templates.find(
        {"parent_id": FAMILY_ID, "is_routine": {"$ne": True}}, {"_id": 0, "id": 1}).to_list(None)]
    summary["template_slots"] = await archive(
        "template_task", db.template_tasks,
        {"parent_id": FAMILY_ID, "template_id": {"$nin": [rid] if rid else []}})
    summary["templates"] = await archive(
        "day_template", db.day_templates, {"parent_id": FAMILY_ID, "id": {"$in": old_tpl_ids}})
    summary["assignments"] = await archive(
        "template_assignment", db.template_assignments, {"parent_id": FAMILY_ID})
    summary["task_bundles"] = await archive("routine_template", db.routine_templates, {"parent_id": FAMILY_ID})
    summary["late_exceptions"] = await archive("late_exception", db.late_exceptions, {"parent_id": FAMILY_ID})
    # Untouched future copies of the old repeating missions: the routine
    # builds those days now.
    summary["future_copies"] = await archive("task", db.tasks, {
        "parent_id": FAMILY_ID, "date_key": {"$gt": _today_key()}, "from_routine": {"$ne": True},
        "$or": [{"recurrence": {"$in": ["daily", "weekly"]}}, {"migrated_to_routine": True},
                {"from_template_id": {"$exists": True}}],
        "status": {"$in": ["pending", "rejected"]}, "checked": {"$ne": True},
    })
    res = await db.tasks.update_many(
        {"parent_id": FAMILY_ID, "status": {"$in": ["pending", "rejected"]}},
        {"$unset": {f: "" for f in _LEGACY_TASK_FIELDS}, "$set": {"recurrence": "none"}},
    )
    summary["open_tasks_cleaned"] = res.modified_count
    await db.tasks.update_many({"parent_id": FAMILY_ID, "recurrence": {"$in": ["daily", "weekly"]}},
                               {"$set": {"recurrence": "none"}})
    await _write_config({"$unset": {f: "" for f in _LEGACY_CONFIG_FIELDS}}, upsert=False)
    _invalidate_config_cache()
    await db.app_meta.update_one({"_id": "legacy_cleanup_v1"},
                                 {"$set": {"at": now_iso(), **summary}}, upsert=True)
    await log_activity(FAMILY_ID, None, "legacy_schedule_cleaned", summary)
    return summary


def _slot_out(sl: dict) -> dict:
    return {k: sl.get(k) for k in ("id", "weekday", "segment_id", "child_id", "title",
                                   "duration_minutes", "points", "is_bonus", "order", *_PROOF_FIELDS)}


@api.get("/routine")
async def get_routine(user: dict = Depends(require_parent)):
    migrated = await _migrate_legacy_to_routine()
    tpl = await _routine_template(create=True)
    await _refresh_segments_cache()
    segments = sorted(await _get_day_segments(), key=lambda x: _hhmm_to_min(x["start_time"]))
    slots = await db.template_tasks.find(
        {"parent_id": FAMILY_ID, "template_id": tpl["id"]}, {"_id": 0}).to_list(5000)
    pos = {sg["id"]: i for i, sg in enumerate(segments)}
    slots.sort(key=lambda s: (s["weekday"], pos.get(s.get("segment_id"), 99), s.get("order") or 0))
    return {"segments": segments, "slots": [_slot_out(s) for s in slots], "migrated": migrated}


async def _next_order(tpl_id: str, wd: int, seg: Optional[str]) -> int:
    rows = await db.template_tasks.find({"parent_id": FAMILY_ID, "template_id": tpl_id, "weekday": wd,
                                         "segment_id": seg}, {"_id": 0, "order": 1}).to_list(500)
    return max([r.get("order") or 0 for r in rows], default=0) + 1


@api.post("/routine/slots")
async def add_routine_slot(payload: RoutineSlotInput, user: dict = Depends(require_parent)):
    await _check_segment_and_child(payload.segment_id, payload.child_id)
    if any(w < 0 or w > 6 for w in payload.weekdays):
        raise HTTPException(status_code=422, detail="Hari tidak valid")
    tpl = await _routine_template()
    made = []
    for wd in sorted(set(payload.weekdays)):
        doc = {"id": new_id(), "parent_id": FAMILY_ID, "template_id": tpl["id"], "weekday": wd,
               "segment_id": payload.segment_id, "child_id": payload.child_id,
               "title": payload.title.strip(), "duration_minutes": payload.duration_minutes,
               "points": payload.points, "is_bonus": payload.is_bonus,
               "summary_required": payload.summary_required,
               "summary_prompt": (payload.summary_prompt or "").strip() or None,
               "summary_min_words": payload.summary_min_words,
               "summary_questions": _clean_list(payload.summary_questions),
               "photo_required": bool(payload.photo_required),
               "before_photo_required": bool(payload.before_photo_required),
               "reading": bool(payload.reading),
               "reading_book": (payload.reading_book or "").strip() or None,
        "pet_care": payload.pet_care or None,
        "timed": bool(payload.timed),
               "steps": _clean_list(payload.steps),
               "order": await _next_order(tpl["id"], wd, payload.segment_id), "created_at": now_iso()}
        await db.template_tasks.insert_one(doc)
        made.append(_slot_out(doc))
    await _invalidate_days(_today_key(), include_today=False)
    return {"created": made}


@api.patch("/routine/slots/{slot_id}")
async def edit_routine_slot(slot_id: str, payload: RoutineSlotUpdate, user: dict = Depends(require_parent)):
    tpl = await _routine_template()
    sl = await db.template_tasks.find_one({"id": slot_id, "parent_id": FAMILY_ID, "template_id": tpl["id"]})
    if not sl:
        raise HTTPException(status_code=404, detail="Aktivitas tidak ditemukan")
    raw = payload.model_dump(exclude_unset=True)
    upd = {k: v for k, v in raw.items()
           if v is not None or k in ("segment_id", "child_id", "duration_minutes", "summary_prompt", "summary_min_words",
                                     "summary_questions", "reading_book", "steps")}
    if "summary_prompt" in upd:
        upd["summary_prompt"] = (upd["summary_prompt"] or "").strip() or None
    for f in ("summary_questions", "steps"):
        if f in upd:
            upd[f] = _clean_list(upd[f])
    if "reading_book" in upd:
        upd["reading_book"] = (upd["reading_book"] or "").strip() or None
    if "title" in upd:
        upd["title"] = upd["title"].strip()
    await _check_segment_and_child(upd.get("segment_id"), upd.get("child_id"))
    if "segment_id" in upd and upd["segment_id"] != sl.get("segment_id"):
        upd["order"] = await _next_order(tpl["id"], sl["weekday"], upd["segment_id"])
    if upd:
        await db.template_tasks.update_one({"id": slot_id}, {"$set": upd})
        await _invalidate_days(_today_key(), include_today=False)
    return _slot_out(await db.template_tasks.find_one({"id": slot_id}, {"_id": 0}))


@api.delete("/routine/slots/{slot_id}")
async def delete_routine_slot(slot_id: str, user: dict = Depends(require_parent)):
    tpl = await _routine_template()
    res = await db.template_tasks.delete_one({"id": slot_id, "parent_id": FAMILY_ID, "template_id": tpl["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Aktivitas tidak ditemukan")
    await _invalidate_days(_today_key(), include_today=False)
    return {"success": True}


@api.post("/routine/slots/{slot_id}/move")
async def move_routine_slot(slot_id: str, payload: RoutineMoveInput, user: dict = Depends(require_parent)):
    tpl = await _routine_template()
    sl = await db.template_tasks.find_one({"id": slot_id, "parent_id": FAMILY_ID, "template_id": tpl["id"]}, {"_id": 0})
    if not sl:
        raise HTTPException(status_code=404, detail="Aktivitas tidak ditemukan")
    sib = await db.template_tasks.find({"parent_id": FAMILY_ID, "template_id": tpl["id"], "weekday": sl["weekday"],
                                        "segment_id": sl.get("segment_id")}, {"_id": 0}).to_list(500)
    sib.sort(key=lambda x: (x.get("order") or 0, x.get("created_at") or ""))
    i = next(n for n, x in enumerate(sib) if x["id"] == slot_id)
    j = i - 1 if payload.direction == "up" else i + 1
    if 0 <= j < len(sib):
        sib[i], sib[j] = sib[j], sib[i]
        for n, x in enumerate(sib, start=1):
            await db.template_tasks.update_one({"id": x["id"]}, {"$set": {"order": n}})
        await _invalidate_days(_today_key(), include_today=False)
    return {"success": True}


@api.post("/routine/copy-day")
async def copy_routine_day(payload: RoutineCopyInput, user: dict = Depends(require_parent)):
    tpl = await _routine_template()
    src = await db.template_tasks.find({"parent_id": FAMILY_ID, "template_id": tpl["id"],
                                        "weekday": payload.from_weekday}, {"_id": 0}).to_list(500)
    targets = sorted({w for w in payload.to_weekdays if 0 <= w <= 6 and w != payload.from_weekday})
    if not targets:
        raise HTTPException(status_code=422, detail="Pilih minimal satu hari tujuan yang berbeda")
    copied = 0
    for wd in targets:
        if payload.replace:
            await db.template_tasks.delete_many({"parent_id": FAMILY_ID, "template_id": tpl["id"], "weekday": wd})
        for sl in src:
            await db.template_tasks.insert_one({**sl, "id": new_id(), "weekday": wd, "created_at": now_iso(),
                                                "order": sl.get("order") if payload.replace else
                                                await _next_order(tpl["id"], wd, sl.get("segment_id"))})
            copied += 1
    await _invalidate_days(_today_key(), include_today=False)
    return {"success": True, "copied": copied, "to_weekdays": targets}


class RoutineCopyChildInput(BaseModel):
    from_child_id: str
    to_child_ids: List[str] = Field(min_length=1, max_length=20)
    weekdays: Optional[List[int]] = None     # default: every day
    segment_id: Optional[str] = None         # default: every section ("__anytime__" = Kapan Saja)
    slot_ids: Optional[List[str]] = None     # copy just these activities
    # "add": keep what the other child already has, skip same-named ones;
    # "replace": the other child's own activities in that scope are replaced.
    mode: Literal["add", "replace"] = "add"


@api.post("/routine/copy-child")
async def copy_routine_to_child(payload: RoutineCopyChildInput, user: dict = Depends(require_parent)):
    """Copy one child's own routine activities to a sibling, so a parent
    doesn't type the same list twice. Activities meant for every child are
    already shared and are not copied."""
    await get_child_or_404(FAMILY_ID, payload.from_child_id)
    targets = [t for t in dict.fromkeys(payload.to_child_ids) if t != payload.from_child_id]
    if not targets:
        raise HTTPException(status_code=422, detail="Pilih anak tujuan yang berbeda")
    for t in targets:
        await get_child_or_404(FAMILY_ID, t)
    if payload.weekdays is not None and any(w < 0 or w > 6 for w in payload.weekdays):
        raise HTTPException(status_code=422, detail="Hari tidak valid")
    tpl = await _routine_template()
    q: dict = {"parent_id": FAMILY_ID, "template_id": tpl["id"], "child_id": payload.from_child_id}
    if payload.weekdays is not None:
        q["weekday"] = {"$in": sorted(set(payload.weekdays))}
    if payload.segment_id:
        q["segment_id"] = None if payload.segment_id == ANYTIME_SEGMENT_ID else payload.segment_id
    if payload.slot_ids is not None:
        q["id"] = {"$in": payload.slot_ids}
    src = await db.template_tasks.find(q, {"_id": 0}).to_list(2000)
    if not src:
        raise HTTPException(status_code=404, detail="Tidak ada aktivitas khusus anak ini untuk disalin")
    src.sort(key=lambda x: (x["weekday"], str(x.get("segment_id")), x.get("order") or 0))
    scopes = {(x["weekday"], x.get("segment_id")) for x in src}
    copied = skipped = removed = 0
    for cid in targets:
        if payload.mode == "replace" and payload.slot_ids is None:
            for wd, seg in scopes:
                res = await db.template_tasks.delete_many({"parent_id": FAMILY_ID, "template_id": tpl["id"],
                                                           "child_id": cid, "weekday": wd, "segment_id": seg})
                removed += res.deleted_count
        have = {(x["weekday"], x.get("segment_id"), (x.get("title") or "").strip().lower())
                for x in await db.template_tasks.find(
                    {"parent_id": FAMILY_ID, "template_id": tpl["id"],
                     "$or": [{"child_id": cid}, {"child_id": None}]},
                    {"_id": 0, "weekday": 1, "segment_id": 1, "title": 1}).to_list(5000)}
        for sl in src:
            key = (sl["weekday"], sl.get("segment_id"), (sl.get("title") or "").strip().lower())
            if key in have:
                skipped += 1
                continue
            await db.template_tasks.insert_one({
                **{k: v for k, v in sl.items() if k != "_id"}, "id": new_id(), "child_id": cid,
                "order": await _next_order(tpl["id"], sl["weekday"], sl.get("segment_id")),
                "created_at": now_iso(), "copied_from_slot_id": sl["id"],
            })
            have.add(key)
            copied += 1
    await _invalidate_days(_today_key(), include_today=False)
    await log_activity(FAMILY_ID, payload.from_child_id, "routine_copied_to_child",
                       {"to": targets, "copied": copied, "skipped": skipped, "removed": removed})
    return {"success": True, "copied": copied, "skipped": skipped, "removed": removed}


class RoutineCopyItemsInput(BaseModel):
    slot_ids: List[str] = Field(min_length=1, max_length=500)  # what to copy (a whole section = all its ids)
    to_weekdays: Optional[List[int]] = Field(default=None, max_length=7)   # default: the activity's own day
    to_child_ids: Optional[List[str]] = Field(default=None, max_length=20)  # default: the activity's own child
    # "add": same-titled activities already there are skipped;
    # "replace": the target's activities in each copied section are replaced first.
    mode: Literal["add", "replace"] = "add"


@api.post("/routine/copy-items")
async def copy_routine_items(payload: RoutineCopyItemsInput, user: dict = Depends(require_parent)):
    """Copy picked activities (or a whole section) to other days and/or to
    another child. Everything a mission carries — points, proof options,
    steps, quiz — comes along. Activities shared by every child stay shared
    when copied to another day; they are not duplicated per child."""
    tpl = await _routine_template()
    src = await db.template_tasks.find({"parent_id": FAMILY_ID, "template_id": tpl["id"],
                                        "id": {"$in": payload.slot_ids}}, {"_id": 0}).to_list(500)
    if not src:
        raise HTTPException(status_code=404, detail="Aktivitas yang dipilih tidak ditemukan")
    days = sorted(set(payload.to_weekdays)) if payload.to_weekdays is not None else None
    if days is not None and (not days or any(d < 0 or d > 6 for d in days)):
        raise HTTPException(status_code=422, detail="Pilih hari tujuan yang valid")
    kids = list(dict.fromkeys(payload.to_child_ids)) if payload.to_child_ids is not None else None
    if kids is not None and not kids:
        raise HTTPException(status_code=422, detail="Pilih anak tujuan")
    for k in kids or []:
        await get_child_or_404(FAMILY_ID, k)
    if days is None and kids is None:
        raise HTTPException(status_code=422, detail="Pilih hari atau anak tujuan")
    src.sort(key=lambda x: (x["weekday"], str(x.get("segment_id")), x.get("order") or 0))

    # Every (activity, day, child) it should land on, minus itself.
    plan = []
    shared_skipped = 0
    for sl in src:
        for wd in (days if days is not None else [sl["weekday"]]):
            for cid in (kids if kids is not None else [sl.get("child_id")]):
                if cid and kids is not None and not sl.get("child_id"):
                    shared_skipped += 1   # already seen by every child
                    continue
                if wd == sl["weekday"] and cid == sl.get("child_id"):
                    continue
                plan.append((sl, wd, cid))
    if not plan:
        raise HTTPException(status_code=422, detail="Tujuannya sama dengan sumbernya — pilih hari atau anak lain")

    removed = copied = skipped = 0
    if payload.mode == "replace":
        scopes = {(wd, sl.get("segment_id"), cid) for sl, wd, cid in plan}
        for wd, seg, cid in scopes:
            res = await db.template_tasks.delete_many({"parent_id": FAMILY_ID, "template_id": tpl["id"],
                                                       "weekday": wd, "segment_id": seg, "child_id": cid,
                                                       "id": {"$nin": payload.slot_ids}})
            removed += res.deleted_count
    existing = await db.template_tasks.find({"parent_id": FAMILY_ID, "template_id": tpl["id"]},
                                            {"_id": 0, "weekday": 1, "segment_id": 1, "title": 1, "child_id": 1}).to_list(10000)

    def taken(wd, seg, cid, title):
        t = (title or "").strip().lower()
        return any(x["weekday"] == wd and x.get("segment_id") == seg and (x.get("title") or "").strip().lower() == t
                   and (x.get("child_id") == cid or x.get("child_id") is None) for x in existing)

    for sl, wd, cid in plan:
        seg = sl.get("segment_id")
        if taken(wd, seg, cid, sl.get("title")):
            skipped += 1
            continue
        doc = {**sl, "id": new_id(), "weekday": wd, "child_id": cid, "created_at": now_iso(),
               "order": await _next_order(tpl["id"], wd, seg), "copied_from_slot_id": sl["id"]}
        await db.template_tasks.insert_one(dict(doc))
        existing.append({"weekday": wd, "segment_id": seg, "title": sl.get("title"), "child_id": cid})
        copied += 1
    await _invalidate_days(_today_key(), include_today=False)
    await log_activity(FAMILY_ID, None, "routine_items_copied",
                       {"copied": copied, "skipped": skipped, "removed": removed, "days": days, "children": kids})
    return {"success": True, "copied": copied, "skipped": skipped, "removed": removed, "shared_skipped": shared_skipped}


@api.post("/routine/apply-today")
async def apply_routine_today(user: dict = Depends(require_parent)):
    """Routine edits start tomorrow by default; this pulls them into today too,
    leaving any section a child has already started untouched."""
    removed = await _invalidate_days(_today_key(), _today_key(), include_today=True)
    created = await _ensure_day_built(_today_key())
    return {"success": True, "removed": removed, "created": created}


@api.get("/routine/exceptions")
async def list_routine_exceptions(user: dict = Depends(require_parent)):
    today = _today_key()
    offs = await db.off_days.find({"parent_id": FAMILY_ID, "end_date": {"$gte": today}}, {"_id": 0}).to_list(200)
    swaps = await db.routine_swaps.find({"parent_id": FAMILY_ID, "end_date": {"$gte": today}}, {"_id": 0}).to_list(200)
    extras_rows = await db.tasks.find({"parent_id": FAMILY_ID, "extra_group_id": {"$exists": True},
                                       "date_key": {"$gte": today}}, {"_id": 0}).to_list(5000)
    groups: dict = {}
    for t in extras_rows:
        g = groups.setdefault(t["extra_group_id"], {
            "id": t["extra_group_id"], "title": t["title"], "segment_id": t.get("segment_id"),
            "duration_minutes": t.get("duration_minutes"), "points": t.get("points"),
            "child_id": t.get("extra_child_id"), "note": t.get("extra_note", ""),
            "start_date": t["date_key"], "end_date": t["date_key"]})
        g["start_date"] = min(g["start_date"], t["date_key"])
        g["end_date"] = max(g["end_date"], t["date_key"])
    by_start = lambda x: x["start_date"]
    return {"off_days": sorted(offs, key=by_start), "swaps": sorted(swaps, key=by_start),
            "extras": sorted(groups.values(), key=by_start)}


@api.post("/routine/swaps")
async def add_routine_swap(payload: RoutineSwapInput, user: dict = Depends(require_parent)):
    days = _date_span(payload.start_date, payload.end_date)
    clash = await db.routine_swaps.find_one({"parent_id": FAMILY_ID, "start_date": {"$lte": days[-1]},
                                             "end_date": {"$gte": days[0]}})
    if clash:
        raise HTTPException(status_code=409, detail="Sudah ada pergantian jadwal di tanggal itu. Hapus dulu yang lama.")
    doc = {"id": new_id(), "parent_id": FAMILY_ID, "start_date": days[0], "end_date": days[-1],
           "use_weekday": payload.use_weekday, "note": payload.note.strip(), "created_at": now_iso()}
    await db.routine_swaps.insert_one(doc)
    doc.pop("_id", None)
    await _invalidate_days(days[0], days[-1])
    await log_activity(FAMILY_ID, None, "routine_swap_added", {"start": days[0], "end": days[-1],
                                                               "use_weekday": payload.use_weekday})
    return doc


@api.delete("/routine/swaps/{swap_id}")
async def delete_routine_swap(swap_id: str, user: dict = Depends(require_parent)):
    doc = await db.routine_swaps.find_one({"id": swap_id, "parent_id": FAMILY_ID})
    if not doc:
        raise HTTPException(status_code=404, detail="Pergantian jadwal tidak ditemukan")
    await db.routine_swaps.delete_one({"id": swap_id})
    await _invalidate_days(doc["start_date"], doc["end_date"])
    return {"success": True}


@api.post("/routine/extras")
async def add_routine_extra(payload: RoutineExtraInput, user: dict = Depends(require_parent)):
    days = _date_span(payload.start_date, payload.end_date)
    await _check_segment_and_child(payload.segment_id, payload.child_id)
    kids = [payload.child_id] if payload.child_id else \
        [k["id"] for k in await db.children.find({"parent_id": FAMILY_ID}, {"_id": 0, "id": 1}).to_list(50)]
    gid = new_id()
    docs = []
    for dk in days:
        for cid in kids:
            docs.append({"id": new_id(), "parent_id": FAMILY_ID, "child_id": cid, "title": payload.title.strip(),
                         "description": "", "points": payload.points, "penalty_points": 0,
                         "duration_minutes": payload.duration_minutes, "segment_id": payload.segment_id,
                         "order": 999, "is_bonus": False, "date_key": dk,
                         "recurrence": "none", "status": "pending", "created_at": now_iso(),
                         "extra_group_id": gid, "extra_child_id": payload.child_id, "extra_note": payload.note.strip()})
    if docs:
        await db.tasks.insert_many(docs)
    return {"success": True, "id": gid, "created": len(docs), "days": len(days)}


@api.delete("/routine/extras/{group_id}")
async def delete_routine_extra(group_id: str, user: dict = Depends(require_parent)):
    res = await db.tasks.delete_many({"parent_id": FAMILY_ID, "extra_group_id": group_id,
                                      "status": {"$in": ["pending", "rejected"]}, "checked": {"$ne": True}})
    left = await db.tasks.count_documents({"parent_id": FAMILY_ID, "extra_group_id": group_id})
    if res.deleted_count == 0 and left == 0:
        raise HTTPException(status_code=404, detail="Aktivitas khusus tidak ditemukan")
    return {"success": True, "removed": res.deleted_count, "kept_done": left}


# ================= Segment checkpoints =================
# The checkpoint is the SECTION, not the individual activity. A section has a
# start and an end; inside it is a checklist. The child starts the section,
# ticks activities in whatever order suits them, and finishes the section once
# everything required is ticked. Lateness is judged only at the two ends — a
# late start (past the grace window) or a late finish (past the end time) — and
# the end time never moves to accommodate a late start.

ANYTIME_SEGMENT_ID = "__anytime__"
MAX_SEGMENT_GRACE_MINUTES = 15


def _seg_grace(config: dict) -> int:
    """Lateness tolerance, never above the 15-minute ceiling — a value saved
    before the cap existed must not quietly widen it."""
    try:
        return max(0, min(int(config.get("segment_late_grace_minutes", MAX_SEGMENT_GRACE_MINUTES)),
                          MAX_SEGMENT_GRACE_MINUTES))
    except (TypeError, ValueError):
        return MAX_SEGMENT_GRACE_MINUTES


class SegmentActionInput(BaseModel):
    child_id: str
    date_key: str
    segment_id: str
    late_reason_id: Optional[str] = None
    # When the press really happened (ISO time) — sent by a device that was
    # offline and is replaying a queued start/finish. Ignored unless recent.
    happened_at: Optional[str] = None


class ActivityCheckInput(BaseModel):
    checked: bool


class SegmentCheckAllInput(BaseModel):
    child_id: str
    date_key: str
    segment_id: str
    checked: bool = True


def _now_minutes(at: Optional[datetime] = None) -> int:
    n = (at + timedelta(hours=7)) if at else _now_local()
    return n.hour * 60 + n.minute


OFFLINE_REPLAY_MAX = timedelta(hours=12)


def _resolve_happened_at(raw: Optional[str]) -> Optional[datetime]:
    """The moment an offline press really happened, if believable: not in the
    future (a little clock skew allowed) and no older than the replay window.
    Anything else is ignored and the server clock is used, so a wrong device
    clock can never move a press far in time."""
    if not raw:
        return None
    try:
        at = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    if at > now + timedelta(minutes=2) or at < now - OFFLINE_REPLAY_MAX:
        return None
    return min(at, now)


def _segment_bounds(seg: Optional[dict], child: Optional[dict], dk: str):
    """(start_min, end_min) for this child on this day; None for 'anytime'."""
    if not seg:
        return None, None
    return _effective_segment_start(seg, child, dk), _effective_segment_end(seg, child, dk)


def _segment_timing(seg: Optional[dict], child: Optional[dict], dk: str, grace: int,
                    at: Optional[datetime] = None) -> dict:
    """Where the clock stands for one section: can it start yet, would starting
    now (or at `at`, for a replayed offline press) be late, would finishing be
    late."""
    today = (at + timedelta(hours=7)).strftime("%Y-%m-%d") if at else _today_key()
    if not seg:  # 'Kapan Saja' has no clock at all
        return {"locked": dk > today, "late_start": False, "late_finish": False}
    start_min, end_min = _segment_bounds(seg, child, dk)
    if dk > today:
        return {"locked": True, "late_start": False, "late_finish": False}
    if dk < today:
        relaxed = _is_relaxed(dk)
        return {"locked": False, "late_start": not relaxed, "late_finish": not relaxed}
    now = _now_minutes(at)
    if _is_relaxed(dk):  # a relaxed day: sections open as usual, nobody is late
        return {"locked": now < start_min, "late_start": False, "late_finish": False}
    return {
        "locked": now < start_min,
        "late_start": now > start_min + max(0, grace),
        "late_finish": now > end_min,
    }


async def _segment_tasks(child_id: str, dk: str, seg_id: str) -> list:
    query = {
        "parent_id": FAMILY_ID, "date_key": dk, "status": {"$ne": "off"},
        "$or": [{"child_id": child_id}, {"is_coop": True, "coop_participants": child_id}],
    }
    query["segment_id"] = None if seg_id == ANYTIME_SEGMENT_ID else seg_id
    rows = await db.tasks.find(query, {"_id": 0}).to_list(500)
    # A corrected mission is redone on its own ("Perlu dibetulkan"), so it
    # never holds a section's checklist hostage.
    rows = [t for t in rows if not t.get("correction_redo")]
    rows.sort(key=lambda t: (t.get("order") or 0, t.get("created_at") or ""))
    return rows


async def _get_session(child_id: str, dk: str, seg_id: str) -> Optional[dict]:
    return await db.segment_sessions.find_one(
        {"parent_id": FAMILY_ID, "child_id": child_id, "date_key": dk, "segment_id": seg_id},
        {"_id": 0},
    )


async def _apply_late_reason(child_id: str, reason: dict, config: dict) -> dict:
    """Charge a lateness reason to the child: a penalty card when the reason is
    at-fault, and a punishment once the threshold is reached."""
    cards = None
    if reason.get("gives_penalty_card"):
        child = await db.children.find_one({"id": child_id})
        cards = int((child or {}).get("penalty_cards", 0)) + 1
        await db.children.update_one({"id": child_id}, {"$set": {"penalty_cards": cards}})
        threshold = int(config.get("penalty_card_threshold", DEFAULT_PENALTY_CARD_THRESHOLD))
        if cards >= threshold:
            await _issue_punishment({**(child or {}), "id": child_id}, config, cards)
    return {"penalty_cards": cards}


def _find_reason(config: dict, reason_id: Optional[str]) -> Optional[dict]:
    if not reason_id:
        return None
    reasons = config.get("late_reasons") or DEFAULT_LATE_REASONS
    return next((r for r in reasons if r.get("id") == reason_id), None)


def _resolve_segment(segments: list, seg_id: str) -> Optional[dict]:
    if seg_id == ANYTIME_SEGMENT_ID:
        return None
    seg = next((s for s in segments if s.get("id") == seg_id), None)
    if not seg:
        raise HTTPException(status_code=404, detail="Bagian waktu tidak ditemukan")
    return seg


def _assert_can_act(user: dict, child_id: str):
    if user["role"] == "child" and user["id"] != child_id:
        raise HTTPException(status_code=403, detail="Bukan bagianmu")


@api.get("/children/{child_id}/segments-day")
async def segments_day(child_id: str, date_key: Optional[str] = None, user: dict = Depends(get_current_user)):
    """Everything the child's checklist screen needs, in one response."""
    child = await get_child_or_404(FAMILY_ID, child_id)
    if user["role"] == "child" and user["id"] != child_id:
        raise HTTPException(status_code=403, detail="Bukan milikmu")
    dk = validate_date_key(date_key) if date_key else _today_key()
    if not dk:
        raise HTTPException(status_code=422, detail="Tanggal tidak valid")
    await _ensure_day_built(dk)
    await _refresh_segments_cache()
    config = await get_config_cached()
    grace = _seg_grace(config)
    segments = sorted(await _get_day_segments(), key=lambda x: _hhmm_to_min(x["start_time"]))

    _sd_q = {
        "parent_id": FAMILY_ID, "date_key": dk, "status": {"$ne": "off"},
        "$or": [{"child_id": child_id}, {"is_coop": True, "coop_participants": child_id}],
    }
    tasks = await db.tasks.find(_sd_q, {"_id": 0}).to_list(1000)
    if not tasks and dk in _near_days():
        # Same reasoning as day-progress: an empty near day is built inline.
        if await _ensure_days_ready([dk], trust_marker=False):
            tasks = await db.tasks.find(_sd_q, {"_id": 0}).to_list(1000)
    else:
        _schedule_materialize()
    tasks = [t for t in tasks if not t.get("correction_redo")]
    sessions = {
        s["segment_id"]: s for s in await db.segment_sessions.find(
            {"parent_id": FAMILY_ID, "child_id": child_id, "date_key": dk}, {"_id": 0}
        ).to_list(50)
    }
    known = {s["id"] for s in segments}
    exam_today = await _active_exam_flex(child_id, dk)
    groups: dict = {}
    for t in tasks:
        sid = t.get("segment_id") if t.get("segment_id") in known else ANYTIME_SEGMENT_ID
        groups.setdefault(sid, []).append(t)

    out = []
    ordered = [(s["id"], s) for s in segments] + [(ANYTIME_SEGMENT_ID, None)]
    for sid, seg in ordered:
        acts = sorted(groups.get(sid, []), key=lambda t: (t.get("order") or 0, t.get("created_at") or ""))
        if not acts:
            continue
        sess = sessions.get(sid) or {}
        timing = _segment_timing(seg, child, dk, grace)
        if exam_today and timing["late_finish"]:
            timing = {**timing, "late_finish": False}
        if sess.get("completed_at"):
            status = "done"
        elif sess.get("started_at"):
            status = "in_progress"
        elif timing["locked"]:
            status = "locked"
        else:
            status = "ready"
        start_min, end_min = _segment_bounds(seg, child, dk)
        required = [a for a in acts if not a.get("is_bonus")]
        out.append({
            "id": sid,
            "label": seg["label"] if seg else "Kapan Saja",
            "emoji": (seg or {}).get("emoji", "✨" if not seg else ""),
            "start_time": _fmt_min(start_min) if seg else None,
            "end_time": _fmt_min(end_min) if seg else None,
            "status": status,
            "late_start": timing["late_start"] and status in ("ready", "locked"),
            "late_finish": timing["late_finish"] and status == "in_progress",
            "started_at": sess.get("started_at"),
            "completed_at": sess.get("completed_at"),
            "start_late": bool(sess.get("start_late")),
            "finish_late": bool(sess.get("finish_late")),
            "late_reason_label": sess.get("late_reason_label"),
            "no_points": bool(sess.get("no_points")),
            "streak": int(((child.get("section_streaks") or {}).get(sid) or {}).get("count") or 0),
            "activities": [{
                "id": a["id"], "title": a["title"], "description": a.get("description", ""),
                "points": a.get("points", 0), "is_bonus": bool(a.get("is_bonus")),
                "duration_minutes": a.get("duration_minutes"),
                "checked": bool(a.get("checked")) or a.get("status") in ("completed", "approved"),
                "status": a.get("status"),
                "photo_required": bool(a.get("photo_required")),
                "summary_required": bool(a.get("summary_required")),
                "summary_prompt": a.get("summary_prompt"),
                "summary_min_words": int(a.get("summary_min_words") or SUMMARY_MIN_WORDS_DEFAULT),
                "summary_text": a.get("summary_text"),
                "summary_review": a.get("summary_review"),
                "summary_note": a.get("summary_note"),
                "summary_questions": a.get("summary_questions") or [],
                "summary_answers": a.get("summary_answers") or [],
                "before_photo_required": bool(a.get("before_photo_required")),
                "reading": bool(a.get("reading")), "reading_book": a.get("reading_book"),
                "reading_page": a.get("reading_page"), "reading_last": (child.get("reading_log") or {}).get(
                    (a.get("reading_book") or "").strip().lower()) if a.get("reading") else None,
                "steps": a.get("steps") or [], "steps_done": a.get("steps_done") or [],
                "pet_care": a.get("pet_care") or "food",
                "timed": bool(a.get("timed")), "timer_started_at": a.get("timer_started_at"),
                "timer_ended_at": a.get("timer_ended_at"), "timer_seconds": a.get("timer_seconds"),
                # Photos as cacheable media URLs, never inline base64.
                "before_photo_url": _media_ref("task", a["id"], "before_photo_url", a.get("before_photo_url")),
                "completion_photo_url": _media_ref("task", a["id"], "completion_photo_url", a.get("completion_photo_url")),
            } for a in acts],
            "required_count": len(required),
            "checked_required": sum(1 for a in required if a.get("checked") or a.get("status") in ("completed", "approved")),
            "points_total": sum(int(a.get("points") or 0) for a in acts if not a.get("is_bonus")),
        })

    return {
        "date_key": dk,
        "grace_minutes": grace,
        "now": _fmt_min(_now_minutes()),
        "segments": out,
        "late_reasons": config.get("late_reasons") or DEFAULT_LATE_REASONS,
    }


@api.post("/segment-sessions/start")
async def start_segment(payload: SegmentActionInput, user: dict = Depends(get_current_user)):
    _assert_can_act(user, payload.child_id)
    child = await get_child_or_404(FAMILY_ID, payload.child_id)
    dk = validate_date_key(payload.date_key)
    if not dk:
        raise HTTPException(status_code=422, detail="Tanggal tidak valid")
    await _refresh_segments_cache()
    config = await get_config_cached()
    seg = _resolve_segment(await _get_day_segments(), payload.segment_id)

    existing = await _get_session(payload.child_id, dk, payload.segment_id)
    if existing and existing.get("completed_at"):
        raise HTTPException(status_code=400, detail="Bagian ini sudah selesai")
    if existing and existing.get("started_at"):
        return existing  # already running — starting twice is harmless

    if not await _segment_tasks(payload.child_id, dk, payload.segment_id):
        raise HTTPException(status_code=400, detail="Tidak ada aktivitas di bagian ini")

    at = _resolve_happened_at(payload.happened_at)
    timing = _segment_timing(seg, child, dk, _seg_grace(config), at)
    if timing["locked"]:
        start_min, _ = _segment_bounds(seg, child, dk)
        raise HTTPException(
            status_code=409,
            detail=f"Belum waktunya — bagian ini mulai jam {_fmt_min(start_min)}." if seg else "Belum waktunya.",
        )

    doc = {
        "parent_id": FAMILY_ID, "child_id": payload.child_id, "date_key": dk,
        "segment_id": payload.segment_id, "started_at": (at.isoformat() if at else now_iso()),
        "start_late": False, "no_points": False,
    }
    if timing["late_start"]:
        reason = _find_reason(config, payload.late_reason_id)
        if not reason:
            raise HTTPException(status_code=409, detail="LATE_REASON_REQUIRED")
        await _apply_late_reason(payload.child_id, reason, config)
        doc.update({
            "start_late": True, "late_reason_id": reason["id"],
            "late_reason_label": reason.get("label"),
            "late_penalized": bool(reason.get("gives_penalty_card")),
            "no_points": not reason.get("award_points", True),
        })
        await log_activity(FAMILY_ID, payload.child_id, "segment_started_late", {
            "segment": (seg or {}).get("label", "Kapan Saja"), "reason": reason.get("label"),
        })
    else:
        await log_activity(FAMILY_ID, payload.child_id, "segment_started", {
            "segment": (seg or {}).get("label", "Kapan Saja"),
        })
    await db.segment_sessions.update_one(
        {"parent_id": FAMILY_ID, "child_id": payload.child_id, "date_key": dk, "segment_id": payload.segment_id},
        {"$set": doc}, upsert=True,
    )
    return await _get_session(payload.child_id, dk, payload.segment_id)


async def _require_running_session(child_id: str, dk: str, seg_id: str) -> dict:
    sess = await _get_session(child_id, dk, seg_id)
    if not sess or not sess.get("started_at"):
        raise HTTPException(status_code=409, detail="Mulai dulu bagian ini ya")
    if sess.get("completed_at"):
        raise HTTPException(status_code=400, detail="Bagian ini sudah selesai")
    return sess


@api.post("/tasks/{task_id}/check")
async def check_activity(task_id: str, payload: ActivityCheckInput, user: dict = Depends(get_current_user)):
    task = await db.tasks.find_one({"id": task_id, "parent_id": FAMILY_ID}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Aktivitas tidak ditemukan")
    owners = task.get("coop_participants") or [task.get("child_id")]
    child_id = user["id"] if user["role"] == "child" else task.get("child_id")
    if user["role"] == "child" and user["id"] not in owners:
        raise HTTPException(status_code=403, detail="Bukan milikmu")
    seg_id = task.get("segment_id") or ANYTIME_SEGMENT_ID
    await _refresh_segments_cache()
    if seg_id != ANYTIME_SEGMENT_ID and not any(s["id"] == seg_id for s in await _get_day_segments()):
        seg_id = ANYTIME_SEGMENT_ID
    await _require_running_session(child_id, task["date_key"], seg_id)
    if payload.checked and task.get("summary_required") and not task.get("summary_text"):
        # The tick comes from writing the summary (POST /tasks/{id}/summary).
        raise HTTPException(status_code=422, detail="SUMMARY_REQUIRED")
    if payload.checked and task.get("reading") and not task.get("reading_page"):
        raise HTTPException(status_code=422, detail="READING_REQUIRED")
    if payload.checked and task.get("steps") and not _steps_complete(task):
        raise HTTPException(status_code=422, detail="STEPS_REQUIRED")
    if payload.checked and task.get("timed") and not task.get("timer_ended_at"):
        raise HTTPException(status_code=422, detail="TIMER_REQUIRED")  # ticked by Mulai → Selesai
    upd = {"checked": payload.checked, "checked_at": now_iso() if payload.checked else None}
    if not payload.checked and task.get("timed"):
        upd.update(_TIMER_CLEAR)   # unticking starts that activity over
    await db.tasks.update_one({"id": task_id}, {"$set": upd})
    return await db.tasks.find_one({"id": task_id}, {"_id": 0})


@api.post("/segment-sessions/check-all")
async def check_all_activities(payload: SegmentCheckAllInput, user: dict = Depends(get_current_user)):
    _assert_can_act(user, payload.child_id)
    dk = validate_date_key(payload.date_key)
    if not dk:
        raise HTTPException(status_code=422, detail="Tanggal tidak valid")
    await _require_running_session(payload.child_id, dk, payload.segment_id)
    ids = [t["id"] for t in await _segment_tasks(payload.child_id, dk, payload.segment_id)
           if t.get("status") in ("pending", "rejected")
           and not (payload.checked and t.get("summary_required") and not t.get("summary_text"))
           and not (payload.checked and t.get("reading") and not t.get("reading_page"))
           and not (payload.checked and t.get("steps") and not _steps_complete(t))
           and not (payload.checked and t.get("timed") and not t.get("timer_ended_at"))]
    if ids:
        await db.tasks.update_many({"id": {"$in": ids}}, {"$set": {
            "checked": payload.checked, "checked_at": now_iso() if payload.checked else None,
        }})
        if not payload.checked:
            await db.tasks.update_many({"id": {"$in": ids}, "timed": True}, {"$set": _TIMER_CLEAR})
    return {"success": True, "updated": len(ids)}


class SummaryInput(BaseModel):
    text: str = Field(default="", max_length=SUMMARY_MAX_CHARS)
    # When the mission has questions (a small quiz), one answer per question.
    answers: Optional[List[str]] = Field(default=None, max_length=MAX_QUESTIONS)
    # Hints from the phone, shown to the parent: was any of it pasted in,
    # and how long was spent writing it.
    pasted: bool = False
    typing_seconds: Optional[int] = Field(default=None, ge=0, le=86400)


def _summary_words(text: str) -> list:
    return re.findall(r"[0-9A-Za-zÀ-ÿ]+", text.lower())


@api.post("/tasks/{task_id}/summary")
async def write_task_summary(task_id: str, payload: SummaryInput, user: dict = Depends(get_current_user)):
    """The child writes what they did or learned; a written summary is what
    ticks a summary mission. Checked for length and for not just repeating
    the same words, so a quick 'aaa aaa aaa' doesn't count."""
    task = await db.tasks.find_one({"id": task_id, "parent_id": FAMILY_ID}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Misi tidak ditemukan")
    owners = task.get("coop_participants") or [task.get("child_id")]
    if user["role"] == "child" and user["id"] not in owners:
        raise HTTPException(status_code=403, detail="Bukan milikmu")
    if not task.get("summary_required"):
        raise HTTPException(status_code=400, detail="Misi ini tidak memakai ringkasan")
    if task.get("status") not in ("pending", "rejected"):
        raise HTTPException(status_code=409, detail="Misi ini sudah ditutup")
    child_id = user["id"] if user["role"] == "child" else task.get("child_id")
    seg_id = task.get("segment_id") or ANYTIME_SEGMENT_ID
    await _refresh_segments_cache()
    if seg_id != ANYTIME_SEGMENT_ID and not any(s["id"] == seg_id for s in await _get_day_segments()):
        seg_id = ANYTIME_SEGMENT_ID
    await _require_running_session(child_id, task["date_key"], seg_id)
    questions = task.get("summary_questions") or []
    answers = [a.strip() for a in (payload.answers or [])]
    if questions:
        if len(answers) != len(questions) or any(len(_summary_words(a)) < 3 for a in answers):
            raise HTTPException(status_code=422, detail="Jawab semua pertanyaannya ya, masing-masing minimal 3 kata")
        text = "\n".join(f"{q}\n→ {a}" for q, a in zip(questions, answers))
        words = _summary_words(" ".join(answers))
    else:
        text = payload.text.strip()
        words = _summary_words(text)
    if not text:
        raise HTTPException(status_code=422, detail="Ringkasannya masih kosong")
    need = int(task.get("summary_min_words") or SUMMARY_MIN_WORDS_DEFAULT)
    if not questions and len(words) < need:  # a quiz is judged per answer above
        raise HTTPException(status_code=422, detail=f"Ringkasannya kurang panjang: {len(words)} dari {need} kata")
    if len(words) >= 8 and len(set(words)) / len(words) < 0.35:
        raise HTTPException(status_code=422, detail="Tulis dengan kalimatmu sendiri ya, jangan diulang-ulang")
    await db.tasks.update_one({"id": task_id}, {"$set": {
        "summary_text": text, "summary_words": len(words), "summary_at": now_iso(),
        "summary_answers": answers if questions else None,
        "summary_pasted": bool(payload.pasted), "summary_typing_seconds": payload.typing_seconds,
        "summary_review": None, "summary_note": None,
        "checked": True, "checked_at": now_iso(),
    }})
    await log_activity(FAMILY_ID, child_id, "summary_written",
                       {"title": task.get("title"), "words": len(words), "pasted": bool(payload.pasted)})
    return await db.tasks.find_one({"id": task_id}, {"_id": 0})


class SummaryReviewInput(BaseModel):
    verdict: Literal["good", "redo"]
    note: str = Field(default="", max_length=300)


@api.post("/tasks/{task_id}/summary-review")
async def review_task_summary(task_id: str, payload: SummaryReviewInput, user: dict = Depends(require_parent)):
    """A parent reads the summary: 👍, or 'tulis ulang'. While the section is
    still open, 'tulis ulang' unticks the mission so the child rewrites it."""
    task = await db.tasks.find_one({"id": task_id, "parent_id": FAMILY_ID}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Misi tidak ditemukan")
    if not task.get("summary_text"):
        raise HTTPException(status_code=400, detail="Belum ada ringkasan untuk dinilai")
    upd = {"summary_review": payload.verdict, "summary_note": payload.note.strip() or None,
           "summary_reviewed_at": now_iso()}
    reopened = False
    if payload.verdict == "redo" and task.get("status") in ("pending", "rejected"):
        upd.update({"checked": False, "checked_at": None, "summary_text": None})
        upd["summary_previous"] = task.get("summary_text")
        reopened = True
    await db.tasks.update_one({"id": task_id}, {"$set": upd})
    owner = task.get("child_id")
    await log_activity(FAMILY_ID, owner, "summary_reviewed",
                       {"title": task.get("title"), "verdict": payload.verdict})
    if payload.verdict == "redo" or payload.note.strip():
        await send_push_to(
            {"role": "child", "member_id": owner},
            title="Tentang ringkasanmu 📝" if payload.verdict == "redo" else "Ringkasanmu sudah dibaca 👍",
            body=payload.note.strip() or ("Tulis ulang ya, lebih lengkap lagi." if reopened else "Bagus!"),
            url=f"/kid/{owner}",
        )
    return {"success": True, "reopened": reopened, "task": await db.tasks.find_one({"id": task_id}, {"_id": 0})}


def _steps_complete(task: dict) -> bool:
    steps = task.get("steps") or []
    done = task.get("steps_done") or []
    return bool(steps) and len(done) >= len(steps) and all(done[:len(steps)])


async def _running_task_for(task_id: str, user: dict) -> tuple:
    """A mission the caller may work on right now: theirs, open, and its
    section started."""
    task = await db.tasks.find_one({"id": task_id, "parent_id": FAMILY_ID}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Misi tidak ditemukan")
    child_id = _task_owner(task, user)
    if task.get("status") not in ("pending", "rejected"):
        raise HTTPException(status_code=409, detail="Misi ini sudah ditutup")
    seg_id = task.get("segment_id") or ANYTIME_SEGMENT_ID
    await _refresh_segments_cache()
    if seg_id != ANYTIME_SEGMENT_ID and not any(s["id"] == seg_id for s in await _get_day_segments()):
        seg_id = ANYTIME_SEGMENT_ID
    await _require_running_session(child_id, task["date_key"], seg_id)
    return task, child_id


class StepInput(BaseModel):
    index: int = Field(ge=0, lt=MAX_STEPS)
    done: bool = True


@api.post("/tasks/{task_id}/steps")
async def tick_task_step(task_id: str, payload: StepInput, user: dict = Depends(get_current_user)):
    """One item of a mission's small checklist (e.g. tas sekolah: buku,
    pensil, botol). The mission ticks itself once every item is done."""
    task, _ = await _running_task_for(task_id, user)
    steps = task.get("steps") or []
    if payload.index >= len(steps):
        raise HTTPException(status_code=404, detail="Langkah tidak ditemukan")
    done = list(task.get("steps_done") or [])
    done += [False] * (len(steps) - len(done))
    done[payload.index] = payload.done
    complete = all(done[:len(steps)])
    await db.tasks.update_one({"id": task_id}, {"$set": {
        "steps_done": done, "checked": complete, "checked_at": now_iso() if complete else None}})
    return await db.tasks.find_one({"id": task_id}, {"_id": 0})


_TIMER_CLEAR = {"timer_started_at": None, "timer_ended_at": None, "timer_seconds": None}
TIMER_MAX_SECONDS = 6 * 3600


@api.post("/tasks/{task_id}/timer/start")
async def start_task_timer(task_id: str, user: dict = Depends(get_current_user)):
    """'Mulai' on a timed activity. The clock is the stored start time, so it
    survives closing the app and costs nothing to keep running."""
    task, _ = await _running_task_for(task_id, user)
    if not task.get("timed"):
        raise HTTPException(status_code=400, detail="Aktivitas ini tidak memakai timer")
    if task.get("timer_ended_at"):
        raise HTTPException(status_code=409, detail="Timer aktivitas ini sudah selesai")
    if task.get("timer_started_at"):
        return {"id": task_id, "timer_started_at": task["timer_started_at"], "already": True}
    at = now_iso()
    await db.tasks.update_one({"id": task_id}, {"$set": {"timer_started_at": at, "timer_ended_at": None, "timer_seconds": None}})
    return {"id": task_id, "timer_started_at": at}


@api.post("/tasks/{task_id}/timer/stop")
async def stop_task_timer(task_id: str, user: dict = Depends(get_current_user)):
    """'Selesai' on a timed activity: stops the clock and ticks the activity."""
    task, _ = await _running_task_for(task_id, user)
    if not task.get("timed"):
        raise HTTPException(status_code=400, detail="Aktivitas ini tidak memakai timer")
    if not task.get("timer_started_at"):
        raise HTTPException(status_code=409, detail="Tekan Mulai dulu ya")
    if task.get("timer_ended_at"):
        return {"id": task_id, "timer_seconds": task.get("timer_seconds"), "already": True}
    started = _hours_since(task["timer_started_at"])
    secs = min(TIMER_MAX_SECONDS, max(1, round((started or 0) * 3600)))
    at = now_iso()
    await db.tasks.update_one({"id": task_id}, {"$set": {
        "timer_ended_at": at, "timer_seconds": secs, "checked": True, "checked_at": at}})
    return {"id": task_id, "timer_started_at": task["timer_started_at"], "timer_ended_at": at,
            "timer_seconds": secs, "checked": True}


class ReadingInput(BaseModel):
    page: int = Field(ge=1, le=5000)
    book: Optional[str] = Field(default=None, max_length=120)
    new_book: bool = False  # starting a different book — earlier pages don't apply


@api.post("/tasks/{task_id}/reading")
async def log_reading(task_id: str, payload: ReadingInput, user: dict = Depends(get_current_user)):
    """A reading mission: the child notes the page they reached. It can't go
    backwards in the same book, which makes 'read' something you can see."""
    task, child_id = await _running_task_for(task_id, user)
    if not task.get("reading"):
        raise HTTPException(status_code=400, detail="Misi ini bukan misi membaca")
    book = (task.get("reading_book") or payload.book or "").strip()
    if not book:
        raise HTTPException(status_code=422, detail="Tulis judul bukunya dulu")
    key = book.lower()
    child = await db.children.find_one({"id": child_id}, {"_id": 0, "reading_log": 1})
    log = dict((child or {}).get("reading_log") or {})
    prev = (log.get(key) or {}).get("page")
    if prev and payload.page <= prev and not payload.new_book:
        raise HTTPException(status_code=422, detail=f"Terakhir kamu sampai halaman {prev} — halamannya harus lebih jauh")
    log[key] = {"book": book, "page": payload.page, "at": now_iso()}
    await db.children.update_one({"id": child_id}, {"$set": {"reading_log": log}})
    await db.reading_history.insert_one({"parent_id": FAMILY_ID, "child_id": child_id, "book": book,
                                         "from_page": None if payload.new_book else prev, "page": payload.page,
                                         "date_key": task.get("date_key"), "task_id": task_id, "at": now_iso()})
    await db.tasks.update_one({"id": task_id}, {"$set": {
        "reading_book": book, "reading_page": payload.page,
        "reading_from_page": None if payload.new_book else prev,
        "checked": True, "checked_at": now_iso()}})
    return await db.tasks.find_one({"id": task_id}, {"_id": 0})


@api.get("/children/{child_id}/reading")
async def child_reading(child_id: str, user: dict = Depends(get_current_user)):
    child = await get_child_or_404(FAMILY_ID, child_id)
    hist = await db.reading_history.find({"child_id": child_id}, {"_id": 0}).sort("at", -1).to_list(60)
    books = sorted((child.get("reading_log") or {}).values(), key=lambda b: b.get("at") or "", reverse=True)
    return {"books": books, "history": hist}


@api.post("/segment-sessions/finish")
async def finish_segment(payload: SegmentActionInput, user: dict = Depends(get_current_user)):
    _assert_can_act(user, payload.child_id)
    child = await get_child_or_404(FAMILY_ID, payload.child_id)
    dk = validate_date_key(payload.date_key)
    if not dk:
        raise HTTPException(status_code=422, detail="Tanggal tidak valid")
    await _refresh_segments_cache()
    config = await get_config_cached()
    seg = _resolve_segment(await _get_day_segments(), payload.segment_id)
    sess = await _require_running_session(payload.child_id, dk, payload.segment_id)

    acts = await _segment_tasks(payload.child_id, dk, payload.segment_id)
    missing_proof = [a for a in acts if not a.get("is_bonus") and a.get("status") in ("pending", "rejected")
                     and ((a.get("reading") and not a.get("reading_page"))
                          or (a.get("steps") and not _steps_complete(a))
                          or (a.get("timed") and not a.get("timer_ended_at")))]
    if missing_proof:
        raise HTTPException(
            status_code=422,
            detail="Lengkapi dulu: " + ", ".join(a["title"] for a in missing_proof[:3]),
        )
    # A summary mission is ticked by writing it, so name it explicitly.
    missing_summary = [a for a in acts if a.get("summary_required") and not a.get("is_bonus")
                       and a.get("status") in ("pending", "rejected") and not a.get("summary_text")]
    if missing_summary:
        raise HTTPException(
            status_code=422,
            detail="Tulis ringkasan dulu untuk: " + ", ".join(a["title"] for a in missing_summary[:3]),
        )
    open_required = [a for a in acts if not a.get("is_bonus")
                     and a.get("status") in ("pending", "rejected") and not a.get("checked")]
    if open_required:
        raise HTTPException(
            status_code=409,
            detail=f"Masih ada {len(open_required)} aktivitas yang belum dicentang",
        )
    # A mission the parent marked "photo required" needs its after-photo
    # before the section can be closed.
    missing_photo = [a for a in acts if a.get("photo_required") and a.get("checked")
                     and a.get("status") in ("pending", "rejected") and not a.get("completion_photo_url")]
    if missing_photo:
        raise HTTPException(
            status_code=422,
            detail="Lampirkan foto sesudah untuk: " + ", ".join(a["title"] for a in missing_photo[:3]),
        )

    at = _resolve_happened_at(payload.happened_at)
    if at and sess.get("started_at"):
        try:
            if at < datetime.fromisoformat(sess["started_at"].replace("Z", "+00:00")):
                at = None  # can't finish before it started
        except ValueError:
            pass
    timing = _segment_timing(seg, child, dk, _seg_grace(config), at)
    # During a declared exam period, studying is expected to run late, so
    # finishing past the end time isn't treated as lateness on those days.
    if timing["late_finish"] and await _active_exam_flex(payload.child_id, dk):
        timing = {**timing, "late_finish": False}
    finish_update = {"completed_at": (at.isoformat() if at else now_iso()), "finish_late": False}
    no_points = bool(sess.get("no_points"))
    if timing["late_finish"]:
        finish_update["finish_late"] = True
        # One lateness, one reason: a section already excused (or charged) at
        # its start isn't charged a second time for the same delay at its end.
        if not sess.get("start_late"):
            reason = _find_reason(config, payload.late_reason_id)
            if not reason:
                raise HTTPException(status_code=409, detail="LATE_REASON_REQUIRED")
            await _apply_late_reason(payload.child_id, reason, config)
            no_points = not reason.get("award_points", True)
            finish_update.update({
                "late_reason_id": reason["id"], "late_reason_label": reason.get("label"),
                "late_penalized": bool(reason.get("gives_penalty_card")), "no_points": no_points,
            })

    # Turn ticked activities into finished missions and award them.
    to_award = [a for a in acts if a.get("status") in ("pending", "rejected") and a.get("checked")]
    # Under a watch period nothing is approved automatically: a parent looks first.
    on_watch = _in_probation(child, dk)
    auto = bool(config.get("auto_approve_tasks", True)) and not on_watch
    awarded = 0
    for a in to_award:
        await db.tasks.update_one({"id": a["id"]}, {"$set": {
            "status": "completed", "completed_at": now_iso(),
            "late_no_points": no_points, "late_ack": bool(finish_update.get("finish_late") or sess.get("start_late")),
            "via_segment": payload.segment_id,
        }})
        if auto and not a.get("photo_required"):
            try:
                await approve_task(a["id"], TaskApproveInput(), {"id": "system", "role": "parent", "name": "Otomatis"})
                awarded += 1
            except HTTPException:
                pass  # left for a parent to approve by hand

    await db.segment_sessions.update_one(
        {"parent_id": FAMILY_ID, "child_id": payload.child_id, "date_key": dk, "segment_id": payload.segment_id},
        {"$set": finish_update},
    )
    await log_activity(FAMILY_ID, payload.child_id, "segment_finished", {
        "segment": (seg or {}).get("label", "Kapan Saja"), "activities": len(to_award),
        "late": finish_update["finish_late"], "no_points": no_points,
    })
    if config.get("instant_task_notifications"):
        await send_push_to(
            {"role": "parent"},
            title=f"{child['name']} menyelesaikan {(seg or {}).get('label', 'Kapan Saja')} ✅",
            body=f"{len(to_award)} tugas dicentang" + (" · terlambat" if finish_update["finish_late"] else ""),
            url="/parent",
        )
    streak = await _bump_section_streak(child, payload.segment_id, dk,
                                        on_time=not (finish_update["finish_late"] or sess.get("start_late")))
    spot = await _maybe_spot_check(child, dk, (seg or {}).get("label", "Kapan Saja"), acts, config)
    fresh = await db.children.find_one({"id": payload.child_id}, {"_id": 0}) or child
    pet_ticket = await _pet_ticket(fresh, config)
    pet_gift = await _pet_gift(fresh, config, on_time=not (finish_update["finish_late"] or sess.get("start_late")))
    return {"success": True, "completed": len(to_award), "awarded": awarded,
            "finish_late": finish_update["finish_late"], "no_points": no_points,
            "on_watch": on_watch, "spot_check": spot, "section_streak": streak,
            "pet_ticket": pet_ticket, "pet_gift": pet_gift}


@api.post("/segment-sessions/reopen")
async def reopen_segment(payload: SegmentActionInput, user: dict = Depends(require_parent)):
    """Parent escape hatch: reopen a finished section so it can be corrected.
    Points already granted are left to the per-mission undo controls."""
    dk = validate_date_key(payload.date_key)
    if not dk:
        raise HTTPException(status_code=422, detail="Tanggal tidak valid")
    res = await db.segment_sessions.update_one(
        {"parent_id": FAMILY_ID, "child_id": payload.child_id, "date_key": dk, "segment_id": payload.segment_id},
        {"$set": {"completed_at": None}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Sesi tidak ditemukan")
    return {"success": True}


@api.post("/off-days")
async def create_off_day(payload: OffDayInput, user: dict = Depends(require_parent)):
    """Parent declares one day or a range as task-free (family trip, holiday).
    Open tasks on those dates are parked as status 'off' (no penalties, hidden
    from the kids' quest line), recurrence skips over the range when spawning,
    and streak continuity bridges across it. Deleting the off-day restores the
    parked tasks."""
    _invalidate_days_ready()
    start = validate_date_key(payload.start_date)
    if not start:
        raise HTTPException(status_code=422, detail="Tanggal mulai tidak valid (YYYY-MM-DD)")
    end = validate_date_key(payload.end_date) if payload.end_date else start
    if not end:
        raise HTTPException(status_code=422, detail="Tanggal akhir tidak valid (YYYY-MM-DD)")
    if end < start:
        raise HTTPException(status_code=422, detail="Tanggal akhir harus sesudah/sama dengan tanggal mulai")
    span = (datetime.strptime(end, "%Y-%m-%d") - datetime.strptime(start, "%Y-%m-%d")).days + 1
    if span > 31:
        raise HTTPException(status_code=422, detail="Maksimal 31 hari sekali atur")
    _segs_off = await _get_day_segments()
    _seg_ids = {x["id"] for x in _segs_off}
    for _field in ("start_segment_id", "end_segment_id"):
        _val = getattr(payload, _field)
        if _val and _val not in _seg_ids:
            raise HTTPException(status_code=404, detail=f"Bagian waktu tidak ditemukan: {_val}")
    if start == end and payload.start_segment_id and payload.end_segment_id:
        if _segment_rank(_segs_off, payload.start_segment_id) > _segment_rank(_segs_off, payload.end_segment_id):
            raise HTTPException(status_code=422, detail="Bagian mulai harus sebelum bagian selesai pada hari yang sama")

    dup = await db.off_days.find_one({"parent_id": FAMILY_ID, "start_date": start, "end_date": end})
    if dup:
        raise HTTPException(status_code=409, detail="Rentang hari libur ini sudah ada")
    doc = {
        "id": new_id(), "parent_id": FAMILY_ID, "start_date": start, "end_date": end,
        "note": payload.note, "created_by_name": user.get("name", ""), "created_at": now_iso(),
        "start_segment_id": payload.start_segment_id,
        "end_segment_id": payload.end_segment_id,
    }
    await db.off_days.insert_one(doc)
    # Park every open task in the range so it can't be missed/penalized, and
    # tag it with this off-day's id so deleting the off-day can restore exactly
    # what it parked (and nothing else).
    # Park only the tasks the break actually covers — on a partly-off boundary
    # day that means just the sections from (or up to) the chosen one.
    segments = await _get_day_segments()
    candidates = await db.tasks.find(
        {"parent_id": FAMILY_ID, "date_key": {"$gte": start, "$lte": end},
         "status": {"$in": ["pending", "rejected"]}},
        {"_id": 0},
    ).to_list(20000)
    doomed_ids = [
        t["id"] for t in candidates
        if _off_covers(doc, t["date_key"], _segment_rank(segments, t.get("segment_id")), segments)
    ]
    res = await db.tasks.update_many(
        {"parent_id": FAMILY_ID, "id": {"$in": doomed_ids}},
        {"$set": {"status": "off", "off_day_id": doc["id"]}},
    ) if doomed_ids else type("R", (), {"modified_count": 0})()
    doc.pop("_id", None)
    await log_activity(FAMILY_ID, None, "off_day_created", {"start": start, "end": end, "parked": res.modified_count})
    await _invalidate_days(doc["start_date"], doc["end_date"])
    return {**doc, "parked_tasks": res.modified_count}


@api.get("/off-days")
async def list_off_days(user: dict = Depends(get_current_user)):
    items = await db.off_days.find({"parent_id": FAMILY_ID}, {"_id": 0}).sort("start_date", -1).to_list(50)
    return items


@api.delete("/off-days/{off_day_id}")
async def delete_off_day(off_day_id: str, user: dict = Depends(require_parent)):
    """Un-declare an off day: parked tasks return to pending, exactly as before."""
    _invalidate_days_ready()
    doc = await db.off_days.find_one({"id": off_day_id, "parent_id": FAMILY_ID})
    if not doc:
        raise HTTPException(status_code=404, detail="Hari libur tidak ditemukan")
    res = await db.tasks.update_many(
        {"parent_id": FAMILY_ID, "off_day_id": off_day_id, "status": "off"},
        {"$set": {"status": "pending"}, "$unset": {"off_day_id": ""}},
    )
    await db.off_days.delete_one({"id": off_day_id})
    await log_activity(FAMILY_ID, None, "off_day_deleted", {"start": doc["start_date"], "end": doc["end_date"], "restored": res.modified_count})
    await _invalidate_days(doc["start_date"], doc["end_date"])
    return {"success": True, "restored_tasks": res.modified_count}


# --------------- Honesty insight (analisa kejujuran, non-accusatory) ---------------
@api.get("/family/honesty-insight")
async def honesty_insight(days: int = 14, user: dict = Depends(require_parent)):
    """Gentle per-child signals from how each section was worked through,
    meant as conversation starters, never verdicts:
      * sections_rushed — finished in under a quarter of its estimated time;
      * bursts — every activity ticked within a few seconds of each other;
      * late — started or finished past the deadline."""
    days = max(1, min(days, 60))
    since = (_now_local() - timedelta(days=days)).strftime("%Y-%m-%d")
    kids = await db.children.find({"parent_id": FAMILY_ID}, {"_id": 0}).to_list(50)
    sessions = await db.segment_sessions.find(
        {"parent_id": FAMILY_ID, "date_key": {"$gte": since}, "completed_at": {"$nin": [None, ""]}},
        {"_id": 0}).to_list(5000)
    acts = await db.tasks.find(
        {"parent_id": FAMILY_ID, "date_key": {"$gte": since}, "is_bonus": {"$ne": True}},
        {"_id": 0, "child_id": 1, "date_key": 1, "segment_id": 1, "checked_at": 1,
         "duration_minutes": 1}).to_list(20000)
    by_section: dict = {}
    for a in acts:
        by_section.setdefault((a.get("child_id"), a.get("date_key"), a.get("segment_id") or ANYTIME_SEGMENT_ID), []).append(a)

    def ts(v):
        try:
            d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except Exception:
            return None

    out = []
    for k in kids:
        mine = [x for x in sessions if x.get("child_id") == k["id"]]
        rushed = bursts = late = 0
        actual_total = est_total = 0.0
        measured = 0
        for se in mine:
            rows = by_section.get((k["id"], se["date_key"], se["segment_id"]), [])
            st, en = ts(se.get("started_at")), ts(se.get("completed_at"))
            est = sum(int(r.get("duration_minutes") or 0) for r in rows) * 60
            if st and en and en >= st:
                measured += 1
                spent = (en - st).total_seconds()
                actual_total += spent
                if est:
                    est_total += est
                    if spent < est * 0.25:
                        rushed += 1
            ticks = sorted(t for t in (ts(r.get("checked_at")) for r in rows) if t)
            if len(ticks) >= 3 and (ticks[-1] - ticks[0]).total_seconds() <= 20:
                bursts += 1
            if se.get("start_late") or se.get("finish_late"):
                late += 1
        out.append({
            "child_id": k["id"], "child_name": k["name"],
            "avatar_emoji": k.get("avatar_emoji"), "avatar_color": k.get("avatar_color"),
            "sections_measured": measured,
            "avg_actual_minutes": round(actual_total / measured / 60, 1) if measured else None,
            "avg_estimated_minutes": round(est_total / measured / 60, 1) if measured and est_total else None,
            "sections_rushed": rushed, "bursts": bursts, "late": late,
            "days": days,
        })
    return {"since": since, "children": out}


# --------------- Section deadlines: who is behind, and who to tell ----------
# A section is a list with one deadline — its (personal) finish time. Children
# get a nudge shortly before it; once it has passed with the list unfinished,
# the parents are told and decide what happens. Nothing is penalised
# automatically.
SECTION_NUDGE_MINUTES = 15
PARENT_NOT_STARTED_MINUTES = 10


async def _sections_status(dk: str) -> list:
    """Every child's sections on one day, with where they stand."""
    await _refresh_segments_cache()
    segments = await _get_day_segments()
    kids = await db.children.find({"parent_id": FAMILY_ID}, {"_id": 0}).to_list(50)
    tasks = await db.tasks.find(
        {"parent_id": FAMILY_ID, "date_key": dk, "status": {"$ne": "off"}, "is_bonus": {"$ne": True}},
        {"_id": 0, "id": 1, "child_id": 1, "title": 1, "segment_id": 1, "checked": 1, "status": 1,
         "is_coop": 1, "coop_participants": 1, "points": 1, "penalty_points": 1},
    ).to_list(5000)
    sessions = {
        (x["child_id"], x["segment_id"]): x for x in await db.segment_sessions.find(
            {"parent_id": FAMILY_ID, "date_key": dk}, {"_id": 0}).to_list(500)
    }
    reviews = {
        (x["child_id"], x["segment_id"]): x for x in await db.section_reviews.find(
            {"parent_id": FAMILY_ID, "date_key": dk}, {"_id": 0}).to_list(500)
    }
    def done(t):
        return bool(t.get("checked")) or t.get("status") in ("completed", "approved", "skipped")

    out = []
    for k in kids:
        mine = [t for t in tasks if t.get("child_id") == k["id"]
                or (t.get("is_coop") and k["id"] in (t.get("coop_participants") or []))]
        for sg in segments:
            acts = [t for t in mine if t.get("segment_id") == sg["id"]]
            if not acts:
                continue
            sess = sessions.get((k["id"], sg["id"])) or {}
            left = [t for t in acts if not done(t) and t.get("status") != "missed"]
            out.append({
                "child_id": k["id"], "child_name": k["name"], "avatar_emoji": k.get("avatar_emoji"),
                "segment_id": sg["id"], "label": sg["label"], "emoji": sg.get("emoji", ""),
                "end_min": _effective_segment_end(sg, k, dk),
                "end_time": _fmt_min(_effective_segment_end(sg, k, dk)),
                "started": bool(sess.get("started_at")), "finished": bool(sess.get("completed_at")),
                "total": len(acts), "left": [{"id": t["id"], "title": t["title"],
                                             "penalty_points": int(t.get("penalty_points") or 0)} for t in left],
                "reviewed": bool(reviews.get((k["id"], sg["id"]))),
            })
    return out


async def _overdue_sections(dk: Optional[str] = None) -> list:
    """Sections whose finish time has passed without being finished, that a
    parent hasn't dealt with yet."""
    dk = dk or _today_key()
    today = _today_key()
    now_min = _now_minutes()
    rows = []
    await _refresh_segments_cache()
    if _is_relaxed(dk):
        return []
    for r in await _sections_status(dk):
        if r["finished"] or r["reviewed"]:
            continue
        if dk == today and now_min <= r["end_min"]:
            continue
        if dk > today:
            continue
        rows.append(r)
    return rows


@api.get("/family/overdue-sections")
async def list_overdue_sections(date_key: Optional[str] = None, user: dict = Depends(require_parent)):
    """Sections whose finish time passed unfinished, waiting for a parent to
    decide. Covers today plus the previous two days so nothing slips by
    overnight."""
    if date_key:
        dk = validate_date_key(date_key)
        if not dk:
            raise HTTPException(status_code=422, detail="Tanggal tidak valid")
        days = [dk]
    else:
        today = datetime.strptime(_today_key(), "%Y-%m-%d")
        days = [(today - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(3)]
    out = []
    for dk in days:
        for r in await _overdue_sections(dk):
            out.append({**r, "date_key": dk})
    return {"sections": out}


class OverdueResolveInput(BaseModel):
    child_id: str
    date_key: str
    segment_id: str
    # "miss": the unfinished missions are recorded as missed (each one's own
    # penalty applies); "dismiss": let it go — nothing changes.
    action: Literal["miss", "dismiss"]
    task_ids: Optional[List[str]] = None  # default: every unfinished one


@api.post("/family/overdue-sections/resolve")
async def resolve_overdue_section(payload: OverdueResolveInput, user: dict = Depends(require_parent)):
    dk = validate_date_key(payload.date_key)
    if not dk:
        raise HTTPException(status_code=422, detail="Tanggal tidak valid")
    row = next((r for r in await _sections_status(dk)
                if r["child_id"] == payload.child_id and r["segment_id"] == payload.segment_id), None)
    if not row:
        raise HTTPException(status_code=404, detail="Bagian tidak ditemukan")
    missed = penalty_total = 0
    if payload.action == "miss":
        wanted = set(payload.task_ids) if payload.task_ids is not None else {t["id"] for t in row["left"]}
        for t in row["left"]:
            if t["id"] not in wanted:
                continue
            res = await mark_task_missed(t["id"], user)
            missed += 1
            penalty_total += int(res.get("_undo_miss_penalty") or 0)
    await db.section_reviews.update_one(
        {"parent_id": FAMILY_ID, "child_id": payload.child_id, "date_key": dk, "segment_id": payload.segment_id},
        {"$set": {"action": payload.action, "missed": missed, "reviewed_at": now_iso(),
                  "reviewed_by": user.get("name", "")}},
        upsert=True,
    )
    await log_activity(FAMILY_ID, payload.child_id, "section_reviewed", {
        "segment": row["label"], "action": payload.action, "missed": missed, "penalty": penalty_total})
    return {"success": True, "missed": missed, "penalty": penalty_total}


async def _run_reminder_sweep() -> dict:
    """Nudges, each sent once (deduplicated via reminder_log):
      1. Child: a section closes within the next 15 minutes and isn't finished.
      2. Parent: a section's finish time passed and the list isn't finished —
         the parent decides what happens (nothing is penalised automatically).
      3. Parent: pending requests (sedekah / reset pet / penukaran hadiah &
         uang) unreviewed for over 2 hours — at most one per 3-hour block."""
    now = _now_local()
    today = _today_key()
    now_min = now.hour * 60 + now.minute
    sent = {"section_nudges": 0, "overdue_sections": 0, "parent_nudge": False}
    sent["spot_checks_expired"] = await _expire_spot_checks()
    for k in await db.children.find({"parent_id": FAMILY_ID}, {"_id": 0, "id": 1}).to_list(50):
        await _refresh_trust(k["id"])

    await _refresh_segments_cache()
    for r in ([] if _is_relaxed(today) else await _sections_status(today)):
        if r["finished"] or r["reviewed"]:
            continue
        lead = r["end_min"] - now_min
        if 0 <= lead <= PARENT_NOT_STARTED_MINUTES and not r["started"] and r["left"]:
            # e.g. 10 minutes before leaving for school and the morning list
            # hasn't even been started — worth a parent's nudge.
            marker = f"section-not-started:{today}:{r['child_id']}:{r['segment_id']}"
            if not await db.reminder_log.find_one({"key": marker}):
                await send_push_to(
                    {"role": "parent"},
                    title=f"{r['child_name']} belum mulai {r['label']} ⏰",
                    body=f"Selesai jam {r['end_time']} — tinggal {lead} menit.",
                    url="/parent",
                )
                await db.reminder_log.insert_one({"key": marker, "sent_at": now_iso()})
                sent["parent_not_started"] = sent.get("parent_not_started", 0) + 1
        if 0 <= lead <= SECTION_NUDGE_MINUTES and r["left"]:
            marker = f"section-nudge:{today}:{r['child_id']}:{r['segment_id']}"
            if not await db.reminder_log.find_one({"key": marker}):
                await send_push_to(
                    {"role": "child", "member_id": r["child_id"]},
                    title=f"{r['label']} selesai jam {r['end_time']} ⏰",
                    body=f"Masih ada {len(r['left'])} tugas lagi. Yuk diselesaikan!",
                    url=f"/kid/{r['child_id']}",
                )
                await db.reminder_log.insert_one({"key": marker, "sent_at": now_iso()})
                sent["section_nudges"] += 1
        elif lead < 0:
            marker = f"section-overdue:{today}:{r['child_id']}:{r['segment_id']}"
            if not await db.reminder_log.find_one({"key": marker}):
                what = (f"belum mulai {r['label']}" if not r["started"]
                        else f"belum menyelesaikan {r['label']} ({len(r['left'])} dari {r['total']} tugas belum)")
                await send_push_to(
                    {"role": "parent"},
                    title=f"{r['child_name']} {what} 📋",
                    body=f"Batasnya jam {r['end_time']}. Buka Monitor Harian untuk memutuskan.",
                    url="/parent",
                )
                await db.reminder_log.insert_one({"key": marker, "sent_at": now_iso()})
                sent["overdue_sections"] += 1

    expired = await _sweep_overdue_punishments()
    sent["punishments_expired"] = expired

    two_hours_ago = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    pending_total = 0
    for coll in (db.charity_requests, db.pet_reset_requests):
        pending_total += min(200, await coll.count_documents({"status": "pending", "created_at": {"$lt": two_hours_ago}}))
    pending_total += min(200, await db.redemptions.count_documents({"status": "pending", "created_at": {"$lt": two_hours_ago}}))
    pending_total += min(200, await db.money_redemptions.count_documents({"status": "pending", "created_at": {"$lt": two_hours_ago}}))
    if pending_total > 0:
        nudge_marker = f"parent-pending:{today}:{now.hour // 3}"
        if not await db.reminder_log.find_one({"key": nudge_marker}):
            await send_push_to(
                {"role": "parent"},
                title="Ada yang menunggu persetujuan 📋",
                body=f"{pending_total} pengajuan anak sudah menunggu lebih dari 2 jam. Cek yuk!",
                url="/parent",
            )
            await db.reminder_log.insert_one({"key": nudge_marker, "sent_at": now_iso()})
            sent["parent_nudge"] = True
    return sent


@api.get("/cron/reminders")
async def cron_reminders(key: str = ""):
    """External-scheduler entry point (e.g. cron-job.org every 10 minutes, or a
    Vercel cron). Protected by the CRON_SECRET env var — with no secret set,
    the endpoint refuses everything (safe default). Unauthenticated by design
    so a dumb HTTP pinger can call it, hence the shared-secret check."""
    secret = os.environ.get("CRON_SECRET", "")
    if not secret or key != secret:
        raise HTTPException(status_code=403, detail="Invalid cron key")
    return await _run_reminder_sweep()


@api.post("/reminders/run")
async def run_reminders_manual(user: dict = Depends(require_parent)):
    """Parent-triggered manual sweep (handy for testing the nudges)."""
    return await _run_reminder_sweep()



def _now_local():
    """Family wall-clock (GMT+7)."""
    return datetime.now(timezone.utc) + timedelta(hours=7)


def _segment_rank(segments: list, seg_id: Optional[str]) -> Optional[int]:
    """Position of a section in the day, earliest first. None for a task with
    no section — it isn't tied to any point in the day."""
    ordered = sorted(segments, key=lambda x: _hhmm_to_min(x["start_time"]))
    for i, sg in enumerate(ordered):
        if sg.get("id") == seg_id:
            return i
    return None


def _off_covers(off: dict, dk: str, seg_rank: Optional[int], segments: list) -> bool:
    """Is this (day, section) inside the break?

    Middle days are entirely off. The first and last day are only partly off
    when the parent set a section boundary — that's what makes "Friday evening
    through Monday morning" expressible. A task with no section is only counted
    on a boundary day when that whole day is off, since there's no position in
    the day to compare it against.
    """
    if not (off["start_date"] <= dk <= off["end_date"]):
        return False
    if off["start_date"] < dk < off["end_date"]:
        return True  # a full day in the middle of the break

    start_rank = _segment_rank(segments, off.get("start_segment_id")) if off.get("start_segment_id") else None
    end_rank = _segment_rank(segments, off.get("end_segment_id")) if off.get("end_segment_id") else None

    if dk == off["start_date"] and start_rank is not None:
        if seg_rank is None:
            return False  # unscheduled task on a partly-off first day: leave it
        if seg_rank < start_rank:
            return False
    if dk == off["end_date"] and end_rank is not None:
        if seg_rank is None:
            return False
        if seg_rank > end_rank:
            return False
    return True


async def _off_days_covering(dk: str) -> list:
    return await db.off_days.find({
        "parent_id": FAMILY_ID,
        "start_date": {"$lte": dk},
        "end_date": {"$gte": dk},
    }, {"_id": 0}).to_list(50)


async def _is_off_day(dk: str) -> bool:
    """True only when the WHOLE of this day is off.

    Used for recurrence skipping and streak bridging, where a half-day break
    shouldn't make the entire day vanish — a Friday that's only off from the
    afternoon still has a morning worth scheduling.
    """
    for off in await _off_days_covering(dk):
        starts_mid = off.get("start_segment_id") and off["start_date"] == dk
        ends_mid = off.get("end_segment_id") and off["end_date"] == dk
        if not starts_mid and not ends_mid:
            return True
    return False




def _current_week_key(reset_weekday: int = 0) -> str:
    """Identifier for the current weekly cycle. The cycle is a 7-day
    window that rolls over on `reset_weekday` (0=Mon..6=Sun). We compute it as
    the date of the most recent reset weekday, so changing the reset day shifts
    the boundary cleanly without cards ever accumulating."""
    now = _now_local()
    # days since the most recent reset weekday (Python weekday(): Mon=0..Sun=6)
    delta = (now.weekday() - reset_weekday) % 7
    cycle_start = (now - timedelta(days=delta)).strftime("%Y-%m-%d")
    return f"cycle:{cycle_start}"


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



class TaskApproveInput(BaseModel):
    # A short note and/or voice clip (base64 data URL, same pattern as photo
    # proof) the parent can attach when approving — a little personal
    # encouragement alongside the automatic points.
    encouragement_message: Optional[str] = Field(default=None, max_length=300)
    encouragement_voice_url: Optional[str] = None



# _task_is_time_stuck is called from sync contexts, so the segment list is
# refreshed by the async callers and stashed here rather than awaited inline.
_SEGMENTS_CACHE: dict = {"segments": None}



_CONFIG_CACHE = {"doc": None, "at": 0.0}
_CONFIG_TTL_SECONDS = 5.0


async def _write_config(update: dict, upsert: bool = True):
    """Single funnel for config writes so the cache can never go stale."""
    res = await db.app_config.update_one({"parent_id": FAMILY_ID}, update, upsert=upsert)
    _invalidate_config_cache()
    return res


async def get_config_cached() -> dict:
    """The family config, cached for a few seconds.

    It's read from a dozen different helpers on a single page load, and it
    changes only when a parent edits settings. Re-fetching it eight times per
    request was pure overhead. Any write clears the cache, so a saved setting
    still takes effect immediately.
    """
    import time as _t
    now = _t.monotonic()
    if _CONFIG_CACHE["doc"] is not None and (now - _CONFIG_CACHE["at"]) < _CONFIG_TTL_SECONDS:
        return _CONFIG_CACHE["doc"]
    doc = await db.app_config.find_one({"parent_id": FAMILY_ID}) or {}
    _CONFIG_CACHE["doc"] = doc
    _CONFIG_CACHE["at"] = now
    return doc


def _invalidate_config_cache():
    _CONFIG_CACHE["doc"] = None
    _CONFIG_CACHE["at"] = 0.0


async def _refresh_segments_cache():
    _SEGMENTS_CACHE["segments"] = await _get_day_segments()
    import time as _t
    if _t.monotonic() - _RELAXED_CACHE.get("at", -1e9) > 30:
        _RELAXED_CACHE["ranges"] = await db.relaxed_days.find(
            {"parent_id": FAMILY_ID}, {"_id": 0, "start_date": 1, "end_date": 1}).to_list(200)
        _RELAXED_CACHE["at"] = _t.monotonic()



def _next_deadline_date(deadline_weekday: int) -> str:
    """The upcoming deadline day (default Sunday), inclusive of today. A
    punishment issued ON the deadline day is still due that same day — the kid
    has until end of that day, which is the honest reading of 'paling telat
    hari Minggu'."""
    now = _now_local()
    delta = (deadline_weekday - now.weekday()) % 7
    return (now + timedelta(days=delta)).strftime("%Y-%m-%d")


async def _issue_punishment(child: dict, config: dict, cards: int) -> Optional[dict]:
    """Create the consequence owed once a child hits the Kartu Hukuman
    threshold. Only ever one active punishment per child at a time — cards keep
    accruing, but we don't stack sentences on top of each other."""
    active = await db.punishments.find_one({
        "parent_id": FAMILY_ID, "child_id": child["id"],
        "status": {"$in": ["pending_choice", "assigned"]},
    })
    if active:
        return None
    options = config.get("punishment_options") or DEFAULT_PUNISHMENT_OPTIONS
    if not options:
        return None
    mode = config.get("punishment_mode", DEFAULT_PUNISHMENT_MODE)
    deadline_wd = int(config.get("punishment_deadline_weekday", DEFAULT_PUNISHMENT_DEADLINE_WEEKDAY))
    doc = {
        "id": new_id(), "parent_id": FAMILY_ID,
        "child_id": child["id"], "child_name": child.get("name", ""),
        "cards_at_issue": cards,
        "threshold": int(config.get("penalty_card_threshold", DEFAULT_PENALTY_CARD_THRESHOLD)),
        "mode": mode,
        "deadline_date": _next_deadline_date(deadline_wd),
        "overdue_action": config.get("punishment_overdue_action", DEFAULT_PUNISHMENT_OVERDUE_ACTION),
        "options_snapshot": options,   # frozen so later config edits can't change a live sentence
        "option_id": None, "option_label": None, "option_description": None,
        "status": "pending_choice" if mode == "choice" else "assigned",
        "issued_at": now_iso(), "issued_date_key": _today_key(),
        "served_at": None, "expired_at": None, "penalty_applied": None,
    }
    if mode == "auto":
        picked = random.choice(options)
        doc.update({
            "option_id": picked.get("id"), "option_label": picked.get("label"),
            "option_description": picked.get("description", ""),
        })
    await db.punishments.insert_one(doc)
    doc.pop("_id", None)
    body = (
        f'Pilih hukumanmu sebelum {_weekday_name_id(doc["deadline_date"])} ya.'
        if mode == "choice" else
        f'Hukumanmu: {doc["option_label"]}. Selesaikan sebelum {_weekday_name_id(doc["deadline_date"])}.'
    )
    await send_push_to({"role": "child", "member_id": child["id"]},
                       title="Kartu Hukuman penuh ⚠️", body=body, url=f"/kid/{child['id']}")
    await send_push_to({"role": "parent"}, title="Hukuman diterbitkan",
                       body=f'{child.get("name", "Anak")} mencapai {cards} Kartu Hukuman.', url="/parent")
    await log_activity(FAMILY_ID, child["id"], "punishment_issued",
                       {"mode": mode, "cards": cards, "deadline": doc["deadline_date"]})
    return doc


def _weekday_name_id(date_key: str) -> str:
    names = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]
    try:
        return f'{names[datetime.strptime(date_key, "%Y-%m-%d").weekday()]} ({date_key})'
    except Exception:
        return date_key


async def _apply_overdue_punishment(p: dict) -> str:
    """The teeth behind the deadline. Runs exactly once per punishment."""
    action = p.get("overdue_action") or DEFAULT_PUNISHMENT_OVERDUE_ACTION
    child_id = p["child_id"]
    if action == "reset_points":
        # Spendable balance and buckets go to zero. Lifetime points (and so
        # level/XP) are deliberately preserved — we're clearing the wallet, not
        # erasing everything the child has ever achieved.
        await db.children.update_one({"id": child_id}, {"$set": {
            "points": 0, "chiky_save": 0, "chiky_spend": 0, "chiky_share": 0,
        }})
    elif action == "pet_dies":
        await db.children.update_one({"id": child_id}, {"$set": {"pet_force_dead": True}})
    await db.punishments.update_one({"id": p["id"]}, {"$set": {
        "status": "expired", "expired_at": now_iso(), "penalty_applied": action,
    }})
    # The sentence has been enforced; start the card count over so the child
    # isn't instantly re-sentenced for the same offences.
    await db.children.update_one({"id": child_id}, {"$set": {"penalty_cards": 0}})
    label = {"reset_points": "poinmu direset ke 0", "pet_dies": "peliharaanmu tidak selamat",
             "none": "tercatat"}.get(action, action)
    await send_push_to({"role": "child", "member_id": child_id},
                       title="Batas hukuman terlewat 💔",
                       body=f"Hukuman belum dijalani sampai batas waktu — {label}.",
                       url=f"/kid/{child_id}")
    await send_push_to({"role": "parent"}, title="Hukuman kedaluwarsa",
                       body=f'{p.get("child_name", "Anak")}: {label}.', url="/parent")
    await log_activity(FAMILY_ID, child_id, "punishment_expired", {"action": action})
    return action


async def _sweep_overdue_punishments() -> int:
    """Expire any punishment whose deadline day has fully passed. Idempotent
    and safe to call from any read path or the cron sweep."""
    today = _today_key()
    overdue = await db.punishments.find({
        "parent_id": FAMILY_ID,
        "status": {"$in": ["pending_choice", "assigned"]},
        "deadline_date": {"$lt": today},
    }, {"_id": 0}).to_list(200)
    for p in overdue:
        await _apply_overdue_punishment(p)
    return len(overdue)


@api.get("/punishments")
async def list_punishments(child_id: Optional[str] = None, active_only: bool = False, user: dict = Depends(get_current_user)):
    await _sweep_overdue_punishments()
    query = {"parent_id": FAMILY_ID}
    if user["role"] == "child":
        query["child_id"] = user["id"]
    elif child_id:
        query["child_id"] = child_id
    if active_only:
        query["status"] = {"$in": ["pending_choice", "assigned"]}
    return await db.punishments.find(query, {"_id": 0}).sort("issued_at", -1).to_list(100)


@api.post("/punishments/{punishment_id}/choose")
async def choose_punishment(punishment_id: str, payload: PunishmentChooseInput, user: dict = Depends(get_current_user)):
    """Kid picks which consequence to take (choice mode). Picking is required —
    ignoring it until the deadline triggers the overdue action instead."""
    await _sweep_overdue_punishments()
    p = await db.punishments.find_one({"id": punishment_id, "parent_id": FAMILY_ID})
    if not p:
        raise HTTPException(status_code=404, detail="Hukuman tidak ditemukan")
    if user["role"] == "child" and user["id"] != p["child_id"]:
        raise HTTPException(status_code=403, detail="Ini bukan hukumanmu")
    if p["status"] != "pending_choice":
        raise HTTPException(status_code=400, detail="Hukuman ini tidak sedang menunggu pilihan")
    opt = next((o for o in (p.get("options_snapshot") or []) if o.get("id") == payload.option_id), None)
    if not opt:
        raise HTTPException(status_code=404, detail="Pilihan hukuman tidak ditemukan")
    await db.punishments.update_one({"id": punishment_id}, {"$set": {
        "status": "assigned", "option_id": opt.get("id"),
        "option_label": opt.get("label"), "option_description": opt.get("description", ""),
        "chosen_at": now_iso(),
    }})
    await send_push_to({"role": "parent"}, title="Anak memilih hukumannya",
                       body=f'{p.get("child_name", "Anak")} memilih: {opt.get("label")}', url="/parent")
    await log_activity(FAMILY_ID, p["child_id"], "punishment_chosen", {"option": opt.get("label")})
    return await db.punishments.find_one({"id": punishment_id}, {"_id": 0})


@api.post("/punishments/{punishment_id}/serve")
async def serve_punishment(punishment_id: str, user: dict = Depends(require_parent)):
    """Parent confirms the consequence was actually carried out. This clears
    the child's Kartu Hukuman back to zero — a clean slate for doing the hard
    thing."""
    p = await db.punishments.find_one({"id": punishment_id, "parent_id": FAMILY_ID})
    if not p:
        raise HTTPException(status_code=404, detail="Hukuman tidak ditemukan")
    if p["status"] != "assigned":
        raise HTTPException(status_code=400, detail="Hanya hukuman yang sudah ditentukan yang bisa ditandai selesai")
    await db.punishments.update_one({"id": punishment_id}, {"$set": {"status": "served", "served_at": now_iso()}})
    await db.children.update_one({"id": p["child_id"]}, {"$set": {"penalty_cards": 0}})
    await send_push_to({"role": "child", "member_id": p["child_id"]},
                       title="Hukuman selesai ✅",
                       body="Kartu Hukumanmu kembali ke 0. Mulai lagi dari bersih ya!",
                       url=f"/kid/{p['child_id']}")
    await log_activity(FAMILY_ID, p["child_id"], "punishment_served", {"option": p.get("option_label")})
    return await db.punishments.find_one({"id": punishment_id}, {"_id": 0})


@api.post("/punishments/{punishment_id}/cancel")
async def cancel_punishment(punishment_id: str, user: dict = Depends(require_parent)):
    """Parent withdraws a punishment (issued by mistake, or forgiven). Cards
    are cleared too, since the slate is being wiped deliberately."""
    p = await db.punishments.find_one({"id": punishment_id, "parent_id": FAMILY_ID})
    if not p:
        raise HTTPException(status_code=404, detail="Hukuman tidak ditemukan")
    if p["status"] not in ("pending_choice", "assigned"):
        raise HTTPException(status_code=400, detail="Hukuman ini sudah selesai atau kedaluwarsa")
    await db.punishments.update_one({"id": punishment_id}, {"$set": {"status": "cancelled", "cancelled_at": now_iso()}})
    await db.children.update_one({"id": p["child_id"]}, {"$set": {"penalty_cards": 0}})
    await log_activity(FAMILY_ID, p["child_id"], "punishment_cancelled", {})
    return await db.punishments.find_one({"id": punishment_id}, {"_id": 0})


# ---- Virtual pet: care, mood, gifts, games, home, journal, messages ----------
PET_CARE_COST = 3            # air / mainan units per action
PET_TICKET_CAP = 5           # play tickets that can be saved up
PET_GAMES_PER_DAY = 3
PET_GAME_MAX_COINS = {"catch": 8, "memory": 6, "guess": 5}
PET_HOME_MAX_ITEMS = 5
PET_PATHS = {"brave": ("Pemberani", "🦁"), "smart": ("Pintar", "🦉"), "kind": ("Penyayang", "💗")}
PET_HOME_CATALOG = {
    # key: (name, emoji, price in koin, slot)
    "wall_sky": ("Langit cerah", "🌤️", 0, "wall"), "wall_night": ("Malam bintang", "🌙", 20, "wall"),
    "wall_forest": ("Hutan", "🌳", 30, "wall"), "wall_space": ("Luar angkasa", "🚀", 45, "wall"),
    "wall_candy": ("Negeri permen", "🍭", 45, "wall"),
    "floor_grass": ("Rumput", "🌱", 0, "floor"), "floor_wood": ("Lantai kayu", "🪵", 15, "floor"),
    "floor_sand": ("Pasir pantai", "🏖️", 20, "floor"), "floor_snow": ("Salju", "❄️", 25, "floor"),
    "bed": ("Kasur", "🛏️", 15, "item"), "ball": ("Bola", "⚽", 10, "item"), "plant": ("Tanaman", "🪴", 12, "item"),
    "lamp": ("Lampu", "💡", 15, "item"), "books": ("Buku", "📚", 12, "item"), "teddy": ("Boneka", "🧸", 10, "item"),
    "cake": ("Kue", "🎂", 20, "item"), "fish": ("Akuarium", "🐠", 25, "item"), "tent": ("Tenda", "⛺", 30, "item"),
    "rainbow": ("Pelangi", "🌈", 40, "item"), "piano": ("Piano", "🎹", 40, "item"), "telescope": ("Teleskop", "🔭", 35, "item"),
}
_HOME_DEFAULT = {"wall": "wall_sky", "floor": "floor_grass", "items": [], "owned": ["wall_sky", "floor_grass"]}


def _pet_stage(child: dict, config: dict) -> tuple:
    th = config.get("pet_stage_feed_thresholds") or _DEFAULT_PET_FEED_THRESHOLDS
    names = config.get("pet_stage_names") or _DEFAULT_PET_STAGE_NAMES
    n = int(child.get("pet_feed_count") or 0)
    idx = sum(1 for t in th if n >= t)
    return idx, names[min(idx, len(names) - 1)]


def _jakarta_now() -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=7)


def _pet_phase() -> dict:
    h = _jakarta_now().hour
    if 5 <= h < 11:
        return {"key": "morning", "label": "Pagi", "emoji": "🌅", "line": "Selamat pagi! Aku baru bangun~"}
    if 11 <= h < 15:
        return {"key": "noon", "label": "Siang", "emoji": "☀️", "line": "Siang yang seru!"}
    if 15 <= h < 19:
        return {"key": "evening", "label": "Sore", "emoji": "🌇", "line": "Sore-sore enaknya santai."}
    return {"key": "night", "label": "Malam", "emoji": "🌙", "line": "Zzz… aku ngantuk."}


def _hours_since(iso: Optional[str]) -> Optional[float]:
    if not iso:
        return None
    try:
        d = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        d = d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - d).total_seconds() / 3600
    except Exception:
        return None


async def _pet_log(child_id: str, kind: str, text: str, emoji: str = "🐾") -> None:
    await db.pet_journal.insert_one({"id": new_id(), "parent_id": FAMILY_ID, "child_id": child_id, "kind": kind,
                                     "text": text, "emoji": emoji, "date_key": _today_key(), "at": now_iso()})


async def _pet_mood(child: dict) -> dict:
    """How the pet feels today. Always gentle — a hint about the day, never a
    scolding: it follows what the child did (on-time sections, a recent
    correction) and the pet's own small needs."""
    today = _today_key()
    since = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=2)).strftime("%Y-%m-%d")
    corrected = await db.corrections.count_documents({"child_id": child["id"], "undone": {"$ne": True},
                                                      "date_key": {"$gt": since}})
    sess = await db.segment_sessions.find({"child_id": child["id"], "date_key": today,
                                           "completed_at": {"$nin": [None, ""]}}, {"_id": 0}).to_list(50)
    on_time = sum(1 for x in sess if not x.get("start_late") and not x.get("finish_late"))
    chosen = child.get("pet_chosen_at")
    h_fed = _hours_since(child.get("pet_last_fed_at") or chosen)
    h_water = _hours_since(child.get("pet_last_watered_at") or chosen)
    h_play = _hours_since(child.get("pet_last_played_at") or chosen)
    if corrected:
        m = ("sad", "🥺", "Sedikit sedih", "Aku sedih sedikit… tapi aku percaya kamu bisa lebih baik besok 💛")
    elif h_fed is not None and h_fed >= 30:
        m = ("hungry", "😋", "Lapar", "Perutku keroncongan… ada makanan?")
    elif h_water is not None and h_water >= 48:
        m = ("thirsty", "🥤", "Haus", "Aku haus, boleh minum?")
    elif h_play is not None and h_play >= 48:
        m = ("bored", "🥱", "Bosan", "Ayo main sama aku, aku bosan~")
    elif on_time >= 2:
        m = ("ecstatic", "🤩", "Sangat senang", "Kamu tepat waktu terus hari ini! Hebat!")
    elif sess:
        m = ("happy", "😄", "Senang", "Asyik, satu bagian selesai!")
    else:
        m = ("calm", "🙂", "Tenang", "Aku siap menemanimu hari ini.")
    return {"key": m[0], "face": m[1], "label": m[2], "line": m[3]}


async def _pet_gift(child: dict, config: dict, on_time: bool) -> Optional[dict]:
    """After a finished section the pet sometimes comes back with a present.
    What it brings leans with the path the child chose for it."""
    import random as _random
    if not child.get("pet_type") or _pet_is_dead(child, config):
        return None
    if _random.random() >= (0.45 if on_time else 0.2):
        return None
    path = child.get("pet_path")
    weights = {"coins": 3, "feed": 3, "ticket": 2}
    if path == "brave":
        weights["coins"] += 3
    elif path == "smart":
        weights["feed"] += 3
    elif path == "kind":
        weights["ticket"] += 3
    kind = _random.choices(list(weights), weights=list(weights.values()))[0]
    if kind == "coins":
        n = _random.randint(2, 5)
        inc, text = {"pet_coins": n}, f"membawa {n} koin 🪙"
    elif kind == "feed":
        n = _random.randint(2, 4)
        inc, text = {"feed_balance": n, "feed_lifetime": n}, f"membawa {n} pakan 🍖"
    else:
        n = 1
        inc, text = {"play_tickets": 1}, "membawa 1 tiket main 🎟️"
        if int(child.get("play_tickets") or 0) >= PET_TICKET_CAP:
            kind, n = "coins", 3
            inc, text = {"pet_coins": 3}, "membawa 3 koin 🪙"
    await db.children.update_one({"id": child["id"]}, {"$inc": inc})
    await _pet_log(child["id"], "gift", f"Peliharaanmu {text} setelah kamu menyelesaikan satu bagian", "🎁")
    return {"kind": kind, "amount": n, "text": text}


async def _pet_ticket(child: dict, config: dict) -> int:
    """One play ticket per finished section (saved up to a small cap)."""
    if not child.get("pet_type") or _pet_is_dead(child, config):
        return 0
    if int(child.get("play_tickets") or 0) >= PET_TICKET_CAP:
        return 0
    await db.children.update_one({"id": child["id"]}, {"$inc": {"play_tickets": 1}})
    return 1


def _pet_alive(child: dict, config: dict) -> None:
    if not child.get("pet_type"):
        raise HTTPException(status_code=400, detail="Kamu belum punya peliharaan — pilih dulu ya!")
    if _pet_is_dead(child, config):
        raise HTTPException(status_code=400, detail="Peliharaanmu sudah pergi 💔 — pilih peliharaan baru untuk mulai lagi.")


async def _playdate_for(child: dict, config: dict) -> Optional[dict]:
    """Two siblings who both finished a section today let their pets play
    together — claiming it pays both a few koin."""
    today = _today_key()
    done = {x["child_id"] for x in await db.segment_sessions.find(
        {"parent_id": FAMILY_ID, "date_key": today, "completed_at": {"$nin": [None, ""]}},
        {"_id": 0, "child_id": 1}).to_list(500)}
    if child["id"] not in done:
        return None
    for k in await db.children.find({"parent_id": FAMILY_ID, "id": {"$ne": child["id"]}}, {"_id": 0}).to_list(50):
        if k["id"] in done and k.get("pet_type") and not _pet_is_dead(k, config):
            pair = sorted([child["id"], k["id"]])
            claimed = bool(await db.pet_playdates.find_one({"date_key": today, "pair": pair}))
            idx, _ = _pet_stage(k, config)
            return {"mate_id": k["id"], "mate_name": k["name"], "mate_pet": k["pet_type"], "mate_stage": idx,
                    "claimed": claimed}
    return None


@api.get("/children/{child_id}/pet")
async def pet_state(child_id: str, user: dict = Depends(get_current_user)):
    """Everything the pet screen needs in one call."""
    _assert_can_act(user, child_id)
    child = await get_child_or_404(FAMILY_ID, child_id)
    config = await get_config_cached()
    if not child.get("pet_type"):
        return {"has_pet": False}
    dead = _pet_is_dead(child, config)
    idx, stage_name = _pet_stage(child, config)
    today = _today_key()
    games = child.get("pet_games") or {}
    games_today = int(games.get("n") or 0) if games.get("date") == today else 0
    home = {**_HOME_DEFAULT, **(child.get("pet_home") or {})}
    msg = await db.pet_messages.find({"parent_id": FAMILY_ID, "$or": [{"child_id": child_id}, {"child_id": None}],
                                      "read_by": {"$ne": child_id}}, {"_id": 0}).sort("created_at", -1).to_list(1)
    journal = await db.pet_journal.find({"child_id": child_id}, {"_id": 0}).sort("at", -1).to_list(8)
    path = child.get("pet_path")
    h = lambda iso: _hours_since(iso or child.get("pet_chosen_at"))
    return {
        "has_pet": True, "dead": dead, "pet_type": child["pet_type"], "stage_index": idx, "stage_name": stage_name,
        "feed_balance": int(child.get("feed_balance") or 0), "water_balance": int(child.get("water_balance") or 0),
        "play_balance": int(child.get("play_balance") or 0), "care_cost": PET_CARE_COST,
        "tickets": int(child.get("play_tickets") or 0), "coins": int(child.get("pet_coins") or 0),
        "games_left": max(0, PET_GAMES_PER_DAY - games_today),
        "mood": None if dead else await _pet_mood(child), "phase": _pet_phase(),
        "path": path, "path_label": PET_PATHS[path][0] if path in PET_PATHS else None,
        "path_icon": PET_PATHS[path][1] if path in PET_PATHS else None,
        "path_available": idx >= 2 and not path and not dead,
        "paths": [{"key": k, "label": v[0], "icon": v[1]} for k, v in PET_PATHS.items()],
        "home": home,
        "catalog": [{"key": k, "name": v[0], "emoji": v[1], "price": v[2], "slot": v[3]} for k, v in PET_HOME_CATALOG.items()],
        "message": msg[0] if msg else None, "journal": journal,
        "playdate": None if dead else await _playdate_for(child, config),
        "water_hours": h(child.get("pet_last_watered_at")), "play_hours": h(child.get("pet_last_played_at")),
    }


class PetCareInput(BaseModel):
    kind: Literal["water", "play"]


@api.post("/children/{child_id}/pet-care")
async def pet_care(child_id: str, payload: PetCareInput, user: dict = Depends(get_current_user)):
    """Give the pet a drink or play with it — using the units its missions earned."""
    _assert_can_act(user, child_id)
    child = await get_child_or_404(FAMILY_ID, child_id)
    config = await get_config_cached()
    _pet_alive(child, config)
    field = f"{payload.kind}_balance"
    if int(child.get(field) or 0) < PET_CARE_COST:
        raise HTTPException(status_code=400, detail=f"Butuh {PET_CARE_COST} {'air' if payload.kind == 'water' else 'mainan'} — "
                                                     "kerjakan misi yang memberinya dulu ya!")
    stamp = "pet_last_watered_at" if payload.kind == "water" else "pet_last_played_at"
    inc = {field: -PET_CARE_COST}
    if payload.kind == "play":
        inc["pet_coins"] = 1
    await db.children.update_one({"id": child_id}, {"$inc": inc, "$set": {stamp: now_iso()}})
    await _pet_log(child_id, payload.kind, "Kamu memberi minum peliharaanmu 💧" if payload.kind == "water"
                   else "Kamu bermain dengan peliharaanmu 🎾 (+1 koin)", "💧" if payload.kind == "water" else "🎾")
    return {"success": True, "bonus_coins": 1 if payload.kind == "play" else 0}


class PetGameInput(BaseModel):
    game: Literal["catch", "memory", "guess"]
    score: int = Field(ge=0, le=100)   # how well it went, as a percentage


@api.post("/children/{child_id}/pet-game")
async def pet_game(child_id: str, payload: PetGameInput, user: dict = Depends(get_current_user)):
    """A finished mini-game: spends one tiket main, pays a few koin by score.
    Limited per day so it stays a treat, not an escape."""
    _assert_can_act(user, child_id)
    child = await get_child_or_404(FAMILY_ID, child_id)
    config = await get_config_cached()
    _pet_alive(child, config)
    today = _today_key()
    games = child.get("pet_games") or {}
    n = int(games.get("n") or 0) if games.get("date") == today else 0
    if n >= PET_GAMES_PER_DAY:
        raise HTTPException(status_code=409, detail="Main hari ini sudah cukup — lanjut besok ya 🌙")
    if int(child.get("play_tickets") or 0) < 1:
        raise HTTPException(status_code=400, detail="Tiket main habis — selesaikan satu bagian untuk dapat tiket 🎟️")
    coins = round(PET_GAME_MAX_COINS[payload.game] * payload.score / 100)
    if payload.score > 0:
        coins = max(1, coins)
    await db.children.update_one({"id": child_id}, {
        "$inc": {"play_tickets": -1, "pet_coins": coins},
        "$set": {"pet_games": {"date": today, "n": n + 1}, "pet_last_played_at": now_iso()}})
    names = {"catch": "Tangkap", "memory": "Memori", "guess": "Tebak"}
    if payload.score >= 80:
        await _pet_log(child_id, "game", f"Skor tinggi di permainan {names[payload.game]}: {payload.score}! 🏆", "🏆")
    return {"success": True, "coins": coins, "tickets": int(child.get("play_tickets") or 0) - 1,
            "games_left": PET_GAMES_PER_DAY - n - 1}


class PetBuyInput(BaseModel):
    item: str


@api.post("/children/{child_id}/pet-home/buy")
async def pet_home_buy(child_id: str, payload: PetBuyInput, user: dict = Depends(get_current_user)):
    _assert_can_act(user, child_id)
    child = await get_child_or_404(FAMILY_ID, child_id)
    spec = PET_HOME_CATALOG.get(payload.item)
    if not spec:
        raise HTTPException(status_code=404, detail="Barang tidak ada")
    home = {**_HOME_DEFAULT, **(child.get("pet_home") or {})}
    if payload.item in home["owned"]:
        raise HTTPException(status_code=409, detail="Sudah kamu punya")
    if int(child.get("pet_coins") or 0) < spec[2]:
        raise HTTPException(status_code=400, detail=f"Koinmu kurang — butuh {spec[2]} koin 🪙")
    home["owned"] = [*home["owned"], payload.item]
    await db.children.update_one({"id": child_id}, {"$inc": {"pet_coins": -spec[2]}, "$set": {"pet_home": home}})
    await _pet_log(child_id, "home", f"Membeli {spec[0]} untuk rumah peliharaan {spec[1]}", "🏠")
    return {"success": True}


class PetHomeSetInput(BaseModel):
    wall: Optional[str] = None
    floor: Optional[str] = None
    items: Optional[List[str]] = Field(default=None, max_length=PET_HOME_MAX_ITEMS)


@api.post("/children/{child_id}/pet-home/set")
async def pet_home_set(child_id: str, payload: PetHomeSetInput, user: dict = Depends(get_current_user)):
    _assert_can_act(user, child_id)
    child = await get_child_or_404(FAMILY_ID, child_id)
    home = {**_HOME_DEFAULT, **(child.get("pet_home") or {})}
    owned = set(home["owned"])
    for key, slot in ((payload.wall, "wall"), (payload.floor, "floor")):
        if key is not None:
            if key not in owned or PET_HOME_CATALOG.get(key, (0, 0, 0, ""))[3] != slot:
                raise HTTPException(status_code=400, detail="Barang itu belum kamu punya")
            home[slot] = key
    if payload.items is not None:
        items = list(dict.fromkeys(payload.items))
        if any(i not in owned or PET_HOME_CATALOG.get(i, (0, 0, 0, ""))[3] != "item" for i in items):
            raise HTTPException(status_code=400, detail="Ada barang yang belum kamu punya")
        home["items"] = items
    await db.children.update_one({"id": child_id}, {"$set": {"pet_home": home}})
    return {"success": True, "home": home}


@api.post("/children/{child_id}/pet-playdate")
async def pet_playdate_claim(child_id: str, user: dict = Depends(get_current_user)):
    _assert_can_act(user, child_id)
    child = await get_child_or_404(FAMILY_ID, child_id)
    config = await get_config_cached()
    _pet_alive(child, config)
    pd = await _playdate_for(child, config)
    if not pd:
        raise HTTPException(status_code=400, detail="Belum ada teman main — tunggu saudaramu menyelesaikan satu bagian juga ya")
    if pd["claimed"]:
        raise HTTPException(status_code=409, detail="Hari ini sudah main bareng 🎪")
    pair = sorted([child_id, pd["mate_id"]])
    await db.pet_playdates.insert_one({"date_key": _today_key(), "pair": pair, "at": now_iso()})
    await db.children.update_many({"id": {"$in": pair}}, {"$inc": {"pet_coins": 3}, "$set": {"pet_last_played_at": now_iso()}})
    await _pet_log(child_id, "playdate", f"Main bareng peliharaan {pd['mate_name']} 🎪 (+3 koin)", "🎪")
    await _pet_log(pd["mate_id"], "playdate", f"Main bareng peliharaan {child['name']} 🎪 (+3 koin)", "🎪")
    return {"success": True, "coins": 3}


class PetPathInput(BaseModel):
    path: Literal["brave", "smart", "kind"]


@api.post("/children/{child_id}/pet-path")
async def pet_choose_path(child_id: str, payload: PetPathInput, user: dict = Depends(get_current_user)):
    """At the teen stage the child picks what kind of pet theirs becomes."""
    _assert_can_act(user, child_id)
    child = await get_child_or_404(FAMILY_ID, child_id)
    config = await get_config_cached()
    _pet_alive(child, config)
    if child.get("pet_path"):
        raise HTTPException(status_code=409, detail="Jalannya sudah dipilih")
    if _pet_stage(child, config)[0] < 2:
        raise HTTPException(status_code=400, detail="Tunggu sampai peliharaanmu remaja dulu ya")
    await db.children.update_one({"id": child_id}, {"$set": {"pet_path": payload.path}})
    label, icon = PET_PATHS[payload.path]
    await _pet_log(child_id, "path", f"Peliharaanmu tumbuh menjadi {label} {icon}", icon)
    return {"success": True, "path": payload.path, "label": label}


@api.get("/children/{child_id}/pet-journal")
async def pet_journal(child_id: str, limit: int = Query(default=40, ge=1, le=200), user: dict = Depends(get_current_user)):
    _assert_can_act(user, child_id)
    return await db.pet_journal.find({"child_id": child_id}, {"_id": 0}).sort("at", -1).to_list(limit)


class PetMessageInput(BaseModel):
    text: str = Field(min_length=1, max_length=140)
    child_id: Optional[str] = None   # empty = every child


@api.get("/pet-messages")
async def list_pet_messages(user: dict = Depends(require_parent)):
    return await db.pet_messages.find({"parent_id": FAMILY_ID}, {"_id": 0}).sort("created_at", -1).to_list(50)


@api.post("/pet-messages")
async def add_pet_message(payload: PetMessageInput, user: dict = Depends(require_parent)):
    """A short note from a parent that the child's pet 'says' on their screen."""
    if payload.child_id:
        await get_child_or_404(FAMILY_ID, payload.child_id)
    doc = {"id": new_id(), "parent_id": FAMILY_ID, "child_id": payload.child_id or None, "text": payload.text.strip(),
           "from": user.get("name", ""), "created_at": now_iso(), "read_by": []}
    await db.pet_messages.insert_one(dict(doc))
    targets = [payload.child_id] if payload.child_id else [k["id"] for k in await db.children.find(
        {"parent_id": FAMILY_ID}, {"_id": 0, "id": 1}).to_list(50)]
    for cid in targets:
        await send_push_to({"role": "child", "member_id": cid}, title="Peliharaanmu punya pesan 💌",
                           body="Buka aplikasi untuk mendengarnya.", url=f"/kid/{cid}")
    doc.pop("_id", None)
    return doc


@api.delete("/pet-messages/{message_id}")
async def delete_pet_message(message_id: str, user: dict = Depends(require_parent)):
    await db.pet_messages.delete_one({"id": message_id, "parent_id": FAMILY_ID})
    return {"success": True}


@api.post("/pet-messages/{message_id}/read")
async def read_pet_message(message_id: str, child_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    cid = user["id"] if user["role"] == "child" else child_id
    if not cid:
        raise HTTPException(status_code=422, detail="child_id diperlukan")
    m = await db.pet_messages.find_one({"id": message_id, "parent_id": FAMILY_ID}, {"_id": 0})
    if not m or (m.get("child_id") and m["child_id"] != cid):
        raise HTTPException(status_code=404, detail="Pesan tidak ditemukan")
    await db.pet_messages.update_one({"id": message_id}, {"$addToSet": {"read_by": cid}})
    await _pet_log(cid, "message", f"Pesan dari {m.get('from') or 'orang tua'}: “{m['text']}”", "💌")
    return {"success": True}


@api.post("/children/{child_id}/revive-pet")
async def revive_pet(child_id: str, user: dict = Depends(require_parent)):
    """Undo a punishment-caused pet death (a second chance is the parent's to
    give). Also refreshes the feed timestamp so neglect doesn't re-kill it."""
    await get_child_or_404(FAMILY_ID, child_id)
    await db.children.update_one({"id": child_id}, {"$set": {"pet_force_dead": False, "pet_last_fed_at": now_iso()}})
    await log_activity(FAMILY_ID, child_id, "pet_revived", {})
    return {"success": True}


@api.put("/children/{child_id}/segment-starts")
async def set_segment_starts(child_id: str, payload: SegmentStartOverrideInput, user: dict = Depends(require_parent)):
    """Set a child's personal start time per section per weekday.

    Validated against the real sections so a stale id can't silently create an
    override that never applies, and each time must sit inside its section's
    window — a personal start after the section already ends would make the
    mission impossible.
    """
    await get_child_or_404(FAMILY_ID, child_id)
    segments = await _get_day_segments()
    seg_by_id = {s["id"]: s for s in segments}
    cleaned: dict = {}
    for seg_id, per_day in (payload.starts or {}).items():
        seg = seg_by_id.get(seg_id)
        if not seg:
            raise HTTPException(status_code=404, detail=f"Bagian waktu tidak ditemukan: {seg_id}")
        day_map = {}
        for wd, hhmm in (per_day or {}).items():
            if not hhmm:
                continue  # empty = "use the shared start"
            if str(wd) not in {"0", "1", "2", "3", "4", "5", "6"}:
                raise HTTPException(status_code=422, detail=f"Hari tidak valid: {wd}")
            if not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", hhmm):
                raise HTTPException(status_code=422, detail=f"Jam tidak valid: {hhmm}")
            m = _hhmm_to_min(hhmm)
            if m < _hhmm_to_min(seg["start_time"]) or m > _hhmm_to_min(seg["end_time"]):
                raise HTTPException(
                    status_code=422,
                    detail=f'Jam {hhmm} di luar rentang bagian "{seg["label"]}" ({seg["start_time"]}–{seg["end_time"]})',
                )
            day_map[str(wd)] = hhmm
        if day_map:
            cleaned[seg_id] = day_map
    update = {"segment_starts": cleaned}
    if payload.ends is not None:
        ends: dict = {}
        for seg_id, per_day in payload.ends.items():
            seg = seg_by_id.get(seg_id)
            if not seg:
                raise HTTPException(status_code=404, detail=f"Bagian waktu tidak ditemukan: {seg_id}")
            day_map = {}
            for wd, hhmm in (per_day or {}).items():
                if not hhmm:
                    continue  # empty = "use the shared finish"
                if str(wd) not in {"0", "1", "2", "3", "4", "5", "6"}:
                    raise HTTPException(status_code=422, detail=f"Hari tidak valid: {wd}")
                if not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", hhmm):
                    raise HTTPException(status_code=422, detail=f"Jam tidak valid: {hhmm}")
                m = _hhmm_to_min(hhmm)
                start_val = (cleaned.get(seg_id) or {}).get(str(wd)) or seg["start_time"]
                if m > _hhmm_to_min(seg["end_time"]):
                    raise HTTPException(
                        status_code=422,
                        detail=f'Jam selesai {hhmm} lewat dari batas bagian "{seg["label"]}" ({seg["end_time"]})',
                    )
                if m <= _hhmm_to_min(start_val):
                    raise HTTPException(
                        status_code=422,
                        detail=f'Jam selesai {hhmm} harus sesudah jam mulai {start_val} ("{seg["label"]}")',
                    )
                day_map[str(wd)] = hhmm
            if day_map:
                ends[seg_id] = day_map
        update["segment_ends"] = ends
    await db.children.update_one({"id": child_id}, {"$set": update})
    _invalidate_member_cache()
    await log_activity(FAMILY_ID, child_id, "segment_starts_updated", {"sections": len(cleaned)})
    fresh = await get_child_or_404(FAMILY_ID, child_id)
    return {"success": True, "segment_starts": cleaned, "segment_ends": fresh.get("segment_ends") or {}}


@api.get("/children/{child_id}/segment-starts")
async def get_segment_starts(child_id: str, user: dict = Depends(get_current_user)):
    child = await get_child_or_404(FAMILY_ID, child_id)
    return {"segment_starts": child.get("segment_starts") or {}, "segment_ends": child.get("segment_ends") or {}}


@api.post("/children/{child_id}/adjust-points")
async def adjust_points(child_id: str, payload: PointsAdjustInput, user: dict = Depends(require_parent)):
    """Award or deduct points by hand.

    Rules can't anticipate everything: a bug cost a child points they'd earned,
    or something happened worth rewarding that no mission covers. Rather than
    leave a parent stuck with whatever the system decided, this is a plain
    manual correction — always logged with its reason, so the trail stays
    honest, and the Chikybank buckets are re-split so the wallet still adds up.
    """
    child = await get_child_or_404(FAMILY_ID, child_id)
    if payload.points == 0:
        raise HTTPException(status_code=422, detail="Isi jumlah poin yang mau ditambah atau dikurangi")

    before = int(child.get("points", 0))
    inc = {"points": payload.points}
    # Only a gain counts toward lifetime totals and levels: clawing back points
    # shouldn't also erase a child's record of everything they've ever earned.
    if payload.points > 0:
        inc["lifetime_points"] = payload.points
    await db.children.update_one({"id": child_id}, {"$inc": inc})

    config = await get_config_cached()
    await _rebalance_child_buckets(child_id, config)
    after = (await db.children.find_one({"id": child_id}, {"_id": 0, "points": 1}))["points"]

    await log_activity(FAMILY_ID, child_id, "points_adjusted", {
        "delta": payload.points, "before": before, "after": after,
        "reason": payload.reason.strip(), "by": user.get("name", ""),
    })
    if payload.points > 0:
        await send_push_to({"role": "child", "member_id": child_id},
                           title=f"Dapat {payload.points} poin ✨",
                           body=payload.reason.strip() or "Dari Abi/Ummi",
                           url=f"/kid/{child_id}")
    return {"success": True, "before": before, "after": after, "delta": payload.points}


@api.post("/children/{child_id}/penalty-cards")
async def set_penalty_cards(child_id: str, payload: PenaltyCardsSetInput, user: dict = Depends(require_parent)):
    """Parent adjusts/resets a kid's Kartu Hukuman count — typically back to 0
    after the real-world consequence has been served."""
    child = await get_child_or_404(FAMILY_ID, child_id)
    await db.children.update_one({"id": child_id}, {"$set": {"penalty_cards": payload.penalty_cards}})
    await log_activity(FAMILY_ID, child_id, "penalty_cards_set", {"from": int(child.get("penalty_cards", 0)), "to": payload.penalty_cards})
    return {"success": True, "penalty_cards": payload.penalty_cards}


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



# ---- Lazy day preparation -------------------------------------------------
# The schedule used to be pre-built a fortnight ahead by a sweep that ran on
# reads. Now only the days somebody is about to look at are built — today and
# tomorrow by default, or one specific date a parent opens — and the work is
# remembered per container (and per family in the database) so a warm request
# pays nothing for it.
_DAYS_READY_TTL = 600.0
_DAYS_READY: dict = {"at": {}, "dirty": False}


def _invalidate_days_ready():
    """Something that shapes a day changed (a repeating task, a template, an
    off day, vacation mode): rebuild the near days on the next request."""
    _DAYS_READY["at"].clear()
    _DAYS_READY["dirty"] = True


def _near_days() -> List[str]:
    today = _today_key()
    tomorrow = (datetime.strptime(today, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
    return [today, tomorrow]


async def _ensure_days_ready(days: Optional[List[str]] = None, force: bool = False,
                             trust_marker: bool = True) -> int:
    """Build the given days (default: today + tomorrow) from the default
    template and the repeating series, at most once per TTL. Idempotent."""
    import time as _t
    near = _near_days()
    days = sorted({d for d in (days or near) if d and d >= near[0]})
    if not days:
        return 0
    is_near = set(days) <= set(near)
    now_m = _t.monotonic()
    if not force and not _DAYS_READY["dirty"]:
        due = [d for d in days if now_m - _DAYS_READY["at"].get(d, -1e12) > _DAYS_READY_TTL]
        if not due:
            return 0
        if is_near and trust_marker:
            # Another container may have just done it: honour the family-wide
            # marker (read from the cached config — no extra round trip).
            last = (await get_config_cached()).get("last_materialize_at")
            if last and isinstance(last, str):
                try:
                    age = (datetime.now(timezone.utc) - datetime.fromisoformat(last.replace("Z", "+00:00"))).total_seconds()
                    if 0 <= age < _DAYS_READY_TTL:
                        for d in due:
                            _DAYS_READY["at"][d] = now_m
                        return 0
                except Exception:
                    pass
    else:
        due = days
    # Mark before working so concurrent requests in this container don't pile
    # onto the same build. (No asyncio.Lock: serverless hosts can resume the
    # process under a different event loop, which a module-level lock survives
    # badly.)
    for d in due:
        _DAYS_READY["at"][d] = now_m
    _DAYS_READY["dirty"] = False
    try:
        created = 0
        # A family still on the old per-task schedule is moved onto the weekly
        # routine first (once), so the routine is the only thing that builds.
        await _ensure_routine_migrated()
        # The weekly routine is the schedule. Its builder is idempotent per
        # slot and remembers each built day, so it is safe to call for any day.
        for d in due:
            created += await _ensure_day_built(d)
    except Exception:
        for d in due:
            _DAYS_READY["at"].pop(d, None)
        raise
    if is_near:
        await _write_config({"$set": {"last_materialize_at": datetime.now(timezone.utc).isoformat()}})
    return created


_ROUTINE_MIGRATED = {"done": False}


async def _ensure_routine_migrated():
    if _ROUTINE_MIGRATED["done"]:
        return
    await _migrate_legacy_to_routine()
    await _cleanup_legacy_schedule()
    _ROUTINE_MIGRATED["done"] = True


def _schedule_materialize():
    """Fire-and-forget variant for paths that must not wait. Serverless hosts
    may freeze a process right after the response, so the paths a child sees
    first await _ensure_days_ready instead; this stays as a best-effort nudge."""
    try:
        task = asyncio.create_task(_ensure_days_ready())
        task.add_done_callback(lambda t: t.exception() if not t.cancelled() else None)
    except RuntimeError:
        pass


async def _maybe_materialize_recurring():
    """Kept for callers of the old name: builds today + tomorrow only."""
    return await _ensure_days_ready()



class TaskReorderInput(BaseModel):
    task_ids: List[str] = Field(min_length=1, max_length=200)


@api.post("/tasks/reorder")
async def reorder_tasks(payload: TaskReorderInput, user: dict = Depends(require_parent)):
    """Persist a drag-and-drop reordering: the given ids are numbered 1..n in
    the order supplied. Applies to whatever slice the parent is looking at (one
    child, one day, one section), so it never disturbs tasks outside that view.

    Unknown ids are rejected outright rather than silently skipped — a partial
    apply would leave the list in a state the parent didn't ask for.
    """
    found = await db.tasks.find({"parent_id": FAMILY_ID, "id": {"$in": payload.task_ids}}, {"_id": 0, "id": 1}).to_list(500)
    known = {t["id"] for t in found}
    missing = [tid for tid in payload.task_ids if tid not in known]
    if missing:
        raise HTTPException(status_code=404, detail=f"{len(missing)} misi tidak ditemukan")
    if len(set(payload.task_ids)) != len(payload.task_ids):
        raise HTTPException(status_code=422, detail="Ada misi yang tercantum lebih dari sekali")
    for idx, tid in enumerate(payload.task_ids, start=1):
        await db.tasks.update_one({"id": tid}, {"$set": {"order": idx}})
    await log_activity(FAMILY_ID, None, "tasks_reordered", {"count": len(payload.task_ids)})
    return {"success": True, "reordered": len(payload.task_ids)}


class BulkDeleteInput(BaseModel):
    task_ids: List[str] = Field(min_length=1, max_length=500)



@api.post("/tasks/bulk-delete")
async def bulk_delete_tasks(payload: BulkDeleteInput, user: dict = Depends(require_parent)):
    """Delete many tasks at once. Cleaning up after a bad import one row at a
    time is miserable, so the parent can tick a batch and remove it in one go.
    Unknown ids are simply skipped rather than failing the whole request."""
    existing = await db.tasks.find(
        {"parent_id": FAMILY_ID, "id": {"$in": payload.task_ids}}, {"_id": 0, "id": 1}
    ).to_list(500)
    ids = [t["id"] for t in existing]
    if not ids:
        raise HTTPException(status_code=404, detail="Tidak ada tugas yang cocok untuk dihapus")
    res = await db.tasks.delete_many({"parent_id": FAMILY_ID, "id": {"$in": ids}})
    await log_activity(FAMILY_ID, None, "tasks_bulk_deleted", {"count": res.deleted_count})
    return {"success": True, "deleted": res.deleted_count, "skipped": len(payload.task_ids) - len(ids)}



# ---- Stage 3: compact the pre-built schedule -------------------------------

async def _apply_approval_rewards(child_id: str, points: int, config: dict, care: Optional[str] = None) -> dict:
    """Applies streak/Chikybank updates for ONE child earning
    `points` from an approval. Returns a snapshot describing exactly what
    changed, so a later undo can reverse precisely this — used for both the
    normal single-child path and, once per participant, for co-op tasks."""
    child = await db.children.find_one({"id": child_id})
    today = _today_key()
    yesterday = (_now_local() - timedelta(days=1)).strftime("%Y-%m-%d")
    # An off day shouldn't break a streak: walk "yesterday" back over any
    # declared off days so a kid who last completed the day BEFORE a family
    # holiday continues their streak the day after it, without burning a
    # Guard-capped against pathological all-off calendars.
    effective_yesterday = yesterday
    for _ in range(60):
        if not await _is_off_day(effective_yesterday):
            break
        effective_yesterday = (datetime.strptime(effective_yesterday, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
    last_date = child.get("last_completion_date")
    prev_streak = child.get("streak_days", 0)
    prev_last_completion = last_date

    if last_date == today:
        streak = child.get("streak_days", 0)
    elif last_date == yesterday or last_date == effective_yesterday:
        streak = child.get("streak_days", 0) + 1
    else:
        # A real gap resets the streak. There is no Kartu Bebas to spend here
        # any more — lateness is owned via the Terlambat flow instead.
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
    care = care if care in ("water", "play") else "food"

    await db.children.update_one(
        {"id": child_id},
        {
            "$inc": {
                "points": points, "lifetime_points": points, "tasks_completed": 1,
                "chiky_save": p_save, "chiky_spend": p_spend, "chiky_share": p_share,
                **_care_inc(care, feed_earned),
            },
            "$set": {
                "last_completion_date": today, "streak_days": streak,
                "best_streak_days": new_best_streak,
            },
        },
    )
    return {
        "child_id": child_id, "points": points,
        "chiky_save": p_save, "chiky_spend": p_spend, "chiky_share": p_share,
        "prev_streak": prev_streak, "prev_last_completion": prev_last_completion,
        "prev_best_streak": prev_best_streak,
        "feed_earned": feed_earned, "care": care,
    }


def _care_inc(care: str, n: int) -> dict:
    """Where an approved mission's pet reward lands: pakan (food, the default),
    air (water) or mainan (play)."""
    if care == "water":
        return {"water_balance": n}
    if care == "play":
        return {"play_balance": n}
    return {"feed_balance": n, "feed_lifetime": n}


@api.post("/tasks/{task_id}/approve")
async def approve_task(task_id: str, payload: TaskApproveInput = TaskApproveInput(), user: dict = Depends(require_parent)):
    task = await db.tasks.find_one({"id": task_id, "parent_id": FAMILY_ID})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task["status"] != "completed":
        raise HTTPException(status_code=400, detail="Task must be completed first")

    if payload.encouragement_voice_url and len(payload.encouragement_voice_url) > 2_000_000:
        raise HTTPException(status_code=413, detail="Pesan suara terlalu besar (maks ~1.5MB)")

    config = await get_config_cached()

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
            snap = await _apply_approval_rewards(cid, share, config, care=task.get("pet_care"))
            snapshots.append(snap)

        await db.tasks.update_one(
            {"id": task_id},
            {"$set": {
                "status": "approved",
                "approved_at": now_iso(),
                "_undo_coop_snapshots": snapshots,
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
        combo = await _check_family_combo(task.get("date_key"), config)
        return {"task": await db.tasks.find_one({"id": task_id}, {"_id": 0}), "new_badges": new_badges, "family_combo": combo}

    # --- Normal single-child path ---
    child = await db.children.find_one({"id": task["child_id"]})
    if not child:
        raise HTTPException(status_code=404, detail="Child not found")

    together_bonus_awarded = 0
    if task.get("together_bonus_enabled") and task.get("done_together") is True:
        together_bonus_awarded = task.get("together_bonus_points") or 0
    points = task["points"] + together_bonus_awarded
    if task.get("late_no_points"):
        # At-fault lateness: the kid chose to continue anyway, which is the
        # honest thing to do — but the reward is gone. No base points and no
        # bonuses of any kind.
        points = 0
        together_bonus_awarded = 0
    snap = await _apply_approval_rewards(task["child_id"], points, config, care=task.get("pet_care"))

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
                "together_bonus_awarded": together_bonus_awarded,
                "_undo_chiky_save": snap["chiky_save"],
                "_undo_chiky_spend": snap["chiky_spend"],
                "_undo_chiky_share": snap["chiky_share"],
                "_undo_prev_best_streak": snap["prev_best_streak"],
                "_undo_feed_earned": snap["feed_earned"], "_undo_care": snap["care"],
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
    combo = await _check_family_combo(task.get("date_key"), config)
    return {"task": await db.tasks.find_one({"id": task_id}, {"_id": 0}), "new_badges": new_badges, "family_combo": combo}


async def _check_family_combo(date_key: Optional[str], config: dict):
    """🤝 Family Combo: when EVERY kid who has required tasks on this date has
    finished ALL of them (approved/skipped), each gets a bonus — encouraging
    siblings to cheer each other on rather than compete. Needs at least two
    kids with required tasks that day (one kid alone isn't a 'combo'), awards
    exactly once per date, and splits into the Chikybank buckets like normal
    earnings. 0-point config turns the feature off."""
    bonus = int(config.get("family_combo_bonus_points", 10))
    if bonus <= 0 or not date_key:
        return None
    if await db.family_combo_awards.find_one({"parent_id": FAMILY_ID, "date_key": date_key}):
        return None  # already awarded for this date
    kids = await db.children.find({"parent_id": FAMILY_ID}, {"_id": 0}).to_list(50)
    with_tasks = []
    for k in kids:
        req = await db.tasks.find({
            "parent_id": FAMILY_ID, "date_key": date_key, "is_bonus": {"$ne": True},
            "status": {"$ne": "off"},
            "$or": [{"child_id": k["id"]}, {"is_coop": True, "coop_participants": k["id"]}],
        }).to_list(500)
        if not req:
            continue
        all_done = all(t["status"] in ("approved", "skipped") for t in req)
        with_tasks.append((k, all_done))
    if len(with_tasks) < 2 or not all(done for _, done in with_tasks):
        return None
    save_pct = int(config.get("chiky_save_pct", 40))
    spend_pct = int(config.get("chiky_spend_pct", 40))
    share_pct = int(config.get("chiky_share_pct", 20))
    total_pct = save_pct + spend_pct + share_pct or 100
    b_save = round(bonus * save_pct / total_pct)
    b_spend = round(bonus * spend_pct / total_pct)
    b_share = bonus - b_save - b_spend
    child_ids = [k["id"] for k, _ in with_tasks]
    for k, _ in with_tasks:
        await db.children.update_one({"id": k["id"]}, {"$inc": {
            "points": bonus, "lifetime_points": bonus,
            "chiky_save": b_save, "chiky_spend": b_spend, "chiky_share": b_share,
        }})
        await send_push_to({"role": "child", "member_id": k["id"]}, title="Kompak sekeluarga! 🤝🎉", body=f"Semua misi wajib selesai bareng — kamu dapat +{bonus} poin bonus!", url=f"/kid/{k['id']}")
    await db.family_combo_awards.insert_one({
        "id": new_id(), "parent_id": FAMILY_ID, "date_key": date_key,
        "points_per_child": bonus, "child_ids": child_ids, "awarded_at": now_iso(),
    })
    await log_activity(FAMILY_ID, None, "family_combo_awarded", {"date_key": date_key, "points": bonus, "children": len(child_ids)})
    return {"points": bonus, "child_ids": child_ids}


async def _reverse_task_points(task: dict, restore_streak: bool) -> int:
    """Take back exactly what approving this mission gave (points, Chikybank
    split, pet food). A quick undo also restores the streak as it was; a later
    correction leaves the streak alone, because other days have built on it
    since. Returns the points taken back."""
    if task.get("is_coop"):
        total = 0
        for snap in task.get("_undo_coop_snapshots") or []:
            upd = {"$inc": {
                "points": -snap["points"], "lifetime_points": -snap["points"], "tasks_completed": -1,
                "chiky_save": -snap["chiky_save"], "chiky_spend": -snap["chiky_spend"], "chiky_share": -snap["chiky_share"],
                **_care_inc(snap.get("care", "food"), -snap.get("feed_earned", 0)),
            }}
            if restore_streak:
                upd["$set"] = {"streak_days": snap["prev_streak"], "last_completion_date": snap["prev_last_completion"],
                               "best_streak_days": snap.get("prev_best_streak", 0)}
            await db.children.update_one({"id": snap["child_id"]}, upd)
            total += snap["points"]
        await db.tasks.update_one({"id": task["id"]}, {"$unset": {
            "_undo_coop_snapshots": "", "_undo_spawned_next_id": "",
            "encouragement_message": "", "encouragement_voice_url": ""}})
        return total
    points = task.get("_undo_points_awarded", task.get("points", 0))
    feed = task.get("_undo_feed_earned", 0)
    upd = {"$inc": {
        "points": -points, "lifetime_points": -points, "tasks_completed": -1,
        "chiky_save": -task.get("_undo_chiky_save", 0), "chiky_spend": -task.get("_undo_chiky_spend", 0),
        "chiky_share": -task.get("_undo_chiky_share", 0),
        **_care_inc(task.get("_undo_care", "food"), -feed),
    }}
    if restore_streak:
        upd["$set"] = {"streak_days": task.get("_undo_prev_streak", 0),
                       "last_completion_date": task.get("_undo_prev_last_completion"),
                       "best_streak_days": task.get("_undo_prev_best_streak", 0)}
    await db.children.update_one({"id": task["child_id"]}, upd)
    await db.tasks.update_one({"id": task["id"]}, {"$unset": {
        "_undo_prev_streak": "", "_undo_prev_last_completion": "", "_undo_points_awarded": "",
        "_undo_chiky_save": "", "_undo_chiky_spend": "", "_undo_chiky_share": "", "_undo_spawned_next_id": "",
        "_undo_prev_best_streak": "", "_undo_feed_earned": "", "_undo_care": "",
        "encouragement_message": "", "encouragement_voice_url": ""}})
    return points


UNDO_WINDOW_MINUTES = 30


@api.post("/tasks/{task_id}/undo-approval")
async def undo_task_approval(task_id: str, user: dict = Depends(require_parent)):
    """Reverse a mistaken approval within a short window: refunds the points/Chikybank
    split and restores the previous streak."""
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

    points = await _reverse_task_points(task, restore_streak=True)
    await db.tasks.update_one({"id": task_id}, {"$set": {"status": "completed", "approved_at": None}})
    await log_activity(FAMILY_ID, task["child_id"], "task_approval_undone",
                       {"task_id": task_id, "points_reversed": points, "coop": bool(task.get("is_coop"))})
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
    an approval (which affects streak state that only makes sense
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
    _invalidate_days_ready()
    config_doc = await db.app_config.find_one({"parent_id": FAMILY_ID})
    if config_doc:
        update_data = {k: v for k, v in payload.model_dump().items() if v is not None}
        if update_data.get("late_reasons") is not None:
            for opt in update_data["late_reasons"]:
                if not opt.get("id"):
                    opt["id"] = new_id()[:8]
        if update_data.get("punishment_options") is not None:
            for opt in update_data["punishment_options"]:
                if not opt.get("id"):
                    opt["id"] = new_id()[:8]
        if update_data.get("day_segments") is not None:
            _validate_day_segments(update_data["day_segments"])
        # Merge dict-typed fields so partial updates don't wipe existing keys.
        for dict_field in ("custom_labels", "weekday_goals"):
            if dict_field in update_data:
                merged = dict(config_doc.get(dict_field) or {})
                merged.update(update_data[dict_field])
                # Drop keys explicitly set to None (allows clearing a single label)
                merged = {k: v for k, v in merged.items() if v is not None}
                update_data[dict_field] = merged
        if update_data:
            await _write_config({"$set": update_data})
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
            "daily_point_goal": 50,
            "weekday_goals": {},
            "chiky_save_pct": 40,
            "chiky_spend_pct": 40,
            "chiky_share_pct": 20,
            "family_combo_bonus_points": 10,
            "late_reasons": DEFAULT_LATE_REASONS,
            "penalty_card_threshold": DEFAULT_PENALTY_CARD_THRESHOLD,
            "punishment_mode": DEFAULT_PUNISHMENT_MODE,
            "punishment_options": DEFAULT_PUNISHMENT_OPTIONS,
            "punishment_deadline_weekday": DEFAULT_PUNISHMENT_DEADLINE_WEEKDAY,
            "punishment_overdue_action": DEFAULT_PUNISHMENT_OVERDUE_ACTION,
            "day_segments": DEFAULT_DAY_SEGMENTS,
            "segment_late_grace_minutes": 15,
            "auto_approve_tasks": True,
            "exam_false_claim_penalty": 100,
            "honesty_bonus_points": 2,
            "spot_checks_enabled": True,
            "probation_days": 3,
            "strike_window_days": 14,
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
        if incoming.get("late_reasons") is not None:
            for opt in incoming["late_reasons"]:
                if not opt.get("id"):
                    opt["id"] = new_id()[:8]
        if incoming.get("punishment_options") is not None:
            for opt in incoming["punishment_options"]:
                if not opt.get("id"):
                    opt["id"] = new_id()[:8]
        if incoming.get("day_segments") is not None:
            _validate_day_segments(incoming["day_segments"])
        config = {"id": new_id(), "parent_id": FAMILY_ID, "created_at": now_iso(), **defaults, **incoming}
        await db.app_config.insert_one(config)
        _invalidate_config_cache()  # the cached defaults must not outlive the first save
    await log_activity(FAMILY_ID, None, "config_updated", {"changes": payload.model_dump()})
    return {"success": True}


class MaintenanceToggleInput(BaseModel):
    enabled: bool
    message: str = Field(default="", max_length=300)


def _deployed_version() -> str:
    """Which commit this server is running. Vercel exposes it at runtime, so the
    app can tell whether a device is holding an outdated bundle."""
    sha = os.environ.get("VERCEL_GIT_COMMIT_SHA") or os.environ.get("APP_BUILD_SHA") or "dev"
    return sha[:7] if sha != "dev" else sha


@api.get("/version")
async def app_version():
    """Public and cheap: no database, no auth. Used by every open app to notice
    a new deploy and reload itself instead of running stale code indefinitely."""
    return {"version": _deployed_version()}


@api.get("/warmup")
async def warmup():
    """Cheap endpoint for a scheduler to ping, so a container stays alive.

    Vercel freezes idle containers; the next visitor then pays for DNS, TLS,
    auth and imports before seeing anything. Touching the database here means
    the connection is genuinely open, not merely the process resident — a ping
    that skips the DB would leave the expensive half of the cold start intact.
    """
    ok = True
    try:
        await db.app_config.find_one({"parent_id": FAMILY_ID}, {"_id": 1})
        # While we're here, have today and tomorrow ready before anyone looks
        # (a no-op when another tick or request already built them).
        await _ensure_days_ready()
    except Exception:
        ok = False
    try:
        # Old inline pictures move to `media` a small batch per ping; once
        # none are left this is a single flag lookup.
        await _maybe_offload_task_photos(50)
    except Exception:  # noqa: BLE001 — a warm-up must never fail on this
        pass
    return {"ok": ok, "at": now_iso(), "version": _deployed_version()}


@api.get("/maintenance-status")
async def maintenance_status():
    """Public, unauthenticated — lets the frontend show a friendly 'app is
    paused' screen even for someone who isn't logged in (or whose session just
    got locked out), without needing a valid token first."""
    config = await get_config_cached()
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
        await _write_config({"$set": updates})
    else:
        await db.app_config.insert_one({"id": new_id(), "parent_id": FAMILY_ID, "created_at": now_iso(), **updates})
    await log_activity(FAMILY_ID, None, "maintenance_toggled", {"enabled": payload.enabled, "by": user.get("name")})
    return {"success": True, "enabled": payload.enabled}


@api.get("/config")
async def get_app_config(user: dict = Depends(get_current_user), lite: bool = False):
    if lite:
        # Labels/language/goals only — without the uploaded background image,
        # which can be hundreds of KB and is only shown on the login screen.
        full = await get_app_config(user, False)
        return {k: v for k, v in full.items() if k not in _HEAVY_CONFIG_FIELDS and k != "_id"}
    config = await db.app_config.find_one({"parent_id": FAMILY_ID})
    if not config:
        return {
            "app_name": "My Lil Famz",
            "default_theme": "clean",
            "slideshow_background_url": "",
            "slideshow_background_image": "",
            "rupiah_per_point": 100,
            "daily_point_goal": 50,
            "weekday_goals": {},
            "chiky_save_pct": 40,
            "chiky_spend_pct": 40,
            "chiky_share_pct": 20,
            "family_combo_bonus_points": 10,
            "late_reasons": DEFAULT_LATE_REASONS,
            "penalty_card_threshold": DEFAULT_PENALTY_CARD_THRESHOLD,
            "punishment_mode": DEFAULT_PUNISHMENT_MODE,
            "punishment_options": DEFAULT_PUNISHMENT_OPTIONS,
            "punishment_deadline_weekday": DEFAULT_PUNISHMENT_DEADLINE_WEEKDAY,
            "punishment_overdue_action": DEFAULT_PUNISHMENT_OVERDUE_ACTION,
            "day_segments": DEFAULT_DAY_SEGMENTS,
            "segment_late_grace_minutes": 15,
            "auto_approve_tasks": True,
            "exam_false_claim_penalty": 100,
            "honesty_bonus_points": 2,
            "spot_checks_enabled": True,
            "probation_days": 3,
            "strike_window_days": 14,
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
        "daily_point_goal": int(config.get("daily_point_goal", 50)),
        "weekday_goals": config.get("weekday_goals", {}) or {},
        "chiky_save_pct": int(config.get("chiky_save_pct", 40)),
        "chiky_spend_pct": int(config.get("chiky_spend_pct", 40)),
        "chiky_share_pct": int(config.get("chiky_share_pct", 20)),
        "family_combo_bonus_points": int(config.get("family_combo_bonus_points", 10)),
        "late_reasons": config.get("late_reasons") or DEFAULT_LATE_REASONS,
        "penalty_card_threshold": int(config.get("penalty_card_threshold", DEFAULT_PENALTY_CARD_THRESHOLD)),
        "punishment_mode": config.get("punishment_mode", DEFAULT_PUNISHMENT_MODE),
        "punishment_options": config.get("punishment_options") or DEFAULT_PUNISHMENT_OPTIONS,
        "punishment_deadline_weekday": int(config.get("punishment_deadline_weekday", DEFAULT_PUNISHMENT_DEADLINE_WEEKDAY)),
        "punishment_overdue_action": config.get("punishment_overdue_action", DEFAULT_PUNISHMENT_OVERDUE_ACTION),
        "day_segments": config.get("day_segments") or DEFAULT_DAY_SEGMENTS,
        "segment_late_grace_minutes": int(config.get("segment_late_grace_minutes", 15)),
        "auto_approve_tasks": bool(config.get("auto_approve_tasks", True)),
        "exam_false_claim_penalty": int(config.get("exam_false_claim_penalty", 100)),
        "honesty_bonus_points": int(config.get("honesty_bonus_points", 2)),
        "spot_checks_enabled": bool(config.get("spot_checks_enabled", True)),
        "probation_days": int(config.get("probation_days", 3)),
        "strike_window_days": int(config.get("strike_window_days", 14)),
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

# --------------- Rewards ---------------
@api.get("/rewards")
async def list_rewards(user: dict = Depends(get_current_user)):
    rewards = await db.rewards.find({"parent_id": FAMILY_ID}, {"_id": 0}).to_list(200)
    rewards.sort(key=lambda r: r.get("cost_points", 0))
    return _with_media_refs("reward", rewards)


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
    if isinstance(raw.get("image"), str) and raw["image"].startswith(MEDIA_PREFIX):
        raw.pop("image")  # the form echoed back the served URL: image unchanged
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
    config = await get_config_cached()
    daily_goal = int(config.get("daily_point_goal", 50))
    save_pct = int(config.get("chiky_save_pct", 40))
    spend_pct = int(config.get("chiky_spend_pct", 40))
    share_pct = int(config.get("chiky_share_pct", 20))
    total_pct = (save_pct + spend_pct + share_pct) or 100
    # Expected savings earned per day if the child hits their daily point goal —
    # used to estimate "about N days to go". Deterministic and easy to explain
    # (no dependency on messy historical data).
    expected_daily_savings = daily_goal * save_pct / total_pct

    # Two batched reads instead of two per wishlist item.
    _rw = {r["id"]: r for r in await db.rewards.find(
        {"parent_id": FAMILY_ID, "id": {"$in": list({i["reward_id"] for i in items})}}, {"_id": 0}).to_list(None)} if items else {}
    _ch = {c["id"]: c for c in await db.children.find(
        {"parent_id": FAMILY_ID, "id": {"$in": list({i["child_id"] for i in items})}}, {"_id": 0}).to_list(None)} if items else {}
    out = []
    for item in items:
        reward = _rw.get(item["reward_id"])
        if not reward:
            continue  # reward was deleted since being wishlisted; skip silently
        child = _ch.get(item["child_id"])
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



# ---- Honesty: corrections, owning up, trust and surprise checks -------------
# Principle: telling the truth must always cost less than lying.
#  * Owning up (unticking a mission that wasn't really done) never costs a
#    minus; owning up when asked about it even earns a small bonus.
#  * A parent's correction of a ticked-but-not-done mission climbs a ladder
#    that resets after a clean stretch: 1st → points back + an equal minus,
#    the mission is redone for nothing (redoing it earns the minus back);
#    2nd → also a penalty card and a few days of closer watch; 3rd → the
#    penalty-card threshold is reached, so the family's punishment follows.
#  * Every correction asks the child for a short reflection.
#  * A trust score (0–100) drops with corrections and grows back with clean
#    days, passed surprise checks and honest admissions. The higher it is, the
#    rarer the surprise checks.
TRUST_START = 80
TRUST_CLEAN_DAY = 2
CORRECTION_TRUST_DROP = {1: 20, 2: 30, 3: 40}
SPOT_CHECK_HOURS = 3
SPOT_CHECK_DAILY_CAP = 2
REFLECTION_MIN_WORDS = 8


def _trust(child: Optional[dict]) -> int:
    v = (child or {}).get("trust_score")
    return TRUST_START if v is None else int(v)


async def _bump_trust(child_id: str, delta: int, why: str) -> int:
    child = await db.children.find_one({"id": child_id}, {"_id": 0, "trust_score": 1})
    new = max(0, min(100, _trust(child) + delta))
    await db.children.update_one({"id": child_id}, {"$set": {"trust_score": new}})
    await db.trust_log.insert_one({"parent_id": FAMILY_ID, "child_id": child_id, "delta": delta,
                                   "score": new, "why": why, "date_key": _today_key(), "at": now_iso()})
    return new


async def _refresh_trust(child_id: str) -> None:
    """Clean days since the last check grow trust back, and a finished watch
    period is lifted (and counted, if it passed without a new correction)."""
    child = await db.children.find_one({"id": child_id}, {"_id": 0})
    if not child:
        return
    today = _today_key()
    last = child.get("trust_checked_date")
    if last and last < today:
        days = (datetime.strptime(today, "%Y-%m-%d") - datetime.strptime(last, "%Y-%m-%d")).days
        bad = await db.corrections.count_documents({"child_id": child_id, "undone": {"$ne": True},
                                                    "date_key": {"$gte": last, "$lt": today}})
        if days > 0 and not bad and _trust(child) < 100:
            await _bump_trust(child_id, min(days, 7) * TRUST_CLEAN_DAY, "hari bersih")
    upd = {"trust_checked_date": today}
    until = child.get("probation_until")
    if until and until < today:
        upd["probation_until"] = None
        since = child.get("probation_since") or until
        clean = not await db.corrections.count_documents({
            "child_id": child_id, "undone": {"$ne": True}, "date_key": {"$gt": since}})
        if clean:
            upd["probations_passed"] = int(child.get("probations_passed") or 0) + 1
            await _bump_trust(child_id, 10, "lulus masa pengawasan")
            await send_push_to({"role": "child", "member_id": child_id}, title="Masa pengawasan selesai 🌟",
                               body="Kamu berhasil! Kepercayaan Abi/Ummi bertambah.", url=f"/kid/{child_id}")
    await db.children.update_one({"id": child_id}, {"$set": upd})
    if upd.get("probations_passed"):
        await award_badges(FAMILY_ID, child_id)


def _in_probation(child: Optional[dict], dk: Optional[str] = None) -> bool:
    until = (child or {}).get("probation_until")
    return bool(until) and (dk or _today_key()) <= until


async def _change_points(child_id: str, delta: int) -> None:
    """Add or take points and re-split the Chikybank so it still adds up."""
    if not delta:
        return
    inc = {"points": delta}
    if delta > 0:
        inc["lifetime_points"] = delta
    await db.children.update_one({"id": child_id}, {"$inc": inc})
    await _rebalance_child_buckets(child_id, await get_config_cached())


async def _strike_count(child_id: str, config: dict) -> int:
    since = (datetime.strptime(_today_key(), "%Y-%m-%d")
             - timedelta(days=int(config.get("strike_window_days", 14)))).strftime("%Y-%m-%d")
    return await db.corrections.count_documents({"child_id": child_id, "undone": {"$ne": True},
                                                 "date_key": {"$gt": since}})


def _task_owner(task: dict, user: dict) -> str:
    owners = task.get("coop_participants") or [task.get("child_id")]
    if user["role"] == "child":
        if user["id"] not in owners:
            raise HTTPException(status_code=403, detail="Bukan milikmu")
        return user["id"]
    return task.get("child_id")


class CorrectionInput(BaseModel):
    note: str = Field(default="", max_length=300)


@api.post("/tasks/{task_id}/correct")
async def correct_task(task_id: str, payload: CorrectionInput = CorrectionInput(), user: dict = Depends(require_parent)):
    """'Tidak dikerjakan': the child ticked it, but it wasn't really done. Only
    this mission is affected — everything else in the section keeps its points."""
    task = await db.tasks.find_one({"id": task_id, "parent_id": FAMILY_ID}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Misi tidak ditemukan")
    if task.get("correction_id") and task.get("correction_redo"):
        raise HTTPException(status_code=409, detail="Misi ini sudah dikoreksi")
    done = task.get("checked") or task.get("status") in ("completed", "approved")
    if not done:
        raise HTTPException(status_code=400, detail="Misi ini belum dicentang — tidak ada yang perlu dikoreksi")
    child_id = task["child_id"]
    config = await get_config_cached()
    level = min(3, await _strike_count(child_id, config) + 1)
    reversed_pts = await _reverse_task_points(task, restore_streak=False) if task.get("status") == "approved" else 0
    minus = int(task.get("points") or 0)
    await _change_points(child_id, -minus)
    card = probation = False
    child = await db.children.find_one({"id": child_id}, {"_id": 0})
    if level >= 2:
        threshold = int(config.get("penalty_card_threshold", DEFAULT_PENALTY_CARD_THRESHOLD))
        cards = int(child.get("penalty_cards", 0)) + 1
        if level >= 3:
            cards = max(cards, threshold)
        await db.children.update_one({"id": child_id}, {"$set": {"penalty_cards": cards}})
        card = True
        if cards >= threshold:
            await _issue_punishment({**child, "id": child_id}, config, cards)
    if level >= 2:
        days = int(config.get("probation_days", 3))
        until = (datetime.strptime(_today_key(), "%Y-%m-%d") + timedelta(days=days - 1)).strftime("%Y-%m-%d")
        await db.children.update_one({"id": child_id}, {"$set": {
            "probation_until": max(until, child.get("probation_until") or ""), "probation_since": _today_key()}})
        probation = True
    cid = new_id()
    doc = {
        "id": cid, "parent_id": FAMILY_ID, "child_id": child_id, "task_id": task_id, "title": task.get("title"),
        "date_key": _today_key(), "task_date": task.get("date_key"), "level": level,
        "minus": minus, "points_reversed": reversed_pts, "card": card, "probation": probation,
        "note": payload.note.strip(), "by": user.get("name", ""), "at": now_iso(),
        "redo_status": "open", "minus_refunded": False, "undone": False,
    }
    await db.corrections.insert_one(dict(doc))
    await db.tasks.update_one({"id": task_id}, {"$set": {
        "status": "pending", "checked": False, "checked_at": None, "completed_at": None, "approved_at": None,
        "late_no_points": True, "correction_id": cid, "correction_redo": True, "redo_claimed_at": None,
        **(_TIMER_CLEAR if task.get("timed") else {}),
    }})
    await db.reflections.insert_one({
        "id": new_id(), "parent_id": FAMILY_ID, "child_id": child_id, "correction_id": cid,
        "title": task.get("title"), "status": "pending", "text": None, "created_at": now_iso(),
    })
    await _bump_trust(child_id, -CORRECTION_TRUST_DROP[level], f"koreksi: {task.get('title')}")
    await log_activity(FAMILY_ID, child_id, "task_corrected", {
        "title": task.get("title"), "level": level, "minus": minus, "card": card, "probation": probation})
    await send_push_to(
        {"role": "child", "member_id": child_id}, title="Ada misi yang perlu dibetulkan 🔁",
        body=f'"{task.get("title")}" ternyata belum dikerjakan. Kerjakan sekarang ya, lalu tulis refleksimu.',
        url=f"/kid/{child_id}")
    doc.pop("_id", None)
    return doc


@api.post("/corrections/{correction_id}/undo")
async def undo_correction(correction_id: str, user: dict = Depends(require_parent)):
    """A correction made by mistake: the minus, the card and the watch period
    it caused are taken back. The mission stays open for a parent to approve."""
    c = await db.corrections.find_one({"id": correction_id, "parent_id": FAMILY_ID}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Koreksi tidak ditemukan")
    if c.get("undone"):
        raise HTTPException(status_code=400, detail="Koreksi ini sudah dibatalkan")
    if not c.get("minus_refunded"):
        await _change_points(c["child_id"], int(c.get("minus") or 0))
    if c.get("card"):
        await db.children.update_one({"id": c["child_id"], "penalty_cards": {"$gt": 0}}, {"$inc": {"penalty_cards": -1}})
    if c.get("probation"):
        await db.children.update_one({"id": c["child_id"]}, {"$set": {"probation_until": None}})
    await db.corrections.update_one({"id": correction_id}, {"$set": {"undone": True, "undone_at": now_iso()}})
    await db.reflections.delete_many({"correction_id": correction_id, "status": "pending"})
    await db.tasks.update_one({"id": c["task_id"]}, {"$set": {"correction_redo": False, "late_no_points": False},
                                                       "$unset": {"correction_id": ""}})
    await _bump_trust(c["child_id"], CORRECTION_TRUST_DROP.get(int(c.get("level") or 1), 20), "koreksi dibatalkan")
    await log_activity(FAMILY_ID, c["child_id"], "correction_undone", {"title": c.get("title")})
    return {"success": True}


@api.post("/tasks/{task_id}/redo-done")
async def claim_redo(task_id: str, user: dict = Depends(get_current_user)):
    """The child says the corrected mission is now really done. A parent
    confirms it (it can't be ticked away a second time unseen)."""
    task = await db.tasks.find_one({"id": task_id, "parent_id": FAMILY_ID}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Misi tidak ditemukan")
    child_id = _task_owner(task, user)
    if not task.get("correction_redo") or task.get("status") not in ("pending", "rejected"):
        raise HTTPException(status_code=400, detail="Misi ini tidak sedang perlu dibetulkan")
    await db.tasks.update_one({"id": task_id}, {"$set": {"redo_claimed_at": now_iso()}})
    await db.corrections.update_one({"id": task.get("correction_id")}, {"$set": {"redo_status": "claimed"}})
    await log_activity(FAMILY_ID, child_id, "redo_claimed", {"title": task.get("title")})
    await send_push_to({"role": "parent"}, title="Misi sudah dibetulkan? 🔁",
                       body=f'Cek "{task.get("title")}" lalu konfirmasi di aplikasi.', url="/parent")
    return {"success": True}


class RedoReviewInput(BaseModel):
    ok: bool
    note: str = Field(default="", max_length=200)


@api.post("/corrections/{correction_id}/confirm-redo")
async def confirm_redo(correction_id: str, payload: RedoReviewInput, user: dict = Depends(require_parent)):
    """Redone for real: the mission closes (still without its points), and on a
    first correction the extra minus is given back — fixing it pays."""
    c = await db.corrections.find_one({"id": correction_id, "parent_id": FAMILY_ID}, {"_id": 0})
    if not c or c.get("undone"):
        raise HTTPException(status_code=404, detail="Koreksi tidak ditemukan")
    task = await db.tasks.find_one({"id": c["task_id"]}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Misi tidak ditemukan")
    if not payload.ok:
        await db.tasks.update_one({"id": task["id"]}, {"$set": {"redo_claimed_at": None}})
        await db.corrections.update_one({"id": correction_id}, {"$set": {"redo_status": "open"}})
        await send_push_to({"role": "child", "member_id": c["child_id"]}, title="Belum beres 🔁",
                           body=payload.note.strip() or f'"{task.get("title")}" belum benar-benar selesai.',
                           url=f"/kid/{c['child_id']}")
        return {"success": True, "closed": False}
    await db.tasks.update_one({"id": task["id"]}, {"$set": {
        "status": "approved", "approved_at": now_iso(), "checked": True, "checked_at": now_iso(),
        "correction_redo": False}})
    refund = c.get("level") == 1 and not c.get("minus_refunded")
    if refund:
        await _change_points(c["child_id"], int(c.get("minus") or 0))
    await db.corrections.update_one({"id": correction_id}, {"$set": {
        "redo_status": "done", "minus_refunded": bool(refund or c.get("minus_refunded"))}})
    await _bump_trust(c["child_id"], 5, "membetulkan misi")
    await log_activity(FAMILY_ID, c["child_id"], "redo_confirmed",
                       {"title": task.get("title"), "refund": int(c.get("minus") or 0) if refund else 0})
    await send_push_to({"role": "child", "member_id": c["child_id"]}, title="Sudah dibetulkan 👍",
                       body=("Poin minusmu dikembalikan. " if refund else "") + "Terima kasih sudah membetulkannya!",
                       url=f"/kid/{c['child_id']}")
    return {"success": True, "closed": True, "refunded": int(c.get("minus") or 0) if refund else 0}


@api.post("/tasks/{task_id}/admit")
async def admit_not_done(task_id: str, user: dict = Depends(get_current_user)):
    """'Ternyata belum': the child owns up. No minus, ever — the mission simply
    doesn't count (or is reopened while its section is still running). Owning
    up when a parent asked about it earns a small honesty bonus."""
    task = await db.tasks.find_one({"id": task_id, "parent_id": FAMILY_ID}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Misi tidak ditemukan")
    child_id = _task_owner(task, user)
    if task.get("correction_redo"):
        raise HTTPException(status_code=409, detail="Misi ini sudah dikoreksi")
    if not (task.get("checked") or task.get("status") in ("completed", "approved")):
        raise HTTPException(status_code=400, detail="Misi ini memang belum dicentang")
    oldest = (datetime.strptime(_today_key(), "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
    if (task.get("date_key") or "") < oldest:
        raise HTTPException(status_code=409, detail="Sudah terlalu lama — bicarakan langsung dengan Abi/Ummi ya")
    if task.get("status") == "approved":
        await _reverse_task_points(task, restore_streak=False)
    seg_id = task.get("segment_id") or ANYTIME_SEGMENT_ID
    sess = await _get_session(child_id, task.get("date_key"), seg_id)
    running = bool(sess and sess.get("started_at") and not sess.get("completed_at"))
    upd = {"checked": False, "checked_at": None, "honest_admit": True, "honest_admit_at": now_iso(),
           "completed_at": None, "approved_at": None, **(_TIMER_CLEAR if task.get("timed") else {})}
    upd["status"] = "pending" if running else "missed"
    if not running:
        upd["_undo_miss_penalty"] = 0
    await db.tasks.update_one({"id": task_id}, {"$set": upd})
    config = await get_config_cached()
    check = await db.spot_checks.find_one({"task_id": task_id, "status": "pending"}, {"_id": 0})
    bonus = 0
    if check:
        bonus = int(config.get("honesty_bonus_points", 2))
        await db.spot_checks.update_one({"id": check["id"]}, {"$set": {"status": "admitted", "answered_at": now_iso()}})
        await _change_points(child_id, bonus)
    await db.children.update_one({"id": child_id}, {"$inc": {"honest_admits": 1}})
    await _bump_trust(child_id, 3 if check else 2, "jujur mengaku")
    await log_activity(FAMILY_ID, child_id, "honest_admit", {"title": task.get("title"), "bonus": bonus})
    await send_push_to({"role": "parent"}, title="Anak jujur mengaku 🙏",
                       body=f'"{task.get("title")}" ternyata belum dikerjakan — dia mengaku sendiri.', url="/parent")
    badges = await award_badges(FAMILY_ID, child_id)
    return {"success": True, "reopened": running, "bonus": bonus, "new_badges": badges}


class ReflectionInput(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


@api.post("/reflections/{reflection_id}")
async def write_reflection(reflection_id: str, payload: ReflectionInput, user: dict = Depends(get_current_user)):
    r = await db.reflections.find_one({"id": reflection_id, "parent_id": FAMILY_ID}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Refleksi tidak ditemukan")
    if user["role"] == "child" and user["id"] != r["child_id"]:
        raise HTTPException(status_code=403, detail="Bukan milikmu")
    words = _summary_words(payload.text)
    if len(words) < REFLECTION_MIN_WORDS:
        raise HTTPException(status_code=422, detail=f"Tulis sedikit lebih panjang ya: {len(words)} dari {REFLECTION_MIN_WORDS} kata")
    await db.reflections.update_one({"id": reflection_id}, {"$set": {
        "text": payload.text.strip(), "status": "written", "written_at": now_iso(), "read": False}})
    await log_activity(FAMILY_ID, r["child_id"], "reflection_written", {"title": r.get("title")})
    await send_push_to({"role": "parent"}, title="Refleksi anak masuk 📝", body=f'Tentang "{r.get("title")}"',
                       url="/parent")
    return {"success": True}


@api.post("/reflections/{reflection_id}/read")
async def mark_reflection_read(reflection_id: str, user: dict = Depends(require_parent)):
    await db.reflections.update_one({"id": reflection_id, "parent_id": FAMILY_ID}, {"$set": {"read": True}})
    return {"success": True}


@api.get("/children/{child_id}/honesty")
async def child_honesty(child_id: str, user: dict = Depends(get_current_user)):
    """Everything about honesty for one child: trust score, watch period, what
    needs redoing, surprise checks waiting, reflections to write."""
    _assert_can_act(user, child_id)
    await _refresh_trust(child_id)
    await _expire_spot_checks()
    child = await get_child_or_404(FAMILY_ID, child_id)
    redo = await db.tasks.find({"parent_id": FAMILY_ID, "correction_redo": True,
                                "$or": [{"child_id": child_id}, {"coop_participants": child_id}]},
                               {"_id": 0, "id": 1, "title": 1, "date_key": 1, "redo_claimed_at": 1,
                                "correction_id": 1}).to_list(50)
    checks = await db.spot_checks.find({"child_id": child_id, "status": "pending"}, {"_id": 0}).to_list(20)
    refl = await db.reflections.find({"child_id": child_id, "status": "pending"}, {"_id": 0}).to_list(20)
    config = await get_config_cached()
    return {
        "trust_score": _trust(child),
        "probation_until": child.get("probation_until") if _in_probation(child) else None,
        "strikes": await _strike_count(child_id, config),
        "honest_admits": int(child.get("honest_admits") or 0),
        "spot_passes": int(child.get("spot_passes") or 0),
        "redo": redo, "spot_checks": checks, "reflections": refl,
    }


# -- Surprise checks ("cek kejutan") ------------------------------------------
def _spot_check_chance(child: dict, dk: str) -> float:
    if _in_probation(child, dk):
        return 1.0
    t = _trust(child)
    return 0.6 if t < 50 else 0.35 if t < 80 else 0.2 if t < 95 else 0.1


async def _maybe_spot_check(child: dict, dk: str, seg_label: str, acts: list, config: dict) -> Optional[dict]:
    """After a section is finished, sometimes pick one ticked mission and ask
    for a photo of it. Higher trust → rarer; under watch → every section."""
    import random as _random
    if not config.get("spot_checks_enabled", True) or dk != _today_key():
        return None
    probation = _in_probation(child, dk)
    if not probation and await db.spot_checks.count_documents(
            {"child_id": child["id"], "date_key": dk}) >= SPOT_CHECK_DAILY_CAP:
        return None
    pool = [a for a in acts if a.get("checked") and not a.get("is_bonus")
            and not a.get("completion_photo_url") and not a.get("summary_required")]
    if not pool or _random.random() >= _spot_check_chance(child, dk):
        return None
    pick = _random.choice(pool)
    doc = {"id": new_id(), "parent_id": FAMILY_ID, "child_id": child["id"], "task_id": pick["id"],
           "title": pick.get("title"), "segment": seg_label, "date_key": dk, "status": "pending",
           "created_at": now_iso(),
           "expires_at": (datetime.now(timezone.utc) + timedelta(hours=SPOT_CHECK_HOURS)).isoformat()}
    await db.spot_checks.insert_one(dict(doc))
    await send_push_to({"role": "child", "member_id": child["id"]}, title="Cek kejutan! 📸",
                       body=f'Kirim foto "{pick.get("title")}" ya.', url=f"/kid/{child['id']}")
    doc.pop("_id", None)
    return doc


async def _expire_spot_checks() -> int:
    res = await db.spot_checks.update_many(
        {"parent_id": FAMILY_ID, "status": "pending", "expires_at": {"$lt": datetime.now(timezone.utc).isoformat()}},
        {"$set": {"status": "expired"}})
    return res.modified_count


class SpotCheckAnswerInput(BaseModel):
    photo_url: str = Field(min_length=1)

    @field_validator("photo_url")
    @classmethod
    def _must_be_image(cls, v: str) -> str:
        if not v.startswith("data:image/"):
            raise ValueError("Harus berupa foto")
        if len(v) > 2_500_000:
            raise ValueError("Foto terlalu besar")
        return v


@api.post("/spot-checks/{check_id}/answer")
async def answer_spot_check(check_id: str, payload: SpotCheckAnswerInput, user: dict = Depends(get_current_user)):
    chk = await db.spot_checks.find_one({"id": check_id, "parent_id": FAMILY_ID}, {"_id": 0})
    if not chk:
        raise HTTPException(status_code=404, detail="Cek tidak ditemukan")
    if user["role"] == "child" and user["id"] != chk["child_id"]:
        raise HTTPException(status_code=403, detail="Bukan milikmu")
    if chk["status"] != "pending":
        raise HTTPException(status_code=409, detail="Cek ini sudah ditutup")
    stored = await _store_task_photo(chk["task_id"], "completion_photo_url", payload.photo_url)
    await db.tasks.update_one({"id": chk["task_id"]}, {"$set": {
        "completion_photo_url": stored, "completion_photo_url_at": now_iso()}})
    await db.spot_checks.update_one({"id": check_id}, {"$set": {"status": "answered", "answered_at": now_iso()}})
    await send_push_to({"role": "parent"}, title="Foto cek kejutan masuk 📸",
                       body=f'"{chk.get("title")}" — cek di aplikasi.', url="/parent")
    return {"success": True}


class SpotCheckReviewInput(BaseModel):
    ok: bool
    note: str = Field(default="", max_length=300)


@api.post("/spot-checks/{check_id}/review")
async def review_spot_check(check_id: str, payload: SpotCheckReviewInput, user: dict = Depends(require_parent)):
    """Photo looks right → passed: trust grows and a small surprise bonus.
    Not right → the mission is corrected like any other."""
    import random as _random
    chk = await db.spot_checks.find_one({"id": check_id, "parent_id": FAMILY_ID}, {"_id": 0})
    if not chk:
        raise HTTPException(status_code=404, detail="Cek tidak ditemukan")
    if chk["status"] not in ("answered", "expired"):
        raise HTTPException(status_code=409, detail="Cek ini belum dijawab atau sudah dinilai")
    if payload.ok:
        surprise = _random.randint(1, 5)
        await _change_points(chk["child_id"], surprise)
        await db.children.update_one({"id": chk["child_id"]}, {"$inc": {"spot_passes": 1}})
        await db.spot_checks.update_one({"id": check_id}, {"$set": {
            "status": "passed", "reviewed_at": now_iso(), "surprise": surprise}})
        await _bump_trust(chk["child_id"], 3, "lolos cek kejutan")
        await send_push_to({"role": "child", "member_id": chk["child_id"]}, title="Lolos cek kejutan! 🎁",
                           body=f"Kejutan +{surprise} poin karena kamu jujur.", url=f"/kid/{chk['child_id']}")
        await award_badges(FAMILY_ID, chk["child_id"])
        return {"success": True, "passed": True, "surprise": surprise}
    corr = await correct_task(chk["task_id"], CorrectionInput(note=payload.note), user)
    await db.spot_checks.update_one({"id": check_id}, {"$set": {
        "status": "failed", "reviewed_at": now_iso(), "correction_id": corr["id"]}})
    return {"success": True, "passed": False, "correction": corr}


@api.get("/spot-checks")
async def list_spot_checks(child_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    await _expire_spot_checks()
    q: dict = {"parent_id": FAMILY_ID}
    if user["role"] == "child":
        q["child_id"] = user["id"]
    elif child_id:
        q["child_id"] = child_id
    return await db.spot_checks.find(q, {"_id": 0}).sort("created_at", -1).to_list(100)


@api.get("/corrections")
async def list_corrections(child_id: Optional[str] = None, user: dict = Depends(require_parent)):
    q: dict = {"parent_id": FAMILY_ID}
    if child_id:
        q["child_id"] = child_id
    return await db.corrections.find(q, {"_id": 0}).sort("at", -1).to_list(200)


@api.get("/reflections")
async def list_reflections(child_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    q: dict = {"parent_id": FAMILY_ID}
    if user["role"] == "child":
        q["child_id"] = user["id"]
    elif child_id:
        q["child_id"] = child_id
    return await db.reflections.find(q, {"_id": 0}).sort("created_at", -1).to_list(100)


# ---- Parent inbox: everything waiting on a parent, in one place -------------
def _section_signals(rows: list, sess: dict) -> list:
    """Why a finished section might deserve a look: all ticks within seconds,
    or done in under a quarter of its estimated time."""
    def ts(v):
        try:
            d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except Exception:
            return None
    out = []
    ticks = sorted(t for t in (ts(r.get("checked_at")) for r in rows) if t)
    if len(ticks) >= 3 and (ticks[-1] - ticks[0]).total_seconds() <= 20:
        out.append("burst")
    st, en = ts(sess.get("started_at")), ts(sess.get("completed_at"))
    est = sum(int(r.get("duration_minutes") or 0) for r in rows) * 60
    if st and en and est and (en - st).total_seconds() < est * 0.25:
        out.append("rushed")
    return out


@api.get("/parent/inbox")
async def parent_inbox(user: dict = Depends(require_parent)):
    """One list of what needs a parent: decisions, things to check, and
    children's requests. Each item says what it is and what can be done."""
    await _expire_spot_checks()
    today = _today_key()
    since = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=2)).strftime("%Y-%m-%d")
    kids = {k["id"]: k for k in await db.children.find({"parent_id": FAMILY_ID},
                                                        {"_id": 0, "id": 1, "name": 1, "avatar_emoji": 1}).to_list(50)}
    items: list = []

    def add(kind, child_id, title, detail="", **extra):
        k = kids.get(child_id) or {}
        items.append({"kind": kind, "child_id": child_id, "child_name": k.get("name", ""),
                      "avatar_emoji": k.get("avatar_emoji"), "title": title, "detail": detail, **extra})

    for dk in sorted({today, since, (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")}):
        for r in await _overdue_sections(dk):
            add("overdue_section", r["child_id"], f"{r['emoji']} {r['label']} lewat jam",
                f"{len(r['left'])} dari {r['total']} belum" if r["started"] else "Belum dimulai",
                date_key=dk, segment_id=r["segment_id"], left=r["left"], end_time=r["end_time"])
    for chk in await db.spot_checks.find({"parent_id": FAMILY_ID, "status": {"$in": ["answered", "expired"]}},
                                         {"_id": 0}).to_list(50):
        task = await db.tasks.find_one({"id": chk["task_id"]}, {"_id": 0, "completion_photo_url": 1})
        add("spot_check", chk["child_id"], f"📸 Cek kejutan: {chk['title']}",
            "Foto sudah dikirim" if chk["status"] == "answered" else "Tidak dijawab sampai batas waktu",
            check_id=chk["id"], status=chk["status"], task_id=chk["task_id"],
            photo=_media_ref("task", chk["task_id"], "completion_photo_url", (task or {}).get("completion_photo_url")))
    for t in await db.tasks.find({"parent_id": FAMILY_ID, "correction_redo": True, "redo_claimed_at": {"$nin": [None, ""]}},
                                 {"_id": 0}).to_list(50):
        add("redo_claimed", t["child_id"], f"🔁 Sudah dibetulkan: {t['title']}", "Cek lalu konfirmasi",
            correction_id=t.get("correction_id"), task_id=t["id"])
    for r in await db.reflections.find({"parent_id": FAMILY_ID, "status": "written", "read": {"$ne": True}},
                                       {"_id": 0}).to_list(50):
        add("reflection", r["child_id"], f"📝 Refleksi: {r.get('title')}", r.get("text") or "", reflection_id=r["id"])
    for t in await db.tasks.find({"parent_id": FAMILY_ID, "date_key": {"$gte": since},
                                  "summary_text": {"$nin": [None, ""]}, "summary_review": None},
                                 {"_id": 0}).to_list(50):
        add("summary", t["child_id"], f"📝 Ringkasan: {t['title']}", t.get("summary_text") or "",
            task_id=t["id"], pasted=bool(t.get("summary_pasted")), words=t.get("summary_words"))
    acked = {(x["child_id"], x["date_key"], x["segment_id"]) for x in await db.section_reviews.find(
        {"parent_id": FAMILY_ID, "date_key": {"$gte": since}}, {"_id": 0}).to_list(500)}
    sessions = await db.segment_sessions.find({"parent_id": FAMILY_ID, "date_key": {"$gte": since},
                                               "completed_at": {"$nin": [None, ""]}}, {"_id": 0}).to_list(500)
    if sessions:
        rows = await db.tasks.find({"parent_id": FAMILY_ID, "date_key": {"$gte": since}, "is_bonus": {"$ne": True}},
                                   {"_id": 0, "id": 1, "child_id": 1, "date_key": 1, "segment_id": 1, "title": 1,
                                    "checked_at": 1, "duration_minutes": 1, "status": 1}).to_list(5000)
        by: dict = {}
        for r in rows:
            by.setdefault((r["child_id"], r["date_key"], r.get("segment_id") or ANYTIME_SEGMENT_ID), []).append(r)
        segs = {sg["id"]: sg for sg in await _get_day_segments()}
        for se in sessions:
            key = (se["child_id"], se["date_key"], se["segment_id"])
            if key in acked:
                continue
            sig = _section_signals(by.get(key, []), se)
            if sig:
                sg = segs.get(se["segment_id"]) or {"label": "Kapan Saja", "emoji": "✨"}
                why = " · ".join({"burst": "semua dicentang dalam beberapa detik",
                                  "rushed": "selesai jauh lebih cepat dari perkiraan"}[x] for x in sig)
                add("suspicious", se["child_id"], f"👀 {sg.get('emoji', '')} {sg['label']} perlu dicek", why,
                    date_key=se["date_key"], segment_id=se["segment_id"],
                    tasks=[{"id": r["id"], "title": r["title"]} for r in by.get(key, [])])
    waiting = await db.tasks.find({"parent_id": FAMILY_ID, "status": "completed"},
                                  {"_id": 0, "id": 1, "child_id": 1, "title": 1, "points": 1,
                                   "completion_photo_url": 1}).to_list(100)
    for t in waiting:
        add("approval", t["child_id"], f"⭐ Menunggu persetujuan: {t['title']}", f"+{t.get('points', 0)} poin",
            task_id=t["id"], photo=_media_ref("task", t["id"], "completion_photo_url", t.get("completion_photo_url")))
    requests = {
        "money": await db.money_redemptions.count_documents({"parent_id": FAMILY_ID, "status": "pending"}),
        "rewards": await db.redemptions.count_documents({"parent_id": FAMILY_ID, "status": "pending"}),
        "charity": await db.charity_requests.count_documents({"parent_id": FAMILY_ID, "status": "pending"}),
        "pet_reset": await db.pet_reset_requests.count_documents({"parent_id": FAMILY_ID, "status": "pending"}),
        "reward_ideas": await db.reward_suggestions.count_documents({"parent_id": FAMILY_ID, "status": "pending"}),
    }
    order = {"overdue_section": 0, "spot_check": 1, "redo_claimed": 2, "suspicious": 3,
             "approval": 4, "summary": 5, "reflection": 6}
    items.sort(key=lambda x: order.get(x["kind"], 9))
    return {"items": items, "requests": requests, "total": len(items) + sum(requests.values())}


class SectionAckInput(BaseModel):
    child_id: str
    date_key: str
    segment_id: str


@api.post("/family/sections/ack")
async def acknowledge_section(payload: SectionAckInput, user: dict = Depends(require_parent)):
    """'Sudah kucek': a flagged section was looked at and is fine."""
    dk = validate_date_key(payload.date_key)
    if not dk:
        raise HTTPException(status_code=422, detail="Tanggal tidak valid")
    await db.section_reviews.update_one(
        {"parent_id": FAMILY_ID, "child_id": payload.child_id, "date_key": dk, "segment_id": payload.segment_id},
        {"$set": {"action": "ok", "reviewed_at": now_iso(), "reviewed_by": user.get("name", "")}}, upsert=True)
    return {"success": True}


# ---- Weekly honesty recap ----------------------------------------------------
@api.get("/family/honesty-weekly")
async def honesty_weekly(user: dict = Depends(require_parent)):
    """A gentle week in review per child: trust now vs a week ago, owning up,
    surprise checks, corrections and on-time sections."""
    today = _today_key()
    since = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=7)).strftime("%Y-%m-%d")
    out = []
    for k in await db.children.find({"parent_id": FAMILY_ID}, {"_id": 0}).to_list(50):
        last_week = await db.trust_log.find({"child_id": k["id"], "date_key": {"$lte": since}},
                                            {"_id": 0, "score": 1}).sort("at", -1).to_list(1)
        sess = await db.segment_sessions.find({"child_id": k["id"], "date_key": {"$gt": since},
                                               "completed_at": {"$nin": [None, ""]}}, {"_id": 0}).to_list(500)
        checks = await db.spot_checks.find({"child_id": k["id"], "date_key": {"$gt": since}}, {"_id": 0}).to_list(200)
        admits = await db.activity.count_documents({"child_id": k["id"], "action": "honest_admit",
                                                    "created_at": {"$gt": since}})
        corrections = await db.corrections.count_documents({"child_id": k["id"], "undone": {"$ne": True},
                                                            "date_key": {"$gt": since}})
        on_time = sum(1 for x in sess if not x.get("start_late") and not x.get("finish_late"))
        trust_now = _trust(k)
        trust_then = last_week[0]["score"] if last_week else trust_now
        if corrections == 0 and admits == 0 and trust_now >= trust_then:
            note = "Minggu yang tenang — kepercayaan terjaga. Pujian kecil akan berarti."
        elif admits and not corrections:
            note = "Dia memilih jujur saat belum selesai. Itu layak dihargai."
        elif corrections >= 2:
            note = "Beberapa kali perlu dikoreksi. Ajak ngobrol santai: apa yang membuatnya buru-buru?"
        else:
            note = "Ada naik-turun. Fokus pada usaha yang jujur, bukan hanya hasil."
        out.append({
            "child_id": k["id"], "child_name": k["name"], "avatar_emoji": k.get("avatar_emoji"),
            "trust_now": trust_now, "trust_week_ago": trust_then,
            "sections_finished": len(sess), "sections_on_time": on_time,
            "spot_checks": len(checks), "spot_passed": sum(1 for x in checks if x["status"] == "passed"),
            "admits": admits, "corrections": corrections, "note": note,
        })
    return {"since": since, "until": today, "children": out}


# ---- Routine presets ("Hari sekolah", "Libur sekolah", "Ujian") -----------
class RoutinePresetInput(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    emoji: str = Field(default="", max_length=8)


_PRESET_SLOT_KEYS = ("weekday", "segment_id", "child_id", "title", "duration_minutes", "points", "is_bonus",
                     "order", *_PROOF_FIELDS)


async def _routine_snapshot() -> list:
    tpl = await _routine_template()
    rows = await db.template_tasks.find({"parent_id": FAMILY_ID, "template_id": tpl["id"]}, {"_id": 0}).to_list(5000)
    return [{k: r.get(k) for k in _PRESET_SLOT_KEYS} for r in rows]


@api.get("/routine/presets")
async def list_routine_presets(user: dict = Depends(require_parent)):
    rows = await db.routine_presets.find({"parent_id": FAMILY_ID}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return [{**{k: v for k, v in r.items() if k != "slots"}, "slot_count": len(r.get("slots") or [])} for r in rows]


@api.post("/routine/presets")
async def save_routine_preset(payload: RoutinePresetInput, user: dict = Depends(require_parent)):
    """Save the whole weekly routine as it is now under a name, to switch back
    to it later with one tap."""
    slots = await _routine_snapshot()
    if not slots:
        raise HTTPException(status_code=400, detail="Rutinitas masih kosong — isi dulu sebelum disimpan")
    doc = {"id": new_id(), "parent_id": FAMILY_ID, "name": payload.name.strip(), "emoji": payload.emoji.strip(),
           "slots": slots, "created_at": now_iso(), "auto": False}
    await db.routine_presets.insert_one(dict(doc))
    return {k: v for k, v in doc.items() if k != "slots"} | {"slot_count": len(slots)}


@api.post("/routine/presets/{preset_id}/apply")
async def apply_routine_preset(preset_id: str, user: dict = Depends(require_parent)):
    """Switch the weekly routine to a saved one. What was there is kept as an
    automatic backup preset first, so switching is never a loss."""
    preset = await db.routine_presets.find_one({"id": preset_id, "parent_id": FAMILY_ID}, {"_id": 0})
    if not preset:
        raise HTTPException(status_code=404, detail="Jadwal tersimpan tidak ditemukan")
    current = await _routine_snapshot()
    if current:
        await db.routine_presets.insert_one({
            "id": new_id(), "parent_id": FAMILY_ID, "name": f"Cadangan {_today_key()}", "emoji": "💾",
            "slots": current, "created_at": now_iso(), "auto": True})
        autos = await db.routine_presets.find({"parent_id": FAMILY_ID, "auto": True}, {"_id": 0, "id": 1}).sort(
            "created_at", -1).to_list(100)
        if len(autos) > 5:
            await db.routine_presets.delete_many({"id": {"$in": [a["id"] for a in autos[5:]]}})
    tpl = await _routine_template()
    await db.template_tasks.delete_many({"parent_id": FAMILY_ID, "template_id": tpl["id"]})
    kids = {k["id"] for k in await db.children.find({"parent_id": FAMILY_ID}, {"_id": 0, "id": 1}).to_list(50)}
    docs = [{**sl, "id": new_id(), "parent_id": FAMILY_ID, "template_id": tpl["id"], "created_at": now_iso()}
            for sl in preset.get("slots") or [] if not sl.get("child_id") or sl["child_id"] in kids]
    if docs:
        await db.template_tasks.insert_many(docs)
    await _invalidate_days(_today_key(), include_today=False)
    await log_activity(FAMILY_ID, None, "routine_preset_applied", {"name": preset.get("name"), "slots": len(docs)})
    return {"success": True, "slots": len(docs)}


@api.delete("/routine/presets/{preset_id}")
async def delete_routine_preset(preset_id: str, user: dict = Depends(require_parent)):
    await db.routine_presets.delete_one({"id": preset_id, "parent_id": FAMILY_ID})
    return {"success": True}


# ---- Relaxed days ("hari santai") -------------------------------------------
class RelaxedDayInput(BaseModel):
    start_date: str
    end_date: Optional[str] = None
    note: str = Field(default="", max_length=100)


@api.get("/relaxed-days")
async def list_relaxed_days(user: dict = Depends(get_current_user)):
    return await db.relaxed_days.find({"parent_id": FAMILY_ID}, {"_id": 0}).sort("start_date", -1).to_list(50)


@api.post("/relaxed-days")
async def add_relaxed_days(payload: RelaxedDayInput, user: dict = Depends(require_parent)):
    """School holidays and the like: the routine still runs, but personal
    start/finish times are set aside and nobody is late."""
    days = _date_span(payload.start_date, payload.end_date)
    doc = {"id": new_id(), "parent_id": FAMILY_ID, "start_date": days[0], "end_date": days[-1],
           "note": payload.note.strip(), "created_at": now_iso()}
    await db.relaxed_days.insert_one(dict(doc))
    _RELAXED_CACHE["at"] = -1e9
    return doc


@api.delete("/relaxed-days/{relaxed_id}")
async def delete_relaxed_days(relaxed_id: str, user: dict = Depends(require_parent)):
    await db.relaxed_days.delete_one({"id": relaxed_id, "parent_id": FAMILY_ID})
    _RELAXED_CACHE["at"] = -1e9
    return {"success": True}


# ---- Per-section streaks -----------------------------------------------------
async def _bump_section_streak(child: dict, seg_id: str, dk: str, on_time: bool) -> int:
    """Consecutive days a section was finished on time ('Pagi tepat waktu 5
    hari'). A late finish resets it; a skipped day starts it over."""
    streaks = dict(child.get("section_streaks") or {})
    cur = streaks.get(seg_id) or {}
    if not on_time:
        count = 0
    else:
        last = cur.get("last_date")
        prev_day = (datetime.strptime(dk, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
        if last == dk:
            count = int(cur.get("count") or 0)
        elif last == prev_day or (last and await _days_all_off_between(last, dk)):
            count = int(cur.get("count") or 0) + 1
        else:
            count = 1
    streaks[seg_id] = {"count": count, "last_date": dk}
    best = max(int(child.get("best_section_streak") or 0), count)
    await db.children.update_one({"id": child["id"]}, {"$set": {"section_streaks": streaks,
                                                                 "best_section_streak": best}})
    if count and count % 7 == 0:
        await award_badges(FAMILY_ID, child["id"])
    return count


async def _days_all_off_between(last: str, dk: str) -> bool:
    d = datetime.strptime(last, "%Y-%m-%d") + timedelta(days=1)
    end = datetime.strptime(dk, "%Y-%m-%d")
    while d < end:
        if not await _is_off_day(d.strftime("%Y-%m-%d")):
            return False
        d += timedelta(days=1)
    return True


# ---- The child picks one bonus mission a day --------------------------------
class BonusOptionInput(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    points: int = Field(default=5, ge=0, le=1000)
    emoji: str = Field(default="", max_length=8)


@api.get("/bonus-options")
async def list_bonus_options(child_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    rows = await db.bonus_options.find({"parent_id": FAMILY_ID}, {"_id": 0}).sort("created_at", 1).to_list(50)
    cid = user["id"] if user["role"] == "child" else child_id
    picked = None
    if cid:
        picked = await db.tasks.find_one({"parent_id": FAMILY_ID, "child_id": cid, "date_key": _today_key(),
                                          "from_bonus_option": {"$exists": True}}, {"_id": 0, "id": 1, "title": 1})
    return {"options": rows, "picked_today": picked}


@api.post("/bonus-options")
async def add_bonus_option(payload: BonusOptionInput, user: dict = Depends(require_parent)):
    doc = {"id": new_id(), "parent_id": FAMILY_ID, "title": payload.title.strip(), "points": payload.points,
           "emoji": payload.emoji.strip(), "created_at": now_iso()}
    await db.bonus_options.insert_one(dict(doc))
    return doc


@api.delete("/bonus-options/{option_id}")
async def delete_bonus_option(option_id: str, user: dict = Depends(require_parent)):
    await db.bonus_options.delete_one({"id": option_id, "parent_id": FAMILY_ID})
    return {"success": True}


class BonusPickInput(BaseModel):
    option_id: str


@api.post("/kid/{child_id}/pick-bonus")
async def pick_bonus(child_id: str, payload: BonusPickInput, user: dict = Depends(get_current_user)):
    """One bonus mission a day, chosen by the child from the parent's list —
    it lands in 'Kapan Saja' for today."""
    _assert_can_act(user, child_id)
    opt = await db.bonus_options.find_one({"id": payload.option_id, "parent_id": FAMILY_ID}, {"_id": 0})
    if not opt:
        raise HTTPException(status_code=404, detail="Pilihan bonus tidak ditemukan")
    today = _today_key()
    if await db.tasks.find_one({"parent_id": FAMILY_ID, "child_id": child_id, "date_key": today,
                                "from_bonus_option": {"$exists": True}}):
        raise HTTPException(status_code=409, detail="Hari ini kamu sudah memilih bonus")
    doc = {"id": new_id(), "parent_id": FAMILY_ID, "child_id": child_id, "title": opt["title"],
           "description": "", "points": opt["points"], "penalty_points": 0, "is_bonus": True,
           "segment_id": None, "date_key": today, "recurrence": "none", "status": "pending", "order": 999,
           "created_at": now_iso(), "from_bonus_option": opt["id"]}
    await db.tasks.insert_one(dict(doc))
    await log_activity(FAMILY_ID, child_id, "bonus_picked", {"title": opt["title"]})
    return doc


# ---- "Hari terbaik minggu ini" ------------------------------------------------
@api.get("/children/{child_id}/best-day")
async def best_day_of_week(child_id: str, user: dict = Depends(get_current_user)):
    """The child's best day of the last seven: most of the list done, on time,
    with whatever photos and summaries came with it — a little story to share."""
    if user["role"] == "child" and user["id"] != child_id:
        raise HTTPException(status_code=403, detail="Bukan milikmu")
    await get_child_or_404(FAMILY_ID, child_id)
    today = _today_key()
    since = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=7)).strftime("%Y-%m-%d")
    rows = await db.tasks.find({"parent_id": FAMILY_ID, "child_id": child_id, "date_key": {"$gt": since, "$lte": today},
                                "status": {"$ne": "off"}}, {"_id": 0}).to_list(2000)
    sess = await db.segment_sessions.find({"child_id": child_id, "date_key": {"$gt": since}}, {"_id": 0}).to_list(500)
    days: dict = {}
    for t in rows:
        d = days.setdefault(t["date_key"], {"required": 0, "done": 0, "points": 0, "photos": [], "summaries": []})
        if not t.get("is_bonus"):
            d["required"] += 1
        if t.get("status") in ("approved", "completed"):
            d["done"] += 0 if t.get("is_bonus") else 1
            d["points"] += int(t.get("points") or 0) if t.get("status") == "approved" and not t.get("late_no_points") else 0
            if t.get("completion_photo_url"):
                d["photos"].append(_media_ref("task", t["id"], "completion_photo_url", t["completion_photo_url"]))
            if t.get("summary_text"):
                d["summaries"].append({"title": t["title"], "text": t["summary_text"][:200]})
    for se in sess:
        d = days.get(se["date_key"])
        if d is not None and se.get("completed_at"):
            d["on_time"] = d.get("on_time", 0) + (0 if se.get("start_late") or se.get("finish_late") else 1)
    if not days:
        return {"best": None}
    def score(item):
        dk, d = item
        ratio = d["done"] / d["required"] if d["required"] else 0
        return (ratio, d.get("on_time", 0), d["points"], len(d["photos"]))
    dk, d = max(days.items(), key=score)
    if not d["done"]:
        return {"best": None}
    return {"best": {"date_key": dk, "done": d["done"], "required": d["required"], "points": d["points"],
                     "on_time_sections": d.get("on_time", 0), "photos": d["photos"][:6], "summaries": d["summaries"][:3]}}


# ---- Media: images out of the JSON payloads ---------------------------------
# Uploaded pictures are stored as data URLs inside their documents. Sending them
# inline meant every list of children, rewards or tasks dragged hundreds of KB
# of base64 along — on every load. Authenticated lists now carry a short URL
# instead; the image itself is served once and then cached by the browser
# (the ?v= tag changes whenever the picture does).
import hashlib as _hashlib  # noqa: E402
import base64 as _base64  # noqa: E402
from fastapi.responses import Response as _RawResponse  # noqa: E402

MEDIA_PREFIX = "/api/media/"
_MEDIA_SOURCES = {
    "child": ("children", {"profile_photo_url"}),
    "reward": ("rewards", {"image"}),
    "task": ("tasks", {"completion_photo_url", "before_photo_url"}),
}


# Task photos pile up (one per finished mission), so they live in their own
# `media` collection and the task keeps only a short pointer "media:<tag>".
# Lists and schedule scans then never drag picture bytes out of the database.
MEDIA_POINTER = "media:"


def _media_tag(value: str) -> str:
    return _hashlib.sha1((str(len(value)) + value[:64] + value[-64:]).encode()).hexdigest()[:12]


def _media_ref(kind: str, doc_id: str, field: str, value):
    if not isinstance(value, str) or not doc_id:
        return value
    if value.startswith(MEDIA_POINTER):
        tag = value[len(MEDIA_POINTER):]
    elif value.startswith("data:"):
        tag = _media_tag(value)
    else:
        return value
    return f"{MEDIA_PREFIX}{kind}/{doc_id}/{field}?v={tag}&s={_media_sig(kind, doc_id, field, tag)}"


async def _store_task_photo(task_id: str, field: str, value):
    """Keep a task picture in `media` and return the pointer to store on the
    task. Anything that isn't an inline picture is returned unchanged."""
    if not isinstance(value, str) or not value.startswith("data:"):
        return value
    tag = _media_tag(value)
    await db.media.update_one(
        {"_id": f"task:{task_id}:{field}"},
        {"$set": {"parent_id": FAMILY_ID, "kind": "task", "doc_id": task_id, "field": field,
                  "tag": tag, "data": value, "size": len(value), "updated_at": now_iso()}},
        upsert=True,
    )
    return MEDIA_POINTER + tag


async def _maybe_offload_task_photos(limit: int = 100) -> int:
    """Background tick: keep moving old inline pictures out until none are
    left, then remember that and stop scanning."""
    if await db.app_meta.find_one({"_id": "photos_offloaded"}):
        return 0
    moved = await _offload_task_photos(limit)
    if moved < limit:
        await db.app_meta.update_one({"_id": "photos_offloaded"}, {"$set": {"at": now_iso()}}, upsert=True)
    return moved


async def _offload_task_photos(limit: int = 100) -> int:
    """Move pictures still stored inline on tasks (from before the `media`
    collection existed) out to it, a bounded batch at a time."""
    moved = 0
    for coll in ("tasks", "tasks_archive"):
        for field in _MEDIA_SOURCES["task"][1]:
            if moved >= limit:
                return moved
            rows = await db[coll].find(
                {field: {"$regex": "^data:"}}, {"_id": 0, "id": 1, field: 1},
            ).to_list(limit - moved)
            for r in rows:
                if not r.get("id"):
                    continue
                pointer = await _store_task_photo(r["id"], field, r[field])
                await db[coll].update_one({"id": r["id"], field: r[field]}, {"$set": {field: pointer}})
                moved += 1
    return moved


def _media_sig(kind: str, doc_id: str, field: str, tag: str) -> str:
    """A capability for ONE version of ONE picture. <img> tags can't send the
    Authorization header (and some private-mode browsers drop cookies), so the
    URL itself carries proof that an authenticated response handed it out."""
    import hmac as _hmac
    msg = f"{kind}:{doc_id}:{field}:{tag}".encode()
    return _hmac.new(get_jwt_secret().encode(), msg, _hashlib.sha256).hexdigest()[:24]


def _with_media_refs(kind: str, docs):
    fields = _MEDIA_SOURCES[kind][1]
    single = isinstance(docs, dict)
    for d in ([docs] if single else docs or []):
        if not isinstance(d, dict):
            continue
        for f in fields:
            if f in d:
                d[f] = _media_ref(kind, d.get("id"), f, d[f])
    return docs


@api.get("/media/{kind}/{doc_id}/{field}")
async def get_media(kind: str, doc_id: str, field: str, v: str = "", s: str = ""):
    import hmac as _hmac
    src = _MEDIA_SOURCES.get(kind)
    if not src or field not in src[1]:
        raise HTTPException(status_code=404, detail="Not found")
    if not v or not s or not _hmac.compare_digest(s, _media_sig(kind, doc_id, field, v)):
        raise HTTPException(status_code=403, detail="Forbidden")
    coll, _ = src
    doc = await db[coll].find_one({"id": doc_id, "parent_id": FAMILY_ID}, {"_id": 0, field: 1})
    if not doc and coll == "tasks":  # restored-from-archive views can still point here
        doc = await db.tasks_archive.find_one({"id": doc_id, "parent_id": FAMILY_ID}, {"_id": 0, field: 1})
    value = (doc or {}).get(field)
    if isinstance(value, str) and value.startswith(MEDIA_POINTER):
        stored = await db.media.find_one({"_id": f"{kind}:{doc_id}:{field}"}, {"data": 1, "tag": 1})
        if not stored or stored.get("tag") != value[len(MEDIA_POINTER):]:
            raise HTTPException(status_code=404, detail="Not found")
        value = stored.get("data")
    if not isinstance(value, str) or not value.startswith("data:") or "," not in value:
        raise HTTPException(status_code=404, detail="Not found")
    if _media_ref(kind, doc_id, field, value).split("?v=", 1)[1].split("&", 1)[0] != v:
        raise HTTPException(status_code=404, detail="Gambar sudah diganti")
    header, b64 = value.split(",", 1)
    mime = header[5:].split(";")[0] or "application/octet-stream"
    if not (mime.startswith("image/") or mime.startswith("audio/")):
        raise HTTPException(status_code=404, detail="Not found")
    try:
        raw = _base64.b64decode(b64) if ";base64" in header else b64.encode()
    except Exception:
        raise HTTPException(status_code=404, detail="Not found")
    return _RawResponse(content=raw, media_type=mime, headers={
        "Cache-Control": "private, max-age=31536000, immutable",
    })

# ---- Family Mission: one shared weekly goal --------------------------------
# Every child's approved points this week count toward ONE family target, with
# a shared reward. Cooperation instead of competition, and it resets itself
# every week — nothing for a parent to recreate.
class FamilyMissionInput(BaseModel):
    enabled: bool = True
    title: str = Field(default="Misi Keluarga", min_length=1, max_length=60)
    target_points: int = Field(default=300, ge=10, le=100000)
    reward: str = Field(default="", max_length=120)
    emoji: str = Field(default="🏰", max_length=8)


def _week_bounds(today: str) -> tuple:
    d = datetime.strptime(today, "%Y-%m-%d")
    start = d - timedelta(days=d.weekday())
    return start.strftime("%Y-%m-%d"), (start + timedelta(days=6)).strftime("%Y-%m-%d")


@api.get("/family-mission")
async def get_family_mission(user: dict = Depends(get_current_user)):
    config = await get_config_cached()
    fm = config.get("family_mission") or {}
    today = _today_key()
    start, end = _week_bounds(today)
    base = {
        "enabled": bool(fm.get("enabled")), "title": fm.get("title") or "Misi Keluarga",
        "target_points": int(fm.get("target_points") or 300), "reward": fm.get("reward") or "",
        "emoji": fm.get("emoji") or "🏰", "week_start": start, "week_end": end,
    }
    if not base["enabled"]:
        return {**base, "earned_points": 0, "percent": 0, "goal_met": False, "contributions": []}
    kids = await db.children.find({"parent_id": FAMILY_ID}, {"_id": 0, "id": 1, "name": 1,
                                                             "avatar_emoji": 1, "avatar_color": 1}).to_list(50)
    rows = await db.tasks.find(
        {"parent_id": FAMILY_ID, "status": "approved", "date_key": {"$gte": start, "$lte": end}},
        {"_id": 0, "child_id": 1, "is_coop": 1, "coop_participants": 1, "points": 1},
    ).to_list(None)
    per_kid = {k["id"]: 0 for k in kids}
    for t in rows:
        for kid_id in per_kid:
            per_kid[kid_id] += _child_share_of_task(t, kid_id) if (
                t.get("is_coop") or t.get("child_id") == kid_id) else 0
    earned = sum(per_kid.values())
    target = base["target_points"]
    days_left = (datetime.strptime(end, "%Y-%m-%d") - datetime.strptime(today, "%Y-%m-%d")).days + 1
    return {
        **base,
        "earned_points": earned,
        "percent": min(100, int(earned * 100 / target)) if target else 100,
        "goal_met": earned >= target,
        "days_left": days_left,
        "per_day_needed": max(0, -(-(target - earned) // days_left)) if days_left > 0 else 0,
        "contributions": [{**k, "points": per_kid[k["id"]]} for k in kids],
    }


@api.put("/family-mission")
async def set_family_mission(payload: FamilyMissionInput, user: dict = Depends(require_parent)):
    await _write_config({"$set": {"family_mission": payload.model_dump()}})
    return await get_family_mission(user)


# ---- Before/after photos ----------------------------------------------------
class TaskPhotoInput(BaseModel):
    kind: Literal["before", "after"]
    photo_url: str = Field(min_length=1)

    @field_validator("photo_url")
    @classmethod
    def _check_photo(cls, v):
        if not v.startswith("data:image/"):
            raise ValueError("Foto harus berupa gambar")
        if len(v) > 2_000_000:
            raise ValueError("Foto terlalu besar (maks ~1.4MB)")
        return v


@api.post("/tasks/{task_id}/photo")
async def attach_task_photo(task_id: str, payload: TaskPhotoInput, user: dict = Depends(get_current_user)):
    """A child attaches a 'before' or 'after' picture to a mission (e.g. a room
    before and after tidying). Parents see them side by side when reviewing."""
    task = await db.tasks.find_one({"id": task_id, "parent_id": FAMILY_ID}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Misi tidak ditemukan")
    owners = task.get("coop_participants") or [task.get("child_id")]
    if user["role"] == "child" and user["id"] not in owners:
        raise HTTPException(status_code=403, detail="Bukan milikmu")
    if task.get("status") in ("approved", "skipped", "off"):
        raise HTTPException(status_code=409, detail="Misi ini sudah ditutup")
    field = "before_photo_url" if payload.kind == "before" else "completion_photo_url"
    stored = await _store_task_photo(task_id, field, payload.photo_url)
    await db.tasks.update_one({"id": task_id}, {"$set": {field: stored, f"{field}_at": now_iso()}})
    updated = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    return _with_media_refs("task", updated)


# ---- Adaptive schedule suggestions -------------------------------------------
@api.get("/schedule/suggestions")
async def schedule_suggestions(days: int = 28, user: dict = Depends(require_parent)):
    """Looks at the last few weeks per child and mission and suggests small
    adjustments: a mission that keeps being missed may be too hard, too long or
    in the wrong part of the day; one that is always done might deserve a step
    up. Suggestions only — nothing changes until a parent applies one."""
    days = max(7, min(days, 90))
    today = _today_key()
    since = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=days)).strftime("%Y-%m-%d")
    rows = await db.tasks.find(
        {"parent_id": FAMILY_ID, "date_key": {"$gte": since, "$lt": today},
         "status": {"$in": ["approved", "completed", "missed", "pending", "rejected", "skipped"]},
         "is_bonus": {"$ne": True}},
        {"_id": 0, "child_id": 1, "title": 1, "status": 1, "points": 1, "segment_id": 1,
         "from_template_slot_id": 1, "checked": 1, "date_key": 1},
    ).to_list(None)
    kids = {k["id"]: k for k in await db.children.find(
        {"parent_id": FAMILY_ID}, {"_id": 0, "id": 1, "name": 1, "avatar_emoji": 1}).to_list(50)}
    stats: dict = {}
    for t in rows:
        key = (t.get("child_id"), t.get("title"))
        st = stats.setdefault(key, {"done": 0, "total": 0, "points": t.get("points", 0),
                                    "slot_id": t.get("from_template_slot_id"), "segment_id": t.get("segment_id")})
        st["total"] += 1
        if t.get("status") in ("approved", "completed") or t.get("checked"):
            st["done"] += 1
        if t.get("from_template_slot_id"):
            st["slot_id"] = t["from_template_slot_id"]
    out = []
    for (child_id, title), st in stats.items():
        if child_id not in kids or st["total"] < 6:
            continue
        rate = st["done"] / st["total"]
        base = {"child_id": child_id, "child_name": kids[child_id]["name"],
                "avatar_emoji": kids[child_id].get("avatar_emoji"), "title": title,
                "done": st["done"], "total": st["total"], "rate": round(rate * 100),
                "points": st["points"], "slot_id": st["slot_id"]}
        if rate < 0.5:
            new_pts = max(1, round(st["points"] * 1.25))
            out.append({**base, "kind": "struggling", "severity": 2 if rate < 0.3 else 1,
                        "message": f"{title} baru selesai {st['done']} dari {st['total']} kali. "
                                   "Mungkin terlalu berat, terlalu lama, atau jamnya kurang pas — coba bicarakan, "
                                   "pindahkan ke bagian hari lain, atau naikkan sedikit poinnya sebagai penyemangat.",
                        "action": {"type": "set_points", "points": new_pts} if st["slot_id"] else None})
        elif rate >= 0.95 and st["total"] >= 10:
            out.append({**base, "kind": "mastered", "severity": 0,
                        "message": f"{title} hampir selalu beres ({st['done']}/{st['total']}). "
                                   "Sudah jadi kebiasaan! Bisa diganti tantangan baru, atau jadikan misi bonus.",
                        "action": {"type": "make_bonus"} if st["slot_id"] else None})
    out.sort(key=lambda x: (-x["severity"], x["rate"]))
    return {"since": since, "until": today, "suggestions": out[:20]}


class SuggestionApplyInput(BaseModel):
    slot_id: str
    type: Literal["set_points", "make_bonus"]
    points: Optional[int] = Field(default=None, ge=1, le=10000)


@api.post("/schedule/suggestions/apply")
async def apply_schedule_suggestion(payload: SuggestionApplyInput, user: dict = Depends(require_parent)):
    """Applies a suggestion to the routine (template slot) going forward."""
    slot = await db.template_tasks.find_one({"id": payload.slot_id, "parent_id": FAMILY_ID}, {"_id": 0})
    if not slot:
        raise HTTPException(status_code=404, detail="Slot rutinitas tidak ditemukan")
    update = {"points": payload.points} if payload.type == "set_points" else {"is_bonus": True}
    if payload.type == "set_points" and not payload.points:
        raise HTTPException(status_code=422, detail="Poin baru wajib diisi")
    await db.template_tasks.update_one({"id": payload.slot_id}, {"$set": update})
    _invalidate_days_ready()
    await log_activity(FAMILY_ID, slot.get("child_id"), "suggestion_applied",
                       {"title": slot.get("title"), **update})
    return await db.template_tasks.find_one({"id": payload.slot_id}, {"_id": 0})


# ---- Memories: this month's photos, as a collage ------------------------------
async def _memories(month: str, child_ids: Optional[List[str]] = None) -> dict:
    if not re.match(r"^\d{4}-\d{2}$", month or ""):
        raise HTTPException(status_code=422, detail="Bulan tidak valid (YYYY-MM)")
    q = {"parent_id": FAMILY_ID, "date_key": {"$gte": f"{month}-01", "$lte": f"{month}-31"},
         "status": {"$in": ["approved", "completed"]},
         "$or": [{"completion_photo_url": {"$nin": [None, ""]}}, {"before_photo_url": {"$nin": [None, ""]}}]}
    if child_ids:
        q["child_id"] = {"$in": child_ids}
    rows = await db.tasks.find(q, {"_id": 0, "id": 1, "title": 1, "date_key": 1, "child_id": 1,
                                   "completion_photo_url": 1, "before_photo_url": 1}).sort("date_key", 1).to_list(200)
    kids = {k["id"]: k for k in await db.children.find(
        {"parent_id": FAMILY_ID}, {"_id": 0, "id": 1, "name": 1, "avatar_emoji": 1, "avatar_color": 1}).to_list(50)}
    badges = await db.badges.count_documents({"earned_at": {"$gte": f"{month}-01", "$lte": f"{month}-31T23:59:59"},
                                              **({"child_id": {"$in": child_ids}} if child_ids else {})})
    photos = []
    for t in _with_media_refs("task", rows):
        k = kids.get(t.get("child_id"), {})
        photos.append({"id": t["id"], "title": t["title"], "date_key": t["date_key"],
                       "child_name": k.get("name"), "avatar_emoji": k.get("avatar_emoji"),
                       "after": t.get("completion_photo_url"), "before": t.get("before_photo_url")})
    return {"month": month, "photos": photos, "badges_earned": badges}


@api.get("/memories")
async def list_memories(month: Optional[str] = None, child_id: Optional[str] = None,
                        user: dict = Depends(get_current_user)):
    month = month or _today_key()[:7]
    ids = [child_id] if child_id else None
    if user["role"] == "child":
        ids = [user["id"]]
    return await _memories(month, ids)


@api.get("/public/view/{token}/memories")
async def public_memories(token: str, month: Optional[str] = None):
    """The same collage for a grandparent's view link (only its children)."""
    link = await db.view_links.find_one({"token": token}, {"_id": 0})
    if not link or link.get("revoked"):
        raise HTTPException(status_code=404, detail="Link tidak ditemukan atau sudah dicabut")
    return await _memories(month or _today_key()[:7], link.get("child_ids") or None)

# ---- Bootstrap: one round trip per screen ---------------------------------
# A parent's dashboard used to open with six parallel requests, each paying its
# own auth check and (on a cold container) its own wait. One request that runs
# the same reads concurrently on the server answers in the time of the slowest.
@api.get("/parent/bootstrap")
async def parent_bootstrap(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    user: dict = Depends(require_parent),
):
    today = _today_key()
    base = datetime.strptime(today, "%Y-%m-%d")
    sd = start_date or (base - timedelta(days=14)).strftime("%Y-%m-%d")
    ed = end_date or (base + timedelta(days=14)).strftime("%Y-%m-%d")
    # Build today/tomorrow first so the concurrent reads below see them.
    await _ensure_days_ready()
    children, tasks, rewards, consequences, redemptions, stats = await asyncio.gather(
        list_children(user),
        list_tasks(None, None, None, sd, ed, True, user),
        list_rewards(user),
        list_consequences(user),
        list_redemptions(None, user),
        dashboard_stats(user),
    )
    return {
        "children": children, "tasks": tasks, "rewards": rewards,
        "consequences": consequences, "redemptions": redemptions, "stats": stats,
        "window": {"start_date": sd, "end_date": ed}, "today": today,
    }


# Large uploaded images never belong in a child's start-up payload; screens that
# show them (login background) fetch them separately.
_HEAVY_CONFIG_FIELDS = ("slideshow_background_image",)


@api.get("/kid/{child_id}/bootstrap")
async def kid_bootstrap(child_id: str, user: dict = Depends(get_current_user)):
    if user["role"] == "child" and user["id"] != child_id:
        raise HTTPException(status_code=403, detail="Bukan milikmu")
    child = await get_child_or_404(FAMILY_ID, child_id)
    child = {k: v for k, v in child.items() if k != "_id"}
    config, _ = await asyncio.gather(get_app_config(user, False), _ensure_days_ready())
    child["pet_is_dead"] = _pet_is_dead(child, await get_config_cached())
    _with_media_refs("child", child)
    config = {k: v for k, v in (config or {}).items() if k not in _HEAVY_CONFIG_FIELDS and k != "_id"}
    return {"child": child, "config": config, "today": _today_key()}

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

    # The same 15-minute tick keeps today and tomorrow built, so the schedule
    # is ready before anyone opens the app (no sweep on the request path).
    try:
        await _ensure_days_ready(force=True)
    except Exception as e:  # noqa: BLE001 — reminders must still go out
        logger.warning(f"cron day prep failed: {e}")
    try:
        await _maybe_offload_task_photos()
    except Exception as e:  # noqa: BLE001
        logger.warning(f"photo offload failed: {e}")

    # Section deadlines: nudge the child shortly before, tell the parents
    # once a section's finish time has passed unfinished.
    return await _run_reminder_sweep()


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
        # "Adskhan 6/7 · Syila 7/7" — ticked missions per child, plus how many
        # sections were finished, so a parent sees the evening at a glance.
        status = await _sections_status(today)
        lines = []
        for k in kids:
            mine = [r for r in status if r["child_id"] == k["id"]]
            total = sum(r["total"] for r in mine)
            left = sum(len(r["left"]) for r in mine)
            if total:
                secs = f", {sum(1 for r in mine if r['finished'])}/{len(mine)} bagian"
                lines.append(f"{k['name']} {total - left}/{total}{secs}")
        inbox = await parent_inbox({"role": "parent"})
        body = " · ".join(lines) or "Tidak ada misi hari ini"
        if inbox["total"]:
            body += f" — {inbox['total']} perlu perhatianmu"
        await send_push_to({"role": "parent"}, title="Rangkuman hari ini 🌙", body=body, url="/parent")
        await db.digest_log.insert_one({"date_key": today, "type": "evening", "sent_at": now_iso()})
        sent.append("evening")

    # Sunday evening: the week in honesty, gently.
    if now.weekday() == 6 and now.hour == 19 and not await db.digest_log.find_one({"date_key": today, "type": "weekly_honesty"}):
        recap = await honesty_weekly({"role": "parent"})
        parts = [f"{c['child_name']}: kepercayaan {c['trust_now']}"
                 + (f" (jujur mengaku {c['admits']}x)" if c["admits"] else "") for c in recap["children"]]
        if parts:
            await send_push_to({"role": "parent"}, title="Rekap kejujuran minggu ini 🤝",
                               body=" · ".join(parts), url="/parent")
        await db.digest_log.insert_one({"date_key": today, "type": "weekly_honesty", "sent_at": now_iso()})
        sent.append("weekly_honesty")

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
        _invalidate_member_cache()

    for c in children:
        await db.members.insert_one({
            **c,
            "passcode_hash": default_hash,
            "passcode_is_default": True,
            "passcode_plain": DEFAULT_PASSCODE,
            "theme_preference": "clean",
            "created_at": ts,
        })
        _invalidate_member_cache()
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
        "penalty_cards": 0,
        "pet_force_dead": False,
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
    _invalidate_member_cache()
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
    _invalidate_member_cache()

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
        _invalidate_member_cache()

    # 4. Ensure new task fields exist on older tasks.
    await db.tasks.update_many(
        {"duration_minutes": {"$exists": False}}, {"$set": {"duration_minutes": None}}
    )
    await db.tasks.update_many(
        {"is_bonus": {"$exists": False}}, {"$set": {"is_bonus": False}}
    )
    await db.tasks.update_many(
        {"broadcast_id": {"$exists": False}}, {"$set": {"broadcast_id": None}}
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

    # 7. Penalty cards + virtual pet: any child doc predating these features
    #    gets sane defaults so raw API responses are complete rather than
    #    relying entirely on .get()-with-default everywhere.
    await db.children.update_many(
        {"penalty_cards": {"$exists": False}},
        {"$set": {"penalty_cards": 0, "pet_force_dead": False}},
    )
    await db.children.update_many(
        {"pet_force_dead": {"$exists": False}},
        {"$set": {"pet_force_dead": False}},
    )
    # Kartu Bebas was replaced by the Terlambat + Kartu Hukuman system; drop its
    # leftover per-child state so old values can't confuse anything later.
    await db.children.update_many(
        {"freeze_cards_available": {"$exists": True}},
        {"$unset": {"freeze_cards_available": "", "freeze_card_week": ""}},
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


# Bump when the index set changes, so existing deployments rebuild them once.
_INDEX_VERSION = 4


async def _run_one_time_init():
    global _init_done
    if _init_done:
        return
    async with _init_lock:
        if _init_done:  # double-checked after acquiring the lock
            return
        try:
            # Every cold container used to re-issue every create_index. They're
            # idempotent, but each is a round trip. A marker turns that into a
            # single cheap read once the schema is in place.
            marker = await db.app_meta.find_one({"_id": "indexes"})
            if marker and marker.get("version") == _INDEX_VERSION:
                _init_done = True
                return
        except Exception as e:
            logger.warning(f"index marker check failed: {e}")
        try:
            await db.members.create_index("id", unique=True)
            await db.children.create_index("parent_id")
            await db.tasks.create_index([("parent_id", 1), ("child_id", 1)])
            # Nearly every read filters by date, and the kid's timeline hits
            # these on every load — without them Mongo scans the whole
            # collection, which is what made the child's screen crawl as the
            # task history grew.
            await db.tasks.create_index([("parent_id", 1), ("date_key", 1)])
            await db.tasks.create_index([("parent_id", 1), ("date_key", 1), ("child_id", 1)])
            await db.tasks.create_index([("parent_id", 1), ("date_key", 1), ("status", 1)])
            await db.template_tasks.create_index([("parent_id", 1), ("template_id", 1), ("weekday", 1)])
            await db.template_assignments.create_index([("parent_id", 1), ("date_key", 1)])
            await db.day_templates.create_index("parent_id")
            await db.day_builds.create_index([("parent_id", 1), ("date_key", 1)], unique=True)
            await db.routine_swaps.create_index([("parent_id", 1), ("start_date", 1), ("end_date", 1)])
            await db.tasks.create_index([("parent_id", 1), ("date_key", 1), ("from_routine_slot_id", 1)])
            await db.segment_sessions.create_index(
                [("parent_id", 1), ("child_id", 1), ("date_key", 1), ("segment_id", 1)])
            await db.exam_periods.create_index([("parent_id", 1), ("child_id", 1)])
            await db.off_days.create_index([("parent_id", 1), ("start_date", 1), ("end_date", 1)])
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
            await db.app_meta.update_one(
                {"_id": "indexes"},
                {"$set": {"version": _INDEX_VERSION, "at": now_iso()}},
                upsert=True,
            )
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
    global _init_scheduled
    if not _init_done and not _init_scheduled:
        # Fire and forget, but only ONCE. Marking it scheduled up front matters:
        # _init_done is only set when the task finishes, so without this every
        # request arriving in the meantime spawned another index build — piling
        # concurrent work onto the very cold start we were trying to avoid.
        _init_scheduled = True
        task = asyncio.create_task(_run_one_time_init())
        # Retrieve any exception so it can't surface as an unhandled-task error.
        task.add_done_callback(lambda t: t.exception() if not t.cancelled() else None)
    return await call_next(request)


# JSON lists (tasks, activity, stats) compress 70–90%; on a phone connection
# that is most of the wait. Small responses are left alone.
from starlette.middleware.gzip import GZipMiddleware  # noqa: E402
app.add_middleware(GZipMiddleware, minimum_size=1024)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)
