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

print("\n" + "=" * 50)
print(f"PASSED: {len(passed)}   FAILED: {len(failed)}")
if failed:
    print("FAILURES:")
    for f in failed:
        print("  -", f)
    raise SystemExit(1)
print("ALL TESTS PASSED ✅")
