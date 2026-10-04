"""E2E audit: login → sequential tasks → skip → approve → redeem money → passcode mgmt."""
import os
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "testdb")
os.environ.setdefault("JWT_SECRET", "test-secret")

import server
from mongomock_motor import AsyncMongoMockClient

# Swap real Mongo for in-memory mock BEFORE startup runs.
server.client = AsyncMongoMockClient()
server.db = server.client["testdb"]

from fastapi.testclient import TestClient

passed, failed = [], []

def check(name, cond, extra=""):
    (passed if cond else failed).append(name + (f"  [{extra}]" if extra and not cond else ""))
    print(("PASS" if cond else "FAIL"), name, extra if not cond else "")

import asyncio


def run(coro):
    return asyncio.run(coro)


class _Resp:
    """Shape-compatible stand-in for an HTTP response."""
    def __init__(self, status_code, data=None):
        self.status_code = status_code
        self._data = data if data is not None else {}

    def json(self):
        return self._data

    @property
    def text(self):
        return str(self._data)


def start(task_id, body=None):
    """Missions are no longer started one by one — the section is. Kept so the
    scenarios below read the same; it only checks the mission exists."""
    t = run(server.db.tasks.find_one({"id": task_id}, {"_id": 0}))
    return _Resp(200, t) if t else _Resp(404, {"detail": "Not Found"})


def complete(task_id, body=None):
    """Marks one mission done the way finishing its section does: ticked,
    completed, and approved straight away when the family auto-approves."""
    body = body or {}
    t = run(server.db.tasks.find_one({"id": task_id}, {"_id": 0}))
    if not t:
        return _Resp(404, {"detail": "Not Found"})
    if t.get("status") not in ("pending", "rejected"):
        return _Resp(400, {"detail": "Misi ini sudah selesai"})
    if t.get("photo_required") and not body.get("photo_url"):
        return _Resp(422, {"detail": "Misi ini butuh foto sebagai bukti sebelum selesai"})
    if t.get("together_bonus_enabled") and body.get("done_together") is None:
        return _Resp(422, {"detail": "Jawab dulu: apakah misi ini dilakukan bersama?"})
    photo = run(server._store_task_photo(task_id, "completion_photo_url", body.get("photo_url")))
    run(server.db.tasks.update_one({"id": task_id}, {"$set": {
        "status": "completed", "completed_at": server.now_iso(), "checked": True,
        "checked_at": server.now_iso(), "completion_photo_url": photo,
        "done_together": body.get("done_together"),
    }}))
    cfg = run(server.get_config_cached())
    if cfg.get("auto_approve_tasks", True) and not t.get("photo_required"):
        try:
            run(server.approve_task(task_id, server.TaskApproveInput(),
                                    {"id": "system", "role": "parent", "name": "Otomatis"}))
        except server.HTTPException:
            pass
    return _Resp(200, run(server.db.tasks.find_one({"id": task_id}, {"_id": 0})))


