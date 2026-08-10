import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { motion } from "framer-motion";
import { Calendar, Target, Play, Square, CheckCircle2, FastForward, Lock, Trophy, Star, Timer } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import TimelineQuestView from "@/components/TimelineQuestView";
import { QUEST_THEMES } from "@/lib/questThemes";
import { styleMeta } from "@/lib/personality";
import { todayKey, humanDateKey, localTimeHHMM, isFutureDate } from "@/lib/dates";
import { playSoundTheme, playTimeWarning } from "@/lib/sounds";
import KidMonthCalendar from "@/components/KidMonthCalendar";
import MysteryBox from "@/components/MysteryBox";
import { timeOfDayOverlay, isNightTime } from "@/lib/timeOfDay";

export default function DailyQuestView({ child, themeKey, onCelebrate }) {
  const [dateKey, setDateKey] = useState(todayKey());
  const [showCalendar, setShowCalendar] = useState(false);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [nowHHMM, setNowHHMM] = useState(localTimeHHMM());
  const [nowMs, setNowMs] = useState(Date.now()); // ticks every second — precise duration-overrun detection
  // Late-arrival exception (pengajuan keterlambatan)
  const [lateTaskModal, setLateTaskModal] = useState(null); // task awaiting a reason pick
  const [lateReasons, setLateReasons] = useState([]);
  const [punishmentBusy, setPunishmentBusy] = useState(false);
  const [daySegments, setDaySegments] = useState([]);
  const [flashPct, setFlashPct] = useState(15);
  const [snoozeOptions, setSnoozeOptions] = useState([5, 10, 15, 20]);
  const [warnMinutes, setWarnMinutes] = useState([3, 2, 1]);
  // Remembers which warnings already fired, per task, so a 1-second ticker
  // can't re-announce the same threshold every tick.
  const firedWarnings = useRef({});
  // Hand-off popup: offers the next mission in the same section with a
  // countdown, then starts it. The countdown only runs while the child is
  // actually here — one ticking away with the app closed would silently eat
  // into their working time.
  const [handoff, setHandoff] = useState(null); // { task, secondsLeft }
  useEffect(() => {
    const t = setInterval(() => setNowHHMM(localTimeHHMM()), 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    if (!child?.id) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/children/${child.id}/day-progress`, { params: { date_key: dateKey } });
      setProgress(data);
      api.get("/config")
        .then(({ data: cfg }) => { setLateReasons(cfg.late_reasons || []); setDaySegments(cfg.day_segments || []); setFlashPct(cfg.flash_threshold_pct ?? 15); setSnoozeOptions(cfg.snooze_options_minutes || [5, 10, 15, 20]); setWarnMinutes(cfg.duration_warning_minutes ?? [3, 2, 1]); })
        .catch(() => { setLateReasons([]); setDaySegments([]); });
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setLoading(false);
    }
  }, [child?.id, dateKey]);

  useEffect(() => { load(); }, [load]);


  const theme = QUEST_THEMES[themeKey] || QUEST_THEMES.ocean;

  const { timeline, next, done } = useMemo(() => {
    const tasks = progress?.tasks || [];
    // The quest line is CHRONOLOGICAL, matching the timeline the kid actually
    // looks at. Sorting by creation `order` here (as this used to) made the
    // active task land in the middle of the day while earlier ones showed
    // "menunggu giliran" — the backend gate uses the same clock order.
    // Sequence anchor = the task's SECTION start time (sections carry the
    // clock), falling back to a legacy per-task due_time. Must mirror the
    // backend's ordering exactly, or the gate and the display disagree.
    const toMin = (t) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    };
    const seqVal = (t) => {
      const segList = progress?.segments || daySegments;
      const seg = t.segment_id ? segList.find((x) => x.id === t.segment_id) : null;
      if (seg) return toMin(seg.start_time);
      if (t.due_time) return toMin(t.due_time);
      return 100000; // no section, no time → do whenever, queue last
    };
    const req = tasks
      .filter((t) => !t.is_bonus)
      .sort((a, b) => seqVal(a) - seqVal(b) || (a.order || 0) - (b.order || 0));
    const bon = tasks.filter((t) => t.is_bonus);
    const openReq = req.filter((t) => t.status === "pending" || t.status === "rejected");
    const first = openReq[0] || null;
    const doneReq = req.filter((t) => t.status === "approved" || t.status === "skipped" || t.status === "completed");

    // Interleave bonus missions INTO the required sequence by time-of-day, so a
    // Sunday-morning bonus sits between the morning required missions rather
    // than in a separate box at the bottom. Sort key: due_time first (missions
    // with a time slot into their slot; timeless ones sink below by a large
    // sentinel), then explicit order. Bonuses never affect the required
    // sequence gate — they're just placed visually.
    const timeVal = (t) => {
      if (t.due_time) {
        const [h, m] = t.due_time.split(":").map(Number);
        return h * 60 + m;
      }
      return 100000 + (t.order || 0); // timeless → after timed ones, stable by order
    };
    const merged = [...req, ...bon].sort((a, b) => {
      const ta = timeVal(a), tb = timeVal(b);
      if (ta !== tb) return ta - tb;
      // tie-break: required before bonus at the same slot, then order
      if (!!a.is_bonus !== !!b.is_bonus) return a.is_bonus ? 1 : -1;
      return (a.order || 0) - (b.order || 0);
    });

    return { timeline: merged, next: first, done: doneReq };
  }, [progress, daySegments]);

  const isToday = dateKey === todayKey();
  const isFuture = isFutureDate(dateKey);

  const timeGate = (task) => {
    if (!isToday) return { allowed: false, reason: isFuture ? "future" : "past" };
    // Flexible flow: a task can be started ANY time on its own day (kids may
    // work ahead of schedule). We no longer block by the due_time window.
    // Overshooting the due_time without starting turns a required task
    // time-stuck (handled by isTimeStuck → Terlambat flow), but that's a finish/
    // rescue concern, not a start gate.
    return { allowed: true, reason: null };
  };

  // Once a task's own timer is running, if it has a set duration and that
  // duration has elapsed, Finish gets disabled — the countdown hitting zero
  // is a real deadline, not just a visual. Skip stays available either way so
  // the kid is never stuck with no way forward. Backend enforces this too.
  const isDurationExceeded = (task) => {
    if (!task.timer_started_at || !task.duration_minutes) return false;
    const startMs = new Date(task.timer_started_at).getTime();
    const elapsedMin = (nowMs - startMs) / 60000;
    return elapsedMin > task.duration_minutes;
  };

  // Mirrors the backend's _task_is_time_stuck check — only offer the
  // "Terlambat" flow when a required task is genuinely blocked by time
  // (duration ran out, or the due_time window closed before it was ever
  // started), not just because a kid hasn't gotten around to it yet.
  const isTimeStuck = (task) => {
    if (isDurationExceeded(task)) return true;
    if (task.due_time && !task.timer_started_at) {
      const [dh, dm] = task.due_time.split(":").map(Number);
      const [nh, nm] = nowHHMM.split(":").map(Number);
      return nh * 60 + nm > dh * 60 + dm;
    }
    return false;
  };

  const choosePunishment = async (optionId) => {
    const p = progress?.active_punishment;
    if (!p) return;
    setPunishmentBusy(true);
    try {
      await api.post(`/punishments/${p.id}/choose`, { option_id: optionId });
      toast.success("Hukuman dipilih. Selesaikan sebelum batas waktunya ya!");
      await load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally { setPunishmentBusy(false); }
  };

  // "Terlambat" flow: the kid owns up to a missed task by picking one of the
  // parent-configured reasons. Excused reasons keep the points; at-fault ones
  // cost a Kartu Hukuman and forfeit the points (but the task stays doable).
  const submitLateReason = async (reasonId) => {
    const task = lateTaskModal;
    if (!task) return;
    setBusyId(task.id);
    try {
      const { data } = await api.post(`/tasks/${task.id}/late-reason`, { reason_id: reasonId });
      if (data.gives_penalty_card) {
        toast(
          data.threshold_hit
            ? `Kamu dapat Kartu Hukuman (total ${data.penalty_cards}). Sudah mencapai batas — ngobrol sama Abi/Ummi ya.`
            : `Kamu dapat 1 Kartu Hukuman (total ${data.penalty_cards}). Misi tetap bisa dikerjakan, tapi tanpa poin.`,
          { icon: "⚠️" }
        );
      } else {
        toast.success("Oke, alasanmu dicatat. Misi bisa dilanjutkan dan poinnya tetap utuh!");
      }
      setLateTaskModal(null);
      await load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally { setBusyId(null); }
  };

  const startTimer = async (task) => {
    setBusyId(task.id);
    try {
      await api.post(`/tasks/${task.id}/start`);
      await load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally { setBusyId(null); }
  };

  const photoInputRef = useRef(null);
  const [pendingPhotoTask, setPendingPhotoTask] = useState(null);
  const [pendingTogetherTask, setPendingTogetherTask] = useState(null);

  // Friction, not a wall: finishing far below the estimate asks for a quick
  // confirmation. A genuinely fast child just taps OK; a reflexive tapper is
  // made to pause. The finish itself is never blocked.
  // Tick the hand-off countdown. Using an interval (rather than a deadline
  // computed once) means a backgrounded tab simply stops counting instead of
  // "catching up" — which is exactly the fairness property we want.
  useEffect(() => {
    if (!handoff || handoff.secondsLeft <= 0) return undefined;
    const id = setInterval(() => {
      setHandoff((h) => (h && h.secondsLeft > 0 ? { ...h, secondsLeft: h.secondsLeft - 1 } : h));
    }, 1000);
    return () => clearInterval(id);
  }, [handoff]);

  const handoffFiring = useRef(false);

  // Countdown warnings for whichever mission is currently running. Fires once
  // per threshold per task — crossing 3, 2 and 1 minute gives the child a real
  // chance to wrap up instead of discovering the overrun after the fact.
  useEffect(() => {
    if (!warnMinutes || warnMinutes.length === 0) return;
    const running = (progress?.tasks || []).filter(
      (t) => t.timer_started_at && t.duration_minutes && (t.status === "pending" || t.status === "rejected")
    );
    for (const t of running) {
      const startMs = new Date(t.timer_started_at).getTime();
      const remaining = t.duration_minutes - (nowMs - startMs) / 60000;
      if (remaining <= 0) continue;
      const already = firedWarnings.current[t.id] || [];
      for (const mark of warnMinutes) {
        if (remaining <= mark && !already.includes(mark)) {
          firedWarnings.current[t.id] = [...already, mark];
          playTimeWarning(mark);
          toast(
            mark <= 1
              ? `⏰ Tinggal ${mark} menit untuk "${t.title}" — ayo diselesaikan!`
              : `⏳ Sisa ${mark} menit untuk "${t.title}"`,
            { duration: 5000 }
          );
          break; // one announcement per tick, even if several marks lapsed at once
        }
      }
    }
  }, [nowMs, progress, warnMinutes]);

  const snoozeHandoff = async (minutes) => {
    const h = handoff;
    if (!h) return;
    try {
      await api.post(`/tasks/${h.task.id}/snooze`, { minutes });
      toast.success(`Oke, ditunda ${minutes} menit. Kalau sudah siap, tinggal tekan Mulai ya 🙂`);
      setHandoff(null);
      await load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const startHandoff = async () => {
    const h = handoff;
    if (!h || handoffFiring.current) return;
    handoffFiring.current = true;
    setBusyId(h.task.id);
    try {
      await api.post(`/tasks/${h.task.id}/start`);
      toast.success(`"${h.task.title}" dimulai. Semangat! 💪`);
      setHandoff(null);
      await load();
    } catch (e) {
      toast.error(formatApiError(e));
      setHandoff(null);
      await load();
    } finally { setBusyId(null); }
  };

  const confirmIfFlash = (task) => {
    const started = task.timer_started_at ? new Date(task.timer_started_at).getTime() : null;
    if (!started) return true;
    const secs = (Date.now() - started) / 1000;
    const estSecs = (task.duration_minutes || 0) * 60;
    const floor = estSecs ? Math.max(20, estSecs * ((flashPct ?? 15) / 100)) : 20;
    if (secs >= floor) return true;
    const shown = secs < 60 ? `${Math.round(secs)} detik` : `${Math.round(secs / 60)} menit`;
    return window.confirm(
      `Yakin "${task.title}" sudah selesai?\n\nBaru ${shown} sejak kamu menekan Mulai` +
      (task.duration_minutes ? ` (perkiraannya ${task.duration_minutes} menit).` : ".") +
      `\n\nKalau memang sudah beres, lanjut saja 🙂`
    );
  };

  const finishTask = async (task, photoUrl, doneTogether) => {
    if (!confirmIfFlash(task)) return;
    if (task.photo_required && !photoUrl) {
      // Need a photo first — open the camera/file picker, then re-invoke this
      // same function with the captured image once it's read.
      setPendingPhotoTask(task);
      photoInputRef.current?.click();
      return;
    }
    if (task.together_bonus_enabled && doneTogether === undefined) {
      // Ask "was this done together?" before completing — re-invoked with the
      // answer once the kid picks Ya/Tidak.
      setPendingTogetherTask(task);
      return;
    }
    setBusyId(task.id);
    try {
      const body = {};
      if (photoUrl) body.photo_url = photoUrl;
      if (task.together_bonus_enabled) body.done_together = !!doneTogether;
      const { data: finishData } = await api.post(`/tasks/${task.id}/complete`, body);
      playSoundTheme(child?.sound_theme || "ding");
      onCelebrate?.();
      toast.success(
        task.together_bonus_enabled && doneTogether
          ? `Misi selesai! +${task.together_bonus_points} poin bonus menunggu disetujui 🎉`
          : "Misi selesai! Menunggu dicek Abi/Ummi ⭐"
      );
      await load();
      if (finishData?.auto_next) {
        setHandoff({ task: finishData.auto_next, secondsLeft: finishData.auto_next.wait_seconds ?? 0 });
      }
    } catch (e) {
      toast.error(formatApiError(e));
    } finally { setBusyId(null); }
  };

  const handlePhotoSelected = (e) => {
    const file = e.target.files?.[0];
    const task = pendingPhotoTask;
    setPendingPhotoTask(null);
    e.target.value = ""; // allow picking the same file again later
    if (!file || !task) return;
    if (!file.type.startsWith("image/")) return toast.error("Pilih file gambar ya");
    if (file.size > 3 * 1024 * 1024) return toast.error("Ukuran foto maksimal 3MB");
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result;
      if (dataUrl) finishTask(task, dataUrl);
    };
    reader.onerror = () => toast.error("Gagal membaca foto, coba lagi");
    reader.readAsDataURL(file);
  };

  const skipTask = async (task) => {
    if (!window.confirm(`Lewati misi "${task.title}" dengan bayar poin?`)) return;
    setBusyId(task.id);
    try {
      const { data } = await api.post(`/tasks/${task.id}/skip`);
      toast.success(`Dilewati! -${data.points_spent} poin`);
      await load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally { setBusyId(null); }
  };

  return (
    <div className="space-y-4">
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handlePhotoSelected}
        className="hidden"
      />

      {pendingTogetherTask && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPendingTogetherTask(null)}>
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-3xl p-6 max-w-xs w-full text-center chunky-shadow-lg"
          >
            <div className="text-4xl mb-2">🤝</div>
            <div className="font-fun font-bold text-lg text-slate-900 mb-1">Dilakukan Bersama?</div>
            <div className="text-sm text-slate-500 mb-5">
              Apakah "{pendingTogetherTask.title}" tadi dilakukan bareng saudara? Kalau iya, dapat bonus +{pendingTogetherTask.together_bonus_points} poin!
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { const t = pendingTogetherTask; setPendingTogetherTask(null); finishTask(t, undefined, false); }}
                className="press-btn flex-1 py-2.5 rounded-xl font-fun font-bold bg-slate-100 hover:bg-slate-200 text-slate-600"
              >
                Tidak
              </button>
              <button
                onClick={() => { const t = pendingTogetherTask; setPendingTogetherTask(null); finishTask(t, undefined, true); }}
                className="press-btn flex-1 py-2.5 rounded-xl font-fun font-bold bg-pink-500 hover:bg-pink-600 text-white"
              >
                Iya! 🎉
              </button>
            </div>
          </motion.div>
        </div>
      )}
      {/* Compact date bar: shows the selected day and a calendar toggle. The
          full month grid stays hidden by default (it dominated the screen) and
          only expands when the kid taps "Kalender" — keeps the mission list
          front-and-center. */}
      <div className="flex items-center justify-between gap-2 bg-white rounded-2xl px-4 py-2.5 border-2 border-slate-100 chunky-shadow">
        <div className="min-w-0">
          <div className="font-fun font-bold text-slate-900 text-sm truncate">{humanDateKey(dateKey)}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!isToday && (
            <button onClick={() => setDateKey(todayKey())} className="press-btn bg-[#FF9D23] hover:bg-[#f08e14] text-white font-fun font-bold px-3 py-1.5 rounded-xl text-xs">
              Hari Ini
            </button>
          )}
          <button
            onClick={() => setShowCalendar((v) => !v)}
            className={`press-btn font-fun font-bold px-3 py-1.5 rounded-xl text-xs inline-flex items-center gap-1 border-2 transition-colors ${
              showCalendar ? "bg-indigo-500 border-indigo-500 text-white" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
            data-testid="kid-calendar-toggle"
            title="Buka/tutup kalender"
          >
            <Calendar className="w-3.5 h-3.5" strokeWidth={2.5} /> Kalender
          </button>
        </div>
      </div>

      {/* Month calendar — hidden until toggled. Tap any day to jump to its missions. */}
      {showCalendar && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
          <KidMonthCalendar childId={child?.id} selectedDateKey={dateKey} onSelectDate={(d) => { setDateKey(d); setShowCalendar(false); }} />
        </motion.div>
      )}

      {/* ▶️ Hand-off to the next mission in the same section */}
      {handoff && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-3xl p-5 max-w-sm w-full chunky-shadow-lg text-center"
          >
            <div className="text-4xl mb-1">🎉</div>
            <h3 className="font-fun font-bold text-lg text-slate-900">Keren, satu misi beres!</h3>
            <p className="text-xs text-slate-500 mb-3">Lanjut ke misi berikutnya yuk — kamu lagi jalan bagus.</p>

            <div className="bg-indigo-50 border-2 border-indigo-100 rounded-2xl p-3 mb-3 text-left">
              <div className="text-[10px] font-bold text-indigo-500 uppercase tracking-wide">
                {handoff.task.segment_label || "Berikutnya"}
              </div>
              <div className="font-fun font-bold text-slate-800 text-sm">{handoff.task.title}</div>
              <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
                {handoff.task.duration_minutes ? <span>⏱ {handoff.task.duration_minutes} menit</span> : null}
                <span className="font-bold text-indigo-600">+{handoff.task.points} poin</span>
              </div>
            </div>

            {handoff.secondsLeft > 0 ? (
              <>
                <div className="text-xs text-slate-500 mb-1">
                  Ambil napas dulu — mulai otomatis dalam <b>{handoff.secondsLeft} detik</b>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden mb-3">
                  <div
                    className="h-full bg-indigo-500 transition-all duration-1000"
                    style={{
                      width: `${100 - (handoff.secondsLeft / Math.max(1, handoff.task.wait_seconds || 1)) * 100}%`,
                    }}
                  />
                </div>
              </>
            ) : (
              <button
                onClick={startHandoff}
                disabled={busyId === handoff.task.id}
                className="press-btn w-full py-2.5 rounded-xl font-fun font-bold bg-indigo-600 hover:bg-indigo-700 text-white mb-2 disabled:opacity-60"
              >
                Mulai Sekarang ▶️
              </button>
            )}

            <div className="border-t border-slate-100 pt-3 mt-1">
              {(handoff.task.snooze_options || snoozeOptions).length === 0 ? (
                <p className="text-[11px] text-slate-500">
                  Misi ini sebaiknya tidak ditunda. Kalau memang ada halangan, nanti bisa dijelaskan lewat tombol Terlambat.
                </p>
              ) : (
              <>
              <div className="text-[11px] text-slate-500 mb-1.5">Belum sempat? Tunda dulu:</div>
              <div className="flex flex-wrap gap-1.5 justify-center">
                {(handoff.task.snooze_options || snoozeOptions).map((m) => (
                  <button
                    key={m}
                    onClick={() => snoozeHandoff(m)}
                    className="press-btn px-3 py-1.5 rounded-xl font-fun font-bold border-2 border-slate-200 text-slate-600 text-xs hover:bg-slate-50"
                  >
                    {m} menit
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-400 mt-2">
                Boleh mulai lebih cepat kapan saja. Kalau lewat dari waktu tunda, kamu tinggal jelaskan alasannya lewat tombol Terlambat.
              </p>
              </>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* ⚖️ Active punishment — the child either picks one or sees the one
          assigned to them, always with the deadline and what happens if it's
          missed. Shown before everything else because it's time-critical. */}
      {progress?.active_punishment && (
        <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">⚖️</span>
            <span className="font-fun font-bold text-red-800 text-sm">
              {progress.active_punishment.status === "pending_choice" ? "Pilih Hukumanmu" : "Hukumanmu"}
            </span>
          </div>
          <p className="text-xs text-red-700 mb-2">
            Kartu Hukumanmu sudah penuh ({progress.active_punishment.cards_at_issue} kartu). Harus dijalani paling
            lambat <b>{progress.active_punishment.deadline_date}</b>
            {progress.active_punishment.overdue_action === "pet_dies"
              ? " — kalau lewat, peliharaanmu tidak selamat."
              : progress.active_punishment.overdue_action === "reset_points"
              ? " — kalau lewat, poinmu direset ke 0."
              : "."}
          </p>

          {progress.active_punishment.status === "pending_choice" ? (
            <div className="space-y-2">
              {(progress.active_punishment.options_snapshot || []).map((o) => (
                <button
                  key={o.id}
                  onClick={() => choosePunishment(o.id)}
                  disabled={punishmentBusy}
                  className="press-btn w-full text-left px-3 py-2 rounded-2xl border-2 border-red-200 bg-white hover:bg-red-100 disabled:opacity-60"
                >
                  <div className="font-fun font-bold text-sm text-slate-800">{o.label}</div>
                  {o.description && <div className="text-[11px] text-slate-500">{o.description}</div>}
                </button>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border-2 border-red-200 px-3 py-2">
              <div className="font-fun font-bold text-sm text-slate-800">{progress.active_punishment.option_label}</div>
              {progress.active_punishment.option_description && (
                <div className="text-[11px] text-slate-500">{progress.active_punishment.option_description}</div>
              )}
              <div className="text-[11px] text-red-600 mt-1">Kalau sudah dijalani, minta Abi/Ummi menandainya selesai.</div>
            </div>
          )}
        </div>
      )}

      {/* 🤝 Family combo — everyone finished their required missions today */}
      {progress?.family_combo && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-gradient-to-r from-violet-100 to-fuchsia-100 border-2 border-violet-200 rounded-2xl px-4 py-3 flex items-center gap-3"
        >
          <motion.span
            animate={{ rotate: [0, 12, -12, 0], scale: [1, 1.15, 1] }}
            transition={{ duration: 2.2, repeat: Infinity }}
            className="text-2xl"
          >
            🤝
          </motion.span>
          <div className="min-w-0">
            <div className="font-fun font-bold text-violet-900 text-sm">Kompak Sekeluarga! 🎉</div>
            <div className="text-xs text-violet-700">
              Semua misi wajib selesai bareng — kalian masing-masing dapat +{progress.family_combo.points_per_child} poin bonus!
            </div>
          </div>
        </motion.div>
      )}

      {progress?.vacation_mode && (
        <div className="bg-sky-50 border-2 border-sky-200 rounded-2xl px-4 py-3 flex items-center gap-2 text-sky-700">
          <span className="text-xl">🏖️</span>
          <span className="text-sm font-semibold">Keluarga sedang liburan — misi rutin tidak menumpuk, santai dulu ya!</span>
        </div>
      )}

      {loading ? (
        <div className="text-center text-slate-400 py-8">Memuat…</div>
      ) : progress?.is_off_day ? (
        <div className="rounded-3xl p-8 text-center chunky-shadow-lg bg-gradient-to-br from-sky-100 to-cyan-50 border-2 border-sky-200">
          <motion.div
            animate={{ y: [0, -8, 0], rotate: [0, 6, -6, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            className="text-6xl mb-3"
          >
            🏖️
          </motion.div>
          <div className="font-fun font-bold text-2xl text-sky-800">Hari Libur!</div>
          <div className="text-sky-600 text-sm mt-1">
            Tidak ada misi hari ini — nikmati waktunya bersama keluarga! Streak-mu aman kok 😉
          </div>
        </div>
      ) : timeline.length === 0 ? (
        <div className="rounded-3xl p-8 text-center chunky-shadow-lg" style={{ background: theme.colors.bg, color: theme.colors.text }}>
          <div className="text-5xl mb-3">{theme.goalIcon}</div>
          <div className="font-fun font-bold text-xl">{isToday ? "Belum ada misi hari ini" : "Tidak ada misi di hari ini"}</div>
          <div className="opacity-80 text-sm">{theme.tagline}</div>
        </div>
      ) : (
        <>
          <div className="rounded-3xl overflow-hidden chunky-shadow-lg relative" style={{ background: theme.colors.bg, color: theme.colors.text }}>
            {/* Time-of-day tint — same theme, but the light shifts with real time */}
            <div className="absolute inset-0 pointer-events-none transition-all duration-1000" style={{ background: timeOfDayOverlay() }} />
            {isNightTime() && (
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                {[...Array(12)].map((_, i) => (
                  <motion.div
                    key={`star-${i}`}
                    className="absolute w-1 h-1 rounded-full bg-white"
                    style={{ top: `${(i * 17 + 5) % 60}%`, left: `${(i * 29 + 10) % 92}%` }}
                    animate={{ opacity: [0.2, 0.9, 0.2] }}
                    transition={{ duration: 2 + (i % 3), repeat: Infinity, delay: i * 0.2 }}
                  />
                ))}
              </div>
            )}

            {/* Floating decorations */}
            {theme.decorEmojis.map((e, i) => (
              <motion.div key={i} className="absolute select-none pointer-events-none opacity-20"
                style={{ top: `${(i * 23 + 5) % 85}%`, left: `${(i * 31 + 8) % 85}%`, fontSize: 16 + (i % 3) * 6 }}
                animate={{ y: [0, -10, 0], rotate: [0, 10, -10, 0] }}
                transition={{ duration: 3 + i * 0.7, repeat: Infinity, ease: "easeInOut", delay: i * 0.3 }}
              >{e}</motion.div>
            ))}

            {/* Header */}
            <div className="relative z-10 p-4 pb-2 flex items-center justify-between">
              <div>
                <div className="font-fun font-bold text-lg flex items-center gap-2">
                  <span className="text-2xl">{theme.emoji}</span> {theme.label}
                </div>
                <div className="text-xs opacity-80" style={{ color: theme.colors.textDim }}>{theme.tagline}</div>
              </div>
              <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 3, repeat: Infinity }} className="text-4xl">{theme.goalIcon}</motion.div>
            </div>

            {/* Horizontal timeline — sections come from parent config; required
                and bonus tasks share one chronological spine. */}
            <div className="relative z-10 px-3 pb-4 bg-slate-50/95 rounded-t-3xl pt-4 mt-2">
              <TimelineQuestView
                tasks={timeline}
                segments={progress?.segments || daySegments}
                activeId={next?.id}
                helpers={{
                  forTask: (t) => {
                    const isDone = t.status === "approved" || t.status === "skipped" || t.status === "completed";
                    const gate = timeGate(t);
                    const overdue = isDurationExceeded(t);
                    // Bonus tasks bypass the required sequence entirely; required
                    // ones are only actionable when they're the frontmost open task.
                    // The server decides what's allowed and says so per task.
                    // Re-deriving these rules here is what let a "Mulai" button
                    // appear on a mission the server would refuse — the window
                    // logic (personal start, grace, snooze, section end) is
                    // intricate enough that two implementations WILL drift.
                    const notYet = t.availability === "future";
                    const overdueBySection = t.availability === "closed";
                    const isActive = t.is_bonus ? !isDone : next?.id === t.id;
                    const timeStuck = !isDone && (overdueBySection || (isActive && isTimeStuck(t)));
                    return {
                      busy: busyId === t.id,
                      // An overdue task offers ONLY the Terlambat button — the
                      // child owns the lateness first, which reschedules the
                      // slot; Mulai reappears after that. Mirrors the backend
                      // guard, so the UI can't offer an action that would fail.
                      canStart: isActive && !t.timer_started_at && gate.allowed && !timeStuck && !notYet,
                      notYet,
                      notYetLabel: notYet && t.effective_start_time ? `Mulai ${t.effective_start_time}` : null,
                      canFinish: isActive && !!t.timer_started_at && gate.allowed && !overdue,
                      timeStuck,
                      onStart: () => startTimer(t),
                      onFinish: () => finishTask(t),
                      onSkip: () => skipTask(t),
                      // Overdue missions can be owned at any point in the day,
                      // not only when they happen to hold the turn — otherwise
                      // a missed morning task would be unreachable all evening.
                      onReportLate: t.is_bonus ? null : () => setLateTaskModal(t),
                    };
                  },
                }}
              />
            </div>

            {/* Goal marker */}
            <div className="relative z-10 flex justify-center pb-5">
              <motion.div animate={{ scale: [1, 1.12, 1], rotate: [0, 5, -5, 0] }} transition={{ duration: 3, repeat: Infinity }} className="text-5xl select-none">{theme.goalIcon}</motion.div>
            </div>
          </div>
        </>
      )}

      {/* Done list */}
      {done.length > 0 && !loading && (
        <div>
          <h3 className="font-fun font-semibold text-slate-500 text-sm mb-2">Sudah selesai ✅</h3>
          <div className="space-y-1.5">
            {done.slice(-5).reverse().map((t) => (
              <div key={t.id} className="bg-white/60 rounded-2xl px-3 py-2 border border-slate-100 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                <div className="flex-1 text-sm text-slate-500 line-through truncate">{t.title}</div>
                <div className="text-xs font-bold text-slate-400">{t.status === "skipped" ? "dilewati" : `+${t.points}`}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
function LiveTimer({ startedAt, durationMinutes }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const startMs = new Date(startedAt).getTime();
  const elapsed = Math.max(0, Math.floor((now - startMs) / 1000));

  if (durationMinutes) {
    const total = durationMinutes * 60;
    const remaining = Math.max(0, total - elapsed);
    const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
    const ss = String(remaining % 60).padStart(2, "0");
    const over = elapsed > total;
    const pct = Math.min(100, Math.round((elapsed / total) * 100));
    return (
      <div className="mt-1.5">
        <div className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${over ? "bg-red-100 text-red-600 animate-pulse" : "bg-blue-100 text-blue-700"}`}>
          <Timer className="w-3 h-3" /> {over ? "waktu habis!" : `${mm}:${ss} tersisa`}
        </div>
        {!over && (
          <div className="h-1.5 bg-blue-100 rounded-full overflow-hidden mt-1 w-32">
            <motion.div className="h-full rounded-full bg-blue-500" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.5 }} />
          </div>
        )}
      </div>
    );
  }
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return (
    <div className="mt-1 inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
      <Timer className="w-3 h-3" /> berjalan {mm}:{ss}
    </div>
  );
}
