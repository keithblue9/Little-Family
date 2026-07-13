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

with TestClient(server.app, base_url="https://testserver") as c:  # context manager triggers startup → seeding
    # ---- 1. Member list (public) ----
    r = c.get("/api/auth/members")
    members = r.json()
    check("members list 200", r.status_code == 200, str(r.status_code))
    names = [m["name"] for m in members]
    check("4 seeded members", len(members) == 4, str(names))
    check("order parents first", names[:2] == ["Abi", "Ummi"] and set(names[2:]) == {"Adskhan", "Syila"}, str(names))
    check("no hash leak", all("passcode_hash" not in m and "passcode_plain" not in m for m in members))

    abi = next(m for m in members if m["name"] == "Abi")
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

    # ---- 4. Parent config: rate & skip cost ----
    r = c.post("/api/config", json={"rupiah_per_point": 500, "skip_cost_points": 5})
    check("set config", r.status_code == 200, r.text[:120])
    r = c.get("/api/config")
    check("config persisted", r.json().get("rupiah_per_point") == 500 and r.json().get("skip_cost_points") == 5, r.text[:200])

    # ---- 5. Kid login + sequence enforcement ----
    r = c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "123456"})
    check("Adskhan login", r.status_code == 200 and r.json()["role"] == "child", r.text[:120])

    r = c.post(f"/api/tasks/{t[1]['id']}/complete")
    check("task#2 blocked while #1 open", r.status_code == 409, f"{r.status_code} {r.text[:100]}")

    r = c.post(f"/api/tasks/{t[0]['id']}/complete")
    check("task#1 completes", r.status_code == 200 and r.json()["status"] == "completed", r.text[:120])

    # #1 is completed (awaiting approval) → next actionable is #2
    r = c.post(f"/api/tasks/{t[2]['id']}/complete")
    check("task#3 still blocked by #2", r.status_code == 409, f"{r.status_code}")

    # ---- 6. Skip needs points; kid has 0 ----
    r = c.post(f"/api/tasks/{t[1]['id']}/skip")
    check("skip blocked w/o points", r.status_code == 400, f"{r.status_code} {r.text[:100]}")

    # ---- 7. Parent approves #1 → kid gets 10 points ----
    r = c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post(f"/api/tasks/{t[0]['id']}/approve")
    check("approve #1", r.status_code == 200, r.text[:150])
    kid = c.get("/api/children").json()
    pts = next(k["points"] for k in kid if k["id"] == adskhan["id"])
    check("kid has 10 pts", pts == 10, str(pts))

    # ---- 8. Kid skips #2 (cost 5) then #3 unlocks ----
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "123456"})
    r = c.post(f"/api/tasks/{t[1]['id']}/skip")
    check("skip #2 ok", r.status_code == 200 and r.json()["points_spent"] == 5, r.text[:150])
    r = c.post(f"/api/tasks/{t[2]['id']}/complete")
    check("task#3 now unlocked", r.status_code == 200, f"{r.status_code} {r.text[:100]}")

    # ---- 9. Redeem points → money (5 pts left × 500 = 2500) ----
    r = c.post("/api/points/redeem-money", json={"child_id": adskhan["id"], "points": 5})
    check("redeem 5 pts", r.status_code == 200 and r.json()["rupiah"] == 2500, r.text[:200])
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

    # ---- 14. Task duration & due_time ----
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    # both set
    r = c.post("/api/tasks", json={"child_id": adskhan["id"], "title": "Makan malam", "points": 5, "duration_minutes": 15, "due_time": "18:00"})
    check("task with duration+time", r.status_code == 200 and r.json()["duration_minutes"] == 15 and r.json()["due_time"] == "18:00", r.text[:160])
    dt_task = r.json()
    # only duration
    r = c.post("/api/tasks", json={"child_id": adskhan["id"], "title": "Mandi", "points": 5, "duration_minutes": 10})
    check("task duration only", r.json().get("duration_minutes") == 10 and r.json().get("due_time") is None, r.text[:160])
    # only time
    r = c.post("/api/tasks", json={"child_id": adskhan["id"], "title": "Tidur", "points": 5, "due_time": "21:00"})
    check("task time only", r.json().get("due_time") == "21:00" and r.json().get("duration_minutes") is None, r.text[:160])
    # neither (both optional)
    r = c.post("/api/tasks", json={"child_id": adskhan["id"], "title": "Bebas", "points": 5})
    check("task neither time nor duration", r.status_code == 200 and r.json().get("due_time") is None and r.json().get("duration_minutes") is None, r.text[:160])
    # invalid time format rejected
    r = c.post("/api/tasks", json={"child_id": adskhan["id"], "title": "Salah", "points": 5, "due_time": "25:99"})
    check("invalid time rejected", r.status_code == 422, str(r.status_code))
    # duration out of range rejected
    r = c.post("/api/tasks", json={"child_id": adskhan["id"], "title": "Salah2", "points": 5, "duration_minutes": 99999})
    check("duration out of range rejected", r.status_code == 422, str(r.status_code))

    # ---- 15. Edit task (update duration/time) ----
    r = c.patch(f"/api/tasks/{dt_task['id']}", json={"duration_minutes": 20, "due_time": "17:30", "title": "Makan malam (edit)"})
    check("edit task fields", r.status_code == 200 and r.json()["duration_minutes"] == 20 and r.json()["due_time"] == "17:30" and r.json()["title"] == "Makan malam (edit)", r.text[:180])
    # clear the optional fields
    r = c.patch(f"/api/tasks/{dt_task['id']}", json={"duration_minutes": None, "due_time": None})
    check("clear duration+time", r.status_code == 200 and r.json().get("duration_minutes") is None and r.json().get("due_time") is None, r.text[:180])
    # edit invalid time rejected
    r = c.patch(f"/api/tasks/{dt_task['id']}", json={"due_time": "99:99"})
    check("edit invalid time rejected", r.status_code == 422, str(r.status_code))

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
    # cleanup: give kids fresh state for this section
    tomorrow = "2026-08-15"
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

    # ---- 19. Timer start/complete + sequence rule ----
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "123456"})
    ads_tasks = c.get(f"/api/tasks?date_key={tomorrow}&child_id={adskhan['id']}").json()
    required = [t for t in ads_tasks if not t.get("is_bonus")]
    required.sort(key=lambda t: t.get("order") or 0)
    first, second = required[0], required[1]

    # Can start bonus even if required not done
    bonus_task = next(t for t in ads_tasks if t.get("is_bonus"))
    r = c.post(f"/api/tasks/{bonus_task['id']}/start")
    check("start bonus while required pending", r.status_code == 200 and r.json().get("timer_started_at"), r.text[:150])

    # Can't start #2 before #1
    r = c.post(f"/api/tasks/{second['id']}/start")
    check("start blocked by sequence", r.status_code == 409, str(r.status_code))

    # Start #1 → complete it
    r = c.post(f"/api/tasks/{first['id']}/start")
    check("start first task", r.status_code == 200 and r.json().get("timer_started_at"))
    r = c.post(f"/api/tasks/{first['id']}/complete")
    check("complete first task", r.status_code == 200)

    # Now #2 unlocked
    r = c.post(f"/api/tasks/{second['id']}/start")
    check("start second task now unlocked", r.status_code == 200, r.text[:150])

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
    life_date = "2026-09-01"

    r = c.post("/api/tasks", json={
        "title": "Sikat gigi", "points": 5, "date_key": life_date,
        "child_id": adskhan["id"], "is_bonus": False, "recurrence": "none",
    })
    check("lifecycle: create task", r.status_code == 200, r.text[:200])
    life_task = r.json()

    r = c.get("/api/tasks")
    check("lifecycle: task appears in parent list", any(t["id"] == life_task["id"] for t in r.json()))

    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "123456"})
    r = c.get(f"/api/children/{adskhan['id']}/day-progress?date_key={life_date}")
    check("lifecycle: kid sees the task", any(t["id"] == life_task["id"] for t in r.json()["tasks"]), r.text[:200])

    r = c.post(f"/api/tasks/{life_task['id']}/start")
    check("lifecycle: start timer", r.status_code == 200 and r.json()["timer_started_at"])
    r = c.post(f"/api/tasks/{life_task['id']}/complete")
    check("lifecycle: finish task", r.status_code == 200 and r.json()["status"] == "completed")

    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    pts_before = next(k["points"] for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    r = c.post(f"/api/tasks/{life_task['id']}/approve")
    check("lifecycle: approve task", r.status_code == 200)
    pts_after = next(k["points"] for k in c.get("/api/children").json() if k["id"] == adskhan["id"])
    check("lifecycle: points awarded", pts_after == pts_before + 5, f"{pts_before}->{pts_after}")

    r = c.post("/api/rewards", json={"name": "Permen", "description": "", "cost_points": 2})
    reward = r.json()
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "123456"})
    r = c.post(f"/api/rewards/{reward['id']}/redeem", params={"child_id": adskhan["id"]})
    check("lifecycle: redeem reward (belanja poin)", r.status_code == 200, r.text[:200])

    r = c.post("/api/points/redeem-money", json={"child_id": adskhan["id"], "points": 1})
    check("lifecycle: exchange points to rupiah", r.status_code == 200, r.text[:200])

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

    # ================= 23. REAL-TIME TIME WINDOW =================
    # A task due far in the future today can't be started yet ("too early");
    # a task whose due_time already passed can't be started ("too late").
    import datetime as _dt
    now_local = _dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(hours=7)
    today_local = now_local.strftime("%Y-%m-%d")

    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    # Task due 2 min ago -> too late
    late_min = (now_local - _dt.timedelta(minutes=2))
    late_hhmm = late_min.strftime("%H:%M")
    r = c.post("/api/tasks", json={
        "title": "Bangun pagi", "points": 5, "date_key": today_local,
        "target_children": [syila["id"]], "due_time": late_hhmm, "duration_minutes": 10,
    })
    late_task = r.json()
    # Task due in 6 hours -> too early (window is due-duration .. due)
    early_dt = (now_local + _dt.timedelta(hours=6))
    early_hhmm = early_dt.strftime("%H:%M")
    r = c.post("/api/tasks", json={
        "title": "Mandi sore", "points": 5, "date_key": today_local,
        "target_children": [syila["id"]], "due_time": early_hhmm, "duration_minutes": 10,
    })
    early_task = r.json()

    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    # NOTE: sequence rule — need these to be the actionable ones. Since Syila
    # may have other pending tasks from earlier sections, we just assert the
    # time-gate errors specifically (409) when we attempt them directly.
    r = c.post(f"/api/tasks/{late_task['id']}/start")
    check("time-gate: too-late task blocked", r.status_code == 409, f"{r.status_code} {r.text[:100]}")
    r = c.post(f"/api/tasks/{early_task['id']}/start")
    check("time-gate: too-early task blocked", r.status_code == 409, f"{r.status_code} {r.text[:100]}")

    # A task with no due_time is not time-gated (only sequence-gated)
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post("/api/tasks", json={
        "title": "Tugas bebas waktu", "points": 5, "date_key": today_local,
        "target_children": [syila["id"]], "is_bonus": True,  # bonus to skip sequence
    })
    free_task = r.json()
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    r = c.post(f"/api/tasks/{free_task['id']}/start")
    check("time-gate: no-due-time bonus startable now", r.status_code == 200, f"{r.status_code} {r.text[:100]}")

    # ================= 24. IDEMPOTENT DELETES & RECURRENCE DEDUP =================
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

    # Recurrence: approving a daily task spawns tomorrow's copy, NOT a same-day duplicate
    r = c.post("/api/tasks", json={"title": "HarianDedup", "points": 5, "target_children": [adskhan["id"]], "date_key": today_local, "recurrence": "daily", "is_bonus": True})
    rec = r.json()
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    c.post(f"/api/tasks/{rec['id']}/complete")
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post(f"/api/tasks/{rec['id']}/approve")
    check("recur: approve ok", r.status_code == 200, r.text[:100])
    same_day_open = [t for t in c.get(f"/api/tasks?date_key={today_local}&child_id={adskhan['id']}").json()
                     if t["title"] == "HarianDedup" and t["status"] in ("pending", "rejected")]
    check("recur: no same-day duplicate", len(same_day_open) == 0, f"found {len(same_day_open)}")
    tomorrow_local = (now_local + _dt.timedelta(days=1)).strftime("%Y-%m-%d")
    next_day = [t for t in c.get(f"/api/tasks?date_key={tomorrow_local}&child_id={adskhan['id']}").json() if t["title"] == "HarianDedup"]
    check("recur: spawned on next day", len(next_day) == 1, f"found {len(next_day)}")
    # double-approve doesn't double-spawn
    r = c.post(f"/api/tasks/{rec['id']}/approve")
    check("recur: double-approve blocked", r.status_code == 400, str(r.status_code))
    next_day2 = [t for t in c.get(f"/api/tasks?date_key={tomorrow_local}&child_id={adskhan['id']}").json() if t["title"] == "HarianDedup"]
    check("recur: still exactly one tomorrow", len(next_day2) == 1, f"found {len(next_day2)}")

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

    # ================= 26. THREE PIGGY BANKS =================
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c.post("/api/config", json={"piggy_save_pct": 50, "piggy_spend_pct": 30, "piggy_share_pct": 20})
    r = c.get("/api/config")
    check("piggy: config persists", r.json()["piggy_save_pct"] == 50 and r.json()["piggy_share_pct"] == 20)

    # Create + complete + approve a bonus task and check piggy split
    r = c.post("/api/tasks", json={"title": "PiggyTest", "points": 10, "target_children": [syila["id"]], "date_key": today_local, "is_bonus": True})
    pt = r.json()
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    c.post(f"/api/tasks/{pt['id']}/complete")
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    syi_before = next(k for k in c.get("/api/children").json() if k["id"] == syila["id"])
    save_before = syi_before.get("piggy_save", 0)
    spend_before = syi_before.get("piggy_spend", 0)
    share_before = syi_before.get("piggy_share", 0)
    c.post(f"/api/tasks/{pt['id']}/approve")
    syi_after = next(k for k in c.get("/api/children").json() if k["id"] == syila["id"])
    check("piggy: save increased", syi_after.get("piggy_save", 0) == save_before + 5, f"{save_before}->{syi_after.get('piggy_save')}")
    check("piggy: spend increased", syi_after.get("piggy_spend", 0) == spend_before + 3, f"{spend_before}->{syi_after.get('piggy_spend')}")
    check("piggy: share increased", syi_after.get("piggy_share", 0) == share_before + 2, f"{share_before}->{syi_after.get('piggy_share')}")

    # ================= 27. WEEKLY REPORT =================
    r = c.get("/api/family/weekly-report")
    check("weekly: returns report", r.status_code == 200 and "children" in r.json() and len(r.json()["children"]) == 2, r.text[:200])
    check("weekly: has period", "period_start" in r.json() and "period_end" in r.json())
    report_child = r.json()["children"][0]
    check("weekly: child has piggy info", "piggy_save" in report_child["child"], str(report_child["child"].keys()))
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
    c.post(f"/api/tasks/{ut['id']}/complete")
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

    # ================= 35. VACATION MODE PAUSES RECURRENCE =================
    r = c.post("/api/config", json={"vacation_mode": True, "vacation_note": "Liburan ke Bali"})
    check("vacation: toggle on", r.status_code == 200)
    r = c.get("/api/config")
    check("vacation: reflects in config", r.json()["vacation_mode"] is True and r.json()["vacation_note"] == "Liburan ke Bali")
    # Approving a recurring task while on vacation must NOT spawn next occurrence
    r = c.post("/api/tasks", json={"title": "VacTest", "points": 5, "child_id": adskhan["id"], "date_key": today_local, "recurrence": "daily", "is_bonus": True})
    vt = r.json()
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    c.post(f"/api/tasks/{vt['id']}/complete")
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c.post(f"/api/tasks/{vt['id']}/approve")
    tomorrow_vac = (now_local + _dt.timedelta(days=1)).strftime("%Y-%m-%d")
    spawned = [t for t in c.get(f"/api/tasks?date_key={tomorrow_vac}&child_id={adskhan['id']}").json() if t["title"] == "VacTest"]
    check("vacation: recurrence did NOT spawn while paused", len(spawned) == 0, f"found {len(spawned)}")
    r = c.get(f"/api/children/{adskhan['id']}/day-progress?date_key={today_local}")
    check("vacation: flag visible in day-progress", r.json().get("vacation_mode") is True)
    # Turn off vacation, spawning should resume for NEW approvals
    c.post("/api/config", json={"vacation_mode": False})
    r = c.post("/api/tasks", json={"title": "PostVacation", "points": 5, "child_id": adskhan["id"], "date_key": today_local, "recurrence": "daily", "is_bonus": True})
    pv = r.json()
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "654321"})
    c.post(f"/api/tasks/{pv['id']}/complete")
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c.post(f"/api/tasks/{pv['id']}/approve")
    spawned2 = [t for t in c.get(f"/api/tasks?date_key={tomorrow_vac}&child_id={adskhan['id']}").json() if t["title"] == "PostVacation"]
    check("vacation: recurrence resumes when off", len(spawned2) == 1, f"found {len(spawned2)}")

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
    r = c.post(f"/api/tasks/{ft['id']}/complete")
    check("photo: complete without photo rejected", r.status_code == 422, str(r.status_code))
    r = c.post(f"/api/tasks/{ft['id']}/complete", json={"photo_url": "data:image/png;base64,XYZ"})
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
    check("regression: other defaults still sane", r.json()["daily_point_goal"] == 50 and r.json()["piggy_save_pct"] == 40, str(r.json()))

    # ================= 43. REGRESSION: /auth/me must include all self-editable profile fields =================
    c.post("/api/auth/login", json={"member_id": syila["id"], "passcode": "123456"})
    c.post("/api/me/profile", json={"sound_theme": "fanfare"})
    r = c.get("/api/auth/me")
    check("regression: sound_theme present in /auth/me", r.json().get("sound_theme") == "fanfare", str(r.json().get("sound_theme")))

print("\n" + "=" * 50)
print(f"PASSED: {len(passed)}   FAILED: {len(failed)}")
if failed:
    print("FAILURES:")
    for f in failed:
        print("  -", f)
    raise SystemExit(1)
print("ALL TESTS PASSED ✅")