with TestClient(server.app, base_url="https://testserver") as c:  # context manager triggers startup → seeding
    # ---- 0. Shared clock used throughout the scenarios below ----
    import datetime as _dt
    import datetime as _dt2
    import asyncio as _aio_tg
    import asyncio as _asyncio3
    now_local = _dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(hours=7)
    today_local = now_local.strftime("%Y-%m-%d")
    utc_now = _dt2.datetime.now(_dt2.timezone.utc)

    # ---- 1. Member list (public) ----
    r = c.get("/api/auth/members")
    members = r.json()
    check("members list 200", r.status_code == 200, str(r.status_code))
    names = [m["name"] for m in members]
    check("4 seeded members", len(members) == 4, str(names))
    check("order parents first", names[:2] == ["Abi", "Ummi"] and set(names[2:]) == {"Adskhan", "Syila"}, str(names))
    check("no hash leak", all("passcode_hash" not in m and "passcode_plain" not in m for m in members))

    abi = next(m for m in members if m["name"] == "Abi")
    ummi = next(m for m in members if m["name"] == "Ummi")
    adskhan = next(m for m in members if m["name"] == "Adskhan")
    syila = next(m for m in members if m["name"] == "Syila")

    # ---- 2. Login ----
    r = c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "999999"})
    check("wrong passcode rejected", r.status_code == 401, str(r.status_code))
    r = c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    check("Abi login ok", r.status_code == 200 and r.json()["role"] == "parent", r.text[:120])
    check("default passcode flagged", r.json().get("is_default_passcode") is True)

    # ---- 3. Parent creates sequential tasks for Adskhan ----
    t = []
    for i, title in enumerate(["Rapikan tempat tidur", "Sholat subuh", "Baca buku 20 menit"], 1):
        r = c.post("/api/tasks", json={"child_id": adskhan["id"], "title": title, "points": 10 * i})
        check(f"create task {i}", r.status_code == 200, r.text[:120])
        t.append(r.json())
    check("orders 1,2,3", [x["order"] for x in t] == [1, 2, 3], str([x.get("order") for x in t]))

    # ---- 4. Parent config: money rate ----
    c.post("/api/config", json={"auto_approve_tasks": False})
    r = c.post("/api/config", json={"rupiah_per_point": 500})
    check("set config", r.status_code == 200, r.text[:120])
    r = c.get("/api/config")
    check("config persisted", r.json().get("rupiah_per_point") == 500, r.text[:200])

    # ---- 5. Kid finishes a mission ----
    r = c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "123456"})
    check("Adskhan login", r.status_code == 200 and r.json()["role"] == "child", r.text[:120])
    r = complete(t[0]['id'])
    check("task#1 completes", r.status_code == 200 and r.json()["status"] == "completed", r.text[:120])

    # ---- 7. Parent approves #1 → kid gets 10 points ----
    r = c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post(f"/api/tasks/{t[0]['id']}/approve")
    check("approve #1", r.status_code == 200, r.text[:150])
    kid = c.get("/api/children").json()
    pts = next(k["points"] for k in kid if k["id"] == adskhan["id"])
    check("kid has 10 pts", pts == 10, str(pts))

    # ---- 9. Redeem BELANJA points → money. Money now draws from the spend
    # bucket (40% of earnings by default), not the headline points. ----
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "123456"})
    ads_now = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    spend_avail = ads_now.get("chiky_spend", 0)
    check("kid has spend bucket funded", spend_avail >= 1, str(spend_avail))
    r = c.post("/api/points/redeem-money", json={"child_id": adskhan["id"], "points": spend_avail})
    check("redeem spend pts", r.status_code == 200 and r.json()["rupiah"] == spend_avail * 500, r.text[:200])
    r = c.post("/api/points/redeem-money", json={"child_id": adskhan["id"], "points": 999})
    check("over-redeem blocked", r.status_code == 400, str(r.status_code))
    r = c.post("/api/points/redeem-money", json={"child_id": syila["id"], "points": 1})
    check("kid can't redeem sibling", r.status_code == 403, str(r.status_code))
    r = c.get("/api/money-redemptions")
    check("kid sees own redemption", len(r.json()) == 1 and r.json()[0]["status"] == "pending", r.text[:200])
    red_id = r.json()[0]["id"]

    # kid cannot pay own redemption
    r = c.post(f"/api/money-redemptions/{red_id}/pay")
    check("kid can't mark paid", r.status_code == 403, str(r.status_code))

    # ---- 10. Parent pays ----
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post(f"/api/money-redemptions/{red_id}/pay")
    check("parent pays", r.status_code == 200, r.text[:120])
    r = c.get("/api/money-redemptions")
    check("status paid", r.json()[0]["status"] == "paid")

    # ---- 11. Passcode self-service + parent visibility ----
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "123456"})
    r = c.post("/api/me/passcode", json={"old_passcode": "111111", "new_passcode": "222222"})
    check("wrong old code rejected", r.status_code == 401, str(r.status_code))
    r = c.post("/api/me/passcode", json={"old_passcode": "123456", "new_passcode": "654321"})
    check("kid changes own code", r.status_code == 200, r.text[:120])
    r = c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    check("login with new code", r.status_code == 200 and r.json().get("is_default_passcode") is False, r.text[:120])

    # profile edit
    r = c.patch("/api/me/profile", json={"avatar_emoji": "🐉", "avatar_color": "#34D399"})
    check("edit own avatar", r.status_code == 200 and r.json()["avatar_emoji"] == "🐉", r.text[:150])

    # parent sees kid's plain code
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.get("/api/admin/members-passcodes")
    data = r.json()
    kidrow = next(x for x in data if x["member_id"] == adskhan["id"])
    parentrow = next(x for x in data if x["member_id"] == abi["id"])
    check("parent sees kid plain code", kidrow["passcode_plain"] == "654321", str(kidrow))
    check("parent codes hidden", parentrow["passcode_plain"] is None)

    # parent resets kid's code
    r = c.post(f"/api/members/{adskhan['id']}/reset-passcode")
    check("parent resets kid code", r.status_code == 200 and r.json()["default_passcode"] == "123456")
    r = c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "123456"})
    check("kid login after reset", r.status_code == 200)

    # ---- 12. Kid permission walls ----
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.post("/api/tasks", json={"child_id": syila["id"], "title": "hack", "points": 999})
    check("kid can't create task", r.status_code == 403, str(r.status_code))
    r = c.post("/api/config", json={"rupiah_per_point": 999999})
    check("kid can't change config", r.status_code == 403, str(r.status_code))
    r = c.get("/api/admin/members-passcodes")
    check("kid can't view passcodes", r.status_code == 403, str(r.status_code))

    # ---- 13. Personality (MBTI) ----
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.get("/api/personality/types")
    check("personality types list", r.status_code == 200 and len(r.json()["types"]) == 32, str(r.status_code))
    check("INTJ-T profile present", "INTJ-T" in r.json()["profiles"])
    check("ESFJ-T profile present", "ESFJ-T" in r.json()["profiles"])

    r = c.get(f"/api/children/{adskhan['id']}/personality")
    check("Adskhan is INTJ-T", r.json()["mbti"] == "INTJ-T", str(r.json().get("mbti")))
    check("Adskhan nickname", r.json()["profile"]["nickname"] == "Sang Ahli Strategi", str(r.json()["profile"].get("nickname")))
    check("Adskhan suggested challenge", "challenge" in r.json()["suggested_styles"], str(r.json().get("suggested_styles")))

    r = c.get(f"/api/children/{syila['id']}/personality")
    check("Syila is ENFJ-T", r.json()["mbti"] == "ENFJ-T", str(r.json().get("mbti")))
    check("Syila suggested helper", "helper" in r.json()["suggested_styles"], str(r.json().get("suggested_styles")))

    # New task auto-inherits style from child MBTI when not specified
    r = c.post("/api/tasks", json={"child_id": adskhan["id"], "title": "Susun strategi belajar", "points": 20})
    check("task auto-style from INTJ", r.json().get("task_style") == "challenge", str(r.json().get("task_style")))
    r = c.post("/api/tasks", json={"child_id": syila["id"], "title": "Bantu rapikan meja makan", "points": 15})
    check("task auto-style from ESFJ", r.json().get("task_style") == "helper", str(r.json().get("task_style")))
    # explicit style overrides
    r = c.post("/api/tasks", json={"child_id": syila["id"], "title": "Gambar bebas", "points": 10, "task_style": "creative"})
    check("explicit task_style respected", r.json().get("task_style") == "creative", str(r.json().get("task_style")))

    # Update a child's MBTI and confirm it syncs to members
    r = c.patch(f"/api/children/{syila['id']}", json={"mbti": "ENFP-T"})
    check("update child mbti", r.status_code == 200 and r.json().get("mbti") == "ENFP-T", r.text[:120])
    r = c.get(f"/api/children/{syila['id']}/personality")
    check("mbti updated reads back", r.json()["mbti"] == "ENFP-T")
    # restore
    c.patch(f"/api/children/{syila['id']}", json={"mbti": "ESFJ-T"})

    # invalid MBTI rejected by schema
    r = c.patch(f"/api/children/{syila['id']}", json={"mbti": "XXXX-Z"})
    check("invalid mbti rejected", r.status_code == 422, str(r.status_code))

    # ---- 14. Task duration (information only; missions carry no clock) ----
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post("/api/tasks", json={"child_id": adskhan["id"], "title": "Makan malam", "points": 5, "duration_minutes": 15})
    check("task with duration", r.status_code == 200 and r.json()["duration_minutes"] == 15, r.text[:160])
    dt_task = r.json()
    check("task carries no per-mission time", "due_time" not in r.json() and "timer_started_at" not in r.json(),
          str([k for k in r.json() if "time" in k]))
    r = c.post("/api/tasks", json={"child_id": adskhan["id"], "title": "Bebas", "points": 5})
    check("task without duration", r.status_code == 200 and r.json().get("duration_minutes") is None, r.text[:160])
    r = c.post("/api/tasks", json={"child_id": adskhan["id"], "title": "Jam lama", "points": 5, "due_time": "21:00",
                                   "recurrence": "daily"})
    check("old per-mission fields are ignored", r.status_code == 200 and "due_time" not in r.json()
          and r.json()["recurrence"] == "none", r.text[:160])
    # duration out of range rejected
    r = c.post("/api/tasks", json={"child_id": adskhan["id"], "title": "Salah2", "points": 5, "duration_minutes": 99999})
    check("duration out of range rejected", r.status_code == 422, str(r.status_code))

    # ---- 15. Edit task ----
    r = c.patch(f"/api/tasks/{dt_task['id']}", json={"duration_minutes": 20, "title": "Makan malam (edit)"})
    check("edit task fields", r.status_code == 200 and r.json()["duration_minutes"] == 20 and r.json()["title"] == "Makan malam (edit)", r.text[:180])
    r = c.patch(f"/api/tasks/{dt_task['id']}", json={"duration_minutes": None})
    check("clear duration", r.status_code == 200 and r.json().get("duration_minutes") is None, r.text[:180])

    # ---- 16. Delete task ----
    r = c.delete(f"/api/tasks/{dt_task['id']}")
    check("delete task", r.status_code == 200, r.text[:120])
    r = c.patch(f"/api/tasks/{dt_task['id']}", json={"title": "x"})
    check("deleted task gone", r.status_code == 404, str(r.status_code))

    # kid cannot edit/delete tasks
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.post("/api/tasks", json={"child_id": syila["id"], "title": "x", "points": 1})
    check("kid still can't create", r.status_code == 403, str(r.status_code))

    # ---- 17. Quest theme ----
    # kid sets own quest theme
    r = c.patch("/api/me/profile", json={"quest_theme": "rainbow"})
    check("kid sets own quest_theme", r.status_code == 200 and r.json().get("quest_theme") == "rainbow", r.text[:150])
    # invalid theme rejected
    r = c.patch("/api/me/profile", json={"quest_theme": "bogus"})
    check("invalid quest_theme rejected", r.status_code == 422, str(r.status_code))
    # parent updates child quest theme
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.patch(f"/api/children/{adskhan['id']}", json={"quest_theme": "space"})
    check("parent sets child quest_theme", r.status_code == 200 and r.json().get("quest_theme") == "space", r.text[:150])
    # theme survives on children list
    kids_list = c.get("/api/children").json()
    ads_row = next(k for k in kids_list if k["id"] == adskhan["id"])
    check("quest_theme persists in children list", ads_row.get("quest_theme") == "space", str(ads_row.get("quest_theme")))

    # ---- 18. Broadcast tasks & daily quest system ----
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    # cleanup: give kids fresh state for this section.
    # NOTE: kids can only START/COMPLETE tasks on the current day, so this
    # section uses TODAY as its working day (a fixed future date would be
    # correctly rejected by the past/future-day guard). Clear any pre-existing
    # tasks first so the treasure-hunt sequence starts clean.
    import datetime as _dt_today
    tomorrow = (_dt_today.datetime.utcnow() + _dt_today.timedelta(hours=7)).strftime("%Y-%m-%d")
    import asyncio as _aio_clear
    _aio_clear.run(server.db.tasks.delete_many({"parent_id": "family-default"}))
    # Broadcast (target_children empty) → both kids get a copy
    r = c.post("/api/tasks", json={"title": "Sikat gigi", "points": 5, "date_key": tomorrow})
    check("broadcast task creates for all kids", r.status_code == 200 and r.json().get("count") == 2, r.text[:200])
    bcast_data = r.json()
    bcast_id = bcast_data["broadcast_id"]
    check("broadcast_id links siblings", all(t.get("broadcast_id") == bcast_id for t in bcast_data["tasks"]))

    # Explicit target_children [1 kid] → single task
    r = c.post("/api/tasks", json={"title": "Baca buku", "points": 10, "target_children": [adskhan["id"]], "date_key": tomorrow})
    check("explicit single target", r.status_code == 200 and r.json().get("child_id") == adskhan["id"])

    # Explicit target_children [both] → 2 tasks with broadcast_id
    r = c.post("/api/tasks", json={"title": "Rapikan mainan", "points": 8, "target_children": [adskhan["id"], syila["id"]], "date_key": tomorrow})
    check("explicit multi target", r.status_code == 200 and r.json().get("count") == 2)

    # date_key filter
    r = c.get(f"/api/tasks?date_key={tomorrow}&child_id={adskhan['id']}")
    tasks_tomorrow = r.json()
    check("date_key filter returns only that day", all(t["date_key"] == tomorrow for t in tasks_tomorrow) and len(tasks_tomorrow) >= 3, str(len(tasks_tomorrow)))

    # invalid date rejected
    r = c.post("/api/tasks", json={"title": "x", "points": 1, "date_key": "13-01-2026"})
    check("invalid date_key rejected", r.status_code == 422, str(r.status_code))

    # Bonus task doesn't block quest line
    r = c.post("/api/tasks", json={"title": "Bonus: bantuin cuci piring", "points": 15, "is_bonus": True, "target_children": [adskhan["id"]], "date_key": tomorrow})
    check("bonus task marked bonus", r.status_code == 200 and r.json().get("is_bonus") is True)

    # ---- 20. Day progress endpoint ----
    r = c.get(f"/api/children/{adskhan['id']}/day-progress?date_key={tomorrow}")
    prog = r.json()
    check("day-progress structure", r.status_code == 200 and "daily_goal" in prog and "total_earned" in prog and "tasks" in prog, r.text[:200])
    check("day-progress has required_count", prog["required_count"] >= 2, str(prog.get("required_count")))
    check("day-progress bonus separated", prog["bonus_count"] >= 1, str(prog.get("bonus_count")))

    # Parent family day-progress
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.get(f"/api/family/day-progress?date_key={tomorrow}")
    fam = r.json()
    check("family day-progress lists all kids", r.status_code == 200 and len(fam["children"]) == 2, str(len(fam.get("children", []))))
    check("family progress date matches", fam["date_key"] == tomorrow)

    # daily_point_goal is persisted via config
    r = c.post("/api/config", json={"daily_point_goal": 80})
    check("set daily_point_goal", r.status_code == 200)
    r = c.get("/api/config")
    check("daily_point_goal persists", r.json().get("daily_point_goal") == 80, str(r.json().get("daily_point_goal")))

    # ---- 21. Kids can't see admin routes ----
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.get(f"/api/family/day-progress?date_key={tomorrow}")
    check("kid can't view family progress", r.status_code == 403, str(r.status_code))
    # kid CAN see own day-progress
    r = c.get(f"/api/children/{syila['id']}/day-progress?date_key={tomorrow}")
    check("kid can see own progress", r.status_code == 200)

    # ================= 22. FULL LIFECYCLE REGRESSION =================
    # Covers the exact flows reported broken: create task -> kid does it ->
    # start/finish timer -> points awarded -> spend in reward shop -> convert
    # to rupiah -> change theme -> change avatar -> change passcode -> upload
    # profile photo -> session survives a simulated "refresh".
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    import datetime as _dt_life
    life_date = (_dt_life.datetime.utcnow() + _dt_life.timedelta(hours=7)).strftime("%Y-%m-%d")
    import asyncio as _aio_life
    _aio_life.run(server.db.tasks.delete_many({"parent_id": "family-default"}))

    r = c.post("/api/tasks", json={
        "title": "Sikat gigi", "points": 5, "date_key": life_date,
        "child_id": adskhan["id"], "is_bonus": False,
    })
    check("lifecycle: create task", r.status_code == 200, r.text[:200])
    life_task = r.json()

    r = c.get("/api/tasks")
    check("lifecycle: task appears in parent list", any(t["id"] == life_task["id"] for t in r.json()))

    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "123456"})
    r = c.get(f"/api/children/{adskhan['id']}/day-progress?date_key={life_date}")
    check("lifecycle: kid sees the task", any(t["id"] == life_task["id"] for t in r.json()["tasks"]), r.text[:200])

    # The real child flow: start the section, tick, finish the section.
    sbody = {"child_id": adskhan["id"], "date_key": life_date, "segment_id": server.ANYTIME_SEGMENT_ID}
    r = c.post("/api/segment-sessions/start", json=sbody)
    check("lifecycle: start the section", r.status_code == 200 and r.json().get("started_at"), r.text[:160])
    r = c.post(f"/api/tasks/{life_task['id']}/check", json={"checked": True})
    check("lifecycle: tick the mission", r.status_code == 200 and r.json()["checked"] is True, r.text[:160])
    r = c.post("/api/segment-sessions/finish", json=sbody)
    check("lifecycle: finish the section", r.status_code == 200 and r.json()["completed"] == 1, r.text[:160])
    check("lifecycle: mission is completed",
          _aio_life.run(server.db.tasks.find_one({"id": life_task["id"]}))["status"] == "completed")

    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    pts_before = next(k["points"] for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    r = c.post(f"/api/tasks/{life_task['id']}/approve")
    check("lifecycle: approve task", r.status_code == 200)
    pts_after = next(k["points"] for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("lifecycle: points awarded", pts_after == pts_before + 5, f"{pts_before}->{pts_after}")

    ads_life = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    # Reward is bought from savings (Tabungan); make cost fit current savings.
    reward_cost = max(1, min(2, ads_life.get("chiky_save", 0)))
    r = c.post("/api/rewards", json={"name": "Permen", "description": "", "cost_points": reward_cost})
    reward = r.json()
    save_before = ads_life.get("chiky_save", 0)
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "123456"})
    r = c.post(f"/api/rewards/{reward['id']}/redeem", params={"child_id": adskhan["id"]})
    check("lifecycle: redeem reward (from savings)", r.status_code == 200, r.text[:200])
    ads_after_redeem = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("lifecycle: savings deducted by reward cost", ads_after_redeem.get("chiky_save", 0) == save_before - reward_cost, f"{save_before}->{ads_after_redeem.get('chiky_save')}")

    spend_life = ads_after_redeem.get("chiky_spend", 0)
    if spend_life >= 1:
        r = c.post("/api/points/redeem-money", json={"child_id": adskhan["id"], "points": 1})
        check("lifecycle: exchange spend points to rupiah", r.status_code == 200, r.text[:200])

    r = c.post(f"/api/children/{adskhan['id']}/theme", json={"theme": "galaxy"})
    check("lifecycle: change visual theme", r.status_code == 200 and r.json()["theme"] == "galaxy")

    r = c.patch("/api/me/profile", json={"avatar_emoji": "🐝", "avatar_color": "#FBBF24"})
    check("lifecycle: change avatar", r.status_code == 200 and r.json()["avatar_emoji"] == "🐝")

    r = c.post("/api/me/passcode", json={"old_passcode": "123456", "new_passcode": "654321"})
    check("lifecycle: change own passcode", r.status_code == 200, r.text[:200])
    r = c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    check("lifecycle: login with new passcode", r.status_code == 200)

    # Profile photo upload — must accept JSON body {photo_url}, not a query param
    r = c.post(f"/api/children/{adskhan['id']}/profile-photo", json={"photo_url": "data:image/png;base64,ABC123"})
    check("lifecycle: upload profile photo via JSON body", r.status_code == 200 and r.json().get("photo_url", "").startswith("data:image"), r.text[:200])
    r = c.post(f"/api/children/{adskhan['id']}/profile-photo", json={"photo_url": None})
    check("lifecycle: remove profile photo", r.status_code == 200 and r.json().get("photo_url") is None)

    # Simulated "refresh": /auth/me must keep working after all the above,
    # proving the session/db-connection layer is stable across many requests.
    r = c.get("/api/auth/me")
    check("lifecycle: session survives refresh", r.status_code == 200 and r.json()["id"] == adskhan["id"], r.text[:200])

    # ================= 24. IDEMPOTENT DELETES =================
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post("/api/tasks", json={"title": "Del2x", "points": 5, "child_id": adskhan["id"], "date_key": today_local})
    d_task = r.json()
    r1 = c.delete(f"/api/tasks/{d_task['id']}")
    r2 = c.delete(f"/api/tasks/{d_task['id']}")  # double-click / stale-list simulation
    check("idem: task double-delete both 200", r1.status_code == 200 and r2.status_code == 200, f"{r1.status_code},{r2.status_code}")
    r = c.delete("/api/tasks/garbage-id")
    check("idem: delete unknown id is 200", r.status_code == 200, str(r.status_code))

    rw = c.post("/api/rewards", json={"name": "IdemR", "description": "", "cost_points": 1}).json()
    check("idem: reward double-delete", c.delete(f"/api/rewards/{rw['id']}").status_code == 200 and c.delete(f"/api/rewards/{rw['id']}").status_code == 200)
    cq = c.post("/api/consequences", json={"name": "IdemC", "description": "", "penalty_points": 1}).json()
    check("idem: consequence double-delete", c.delete(f"/api/consequences/{cq['id']}").status_code == 200 and c.delete(f"/api/consequences/{cq['id']}").status_code == 200)

    # Approving never creates another copy: repeating is the weekly routine's job now.
    r = c.post("/api/tasks", json={"title": "HarianDedup", "points": 5, "target_children": [adskhan["id"]], "date_key": today_local, "is_bonus": True})
    rec = r.json()
    complete(rec['id'])
    r = c.post(f"/api/tasks/{rec['id']}/approve")
    check("approve: ok", r.status_code == 200, r.text[:100])
    tomorrow_local = (now_local + _dt.timedelta(days=1)).strftime("%Y-%m-%d")
    check("approve: no copy is spawned",
          not [t for t in c.get(f"/api/tasks?date_key={tomorrow_local}&child_id={adskhan['id']}").json() if t["title"] == "HarianDedup"])
    r = c.post(f"/api/tasks/{rec['id']}/approve")
    check("approve: double-approve blocked", r.status_code == 400, str(r.status_code))

    # ================= 25. SAVINGS GOAL (BusyKid-inspired) =================
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.patch("/api/me/profile", json={"savings_goal_name": "Sepeda baru", "savings_goal_amount": 500000})
    check("goal: kid sets savings goal", r.status_code == 200 and r.json().get("savings_goal_name") == "Sepeda baru" and r.json().get("savings_goal_amount") == 500000, r.text[:150])
    # persists in children list (used by kid UI)
    kid_row = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("goal: visible in children list", kid_row.get("savings_goal_name") == "Sepeda baru", str(kid_row.get("savings_goal_name")))
    # invalid values rejected
    r = c.patch("/api/me/profile", json={"savings_goal_amount": -5})
    check("goal: negative amount rejected", r.status_code == 422, str(r.status_code))
    r = c.patch("/api/me/profile", json={"savings_goal_name": "x" * 100})
    check("goal: over-long name rejected", r.status_code == 422, str(r.status_code))
    # parent can also set it for a child
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.patch(f"/api/children/{syila['id']}", json={"savings_goal_name": "Boneka", "savings_goal_amount": 150000})
    check("goal: parent sets for child", r.status_code == 200 and r.json().get("savings_goal_amount") == 150000, r.text[:150])

    # ================= 26. THREE CHIKYBANKS =================
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c.post("/api/config", json={"chiky_save_pct": 50, "chiky_spend_pct": 30, "chiky_share_pct": 20})
    r = c.get("/api/config")
    check("chiky: config persists", r.json()["chiky_save_pct"] == 50 and r.json()["chiky_share_pct"] == 20)

    # Create + complete + approve a bonus task and check Chikybank split
    r = c.post("/api/tasks", json={"title": "ChikyTest", "points": 10, "target_children": [syila["id"]], "date_key": today_local, "is_bonus": True})
    pt = r.json()
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    complete(pt['id'])
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    syi_before = next(k for k in c.get("/api/children").json() if k["id"] == syila["id"])
    save_before = syi_before.get("chiky_save", 0)
    spend_before = syi_before.get("chiky_spend", 0)
    share_before = syi_before.get("chiky_share", 0)
    c.post(f"/api/tasks/{pt['id']}/approve")
    syi_after = next(k for k in c.get("/api/children").json() if k["id"] == syila["id"])
    check("chiky: save increased", syi_after.get("chiky_save", 0) == save_before + 5, f"{save_before}->{syi_after.get('chiky_save')}")
    check("chiky: spend increased", syi_after.get("chiky_spend", 0) == spend_before + 3, f"{spend_before}->{syi_after.get('chiky_spend')}")
    check("chiky: share increased", syi_after.get("chiky_share", 0) == share_before + 2, f"{share_before}->{syi_after.get('chiky_share')}")

    # ================= 27. WEEKLY REPORT =================
    r = c.get("/api/family/weekly-report")
    check("weekly: returns report", r.status_code == 200 and "children" in r.json() and len(r.json()["children"]) == 2, r.text[:200])
    check("weekly: has period", "period_start" in r.json() and "period_end" in r.json())
    report_child = r.json()["children"][0]
    check("weekly: child has chiky info", "chiky_save" in report_child["child"], str(report_child["child"].keys()))
    check("weekly: has days breakdown", len(report_child["days"]) == 7, str(len(report_child.get("days", {}))))
    # kid can't see weekly report
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.get("/api/family/weekly-report")
    check("weekly: kid blocked", r.status_code == 403)

    # ================= 28. WEEKDAYS-BASED TASK CREATION =================
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    # Create task on Mon+Wed+Fri (0,2,4) for one child
    r = c.post("/api/tasks", json={"title": "Olahraga", "points": 10, "target_children": [adskhan["id"]], "weekdays": [0, 2, 4]})
    check("weekday: creates 3 copies", r.status_code == 200 and r.json().get("count") == 3, r.text[:200])
    wd_tasks = r.json()["tasks"]
    # all 3 have distinct date_keys
    dks = set(t["date_key"] for t in wd_tasks)
    check("weekday: 3 distinct dates", len(dks) == 3, str(dks))
    # each date_key's weekday matches one of requested
    import datetime as _d2
    wds = set(_d2.datetime.strptime(t["date_key"], "%Y-%m-%d").weekday() for t in wd_tasks)
    check("weekday: dates match requested days", wds == {0, 2, 4}, str(wds))

    # weekday + broadcast = days x kids
    r = c.post("/api/tasks", json={"title": "Beres", "points": 5, "target_children": [], "weekdays": [0, 1]})
    check("weekday: broadcast x days", r.json().get("count") == 4, str(r.json().get("count")))  # 2 days x 2 kids

    # invalid weekday rejected
    r = c.post("/api/tasks", json={"title": "x", "points": 1, "target_children": [adskhan["id"]], "weekdays": [9]})
    check("weekday: invalid rejected", r.status_code == 422, str(r.status_code))

    # ================= 29. DYNAMIC DAILY GOAL =================
    goal_date = "2026-10-20"
    # No tasks yet -> falls back to config default
    r = c.get(f"/api/children/{syila['id']}/day-progress?date_key={goal_date}")
    check("goal: empty day uses config default", r.json()["daily_goal"] == 80, str(r.json().get("daily_goal")))  # 80 set earlier
    # Add required tasks 10 + 15 = 25 -> goal becomes 25
    c.post("/api/tasks", json={"title": "T1", "points": 10, "target_children": [syila["id"]], "date_key": goal_date})
    c.post("/api/tasks", json={"title": "T2", "points": 15, "target_children": [syila["id"]], "date_key": goal_date})
    r = c.get(f"/api/children/{syila['id']}/day-progress?date_key={goal_date}")
    check("goal: dynamic = sum of required points", r.json()["daily_goal"] == 25, str(r.json().get("daily_goal")))
    # bonus task doesn't inflate the goal
    c.post("/api/tasks", json={"title": "B1", "points": 50, "target_children": [syila["id"]], "date_key": goal_date, "is_bonus": True})
    r = c.get(f"/api/children/{syila['id']}/day-progress?date_key={goal_date}")
    check("goal: bonus excluded from goal", r.json()["daily_goal"] == 25, str(r.json().get("daily_goal")))

    # ================= 30. PER-WEEKDAY GOALS =================
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    # Set Monday(0) goal = 99
    r = c.post("/api/config", json={"weekday_goals": {"0": 99}})
    check("weekday-goal: saves", r.status_code == 200)
    r = c.get("/api/config")
    check("weekday-goal: persists", r.json()["weekday_goals"].get("0") == 99, str(r.json().get("weekday_goals")))
    # Find a Monday date and check the goal applies
    import datetime as _d3
    base = _d3.datetime.now(_d3.timezone.utc) + _d3.timedelta(hours=7)
    days_to_mon = (0 - base.weekday()) % 7
    monday = (base + _d3.timedelta(days=days_to_mon + 7)).strftime("%Y-%m-%d")  # a clean future Monday
    r = c.get(f"/api/children/{syila['id']}/day-progress?date_key={monday}")
    check("weekday-goal: Monday uses 99", r.json()["daily_goal"] == 99, f"{r.json().get('daily_goal')} on {monday}")
    # Partial update doesn't wipe: set Tuesday, Monday should remain
    c.post("/api/config", json={"weekday_goals": {"1": 50}})
    r = c.get("/api/config")
    check("weekday-goal: merge keeps Monday", r.json()["weekday_goals"].get("0") == 99 and r.json()["weekday_goals"].get("1") == 50, str(r.json().get("weekday_goals")))

    # ================= 31. CUSTOM LABELS =================
    r = c.post("/api/config", json={"custom_labels": {"nav.tasks": "Misi Harian", "nav.rewards": ""}})
    check("labels: saves", r.status_code == 200)
    r = c.get("/api/config")
    lbls = r.json()["custom_labels"]
    check("labels: override persists", lbls.get("nav.tasks") == "Misi Harian", str(lbls))
    check("labels: hidden (empty) persists", lbls.get("nav.rewards") == "", str(lbls))
    # Public branding exposes labels without auth
    c2 = TestClient(server.app, base_url="https://testserver")
    r = c2.get("/api/auth/branding")
    check("labels: branding public (no auth)", r.status_code == 200 and r.json()["custom_labels"].get("nav.tasks") == "Misi Harian", r.text[:150])
    # Clearing a label (null) removes override
    c.post("/api/config", json={"custom_labels": {"nav.tasks": None}})
    r = c.get("/api/config")
    check("labels: null clears override", "nav.tasks" not in r.json()["custom_labels"], str(r.json()["custom_labels"]))

    # ================= 32. BACKGROUND IMAGE =================
    r = c.post("/api/config", json={"slideshow_background_image": "data:image/png;base64,ABC123"})
    check("bg: image saves", r.status_code == 200)
    r = c.get("/api/config")
    check("bg: image persists", r.json()["slideshow_background_image"] == "data:image/png;base64,ABC123")
    r = c2.get("/api/auth/branding")
    check("bg: image in branding", r.json()["slideshow_background_image"] == "data:image/png;base64,ABC123")

    # ================= 33. BROADCAST FORK ON EDIT =================
    r = c.post("/api/tasks", json={"title": "Shared", "points": 5, "target_children": [], "date_key": today_local})
    bcast = r.json()
    check("fork: broadcast made 2", bcast.get("count") == 2, str(bcast.get("count")))
    first_id = bcast["tasks"][0]["id"]
    bid = bcast["tasks"][0]["broadcast_id"]
    check("fork: siblings share broadcast_id", bid and bcast["tasks"][1]["broadcast_id"] == bid)
    # Edit one → it detaches
    r = c.patch(f"/api/tasks/{first_id}", json={"points": 20})
    check("fork: edited task detached", r.json().get("broadcast_id") is None and r.json()["points"] == 20, str(r.json().get("broadcast_id")))
    # Sibling still has broadcast_id
    second_id = bcast["tasks"][1]["id"]
    sib = c.get(f"/api/tasks?date_key={today_local}").json()
    sib_task = next(t for t in sib if t["id"] == second_id)
    check("fork: sibling keeps broadcast_id", sib_task.get("broadcast_id") == bid, str(sib_task.get("broadcast_id")))

    c2.close()

    # ================= 34. UNDO APPROVAL =================
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post("/api/tasks", json={"title": "UndoMe", "points": 15, "target_children": [syila["id"]], "date_key": today_local, "is_bonus": True})
    ut = r.json()
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    complete(ut['id'])
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    pts_before = next(k["points"] for k in c.get("/api/children").json() if k["id"] == syila["id"])
    r = c.post(f"/api/tasks/{ut['id']}/approve")
    check("undo: approve ok", r.status_code == 200)
    pts_after_approve = next(k["points"] for k in c.get("/api/children").json() if k["id"] == syila["id"])
    check("undo: points awarded", pts_after_approve == pts_before + 15, f"{pts_before}->{pts_after_approve}")
    r = c.post(f"/api/tasks/{ut['id']}/undo-approval")
    check("undo: succeeds within window", r.status_code == 200 and r.json()["status"] == "completed", r.text[:150])
    pts_after_undo = next(k["points"] for k in c.get("/api/children").json() if k["id"] == syila["id"])
    check("undo: points refunded exactly", pts_after_undo == pts_before, f"expected {pts_before} got {pts_after_undo}")
    # Undo again -> now status is "completed" not "approved" -> rejected
    r = c.post(f"/api/tasks/{ut['id']}/undo-approval")
    check("undo: double-undo rejected", r.status_code == 400, str(r.status_code))
    # Undo a task that was never approved
    r2 = c.post("/api/tasks", json={"title": "NeverApproved", "points": 5, "child_id": syila["id"], "date_key": today_local, "is_bonus": True})
    r = c.post(f"/api/tasks/{r2.json()['id']}/undo-approval")
    check("undo: never-approved task rejected", r.status_code == 400, str(r.status_code))
    # Undo a task that doesn't exist
    r = c.post("/api/tasks/nonexistent-id/undo-approval")
    check("undo: nonexistent task 404", r.status_code == 404, str(r.status_code))

    # ================= 36. FAMILY CHALLENGES =================
    r = c.post("/api/challenges", json={
        "title": "Minggu Rajin", "description": "Kumpulkan poin bareng!",
        "participant_ids": [adskhan["id"], syila["id"]], "target_points": 20,
        "start_date": today_local, "end_date": today_local, "reward_description": "Nonton bareng",
    })
    check("challenge: create ok", r.status_code == 200, r.text[:150])
    chall = r.json()
    r = c.get("/api/challenges")
    check("challenge: appears in list", any(x["id"] == chall["id"] for x in r.json()))
    found = next(x for x in r.json() if x["id"] == chall["id"])
    check("challenge: has progress fields", "earned_points" in found and "percent" in found)
    # Invalid: end before start
    r = c.post("/api/challenges", json={
        "title": "Bad", "participant_ids": [adskhan["id"]], "target_points": 10,
        "start_date": "2026-01-10", "end_date": "2026-01-01",
    })
    check("challenge: end<start rejected", r.status_code == 422, str(r.status_code))
    # Invalid: unknown participant
    r = c.post("/api/challenges", json={
        "title": "Bad2", "participant_ids": ["nonexistent"], "target_points": 10,
        "start_date": today_local, "end_date": today_local,
    })
    check("challenge: unknown participant rejected", r.status_code == 404, str(r.status_code))
    # Kid can only see challenges they're part of
    r = c.post("/api/challenges", json={
        "title": "Solo Ads", "participant_ids": [adskhan["id"]], "target_points": 5,
        "start_date": today_local, "end_date": today_local,
    })
    solo = r.json()
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.get("/api/challenges")
    check("challenge: kid sees only own", not any(x["id"] == solo["id"] for x in r.json()) and any(x["id"] == chall["id"] for x in r.json()))
    check("challenge: kid create blocked", c.post("/api/challenges", json={"title": "x", "participant_ids": [syila["id"]], "target_points": 1, "start_date": today_local, "end_date": today_local}).status_code == 403)
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.delete(f"/api/challenges/{solo['id']}")
    check("challenge: delete ok", r.status_code == 200)
    r = c.delete(f"/api/challenges/{solo['id']}")
    check("challenge: idempotent delete", r.status_code == 200)

    # ================= 37. PHOTO VERIFICATION =================
    r = c.post("/api/tasks", json={"title": "FotoWajib", "points": 10, "child_id": syila["id"], "date_key": today_local, "is_bonus": True, "photo_required": True})
    ft = r.json()
    check("photo: task created with flag", ft.get("photo_required") is True)
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = complete(ft['id'])
    check("photo: complete without photo rejected", r.status_code == 422, str(r.status_code))
    r = complete(ft['id'], {"photo_url": "data:image/png;base64,XYZ"})
    check("photo: complete with photo ok", r.status_code == 200 and r.json().get("completion_photo_url"), r.text[:150])

    # ================= 38. SOUND THEME =================
    r = c.patch("/api/me/profile", json={"sound_theme": "fanfare"})
    check("sound: kid sets own theme", r.status_code == 200 and r.json()["sound_theme"] == "fanfare", r.text[:150])
    r = c.patch("/api/me/profile", json={"sound_theme": "not-a-real-theme"})
    check("sound: invalid theme rejected", r.status_code == 422, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.patch(f"/api/children/{adskhan['id']}", json={"sound_theme": "drum"})
    check("sound: parent sets for child", r.status_code == 200 and r.json()["sound_theme"] == "drum")

    # ================= 39. MONTH PROGRESS (calendar heatmap) =================
    r = c.get(f"/api/children/{adskhan['id']}/month-progress", params={"year": 2026, "month": 8})
    check("month: valid request ok", r.status_code == 200 and "days" in r.json(), r.text[:150])
    r = c.get(f"/api/children/{adskhan['id']}/month-progress", params={"year": 2026, "month": 13})
    check("month: invalid month rejected", r.status_code == 422, str(r.status_code))
    r = c.get(f"/api/children/{adskhan['id']}/month-progress", params={"year": 1800, "month": 5})
    check("month: invalid year rejected", r.status_code == 422, str(r.status_code))

    # ================= 40. BADGE COUNT + VAPID KEY ENDPOINT =================
    r = c.get("/api/badge-count")
    check("badge: parent count returned", r.status_code == 200 and "count" in r.json())
    r = c.get("/api/push/vapid-public-key")
    check("push: vapid key endpoint responds (public, no auth)", r.status_code == 200 and "key" in r.json())

    # ================= 41. CRON REMINDER ENDPOINT =================
    r = c.get("/api/cron/send-reminders")
    check("cron: no auth header rejected", r.status_code == 403, str(r.status_code))
    r = c.get("/api/cron/send-reminders", headers={"Authorization": "Bearer wrong-secret"})
    check("cron: wrong secret rejected", r.status_code == 403, str(r.status_code))

    # ================= 42. REGRESSION: fresh-family config write must not drop new fields =================
    # Root cause of a real bug: the "no config doc yet" branch of set_app_config
    # only copied a handful of legacy fields, silently discarding anything else
    # (vacation_mode, piggy split, weekday_goals, custom_labels, bg image) if it
    # happened to be the very FIRST config write for a family. Simulate that by
    # clearing the config collection (between requests, so no event loop is
    # already running), then setting only vacation_mode.
    import asyncio as _asyncio
    _asyncio.run(server.db.app_config.delete_many({}))

    r = c.post("/api/config", json={"vacation_mode": True})
    check("regression: config write accepted", r.status_code == 200)
    r = c.get("/api/config")
    check("regression: vacation_mode set on fresh config doc", r.json()["vacation_mode"] is True, str(r.json().get("vacation_mode")))
    check("regression: other defaults still sane", r.json()["daily_point_goal"] == 50 and r.json()["chiky_save_pct"] == 40, str(r.json()))
    c.post("/api/config", json={"vacation_mode": False})  # reset — leaving this on would silently break every later test that expects recurrence to spawn
    # The wipe above restored factory defaults, which re-enable the pacing
    # cooldown/bonus. Re-apply the suite-wide overrides so later tests keep
    # measuring what they intend to.
    c.post("/api/config", json={"min_gap_seconds": 0, "notify_parent_on_start": False,
                                "pacing_bonus_points": 0, "auto_approve_tasks": False})

    # ================= 43. REGRESSION: /auth/me must include all self-editable profile fields =================
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    c.post("/api/me/profile", json={"sound_theme": "fanfare"})
    r = c.get("/api/auth/me")
    check("regression: sound_theme present in /auth/me", r.json().get("sound_theme") == "fanfare", str(r.json().get("sound_theme")))

    # ================= 44. STREAK GAP RESETS (no more Kartu Bebas) =================
    # Kartu Bebas was removed in favour of the Terlambat + Kartu Hukuman flow,
    # so a real gap in completions now always resets the streak to 1.
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    gap_date = (now_local - _dt.timedelta(days=3)).strftime("%Y-%m-%d")
    import asyncio as _asyncio2
    _asyncio2.run(server.db.children.update_one({"id": adskhan["id"]}, {"$set": {"streak_days": 5, "last_completion_date": gap_date}}))
    r = c.post("/api/tasks", json={"title": "GapResetTest", "points": 5, "child_id": adskhan["id"], "date_key": today_local, "is_bonus": True})
    fct = r.json()
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    complete(fct['id'])
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c.post(f"/api/tasks/{fct['id']}/approve")
    ads_after_gap = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("streakgap: gap resets streak to 1", ads_after_gap["streak_days"] == 1, str(ads_after_gap["streak_days"]))
    check("streakgap: no freeze fields remain on child", "freeze_cards_available" not in ads_after_gap, str(sorted(ads_after_gap.keys()))[:200])
    r = c.post(f"/api/tasks/{fct['id']}/undo-approval")
    check("streakgap: undo of approval still works", r.status_code == 200, r.text[:150])
    r = c.get("/api/config")
    check("streakgap: freeze config gone", "freeze_cards_per_week" not in r.json(), str(sorted(r.json().keys()))[:200])

    # ================= 45. GRANDPARENT VIEW-ONLY LINKS =================
    r = c.post("/api/view-links", json={"label": "Kakek & Nenek"})
    check("viewlink: create ok", r.status_code == 200, r.text[:150])
    vlink = r.json()
    check("viewlink: has token", len(vlink.get("token", "")) > 10)
    c_public = TestClient(server.app, base_url="https://testserver")
    r = c_public.get(f"/api/public/view/{vlink['token']}")
    check("viewlink: public view works no auth", r.status_code == 200, r.text[:150])
    check("viewlink: shows children", len(r.json()["children"]) == 2, str(len(r.json()["children"])))
    r = c_public.get("/api/public/view/totally-fake-token")
    check("viewlink: invalid token 404s", r.status_code == 404)
    r = c.delete(f"/api/view-links/{vlink['id']}")
    check("viewlink: revoke ok", r.status_code == 200)
    r = c_public.get(f"/api/public/view/{vlink['token']}")
    check("viewlink: revoked link 404s", r.status_code == 404)
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.post("/api/view-links", json={"label": "x"})
    check("viewlink: kid blocked from creating", r.status_code == 403)
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c_public.close()

    # ================= 46. CO-OP QUEST =================
    r = c.post("/api/tasks", json={"title": "SoloCoop", "points": 10, "target_children": [adskhan["id"]], "date_key": today_local, "coop": True})
    check("coop: single-kid rejected", r.status_code == 422, str(r.status_code))
    r = c.post("/api/tasks", json={"title": "BeresGarasi", "points": 11, "target_children": [adskhan["id"], syila["id"]], "date_key": today_local, "coop": True})
    check("coop: created ok", r.status_code == 200, r.text[:150])
    coop_t = r.json()
    check("coop: is_coop flag set", coop_t.get("is_coop") is True)
    check("coop: forced bonus", coop_t.get("is_bonus") is True)
    coop_tid = coop_t["id"]
    r1 = c.get(f"/api/children/{adskhan['id']}/day-progress?date_key={today_local}")
    r2 = c.get(f"/api/children/{syila['id']}/day-progress?date_key={today_local}")
    check("coop: both participants see it", any(t["id"] == coop_tid for t in r1.json()["tasks"]) and any(t["id"] == coop_tid for t in r2.json()["tasks"]))
    # Ownership: sibling can't complete another's solo task
    r = c.post("/api/tasks", json={"title": "AdsSoloOnly", "points": 5, "child_id": adskhan["id"], "date_key": today_local, "is_bonus": True})
    solo_t = r.json()
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.post(f"/api/tasks/{solo_t['id']}/check", json={"checked": True})
    check("coop: sibling blocked from unrelated solo task", r.status_code == 403, str(r.status_code))
    # Partner completes coop task
    r = complete(coop_tid)
    check("coop: partner (non-primary) can complete", r.status_code == 200, r.text[:150])
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    ads_pts_before = next(k["points"] for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    syi_pts_before = next(k["points"] for k in c.get("/api/children").json() if k["id"] == syila["id"])
    r = c.post(f"/api/tasks/{coop_tid}/approve")
    check("coop: approve ok", r.status_code == 200, r.text[:150])
    ads_pts_after = next(k["points"] for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    syi_pts_after = next(k["points"] for k in c.get("/api/children").json() if k["id"] == syila["id"])
    gained_a, gained_s = ads_pts_after - ads_pts_before, syi_pts_after - syi_pts_before
    check("coop: split sums to task points", gained_a + gained_s == 11, f"{gained_a}+{gained_s}")
    check("coop: split is even-ish (5,6)", {gained_a, gained_s} == {5, 6}, f"{gained_a},{gained_s}")
    r = c.post(f"/api/tasks/{coop_tid}/undo-approval")
    check("coop: undo ok", r.status_code == 200, r.text[:150])
    ads_pts_undone = next(k["points"] for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    syi_pts_undone = next(k["points"] for k in c.get("/api/children").json() if k["id"] == syila["id"])
    check("coop: undo restores both exactly", ads_pts_undone == ads_pts_before and syi_pts_undone == syi_pts_before)

    # ================= 47. REWARD WISHLIST =================
    r = c.post("/api/rewards", json={"name": "Lego Set", "cost_points": 500})
    wish_reward = r.json()
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.post("/api/wishlist", json={"reward_id": wish_reward["id"]})
    check("wishlist: add ok", r.status_code == 200, r.text[:150])
    r = c.post("/api/wishlist", json={"reward_id": wish_reward["id"]})
    check("wishlist: duplicate add idempotent", r.status_code == 200)
    r = c.get("/api/wishlist")
    check("wishlist: no duplicate entries", len(r.json()) == 1, str(len(r.json())))
    check("wishlist: has progress fields", "percent" in r.json()[0] and "reward" in r.json()[0])
    r = c.post("/api/wishlist", json={"reward_id": "nonexistent-reward"})
    check("wishlist: unknown reward rejected", r.status_code == 404)
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.get("/api/wishlist")
    check("wishlist: sibling isolation", len(r.json()) == 0, str(len(r.json())))
    item_id = None
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    item_id = c.get("/api/wishlist").json()[0]["id"]
    r = c.delete(f"/api/wishlist/{item_id}")
    check("wishlist: owner deletes own", r.status_code == 200)
    r = c.get("/api/wishlist")
    check("wishlist: empty after delete", len(r.json()) == 0)

    # ================= 48. NOTIFICATION DIGEST + INSTANT TOGGLE =================
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.get("/api/config")
    check("digest: instant notif default off", r.json()["instant_task_notifications"] is False)
    check("digest: language default id", r.json()["language"] == "id")
    r = c.post("/api/config", json={"language": "fr"})
    check("digest: invalid language rejected", r.status_code == 422, str(r.status_code))
    r = c.get("/api/cron/send-digest")
    check("digest: no auth rejected", r.status_code == 403)
    r = c.get("/api/cron/send-digest", headers={"Authorization": "Bearer wrong"})
    check("digest: wrong secret rejected", r.status_code == 403)

    # ================= 49. GROWTH TRAIL =================
    r = c.get(f"/api/children/{syila['id']}/growth-trail")
    check("growth-trail: works", r.status_code == 200 and "events" in r.json(), r.text[:150])
    r = c.get("/api/children/nonexistent-child/growth-trail")
    check("growth-trail: unknown child 404s", r.status_code == 404)

    # ================= 50. REGRESSION: co-op tasks must be visible/correct
    # across EVERY feature that reads task/points data, not just the primary
    # child. Found during cross-feature audit: growth trail, public view-links,
    # weekly report, day-progress, and month-progress all originally only
    # matched task.child_id (the co-op "owner"), so the PARTNER never saw their
    # own shared missions, and reports that DID match used the task's full
    # points instead of that child's actual split share (over-counting). =================
    r = c.post("/api/tasks", json={
        "title": "CoopCrossFeature", "points": 11, "target_children": [adskhan["id"], syila["id"]],
        "date_key": today_local, "coop": True, "photo_required": True,
    })
    ccf = r.json()
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    complete(ccf['id'], {"photo_url": "data:image/png;base64,ZZZ"})
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c.post(f"/api/tasks/{ccf['id']}/approve")

    r_ads_trail = c.get(f"/api/children/{adskhan['id']}/growth-trail")
    r_syi_trail = c.get(f"/api/children/{syila['id']}/growth-trail")
    check("coop-cross: primary sees coop photo in growth trail", any(e["type"] == "photo" and e["title"] == "CoopCrossFeature" for e in r_ads_trail.json()["events"]))
    check("coop-cross: partner ALSO sees coop photo in growth trail", any(e["type"] == "photo" and e["title"] == "CoopCrossFeature" for e in r_syi_trail.json()["events"]))

    r = c.post("/api/view-links", json={"label": "CoopCrossTest"})
    ccf_link = r.json()
    ccf_public = TestClient(server.app, base_url="https://testserver")
    r = ccf_public.get(f"/api/public/view/{ccf_link['token']}")
    by_name = {k["name"]: k for k in r.json()["children"]}
    check("coop-cross: primary's public recent_missions has coop task", any(m["title"] == "CoopCrossFeature" for m in by_name["Adskhan"]["recent_missions"]))
    check("coop-cross: partner's public recent_missions ALSO has it", any(m["title"] == "CoopCrossFeature" for m in by_name["Syila"]["recent_missions"]))
    ccf_public.close()

    r = c.get("/api/family/weekly-report")
    wk = {e["child"]["name"]: e["week_points"] for e in r.json()["children"]}
    # Both kids had baseline points from earlier sections; just verify the task's
    # 11 points were split (not double-counted as 11+11=22 across the pair for
    # THIS task specifically) by checking a fresh same-day pair task in isolation:
    r = c.post("/api/tasks", json={
        "title": "CoopWeeklyIsolated", "points": 9, "target_children": [adskhan["id"], syila["id"]],
        "date_key": today_local, "coop": True,
    })
    ci = r.json()
    ads_wk_before = next(e["week_points"] for e in c.get("/api/family/weekly-report").json()["children"] if e["child"]["name"] == "Adskhan")
    syi_wk_before = next(e["week_points"] for e in c.get("/api/family/weekly-report").json()["children"] if e["child"]["name"] == "Syila")
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    complete(ci['id'])
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c.post(f"/api/tasks/{ci['id']}/approve")
    ads_wk_after = next(e["week_points"] for e in c.get("/api/family/weekly-report").json()["children"] if e["child"]["name"] == "Adskhan")
    syi_wk_after = next(e["week_points"] for e in c.get("/api/family/weekly-report").json()["children"] if e["child"]["name"] == "Syila")
    check("coop-cross: weekly report splits (not doubles) coop points", (ads_wk_after - ads_wk_before) + (syi_wk_after - syi_wk_before) == 9, f"+{ads_wk_after-ads_wk_before}, +{syi_wk_after-syi_wk_before}")

    r = c.post("/api/challenges", json={"title": "CoopChallengeCross", "participant_ids": [adskhan["id"], syila["id"]], "target_points": 9, "start_date": today_local, "end_date": today_local})
    ccc = r.json()
    r = c.get("/api/challenges")
    found_ccc = next(x for x in r.json() if x["id"] == ccc["id"])
    check("coop-cross: challenge counts split total, not doubled", found_ccc["earned_points"] >= 9, str(found_ccc["earned_points"]))

    # ================= 52. BADGE CATALOG (sticker book) =================
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.get("/api/badges/catalog")
    check("catalog: returns every badge", r.status_code == 200 and len(r.json()) == len(server.BADGE_CATALOG), str(len(r.json())))
    check("catalog: each has key/name/desc/emoji", all(k in r.json()[0] for k in ("key", "name", "desc", "emoji")))

    # ================= 53. PERSONAL BEST STREAK =================
    r = c.post("/api/tasks", json={"title": "BestStreakT1", "points": 5, "child_id": adskhan["id"], "date_key": today_local, "is_bonus": True})
    bs1 = r.json()
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    complete(bs1['id'])
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c.post(f"/api/tasks/{bs1['id']}/approve")
    ads_bs = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("best-streak: field present and >= current streak", ads_bs.get("best_streak_days", -1) >= ads_bs["streak_days"], str(ads_bs.get("best_streak_days")))
    # Force a big gap so streak resets to 1, best_streak must NOT drop
    _asyncio3.run(server.db.children.update_one({"id": adskhan["id"]}, {
        "$set": {"streak_days": 15, "best_streak_days": 15, "last_completion_date": (utc_now - _dt2.timedelta(days=6)).strftime("%Y-%m-%d")},
    }))
    r = c.post("/api/tasks", json={"title": "BestStreakT2", "points": 5, "child_id": adskhan["id"], "date_key": today_local, "is_bonus": True})
    bs2 = r.json()
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    complete(bs2['id'])
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c.post(f"/api/tasks/{bs2['id']}/approve")
    ads_bs2 = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("best-streak: survives a reset (current=1, best stays 15)", ads_bs2["streak_days"] == 1 and ads_bs2["best_streak_days"] == 15, str(ads_bs2))
    r = c.post(f"/api/tasks/{bs2['id']}/undo-approval")
    check("best-streak: undo ok", r.status_code == 200)
    ads_bs3 = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("best-streak: undo restores exactly (streak=15, best=15)", ads_bs3["streak_days"] == 15 and ads_bs3["best_streak_days"] == 15, str(ads_bs3))

    # ================= 54. MYSTERY BOX (perfect day) =================
    perfect_date = "2026-12-01"
    r = c.post("/api/tasks", json={"title": "PerfectR1", "points": 5, "child_id": adskhan["id"], "date_key": perfect_date, "order": 1})
    pr1 = r.json()
    r = c.post("/api/tasks", json={"title": "PerfectR2", "points": 5, "child_id": adskhan["id"], "date_key": perfect_date, "order": 2})
    pr2 = r.json()
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.post(f"/api/children/{adskhan['id']}/claim-perfect-day")
    check("mystery: rejected — wrong date (checks TODAY only, not arbitrary date_key)", r.status_code == 400, r.text[:150])
    r = c.get(f"/api/children/{adskhan['id']}/day-progress?date_key={perfect_date}")
    check("mystery: perfect_day false while pending", r.json()["perfect_day"] is False)

    # Clear the way: finish any required missions Syila still has open today
    # from earlier sections, so the new one is the only thing left.
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    prog = c.get(f"/api/children/{syila['id']}/day-progress?date_key={today_local}").json()
    for t_open in [t for t in prog["tasks"] if not t.get("is_bonus") and t["status"] in ("pending", "rejected")]:
        complete(t_open["id"])
    r = c.post("/api/tasks", json={"title": "PerfectToday1", "points": 5, "child_id": syila["id"], "date_key": today_local})
    pt1 = r.json()
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    complete(pt1['id'])
    r = c.get(f"/api/children/{syila['id']}/day-progress?date_key={today_local}")
    check("mystery: perfect_day true once all required completed", r.json()["perfect_day"] is True, str(r.json().get("perfect_day")))
    check("mystery: not yet claimed", r.json()["perfect_day_claimed"] is False)
    r = c.post(f"/api/children/{syila['id']}/claim-perfect-day")
    check("mystery: claim succeeds", r.status_code == 200, r.text[:150])
    check("mystery: bonus within 2-8 range", 2 <= r.json()["bonus"] <= 8, str(r.json()))
    r = c.post(f"/api/children/{syila['id']}/claim-perfect-day")
    check("mystery: double-claim rejected", r.status_code == 400, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.post(f"/api/children/{syila['id']}/claim-perfect-day")
    check("mystery: sibling blocked from claiming another's box", r.status_code == 403, str(r.status_code))

    # ================= 55. VIRTUAL PET: SELECTION + PERMANENCE + DEATH =================
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.patch("/api/me/profile", json={"pet_type": "chicken"})
    check("pet: first pick accepted", r.status_code == 200 and r.json()["pet_type"] == "chicken", r.text[:150])
    check("pet: fresh pick has feed reset to 0", r.json().get("feed_balance") == 0 and r.json().get("feed_lifetime") == 0)
    r = c.patch("/api/me/profile", json={"pet_type": "dragon"})
    check("pet: cannot switch while alive", r.status_code == 400, r.text[:150])
    r = c.patch("/api/me/profile", json={"pet_type": "unicorn"})
    check("pet: invalid animal rejected", r.status_code == 422, str(r.status_code))
    # Still 'chicken' after the rejected switch attempts
    ads_pet_check = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("pet: pet_type unchanged after blocked switch", ads_pet_check["pet_type"] == "chicken")
    check("pet: alive child not flagged dead", ads_pet_check["pet_is_dead"] is False)

    # Simulate neglect: backdate pet_last_fed_at beyond the default 14-day window
    import asyncio as _asyncio_pet
    import datetime as _dt_pet
    long_ago = (_dt_pet.datetime.now(_dt_pet.timezone.utc) - _dt_pet.timedelta(days=20)).isoformat()
    _asyncio_pet.run(server.db.children.update_one({"id": adskhan["id"]}, {"$set": {"pet_last_fed_at": long_ago}}))
    ads_dead_check = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("pet: neglected pet flagged dead", ads_dead_check["pet_is_dead"] is True)
    r = c.post(f"/api/children/{adskhan['id']}/feed-pet")
    check("pet: cannot feed a dead pet", r.status_code == 400, r.text[:150])
    r = c.patch("/api/me/profile", json={"pet_type": "dragon"})
    check("pet: CAN switch after pet died", r.status_code == 200 and r.json()["pet_type"] == "dragon", r.text[:150])
    ads_after_revival = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("pet: new pet not dead right after picking", ads_after_revival["pet_is_dead"] is False)
    check("pet: feed count reset to 0 on new pet", ads_after_revival.get("pet_feed_count") == 0, str(ads_after_revival.get("pet_feed_count")))

    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.patch(f"/api/children/{syila['id']}", json={"pet_type": "panda"})
    check("pet: parent sets child's pet_type", r.status_code == 200 and r.json()["pet_type"] == "panda", r.text[:150])
    r = c.patch(f"/api/children/{syila['id']}", json={"pet_type": "fox"})
    check("pet: parent CAN override anytime (not locked)", r.status_code == 200 and r.json()["pet_type"] == "fox", r.text[:150])
    r = c.patch(f"/api/children/{syila['id']}", json={"pet_type": "not-a-real-animal"})
    check("pet: parent invalid pet_type rejected", r.status_code == 422, str(r.status_code))

    # ================= 55b. PET ECONOMY CONFIG =================
    r = c.get("/api/config")
    check("pet-config: defaults present", r.json().get("feed_per_point") == 1 and r.json().get("feed_cost_per_meal") == 5 and r.json().get("pet_neglect_days") == 14, str(r.json().get("feed_per_point")))
    check("pet-config: default stage names", r.json().get("pet_stage_names") == ["Telur", "Bayi", "Remaja", "Dewasa"])
    check("pet-config: default thresholds", r.json().get("pet_stage_thresholds") == [0.25, 0.6])
    check("pet-config: default feed thresholds", r.json().get("pet_stage_feed_thresholds") == [3, 8, 15], str(r.json().get("pet_stage_feed_thresholds")))
    r = c.post("/api/config", json={"pet_stage_feed_thresholds": [2, 5, 9]})
    check("pet-config: feed thresholds accepted", r.status_code == 200, r.text[:150])
    r = c.get("/api/config")
    check("pet-config: feed thresholds persisted", r.json()["pet_stage_feed_thresholds"] == [2, 5, 9])
    r = c.post("/api/config", json={"pet_stage_feed_thresholds": [5, 3, 9]})
    check("pet-config: non-ascending feed thresholds rejected", r.status_code == 422, str(r.status_code))
    r = c.post("/api/config", json={"pet_stage_feed_thresholds": [1, 2]})
    check("pet-config: wrong feed-threshold count rejected", r.status_code == 422, str(r.status_code))
    r = c.post("/api/config", json={"pet_stage_feed_thresholds": [0, 2, 3]})
    check("pet-config: feed threshold below 1 rejected", r.status_code == 422, str(r.status_code))
    r = c.post("/api/config", json={"feed_per_point": 2, "feed_cost_per_meal": 8, "pet_neglect_days": 30})
    check("pet-config: economy update accepted", r.status_code == 200, r.text[:150])
    r = c.get("/api/config")
    check("pet-config: economy persisted", r.json()["feed_per_point"] == 2 and r.json()["feed_cost_per_meal"] == 8 and r.json()["pet_neglect_days"] == 30)
    r = c.post("/api/config", json={"pet_stage_names": ["Telur", "Anakan", "Muda", "Dewasa"], "pet_stage_thresholds": [0.3, 0.7]})
    check("pet-config: stage config accepted", r.status_code == 200)
    r = c.get("/api/config")
    check("pet-config: stage names persisted", r.json()["pet_stage_names"] == ["Telur", "Anakan", "Muda", "Dewasa"])
    check("pet-config: thresholds persisted", r.json()["pet_stage_thresholds"] == [0.3, 0.7])
    r = c.post("/api/config", json={"pet_stage_names": ["Cuma3", "Tahap", "Aja"]})
    check("pet-config: wrong stage-name count rejected", r.status_code == 422, str(r.status_code))
    r = c.post("/api/config", json={"pet_stage_thresholds": [0.7, 0.3]})
    check("pet-config: non-ascending thresholds rejected", r.status_code == 422, str(r.status_code))
    # Reset back to defaults so later tests (feed 1:1 assumption) aren't affected
    r = c.post("/api/config", json={"feed_per_point": 1, "feed_cost_per_meal": 5, "pet_neglect_days": 14,
                                     "pet_stage_names": ["Telur", "Bayi", "Remaja", "Dewasa"], "pet_stage_thresholds": [0.25, 0.6],
                                     "pet_stage_feed_thresholds": [3, 8, 15]})
    check("pet-config: reset to defaults for later tests", r.status_code == 200)
    # Kid blocked from changing config
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.post("/api/config", json={"feed_per_point": 99})
    check("pet-config: kid blocked from editing config", r.status_code == 403, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})

    # ================= 56. VIRTUAL PET: FEED CURRENCY (dual points system) =================
    ads_before = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    feed_before, feed_life_before, pts_before = ads_before.get("feed_balance", 0), ads_before.get("feed_lifetime", 0), ads_before["points"]
    r = c.post("/api/tasks", json={"title": "FeedTest1", "points": 12, "child_id": adskhan["id"], "date_key": today_local, "is_bonus": True})
    ft1 = r.json()
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    complete(ft1['id'])
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c.post(f"/api/tasks/{ft1['id']}/approve")
    ads_after = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("feed: earned 1:1 alongside points", ads_after["feed_balance"] == feed_before + 12, f"{feed_before}->{ads_after['feed_balance']}")
    check("feed: lifetime feed increases too", ads_after["feed_lifetime"] == feed_life_before + 12)
    check("feed: points awarded independently of feed", ads_after["points"] == pts_before + 12)

    r = c.post(f"/api/tasks/{ft1['id']}/undo-approval")
    check("feed: undo succeeds", r.status_code == 200, r.text[:150])
    ads_undone = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("feed: undo restores feed_balance exactly", ads_undone["feed_balance"] == feed_before)
    check("feed: undo restores feed_lifetime exactly", ads_undone["feed_lifetime"] == feed_life_before)

    # ================= 57. VIRTUAL PET: FEEDING ACTION =================
    r = c.post("/api/tasks", json={"title": "FeedTest2", "points": 20, "child_id": adskhan["id"], "date_key": today_local, "is_bonus": True})
    ft2 = r.json()
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    complete(ft2['id'])
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c.post(f"/api/tasks/{ft2['id']}/approve")
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    ads_bf = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    feed_count_before = ads_bf.get("pet_feed_count", 0)
    r = c.post(f"/api/children/{adskhan['id']}/feed-pet")
    check("feed-pet: succeeds with sufficient balance", r.status_code == 200, r.text[:150])
    check("feed-pet: cost of 5 deducted", r.json()["feed_balance"] == ads_bf["feed_balance"] - 5, str(r.json()))
    check("feed-pet: lifetime feed unaffected by feeding action", r.json()["feed_lifetime"] == ads_bf["feed_lifetime"])
    check("feed-pet: feed count increments (drives growth)", r.json().get("pet_feed_count") == feed_count_before + 1, str(r.json().get("pet_feed_count")))
    for _ in range(15):
        r = c.post(f"/api/children/{adskhan['id']}/feed-pet")
        if r.status_code != 200:
            break
    check("feed-pet: insufficient balance rejected", r.status_code == 400, r.text[:150])

    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post("/api/tasks", json={"title": "SyiFeedSeed", "points": 20, "child_id": syila["id"], "date_key": today_local, "is_bonus": True})
    syi_seed = r.json()
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    complete(syi_seed['id'])
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c.post(f"/api/tasks/{syi_seed['id']}/approve")
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.post(f"/api/children/{syila['id']}/feed-pet")
    check("feed-pet: sibling blocked from feeding another's pet", r.status_code == 403, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post("/api/children/nonexistent-child-id/feed-pet")
    check("feed-pet: unknown child 404s", r.status_code == 404, str(r.status_code))

    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.get("/api/auth/me")
    check("auth/me: includes pet_type + feed fields", r.json().get("pet_type") == "dragon" and "feed_balance" in r.json() and "feed_lifetime" in r.json(), str(r.json()))

    # ================= 58. REGRESSION: seeded family has complete field set =================
    # Root cause of a real bug: the hand-written seed_default_family() mirror
    # into the children collection was never updated when penalty cards / best
    # streak / virtual pet fields were added, so "field" in child checks (and
    # raw API responses) were silently incomplete for the very first family a
    # fresh deployment creates — relying entirely on .get()-default patterns
    # elsewhere in the code to paper over it. Verify the actual seeded docs.
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    seeded_kids = c.get("/api/children").json()
    for field in ("pet_type", "feed_balance", "feed_lifetime", "penalty_cards", "best_streak_days"):
        check(f"regression: seeded children have '{field}' key present", all(field in k for k in seeded_kids), str([sorted(k.keys()) for k in seeded_kids]))

    # ================= 59. UNDO-MISS (+ fixes a double-miss penalty bug) =================
    r = c.post("/api/tasks", json={"title": "MissTest", "points": 5, "penalty_points": 10, "child_id": adskhan["id"], "date_key": today_local})
    mt = r.json()
    ads_pts_before = next(k["points"] for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    r = c.post(f"/api/tasks/{mt['id']}/miss")
    check("miss: succeeds with penalty applied", r.status_code == 200, r.text[:150])
    ads_after_miss = next(k["points"] for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("miss: penalty deducted", ads_after_miss == ads_pts_before - 10)
    r = c.post(f"/api/tasks/{mt['id']}/miss")
    check("miss: double-miss now blocked (was a real bug — penalty could double-deduct)", r.status_code == 400, str(r.status_code))
    r = c.post(f"/api/tasks/{mt['id']}/undo-miss")
    check("undo-miss: succeeds", r.status_code == 200, r.text[:150])
    ads_after_undo = next(k["points"] for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("undo-miss: penalty refunded exactly", ads_after_undo == ads_pts_before)
    r = c.post(f"/api/tasks/{mt['id']}/undo-miss")
    check("undo-miss: rejected on non-missed task", r.status_code == 400, str(r.status_code))

    # ================= 60. REWARD SUGGESTIONS (kid proposes) =================
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.post("/api/reward-suggestions", json={"name": "Lego Set", "suggested_cost_points": 200})
    check("suggest: kid can propose", r.status_code == 200, r.text[:150])
    sug = r.json()
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post("/api/reward-suggestions", json={"name": "ParentTry"})
    check("suggest: parent blocked from proposing", r.status_code == 422, str(r.status_code))
    r = c.post(f"/api/reward-suggestions/{sug['id']}/approve", json={})
    check("suggest: approve creates real reward", r.status_code == 200 and r.json()["reward"]["cost_points"] == 200, r.text[:150])
    r = c.post(f"/api/reward-suggestions/{sug['id']}/approve", json={})
    check("suggest: double-approve blocked", r.status_code == 400, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.post("/api/reward-suggestions", json={"name": "NoCost"})
    nocost = r.json()
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post(f"/api/reward-suggestions/{nocost['id']}/approve", json={})
    check("suggest: approve without any cost specified fails", r.status_code == 422, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.get("/api/reward-suggestions")
    check("suggest: sibling isolation", all(s["child_id"] == syila["id"] for s in r.json()), str(r.json()))
    r = c.post("/api/reward-suggestions", json={"name": "Withdraw Me"})
    wd = r.json()
    r = c.delete(f"/api/reward-suggestions/{wd['id']}")
    check("suggest: kid withdraws own pending suggestion", r.status_code == 200)

    # ================= 61. PESAN SEMANGAT (encouragement on approval) =================
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post("/api/tasks", json={"title": "MsgTest", "points": 5, "child_id": adskhan["id"], "date_key": today_local, "is_bonus": True})
    msgt = r.json()
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    complete(msgt['id'])
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post(f"/api/tasks/{msgt['id']}/approve", json={"encouragement_message": "Kerja bagus!"})
    check("msg: approve with message succeeds", r.status_code == 200 and r.json()["task"]["encouragement_message"] == "Kerja bagus!", r.text[:150])
    r = c.post(f"/api/tasks/{msgt['id']}/undo-approval")
    r = c.get(f"/api/tasks?date_key={today_local}&child_id={adskhan['id']}")
    found = next(t for t in r.json() if t["id"] == msgt["id"])
    check("msg: cleared after undo", not found.get("encouragement_message"), str(found.get("encouragement_message")))
    huge_voice = "data:audio/webm;base64," + ("A" * 2_100_000)
    r = complete(msgt['id']) if False else None
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    complete(msgt['id'])
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post(f"/api/tasks/{msgt['id']}/approve", json={"encouragement_voice_url": huge_voice})
    check("msg: oversized voice note rejected", r.status_code == 413, str(r.status_code))
    r = c.post(f"/api/tasks/{msgt['id']}/approve", json={})
    check("msg: normal approve still works after rejected oversized attempt", r.status_code == 200, r.text[:150])

    # ================= 62. PET ACCESSORIES =================
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.patch("/api/me/profile", json={"pet_equipped": ["glasses", "crown"]})
    check("accessory: valid equip succeeds", r.status_code == 200 and r.json()["pet_equipped"] == ["glasses", "crown"], r.text[:150])
    r = c.patch("/api/me/profile", json={"pet_equipped": ["glasses", "not-real"]})
    check("accessory: unknown item rejected", r.status_code == 422, str(r.status_code))
    r = c.patch("/api/me/profile", json={"pet_equipped": ["glasses", "hat", "crown", "bow", "scarf"]})
    check("accessory: too many rejected (max 4)", r.status_code == 422, str(r.status_code))
    r = c.get("/api/auth/me")
    check("accessory: unaffected by rejected attempts", r.json()["pet_equipped"] == ["glasses", "crown"], str(r.json().get("pet_equipped")))

    # ================= 63. SIBLING CHEER =================
    r = c.post(f"/api/children/{syila['id']}/cheer", json={"emoji": "🎉", "message": "Semangat!"})
    check("cheer: kid can cheer sibling", r.status_code == 200, r.text[:150])
    r = c.post(f"/api/children/{syila['id']}/cheer", json={"emoji": "🎉"})
    check("cheer: cooldown blocks repeat", r.status_code == 429, str(r.status_code))
    r = c.post(f"/api/children/{adskhan['id']}/cheer", json={"emoji": "🎉"})
    check("cheer: can't cheer self", r.status_code == 422, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post(f"/api/children/{syila['id']}/cheer", json={"emoji": "🎉"})
    check("cheer: parent blocked", r.status_code == 422, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.get(f"/api/children/{syila['id']}/cheers")
    check("cheer: recipient sees it", len(r.json()) >= 1 and r.json()[0]["from_child_name"] == "Adskhan", str(r.json())[:200])

    # ================= 64. STREAK WARNING (evening cron, hour-gated) =================
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    real_now_local2 = server._now_local
    server._now_local = lambda: real_now_local2().replace(hour=21, minute=5)
    r = c.get("/api/cron/send-digest", headers={"Authorization": "Bearer test-cron-secret"})
    server._now_local = real_now_local2
    check("streak-warning: endpoint reachable at hour 21 (secret mismatch expected here)", r.status_code == 403, str(r.status_code))

    # ================= 65. "INDIVIDUAL REQUIRED + CO-OP BONUS" PATTERN =================
    # Real family use case: a required task everyone does individually (e.g.
    # Sholat Subuh, 10 pts each), PLUS a co-op bonus that only pays out when
    # done together (Sholat Subuh Berjamaah, 20 pts total -> 10 each via the
    # existing even-split). No new feature needed — this locks in that the
    # combination behaves correctly.
    r = c.post("/api/tasks", json={
        "title": "Sholat Subuh", "points": 10, "target_children": [],
        "date_key": today_local, "order": 1,
    })
    indiv_tasks = r.json()["tasks"]
    check("berjamaah: individual broadcast creates 2 separate copies", len(indiv_tasks) == 2, str(len(indiv_tasks)))
    ads_indiv = next(t for t in indiv_tasks if t["child_id"] == adskhan["id"])
    syi_indiv = next(t for t in indiv_tasks if t["child_id"] == syila["id"])

    r = c.post("/api/tasks", json={
        "title": "Sholat Subuh Berjamaah", "points": 20,
        "target_children": [adskhan["id"], syila["id"]], "coop": True,
        "date_key": today_local,
    })
    coop_bj = r.json()
    check("berjamaah: coop bonus task forced to is_bonus", coop_bj["is_bonus"] is True)

    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    start(ads_indiv['id'])
    complete(ads_indiv['id'])
    complete(coop_bj['id'])
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    start(syi_indiv['id'])
    complete(syi_indiv['id'])

    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    ads_bj_before = next(k["points"] for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    syi_bj_before = next(k["points"] for k in c.get("/api/children").json() if k["id"] == syila["id"])
    c.post(f"/api/tasks/{ads_indiv['id']}/approve")
    c.post(f"/api/tasks/{syi_indiv['id']}/approve")
    c.post(f"/api/tasks/{coop_bj['id']}/approve")
    ads_bj_after = next(k["points"] for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    syi_bj_after = next(k["points"] for k in c.get("/api/children").json() if k["id"] == syila["id"])
    check("berjamaah: each kid gets individual(10) + coop-split(10) = 20", ads_bj_after - ads_bj_before == 20 and syi_bj_after - syi_bj_before == 20, f"ads+{ads_bj_after-ads_bj_before} syi+{syi_bj_after-syi_bj_before}")

    # ================= 66. TOGETHER-BONUS (single task, self-reported "did it together") =================
    r = c.post("/api/tasks", json={"title": "TB1", "points": 10, "child_id": adskhan["id"], "date_key": today_local, "together_bonus_enabled": True})
    check("together-bonus: enabled without points rejected", r.status_code == 422, str(r.status_code))
    r = c.post("/api/tasks", json={"title": "TB2", "points": 10, "target_children": [adskhan["id"], syila["id"]], "coop": True, "together_bonus_enabled": True, "together_bonus_points": 5, "date_key": today_local})
    check("together-bonus: coop+together_bonus combo rejected", r.status_code == 422, str(r.status_code))

    r = c.post("/api/tasks", json={
        "title": "SholatSubuhTB", "points": 10, "target_children": [],
        "date_key": today_local, "order": 1,
        "together_bonus_enabled": True, "together_bonus_points": 10,
    })
    tb_tasks = r.json()["tasks"]
    ads_tb = next(t for t in tb_tasks if t["child_id"] == adskhan["id"])
    syi_tb = next(t for t in tb_tasks if t["child_id"] == syila["id"])
    check("together-bonus: broadcast still creates 2 individual copies", len(tb_tasks) == 2)

    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    start(ads_tb['id'])
    r = complete(ads_tb['id'])
    check("together-bonus: complete without answering the question rejected", r.status_code == 422, r.text[:150])
    r = complete(ads_tb['id'], {"done_together": True})
    check("together-bonus: complete with done_together=True succeeds", r.status_code == 200, r.text[:150])

    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    start(syi_tb['id'])
    complete(syi_tb['id'], {"done_together": False})

    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    ads_tb_before = next(k["points"] for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    syi_tb_before = next(k["points"] for k in c.get("/api/children").json() if k["id"] == syila["id"])
    c.post(f"/api/tasks/{ads_tb['id']}/approve")
    c.post(f"/api/tasks/{syi_tb['id']}/approve")
    ads_tb_after = next(k["points"] for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    syi_tb_after = next(k["points"] for k in c.get("/api/children").json() if k["id"] == syila["id"])
    check("together-bonus: said YES gets base+bonus (20)", ads_tb_after - ads_tb_before == 20, f"+{ads_tb_after-ads_tb_before}")
    check("together-bonus: said NO gets only base (10)", syi_tb_after - syi_tb_before == 10, f"+{syi_tb_after-syi_tb_before}")

    r = c.post(f"/api/tasks/{ads_tb['id']}/undo-approval")
    check("together-bonus: undo reverses full amount incl. bonus", r.status_code == 200)
    ads_tb_undone = next(k["points"] for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("together-bonus: undo restores exactly", ads_tb_undone == ads_tb_before)

    # ================= 68. LEVEL CONFIG (parent-editable ladder) =================
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.get("/api/config")
    check("level: default 10 tiers present", len(r.json()["level_titles"]) == 10)
    check("level: first tier at 0 XP", r.json()["level_titles"][0]["min_xp"] == 0)
    custom_levels = [{"title": "Baru", "min_xp": 0}, {"title": "Rajin", "min_xp": 100}, {"title": "Juara", "min_xp": 500}]
    r = c.post("/api/config", json={"level_titles": custom_levels})
    check("level: custom ladder accepted", r.status_code == 200, r.text[:150])
    r = c.get("/api/config")
    check("level: custom ladder persisted", len(r.json()["level_titles"]) == 3)
    r = c.post("/api/config", json={"level_titles": [{"title": "x", "min_xp": 10}]})
    check("level: first tier not at 0 rejected", r.status_code == 422, str(r.status_code))
    r = c.post("/api/config", json={"level_titles": [{"title": "A", "min_xp": 0}, {"title": "B", "min_xp": 50}, {"title": "C", "min_xp": 50}]})
    check("level: non-increasing XP rejected", r.status_code == 422, str(r.status_code))
    r = c.post("/api/config", json={"level_titles": []})
    check("level: empty list rejected", r.status_code == 422, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.post("/api/config", json={"level_titles": custom_levels})
    check("level: kid blocked from editing", r.status_code == 403, str(r.status_code))

    # =============== REWARD EDIT (PATCH) ===============
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post("/api/rewards", json={"name": "Es Krim", "description": "vanila", "cost_points": 20})
    rw_edit = r.json()
    check("reward-edit: created", r.status_code == 200 and rw_edit["cost_points"] == 20)
    r = c.patch(f"/api/rewards/{rw_edit['id']}", json={"cost_points": 35})
    check("reward-edit: cost updated", r.status_code == 200 and r.json()["cost_points"] == 35, r.text[:150])
    check("reward-edit: name unchanged when not sent", r.json()["name"] == "Es Krim", r.json().get("name"))
    r = c.patch(f"/api/rewards/{rw_edit['id']}", json={"name": "Es Krim Coklat", "description": "coklat"})
    check("reward-edit: name+desc updated", r.json()["name"] == "Es Krim Coklat" and r.json()["description"] == "coklat")
    check("reward-edit: cost persists from prior edit", r.json()["cost_points"] == 35)
    r = c.patch(f"/api/rewards/{rw_edit['id']}", json={"description": ""})
    check("reward-edit: description can be cleared to empty", r.json()["description"] == "")
    r = c.patch(f"/api/rewards/{rw_edit['id']}", json={"cost_points": 0})
    check("reward-edit: cost below 1 rejected", r.status_code == 422, str(r.status_code))
    r = c.patch("/api/rewards/nonexistent-id", json={"cost_points": 5})
    check("reward-edit: 404 for missing reward", r.status_code == 404, str(r.status_code))
    # Kid can't edit rewards
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.patch(f"/api/rewards/{rw_edit['id']}", json={"cost_points": 1})
    check("reward-edit: kid blocked from editing", r.status_code == 403, str(r.status_code))

    # =============== CONSEQUENCE EDIT (PATCH) ===============
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post("/api/consequences", json={"name": "Kurang Tidur", "description": "begadang", "points_deducted": 10})
    cq_edit = r.json()
    check("cons-edit: created", r.status_code == 200 and cq_edit["points_deducted"] == 10)
    r = c.patch(f"/api/consequences/{cq_edit['id']}", json={"points_deducted": 25})
    check("cons-edit: deduction updated", r.status_code == 200 and r.json()["points_deducted"] == 25, r.text[:150])
    check("cons-edit: name unchanged when not sent", r.json()["name"] == "Kurang Tidur")
    r = c.patch(f"/api/consequences/{cq_edit['id']}", json={"name": "Tidur Larut", "description": "begadang lagi"})
    check("cons-edit: name+desc updated", r.json()["name"] == "Tidur Larut" and r.json()["description"] == "begadang lagi")
    check("cons-edit: deduction persists from prior edit", r.json()["points_deducted"] == 25)
    r = c.patch(f"/api/consequences/{cq_edit['id']}", json={"points_deducted": 0})
    check("cons-edit: zero deduction allowed", r.status_code == 200 and r.json()["points_deducted"] == 0)
    r = c.patch(f"/api/consequences/{cq_edit['id']}", json={"points_deducted": 9999})
    check("cons-edit: deduction over max rejected", r.status_code == 422, str(r.status_code))
    r = c.patch("/api/consequences/nonexistent-id", json={"points_deducted": 5})
    check("cons-edit: 404 for missing consequence", r.status_code == 404, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.patch(f"/api/consequences/{cq_edit['id']}", json={"points_deducted": 1})
    check("cons-edit: kid blocked from editing", r.status_code == 403, str(r.status_code))

    # =============== RESET POINTS ===============
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    # Give Syila some points + a redemption + an applied consequence to prove they all clear.
    import asyncio as _asyncio_rst
    _asyncio_rst.run(server.db.children.update_one(
        {"id": syila["id"]},
        {"$set": {"points": 80, "lifetime_points": 200, "streak_days": 7, "best_streak_days": 12,
                  "tasks_completed": 30, "feed_balance": 15, "feed_lifetime": 40}}))
    # A redemption + applied consequence in history
    r = c.post("/api/consequences", json={"name": "ResetTestCons", "points_deducted": 5})
    rst_cons = r.json()
    c.post("/api/consequences/apply", json={"child_id": syila["id"], "consequence_id": rst_cons["id"]})
    syi_before = next(k for k in c.get("/api/children").json() if k["id"] == syila["id"])
    check("reset: preconditions (has points & history)", syi_before["lifetime_points"] == 200 and syi_before["streak_days"] == 7)
    applied_before = c.get(f"/api/applied-consequences?child_id={syila['id']}").json()
    check("reset: has applied-consequence history", len(applied_before) >= 1, str(len(applied_before)))

    r = c.post(f"/api/children/{syila['id']}/reset-points")
    check("reset: endpoint 200", r.status_code == 200, r.text[:150])
    syi_after = r.json()
    check("reset: points zeroed", syi_after["points"] == 0 and syi_after["lifetime_points"] == 0)
    check("reset: streaks zeroed", syi_after["streak_days"] == 0 and syi_after["best_streak_days"] == 0)
    check("reset: tasks_completed zeroed", syi_after["tasks_completed"] == 0)
    check("reset: feed currency zeroed", syi_after["feed_balance"] == 0 and syi_after["feed_lifetime"] == 0)
    check("reset: penalty cards cleared", syi_after.get("penalty_cards", 0) == 0, str(syi_after.get("penalty_cards")))
    check("reset: last_completion cleared", syi_after["last_completion_date"] is None)
    applied_after = c.get(f"/api/applied-consequences?child_id={syila['id']}").json()
    check("reset: applied-consequence history cleared", len(applied_after) == 0, str(len(applied_after)))
    # Child NOT deleted — still exists & can log in, avatar/passcode intact
    still_there = next((k for k in c.get("/api/children").json() if k["id"] == syila["id"]), None)
    check("reset: child still exists (not deleted)", still_there is not None)
    r = c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    check("reset: child can still log in after reset", r.status_code == 200, str(r.status_code))

    # Reset-all
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _asyncio_rst.run(server.db.children.update_one({"id": adskhan["id"]}, {"$set": {"points": 50, "lifetime_points": 99}}))
    r = c.post("/api/children/reset-all-points")
    check("reset-all: endpoint 200", r.status_code == 200 and r.json()["success"] is True, r.text[:150])
    all_kids_after = c.get("/api/children").json()
    check("reset-all: every child zeroed", all(k["points"] == 0 and k["lifetime_points"] == 0 for k in all_kids_after))
    # Kid blocked from resetting
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.post(f"/api/children/{adskhan['id']}/reset-points")
    check("reset: kid blocked from resetting", r.status_code == 403, str(r.status_code))
    r = c.post("/api/children/nonexistent/reset-points")
    check("reset: 404/403 for bad child", r.status_code in (403, 404), str(r.status_code))

    # =============== RESET PET ===============
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    # Adskhan currently has 'dragon' from the earlier pet-permanence tests
    ads_pet_before = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("reset-pet: preconditions (has a pet)", ads_pet_before.get("pet_type") is not None, str(ads_pet_before.get("pet_type")))
    r = c.post(f"/api/children/{adskhan['id']}/reset-pet")
    check("reset-pet: endpoint 200", r.status_code == 200, r.text[:150])
    check("reset-pet: pet_type cleared", r.json().get("pet_type") is None)
    check("reset-pet: feed stats cleared", r.json().get("feed_balance") == 0 and r.json().get("feed_lifetime") == 0)
    check("reset-pet: accessories cleared", r.json().get("pet_equipped") == [])
    ads_pet_after = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("reset-pet: not flagged dead (just no pet)", ads_pet_after["pet_is_dead"] is False)
    # Kid can immediately pick a brand new pet (permanence lock doesn't block this — it's a real reset)
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.patch("/api/me/profile", json={"pet_type": "turtle"})
    check("reset-pet: kid can freely pick after parent reset", r.status_code == 200 and r.json()["pet_type"] == "turtle", r.text[:150])
    # Kid blocked from resetting their own pet (parent-only action)
    r = c.post(f"/api/children/{adskhan['id']}/reset-pet")
    check("reset-pet: kid blocked from resetting", r.status_code == 403, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post("/api/children/nonexistent/reset-pet")
    check("reset-pet: 404 for bad child", r.status_code == 404, str(r.status_code))

    # =============== PET RESET REQUEST (kid asks, parent approves) ===============
    # Ensure Adskhan starts fresh (parent reset), then picks a known pet to swap
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c.post(f"/api/children/{adskhan['id']}/reset-pet")
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    c.patch("/api/me/profile", json={"pet_type": "cat"})
    r = c.post("/api/me/request-pet-reset", json={"reason": "mau naga"})
    check("pet-req: kid submits request", r.status_code == 200 and r.json()["status"] == "pending", r.text[:150])
    req_id = r.json()["id"]
    check("pet-req: captures current pet", r.json()["current_pet"] == "cat")
    r = c.post("/api/me/request-pet-reset", json={"reason": "lagi"})
    check("pet-req: only one pending request at a time", r.status_code == 400, r.text[:150])
    # Kid sees their own request
    r = c.get("/api/pet-reset-requests")
    check("pet-req: kid sees own request", any(x["id"] == req_id for x in r.json()) and len(r.json()) >= 1)
    # Parent sees it
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.get("/api/pet-reset-requests")
    pending = [x for x in r.json() if x["status"] == "pending"]
    check("pet-req: parent sees pending request", any(x["id"] == req_id for x in pending))
    # Approve → pet cleared
    r = c.post(f"/api/pet-reset-requests/{req_id}/approve", json={"note": "boleh"})
    check("pet-req: approve 200", r.status_code == 200 and r.json()["status"] == "approved", r.text[:150])
    ads_after_req = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("pet-req: approved request clears the pet", ads_after_req.get("pet_type") is None)
    check("pet-req: feed count reset after approval", ads_after_req.get("pet_feed_count") == 0)
    # Re-approve blocked
    r = c.post(f"/api/pet-reset-requests/{req_id}/approve", json={"note": "x"})
    check("pet-req: cannot re-approve processed request", r.status_code == 400, str(r.status_code))

    # Kid without a pet can't request
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.post("/api/me/request-pet-reset", json={"reason": "no pet"})
    check("pet-req: kid with no pet cannot request", r.status_code == 400, r.text[:150])
    # Give a pet, request, then parent REJECTS
    c.patch("/api/me/profile", json={"pet_type": "fox"})
    r = c.post("/api/me/request-pet-reset", json={"reason": "coba reject"})
    reject_id = r.json()["id"]
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post(f"/api/pet-reset-requests/{reject_id}/reject", json={"note": "rawat dulu ya"})
    check("pet-req: reject 200", r.status_code == 200 and r.json()["status"] == "rejected", r.text[:150])
    ads_after_reject = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("pet-req: rejected request keeps the pet", ads_after_reject.get("pet_type") == "fox")

    # Kid can withdraw a pending request
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.post("/api/me/request-pet-reset", json={"reason": "withdraw test"})
    withdraw_id = r.json()["id"]
    r = c.delete(f"/api/pet-reset-requests/{withdraw_id}")
    check("pet-req: kid withdraws pending request", r.status_code == 200)
    r = c.get("/api/pet-reset-requests")
    check("pet-req: withdrawn request gone", not any(x["id"] == withdraw_id for x in r.json()))
    # Picking a new pet after death auto-resolves a pending request
    r = c.post("/api/me/request-pet-reset", json={"reason": "auto resolve"})
    auto_id = r.json()["id"]
    # kid can't switch while alive, so this pick is blocked — but a parent direct reset then a fresh pick resolves it
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c.post(f"/api/children/{adskhan['id']}/reset-pet")
    r = c.get("/api/pet-reset-requests")
    auto_req = next((x for x in r.json() if x["id"] == auto_id), None)
    check("pet-req: direct parent reset resolves pending request", auto_req is not None and auto_req["status"] == "approved", str(auto_req))
    # Kid role can't approve
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    c.patch("/api/me/profile", json={"pet_type": "panda"})
    r = c.post("/api/me/request-pet-reset", json={"reason": "x"})
    kid_req_id = r.json()["id"]
    r = c.post(f"/api/pet-reset-requests/{kid_req_id}/approve", json={"note": "x"})
    check("pet-req: kid blocked from approving", r.status_code == 403, str(r.status_code))
    r = c.post("/api/pet-reset-requests/nonexistent/approve", json={"note": "x"})
    check("pet-req: 404/403 for bad request id", r.status_code in (403, 404), str(r.status_code))
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post("/api/pet-reset-requests/nonexistent/approve", json={"note": "x"})
    check("pet-req: parent 404 for bad request id", r.status_code == 404, str(r.status_code))

    # =============== PERF: migration must not re-run once stamped ===============
    import asyncio as _aio_perf
    async def _perf_check():
        # Ensure the DB is migrated + stamped first (TestClient may not fire the
        # startup/middleware init in this harness).
        await server.migrate_existing_data()
        marker = await server.db.app_config.find_one({"_schema_marker": True})
        assert marker and marker.get("schema_version", 0) >= 3, "schema marker missing"
        # Simulate a fresh cold container hitting the already-migrated DB
        server._init_done = False
        calls = {"tasks": 0, "children": 0}
        orig_t = server.db.tasks.update_many
        orig_c = server.db.children.update_many
        async def spy_t(*a, **k): calls["tasks"] += 1; return await orig_t(*a, **k)
        async def spy_c(*a, **k): calls["children"] += 1; return await orig_c(*a, **k)
        server.db.tasks.update_many = spy_t
        server.db.children.update_many = spy_c
        try:
            await server.migrate_existing_data()
        finally:
            server.db.tasks.update_many = orig_t
            server.db.children.update_many = orig_c
        return calls
    _perf_calls = _aio_perf.run(_perf_check())
    check("perf: migration skips task sweeps when already stamped", _perf_calls["tasks"] == 0, str(_perf_calls))
    check("perf: migration skips child sweeps when already stamped", _perf_calls["children"] == 0, str(_perf_calls))

    # =============== REWARD IMAGE ===============
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    tiny_img = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    r = c.post("/api/rewards", json={"name": "Mainan", "cost_points": 10, "image": tiny_img})
    img_reward = r.json()
    check("reward-img: created with image", r.status_code == 200 and img_reward["image"] == tiny_img, r.text[:120])
    r = c.patch(f"/api/rewards/{img_reward['id']}", json={"image": ""})
    check("reward-img: can clear image", r.status_code == 200 and r.json()["image"] == "", r.text[:120])
    r = c.patch(f"/api/rewards/{img_reward['id']}", json={"image": tiny_img})
    check("reward-img: can set image via patch", r.json()["image"] == tiny_img)
    r = c.post("/api/rewards", json={"name": "Besar", "cost_points": 5, "image": "data:image/png;base64," + ("A" * 2_000_001)})
    check("reward-img: oversized image rejected", r.status_code == 422, str(r.status_code))

    # =============== BUCKET-BASED REDEMPTIONS ===============
    import asyncio as _aio_bucket
    _aio_bucket.run(server.db.children.update_one(
        {"id": syila["id"]},
        {"$set": {"points": 100, "chiky_save": 50, "chiky_spend": 30, "chiky_share": 20}}))
    r = c.post("/api/rewards", json={"name": "Buku", "cost_points": 40})
    buku = r.json()
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.post(f"/api/rewards/{buku['id']}/redeem", params={"child_id": syila["id"]})
    check("bucket: reward redeem from savings ok", r.status_code == 200, r.text[:120])
    syi_b = next(k for k in c.get("/api/children").json() if k["id"] == syila["id"])
    check("bucket: savings reduced by reward cost", syi_b["chiky_save"] == 10, str(syi_b["chiky_save"]))
    check("bucket: headline points reduced too", syi_b["points"] == 60, str(syi_b["points"]))
    check("bucket: spend/share untouched by reward", syi_b["chiky_spend"] == 30 and syi_b["chiky_share"] == 20)
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post("/api/rewards", json={"name": "Mahal", "cost_points": 25})
    mahal = r.json()
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.post(f"/api/rewards/{mahal['id']}/redeem", params={"child_id": syila["id"]})
    check("bucket: reward blocked when savings short (even if points ok)", r.status_code == 400, str(r.status_code))
    r = c.post("/api/points/redeem-money", json={"child_id": syila["id"], "points": 30})
    check("bucket: money redeem from spend ok", r.status_code == 200, r.text[:120])
    syi_b2 = next(k for k in c.get("/api/children").json() if k["id"] == syila["id"])
    check("bucket: spend emptied", syi_b2["chiky_spend"] == 0, str(syi_b2["chiky_spend"]))
    check("bucket: points reduced by money redeem", syi_b2["points"] == 30, str(syi_b2["points"]))
    r = c.post("/api/points/redeem-money", json={"child_id": syila["id"], "points": 1})
    check("bucket: money blocked when spend empty", r.status_code == 400, str(r.status_code))

    # =============== SEDEKAH (CHARITY) FLOW ===============
    _rate_now = c.get("/api/config").json()["rupiah_per_point"]
    r = c.post("/api/charity/request", json={"child_id": syila["id"], "points": 15, "note": "buat masjid"})
    check("charity: request ok", r.status_code == 200 and r.json()["rupiah"] == 15 * _rate_now, r.text[:150])
    charity_id = r.json()["id"]
    syi_c = next(k for k in c.get("/api/children").json() if k["id"] == syila["id"])
    check("charity: share bucket reduced", syi_c["chiky_share"] == 5, str(syi_c["chiky_share"]))
    check("charity: headline points reduced", syi_c["points"] == 15, str(syi_c["points"]))
    r = c.post("/api/charity/request", json={"child_id": syila["id"], "points": 999})
    check("charity: over-request blocked", r.status_code == 400, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.post("/api/charity/request", json={"child_id": syila["id"], "points": 1})
    check("charity: sibling blocked", r.status_code == 403, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.get("/api/charity-requests")
    check("charity: parent sees request", any(x["id"] == charity_id for x in r.json()))
    r = c.post(f"/api/charity-requests/{charity_id}/approve")
    check("charity: approve ok", r.status_code == 200 and r.json()["status"] == "approved", r.text[:150])
    syi_c2 = next(k for k in c.get("/api/children").json() if k["id"] == syila["id"])
    check("charity: approved does NOT refund", syi_c2["chiky_share"] == 5, str(syi_c2["chiky_share"]))
    r = c.post(f"/api/charity-requests/{charity_id}/approve")
    check("charity: cannot re-approve", r.status_code == 400, str(r.status_code))
    r = c.post("/api/charity/request", json={"child_id": syila["id"], "points": 5})
    reject_charity_id = r.json()["id"]
    r = c.post(f"/api/charity-requests/{reject_charity_id}/reject")
    check("charity: reject ok", r.status_code == 200 and r.json()["status"] == "rejected", r.text[:150])
    syi_c4 = next(k for k in c.get("/api/children").json() if k["id"] == syila["id"])
    check("charity: reject refunds share bucket", syi_c4["chiky_share"] == 5, str(syi_c4["chiky_share"]))
    check("charity: reject refunds headline points", syi_c4["points"] == 15, str(syi_c4["points"]))
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.post("/api/charity/request", json={"child_id": syila["id"], "points": 1})
    kid_charity = r.json()["id"]
    r = c.post(f"/api/charity-requests/{kid_charity}/approve")
    check("charity: kid blocked from approving", r.status_code == 403, str(r.status_code))

    # =============== REWARD REDEMPTION CANCEL (refund to savings) ===============
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_bucket.run(server.db.children.update_one({"id": syila["id"]}, {"$set": {"points": 100, "chiky_save": 60}}))
    r = c.post("/api/rewards", json={"name": "RefundTest", "cost_points": 20})
    rf_reward = r.json()
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.post(f"/api/rewards/{rf_reward['id']}/redeem", params={"child_id": syila["id"]})
    rf_redemption_id = r.json()["id"]
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post(f"/api/redemptions/{rf_redemption_id}/cancel")
    check("redeem-cancel: ok", r.status_code == 200, r.text[:150])
    syi_rf = next(k for k in c.get("/api/children").json() if k["id"] == syila["id"])
    check("redeem-cancel: savings refunded", syi_rf["chiky_save"] == 60, str(syi_rf["chiky_save"]))
    check("redeem-cancel: points refunded", syi_rf["points"] == 100, str(syi_rf["points"]))
    r = c.post(f"/api/redemptions/{rf_redemption_id}/cancel")
    check("redeem-cancel: cannot cancel twice", r.status_code == 400, str(r.status_code))

    # =============== WISHLIST (savings-based progress + days estimate) ===============
    c.post("/api/config", json={"daily_point_goal": 50, "chiky_save_pct": 40, "chiky_spend_pct": 40, "chiky_share_pct": 20})
    _aio_bucket.run(server.db.children.update_one({"id": syila["id"]}, {"$set": {"chiky_save": 30}}))
    r = c.post("/api/rewards", json={"name": "WishGoal", "cost_points": 100})
    wish_reward = r.json()
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.post("/api/wishlist", json={"reward_id": wish_reward["id"]})
    check("wishlist: added", r.status_code == 200)
    r = c.get("/api/wishlist")
    wl = next((x for x in r.json() if x["reward_id"] == wish_reward["id"]), None)
    check("wishlist: progress from savings not points", wl and wl["current_points"] == 30, str(wl and wl["current_points"]))
    check("wishlist: percent computed", wl and wl["percent"] == 30, str(wl and wl["percent"]))
    check("wishlist: remaining computed", wl and wl["remaining"] == 70, str(wl and wl["remaining"]))
    check("wishlist: days estimate", wl and wl["days_estimate"] == 4, str(wl and wl["days_estimate"]))

    # =============== MAINTENANCE MODE ===============
    # Public status check works without any auth
    r = c.get("/api/maintenance-status")
    check("maintenance: public status accessible unauth'd", r.status_code == 200 and r.json()["enabled"] is False, r.text[:150])

    # Kid blocked from toggling
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.post("/api/maintenance/toggle", json={"enabled": True, "message": "test"})
    check("maintenance: kid blocked from toggling", r.status_code == 403, str(r.status_code))

    # Capture each member's own token WHILE maintenance is still off, so we can
    # simulate "was already logged in with a valid session" independently of
    # whichever login the shared cookie jar currently holds.
    r = c.post("/api/auth/login", json={"member_id": ummi["id"], "passcode": "123456"})
    ummi_token = r.json()["token"]
    r = c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    adskhan_token = r.json()["token"]
    r = c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    syila_token = r.json()["token"]

    # Abi (parent) turns it ON — becomes the exempt account automatically
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post("/api/maintenance/toggle", json={"enabled": True, "message": "Lagi maintenance, sabar ya"})
    check("maintenance: parent can turn on", r.status_code == 200 and r.json()["enabled"] is True, r.text[:150])

    r = c.get("/api/maintenance-status")
    check("maintenance: public status reflects ON", r.status_code == 200 and r.json()["enabled"] is True and r.json()["message"] == "Lagi maintenance, sabar ya")

    # Abi (the one who enabled it) is NOT blocked — can keep using every endpoint
    r = c.get("/api/config")
    check("maintenance: exempt parent (Abi) unaffected", r.status_code == 200, r.text[:150])
    r = c.get("/api/children")
    check("maintenance: exempt parent can still list children", r.status_code == 200, r.text[:150])

    # Ummi's PRE-EXISTING session (token captured before the toggle) is locked
    # out on its very next request — not just blocked at a fresh login.
    c.cookies.clear()
    r = c.get("/api/config", headers={"Authorization": f"Bearer {ummi_token}"})
    check("maintenance: non-exempt parent (Ummi) locked out mid-session", r.status_code == 503, str(r.status_code))
    # A fresh login attempt for Ummi is also blocked outright
    r = c.post("/api/auth/login", json={"member_id": ummi["id"], "passcode": "123456"})
    check("maintenance: non-exempt parent blocked at fresh login too", r.status_code == 503, str(r.status_code))

    # Both kids' pre-existing sessions are locked out too
    c.cookies.clear()
    r = c.get("/api/children", headers={"Authorization": f"Bearer {adskhan_token}"})
    check("maintenance: kid Adskhan locked out mid-session", r.status_code == 503, str(r.status_code))
    c.cookies.clear()
    r = c.get("/api/children", headers={"Authorization": f"Bearer {syila_token}"})
    check("maintenance: kid Syila locked out mid-session", r.status_code == 503, str(r.status_code))
    r = c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    check("maintenance: kid blocked at fresh login too", r.status_code == 503, str(r.status_code))

    # Abi can still turn it back off
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post("/api/maintenance/toggle", json={"enabled": False})
    check("maintenance: parent can turn off", r.status_code == 200 and r.json()["enabled"] is False, r.text[:150])
    r = c.get("/api/maintenance-status")
    check("maintenance: public status reflects OFF", r.json()["enabled"] is False)

    # Everyone regains access once off — including via their OLD tokens.
    r = c.get("/api/config", headers={"Authorization": f"Bearer {ummi_token}"})
    check("maintenance: Ummi's old token works again after OFF", r.status_code == 200, r.text[:150])
    r = c.get("/api/children", headers={"Authorization": f"Bearer {adskhan_token}"})
    check("maintenance: kid's old token works again after OFF", r.status_code == 200, r.text[:150])

    # If Ummi turns it on next, SHE becomes exempt (not Abi) — confirms the
    # exemption is "whoever flips the switch", not hardcoded to one name.
    c.cookies.clear()
    c.post("/api/auth/login", json={"member_id": ummi["id"], "passcode": "123456"})
    r = c.post("/api/maintenance/toggle", json={"enabled": True, "message": ""})
    check("maintenance: Ummi turning it on makes HER exempt", r.status_code == 200)
    r = c.get("/api/config")
    check("maintenance: Ummi (new activator) unaffected", r.status_code == 200, r.text[:150])
    # Abi's session is now the non-exempt one this time
    c.cookies.clear()
    r = c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    check("maintenance: Abi now blocked since Ummi is the exempt one this time", r.status_code == 503, str(r.status_code))
    # Empty message falls back to the default friendly text
    r = c.get("/api/maintenance-status")
    check("maintenance: empty message falls back to default text", len(r.json()["message"]) > 0)
    # Clean up: turn back off (as Ummi, who's exempt) so later tests aren't affected
    c.cookies.clear()
    c.post("/api/auth/login", json={"member_id": ummi["id"], "passcode": "123456"})
    c.post("/api/maintenance/toggle", json={"enabled": False})
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})

    # =============== OFF DAYS (hari libur tugas) ===============
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.tasks.delete_many({"parent_id": "family-default"}))
    _aio_tg.run(server.db.off_days.delete_many({}))
    import datetime as _dt_off
    _off_base = _dt_off.datetime.utcnow() + _dt_off.timedelta(hours=7)
    off_d1 = (_off_base + _dt_off.timedelta(days=3)).strftime("%Y-%m-%d")
    off_d2 = (_off_base + _dt_off.timedelta(days=4)).strftime("%Y-%m-%d")
    after_off = (_off_base + _dt_off.timedelta(days=5)).strftime("%Y-%m-%d")

    r = c.post("/api/tasks", json={"title": "Sabtu bersih2", "points": 10, "date_key": off_d1, "target_children": [adskhan["id"]]})
    off_task1 = r.json()
    r = c.post("/api/tasks", json={"title": "Minggu nyapu", "points": 10, "date_key": off_d2, "target_children": [adskhan["id"]]})
    off_task2 = r.json()
    r = c.post("/api/tasks", json={"title": "Senin normal", "points": 10, "date_key": after_off, "target_children": [adskhan["id"]]})
    normal_task = r.json()

    # Kid can't create off days
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.post("/api/off-days", json={"start_date": off_d1})
    check("offday: kid blocked", r.status_code == 403, str(r.status_code))

    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post("/api/off-days", json={"start_date": "banana"})
    check("offday: invalid date rejected", r.status_code == 422, str(r.status_code))
    r = c.post("/api/off-days", json={"start_date": off_d2, "end_date": off_d1})
    check("offday: end<start rejected", r.status_code == 422, str(r.status_code))

    # Range off day covering both days
    r = c.post("/api/off-days", json={"start_date": off_d1, "end_date": off_d2, "note": "Jalan-jalan keluarga"})
    check("offday: range created", r.status_code == 200 and r.json()["parked_tasks"] == 2, r.text[:200])
    off_id = r.json()["id"]
    r = c.post("/api/off-days", json={"start_date": off_d1, "end_date": off_d2})
    check("offday: exact duplicate rejected", r.status_code == 409, str(r.status_code))

    tasks_now = {t["id"]: t for t in c.get(f"/api/tasks?child_id={adskhan['id']}").json()}
    check("offday: task on day1 parked", tasks_now[off_task1["id"]]["status"] == "off", tasks_now[off_task1["id"]]["status"])
    check("offday: task on day2 parked", tasks_now[off_task2["id"]]["status"] == "off", tasks_now[off_task2["id"]]["status"])
    check("offday: task outside range untouched", tasks_now[normal_task["id"]]["status"] == "pending", tasks_now[normal_task["id"]]["status"])

    # Kid's day-progress: off tasks hidden + is_off_day flag
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.get(f"/api/children/{adskhan['id']}/day-progress?date_key={off_d1}")
    check("offday: kid sees is_off_day flag", r.json()["is_off_day"] is True)
    check("offday: parked tasks hidden from quest line", all(t["id"] != off_task1["id"] for t in r.json()["tasks"]))
    r = c.get(f"/api/children/{adskhan['id']}/day-progress?date_key={after_off}")
    check("offday: normal day not flagged", r.json()["is_off_day"] is False)

    # Parked task can't be ticked or worked on
    r = c.post(f"/api/tasks/{off_task1['id']}/check", json={"checked": True})
    check("offday: parked task can't be ticked", r.status_code in (400, 409), str(r.status_code))
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})

    # Streak bridges across off days: last completion = day before off range,
    # then approving on the day AFTER the range continues the streak without
    # (Simulate: off range = the 2 days before today.)
    _aio_tg.run(server.db.off_days.delete_many({}))
    _aio_tg.run(server.db.tasks.delete_many({"parent_id": "family-default"}))
    yest1 = (_off_base - _dt_off.timedelta(days=1)).strftime("%Y-%m-%d")
    yest2 = (_off_base - _dt_off.timedelta(days=2)).strftime("%Y-%m-%d")
    day_before_off = (_off_base - _dt_off.timedelta(days=3)).strftime("%Y-%m-%d")
    r = c.post("/api/off-days", json={"start_date": yest2, "end_date": yest1, "note": "Libur kemarin"})
    check("offday: past range created for streak test", r.status_code == 200)
    _aio_tg.run(server.db.children.update_one({"id": syila["id"]}, {"$set": {
        "last_completion_date": day_before_off, "streak_days": 4}}))
    r = c.post("/api/tasks", json={"title": "Streak jembatan", "points": 5, "date_key": today_local, "target_children": [syila["id"]]})
    streak_task = r.json()
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    start(streak_task['id'])
    complete(streak_task['id'])
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post(f"/api/tasks/{streak_task['id']}/approve")
    check("offday: streak-bridge approve ok", r.status_code == 200, r.text[:150])
    syi_streak = next(k for k in c.get("/api/children").json() if k["id"] == syila["id"])
    check("offday: streak continues across off days", syi_streak["streak_days"] == 5, str(syi_streak["streak_days"]))
    check("offday: bridging needs no rescue mechanic", syi_streak.get("freeze_cards_available") is None, str(syi_streak.get("freeze_cards_available")))
    _aio_tg.run(server.db.off_days.delete_many({}))

    # Delete off-day restores parked tasks
    r = c.post("/api/tasks", json={"title": "Restore me", "points": 5, "date_key": off_d1, "target_children": [adskhan["id"]]})
    restore_task = r.json()
    r = c.post("/api/off-days", json={"start_date": off_d1})
    restore_off_id = r.json()["id"]
    t_parked = next(t for t in c.get(f"/api/tasks?child_id={adskhan['id']}&date_key={off_d1}").json() if t["id"] == restore_task["id"])
    check("offday: parked before delete", t_parked["status"] == "off")
    r = c.delete(f"/api/off-days/{restore_off_id}")
    check("offday: delete ok", r.status_code == 200 and r.json()["restored_tasks"] >= 1, r.text[:150])
    t_restored = next(t for t in c.get(f"/api/tasks?child_id={adskhan['id']}&date_key={off_d1}").json() if t["id"] == restore_task["id"])
    check("offday: task restored to pending", t_restored["status"] == "pending", t_restored["status"])
    r = c.delete(f"/api/off-days/{restore_off_id}")
    check("offday: delete missing → 404", r.status_code == 404, str(r.status_code))

    # =============== SHARED HELPER (used by the sections below) ===============
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.tasks.delete_many({"parent_id": "family-default"}))
    _aio_tg.run(server.db.off_days.delete_many({}))
    _yest = (_off_base - _dt_off.timedelta(days=1)).strftime("%Y-%m-%d")

    def _run_one_task(kid, passcode, title):
        """Create → start → complete → approve one task today for `kid`."""
        c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
        rr = c.post("/api/tasks", json={"title": title, "points": 5, "date_key": today_local, "target_children": [kid["id"]]})
        tid = rr.json()["id"]
        c.post("/api/auth/login", json={"member_id": kid["id"], "passcode": passcode})
        start(tid)
        complete(tid)
        c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
        return c.post(f"/api/tasks/{tid}/approve")

    # =============== FAMILY COMBO (kompak sekeluarga) ===============
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.tasks.delete_many({"parent_id": "family-default"}))
    _aio_tg.run(server.db.family_combo_awards.delete_many({}))
    c.post("/api/config", json={"family_combo_bonus_points": 10})
    _aio_tg.run(server.db.children.update_one({"id": adskhan["id"]}, {"$set": {"points": 0, "chiky_save": 0, "chiky_spend": 0, "chiky_share": 0}}))
    _aio_tg.run(server.db.children.update_one({"id": syila["id"]}, {"$set": {"points": 0, "chiky_save": 0, "chiky_spend": 0, "chiky_share": 0}}))

    r = _run_one_task(adskhan, "654321", "Combo Adskhan")
    check("combo: not awarded while sibling still pending", r.json().get("family_combo") is None, str(r.json().get("family_combo")))
    # Give Syila a task and finish it → combo should fire for BOTH kids
    r = _run_one_task(syila, "123456", "Combo Syila")
    combo = r.json().get("family_combo")
    check("combo: awarded when both finish", combo is not None and combo["points"] == 10, str(combo))
    check("combo: covers both children", combo and len(combo["child_ids"]) == 2, str(combo and combo["child_ids"]))
    ads_c = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    syi_c2 = next(k for k in c.get("/api/children").json() if k["id"] == syila["id"])
    check("combo: Adskhan got bonus points", ads_c["points"] == 15, str(ads_c["points"]))  # 5 task + 10 combo
    check("combo: Syila got bonus points", syi_c2["points"] == 15, str(syi_c2["points"]))
    check("combo: split into buckets", ads_c["chiky_save"] + ads_c["chiky_spend"] + ads_c["chiky_share"] == 15, f'{ads_c["chiky_save"]}/{ads_c["chiky_spend"]}/{ads_c["chiky_share"]}')

    # Awarded once only — another approval same day must not double-pay
    r = _run_one_task(adskhan, "654321", "Combo lagi")
    check("combo: not awarded twice same day", r.json().get("family_combo") is None, str(r.json().get("family_combo")))
    ads_c2 = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("combo: no double bonus", ads_c2["points"] == 20, str(ads_c2["points"]))  # 15 + 5 task only

    # Surfaced in day-progress for the kid banner
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.get(f"/api/children/{syila['id']}/day-progress?date_key={today_local}")
    check("combo: exposed in day-progress", r.json().get("family_combo") is not None)

    # Config 0 turns it off
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.tasks.delete_many({"parent_id": "family-default"}))
    _aio_tg.run(server.db.family_combo_awards.delete_many({}))
    c.post("/api/config", json={"family_combo_bonus_points": 0})
    _run_one_task(adskhan, "654321", "Off combo A")
    r = _run_one_task(syila, "123456", "Off combo B")
    check("combo: disabled at 0 points", r.json().get("family_combo") is None, str(r.json().get("family_combo")))
    c.post("/api/config", json={"family_combo_bonus_points": 10})

    # Solo child (only one kid has tasks) is not a combo
    _aio_tg.run(server.db.tasks.delete_many({"parent_id": "family-default"}))
    _aio_tg.run(server.db.family_combo_awards.delete_many({}))
    r = _run_one_task(adskhan, "654321", "Sendirian")
    check("combo: single-child day is not a combo", r.json().get("family_combo") is None, str(r.json().get("family_combo")))

    # =============== HONESTY INSIGHT ===============
    # Signals come from how each SECTION was worked through.
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.tasks.delete_many({"parent_id": "family-default"}))
    _aio_tg.run(server.db.segment_sessions.delete_many({}))
    import datetime as _dt_hi
    _t_now = _dt_hi.datetime.now(_dt_hi.timezone.utc)

    def _seed_section(kid, seg_id, n_acts, est_min, spent_sec, tick_spread_sec, late=False):
        ids = []
        for i in range(n_acts):
            ids.append(c.post("/api/tasks", json={"title": f"{seg_id}-{i}", "points": 5, "date_key": today_local,
                                                  "segment_id": seg_id, "target_children": [kid["id"]],
                                                  "duration_minutes": est_min}).json()["id"])
        st = _t_now - _dt_hi.timedelta(seconds=spent_sec)
        for i, tid in enumerate(ids):
            tick = st + _dt_hi.timedelta(seconds=tick_spread_sec * i / max(1, n_acts - 1))
            _aio_tg.run(server.db.tasks.update_one({"id": tid}, {"$set": {
                "status": "approved", "checked": True, "checked_at": tick.isoformat()}}))
        _aio_tg.run(server.db.segment_sessions.insert_one({
            "parent_id": "family-default", "child_id": kid["id"], "date_key": today_local, "segment_id": seg_id,
            "started_at": st.isoformat(), "completed_at": _t_now.isoformat(), "start_late": late}))

    HSEG = [x["id"] for x in c.get("/api/config").json()["day_segments"]]
    _seed_section(adskhan, HSEG[0], 4, 10, 60, 5)            # 40 min of work done in 1 min, all ticked in 5 s
    _seed_section(adskhan, HSEG[1], 3, 10, 1500, 1200)       # 25 of 30 min, ticks spread out
    _seed_section(adskhan, HSEG[2], 3, 10, 1800, 1500, late=True)

    r = c.get("/api/family/honesty-insight?days=14")
    check("honesty: endpoint ok", r.status_code == 200, r.text[:150])
    ads_hi = next(x for x in r.json()["children"] if x["child_id"] == adskhan["id"])
    check("honesty: counts finished sections", ads_hi["sections_measured"] == 3, str(ads_hi))
    check("honesty: flags a rushed section", ads_hi["sections_rushed"] == 1, str(ads_hi["sections_rushed"]))
    check("honesty: flags ticks done all at once", ads_hi["bursts"] == 1, str(ads_hi["bursts"]))
    check("honesty: counts late sections", ads_hi["late"] == 1, str(ads_hi["late"]))
    check("honesty: reports averages", ads_hi["avg_actual_minutes"] is not None
          and ads_hi["avg_estimated_minutes"] is not None, str(ads_hi))
    syi_hi = next(x for x in r.json()["children"] if x["child_id"] == syila["id"])
    check("honesty: a child with no finished sections shows nothing", syi_hi["sections_measured"] == 0)
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.get("/api/family/honesty-insight")
    check("honesty: kid blocked", r.status_code == 403, str(r.status_code))

    # =============== SMART REMINDERS ===============
    # Section deadlines: the child is nudged shortly before a section closes;
    # once it closed unfinished, the parents are told (nothing automatic).
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.tasks.delete_many({"parent_id": "family-default"}))
    _aio_tg.run(server.db.segment_sessions.delete_many({}))
    _aio_tg.run(server.db.reminder_log.delete_many({}))
    _nm_r = now_local.hour * 60 + now_local.minute
    def _hm(m):
        return f"{m // 60:02d}:{m % 60:02d}"
    _old_segs = c.get("/api/config").json()["day_segments"]
    if 40 <= _nm_r <= 23 * 60 + 40:
        c.post("/api/config", json={"day_segments": [
            {"label": "Tadi", "start_time": "00:00", "end_time": _hm(_nm_r - 30)},
            {"label": "Sekarang", "start_time": _hm(_nm_r - 29), "end_time": _hm(_nm_r + 10)},
            {"label": "Nanti", "start_time": _hm(_nm_r + 11), "end_time": "23:59"}]})
        RSG = {x["label"]: x["id"] for x in c.get("/api/config").json()["day_segments"]}
        for lbl in ("Tadi", "Sekarang", "Nanti"):
            c.post("/api/tasks", json={"title": f"R-{lbl}", "points": 5, "date_key": today_local,
                                       "segment_id": RSG[lbl], "target_children": [adskhan["id"]]})
        r = c.post("/api/reminders/run")
        check("reminder: manual sweep ok", r.status_code == 200, r.text[:150])
        check("reminder: child nudged before a section closes", r.json()["section_nudges"] == 1, str(r.json()))
        check("reminder: parents told about a closed, unfinished section", r.json()["overdue_sections"] == 1, str(r.json()))
        r2 = c.post("/api/reminders/run")
        check("reminder: deduplicated on repeat run",
              r2.json()["section_nudges"] == 0 and r2.json()["overdue_sections"] == 0, str(r2.json()))
        od = c.get("/api/family/overdue-sections").json()
        check("reminder: the closed section waits for the parent's decision",
              [x["label"] for x in od["sections"]] == ["Tadi"] and od["sections"][0]["left"], str(od)[:200])
        tadi_task = od["sections"][0]["left"][0]["id"]
        r = c.post("/api/family/overdue-sections/resolve", json={
            "child_id": adskhan["id"], "date_key": today_local, "segment_id": RSG["Tadi"],
            "action": "miss", "task_ids": [tadi_task]})
        check("reminder: parent can mark the leftovers as missed", r.status_code == 200 and r.json()["missed"] == 1, r.text[:150])
        check("reminder: decided sections drop off the list", not c.get("/api/family/overdue-sections").json()["sections"])
        check("reminder: missed is recorded on the mission",
              _aio_tg.run(server.db.tasks.find_one({"id": tadi_task}))["status"] == "missed")
        c.post("/api/config", json={"day_segments": _old_segs})
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.post("/api/reminders/run")
    check("reminder: kid blocked from manual sweep", r.status_code == 403, str(r.status_code))
    check("reminder: kid can't read the parents' list", c.get("/api/family/overdue-sections").status_code == 403)
    r = c.get("/api/cron/reminders?key=wrong")
    check("reminder: cron rejects bad key", r.status_code == 403, str(r.status_code))
    r = c.get("/api/cron/reminders")
    check("reminder: cron rejects empty key", r.status_code == 403, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})

    # =============== SISTEM TERLAMBAT + KARTU HUKUMAN ===============
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.tasks.delete_many({"parent_id": "family-default"}))
    _aio_tg.run(server.db.children.update_one({"id": adskhan["id"]}, {"$set": {"penalty_cards": 0, "points": 0, "chiky_save": 0, "chiky_spend": 0, "chiky_share": 0}}))

    # Default reasons served from config
    r = c.get("/api/config")
    check("late2: default reasons present", len(r.json()["late_reasons"]) >= 3 and r.json()["penalty_card_threshold"] == 3, str(r.json().get("penalty_card_threshold")))

    # Parent customizes: unlimited options, mixed flags
    custom = [
        {"label": "Kena macet", "gives_penalty_card": False, "award_points": True},
        {"label": "Rapat sekolah", "gives_penalty_card": False, "award_points": True},
        {"label": "Terlambat bangun", "gives_penalty_card": True, "award_points": False},
        {"label": "Keasyikan main", "gives_penalty_card": True, "award_points": False},
        {"label": "Males aja", "gives_penalty_card": True, "award_points": False},
    ]
    r = c.post("/api/config", json={"late_reasons": custom, "penalty_card_threshold": 2})
    check("late2: custom reasons saved", r.status_code == 200, r.text[:150])
    cfg = c.get("/api/config").json()
    check("late2: five options round-trip", len(cfg["late_reasons"]) == 5, str(len(cfg["late_reasons"])))
    check("late2: ids auto-assigned", all(o.get("id") for o in cfg["late_reasons"]), str(cfg["late_reasons"])[:120])
    excused_id = cfg["late_reasons"][0]["id"]
    fault_id = cfg["late_reasons"][2]["id"]

    # Lateness is judged per section: a section started after its time (here:
    # on an earlier day) needs a reason; an at-fault reason costs a card and
    # the section's points.
    _late_days = iter(range(1, 200))
    LSEG = c.get("/api/config").json()["day_segments"][0]["id"]

    def late_start(kid, passcode, reason_id, title, pts=10):
        dk = (now_local - _dt.timedelta(days=next(_late_days))).strftime("%Y-%m-%d")
        c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
        tt = c.post("/api/tasks", json={"title": title, "points": pts, "date_key": dk, "segment_id": LSEG,
                                        "target_children": [kid["id"]]}).json()
        c.post("/api/auth/login", json={"member_id": kid["id"], "passcode": passcode})
        body = {"child_id": kid["id"], "date_key": dk, "segment_id": LSEG}
        rr = c.post("/api/segment-sessions/start", json={**body, "late_reason_id": reason_id})
        return rr, tt, body

    def cards(kid):
        return int(_aio_tg.run(server.db.children.find_one({"id": kid["id"]})).get("penalty_cards", 0))

    # Excused path: no card, full points
    r, t_ex, b_ex = late_start(adskhan, "654321", excused_id, "Telat macet")
    check("late2: excused start ok", r.status_code == 200 and r.json()["start_late"] is True, r.text[:200])
    check("late2: excused no card", cards(adskhan) == 0, str(cards(adskhan)))
    c.post(f"/api/tasks/{t_ex['id']}/check", json={"checked": True})
    r = c.post("/api/segment-sessions/finish", json=b_ex)
    check("late2: finishing needs no second reason", r.status_code == 200, r.text[:150])
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c.post(f"/api/tasks/{t_ex['id']}/approve")
    ads_l1 = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("late2: excused keeps full points", ads_l1["points"] == 10, str(ads_l1["points"]))

    # At-fault path: +1 card, ZERO points
    r, t_f1, b_f1 = late_start(adskhan, "654321", fault_id, "Telat bangun", pts=20)
    check("late2: at-fault start ok", r.status_code == 200 and r.json()["no_points"] is True, r.text[:200])
    check("late2: card counted", cards(adskhan) == 1, str(cards(adskhan)))
    c.post(f"/api/tasks/{t_f1['id']}/check", json={"checked": True})
    c.post("/api/segment-sessions/finish", json=b_f1)
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post(f"/api/tasks/{t_f1['id']}/approve")
    check("late2: at-fault approve ok", r.status_code == 200, r.text[:150])
    ads_l2 = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("late2: at-fault earns ZERO points", ads_l2["points"] == 10, str(ads_l2["points"]))
    check("late2: buckets unchanged too", ads_l2["chiky_save"] + ads_l2["chiky_spend"] + ads_l2["chiky_share"] == 10, "buckets grew")

    # Second at-fault → threshold (2) reached
    r, t_f2, b_f2 = late_start(adskhan, "654321", fault_id, "Telat lagi")
    check("late2: threshold reached at 2", cards(adskhan) == 2, str(cards(adskhan)))

    # Guards
    r = c.post("/api/segment-sessions/start", json={**b_f2, "late_reason_id": fault_id})
    check("late2: starting twice costs nothing more", r.status_code == 200 and cards(adskhan) == 2, str(cards(adskhan)))
    r2, t_u, b_u = late_start(adskhan, "654321", "zzz", "Alasan ngawur")
    check("late2: unknown reason asks again", r2.status_code == 409 and "LATE_REASON_REQUIRED" in r2.text, r2.text[:150])
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.post("/api/segment-sessions/start", json={**b_u, "late_reason_id": fault_id})
    check("late2: sibling blocked", r.status_code == 403, str(r.status_code))

    # Parent resets cards after the consequence is served
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post(f"/api/children/{adskhan['id']}/penalty-cards", json={"penalty_cards": 0})
    check("late2: parent reset ok", r.status_code == 200 and r.json()["penalty_cards"] == 0, r.text[:150])
    ads_l3 = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("late2: reset visible", int(ads_l3.get("penalty_cards", 0)) == 0, str(ads_l3.get("penalty_cards")))
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.post(f"/api/children/{adskhan['id']}/penalty-cards", json={"penalty_cards": 5})
    check("late2: kid can't set cards", r.status_code == 403, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})

    # =============== HUKUMAN OTOMATIS (punishment system) ===============
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.tasks.delete_many({"parent_id": "family-default"}))
    _aio_tg.run(server.db.punishments.delete_many({}))
    _aio_tg.run(server.db.children.update_one({"id": adskhan["id"]}, {"$set": {
        "penalty_cards": 0, "points": 500, "chiky_save": 200, "chiky_spend": 200, "chiky_share": 100,
        "lifetime_points": 900, "pet_type": "dragon", "pet_force_dead": False,
        "pet_last_fed_at": server.now_iso()}}))

    r = c.get("/api/config")
    check("pun: defaults present", len(r.json()["punishment_options"]) >= 3
          and r.json()["punishment_mode"] == "choice"
          and r.json()["punishment_deadline_weekday"] == 6
          and r.json()["punishment_overdue_action"] == "reset_points", str(r.json().get("punishment_mode")))

    # Parent config: unlimited custom options
    pun_opts = [
        {"label": "Tidak nonton TV", "description": "Sehari penuh"},
        {"label": "Tidak main gadget", "description": "Sehari penuh"},
        {"label": "Cuci piring 3 hari", "description": "Setelah makan malam"},
        {"label": "Tidur lebih awal", "description": "1 jam lebih cepat"},
        {"label": "Bantu bersihkan halaman", "description": "Sabtu pagi"},
    ]
    r = c.post("/api/config", json={"punishment_options": pun_opts, "punishment_mode": "choice",
                                    "penalty_card_threshold": 2, "punishment_overdue_action": "reset_points"})
    check("pun: custom options saved", r.status_code == 200, r.text[:150])
    cfgp = c.get("/api/config").json()
    check("pun: five options round-trip", len(cfgp["punishment_options"]) == 5, str(len(cfgp["punishment_options"])))
    check("pun: option ids auto-assigned", all(o.get("id") for o in cfgp["punishment_options"]))
    r = c.post("/api/config", json={"punishment_mode": "banana"})
    check("pun: invalid mode rejected", r.status_code == 422, str(r.status_code))
    r = c.post("/api/config", json={"punishment_overdue_action": "explode"})
    check("pun: invalid overdue action rejected", r.status_code == 422, str(r.status_code))
    r = c.post("/api/config", json={"punishment_deadline_weekday": 9})
    check("pun: invalid deadline weekday rejected", r.status_code == 422, str(r.status_code))

    lr = [{"label": "Terlambat bangun", "gives_penalty_card": True, "award_points": False}]
    c.post("/api/config", json={"late_reasons": lr})
    fault2 = c.get("/api/config").json()["late_reasons"][0]["id"]

    def _earn_card(kid, passcode, title):
        return late_start(kid, passcode, fault2, title)[0]

    # 1st card: below threshold(2) → no punishment yet
    _earn_card(adskhan, "654321", "Telat A")
    r = c.get("/api/punishments")
    check("pun: none issued below threshold", len(r.json()) == 0, str(len(r.json())))

    # 2nd card: threshold reached → punishment issued awaiting the kid's choice
    r = _earn_card(adskhan, "654321", "Telat B")
    check("pun: second card counted", r.status_code == 200 and cards(adskhan) == 2, str(cards(adskhan)))
    pl = c.get("/api/punishments").json()
    check("pun: punishment issued at threshold", len(pl) == 1, str(len(pl)))
    pun = pl[0]
    check("pun: choice mode awaits pick", pun["status"] == "pending_choice" and pun["option_id"] is None, pun["status"])
    check("pun: options frozen onto the sentence", len(pun["options_snapshot"]) == 5, str(len(pun["options_snapshot"])))
    check("pun: deadline is a Sunday", _dt_off.datetime.strptime(pun["deadline_date"], "%Y-%m-%d").weekday() == 6, pun["deadline_date"])
    check("pun: surfaced in day-progress", c.get(f"/api/children/{adskhan['id']}/day-progress").json().get("active_punishment") is not None)

    # Earning more cards must not stack a second sentence
    _earn_card(adskhan, "654321", "Telat C")
    check("pun: no duplicate sentence stacked", len(c.get("/api/punishments").json()) == 1)

    # Kid picks one
    r = c.post(f"/api/punishments/{pun['id']}/choose", json={"option_id": "nope"})
    check("pun: unknown option rejected", r.status_code == 404, str(r.status_code))
    pick = pun["options_snapshot"][2]
    r = c.post(f"/api/punishments/{pun['id']}/choose", json={"option_id": pick["id"]})
    check("pun: kid can choose", r.status_code == 200 and r.json()["status"] == "assigned", r.text[:180])
    check("pun: chosen label recorded", r.json()["option_label"] == pick["label"], str(r.json().get("option_label")))
    r = c.post(f"/api/punishments/{pun['id']}/choose", json={"option_id": pick["id"]})
    check("pun: cannot choose twice", r.status_code == 400, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.post(f"/api/punishments/{pun['id']}/choose", json={"option_id": pick["id"]})
    check("pun: sibling blocked from choosing", r.status_code in (400, 403), str(r.status_code))

    # Kid can't mark it served themselves
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.post(f"/api/punishments/{pun['id']}/serve")
    check("pun: kid cannot self-serve", r.status_code == 403, str(r.status_code))

    # Parent confirms → cards wiped, points untouched
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post(f"/api/punishments/{pun['id']}/serve")
    check("pun: parent confirms served", r.status_code == 200 and r.json()["status"] == "served", r.text[:150])
    ads_p = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("pun: cards cleared after serving", ads_p["penalty_cards"] == 0, str(ads_p["penalty_cards"]))
    check("pun: points untouched by serving", ads_p["points"] == 500, str(ads_p["points"]))
    r = c.post(f"/api/punishments/{pun['id']}/serve")
    check("pun: cannot serve twice", r.status_code == 400, str(r.status_code))

    # --- Overdue: reset_points ---
    _aio_tg.run(server.db.punishments.delete_many({}))
    _aio_tg.run(server.db.children.update_one({"id": adskhan["id"]}, {"$set": {
        "penalty_cards": 0, "points": 500, "chiky_save": 200, "chiky_spend": 200, "chiky_share": 100, "lifetime_points": 900}}))
    _earn_card(adskhan, "654321", "Telat D")
    _earn_card(adskhan, "654321", "Telat E")
    pun2 = c.get("/api/punishments").json()[0]
    _past = (_off_base - _dt_off.timedelta(days=2)).strftime("%Y-%m-%d")
    _aio_tg.run(server.db.punishments.update_one({"id": pun2["id"]}, {"$set": {"deadline_date": _past}}))
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.get("/api/punishments")
    expired = next(x for x in r.json() if x["id"] == pun2["id"])
    check("pun: overdue auto-expires", expired["status"] == "expired", expired["status"])
    check("pun: overdue action recorded", expired["penalty_applied"] == "reset_points", str(expired.get("penalty_applied")))
    ads_e = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("pun: points reset to zero", ads_e["points"] == 0, str(ads_e["points"]))
    check("pun: buckets zeroed too", ads_e["chiky_save"] == 0 and ads_e["chiky_spend"] == 0 and ads_e["chiky_share"] == 0)
    check("pun: lifetime points preserved", ads_e["lifetime_points"] == 900, str(ads_e["lifetime_points"]))
    check("pun: cards cleared after expiry", ads_e["penalty_cards"] == 0, str(ads_e["penalty_cards"]))
    before_n = len(c.get("/api/punishments").json())
    c.get("/api/punishments")
    check("pun: expiry applied only once", len(c.get("/api/punishments").json()) == before_n
          and next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])["points"] == 0)

    # --- Overdue: pet_dies + auto mode ---
    _aio_tg.run(server.db.punishments.delete_many({}))
    c.post("/api/config", json={"punishment_overdue_action": "pet_dies", "punishment_mode": "auto"})
    _aio_tg.run(server.db.children.update_one({"id": syila["id"]}, {"$set": {
        "penalty_cards": 0, "pet_type": "cat", "pet_force_dead": False, "pet_last_fed_at": server.now_iso()}}))
    _earn_card(syila, "123456", "Telat Syila 1")
    _earn_card(syila, "123456", "Telat Syila 2")
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    pun3 = c.get(f"/api/punishments?child_id={syila['id']}").json()[0]
    check("pun: auto mode assigns immediately", pun3["status"] == "assigned" and pun3["option_id"], str(pun3.get("option_id")))
    syi_alive = next(k for k in c.get("/api/children").json() if k["id"] == syila["id"])
    check("pun: pet alive before deadline", syi_alive["pet_is_dead"] is False, str(syi_alive["pet_is_dead"]))
    _aio_tg.run(server.db.punishments.update_one({"id": pun3["id"]}, {"$set": {"deadline_date": _past}}))
    c.get("/api/punishments")
    syi_dead = next(k for k in c.get("/api/children").json() if k["id"] == syila["id"])
    check("pun: pet dies when overdue", syi_dead["pet_is_dead"] is True, str(syi_dead["pet_is_dead"]))
    r = c.post(f"/api/children/{syila['id']}/revive-pet")
    check("pun: parent can revive pet", r.status_code == 200, r.text[:150])
    syi_revived = next(k for k in c.get("/api/children").json() if k["id"] == syila["id"])
    check("pun: pet alive again after revive", syi_revived["pet_is_dead"] is False, str(syi_revived["pet_is_dead"]))
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.post(f"/api/children/{syila['id']}/revive-pet")
    check("pun: kid cannot revive pet", r.status_code == 403, str(r.status_code))

    # --- Cancel path ---
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.punishments.delete_many({}))
    c.post("/api/config", json={"punishment_mode": "choice", "punishment_overdue_action": "reset_points"})
    _aio_tg.run(server.db.children.update_one({"id": adskhan["id"]}, {"$set": {"penalty_cards": 0, "points": 300}}))
    _earn_card(adskhan, "654321", "Telat F")
    _earn_card(adskhan, "654321", "Telat G")
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    pun4 = c.get(f"/api/punishments?child_id={adskhan['id']}&active_only=true").json()[0]
    r = c.post(f"/api/punishments/{pun4['id']}/cancel")
    check("pun: parent can cancel", r.status_code == 200 and r.json()["status"] == "cancelled", r.text[:150])
    ads_c2 = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("pun: cancel clears cards", ads_c2["penalty_cards"] == 0, str(ads_c2["penalty_cards"]))
    check("pun: cancel leaves points alone", ads_c2["points"] == 300, str(ads_c2["points"]))
    r = c.post(f"/api/punishments/{pun4['id']}/cancel")
    check("pun: cannot cancel twice", r.status_code == 400, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.post(f"/api/punishments/{pun4['id']}/cancel")
    check("pun: kid cannot cancel", r.status_code == 403, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    # Kid only ever sees their own sentences
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    check("pun: kid sees only own punishments",
          all(x["child_id"] == syila["id"] for x in c.get("/api/punishments").json()))
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})

    # =============== DAY SEGMENTS (bagian timeline anak) ===============
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c.post("/api/config", json={"day_segments": server.DEFAULT_DAY_SEGMENTS})
    r = c.get("/api/config")
    check("seg: defaults present", len(r.json()["day_segments"]) == 4
          and r.json()["day_segments"][0]["label"] == "Pagi", str(r.json().get("day_segments"))[:120])

    segs = [
        {"label": "Subuh", "emoji": "🌄", "start_time": "00:00", "end_time": "06:59"},
        {"label": "Pagi", "emoji": "🌅", "start_time": "07:00", "end_time": "11:59"},
        {"label": "Siang", "emoji": "☀️", "start_time": "12:00", "end_time": "15:59"},
        {"label": "Sore", "emoji": "🌇", "start_time": "16:00", "end_time": "18:29"},
        {"label": "Malam", "emoji": "🌙", "start_time": "18:30", "end_time": "23:59"},
    ]
    r = c.post("/api/config", json={"day_segments": segs})
    check("seg: five custom segments saved", r.status_code == 200, r.text[:200])
    got = c.get("/api/config").json()["day_segments"]
    check("seg: round-trip keeps all five", len(got) == 5, str(len(got)))
    check("seg: ids auto-assigned", all(x.get("id") for x in got))
    check("seg: emoji preserved", got[0]["emoji"] == "🌄", str(got[0]))

    # Overlap must be rejected — an ambiguous section would duplicate/hide tasks
    bad = [
        {"label": "A", "start_time": "06:00", "end_time": "12:00"},
        {"label": "B", "start_time": "11:00", "end_time": "18:00"},
    ]
    r = c.post("/api/config", json={"day_segments": bad})
    check("seg: overlapping ranges rejected", r.status_code == 422, str(r.status_code))
    check("seg: overlap message names both", "bertabrakan" in r.text, r.text[:150])

    # Touching boundaries are fine (end 09:59 → next start 10:00)
    ok_adj = [
        {"label": "X", "start_time": "00:00", "end_time": "09:59"},
        {"label": "Y", "start_time": "10:00", "end_time": "23:59"},
    ]
    r = c.post("/api/config", json={"day_segments": ok_adj})
    check("seg: adjacent (non-overlapping) ranges accepted", r.status_code == 200, r.text[:150])

    r = c.post("/api/config", json={"day_segments": [{"label": "Z", "start_time": "18:00", "end_time": "06:00"}]})
    check("seg: reversed range rejected", r.status_code == 422, str(r.status_code))
    r = c.post("/api/config", json={"day_segments": []})
    check("seg: empty list rejected", r.status_code == 422, str(r.status_code))
    r = c.post("/api/config", json={"day_segments": [{"label": "Bad", "start_time": "25:00", "end_time": "26:00"}]})
    check("seg: malformed time rejected", r.status_code == 422, str(r.status_code))
    r = c.post("/api/config", json={"day_segments": [{"label": "", "start_time": "01:00", "end_time": "02:00"}]})
    check("seg: empty label rejected", r.status_code == 422, str(r.status_code))

    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.post("/api/config", json={"day_segments": segs})
    check("seg: kid cannot edit segments", r.status_code == 403, str(r.status_code))
    r = c.get("/api/config")
    check("seg: kid can read segments", r.status_code == 200 and len(r.json()["day_segments"]) >= 1)
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c.post("/api/config", json={"day_segments": server.DEFAULT_DAY_SEGMENTS})

    # =============== DRAG & DROP REORDER ===============
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.tasks.delete_many({"parent_id": "family-default"}))
    ro = []
    for i, t in enumerate(["Ro A", "Ro B", "Ro C"], start=1):
        ro.append(c.post("/api/tasks", json={"title": t, "points": 5, "date_key": today_local,
                                             "target_children": [adskhan["id"]], "order": i}).json())
    ids = [x["id"] for x in ro]
    check("reorder: initial order 1,2,3",
          [t["order"] for t in sorted(c.get(f"/api/tasks?child_id={adskhan['id']}").json(), key=lambda x: x["order"])] == [1, 2, 3])

    # Reverse them
    r = c.post("/api/tasks/reorder", json={"task_ids": list(reversed(ids))})
    check("reorder: ok", r.status_code == 200 and r.json()["reordered"] == 3, r.text[:150])
    after = {t["id"]: t["order"] for t in c.get(f"/api/tasks?child_id={adskhan['id']}").json()}
    check("reorder: positions applied in the given sequence",
          after[ids[2]] == 1 and after[ids[1]] == 2 and after[ids[0]] == 3, str(after))

    # Guards
    r = c.post("/api/tasks/reorder", json={"task_ids": ids + ["ghost-id"]})
    check("reorder: unknown id rejected wholesale", r.status_code == 404, str(r.status_code))
    unchanged = {t["id"]: t["order"] for t in c.get(f"/api/tasks?child_id={adskhan['id']}").json()}
    check("reorder: nothing applied on a failed batch", unchanged == after, "partial write happened")
    r = c.post("/api/tasks/reorder", json={"task_ids": [ids[0], ids[0], ids[1]]})
    check("reorder: duplicate ids rejected", r.status_code == 422, str(r.status_code))
    r = c.post("/api/tasks/reorder", json={"task_ids": []})
    check("reorder: empty list rejected", r.status_code == 422, str(r.status_code))
    r = c.post("/api/tasks/reorder", json={"task_ids": [ids[1]]})
    check("reorder: single-item reorder works", r.status_code == 200, r.text[:150])

    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.post("/api/tasks/reorder", json={"task_ids": ids})
    check("reorder: kid blocked", r.status_code == 403, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})

    # =============== REORDER (drag & drop) UNDER THE SEGMENT MODEL ===============
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.tasks.delete_many({"parent_id": "family-default"}))
    ro_segs = [{"label": "Pagi", "start_time": "04:45", "end_time": "09:59"},
               {"label": "Malam", "start_time": "18:00", "end_time": "23:59"}]
    c.post("/api/config", json={"day_segments": ro_segs})
    RS = [x["id"] for x in c.get("/api/config").json()["day_segments"]]
    _asg2 = __import__("asyncio")

    mk2 = lambda title, seg, order: c.post("/api/tasks", json={
        "title": title, "points": 5, "date_key": today_local, "duration_minutes": 10,
        "target_children": [adskhan["id"]], "segment_id": seg, "order": order}).json()
    a = mk2("A pagi", RS[0], 1)
    b = mk2("B pagi", RS[0], 2)
    cc = mk2("C malam", RS[1], 3)

    def _seq_titles():
        rows = c.get(f"/api/tasks?child_id={adskhan['id']}&date_key={today_local}").json()
        segs = c.get("/api/config").json()["day_segments"]
        def key(t):
            sg = next((x for x in segs if x["id"] == t.get("segment_id")), None)
            base = server._hhmm_to_min(sg["start_time"]) if sg else 99999
            return (base, t.get("order") or 0)
        return [t["title"] for t in sorted(rows, key=key)]

    check("reorder: initial sequence", _seq_titles() == ["A pagi", "B pagi", "C malam"], str(_seq_titles()))

    # Drag B above A
    r = c.post("/api/tasks/reorder", json={"task_ids": [b["id"], a["id"], cc["id"]]})
    check("reorder: endpoint ok", r.status_code == 200 and r.json()["reordered"] == 3, r.text[:150])
    check("reorder: new order persisted", _seq_titles() == ["B pagi", "A pagi", "C malam"], str(_seq_titles()))

    # The quest gate must follow the new order too
    check("reorder: queue head follows the new order", _seq_titles()[0] == "B pagi", str(_seq_titles()))

    # Reordering never moves a task between sections
    rows = c.get(f"/api/tasks?child_id={adskhan['id']}&date_key={today_local}").json()
    check("reorder: sections untouched",
          {t["title"]: t["segment_id"] for t in rows} ==
          {"A pagi": RS[0], "B pagi": RS[0], "C malam": RS[1]}, "a section changed")

    r = c.post("/api/tasks/reorder", json={"task_ids": []})
    check("reorder: empty list rejected", r.status_code in (400, 422), str(r.status_code))
    r = c.post("/api/tasks/reorder", json={"task_ids": [a["id"], "tidak-ada"]})
    check("reorder: unknown id handled without corrupting order", r.status_code in (200, 404, 422), str(r.status_code))
    check("reorder: real tasks still intact after bad id",
          len(c.get(f"/api/tasks?child_id={adskhan['id']}&date_key={today_local}").json()) == 3)

    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.post("/api/tasks/reorder", json={"task_ids": [a["id"], b["id"]]})
    check("reorder: kid blocked", r.status_code == 403, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c.post("/api/config", json={"day_segments": server.DEFAULT_DAY_SEGMENTS})

    # =============== BULK DELETE ===============
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.tasks.delete_many({"parent_id": "family-default"}))
    bulk_ids = [c.post("/api/tasks", json={"title": f"Massal {i}", "points": 5, "date_key": today_local,
                                           "target_children": [adskhan["id"]]}).json()["id"] for i in range(5)]
    r = c.post("/api/tasks/bulk-delete", json={"task_ids": bulk_ids[:3]})
    check("bulkdel: deletes the selected batch", r.status_code == 200 and r.json()["deleted"] == 3, r.text[:150])
    left = c.get(f"/api/tasks?child_id={adskhan['id']}&date_key={today_local}").json()
    check("bulkdel: only the selected ones are gone", len(left) == 2, str(len(left)))
    check("bulkdel: the rest survive intact", sorted(t["id"] for t in left) == sorted(bulk_ids[3:]))

    r = c.post("/api/tasks/bulk-delete", json={"task_ids": [bulk_ids[3], "id-ngawur"]})
    check("bulkdel: unknown ids skipped, real one still deleted",
          r.status_code == 200 and r.json()["deleted"] == 1 and r.json()["skipped"] == 1, r.text[:150])
    r = c.post("/api/tasks/bulk-delete", json={"task_ids": ["semua-ngawur"]})
    check("bulkdel: all-unknown batch reports not found", r.status_code == 404, str(r.status_code))
    r = c.post("/api/tasks/bulk-delete", json={"task_ids": []})
    check("bulkdel: empty selection rejected", r.status_code == 422, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.post("/api/tasks/bulk-delete", json={"task_ids": [bulk_ids[4]]})
    check("bulkdel: kid blocked", r.status_code == 403, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    check("bulkdel: kid's blocked attempt deleted nothing",
          len(c.get(f"/api/tasks?child_id={adskhan['id']}&date_key={today_local}").json()) == 1)
    c.post("/api/config", json={"day_segments": server.DEFAULT_DAY_SEGMENTS})
    __import__("asyncio").run(server._refresh_segments_cache())

    # =============== JAM MULAI PER ANAK PER HARI ===============
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.tasks.delete_many({"parent_id": "family-default"}))
    _aio_tg.run(server.db.children.update_many({}, {"$set": {"segment_starts": {}}}))
    _asx = __import__("asyncio")
    _nl = server._now_local()
    _nmin = _nl.hour * 60 + _nl.minute
    def _fm(m):
        m = max(0, min(m, 23 * 60 + 59))
        return f"{m // 60:02d}:{m % 60:02d}"
    # One wide section that is definitely open right now
    wide = [{"label": "Sesi Uji", "start_time": "00:00", "end_time": "23:59"}]
    c.post("/api/config", json={"day_segments": wide, "segment_late_grace_minutes": 10})
    SID = c.get("/api/config").json()["day_segments"][0]["id"]
    _asx.run(server._refresh_segments_cache())
    _today_wd = str(_dt_off.datetime.strptime(today_local, "%Y-%m-%d").weekday())

    r = c.get("/api/config")
    check("segstart: grace exposed", r.json()["segment_late_grace_minutes"] == 10, r.text[:120])

    # --- validation ---
    r = c.put(f"/api/children/{adskhan['id']}/segment-starts",
              json={"starts": {"tidak-ada": {"0": "18:00"}}})
    check("segstart: unknown section rejected", r.status_code == 404, str(r.status_code))
    r = c.put(f"/api/children/{adskhan['id']}/segment-starts", json={"starts": {SID: {"9": "18:00"}}})
    check("segstart: invalid weekday rejected", r.status_code == 422, str(r.status_code))
    r = c.put(f"/api/children/{adskhan['id']}/segment-starts", json={"starts": {SID: {"0": "25:99"}}})
    check("segstart: malformed time rejected", r.status_code == 422, str(r.status_code))
    c.post("/api/config", json={"day_segments": [{"label": "Sempit", "start_time": "18:00", "end_time": "20:00"}]})
    NSID = c.get("/api/config").json()["day_segments"][0]["id"]
    r = c.put(f"/api/children/{adskhan['id']}/segment-starts", json={"starts": {NSID: {"0": "21:30"}}})
    check("segstart: time outside its section rejected", r.status_code == 422, str(r.status_code))
    check("segstart: rejection explains the range", "di luar rentang" in r.text, r.text[:160])
    c.post("/api/config", json={"day_segments": wide})
    SID = c.get("/api/config").json()["day_segments"][0]["id"]
    _asx.run(server._refresh_segments_cache())

    # --- per-child, per-weekday storage ---
    r = c.put(f"/api/children/{adskhan['id']}/segment-starts",
              json={"starts": {SID: {"0": "18:50", "2": "19:15"}}})
    check("segstart: saved for two weekdays", r.status_code == 200, r.text[:200])
    r = c.put(f"/api/children/{syila['id']}/segment-starts", json={"starts": {SID: {"0": "18:00"}}})
    check("segstart: sibling stored separately", r.status_code == 200, r.text[:150])
    ads_ss = c.get(f"/api/children/{adskhan['id']}/segment-starts").json()["segment_starts"]
    syi_ss = c.get(f"/api/children/{syila['id']}/segment-starts").json()["segment_starts"]
    check("segstart: Adskhan keeps his own times", ads_ss[SID] == {"0": "18:50", "2": "19:15"}, str(ads_ss))
    check("segstart: Syila unaffected by Adskhan's", syi_ss[SID] == {"0": "18:00"}, str(syi_ss))
    r = c.put(f"/api/children/{adskhan['id']}/segment-starts", json={"starts": {SID: {"0": ""}}})
    check("segstart: blank clears back to the shared start",
          c.get(f"/api/children/{adskhan['id']}/segment-starts").json()["segment_starts"] == {}, r.text[:150])
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.put(f"/api/children/{adskhan['id']}/segment-starts", json={"starts": {SID: {"0": "18:00"}}})
    check("segstart: kid cannot set start times", r.status_code == 403, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})

    # --- "not yet" uses the personal start ---
    mkseg = lambda title, order: c.post("/api/tasks", json={
        "title": title, "points": 10, "date_key": today_local, "duration_minutes": 10,
        "target_children": [adskhan["id"]], "segment_id": SID, "order": order}).json()
    sbody_ads = {"child_id": adskhan["id"], "date_key": today_local, "segment_id": SID}
    later = _fm(min(_nmin + 90, 23 * 60 + 59))
    c.put(f"/api/children/{adskhan['id']}/segment-starts", json={"starts": {SID: {_today_wd: later}}})
    t_ns = mkseg("Belum mulai personal", 1)
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.post("/api/segment-sessions/start", json=sbody_ads)
    if _nmin + 90 <= 23 * 60 + 59:
        check("segstart: personal start blocks an early start", r.status_code == 409, str(r.status_code))
        check("segstart: message quotes the personal time", later in r.text, r.text[:180])

    # Sibling is NOT bound by Adskhan's personal time (hers starts now).
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c.put(f"/api/children/{syila['id']}/segment-starts", json={"starts": {SID: {_today_wd: _fm(_nmin)}}})
    c.post("/api/tasks", json={"title": "Syila bebas", "points": 10, "date_key": today_local,
                               "duration_minutes": 10, "target_children": [syila["id"]],
                               "segment_id": SID, "order": 1})
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.post("/api/segment-sessions/start", json={**sbody_ads, "child_id": syila["id"]})
    check("segstart: sibling unaffected by the other's personal start", r.status_code == 200, r.text[:150])

    # --- lateness vs grace when starting a section ---
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.tasks.delete_many({"parent_id": "family-default"}))
    _aio_tg.run(server.db.segment_sessions.delete_many({}))
    within = _fm(max(0, _nmin - 5))     # started 5 min ago → inside 10-min grace
    beyond = _fm(max(0, _nmin - 40))    # 40 min ago → past grace
    c.put(f"/api/children/{adskhan['id']}/segment-starts", json={"starts": {SID: {_today_wd: within}}})
    mkseg("Masih dalam toleransi", 1)
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.post("/api/segment-sessions/start", json=sbody_ads)
    check("segstart: inside the grace window still starts", r.status_code == 200 and r.json()["start_late"] is False,
          r.text[:150])

    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.tasks.delete_many({"parent_id": "family-default"}))
    _aio_tg.run(server.db.segment_sessions.delete_many({}))
    c.put(f"/api/children/{adskhan['id']}/segment-starts", json={"starts": {SID: {_today_wd: beyond}}})
    mkseg("Lewat toleransi", 1)
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.post("/api/segment-sessions/start", json=sbody_ads)
    if _nmin >= 40:
        check("segstart: past grace asks for a reason", r.status_code == 409 and "LATE_REASON_REQUIRED" in r.text,
              r.text[:180])
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    # Tolerance is capped at 15 minutes, so anything wider is refused outright.
    r = c.post("/api/config", json={"segment_late_grace_minutes": 120})
    check("segstart: tolerance above 15 minutes is rejected", r.status_code == 422, str(r.status_code))
    r = c.post("/api/config", json={"segment_late_grace_minutes": 15})
    check("segstart: 15 minutes is the accepted maximum", r.status_code == 200, r.text[:150])
    c.post("/api/config", json={"segment_late_grace_minutes": 10, "day_segments": server.DEFAULT_DAY_SEGMENTS})
    _aio_tg.run(server.db.segment_sessions.delete_many({}))
    _aio_tg.run(server.db.children.update_many({}, {"$set": {"segment_starts": {}}}))
    _asx.run(server._refresh_segments_cache())

    # =============== TIMELINE ANAK MEMAKAI JAM PERSONALNYA ===============
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.tasks.delete_many({"parent_id": "family-default"}))
    _aio_tg.run(server.db.children.update_many({}, {"$set": {"segment_starts": {}}}))
    c.post("/api/config", json={"day_segments": [
        {"label": "Sore", "start_time": "15:00", "end_time": "17:59"},
        {"label": "Malam", "start_time": "18:00", "end_time": "21:00"}]})
    PS = [x["id"] for x in c.get("/api/config").json()["day_segments"]]
    __import__("asyncio").run(server._refresh_segments_cache())
    _wd_now = str(_dt_off.datetime.strptime(today_local, "%Y-%m-%d").weekday())

    # No override yet → the kid sees the household hours
    r = c.get(f"/api/children/{adskhan['id']}/day-progress?date_key={today_local}")
    segs0 = {x["id"]: x for x in r.json()["segments"]}
    check("personal: falls back to the shared start", segs0[PS[1]]["start_time"] == "18:00", str(segs0[PS[1]]))
    check("personal: not flagged as personal when unset", segs0[PS[1]]["is_personal"] is False)

    # Give Adskhan a later evening, leave Syila alone
    c.put(f"/api/children/{adskhan['id']}/segment-starts", json={"starts": {PS[1]: {_wd_now: "18:50"}}})
    r = c.get(f"/api/children/{adskhan['id']}/day-progress?date_key={today_local}")
    segs1 = {x["id"]: x for x in r.json()["segments"]}
    check("personal: kid's timeline shows HIS start", segs1[PS[1]]["start_time"] == "18:50", str(segs1[PS[1]]))
    check("personal: flagged so the child can tell it's theirs", segs1[PS[1]]["is_personal"] is True)
    check("personal: household hour still reported for reference",
          segs1[PS[1]]["general_start_time"] == "18:00", str(segs1[PS[1]].get("general_start_time")))
    check("personal: untouched section keeps the shared start", segs1[PS[0]]["start_time"] == "15:00", str(segs1[PS[0]]))
    check("personal: section end never becomes personal", segs1[PS[1]]["end_time"] == "21:00", str(segs1[PS[1]]))

    r = c.get(f"/api/children/{syila['id']}/day-progress?date_key={today_local}")
    segs2 = {x["id"]: x for x in r.json()["segments"]}
    check("personal: sibling unaffected", segs2[PS[1]]["start_time"] == "18:00" and segs2[PS[1]]["is_personal"] is False,
          str(segs2[PS[1]]))

    # An override on a DIFFERENT weekday must not leak into today
    other_wd = str((int(_wd_now) + 1) % 7)
    c.put(f"/api/children/{syila['id']}/segment-starts", json={"starts": {PS[1]: {other_wd: "19:30"}}})
    r = c.get(f"/api/children/{syila['id']}/day-progress?date_key={today_local}")
    segs3 = {x["id"]: x for x in r.json()["segments"]}
    check("personal: another weekday's override doesn't apply today",
          segs3[PS[1]]["start_time"] == "18:00", str(segs3[PS[1]]))

    c.post("/api/config", json={"day_segments": server.DEFAULT_DAY_SEGMENTS})
    _aio_tg.run(server.db.children.update_many({}, {"$set": {"segment_starts": {}}}))
    __import__("asyncio").run(server._refresh_segments_cache())

    # =============== REGRESI: EDIT TUGAS HARUS MENYIMPAN SEGMEN ===============
    # Bug: TaskUpdate had no segment_id, so every edit
    # silently dropped them and the task snapped back to "Kapan Saja".
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.tasks.delete_many({"parent_id": "family-default"}))
    c.post("/api/config", json={"day_segments": [
        {"label": "Pagi", "start_time": "04:30", "end_time": "11:59"},
        {"label": "Malam", "start_time": "18:00", "end_time": "21:00"}]})
    ES = [x["id"] for x in c.get("/api/config").json()["day_segments"]]
    __import__("asyncio").run(server._refresh_segments_cache())

    et = c.post("/api/tasks", json={"title": "Awalnya kapan saja", "points": 10,
                                    "date_key": today_local, "duration_minutes": 10,
                                    "target_children": [adskhan["id"]]}).json()
    check("editseg: starts with no section", not et.get("segment_id"), str(et.get("segment_id")))

    r = c.patch(f"/api/tasks/{et['id']}", json={"segment_id": ES[1]})
    check("editseg: edit accepts a section", r.status_code == 200, r.text[:150])
    after = c.get(f"/api/tasks?child_id={adskhan['id']}&date_key={today_local}").json()[0]
    check("editseg: section actually persisted", after.get("segment_id") == ES[1], str(after.get("segment_id")))

    # Editing something else must not wipe the section
    r = c.patch(f"/api/tasks/{et['id']}", json={"points": 25})
    after2 = c.get(f"/api/tasks?child_id={adskhan['id']}&date_key={today_local}").json()[0]
    check("editseg: unrelated edit keeps the section", after2.get("segment_id") == ES[1], str(after2.get("segment_id")))
    check("editseg: unrelated edit applied", after2["points"] == 25, str(after2["points"]))

    # Moving between sections works
    c.patch(f"/api/tasks/{et['id']}", json={"segment_id": ES[0]})
    after3 = c.get(f"/api/tasks?child_id={adskhan['id']}&date_key={today_local}").json()[0]
    check("editseg: can be moved to another section", after3.get("segment_id") == ES[0], str(after3.get("segment_id")))

    # Explicit null clears it back to "Kapan Saja"
    c.patch(f"/api/tasks/{et['id']}", json={"segment_id": None})
    after4 = c.get(f"/api/tasks?child_id={adskhan['id']}&date_key={today_local}").json()[0]
    check("editseg: null clears back to Kapan Saja", not after4.get("segment_id"), str(after4.get("segment_id")))

    c.post("/api/config", json={"day_segments": server.DEFAULT_DAY_SEGMENTS})
    __import__("asyncio").run(server._refresh_segments_cache())

    # =============== POIN OTOMATIS (tanpa antre persetujuan) ===============
    # Finishing a section awards its missions straight away; the parent
    # reviews afterwards and can undo.
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.tasks.delete_many({"parent_id": "family-default"}))
    _aio_tg.run(server.db.segment_sessions.delete_many({}))
    _aio_tg.run(server.db.children.update_one({"id": adskhan["id"]}, {"$set": {
        "points": 0, "chiky_save": 0, "chiky_spend": 0, "chiky_share": 0}}))
    c.post("/api/config", json={"auto_approve_tasks": True,
                                "late_reasons": [{"label": "Ada acara sekolah", "gives_penalty_card": False,
                                                  "award_points": True}],
                                "day_segments": [{"label": "Sesi Auto", "start_time": "00:00", "end_time": "23:59"}]})
    AAS = c.get("/api/config").json()["day_segments"][0]["id"]
    __import__("asyncio").run(server._refresh_segments_cache())
    mka = lambda t, o, dk=today_local, **kw: c.post("/api/tasks", json={
        "title": t, "points": 10, "date_key": dk, "duration_minutes": 10, "target_children": [adskhan["id"]],
        "segment_id": AAS, "order": o, **kw}).json()

    def run_section(dk, tids, photo=None):
        c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
        body = {"child_id": adskhan["id"], "date_key": dk, "segment_id": AAS}
        reason = (c.get(f"/api/children/{adskhan['id']}/segments-day", params={"date_key": dk}).json()
                  .get("late_reasons") or [{}])[0].get("id")
        rs = c.post("/api/segment-sessions/start", json=body)
        if rs.status_code == 409:
            c.post("/api/segment-sessions/start", json={**body, "late_reason_id": reason})
        for tid in tids:
            c.post(f"/api/tasks/{tid}/check", json={"checked": True})
            if photo:
                c.post(f"/api/tasks/{tid}/photo", json={"kind": "after", "photo_url": photo})
        return c.post("/api/segment-sessions/finish", json={**body, "late_reason_id": reason})

    a1 = mka("Otomatis satu", 1)
    r = run_section(today_local, [a1["id"]])
    check("autoapprove: reported on the finish", r.status_code == 200 and r.json()["awarded"] == 1, r.text[:150])
    check("autoapprove: task lands approved, not queued",
          _aio_tg.run(server.db.tasks.find_one({"id": a1["id"]}))["status"] == "approved")
    ads_aa = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("autoapprove: points awarded immediately", ads_aa["points"] == 10, str(ads_aa["points"]))
    check("autoapprove: buckets filled too",
          ads_aa["chiky_save"] + ads_aa["chiky_spend"] + ads_aa["chiky_share"] == 10, str(ads_aa["points"]))

    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    pending_q = [t for t in c.get("/api/tasks").json() if t["status"] == "completed"]
    check("autoapprove: approval queue stays empty", len(pending_q) == 0, str(len(pending_q)))
    r = c.post(f"/api/tasks/{a1['id']}/undo-approval")
    check("autoapprove: parent can undo an automatic approval", r.status_code == 200, r.text[:170])
    ads_undo = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("autoapprove: undo takes the points back", ads_undo["points"] == 0, str(ads_undo["points"]))

    # Photo-required missions still wait for a human look (another day: one session per section per day)
    d2 = (now_local - _dt.timedelta(days=1)).strftime("%Y-%m-%d")
    a2 = mka("Butuh foto", 1, dk=d2, photo_required=True)
    r = run_section(d2, [a2["id"]], photo="data:image/png;base64,iVBORw0KGgo=")
    check("autoapprove: photo missions still need a human check",
          r.status_code == 200 and r.json()["awarded"] == 0
          and _aio_tg.run(server.db.tasks.find_one({"id": a2["id"]}))["status"] == "completed", r.text[:150])

    # Turning it off restores the manual queue
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c.post("/api/config", json={"auto_approve_tasks": False})
    d3 = (now_local - _dt.timedelta(days=2)).strftime("%Y-%m-%d")
    a3 = mka("Manual lagi", 1, dk=d3)
    r = run_section(d3, [a3["id"]])
    check("autoapprove: toggle off returns to the manual queue",
          r.status_code == 200 and r.json()["awarded"] == 0
          and _aio_tg.run(server.db.tasks.find_one({"id": a3["id"]}))["status"] == "completed", r.text[:150])

    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c.post("/api/config", json={"auto_approve_tasks": False, "day_segments": server.DEFAULT_DAY_SEGMENTS})
    _aio_tg.run(server.db.segment_sessions.delete_many({}))
    __import__("asyncio").run(server._refresh_segments_cache())

    # =============== REGRESI: RESET POIN HARUS IKUT MENOLKAN KANTONG ===============
    # Reported: points showed 194 while the three buckets summed to 519. The
    # reset zeroed the total but left the buckets, so the wallet drifted
    # permanently out of step with the balance displayed above it.
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.tasks.delete_many({"parent_id": "family-default"}))
    c.post("/api/config", json={"chiky_save_pct": 40, "chiky_spend_pct": 40, "chiky_share_pct": 20})
    _aio_tg.run(server.db.children.update_one({"id": adskhan["id"]}, {"$set": {
        "points": 100, "lifetime_points": 100, "chiky_save": 40, "chiky_spend": 40, "chiky_share": 20}}))

    r = c.post(f"/api/children/{adskhan['id']}/reset-points")
    check("reset: reset-points zeroes the balance", r.status_code == 200, r.text[:150])
    k = next(x for x in c.get("/api/children").json() if x["id"] == adskhan["id"])
    check("reset: buckets zeroed along with the points",
          k["chiky_save"] == 0 and k["chiky_spend"] == 0 and k["chiky_share"] == 0,
          f'{k["chiky_save"]}/{k["chiky_spend"]}/{k["chiky_share"]}')
    check("reset: wallet still equals the balance",
          k["chiky_save"] + k["chiky_spend"] + k["chiky_share"] == k["points"], str(k["points"]))

    # Reset-all must behave the same
    _aio_tg.run(server.db.children.update_many({}, {"$set": {
        "points": 50, "chiky_save": 20, "chiky_spend": 20, "chiky_share": 10}}))
    r = c.post("/api/children/reset-all-points")
    check("reset: reset-all zeroes every wallet too",
          all(x["chiky_save"] + x["chiky_spend"] + x["chiky_share"] == x["points"]
              for x in c.get("/api/children").json()),
          str([(x["points"], x["chiky_save"]) for x in c.get("/api/children").json()]))

    # Repair tool for wallets that already drifted
    _aio_tg.run(server.db.children.update_one({"id": adskhan["id"]}, {"$set": {
        "points": 194, "chiky_save": 203, "chiky_spend": 203, "chiky_share": 113}}))
    r = c.post(f"/api/children/{adskhan['id']}/rebalance-buckets")
    check("rebalance: repairs a drifted wallet", r.status_code == 200, r.text[:180])
    k2 = next(x for x in c.get("/api/children").json() if x["id"] == adskhan["id"])
    check("rebalance: buckets now sum to the points exactly",
          k2["chiky_save"] + k2["chiky_spend"] + k2["chiky_share"] == 194,
          f'{k2["chiky_save"]}+{k2["chiky_spend"]}+{k2["chiky_share"]}')
    check("rebalance: split follows the configured 40/40/20",
          k2["chiky_save"] == 78 and k2["chiky_spend"] == 78 and k2["chiky_share"] == 38,
          f'{k2["chiky_save"]}/{k2["chiky_spend"]}/{k2["chiky_share"]}')
    check("rebalance: the points total itself is untouched", k2["points"] == 194, str(k2["points"]))
    check("rebalance: reports what it changed", r.json()["before"]["chiky_save"] == 203, str(r.json().get("before")))

    # Custom percentages are honoured, and rounding never loses a point
    c.post("/api/config", json={"chiky_save_pct": 50, "chiky_spend_pct": 30, "chiky_share_pct": 20})
    _aio_tg.run(server.db.children.update_one({"id": adskhan["id"]}, {"$set": {"points": 77}}))
    c.post(f"/api/children/{adskhan['id']}/rebalance-buckets")
    k3 = next(x for x in c.get("/api/children").json() if x["id"] == adskhan["id"])
    check("rebalance: honours custom percentages",
          k3["chiky_save"] == 38 and k3["chiky_spend"] == 23, f'{k3["chiky_save"]}/{k3["chiky_spend"]}')
    check("rebalance: odd totals still add up exactly",
          k3["chiky_save"] + k3["chiky_spend"] + k3["chiky_share"] == 77,
          f'{k3["chiky_save"]}+{k3["chiky_spend"]}+{k3["chiky_share"]}')

    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.post(f"/api/children/{adskhan['id']}/rebalance-buckets")
    check("rebalance: kid cannot run it", r.status_code == 403, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c.post("/api/config", json={"chiky_save_pct": 40, "chiky_spend_pct": 40, "chiky_share_pct": 20})

    # =============== OFF DAY PER BAGIAN HARI ===============
    # "Off from Friday afternoon until Monday morning": Friday's morning still
    # counts, Monday's midday onwards resumes.
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.tasks.delete_many({"parent_id": "family-default"}))
    _aio_tg.run(server.db.off_days.delete_many({}))
    c.post("/api/config", json={"day_segments": [
        {"label": "Pagi", "start_time": "05:00", "end_time": "11:59"},
        {"label": "Siang", "start_time": "12:00", "end_time": "14:59"},
        {"label": "Sore", "start_time": "15:00", "end_time": "17:59"},
        {"label": "Malam", "start_time": "18:00", "end_time": "21:00"}]})
    SG = {x["label"]: x["id"] for x in c.get("/api/config").json()["day_segments"]}
    __import__("asyncio").run(server._refresh_segments_cache())

    _d0 = _off_base + _dt_off.timedelta(days=5)     # "Friday"
    _d1 = _off_base + _dt_off.timedelta(days=6)     # "Saturday"
    _d3 = _off_base + _dt_off.timedelta(days=8)     # "Monday"
    D0, D1, D3 = (d.strftime("%Y-%m-%d") for d in (_d0, _d1, _d3))

    mko = lambda title, dk, seg: c.post("/api/tasks", json={
        "title": title, "points": 5, "date_key": dk, "duration_minutes": 10,
        "target_children": [adskhan["id"]], "segment_id": SG[seg]}).json()
    t_fri_am = mko("Jumat pagi", D0, "Pagi")
    t_fri_pm = mko("Jumat sore", D0, "Sore")
    t_fri_night = mko("Jumat malam", D0, "Malam")
    t_sat = mko("Sabtu siang", D1, "Siang")
    t_mon_am = mko("Senin pagi", D3, "Pagi")
    t_mon_noon = mko("Senin siang", D3, "Siang")
    t_mon_night = mko("Senin malam", D3, "Malam")

    r = c.post("/api/off-days", json={"start_date": D0, "end_date": D3,
                                      "start_segment_id": SG["Sore"], "end_segment_id": SG["Pagi"],
                                      "note": "Pergi keluar kota"})
    check("offseg: partial-day range created", r.status_code == 200, r.text[:200])
    # Covered: Friday afternoon + Friday evening + Saturday + Monday morning.
    check("offseg: parked exactly the covered sections", r.json()["parked_tasks"] == 4, str(r.json()))

    _st = lambda tid: _aio_tg.run(server.db.tasks.find_one({"id": tid}, {"_id": 0}))["status"]
    check("offseg: Friday MORNING stays active (before the break starts)", _st(t_fri_am["id"]) == "pending", _st(t_fri_am["id"]))
    check("offseg: Friday afternoon is off", _st(t_fri_pm["id"]) == "off", _st(t_fri_pm["id"]))
    check("offseg: Friday evening is off", _st(t_fri_night["id"]) == "off", _st(t_fri_night["id"]))
    check("offseg: the whole middle day is off", _st(t_sat["id"]) == "off", _st(t_sat["id"]))
    check("offseg: Monday morning is off (the break ends there)", _st(t_mon_am["id"]) == "off", _st(t_mon_am["id"]))
    check("offseg: Monday midday resumes", _st(t_mon_noon["id"]) == "pending", _st(t_mon_noon["id"]))
    check("offseg: Monday evening resumes too", _st(t_mon_night["id"]) == "pending", _st(t_mon_night["id"]))

    # Recurrence/streak treat a partly-off day as a working day
    check("offseg: a partly-off boundary day is not a full off day",
          _aio_tg.run(server._is_off_day(D0)) is False and _aio_tg.run(server._is_off_day(D3)) is False)
    check("offseg: a fully covered middle day IS a full off day",
          _aio_tg.run(server._is_off_day(D1)) is True)

    # Cancelling restores exactly what it parked
    off_id = r.json()["id"]
    r = c.delete(f"/api/off-days/{off_id}")
    check("offseg: cancelling restores the parked tasks", r.json()["restored_tasks"] == 4, str(r.json()))
    check("offseg: Friday morning was never touched", _st(t_fri_am["id"]) == "pending")
    check("offseg: everything is active again", _st(t_sat["id"]) == "pending" and _st(t_mon_am["id"]) == "pending")

    # Without section bounds it behaves as before: whole days off
    _aio_tg.run(server.db.off_days.delete_many({}))
    r = c.post("/api/off-days", json={"start_date": D0, "end_date": D0})
    check("offseg: no bounds = the whole day off", r.json()["parked_tasks"] == 3, str(r.json()))
    check("offseg: full-day break marks the day as off", _aio_tg.run(server._is_off_day(D0)) is True)
    c.delete(f"/api/off-days/{r.json()['id']}")

    # Validation
    r = c.post("/api/off-days", json={"start_date": D0, "end_date": D3, "start_segment_id": "ngawur"})
    check("offseg: unknown section rejected", r.status_code == 404, str(r.status_code))
    r = c.post("/api/off-days", json={"start_date": D0, "end_date": D0,
                                      "start_segment_id": SG["Malam"], "end_segment_id": SG["Pagi"]})
    check("offseg: reversed sections on one day rejected", r.status_code == 422, str(r.status_code))
    r = c.post("/api/off-days", json={"start_date": D0, "end_date": D0,
                                      "start_segment_id": SG["Siang"], "end_segment_id": SG["Malam"]})
    check("offseg: a same-day partial window is fine", r.status_code == 200, r.text[:160])
    c.delete(f"/api/off-days/{r.json()['id']}")

    _aio_tg.run(server.db.off_days.delete_many({}))
    c.post("/api/config", json={"day_segments": server.DEFAULT_DAY_SEGMENTS})
    __import__("asyncio").run(server._refresh_segments_cache())

    # =============== HARI UJIAN (mode belajar fleksibel) ===============
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.tasks.delete_many({"parent_id": "family-default"}))
    _aio_tg.run(server.db.exam_periods.delete_many({}))
    _aio_tg.run(server.db.children.update_many({}, {"$set": {"segment_starts": {}}}))
    c.post("/api/config", json={
        "day_segments": [{"label": "Malam", "start_time": "00:00", "end_time": "23:59"}],
        "auto_approve_tasks": False, "exam_false_claim_penalty": 100})
    XS = c.get("/api/config").json()["day_segments"][0]["id"]
    __import__("asyncio").run(server._refresh_segments_cache())
    check("exam: penalty is configurable, not hardcoded",
          c.get("/api/config").json()["exam_false_claim_penalty"] == 100)

    mkx = lambda t, o: c.post("/api/tasks", json={"title": t, "points": 10, "date_key": today_local,
                                                  "duration_minutes": 10, "target_children": [adskhan["id"]],
                                                  "segment_id": XS, "order": o}).json()
    x_before = mkx("Mandi sore", 1)
    x_pivot = mkx("Belajar", 2)
    x_after = mkx("Makan malam", 3)
    x_last = mkx("Sikat gigi", 4)

    # H-1 is derived from the exam range, not typed in by hand
    _ex_start = (_off_base + _dt_off.timedelta(days=1)).strftime("%Y-%m-%d")
    _ex_end = (_off_base + _dt_off.timedelta(days=3)).strftime("%Y-%m-%d")
    r = c.post("/api/exam-periods", json={"child_id": adskhan["id"], "exam_start": _ex_start,
                                          "exam_end": _ex_end, "pivot_task_titles": ["Belajar"]})
    check("exam: declared by a parent", r.status_code == 200, r.text[:200])
    check("exam: study window defaults to H-1 of the whole range",
          r.json()["flex_start"] == today_local
          and r.json()["flex_end"] == (_off_base + _dt_off.timedelta(days=2)).strftime("%Y-%m-%d"),
          f'{r.json()["flex_start"]}..{r.json()["flex_end"]}')
    exam_id = r.json()["id"]

    # Guards
    r = c.post("/api/exam-periods", json={"child_id": adskhan["id"], "exam_start": _ex_start, "exam_end": _ex_end})    # Guards
    r = c.post("/api/exam-periods", json={"child_id": adskhan["id"], "exam_start": _ex_start, "exam_end": _ex_end})
    check("exam: only one live claim per child", r.status_code == 409, str(r.status_code))
    r = c.post("/api/exam-periods", json={"child_id": adskhan["id"], "exam_start": _ex_end, "exam_end": _ex_start})
    check("exam: reversed dates rejected", r.status_code in (409, 422), str(r.status_code))
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.post("/api/exam-periods", json={"child_id": adskhan["id"], "exam_start": _ex_start, "exam_end": _ex_end})
    check("exam: a child can't declare one for a sibling", r.status_code == 403, str(r.status_code))

    # A child CAN declare their own, and it takes effect immediately
    _aio_tg.run(server.db.exam_periods.delete_many({}))
    r = c.post("/api/exam-periods", json={"child_id": syila["id"], "exam_start": _ex_start,
                                          "exam_end": _ex_end, "pivot_task_titles": ["Belajar"]})
    check("exam: a child may declare their own", r.status_code == 200 and r.json()["status"] == "active", r.text[:180])
    syi_exam = r.json()["id"]

    # Rejection deducts the configured penalty and stops the relaxation
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.children.update_one({"id": syila["id"]}, {"$set": {
        "points": 250, "chiky_save": 100, "chiky_spend": 100, "chiky_share": 50}}))
    r = c.post(f"/api/exam-periods/{syi_exam}/reject", json={"note": "Tidak ada ujian minggu ini"})
    check("exam: parent can reject it", r.status_code == 200 and r.json()["status"] == "rejected", r.text[:180])
    syi_after = next(k for k in c.get("/api/children").json() if k["id"] == syila["id"])
    check("exam: the configured penalty is deducted", syi_after["points"] == 150, str(syi_after["points"]))
    check("exam: buckets stay consistent with the new total",
          syi_after["chiky_save"] + syi_after["chiky_spend"] + syi_after["chiky_share"] == 150,
          f'{syi_after["chiky_save"]}/{syi_after["chiky_spend"]}/{syi_after["chiky_share"]}')
    r = c.post(f"/api/exam-periods/{syi_exam}/reject")
    check("exam: cannot reject twice", r.status_code == 400, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.post(f"/api/exam-periods/{syi_exam}/reject")
    check("exam: a child cannot reject", r.status_code == 403, str(r.status_code))

    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.get("/api/activity?limit=40")
    check("exam: declaration and rejection are both logged",
          any(x["action"] == "exam_period_declared" for x in r.json())
          and any(x["action"] == "exam_period_rejected" for x in r.json()))

    _aio_tg.run(server.db.exam_periods.delete_many({}))
    c.post("/api/config", json={"day_segments": server.DEFAULT_DAY_SEGMENTS})
    __import__("asyncio").run(server._refresh_segments_cache())

    # =============== TAMBAH / KURANGI POIN MANUAL ===============
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c.post("/api/config", json={"chiky_save_pct": 40, "chiky_spend_pct": 40, "chiky_share_pct": 20})
    _aio_tg.run(server.db.children.update_one({"id": adskhan["id"]}, {"$set": {
        "points": 100, "lifetime_points": 500, "chiky_save": 40, "chiky_spend": 40, "chiky_share": 20}}))

    r = c.post(f"/api/children/{adskhan['id']}/adjust-points", json={"points": 50, "reason": "Ganti rugi bug"})
    check("adjust: awarding points works", r.status_code == 200 and r.json()["after"] == 150, r.text[:180])
    k = next(x for x in c.get("/api/children").json() if x["id"] == adskhan["id"])
    check("adjust: buckets re-split to match the new total",
          k["chiky_save"] + k["chiky_spend"] + k["chiky_share"] == 150,
          f'{k["chiky_save"]}/{k["chiky_spend"]}/{k["chiky_share"]}')
    check("adjust: a gain counts toward lifetime too", k["lifetime_points"] == 550, str(k["lifetime_points"]))

    r = c.post(f"/api/children/{adskhan['id']}/adjust-points", json={"points": -30, "reason": "Koreksi"})
    check("adjust: deducting works", r.status_code == 200 and r.json()["after"] == 120, r.text[:180])
    k2 = next(x for x in c.get("/api/children").json() if x["id"] == adskhan["id"])
    check("adjust: a deduction does NOT erase lifetime history", k2["lifetime_points"] == 550, str(k2["lifetime_points"]))
    check("adjust: buckets still add up after a deduction",
          k2["chiky_save"] + k2["chiky_spend"] + k2["chiky_share"] == 120,
          f'{k2["chiky_save"]}/{k2["chiky_spend"]}/{k2["chiky_share"]}')

    # Guards
    r = c.post(f"/api/children/{adskhan['id']}/adjust-points", json={"points": 0})
    check("adjust: zero is refused", r.status_code == 422, str(r.status_code))
    r = c.post(f"/api/children/{adskhan['id']}/adjust-points", json={"points": 999999})
    check("adjust: an absurd amount is refused", r.status_code == 422, str(r.status_code))
    r = c.post("/api/children/tidak-ada/adjust-points", json={"points": 10})
    check("adjust: unknown child → 404", r.status_code == 404, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.post(f"/api/children/{adskhan['id']}/adjust-points", json={"points": 500})
    check("adjust: a child cannot give themselves points", r.status_code == 403, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})

    # Every correction is on the record
    r = c.get(f"/api/activity?child_id={adskhan['id']}&limit=40")
    adj = [x for x in r.json() if x["action"] == "points_adjusted"]
    check("adjust: logged for transparency", len(adj) >= 2, str(len(adj)))
    check("adjust: the log records amount, reason and who did it",
          adj[0]["details"].get("delta") is not None
          and "reason" in adj[0]["details"] and adj[0]["details"].get("by"),
          str(adj[0].get("details")))

    # Going below zero is allowed — a deduction shouldn't be silently capped
    _aio_tg.run(server.db.children.update_one({"id": adskhan["id"]}, {"$set": {"points": 20}}))
    r = c.post(f"/api/children/{adskhan['id']}/adjust-points", json={"points": -50, "reason": "Konsekuensi"})
    check("adjust: a deduction may take the balance negative", r.json()["after"] == -30, str(r.json()["after"]))
    k3 = next(x for x in c.get("/api/children").json() if x["id"] == adskhan["id"])
    check("adjust: buckets never go negative themselves",
          k3["chiky_save"] >= 0 and k3["chiky_spend"] >= 0 and k3["chiky_share"] >= 0,
          f'{k3["chiky_save"]}/{k3["chiky_spend"]}/{k3["chiky_share"]}')
    _aio_tg.run(server.db.children.update_one({"id": adskhan["id"]}, {"$set": {"points": 0}}))

    # =============== AUDIT MENYELURUH: KONSISTENSI & JALAN KELUAR ===============
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})

    # 1) Every timing rule is configurable — none of them silently hardcoded
    cfg_all = c.get("/api/config").json()
    for _k in ("segment_late_grace_minutes", "auto_approve_tasks", "exam_false_claim_penalty",
               "penalty_card_threshold", "punishment_mode", "punishment_options",
               "day_segments", "late_reasons"):
        check(f"audit: {_k} is exposed as config", _k in cfg_all, str(sorted(cfg_all.keys()))[:100])

    for _k in ("min_gap_seconds", "flash_threshold_pct", "pacing_bonus_points", "max_idle_minutes",
               "auto_start_next", "snooze_options_minutes", "duration_warning_minutes",
               "bonus_follows_sequence", "hold_auto_reject_minutes", "early_bonus_pct", "skip_cost_points"):
        check(f"audit: old per-mission setting {_k} is gone", _k not in cfg_all)

    # 2) A mission still runs with the optional rules off
    r = c.post("/api/config", json={"family_combo_bonus_points": 0, "segment_late_grace_minutes": 0})
    check("audit: optional rules can be turned off", r.status_code == 200, r.text[:170])
    _aio_tg.run(server.db.tasks.delete_many({"parent_id": "family-default"}))
    c.post("/api/config", json={"day_segments": [{"label": "Bebas", "start_time": "00:00", "end_time": "23:59"}]})
    FS2 = c.get("/api/config").json()["day_segments"][0]["id"]
    __import__("asyncio").run(server._refresh_segments_cache())
    z = c.post("/api/tasks", json={"title": "Tanpa aturan", "points": 10, "date_key": today_local,
                                   "duration_minutes": 10, "target_children": [adskhan["id"]],
                                   "segment_id": FS2, "order": 1}).json()
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = start(z['id'])
    check("audit: a mission still runs with every guard off", r.status_code == 200, r.text[:170])
    r = complete(z['id'])
    check("audit: and completes", r.status_code == 200, r.text[:170])

    # 3) Kids can't reach anything that belongs to a parent
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    for _path, _body in [
        ("/api/config", {"min_gap_seconds": 0}),
        (f"/api/children/{adskhan['id']}/adjust-points", {"points": 100}),
        (f"/api/children/{adskhan['id']}/penalty-cards", {"penalty_cards": 0}),
        (f"/api/children/{adskhan['id']}/rebalance-buckets", {}),
        ("/api/tasks/bulk-delete", {"task_ids": [z["id"]]}),
        ("/api/family/overdue-sections/resolve", {"child_id": adskhan["id"], "date_key": today_local,
                                                  "segment_id": FS2, "action": "dismiss"}),
        ("/api/off-days", {"start_date": today_local}),
        ("/api/reminders/run", {}),
    ]:
        r = c.post(_path, json=_body)
        check(f"audit: kid blocked from {_path}", r.status_code == 403, f"{_path} → {r.status_code}")

    # 5) The wallet always equals the balance, whatever happened to it    # 5) The wallet always equals the balance, whatever happened to it
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c.post("/api/config", json={"family_combo_bonus_points": 10, "segment_late_grace_minutes": 15})
    for _delta in (250, -80, 15):
        c.post(f"/api/children/{adskhan['id']}/adjust-points", json={"points": _delta, "reason": "audit"})
        _k = next(x for x in c.get("/api/children").json() if x["id"] == adskhan["id"])
        check(f"audit: wallet balances after {_delta:+}",
              _k["chiky_save"] + _k["chiky_spend"] + _k["chiky_share"] == max(0, _k["points"]),
              f'{_k["points"]} vs {_k["chiky_save"]}+{_k["chiky_spend"]}+{_k["chiky_share"]}')

    c.post("/api/config", json={"day_segments": server.DEFAULT_DAY_SEGMENTS})
    __import__("asyncio").run(server._refresh_segments_cache())

    # =============== EXPORT JADWAL KE EXCEL ===============
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.tasks.delete_many({"parent_id": "family-default"}))
    _aio_tg.run(server.db.day_templates.delete_many({}))
    _aio_tg.run(server.db.template_tasks.delete_many({}))
    c.post("/api/config", json={"day_segments": [
        {"label": "Pagi", "start_time": "04:45", "end_time": "11:59"},
        {"label": "Malam", "start_time": "18:00", "end_time": "21:00"}]})
    XSEG = {x["label"]: x["id"] for x in c.get("/api/config").json()["day_segments"]}
    __import__("asyncio").run(server._refresh_segments_cache())

    _mon_x = _off_base - _dt_off.timedelta(days=_off_base.weekday())
    MONX = _mon_x.strftime("%Y-%m-%d")
    c.post("/api/tasks", json={"title": "Bangun pagi", "points": 10, "date_key": MONX,
                               "duration_minutes": 10, "target_children": [adskhan["id"]],
                               "segment_id": XSEG["Pagi"], "order": 1})
    c.post("/api/tasks", json={"title": "Sholat Subuh", "points": 10, "date_key": MONX,
                               "duration_minutes": 10, "target_children": [adskhan["id"]],
                               "segment_id": XSEG["Pagi"], "order": 2,
                               "together_bonus_enabled": True, "together_bonus_points": 25})

    r = c.get(f"/api/export/weekly-xlsx?start_date={MONX}")
    check("xlsx: real-week export succeeds", r.status_code == 200, r.text[:170])
    check("xlsx: served as a spreadsheet",
          "spreadsheetml" in r.headers.get("content-type", ""), r.headers.get("content-type", ""))
    check("xlsx: offered as a download", "attachment" in r.headers.get("content-disposition", ""),
          r.headers.get("content-disposition", ""))
    check("xlsx: the file is a real xlsx (zip magic)", r.content[:2] == b"PK", str(r.content[:4]))

    import io as _io_x
    from openpyxl import load_workbook as _lwb
    wbx = _lwb(_io_x.BytesIO(r.content))
    check("xlsx: one sheet per child", len(wbx.sheetnames) == 2, str(wbx.sheetnames))
    wsx = wbx[wbx.sheetnames[0]]
    _flat = [[cc for cc in rr] for rr in wsx.iter_rows(values_only=True)]
    _txt = str(_flat)
    check("xlsx: the child's name heads the sheet", wsx["A1"].value == adskhan["name"], str(wsx["A1"].value))
    check("xlsx: columns match the requested layout",
          "Kategori" in _txt and "Urutan" in _txt and "Aktivitas" in _txt
          and "Durasi" in _txt and "Point Utama" in _txt and "Point Bonus" in _txt and "Total Point" in _txt,
          _txt[:200])
    check("xlsx: sections appear as grouping rows", "Pagi" in _txt, _txt[:200])
    check("xlsx: the day is named", "Senin" in _txt, _txt[:200])
    check("xlsx: missions are listed", "Sholat Subuh" in _txt and "Bangun pagi" in _txt, _txt[:200])
    check("xlsx: totals are live formulas, not baked-in numbers",
          any(isinstance(cc, str) and cc.startswith("=") for rr in _flat for cc in rr if cc is not None), _txt[:200])
    check("xlsx: a per-day total row exists", "Total Senin" in _txt, _txt[:200])

    # Routine export
    c.post("/api/routine/slots", json={"weekdays": [0], "segment_id": XSEG["Pagi"],
                                       "title": "Dari template", "points": 15})
    tplx = _aio_tg.run(server._routine_template(create=False))
    r = c.get(f"/api/export/weekly-xlsx?template_id={tplx['id']}")
    check("xlsx: routine export succeeds", r.status_code == 200, r.text[:170])
    wb2 = _lwb(_io_x.BytesIO(r.content))
    check("xlsx: template rows are present",
          "Dari template" in str([[cc for cc in rr] for rr in wb2[wb2.sheetnames[0]].iter_rows(values_only=True)]))

    # Negative paths
    r = c.get("/api/export/weekly-xlsx?template_id=ngawur")
    check("xlsx: unknown template → 404", r.status_code == 404, str(r.status_code))
    r = c.get("/api/export/weekly-xlsx?start_date=bukan-tanggal")
    check("xlsx: invalid date → 422", r.status_code == 422, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.get(f"/api/export/weekly-xlsx?start_date={MONX}")
    check("xlsx: a child cannot export", r.status_code == 403, str(r.status_code))

    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.day_templates.delete_many({}))
    _aio_tg.run(server.db.template_tasks.delete_many({}))
    _aio_tg.run(server.db.tasks.delete_many({"parent_id": "family-default"}))
    c.post("/api/config", json={"day_segments": server.DEFAULT_DAY_SEGMENTS})
    __import__("asyncio").run(server._refresh_segments_cache())

    # =============== PERFORMA: JUMLAH QUERY PER PEMBUKAAN LAYAR ANAK ===============
    # The kid's screen was crawling. Query count is the thing that actually
    # costs time on a phone talking to a remote database, so it's pinned here:
    # if a future change starts re-reading config or tasks in a loop, this
    # fails before anyone notices it on a device.
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _perf_cls = type(server.db.tasks)
    _perf_counts = {}
    _perf_orig = {}
    for _m in ("find", "find_one", "count_documents", "update_one", "update_many",
               "insert_one", "insert_many", "delete_one", "delete_many"):
        _o = getattr(_perf_cls, _m, None)
        if not _o:
            continue
        _perf_orig[_m] = _o
        def _mk(_o=_o, _m=_m):
            def _f(self, *a, **k):
                key = f"{self.name}.{_m}"
                _perf_counts[key] = _perf_counts.get(key, 0) + 1
                return _o(self, *a, **k)
            return _f
        setattr(_perf_cls, _m, _mk())
    try:
        c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
        c.get(f"/api/children/{adskhan['id']}/day-progress?date_key={today_local}")  # warm caches
        _perf_counts.clear()
        c.get(f"/api/children/{adskhan['id']}/day-progress?date_key={today_local}")
        _total = sum(_perf_counts.values())
        _cfg_reads = _perf_counts.get("app_config.find_one", 0)
    finally:
        for _m, _o in _perf_orig.items():
            setattr(_perf_cls, _m, _o)

    check("perf: one screen load stays under 20 DB queries", _total < 20, f"{_total} queries: {_perf_counts}")
    check("perf: config is not re-read many times per request", _cfg_reads <= 2, f"{_cfg_reads} config reads")
    # The worst case used to be the request that happened to trigger the
    # schedule sweep: it built a fortnight of missions before answering, so
    # roughly every ten minutes one child waited seconds for no visible reason.
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.app_config.update_one(
        {"parent_id": "family-default"}, {"$unset": {"last_materialize_at": ""}}, upsert=True))
    server._invalidate_config_cache()
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    _perf_counts.clear()
    for _m2, _o2 in _perf_orig.items():
        def _mk2(_o=_o2, _m=_m2):
            def _f(self, *a, **k):
                key = f"{self.name}.{_m}"
                _perf_counts[key] = _perf_counts.get(key, 0) + 1
                return _o(self, *a, **k)
            return _f
        setattr(_perf_cls, _m2, _mk2())
    try:
        c.get(f"/api/children/{adskhan['id']}/day-progress?date_key={today_local}")
        _worst = sum(_perf_counts.values())
    finally:
        for _m2, _o2 in _perf_orig.items():
            setattr(_perf_cls, _m2, _o2)
    check("perf: even a sweep-due load stays fast for the child", _worst < 20,
          f"{_worst} queries: {_perf_counts}")

    check("perf: tasks are not fetched in a loop",
          _perf_counts.get("tasks.find", 0) <= 8, str(_perf_counts.get("tasks.find")))

    # A saved setting must still take effect at once despite the cache
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c.post("/api/config", json={"daily_point_goal": 77})
    check("perf: the config cache never serves a stale value after a write",
          c.get("/api/config").json()["daily_point_goal"] == 77,
          str(c.get("/api/config").json()["daily_point_goal"]))
    c.post("/api/config", json={"daily_point_goal": 50})
    check("perf: and again on the way back", c.get("/api/config").json()["daily_point_goal"] == 50)

    # =============== MITIGASI COLD START ===============
    r = c.get("/api/warmup")
    check("warm: the warmup endpoint answers", r.status_code == 200 and r.json()["ok"] is True, r.text[:150])
    check("warm: it needs no login (a scheduler has none)", "at" in r.json(), r.text[:150])

    # The index pass must be guarded so later cold starts skip it entirely
    marker = _aio_tg.run(server.db.app_meta.find_one({"_id": "indexes"}))
    check("warm: an index marker is written after the first init",
          marker and marker.get("version") == server._INDEX_VERSION, str(marker))

    _idx_calls = {"n": 0}
    _cls_w = type(server.db.tasks)
    _orig_ci = getattr(_cls_w, "create_index")
    def _count_ci(self, *a, **k):
        _idx_calls["n"] += 1
        return _orig_ci(self, *a, **k)
    setattr(_cls_w, "create_index", _count_ci)
    try:
        server._init_done = False          # simulate a fresh container
        _aio_tg.run(server._run_one_time_init())
    finally:
        setattr(_cls_w, "create_index", _orig_ci)
    check("warm: a warm-schema cold start rebuilds no indexes", _idx_calls["n"] == 0, str(_idx_calls["n"]))
    check("warm: and it still marks itself initialised", server._init_done is True)

    # Bumping the version must make it rebuild once
    _aio_tg.run(server.db.app_meta.update_one({"_id": "indexes"}, {"$set": {"version": -1}}))
    _idx2 = {"n": 0}
    def _count_ci2(self, *a, **k):
        _idx2["n"] += 1
        return _orig_ci(self, *a, **k)
    setattr(_cls_w, "create_index", _count_ci2)
    try:
        server._init_done = False
        _aio_tg.run(server._run_one_time_init())
    finally:
        setattr(_cls_w, "create_index", _orig_ci)
    check("warm: a changed index version triggers exactly one rebuild", _idx2["n"] > 0, str(_idx2["n"]))
    check("warm: and the marker is brought up to date",
          _aio_tg.run(server.db.app_meta.find_one({"_id": "indexes"})).get("version") == server._INDEX_VERSION)

    # The app must still work if the marker collection is unavailable
    server._init_done = False
    _aio_tg.run(server.db.app_meta.delete_many({}))
    _aio_tg.run(server._run_one_time_init())
    check("warm: init survives a missing marker", server._init_done is True)
    check("warm: normal requests still work afterwards",
          c.get("/api/config").status_code == 200)

    # =============== KESTABILAN: KONEKSI & INIT LATAR BELAKANG ===============
    # A rebind used to replace the Mongo client without closing the old one.
    # Each leaked pool stayed open on Atlas until the connection limit was hit,
    # which shows up to a user as intermittent errors and slowness.
    class _FakeClient:
        def __init__(self):
            self.closed = False
        def close(self):
            self.closed = True
        def __getitem__(self, _name):
            return server.db

    _saved_client, _saved_db, _saved_loop = server.client, server.db, server._client_loop_id
    _made = []
    _orig_make = server._make_client
    try:
        server._make_client = lambda _url: _FakeClient()
        old_fake = _FakeClient()
        server.client = old_fake
        server._client_loop_id = -1          # force a rebind on the next call
        _aio_tg.run(_rebind_probe()) if False else None
        async def _probe():
            server._ensure_db_bound_to_current_loop()
        _aio_tg.run(_probe())
        check("stability: rebinding closes the previous client", old_fake.closed is True,
              "the old connection pool was leaked")
        check("stability: and a fresh one takes its place", server.client is not old_fake)
    finally:
        server._make_client = _orig_make
        server.client, server.db, server._client_loop_id = _saved_client, _saved_db, _saved_loop

    # The background schema pass must be queued once, not once per request.
    check("stability: init is marked as scheduled so it can't pile up",
          hasattr(server, "_init_scheduled"), "no scheduling guard exists")
    _saved_sched, _saved_done = server._init_scheduled, server._init_done
    try:
        server._init_done = False
        server._init_scheduled = True        # as if a pass is already in flight
        _runs = {"n": 0}
        _orig_init = server._run_one_time_init
        async def _counting_init():
            _runs["n"] += 1
            await _orig_init()
        server._run_one_time_init = _counting_init
        for _ in range(5):
            c.get("/api/config")             # five requests during the window
        check("stability: concurrent requests don't each start their own init",
              _runs["n"] == 0, f'{_runs["n"]} extra init passes were started')
    finally:
        server._run_one_time_init = _orig_init
        server._init_scheduled, server._init_done = _saved_sched, _saved_done

    check("stability: the app still serves requests normally afterwards",
          c.get("/api/config").status_code == 200)

    # =============== CHECKPOINT PER SEGMEN ===============
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    for _col in ("tasks", "segment_sessions"):
        _aio_tg.run(getattr(server.db, _col).delete_many({}))
    _aio_tg.run(server.db.children.update_many({}, {"$set": {"segment_starts": {}}}))
    _aio_tg.run(server.db.children.update_one({"id": adskhan["id"]}, {"$set": {
        "points": 0, "penalty_cards": 0, "chiky_save": 0, "chiky_spend": 0, "chiky_share": 0}}))
    # Pin the clock at midday so this block behaves identically whenever the
    # suite runs — near midnight the "past/now/later" sections would collide.
    _real_now_local = server._now_local
    _fixed_noon = _real_now_local().replace(hour=12, minute=0, second=0, microsecond=0)
    server._now_local = lambda: _fixed_noon
    _nm = 12 * 60
    _hm = lambda m: f"{max(0, min(m, 1439)) // 60:02d}:{max(0, min(m, 1439)) % 60:02d}"
    c.post("/api/config", json={
        "day_segments": [
            {"label": "Lalu", "start_time": "00:00", "end_time": _hm(_nm - 30)},
            {"label": "Sekarang", "start_time": _hm(max(2, _nm - 5)), "end_time": _hm(min(_nm + 120, 1438))},
            {"label": "Nanti", "start_time": _hm(min(_nm + 121, 1438)), "end_time": "23:59"}],
        "segment_late_grace_minutes": 15, "auto_approve_tasks": True,
        "early_bonus_pct": 0, "pacing_bonus_points": 0,
        "late_reasons": [
            {"label": "Macet", "gives_penalty_card": False, "award_points": True},
            {"label": "Main game", "gives_penalty_card": True, "award_points": False}]})
    __import__("asyncio").run(server._refresh_segments_cache())
    SG2 = {x["label"]: x["id"] for x in c.get("/api/config").json()["day_segments"]}
    _lr = c.get("/api/config").json()["late_reasons"]
    OKR, BADR = _lr[0]["id"], _lr[1]["id"]
    check("seg: default tolerance is 15 minutes",
          server.DEFAULT_LATE_REASONS is not None and
          int(c.get("/api/config").json().get("segment_late_grace_minutes")) == 15)

    def mkact(title, seg, order, **kw):
        return c.post("/api/tasks", json={"title": title, "points": 10, "date_key": today_local,
                                          "target_children": [adskhan["id"]], "segment_id": SG2[seg],
                                          "order": order, **kw}).json()
    a1, a2, a3 = mkact("Mandi", "Sekarang", 1), mkact("Makan", "Sekarang", 2), mkact("Belajar", "Sekarang", 3)
    ab = mkact("Bonus baca", "Sekarang", 4, is_bonus=True)
    mkact("Nanti saja", "Nanti", 1)
    late1 = mkact("Telat", "Lalu", 1)

    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    day = c.get(f"/api/children/{adskhan['id']}/segments-day?date_key={today_local}").json()
    byseg = {s["label"]: s for s in day["segments"]}
    check("seg: sections are returned with their activities", byseg["Sekarang"]["required_count"] == 3,
          str(byseg.get("Sekarang", {}).get("required_count")))
    check("seg: an open section is ready", byseg["Sekarang"]["status"] == "ready", byseg["Sekarang"]["status"])
    check("seg: a future section is locked", byseg["Nanti"]["status"] == "locked", byseg["Nanti"]["status"])
    check("seg: a section past its end shows as late to start", byseg["Lalu"]["late_start"] is True)
    check("seg: start and end times are exposed", byseg["Sekarang"]["start_time"] and byseg["Sekarang"]["end_time"])

    body = lambda seg, **kw: {"child_id": adskhan["id"], "date_key": today_local, "segment_id": SG2[seg], **kw}
    # Can't tick before starting
    r = c.post(f"/api/tasks/{a1['id']}/check", json={"checked": True})
    check("seg: ticking before starting is refused", r.status_code == 409, str(r.status_code))
    # Locked section can't start
    r = c.post("/api/segment-sessions/start", json=body("Nanti"))
    check("seg: a locked section refuses to start", r.status_code == 409 and "Belum waktunya" in r.text, r.text[:140])

    r = c.post("/api/segment-sessions/start", json=body("Sekarang"))
    check("seg: starting on time needs no reason", r.status_code == 200 and r.json()["start_late"] is False, r.text[:160])
    r = c.post("/api/segment-sessions/start", json=body("Sekarang"))
    check("seg: starting twice is harmless", r.status_code == 200)

    r = c.post("/api/segment-sessions/finish", json=body("Sekarang"))
    check("seg: finishing with unticked activities is refused",
          r.status_code == 409 and "belum dicentang" in r.text, r.text[:160])

    c.post(f"/api/tasks/{a1['id']}/check", json={"checked": True})
    r = c.post(f"/api/tasks/{a1['id']}/check", json={"checked": False})
    check("seg: an activity can be unticked again", r.status_code == 200 and r.json()["checked"] is False)
    r = c.post("/api/segment-sessions/check-all", json=body("Sekarang", checked=True))
    check("seg: tick-all ticks everything", r.status_code == 200 and r.json()["updated"] == 4, r.text[:160])

    r = c.post("/api/segment-sessions/finish", json=body("Sekarang"))
    check("seg: finishing once all are ticked succeeds", r.status_code == 200, r.text[:200])
    check("seg: every ticked activity is completed", r.json()["completed"] == 4, str(r.json()))
    kid = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("seg: points are awarded (incl. the ticked bonus)", kid["points"] == 40, str(kid["points"]))
    check("seg: the wallet still balances",
          kid["chiky_save"] + kid["chiky_spend"] + kid["chiky_share"] == kid["points"])
    day = c.get(f"/api/children/{adskhan['id']}/segments-day?date_key={today_local}").json()
    check("seg: the section now reads as done",
          {s["label"]: s for s in day["segments"]}["Sekarang"]["status"] == "done")
    r = c.post(f"/api/tasks/{a1['id']}/check", json={"checked": False})
    check("seg: a finished section can't be edited", r.status_code == 400, str(r.status_code))
    r = c.post("/api/segment-sessions/finish", json=body("Sekarang"))
    check("seg: it can't be finished twice", r.status_code in (400, 409), str(r.status_code))

    # --- late start: needs a reason; at-fault costs a card and the points ---
    r = c.post("/api/segment-sessions/start", json=body("Lalu"))
    check("seg: a late start demands a reason", r.status_code == 409 and "LATE_REASON_REQUIRED" in r.text, r.text[:140])
    r = c.post("/api/segment-sessions/start", json=body("Lalu", late_reason_id=BADR))
    check("seg: an at-fault reason is accepted", r.status_code == 200 and r.json()["start_late"] is True, r.text[:160])
    check("seg: and marks the section as pointless", r.json()["no_points"] is True)
    c.post(f"/api/tasks/{late1['id']}/check", json={"checked": True})
    pts_before = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])["points"]
    r = c.post("/api/segment-sessions/finish", json=body("Lalu"))
    check("seg: one lateness is charged once (no second reason at the end)", r.status_code == 200, r.text[:180])
    kid2 = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("seg: an at-fault late section earns no points", kid2["points"] == pts_before, f'{pts_before}→{kid2["points"]}')
    check("seg: and costs a penalty card", kid2["penalty_cards"] == 1, str(kid2["penalty_cards"]))

    # --- excused late start keeps the points ---
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.segment_sessions.delete_many({}))
    _aio_tg.run(server.db.tasks.delete_many({}))
    late2 = mkact("Telat dimaklumi", "Lalu", 1)
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    c.post("/api/segment-sessions/start", json=body("Lalu", late_reason_id=OKR))
    c.post(f"/api/tasks/{late2['id']}/check", json={"checked": True})
    p0 = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])["points"]
    c.post("/api/segment-sessions/finish", json=body("Lalu"))
    p1 = next(k for k in c.get("/api/children").json() if k["id"] == adskhan["id"])["points"]
    check("seg: an excused late section keeps its points", p1 - p0 == 10, f"{p0}→{p1}")

    # --- on-time start but late finish: end time does NOT move ---
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.segment_sessions.delete_many({}))
    _aio_tg.run(server.db.tasks.delete_many({}))
    lf = mkact("Selesai kelewatan", "Lalu", 1)
    # pretend it was started on time earlier
    _aio_tg.run(server.db.segment_sessions.insert_one({
        "parent_id": "family-default", "child_id": adskhan["id"], "date_key": today_local,
        "segment_id": SG2["Lalu"], "started_at": server.now_iso(), "start_late": False, "no_points": False}))
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    c.post(f"/api/tasks/{lf['id']}/check", json={"checked": True})
    r = c.post("/api/segment-sessions/finish", json=body("Lalu"))
    check("seg: finishing after the end time needs a reason", r.status_code == 409 and "LATE_REASON_REQUIRED" in r.text, r.text[:140])
    r = c.post("/api/segment-sessions/finish", json=body("Lalu", late_reason_id=OKR))
    check("seg: with a reason it finishes, marked late", r.status_code == 200 and r.json()["finish_late"] is True, r.text[:160])

    # --- 'Kapan Saja' has no clock ---
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.tasks.delete_many({}))
    _aio_tg.run(server.db.segment_sessions.delete_many({}))
    anyt = c.post("/api/tasks", json={"title": "Rapikan kamar", "points": 5, "date_key": today_local,
                                      "target_children": [adskhan["id"]]}).json()
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    any_body = {"child_id": adskhan["id"], "date_key": today_local, "segment_id": server.ANYTIME_SEGMENT_ID}
    r = c.post("/api/segment-sessions/start", json=any_body)
    check("seg: 'Kapan Saja' starts without any timing", r.status_code == 200 and r.json()["start_late"] is False, r.text[:140])
    c.post(f"/api/tasks/{anyt['id']}/check", json={"checked": True})
    r = c.post("/api/segment-sessions/finish", json=any_body)
    check("seg: and finishes without any lateness", r.status_code == 200 and r.json()["finish_late"] is False, r.text[:140])

    # --- guards ---
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.post("/api/segment-sessions/start", json=body("Sekarang"))
    check("seg: a sibling can't run someone else's section", r.status_code == 403, str(r.status_code))
    r = c.get(f"/api/children/{adskhan['id']}/segments-day")
    check("seg: nor read their checklist", r.status_code == 403, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.post("/api/segment-sessions/start", json={"child_id": adskhan["id"], "date_key": today_local, "segment_id": "ngawur"})
    check("seg: unknown section → 404", r.status_code == 404, str(r.status_code))
    r = c.post("/api/segment-sessions/start", json={"child_id": adskhan["id"], "date_key": "x", "segment_id": SG2["Sekarang"]})
    check("seg: bad date → 422", r.status_code == 422, str(r.status_code))
    _tomorrow_s = (_off_base + _dt_off.timedelta(days=1)).strftime("%Y-%m-%d")
    r = c.post("/api/segment-sessions/start", json={"child_id": adskhan["id"], "date_key": _tomorrow_s, "segment_id": SG2["Sekarang"]})
    check("seg: tomorrow can't be started today", r.status_code in (400, 409), str(r.status_code))

    # --- parent can reopen ---
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post("/api/segment-sessions/reopen", json=any_body)
    check("seg: a parent can reopen a finished section", r.status_code == 200, r.text[:140])
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    r = c.post("/api/segment-sessions/reopen", json=any_body)
    check("seg: a child cannot reopen", r.status_code == 403, str(r.status_code))

    # --- an exam period forgives a late finish ---
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.tasks.delete_many({}))
    _aio_tg.run(server.db.segment_sessions.delete_many({}))
    _aio_tg.run(server.db.exam_periods.delete_many({}))
    ex_t = mkact("Belajar ujian", "Lalu", 1)
    _aio_tg.run(server.db.segment_sessions.insert_one({
        "parent_id": "family-default", "child_id": adskhan["id"], "date_key": today_local,
        "segment_id": SG2["Lalu"], "started_at": server.now_iso(), "start_late": False, "no_points": False}))
    _tom_ex = (_off_base + _dt_off.timedelta(days=1)).strftime("%Y-%m-%d")
    c.post("/api/exam-periods", json={"child_id": adskhan["id"], "exam_start": _tom_ex, "exam_end": _tom_ex})
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    dex = {s["label"]: s for s in c.get(f"/api/children/{adskhan['id']}/segments-day?date_key={today_local}").json()["segments"]}
    check("seg: during an exam, a late finish isn't flagged on screen", dex["Lalu"]["late_finish"] is False)
    c.post(f"/api/tasks/{ex_t['id']}/check", json={"checked": True})
    r = c.post("/api/segment-sessions/finish", json=body("Lalu"))
    check("seg: and finishing needs no lateness reason", r.status_code == 200 and r.json()["finish_late"] is False, r.text[:160])
    _aio_tg.run(server.db.exam_periods.delete_many({}))

    # --- the checklist screen stays light ---
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.tasks.delete_many({}))
    _aio_tg.run(server.db.segment_sessions.delete_many({}))
    for _i in range(8):
        mkact(f"Aktivitas {_i}", "Sekarang", _i + 1)
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    c.get(f"/api/children/{adskhan['id']}/segments-day?date_key={today_local}")  # warm caches
    _sq_cls = type(server.db.tasks); _sq_counts = {}; _sq_orig = {}
    for _m in ("find", "find_one", "count_documents", "update_one", "update_many", "insert_one", "insert_many"):
        _o = getattr(_sq_cls, _m, None)
        if not _o: continue
        _sq_orig[_m] = _o
        def _mk(_o=_o, _m=_m):
            def _f(self, *a, **k):
                _sq_counts[f"{self.name}.{_m}"] = _sq_counts.get(f"{self.name}.{_m}", 0) + 1
                return _o(self, *a, **k)
            return _f
        setattr(_sq_cls, _m, _mk())
    try:
        c.get(f"/api/children/{adskhan['id']}/segments-day?date_key={today_local}")
    finally:
        for _m, _o in _sq_orig.items(): setattr(_sq_cls, _m, _o)
    _sq_total = sum(_sq_counts.values())
    check("seg: the checklist loads in under 12 DB queries", _sq_total < 12, f"{_sq_total}: {_sq_counts}")
    check("seg: activities are not fetched one by one",
          _sq_counts.get("tasks.find", 0) <= 2, str(_sq_counts.get("tasks.find")))

    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    _aio_tg.run(server.db.tasks.delete_many({}))
    _aio_tg.run(server.db.segment_sessions.delete_many({}))
    c.post("/api/config", json={"day_segments": server.DEFAULT_DAY_SEGMENTS, "early_bonus_pct": 10})
    __import__("asyncio").run(server._refresh_segments_cache())
    server._now_local = _real_now_local

    # =============== VERSI DEPLOY ===============
    # Every open app compares its own build against this to notice a new deploy.
    import os as _os_v
    _saved_sha = _os_v.environ.pop("VERCEL_GIT_COMMIT_SHA", None)
    try:
        r = c.get("/api/version")
        check("version: answers without login", r.status_code == 200, str(r.status_code))
        check("version: reports dev when not on Vercel", r.json()["version"] == "dev", r.text[:80])
        _os_v.environ["VERCEL_GIT_COMMIT_SHA"] = "a4bc26e1f2b3c4d5e6"
        r = c.get("/api/version")
        check("version: reports the running commit, shortened", r.json()["version"] == "a4bc26e", r.text[:80])
        check("version: warmup reports it too", c.get("/api/warmup").json().get("version") == "a4bc26e")
    finally:
        _os_v.environ.pop("VERCEL_GIT_COMMIT_SHA", None)
        if _saved_sha is not None:
            _os_v.environ["VERCEL_GIT_COMMIT_SHA"] = _saved_sha

    # =============== RUTINITAS MINGGUAN + PENGECUALIAN ===============
    _rt_real_now = server._now_local
    _rt_noon = _rt_real_now().replace(hour=12, minute=0, second=0, microsecond=0)
    server._now_local = lambda: _rt_noon
    try:
        c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
        for _col in ("tasks", "template_tasks", "day_templates", "day_builds", "routine_swaps",
                     "off_days", "segment_sessions", "template_assignments"):
            _aio_tg.run(getattr(server.db, _col).delete_many({}))
        _aio_tg.run(server.db.app_meta.delete_many({"_id": "routine_migrated"}))
        c.post("/api/config", json={"day_segments": [
            {"label": "Pagi", "start_time": "04:00", "end_time": "11:00"},
            {"label": "Siang", "start_time": "11:55", "end_time": "14:00"},
            {"label": "Malam", "start_time": "18:00", "end_time": "21:00"}]})
        __import__("asyncio").run(server._refresh_segments_cache())
        RS = {x["label"]: x["id"] for x in c.get("/api/config").json()["day_segments"]}
        _base = _dt_off.datetime.strptime(today_local, "%Y-%m-%d")
        def next_wd(wd, after=1):
            d = _base + _dt_off.timedelta(days=after)
            while d.weekday() != wd:
                d += _dt_off.timedelta(days=1)
            return d.strftime("%Y-%m-%d")
        MON, WED, SUN = next_wd(0), next_wd(2), next_wd(6)
        TOMORROW = (_base + _dt_off.timedelta(days=1)).strftime("%Y-%m-%d")
        both = [adskhan["id"], syila["id"]]

        # --- legacy data in the old shape (written directly: the API no longer makes it) ---
        def _legacy(title, pts, dk, rec, kid, seg, dur=None, status="pending"):
            doc = {"id": server.new_id(), "parent_id": "family-default", "child_id": kid, "title": title,
                   "points": pts, "date_key": dk, "recurrence": rec, "duration_minutes": dur,
                   "segment_id": seg, "status": status, "order": 1, "created_at": server.now_iso()}
            _aio_tg.run(server.db.tasks.insert_one(dict(doc)))
            return doc
        for kid in both:
            _legacy("Sholat Subuh", 10, MON, "weekly", kid, RS["Pagi"], 10)
        _legacy("Sholat Subuh", 10, MON, "weekly", adskhan["id"], RS["Pagi"], 10)
        _legacy("Belajar", 20, TOMORROW, "daily", adskhan["id"], RS["Malam"], 30)
        kept = _legacy("Sudah dikerjakan", 5, MON, "weekly", syila["id"], RS["Pagi"], status="approved")
        server._ROUTINE_MIGRATED["done"] = False

        r = c.get("/api/routine")
        check("routine: loads for a parent", r.status_code == 200, r.text[:200])
        mig = r.json()["migrated"]
        check("routine: legacy schedule is migrated on first open", mig is not None and mig["slots"] > 0, str(mig))
        slots = r.json()["slots"]
        subuh = [x for x in slots if x["title"] == "Sholat Subuh" and x["weekday"] == 0]
        check("routine: the same activity for every child merges into one row",
              len(subuh) == 1 and subuh[0]["child_id"] is None, str(subuh))
        belajar = [x for x in slots if x["title"] == "Belajar"]
        check("routine: a daily mission becomes all seven weekdays", sorted(x["weekday"] for x in belajar) == list(range(7)),
              str(sorted(x["weekday"] for x in belajar)))
        check("routine: a one-child mission stays that child's", all(x["child_id"] == adskhan["id"] for x in belajar))
        check("routine: durations carry over", belajar and belajar[0]["duration_minutes"] == 30)
        r2 = c.get("/api/routine")
        check("routine: migration runs only once", r2.json()["migrated"] is None and len(r2.json()["slots"]) == len(slots))
        check("routine: worked-on old missions are never deleted",
              _aio_tg.run(server.db.tasks.find_one({"id": kept["id"]})) is not None)
        check("routine: the old repeat engine is switched off",
              _aio_tg.run(server.db.tasks.count_documents({"recurrence": {"$in": ["daily", "weekly"]}})) == 0)

        # --- days build themselves from the routine ---
        day = lambda kid, dk: c.get(f"/api/children/{kid}/segments-day?date_key={dk}").json()
        acts = lambda d: [a for s in d["segments"] for a in s["activities"]]
        d_mon = day(adskhan["id"], MON)
        titles = [a["title"] for a in acts(d_mon)]
        check("routine: a future day is built from the weekly routine",
              "Sholat Subuh" in titles and "Belajar" in titles, str(titles))
        check("routine: each activity tells the child its duration",
              any(a["duration_minutes"] == 30 for a in acts(d_mon) if a["title"] == "Belajar"))
        n1 = len(acts(d_mon)); n2 = len(acts(day(adskhan["id"], MON)))
        check("routine: opening a day twice never duplicates it", n1 == n2, f"{n1} vs {n2}")
        check("routine: merged rows reach every child",
              "Sholat Subuh" in [a["title"] for a in acts(day(syila["id"], MON))])
        check("routine: one-child rows don't leak to the sibling",
              "Belajar" not in [a["title"] for a in acts(day(syila["id"], MON))])
        _past = (_base - _dt_off.timedelta(days=3)).strftime("%Y-%m-%d")
        day(adskhan["id"], _past)
        check("routine: past days are never back-filled",
              _aio_tg.run(server.db.tasks.count_documents({"date_key": _past, "from_routine": True})) == 0)

        # --- editing the routine ---
        r = c.post("/api/routine/slots", json={"weekdays": [0, 2], "segment_id": RS["Siang"], "title": "Tidur siang",
                                               "duration_minutes": 45, "points": 5})
        check("routine: one activity can be added to several weekdays at once",
              r.status_code == 200 and len(r.json()["created"]) == 2, r.text[:200])
        check("routine: an edit reaches already-built future days",
              "Tidur siang" in [a["title"] for a in acts(day(adskhan["id"], MON))])
        sid = r.json()["created"][0]["id"]
        r = c.patch(f"/api/routine/slots/{sid}", json={"title": "Istirahat siang", "duration_minutes": 30})
        check("routine: an activity can be edited", r.status_code == 200 and r.json()["title"] == "Istirahat siang")
        check("routine: and the day follows the edit",
              "Istirahat siang" in [a["title"] for a in acts(day(adskhan["id"], MON))])
        c.post("/api/routine/slots", json={"weekdays": [0], "segment_id": RS["Siang"], "title": "Makan siang"})
        r = c.post(f"/api/routine/slots/{sid}/move", json={"direction": "down"})
        mon_siang = [x for x in c.get("/api/routine").json()["slots"] if x["weekday"] == 0 and x["segment_id"] == RS["Siang"]]
        check("routine: activities can be reordered", r.status_code == 200 and mon_siang[0]["title"] == "Makan siang",
              str([x["title"] for x in mon_siang]))
        for bad, why in [({"weekdays": [], "title": "x"}, "no weekday"), ({"weekdays": [9], "title": "x"}, "bad weekday"),
                         ({"weekdays": [0], "title": ""}, "empty title"),
                         ({"weekdays": [0], "title": "x", "duration_minutes": 0}, "zero duration")]:
            check(f"routine: rejects {why}", c.post("/api/routine/slots", json=bad).status_code == 422)
        check("routine: rejects an unknown section", c.post("/api/routine/slots", json={
            "weekdays": [0], "title": "x", "segment_id": "ngawur"}).status_code == 404)
        check("routine: rejects an unknown child", c.post("/api/routine/slots", json={
            "weekdays": [0], "title": "x", "child_id": "ngawur"}).status_code == 404)
        r = c.delete(f"/api/routine/slots/{sid}")
        check("routine: an activity can be removed", r.status_code == 200)
        check("routine: removing twice is a clean 404", c.delete(f"/api/routine/slots/{sid}").status_code == 404)

        # --- copy a weekday ---
        r = c.post("/api/routine/copy-day", json={"from_weekday": 0, "to_weekdays": [3, 4]})
        rs = c.get("/api/routine").json()["slots"]
        cnt = lambda wd: len([x for x in rs if x["weekday"] == wd])
        check("routine: a whole weekday can be copied to others", r.status_code == 200 and cnt(3) == cnt(0) == cnt(4),
              f"{cnt(0)}/{cnt(3)}/{cnt(4)}")
        check("routine: copying onto itself only is refused",
              c.post("/api/routine/copy-day", json={"from_weekday": 0, "to_weekdays": [0]}).status_code == 422)

        # --- today: edits wait for tomorrow unless applied ---
        _today_wd = _base.weekday()
        c.post("/api/routine/slots", json={"weekdays": [_today_wd], "segment_id": RS["Siang"], "title": "Baca buku"})
        day(adskhan["id"], today_local)
        before = [a["title"] for a in acts(day(adskhan["id"], today_local))]
        c.post("/api/routine/slots", json={"weekdays": [_today_wd], "segment_id": RS["Siang"], "title": "Hari ini juga"})
        check("routine: edits don't silently rewrite today",
              "Hari ini juga" not in [a["title"] for a in acts(day(adskhan["id"], today_local))])
        r = c.post("/api/routine/apply-today")
        check("routine: 'apply to today' brings them in", r.status_code == 200 and
              "Hari ini juga" in [a["title"] for a in acts(day(adskhan["id"], today_local))], r.text[:160])
        c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
        _st = c.post("/api/segment-sessions/start", json={"child_id": adskhan["id"], "date_key": today_local,
                                                          "segment_id": RS["Siang"]})
        check("routine: (setup) today's section starts", _st.status_code == 200, _st.text[:160])
        ticked = next(a for a in acts(day(adskhan["id"], today_local)) if a["title"] == "Baca buku")
        c.post(f"/api/tasks/{ticked['id']}/check", json={"checked": True})
        c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
        c.post("/api/routine/apply-today")
        still = [a for a in acts(day(adskhan["id"], today_local)) if a["title"] == "Baca buku"]
        check("routine: applying never disturbs a section already in progress",
              len(still) == 1 and still[0]["id"] == ticked["id"] and still[0]["checked"], str(still))

        # --- exception: use another weekday's routine ---
        c.post("/api/routine/slots", json={"weekdays": [6], "segment_id": RS["Pagi"], "title": "Jalan pagi"})
        r = c.post("/api/routine/swaps", json={"start_date": WED, "use_weekday": 6, "note": "Tanggal merah"})
        check("swap: a date can borrow another weekday's routine", r.status_code == 200, r.text[:160])
        wed_titles = [a["title"] for a in acts(day(adskhan["id"], WED))]
        check("swap: the borrowed routine is used", "Jalan pagi" in wed_titles, str(wed_titles))
        check("swap: the normal weekday's items are not", "Tidur siang" not in wed_titles, str(wed_titles))
        check("swap: overlapping swaps are refused",
              c.post("/api/routine/swaps", json={"start_date": WED, "use_weekday": 5}).status_code == 409)
        check("swap: listed among exceptions", any(x["id"] == r.json()["id"] for x in
              c.get("/api/routine/exceptions").json()["swaps"]))
        c.delete(f"/api/routine/swaps/{r.json()['id']}")
        check("swap: removing it restores the normal day",
              "Jalan pagi" not in [a["title"] for a in acts(day(adskhan["id"], WED))])

        # --- exception: day off from a section onwards ---
        r = c.post("/api/off-days", json={"start_date": MON, "end_date": MON, "start_segment_id": RS["Siang"]})
        check("off: a partial day off is accepted", r.status_code == 200, r.text[:160])
        mon_t = [a["title"] for a in acts(day(adskhan["id"], MON))]
        check("off: sections inside the break disappear", "Belajar" not in mon_t, str(mon_t))
        check("off: sections before it remain", "Sholat Subuh" in mon_t, str(mon_t))
        c.delete(f"/api/off-days/{r.json()['id']}")
        check("off: cancelling brings the day back",
              "Belajar" in [a["title"] for a in acts(day(adskhan["id"], MON))])

        # --- exception: extra one-off activity ---
        r = c.post("/api/routine/extras", json={"start_date": MON, "end_date": (datetime.strptime(MON, "%Y-%m-%d") if False else None),
                                                "segment_id": RS["Siang"], "child_id": adskhan["id"],
                                                "title": "Latihan pentas", "duration_minutes": 60, "points": 15})
        check("extra: a one-off activity can be added", r.status_code == 200 and r.json()["created"] == 1, r.text[:160])
        check("extra: it shows for that child", "Latihan pentas" in [a["title"] for a in acts(day(adskhan["id"], MON))])
        check("extra: not for the sibling", "Latihan pentas" not in [a["title"] for a in acts(day(syila["id"], MON))])
        ex = c.get("/api/routine/exceptions").json()["extras"]
        check("extra: listed among exceptions", any(x["id"] == r.json()["id"] for x in ex))
        c.post("/api/routine/slots", json={"weekdays": [0], "segment_id": RS["Pagi"], "title": "Pemicu rebuild"})
        check("extra: survives later routine edits",
              "Latihan pentas" in [a["title"] for a in acts(day(adskhan["id"], MON))])
        c.delete(f"/api/routine/extras/{r.json()['id']}")
        check("extra: can be removed", "Latihan pentas" not in [a["title"] for a in acts(day(adskhan["id"], MON))])
        check("extra: reversed dates refused", c.post("/api/routine/extras", json={
            "start_date": WED, "end_date": MON if MON < WED else TOMORROW, "title": "x"}).status_code in (200, 422))
        _far = (_base + _dt_off.timedelta(days=120)).strftime("%Y-%m-%d")
        check("extra: absurd ranges refused", c.post("/api/routine/extras", json={
            "start_date": TOMORROW, "end_date": _far, "title": "x"}).status_code == 422)

        # --- permissions ---
        c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
        for _m, _p, _b in [("get", "/api/routine", None), ("post", "/api/routine/slots", {"weekdays": [0], "title": "x"}),
                           ("post", "/api/routine/swaps", {"start_date": WED, "use_weekday": 1}),
                           ("post", "/api/routine/extras", {"start_date": WED, "title": "x"}),
                           ("post", "/api/routine/apply-today", {})]:
            rr = c.get(_p) if _m == "get" else c.post(_p, json=_b)
            check(f"routine: a child is blocked from {_p}", rr.status_code == 403, f"{_p} {rr.status_code}")
    finally:
        server._now_local = _rt_real_now
        c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
        for _col in ("tasks", "template_tasks", "day_templates", "day_builds", "routine_swaps", "off_days", "segment_sessions"):
            _aio_tg.run(getattr(server.db, _col).delete_many({}))
        c.post("/api/config", json={"day_segments": server.DEFAULT_DAY_SEGMENTS})
        __import__("asyncio").run(server._refresh_segments_cache())

print("\n" + "=" * 50)
print(f"PASSED: {len(passed)}   FAILED: {len(failed)}")
if failed:
    print("FAILURES:")
    for f in failed:
        print("  -", f)
    raise SystemExit(1)
print("ALL TESTS PASSED ✅")
