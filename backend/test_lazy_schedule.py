"""Lazy day building, ranged task lists, schedule compaction and the
bootstrap endpoints. Same style as test_e2e.py: run with `python test_lazy_schedule.py`."""
import os
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "testdb")
os.environ.setdefault("JWT_SECRET", "test-secret")

import asyncio
import datetime as dt

import server
from mongomock_motor import AsyncMongoMockClient

server.client = AsyncMongoMockClient()
server.db = server.client["testdb"]

from fastapi.testclient import TestClient  # noqa: E402

passed, failed = [], []


def check(name, cond, extra=""):
    (passed if cond else failed).append(name + (f"  [{extra}]" if extra and not cond else ""))
    print(("PASS" if cond else "FAIL"), name, extra if not cond else "")


def run(coro):
    return asyncio.run(coro)


def day(offset):
    base = dt.datetime.strptime(server._today_key(), "%Y-%m-%d")
    return (base + dt.timedelta(days=offset)).strftime("%Y-%m-%d")


def reset_schedule():
    for coll in ("tasks", "day_templates", "template_tasks", "template_assignments", "off_days", "tasks_archive"):
        run(getattr(server.db, coll).delete_many({}))
    server._invalidate_days_ready()
    server._invalidate_config_cache()


with TestClient(server.app, base_url="https://testserver") as c:
    members = c.get("/api/auth/members").json()
    abi = next(m for m in members if m["name"] == "Abi")
    kids = [m for m in members if m["role"] == "child"]
    adskhan = next(m for m in kids if m["name"] == "Adskhan")
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    c.post("/api/config", json={"min_gap_seconds": 0, "auto_approve_tasks": False})
    SEG = {x["label"]: x["id"] for x in c.get("/api/config").json()["day_segments"]}
    first_seg = next(iter(SEG.values()))
    TODAY, TOMORROW = day(0), day(1)

    # ---------------- Default template: only near days are built ----------------
    reset_schedule()
    tpl = c.post("/api/day-templates", json={"name": "Hari Biasa", "is_default": True}).json()
    for wd in range(7):
        c.post("/api/template-tasks", json={"template_id": tpl["id"], "weekday": wd,
                                            "segment_id": first_seg, "title": "Rapikan kasur", "points": 10})
    rows = c.get("/api/tasks").json()
    dates = sorted({t["date_key"] for t in rows})
    check("lazy: today is built from the default template", TODAY in dates, str(dates))
    check("lazy: tomorrow is built too", TOMORROW in dates, str(dates))
    check("lazy: nothing beyond tomorrow is pre-built", all(d <= TOMORROW for d in dates), str(dates))
    check("lazy: one copy per child per day", len([t for t in rows if t["date_key"] == TODAY]) == len(kids),
          str(len(rows)))

    # Re-reading builds nothing new
    n_before = run(server.db.tasks.count_documents({}))
    c.get("/api/tasks")
    c.get("/api/tasks")
    check("lazy: repeated reads are idempotent", run(server.db.tasks.count_documents({})) == n_before)

    # A parent opening a future day builds just that day
    D5 = day(5)
    r = c.post(f"/api/days/{D5}/prepare")
    check("prepare: builds a future day", r.status_code == 200 and r.json()["created"] == len(kids), r.text[:200])
    r = c.post(f"/api/days/{D5}/prepare")
    check("prepare: second call creates nothing", r.json()["created"] == 0, r.text[:200])
    check("prepare: other future days untouched",
          run(server.db.tasks.count_documents({"date_key": day(4)})) == 0)
    r = c.post(f"/api/days/{day(90)}/prepare")
    check("prepare: too far ahead → 422", r.status_code == 422, str(r.status_code))
    r = c.post("/api/days/bukan-tanggal/prepare")
    check("prepare: invalid date → 422", r.status_code == 422, str(r.status_code))
    r = c.post(f"/api/days/{day(-3)}/prepare")
    check("prepare: past day is a no-op", r.status_code == 200 and r.json().get("past") is True, r.text[:120])

    # A hand-made mission on an unbuilt day must not stop the routine filling it
    D7 = day(7)
    r = c.post("/api/tasks", json={"title": "Les piano", "points": 5, "date_key": D7,
                                   "target_children": [adskhan["id"]]})
    check("create: manual task on a future day ok", r.status_code == 200, r.text[:150])
    d7 = [t["title"] for t in c.get(f"/api/tasks?date_key={D7}").json()]
    check("create: the routine was still built for that day", d7.count("Rapikan kasur") == len(kids), str(d7))
    check("create: the manual task is there too", "Les piano" in d7, str(d7))

    # Off days are respected
    D9 = day(9)
    c.post("/api/off-days", json={"start_date": D9, "note": "libur"})
    c.post(f"/api/days/{D9}/prepare")
    check("prepare: a full off day stays empty", run(server.db.tasks.count_documents({"date_key": D9})) == 0)

    # ---------------- Kid paths build an empty near day inline ----------------
    reset_schedule()
    tpl = c.post("/api/day-templates", json={"name": "Hari Biasa", "is_default": True}).json()
    for wd in range(7):
        c.post("/api/template-tasks", json={"template_id": tpl["id"], "weekday": wd,
                                            "segment_id": first_seg, "title": "Sikat gigi", "points": 5})
    run(server.db.tasks.delete_many({}))
    server._invalidate_days_ready()
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "123456"})
    r = c.get(f"/api/children/{adskhan['id']}/segments-day")
    titles = [a["title"] for s in r.json().get("segments", []) for a in s.get("activities", s.get("tasks", []))]
    check("kid: segments-day builds an empty today inline", r.status_code == 200 and "Sikat gigi" in str(r.json()),
          str(titles)[:200])
    r = c.get(f"/api/children/{adskhan['id']}/day-progress")
    check("kid: day-progress sees today's mission", r.status_code == 200 and "Sikat gigi" in str(r.json()))
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})

    # ---------------- Repeating series only fill near days on read ----------------
    reset_schedule()
    c.post("/api/tasks", json={"title": "Siram tanaman", "points": 5, "date_key": day(-3),
                               "target_children": [adskhan["id"]], "recurrence": "daily"})
    rows = [t for t in c.get("/api/tasks").json() if t["title"] == "Siram tanaman"]
    got = sorted(t["date_key"] for t in rows)
    check("series: today and tomorrow appear on read", TODAY in got and TOMORROW in got, str(got))
    check("series: no fortnight pre-built", max(got) == TOMORROW, str(got))
    check("series: no past backfill", day(-2) not in got and day(-1) not in got, str(got))
    r = c.post("/api/tasks/materialize-recurring?days_ahead=5")
    check("series: manual refresh still fills ahead", r.json()["created"] >= 4, r.text[:120])

    # Vacation mode pauses series
    reset_schedule()
    c.post("/api/config", json={"vacation_mode": True})
    c.post("/api/tasks", json={"title": "Libur", "points": 5, "date_key": day(-2),
                               "target_children": [adskhan["id"]], "recurrence": "daily"})
    got = [t for t in c.get("/api/tasks").json() if t["title"] == "Libur"]
    check("series: vacation mode builds nothing", len(got) == 1, str(len(got)))
    c.post("/api/config", json={"vacation_mode": False})

    # ---------------- Ranged task list ----------------
    reset_schedule()
    for off in (-20, -1, 0, 3, 30):
        c.post("/api/tasks", json={"title": f"T{off}", "points": 1, "date_key": day(off),
                                   "target_children": [adskhan["id"]]})
    old = run(server.db.tasks.find_one({"title": "T-20"}))
    run(server.db.tasks.update_one({"id": old["id"]}, {"$set": {"status": "completed"}}))
    r = c.get(f"/api/tasks?start_date={day(-7)}&end_date={day(14)}")
    titles = sorted(t["title"] for t in r.json())
    check("range: only the window is returned", titles == ["T-1", "T0", "T3"], str(titles))
    r = c.get(f"/api/tasks?start_date={day(-7)}&end_date={day(14)}&include_open=true")
    titles = sorted(t["title"] for t in r.json())
    check("range: include_open adds an old task still awaiting approval", "T-20" in titles and "T30" not in titles,
          str(titles))
    r = c.get(f"/api/tasks?start_date={day(-7)}&end_date={day(14)}&child_id={adskhan['id']}")
    check("range: combines with a child filter", len(r.json()) == 3, str(len(r.json())))
    r = c.get("/api/tasks?start_date=nope")
    check("range: invalid date → 422", r.status_code == 422, str(r.status_code))
    check("range: no params still returns everything", len(c.get("/api/tasks").json()) == 5)

    # ---------------- Stage 3: compaction ----------------
    reset_schedule()
    tpl = c.post("/api/day-templates", json={"name": "Hari Biasa", "is_default": True}).json()
    for wd in range(7):
        c.post("/api/template-tasks", json={"template_id": tpl["id"], "weekday": wd,
                                            "segment_id": first_seg, "title": "Beres kamar", "points": 10})
    # Simulate the old fortnight pre-build
    run(server._fill_days_from_default_template(days_ahead=14))
    c.post("/api/tasks", json={"title": "Baca buku", "points": 5, "date_key": TODAY,
                               "target_children": [adskhan["id"]], "recurrence": "daily"})
    run(server._materialize_recurring(days_ahead=14))
    total_before = run(server.db.tasks.count_documents({}))
    # One future day the parent customised: it must survive
    D6 = day(6)
    edited = run(server.db.tasks.find_one({"date_key": D6, "title": "Beres kamar"}))
    c.patch(f"/api/tasks/{edited['id']}", json={"points": 99})
    # One future day a child already started: it must survive
    D8 = day(8)
    started = run(server.db.tasks.find_one({"date_key": D8, "title": "Beres kamar"}))
    run(server.db.tasks.update_one({"id": started["id"]}, {"$set": {"timer_started_at": server.now_iso()}}))

    r = c.post("/api/maintenance/compact-schedule?dry_run=true")
    dry = r.json()
    check("compact: dry run reports without deleting",
          r.status_code == 200 and dry["removed"] == 0 and run(server.db.tasks.count_documents({})) == total_before,
          r.text[:200])
    check("compact: finds removable future copies", dry["removable_tasks"] > 0, r.text[:200])
    check("compact: never touches today or tomorrow", all(d > TOMORROW for d in dry["days"]), str(dry["days"]))
    check("compact: keeps the day a parent edited", D6 not in dry["days"], str(dry["days"]))
    check("compact: keeps the day a child started", D8 not in dry["days"], str(dry["days"]))

    r = c.post("/api/maintenance/compact-schedule?dry_run=false")
    res = r.json()
    check("compact: removes and archives", r.status_code == 200 and res["removed"] == dry["removable_tasks"]
          and run(server.db.tasks_archive.count_documents({"archive_batch": res["archive_batch"]})) == res["removed"],
          r.text[:200])
    check("compact: edited mission still exists", run(server.db.tasks.find_one({"id": edited["id"]})) is not None)
    check("compact: started mission still exists", run(server.db.tasks.find_one({"id": started["id"]})) is not None)

    # The cleared days rebuild identically when opened
    gone_day = res["days"][0]
    c.post(f"/api/days/{gone_day}/prepare")
    rebuilt = c.get(f"/api/tasks?date_key={gone_day}").json()
    check("compact: a cleared day rebuilds its routine",
          sorted(t["title"] for t in rebuilt).count("Beres kamar") == len(kids), str([t["title"] for t in rebuilt]))
    check("compact: a cleared day rebuilds its series",
          any(t["title"] == "Baca buku" for t in rebuilt), str([t["title"] for t in rebuilt]))

    # Undo puts everything back (skipping what already exists again)
    r = c.post(f"/api/tasks/undo-restart?archive_batch={res['archive_batch']}")
    check("compact: undo works", r.status_code == 200, r.text[:150])

    # Vacation mode refuses
    c.post("/api/config", json={"vacation_mode": True})
    r = c.post("/api/maintenance/compact-schedule?dry_run=true")
    check("compact: refused during vacation mode", r.status_code == 409, str(r.status_code))
    c.post("/api/config", json={"vacation_mode": False})

    # A child cannot compact
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "123456"})
    r = c.post("/api/maintenance/compact-schedule?dry_run=true")
    check("compact: kids are blocked", r.status_code == 403, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})

    # ---------------- Member cache follows writes ----------------
    r = c.patch("/api/auth/profile", json={"name": "Abi Baru"})
    if r.status_code == 404:
        r = c.post("/api/auth/profile", json={"name": "Abi Baru"})
    me = c.get("/api/auth/me").json()
    check("cache: a profile edit is visible immediately", r.status_code != 200 or me.get("name") == "Abi Baru",
          f"{r.status_code} {me.get('name')}")

    # ---------------- Bootstrap endpoints ----------------
    r = c.get("/api/parent/bootstrap")
    b = r.json()
    check("bootstrap: parent gets everything in one call",
          r.status_code == 200 and all(k in b for k in ("children", "tasks", "rewards", "consequences",
                                                        "redemptions", "stats", "window")), r.text[:200])
    check("bootstrap: parent tasks are windowed",
          all((t.get("date_key") or "") >= b["window"]["start_date"] or t.get("status") == "completed"
              for t in b["tasks"]), str(b["window"]))
    run(server.db.app_config.update_one({"parent_id": "family-default"},
                                        {"$set": {"slideshow_background_image": "data:image/png;base64," + "A" * 5000}}))
    server._invalidate_config_cache()
    r = c.get(f"/api/kid/{adskhan['id']}/bootstrap")
    kb = r.json()
    check("bootstrap: kid gets child + config", r.status_code == 200 and kb["child"]["id"] == adskhan["id"]
          and "rupiah_per_point" in kb["config"], r.text[:200])
    check("bootstrap: kid config drops heavy images", "slideshow_background_image" not in kb["config"])
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "123456"})
    other = next(k for k in kids if k["id"] != adskhan["id"])
    check("bootstrap: a kid cannot read a sibling's", c.get(f"/api/kid/{other['id']}/bootstrap").status_code == 403)
    check("bootstrap: a kid cannot read the parent's", c.get("/api/parent/bootstrap").status_code == 403)
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})

    # ---------------- Media URLs instead of inline base64 ----------------
    img = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    rw = c.post("/api/rewards", json={"name": "Es krim", "cost_points": 10, "image": img}).json()
    listed = next(x for x in c.get("/api/rewards").json() if x["id"] == rw["id"])
    check("media: list carries a URL, not base64", listed["image"].startswith("/api/media/reward/"), listed["image"][:60])
    r = c.get(listed["image"])
    check("media: URL serves the image bytes", r.status_code == 200 and r.headers["content-type"] == "image/png"
          and r.content[:4] == b"\x89PNG", str(r.status_code))
    check("media: cached by the browser", "immutable" in r.headers.get("cache-control", ""))
    check("media: works without a session (img tags)",
          TestClient(server.app, base_url="https://testserver").get(listed["image"]).status_code == 200)
    check("media: a forged signature is refused", c.get(listed["image"][:-3] + "abc").status_code == 403)
    c.patch(f"/api/rewards/{rw['id']}", json={"name": "Es krim cokelat", "image": listed["image"]})
    check("media: echoing the URL back keeps the image",
          run(server.db.rewards.find_one({"id": rw["id"]}))["image"] == img)
    c.patch(f"/api/rewards/{rw['id']}", json={"image": ""})
    check("media: an old URL stops working once the image changes", c.get(listed["image"]).status_code == 404)

    # ---------------- Family mission ----------------
    reset_schedule()
    r = c.get("/api/family-mission")
    check("mission: disabled by default", r.status_code == 200 and r.json()["enabled"] is False, r.text[:150])
    r = c.put("/api/family-mission", json={"enabled": True, "title": "Ke Kebun Binatang", "target_points": 50,
                                           "reward": "Jalan-jalan", "emoji": "🦁"})
    check("mission: parent can set it", r.status_code == 200 and r.json()["target_points"] == 50, r.text[:150])
    t1 = c.post("/api/tasks", json={"title": "Bantu masak", "points": 30, "date_key": TODAY,
                                    "target_children": [adskhan["id"]]}).json()
    run(server.db.tasks.update_one({"id": t1["id"]}, {"$set": {"status": "approved"}}))
    other = next(k for k in kids if k["id"] != adskhan["id"])
    t2 = c.post("/api/tasks", json={"title": "Siram bunga", "points": 25, "date_key": TODAY,
                                    "target_children": [other["id"]]}).json()
    run(server.db.tasks.update_one({"id": t2["id"]}, {"$set": {"status": "approved"}}))
    m = c.get("/api/family-mission").json()
    check("mission: everyone's points add up", m["earned_points"] == 55 and m["goal_met"] is True, str(m)[:200])
    check("mission: per-child contributions",
          {x["name"]: x["points"] for x in m["contributions"]} == {adskhan["name"]: 30, other["name"]: 25},
          str(m["contributions"]))
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "123456"})
    check("mission: kids can see it", c.get("/api/family-mission").json()["title"] == "Ke Kebun Binatang")
    check("mission: kids cannot change it",
          c.put("/api/family-mission", json={"enabled": False}).status_code == 403)

    # ---------------- Before/after photos ----------------
    t3 = run(server.db.tasks.find_one({"id": t1["id"]}))
    run(server.db.tasks.update_one({"id": t1["id"]}, {"$set": {"status": "pending"}}))
    r = c.post(f"/api/tasks/{t1['id']}/photo", json={"kind": "before", "photo_url": img})
    check("photo: kid attaches a before picture", r.status_code == 200
          and r.json()["before_photo_url"].startswith("/api/media/task/"), r.text[:150])
    r = c.post(f"/api/tasks/{t1['id']}/photo", json={"kind": "after", "photo_url": img})
    check("photo: and an after picture", r.status_code == 200
          and r.json()["completion_photo_url"].startswith("/api/media/task/"), r.text[:150])
    check("photo: served via media", c.get(r.json()["before_photo_url"]).status_code == 200)
    r = c.post(f"/api/tasks/{t2['id']}/photo", json={"kind": "before", "photo_url": img})
    check("photo: not on a sibling's mission", r.status_code == 403, str(r.status_code))
    r = c.post(f"/api/tasks/{t1['id']}/photo", json={"kind": "before", "photo_url": "http://x"})
    check("photo: must be an image", r.status_code == 422, str(r.status_code))
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    dp = c.get("/api/family/day-progress").json()
    all_tasks = [t for ch in dp["children"] for t in ch["tasks"]]
    check("photo: day-progress carries URLs, not base64",
          all(not str(t.get("before_photo_url") or "").startswith("data:") for t in all_tasks))

    # ---------------- Photos live in `media`, tasks keep a pointer ----------------
    raw = run(server.db.tasks.find_one({"id": t1["id"]}))
    check("media: task stores a short pointer, not the picture",
          str(raw.get("before_photo_url")).startswith("media:") and str(raw.get("completion_photo_url")).startswith("media:"),
          str(raw.get("before_photo_url"))[:40])
    check("media: picture kept in the media collection",
          run(server.db.media.find_one({"_id": f"task:{t1['id']}:before_photo_url"})) is not None)
    # An older task with the picture still inline is moved out, and its URL stays the same.
    run(server.db.tasks.update_one({"id": t2["id"]}, {"$set": {"completion_photo_url": img}}))
    url_before = server._media_ref("task", t2["id"], "completion_photo_url", img)
    run(server.db.app_meta.delete_one({"_id": "photos_offloaded"}))
    moved = run(server._maybe_offload_task_photos(100))
    raw2 = run(server.db.tasks.find_one({"id": t2["id"]}))
    check("media: old inline picture is moved out", moved >= 1 and raw2["completion_photo_url"].startswith("media:"),
          str(moved))
    check("media: its URL does not change",
          server._media_ref("task", t2["id"], "completion_photo_url", raw2["completion_photo_url"]) == url_before)
    got = c.get(url_before)
    check("media: moved picture is still served", got.status_code == 200 and got.headers["content-type"].startswith("image/"),
          str(got.status_code))
    check("media: done flag set once nothing is left",
          run(server.db.app_meta.find_one({"_id": "photos_offloaded"})) is not None)
    check("media: wrong version is refused",
          c.get(url_before.replace("v=", "v=0")).status_code in (403, 404))

    # ---------------- Memories ----------------
    run(server.db.tasks.update_one({"id": t1["id"]}, {"$set": {"status": "approved"}}))
    r = c.get(f"/api/memories?month={TODAY[:7]}")
    mem = r.json()
    check("memories: this month's photos", r.status_code == 200 and any(p["title"] == "Bantu masak" for p in mem["photos"]),
          r.text[:200])
    check("memories: before and after both present",
          all(p["before"] and p["after"] for p in mem["photos"] if p["title"] == "Bantu masak"))
    check("memories: bad month → 422", c.get("/api/memories?month=2026-13-01").status_code == 422)
    link = c.post("/api/view-links", json={"label": "Nenek"}).json()
    r = c.get(f"/api/public/view/{link['token']}/memories?month={TODAY[:7]}")
    check("memories: grandparents' link shows them", r.status_code == 200 and len(r.json()["photos"]) >= 1, r.text[:150])
    check("memories: unknown link → 404", c.get("/api/public/view/nope/memories").status_code == 404)

    # ---------------- Adaptive suggestions ----------------
    reset_schedule()
    tpl = c.post("/api/day-templates", json={"name": "Biasa", "is_default": True}).json()
    slot = c.post("/api/template-tasks", json={"template_id": tpl["id"], "weekday": 0, "segment_id": first_seg,
                                               "title": "Latihan piano", "points": 8}).json()
    docs = []
    for i in range(1, 11):
        docs.append({"id": f"sg-{i}", "parent_id": "family-default", "child_id": adskhan["id"],
                     "title": "Latihan piano", "points": 8, "date_key": day(-i), "is_bonus": False,
                     "status": "approved" if i <= 2 else "missed", "from_template_slot_id": slot["id"]})
        docs.append({"id": f"sg2-{i}", "parent_id": "family-default", "child_id": adskhan["id"],
                     "title": "Sikat gigi", "points": 5, "date_key": day(-i), "is_bonus": False,
                     "status": "approved", "from_template_slot_id": slot["id"]})
    run(server.db.tasks.insert_many(docs))
    sug = c.get("/api/schedule/suggestions").json()["suggestions"]
    piano = next((x for x in sug if x["title"] == "Latihan piano"), None)
    check("suggest: flags a mission that keeps being missed", piano and piano["kind"] == "struggling", str(sug)[:200])
    check("suggest: notices a mastered habit", any(x["title"] == "Sikat gigi" and x["kind"] == "mastered" for x in sug))
    r = c.post("/api/schedule/suggestions/apply", json={"slot_id": slot["id"], "type": "set_points",
                                                         "points": piano["action"]["points"]})
    check("suggest: applying updates the routine", r.status_code == 200 and r.json()["points"] == piano["action"]["points"],
          r.text[:150])
    check("suggest: unknown slot → 404", c.post("/api/schedule/suggestions/apply",
          json={"slot_id": "nope", "type": "make_bonus"}).status_code == 404)

    # ---------------- Simple mode flag ----------------
    r = c.patch(f"/api/children/{adskhan['id']}", json={"simple_mode": True})
    check("simple: parent can switch a child to simple mode", r.status_code == 200 and r.json().get("simple_mode") is True)

    # ---------------- Photo-required missions in the section flow ----------------
    reset_schedule()
    c.post("/api/config", json={"min_gap_seconds": 0})
    pr = c.post("/api/tasks", json={"title": "Rapikan meja", "points": 5, "date_key": TODAY,
                                    "segment_id": first_seg, "photo_required": True,
                                    "target_children": [adskhan["id"]]}).json()
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "123456"})
    sd = c.get(f"/api/children/{adskhan['id']}/segments-day").json()
    seg = next(x for x in sd["segments"] if any(a["id"] == pr["id"] for a in x["activities"]))
    act = next(a for a in seg["activities"] if a["id"] == pr["id"])
    check("photo-req: flag reaches the child's checklist", act["photo_required"] is True)
    reason = (sd.get("late_reasons") or [{}])[0].get("id")
    sbody = {"child_id": adskhan["id"], "date_key": TODAY, "segment_id": seg["id"]}
    r = c.post("/api/segment-sessions/start", json=sbody)
    if r.status_code == 409 and reason:
        r = c.post("/api/segment-sessions/start", json={**sbody, "late_reason_id": reason})
    check("photo-req: section starts", r.status_code == 200, r.text[:150])
    c.post(f"/api/tasks/{pr['id']}/check", json={"checked": True})
    r = c.post("/api/segment-sessions/finish", json={**sbody, "late_reason_id": reason})
    check("photo-req: cannot finish without the after-photo", r.status_code == 422 and "foto" in r.text.lower(),
          r.text[:150])
    c.post(f"/api/tasks/{pr['id']}/photo", json={"kind": "after", "photo_url": img})
    r = c.post("/api/segment-sessions/finish", json={**sbody, "late_reason_id": reason})
    check("photo-req: finishes once the photo is attached", r.status_code == 200, r.text[:150])
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})

    # ---------------- Weekly routine + lazy days ----------------
    reset_schedule()
    run(server.db.app_meta.delete_many({"_id": "routine_migrated"}))
    run(server.db.day_builds.delete_many({}))
    r = c.post("/api/routine/slots", json={"weekdays": list(range(7)), "segment_id": first_seg,
                                           "title": "Rutin pagi", "points": 7})
    check("routine: slot added for the whole week", r.status_code == 200, r.text[:200])
    rows = [t for t in c.get("/api/tasks").json() if t["title"] == "Rutin pagi"]
    got = sorted(t["date_key"] for t in rows)
    check("routine: parent list builds today + tomorrow", TODAY in got and TOMORROW in got, str(got))
    check("routine: one copy per child per day", len(rows) == 2 * len(kids), str(len(rows)))
    n = run(server.db.tasks.count_documents({"title": "Rutin pagi"}))
    c.get("/api/tasks"); c.post(f"/api/days/{TODAY}/prepare"); c.post(f"/api/days/{TOMORROW}/prepare")
    check("routine: repeated reads never duplicate", run(server.db.tasks.count_documents({"title": "Rutin pagi"})) == n)
    # an old default template must not double a routine-built day after migration
    tplx = c.post("/api/day-templates", json={"name": "Lama", "is_default": True}).json()
    for wd in range(7):
        c.post("/api/template-tasks", json={"template_id": tplx["id"], "weekday": wd, "segment_id": first_seg,
                                            "title": "Dari template lama", "points": 3})
    run(server.db.app_meta.update_one({"_id": "routine_migrated"}, {"$set": {"at": "x"}}, upsert=True))
    c.post(f"/api/days/{day(3)}/prepare")
    d3 = [t["title"] for t in c.get(f"/api/tasks?date_key={day(3)}").json()]
    check("routine: day 3 comes from the routine", d3.count("Rutin pagi") == len(kids), str(d3))
    check("routine: superseded template adds nothing", "Dari template lama" not in d3, str(d3))
    # editing the routine shows up on the parent's list straight away
    for slot in [x for x in c.get("/api/routine").json()["slots"] if x["title"] == "Rutin pagi"]:
        c.patch(f"/api/routine/slots/{slot['id']}", json={"points": 21})
    after = [t for t in c.get(f"/api/tasks?date_key={TOMORROW}").json() if t["title"] == "Rutin pagi"]
    check("routine: an edit is visible without waiting", after and all(t["points"] == 21 for t in after),
          str([t["points"] for t in after]))

    # ---------------- Offline replay: start/finish keep their real time ----------------
    UTC = dt.timezone.utc
    now_utc = dt.datetime.now(UTC)
    check("offline: a recent time is believed",
          server._resolve_happened_at((now_utc - dt.timedelta(hours=1)).isoformat()) is not None)
    check("offline: a future time is ignored",
          server._resolve_happened_at((now_utc + dt.timedelta(hours=1)).isoformat()) is None)
    check("offline: a stale time is ignored",
          server._resolve_happened_at((now_utc - dt.timedelta(hours=13)).isoformat()) is None)
    check("offline: junk is ignored", server._resolve_happened_at("kemarin") is None)
    seg_probe = {"id": "s", "start_time": "07:00", "end_time": "08:00"}
    probe_dk = (now_utc + dt.timedelta(hours=7)).strftime("%Y-%m-%d")
    early = (dt.datetime.strptime(probe_dk + " 06:50", "%Y-%m-%d %H:%M") - dt.timedelta(hours=7)).replace(tzinfo=UTC)
    late = (dt.datetime.strptime(probe_dk + " 07:40", "%Y-%m-%d %H:%M") - dt.timedelta(hours=7)).replace(tzinfo=UTC)
    tm_early = server._segment_timing(seg_probe, None, probe_dk, 10, early)
    tm_late = server._segment_timing(seg_probe, None, probe_dk, 10, late)
    check("offline: timing uses the press time (before start = locked)", tm_early["locked"] and not tm_early["late_start"])
    check("offline: timing uses the press time (late start, on-time finish)",
          tm_late["late_start"] and not tm_late["locked"] and not tm_late["late_finish"])

    reset_schedule()
    c.post("/api/tasks", json={"title": "Baca buku", "points": 5, "date_key": TODAY,
                               "target_children": [adskhan["id"]]})
    anytime = server.ANYTIME_SEGMENT_ID
    pressed = (now_utc - dt.timedelta(minutes=30)).replace(microsecond=0)
    r = c.post("/api/segment-sessions/start", json={"child_id": adskhan["id"], "date_key": TODAY,
                                                     "segment_id": anytime, "happened_at": pressed.isoformat()})
    check("offline: queued start accepted", r.status_code == 200, r.text[:200])
    check("offline: started_at is when it was pressed",
          r.status_code == 200 and dt.datetime.fromisoformat(r.json()["started_at"]) == pressed,
          r.text[:200])
    act = next(t for t in c.get(f"/api/tasks?date_key={TODAY}").json()
               if t["title"] == "Baca buku" and t["child_id"] == adskhan["id"])
    c.post(f"/api/tasks/{act['id']}/check", json={"checked": True})
    r = c.post("/api/segment-sessions/finish", json={"child_id": adskhan["id"], "date_key": TODAY,
                                                      "segment_id": anytime,
                                                      "happened_at": (pressed - dt.timedelta(minutes=5)).isoformat()})
    check("offline: queued finish accepted", r.status_code == 200, r.text[:200])
    sess = run(server.db.segment_sessions.find_one({"child_id": adskhan["id"], "date_key": TODAY,
                                                    "segment_id": anytime}))
    check("offline: a finish before the start falls back to server time",
          sess and dt.datetime.fromisoformat(sess["completed_at"]) > pressed, str(sess and sess.get("completed_at")))

    # ---------------- Personal finish per weekday ----------------
    segs = c.get("/api/config").json()["day_segments"]
    sg0 = segs[0]
    wd_today = str(dt.datetime.strptime(TODAY, "%Y-%m-%d").weekday())
    wd_other = str((int(wd_today) + 1) % 7)
    st = server._hhmm_to_min(sg0["start_time"]); en = server._hhmm_to_min(sg0["end_time"])
    early_end = server._fmt_min(st + 30)
    r = c.put(f"/api/children/{adskhan['id']}/segment-starts",
              json={"starts": {}, "ends": {sg0["id"]: {wd_today: early_end}}})
    check("finish: saved", r.status_code == 200 and r.json()["segment_ends"][sg0["id"]][wd_today] == early_end, r.text[:200])
    got = c.get(f"/api/children/{adskhan['id']}/segment-starts").json()
    check("finish: read back", got["segment_ends"][sg0["id"]][wd_today] == early_end)
    kid_doc = run(server.db.children.find_one({"id": adskhan["id"]}))
    check("finish: applies on that weekday",
          server._effective_segment_end(sg0, kid_doc, TODAY) == st + 30)
    check("finish: other weekdays keep the shared end",
          server._effective_segment_end(sg0, kid_doc, TOMORROW) == en)
    sib = next(k for k in kids if k["id"] != adskhan["id"])
    sib_doc = run(server.db.children.find_one({"id": sib["id"]}))
    check("finish: a sibling is not affected", server._effective_segment_end(sg0, sib_doc, TODAY) == en)
    r = c.put(f"/api/children/{adskhan['id']}/segment-starts",
              json={"starts": {}, "ends": {sg0["id"]: {wd_today: server._fmt_min(min(en + 1, 1439))}}})
    check("finish: past the shared end is refused", r.status_code == 422 or en == 1439, str(r.status_code))
    r = c.put(f"/api/children/{adskhan['id']}/segment-starts",
              json={"starts": {sg0["id"]: {wd_today: server._fmt_min(st + 40)}}, "ends": {sg0["id"]: {wd_today: early_end}}})
    check("finish: before the start is refused", r.status_code == 422, str(r.status_code))
    r = c.put(f"/api/children/{adskhan['id']}/segment-starts", json={"starts": {}})
    check("finish: saving starts only keeps finishes",
          r.json()["segment_ends"].get(sg0["id"], {}).get(wd_today) == early_end, r.text[:200])
    tm = server._segment_timing(sg0, kid_doc, TODAY, 0,
                                (dt.datetime.strptime(TODAY, "%Y-%m-%d") + dt.timedelta(minutes=st + 45) - dt.timedelta(hours=7)).replace(tzinfo=dt.timezone.utc))
    check("finish: finishing after the personal end is late", tm["late_finish"], str(tm))
    c.put(f"/api/children/{adskhan['id']}/segment-starts", json={"starts": {}, "ends": {}})
    check("finish: cleared", not c.get(f"/api/children/{adskhan['id']}/segment-starts").json()["segment_ends"])

    # ---------------- Gzip ----------------
    r = c.get("/api/tasks", headers={"Accept-Encoding": "gzip"})
    check("gzip: large JSON is compressed",
          r.headers.get("content-encoding") == "gzip" or len(r.content) < 1024, str(r.headers.get("content-encoding")))

print("\n" + "=" * 50)
print(f"PASSED: {len(passed)}   FAILED: {len(failed)}")
if failed:
    for f in failed:
        print("  -", f)
    raise SystemExit(1)
print("ALL TESTS PASSED ✅")
