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
    for coll in ("tasks", "day_templates", "template_tasks", "off_days", "day_builds", "segment_sessions"):
        run(getattr(server.db, coll).delete_many({}))
    server._invalidate_days_ready()
    server._invalidate_config_cache()


def add_routine(c, title, points, segment_id, weekdays=None, child_id=None):
    r = c.post("/api/routine/slots", json={"weekdays": weekdays if weekdays is not None else list(range(7)),
                                           "segment_id": segment_id, "title": title, "points": points,
                                           "child_id": child_id})
    assert r.status_code == 200, r.text
    return r.json()


# These tests start from a family that already runs on the weekly routine.
run(server.db.app_meta.update_one({"_id": "routine_migrated"}, {"$set": {"at": "test"}}, upsert=True))
run(server.db.app_meta.update_one({"_id": "legacy_cleanup_v1"}, {"$set": {"at": "test"}}, upsert=True))


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

    # ---------------- Regression: a family's very first settings save ----------------
    saved_cfg = run(server.db.app_config.find_one({"parent_id": "family-default"}, {"_id": 0}))
    run(server.db.app_config.delete_many({}))
    server._invalidate_config_cache()
    run(server.get_config_cached())                     # cache the "no settings yet" state
    c.post("/api/config", json={"day_segments": [{"label": "Uji", "start_time": "00:00", "end_time": "23:59"}]})
    uji = next(x["id"] for x in c.get("/api/config").json()["day_segments"] if x["label"] == "Uji")
    r = c.post("/api/routine/slots", json={"weekdays": [0], "segment_id": uji, "title": "Cek", "points": 1})
    check("config: a first-ever save is visible at once", r.status_code == 200, r.text[:150])
    run(server.db.app_config.delete_many({}))
    run(server.db.app_config.insert_one(saved_cfg))
    server._invalidate_config_cache()
    run(server.db.template_tasks.delete_many({}))

    # ---------------- Routine: only near days are built ----------------
    reset_schedule()
    add_routine(c, "Rapikan kasur", 10, first_seg)
    rows = c.get("/api/tasks").json()
    dates = sorted({t["date_key"] for t in rows})
    check("lazy: today is built from the routine", TODAY in dates, str(dates))
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
    add_routine(c, "Sikat gigi", 5, first_seg)
    run(server.db.tasks.delete_many({}))
    run(server.db.day_builds.delete_many({}))
    server._invalidate_days_ready()
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "123456"})
    r = c.get(f"/api/children/{adskhan['id']}/segments-day")
    titles = [a["title"] for s in r.json().get("segments", []) for a in s.get("activities", s.get("tasks", []))]
    check("kid: segments-day builds an empty today inline", r.status_code == 200 and "Sikat gigi" in str(r.json()),
          str(titles)[:200])
    r = c.get(f"/api/children/{adskhan['id']}/day-progress")
    check("kid: day-progress sees today's mission", r.status_code == 200 and "Sikat gigi" in str(r.json()))
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})

    # ---------------- Vacation mode pauses the routine ----------------
    reset_schedule()
    add_routine(c, "Libur", 5, first_seg)
    run(server.db.tasks.delete_many({}))
    run(server.db.day_builds.delete_many({}))
    c.post("/api/config", json={"vacation_mode": True})
    c.post(f"/api/days/{day(4)}/prepare")
    check("vacation: no new days are built", run(server.db.tasks.count_documents({"title": "Libur"})) == 0)
    c.post("/api/config", json={"vacation_mode": False})
    c.post(f"/api/days/{day(4)}/prepare")
    check("vacation: building resumes when it ends",
          run(server.db.tasks.count_documents({"title": "Libur", "date_key": day(4)})) == len(kids))

    # ---------------- One-time cleanup of the old schedule ----------------
    reset_schedule()
    run(server.db.app_meta.delete_many({"_id": {"$in": ["routine_migrated", "legacy_cleanup_v1"]}}))
    server._ROUTINE_MIGRATED["done"] = False
    run(server.db.legacy_archive.delete_many({}))
    old_tpl = {"id": "old-tpl", "parent_id": "family-default", "name": "Hari Biasa", "is_default": True}
    run(server.db.day_templates.insert_one(dict(old_tpl)))
    run(server.db.template_tasks.insert_one({"id": "old-slot", "parent_id": "family-default", "template_id": "old-tpl",
                                             "weekday": 0, "segment_id": first_seg, "title": "Slot lama", "points": 4}))
    run(server.db.template_assignments.insert_one({"parent_id": "family-default", "date_key": day(2),
                                                   "template_id": "old-tpl"}))
    run(server.db.routine_templates.insert_one({"id": "bundle", "parent_id": "family-default", "label": "Paket"}))
    run(server.db.tasks.insert_many([
        {"id": "leg-series", "parent_id": "family-default", "child_id": adskhan["id"], "title": "Siram tanaman",
         "points": 5, "date_key": day(-1), "recurrence": "daily", "status": "approved"},
        {"id": "leg-future", "parent_id": "family-default", "child_id": adskhan["id"], "title": "Siram tanaman",
         "points": 5, "date_key": day(3), "recurrence": "daily", "status": "pending"},
        {"id": "leg-open", "parent_id": "family-default", "child_id": adskhan["id"], "title": "Tugas jam",
         "points": 5, "date_key": TODAY, "status": "pending", "due_time": "07:00", "min_duration_minutes": 10,
         "snooze_count": 1, "timer_started_at": None},
    ]))
    run(server._write_config({"$set": {"min_gap_seconds": 60, "snooze_options_minutes": [5]}}))
    c.get("/api/tasks")
    meta = run(server.db.app_meta.find_one({"_id": "legacy_cleanup_v1"}))
    check("cleanup: runs once on the next read", meta is not None, str(meta))
    slots = c.get("/api/routine").json()["slots"]
    check("cleanup: old repeating mission became a routine activity",
          any(x["title"] == "Siram tanaman" for x in slots), str([x["title"] for x in slots]))
    check("cleanup: old template slot became a routine activity",
          any(x["title"] == "Slot lama" for x in slots), str([x["title"] for x in slots]))
    check("cleanup: old templates and assignments are gone",
          run(server.db.day_templates.count_documents({"id": "old-tpl"})) == 0
          and run(server.db.template_assignments.count_documents({})) == 0
          and run(server.db.routine_templates.count_documents({})) == 0)
    check("cleanup: everything removed is archived",
          run(server.db.legacy_archive.count_documents({"kind": "day_template"})) == 1
          and run(server.db.legacy_archive.count_documents({"kind": "template_assignment"})) == 1)
    check("cleanup: untouched future copies of old series are removed",
          run(server.db.tasks.count_documents({"id": "leg-future"})) == 0)
    check("cleanup: history is kept", run(server.db.tasks.count_documents({"id": "leg-series"})) == 1)
    leg = run(server.db.tasks.find_one({"id": "leg-open"}))
    check("cleanup: open missions lose their per-mission clock",
          leg and "due_time" not in leg and "min_duration_minutes" not in leg and "snooze_count" not in leg, str(leg))
    check("cleanup: nothing repeats the old way any more",
          run(server.db.tasks.count_documents({"recurrence": {"$in": ["daily", "weekly"]}})) == 0)
    cfg = c.get("/api/config").json()
    check("cleanup: old pacing settings are gone", "min_gap_seconds" not in cfg and "snooze_options_minutes" not in cfg,
          str([k for k in cfg if "snooze" in k or "gap" in k]))
    n_arch = run(server.db.legacy_archive.count_documents({}))
    server._ROUTINE_MIGRATED["done"] = False
    c.get("/api/tasks")
    check("cleanup: never runs twice", run(server.db.legacy_archive.count_documents({})) == n_arch)

    # ---------------- Old endpoints are gone ----------------
    for method, path in [("post", "/api/tasks/x/start"), ("post", "/api/tasks/x/complete"),
                         ("post", "/api/tasks/x/snooze"), ("post", "/api/tasks/x/skip"),
                         ("post", "/api/tasks/x/late-reason"), ("post", "/api/tasks/x/hold-request"),
                         ("get", "/api/hold-requests"), ("get", "/api/late-exceptions"),
                         ("get", "/api/day-templates"), ("get", "/api/template-tasks"),
                         ("post", "/api/tasks/materialize-recurring"), ("post", "/api/tasks/restart-schedule"),
                         ("post", "/api/maintenance/compact-schedule"), ("post", "/api/tasks/dedupe"),
                         ("get", "/api/routine-templates")]:
        code = getattr(c, method)(path).status_code
        check(f"removed: {method.upper()} {path}", code in (404, 405), str(code))

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
    slot = add_routine(c, "Latihan piano", 8, first_seg, weekdays=[0])["created"][0]
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
    c.post(f"/api/days/{day(3)}/prepare")
    d3 = [t["title"] for t in c.get(f"/api/tasks?date_key={day(3)}").json()]
    check("routine: day 3 comes from the routine", d3.count("Rutin pagi") == len(kids), str(d3))
    # editing the routine shows up on the parent's list straight away
    for slot in [x for x in c.get("/api/routine").json()["slots"] if x["title"] == "Rutin pagi"]:
        c.patch(f"/api/routine/slots/{slot['id']}", json={"points": 21})
    after = [t for t in c.get(f"/api/tasks?date_key={TOMORROW}").json() if t["title"] == "Rutin pagi"]
    check("routine: an edit is visible without waiting", after and all(t["points"] == 21 for t in after),
          str([t["points"] for t in after]))

    # ---------------- Copy one child's routine to a sibling ----------------
    reset_schedule()
    sib = next(k for k in kids if k["id"] != adskhan["id"])
    segs_all = [x["id"] for x in c.get("/api/config").json()["day_segments"]]
    add_routine(c, "Bangun pagi", 10, segs_all[0], weekdays=[0, 1], child_id=adskhan["id"])
    add_routine(c, "Sholat Subuh", 10, segs_all[0], weekdays=[0], child_id=adskhan["id"])
    add_routine(c, "Les piano", 15, segs_all[1], weekdays=[0], child_id=adskhan["id"])
    add_routine(c, "Sarapan", 5, segs_all[0], weekdays=[0])                      # every child: not copied
    add_routine(c, "Sholat Subuh", 10, segs_all[0], weekdays=[0], child_id=sib["id"])  # sibling already has it

    def mine(cid, wd=None):
        rows = [x for x in c.get("/api/routine").json()["slots"] if x["child_id"] == cid]
        return sorted((x["weekday"], x["title"]) for x in rows if wd is None or x["weekday"] == wd)

    r = c.post("/api/routine/copy-child", json={"from_child_id": adskhan["id"], "to_child_ids": [sib["id"]],
                                                "weekdays": [0], "segment_id": segs_all[0]})
    check("copy-child: one day + one section", r.status_code == 200 and r.json()["copied"] == 1
          and r.json()["skipped"] == 1, r.text[:200])
    check("copy-child: only that scope was copied", mine(sib["id"]) == [(0, "Bangun pagi"), (0, "Sholat Subuh")],
          str(mine(sib["id"])))
    r = c.post("/api/routine/copy-child", json={"from_child_id": adskhan["id"], "to_child_ids": [sib["id"]]})
    check("copy-child: whole week adds the rest, never doubles",
          r.status_code == 200 and mine(sib["id"]) == [(0, "Bangun pagi"), (0, "Les piano"), (0, "Sholat Subuh"),
                                                       (1, "Bangun pagi")], str(mine(sib["id"])))
    check("copy-child: shared activities stay shared",
          len([x for x in c.get("/api/routine").json()["slots"] if x["title"] == "Sarapan"]) == 1)
    one = next(x for x in c.get("/api/routine").json()["slots"]
               if x["child_id"] == adskhan["id"] and x["title"] == "Les piano")
    c.patch(f"/api/routine/slots/{one['id']}", json={"points": 30})
    run(server.db.template_tasks.delete_many({"child_id": sib["id"], "title": "Les piano"}))
    r = c.post("/api/routine/copy-child", json={"from_child_id": adskhan["id"], "to_child_ids": [sib["id"]],
                                                "slot_ids": [one["id"]]})
    piano = [x for x in c.get("/api/routine").json()["slots"] if x["child_id"] == sib["id"] and x["title"] == "Les piano"]
    check("copy-child: a single activity, with its points", r.status_code == 200 and len(piano) == 1
          and piano[0]["points"] == 30, str(piano))
    add_routine(c, "Punya adik sendiri", 3, segs_all[0], weekdays=[1], child_id=sib["id"])
    r = c.post("/api/routine/copy-child", json={"from_child_id": adskhan["id"], "to_child_ids": [sib["id"]],
                                                "weekdays": [1], "mode": "replace"})
    check("copy-child: replace swaps the sibling's own list for that day",
          r.status_code == 200 and mine(sib["id"], 1) == [(1, "Bangun pagi")] and r.json()["removed"] >= 1,
          str(mine(sib["id"], 1)))
    check("copy-child: the source is untouched",
          mine(adskhan["id"]) == [(0, "Bangun pagi"), (0, "Les piano"), (0, "Sholat Subuh"), (1, "Bangun pagi")])
    check("copy-child: copying to oneself → 422", c.post("/api/routine/copy-child", json={
        "from_child_id": adskhan["id"], "to_child_ids": [adskhan["id"]]}).status_code == 422)
    check("copy-child: nothing to copy → 404", c.post("/api/routine/copy-child", json={
        "from_child_id": adskhan["id"], "to_child_ids": [sib["id"]], "weekdays": [5]}).status_code == 404)
    check("copy-child: unknown child → 404", c.post("/api/routine/copy-child", json={
        "from_child_id": adskhan["id"], "to_child_ids": ["nope"]}).status_code == 404)
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "123456"})
    check("copy-child: kids cannot copy", c.post("/api/routine/copy-child", json={
        "from_child_id": adskhan["id"], "to_child_ids": [sib["id"]]}).status_code == 403)
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})

    # ---------------- Written summary missions ----------------
    reset_schedule()
    sm = add_routine(c, "Belajar IPA", 15, first_seg, weekdays=list(range(7)), child_id=adskhan["id"])
    slot_ids = [x["id"] for x in sm["created"]]
    r = c.patch(f"/api/routine/slots/{slot_ids[0]}", json={"summary_required": True, "summary_min_words": 5,
                                                          "summary_prompt": "Apa yang kamu pelajari?"})
    check("summary: routine activity can require one", r.status_code == 200 and r.json()["summary_required"] is True
          and r.json()["summary_min_words"] == 5, r.text[:200])
    for sid in slot_ids[1:]:
        c.patch(f"/api/routine/slots/{sid}", json={"summary_required": True, "summary_min_words": 5,
                                                  "summary_prompt": "Apa yang kamu pelajari?"})
    c.post("/api/routine/apply-today")
    t_sum = next(t for t in c.get(f"/api/tasks?date_key={TODAY}").json() if t["title"] == "Belajar IPA")
    check("summary: the day's mission carries it", t_sum.get("summary_required") is True
          and t_sum.get("summary_prompt") == "Apa yang kamu pelajari?", str({k: t_sum.get(k) for k in t_sum if "summary" in k}))
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "123456"})
    sd = c.get(f"/api/children/{adskhan['id']}/segments-day").json()
    sseg = next(x for x in sd["segments"] if any(a["id"] == t_sum["id"] for a in x["activities"]))
    sact = next(a for a in sseg["activities"] if a["id"] == t_sum["id"])
    check("summary: the checklist knows it needs writing",
          sact["summary_required"] is True and sact["summary_min_words"] == 5 and sact["summary_text"] is None)
    sb = {"child_id": adskhan["id"], "date_key": TODAY, "segment_id": sseg["id"]}
    reason = (sd.get("late_reasons") or [{}])[0].get("id")
    r = c.post("/api/tasks/" + t_sum["id"] + "/summary", json={"text": "Aku belajar tentang tumbuhan hijau"})
    check("summary: not before the section starts", r.status_code == 409, str(r.status_code))
    rs = c.post("/api/segment-sessions/start", json=sb)
    if rs.status_code == 409:
        c.post("/api/segment-sessions/start", json={**sb, "late_reason_id": reason})
    r = c.post(f"/api/tasks/{t_sum['id']}/check", json={"checked": True})
    check("summary: a plain tick is refused", r.status_code == 422 and "SUMMARY_REQUIRED" in r.text, r.text[:120])
    c.post("/api/segment-sessions/check-all", json={**sb, "checked": True})
    check("summary: 'centang semua' skips it",
          run(server.db.tasks.find_one({"id": t_sum["id"]})).get("checked") is not True)
    r = c.post("/api/segment-sessions/finish", json={**sb, "late_reason_id": reason})
    check("summary: the section can't finish without it", r.status_code == 422 and "ringkasan" in r.text.lower(),
          r.text[:150])
    r = c.post(f"/api/tasks/{t_sum['id']}/summary", json={"text": "belajar ipa"})
    check("summary: too short is refused with the count", r.status_code == 422 and "2 dari 5" in r.text, r.text[:150])
    r = c.post(f"/api/tasks/{t_sum['id']}/summary", json={"text": "aaa aaa aaa aaa aaa aaa aaa aaa aaa aaa"})
    check("summary: repeating one word is refused", r.status_code == 422, r.text[:150])
    r = c.post(f"/api/tasks/{t_sum['id']}/summary", json={
        "text": "Aku belajar fotosintesis. Daun memakai cahaya matahari untuk membuat makanan.",
        "pasted": True, "typing_seconds": 40})
    check("summary: a real summary ticks the mission", r.status_code == 200 and r.json()["checked"] is True
          and r.json()["summary_words"] >= 5, r.text[:200])
    check("summary: paste hint kept for the parent", r.json().get("summary_pasted") is True)
    other = next(k for k in kids if k["id"] != adskhan["id"])
    c.post("/api/auth/login", json={"member_id": other["id"], "passcode": "123456"})
    check("summary: a sibling can't write it", c.post(f"/api/tasks/{t_sum['id']}/summary",
          json={"text": "ini bukan punyaku sama sekali ya"}).status_code == 403)
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post(f"/api/tasks/{t_sum['id']}/summary-review", json={"verdict": "redo", "note": "Ceritakan contohnya"})
    check("summary: parent can ask for a rewrite", r.status_code == 200 and r.json()["reopened"] is True, r.text[:150])
    t_after = run(server.db.tasks.find_one({"id": t_sum["id"]}))
    check("summary: rewrite unticks it and keeps the old one",
          t_after["checked"] is False and t_after["summary_text"] is None and t_after["summary_previous"])
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "123456"})
    sd2 = c.get(f"/api/children/{adskhan['id']}/segments-day").json()
    a2 = next(a for x in sd2["segments"] for a in x["activities"] if a["id"] == t_sum["id"])
    check("summary: the child sees the parent's note", a2["summary_note"] == "Ceritakan contohnya"
          and a2["summary_review"] == "redo")
    c.post(f"/api/tasks/{t_sum['id']}/summary", json={
        "text": "Fotosintesis contohnya daun mangga di halaman yang hijau karena klorofil."})
    r = c.post("/api/segment-sessions/finish", json={**sb, "late_reason_id": reason})
    check("summary: with it written the section finishes", r.status_code == 200, r.text[:150])
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})
    r = c.post(f"/api/tasks/{t_sum['id']}/summary-review", json={"verdict": "good"})
    check("summary: 👍 after the section closed just records it",
          r.status_code == 200 and r.json()["reopened"] is False
          and run(server.db.tasks.find_one({"id": t_sum["id"]}))["summary_review"] == "good")
    one_off = c.post("/api/tasks", json={"title": "Baca buku", "points": 5, "date_key": TODAY,
                                         "target_children": [adskhan["id"]], "summary_required": True,
                                         "summary_min_words": 4}).json()
    check("summary: one-off missions can ask for one too", one_off.get("summary_required") is True
          and one_off.get("summary_min_words") == 4)
    c.post("/api/auth/login", json={"member_id": adskhan["id"], "passcode": "123456"})
    check("summary: kids cannot review", c.post(f"/api/tasks/{t_sum['id']}/summary-review",
          json={"verdict": "good"}).status_code == 403)
    c.post("/api/auth/login", json={"member_id": abi["id"], "passcode": "123456"})

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
