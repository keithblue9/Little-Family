import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { motion } from "framer-motion";
import { Calendar, Target, Play, Square, CheckCircle2, FastForward, Lock, Trophy, Star, Timer } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { QUEST_THEMES } from "@/lib/questThemes";
import { styleMeta } from "@/lib/personality";
import { todayKey, humanDateKey, localTimeHHMM, isFutureDate } from "@/lib/dates";
import { playSoundTheme } from "@/lib/sounds";
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
      const { data } = await api.get(`/children/${child.id}/day-progress`, {
        params: { date_key: dateKey },
      });
      setProgress(data);
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
    const req = tasks.filter((t) => !t.is_bonus).sort((a, b) => (a.order || 0) - (b.order || 0));
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
  }, [progress]);

  const isToday = dateKey === todayKey();
  const isFuture = isFutureDate(dateKey);

  const timeGate = (task) => {
    if (!isToday) return { allowed: false, reason: isFuture ? "future" : "past" };
    // Flexible flow: a task can be started ANY time on its own day (kids may
    // work ahead of schedule). We no longer block by the due_time window.
    // Overshooting the due_time without starting turns a required task
    // time-stuck (handled by isTimeStuck → Kartu Bebas), but that's a finish/
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

  // Mirrors the backend's _task_is_time_stuck check — only show the "Bebaskan
  // dengan Kartu Bebas" option when a required task is genuinely blocked by
  // time (duration ran out, or the due_time window closed before it was ever
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

  const freeWithCard = async (task) => {
    setBusyId(task.id);
    try {
      const { data } = await api.post(`/tasks/${task.id}/free-with-card`);
      toast.success(`Misi dibebaskan dengan Kartu Bebas! Sisa: ${data.freeze_cards_available} kartu minggu ini.`);
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

  const finishTask = async (task, photoUrl, doneTogether) => {
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
      await api.post(`/tasks/${task.id}/complete`, body);
      playSoundTheme(child?.sound_theme || "ding");
      onCelebrate?.();
      toast.success(
        task.together_bonus_enabled && doneTogether
          ? `Misi selesai! +${task.together_bonus_points} poin bonus menunggu disetujui 🎉`
          : "Misi selesai! Menunggu dicek Abi/Ummi ⭐"
      );
      await load();
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

      {progress?.vacation_mode && (
        <div className="bg-sky-50 border-2 border-sky-200 rounded-2xl px-4 py-3 flex items-center gap-2 text-sky-700">
          <span className="text-xl">🏖️</span>
          <span className="text-sm font-semibold">Keluarga sedang liburan — misi rutin tidak menumpuk, santai dulu ya!</span>
        </div>
      )}

      {/* Daily goal progress */}
      {progress && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-2xl p-4 border-2 ${progress.goal_met ? "bg-gradient-to-br from-green-50 to-emerald-50 border-green-200" : "bg-white border-slate-100"} chunky-shadow`}
        >
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${progress.goal_met ? "bg-green-500" : "bg-orange-500"}`}>
              {progress.goal_met ? <Trophy className="w-5 h-5 text-white" strokeWidth={2.5} /> : <Target className="w-5 h-5 text-white" strokeWidth={2.5} />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-fun font-bold text-sm text-slate-900">
                {progress.goal_met ? "Target harian tercapai! 🎉" : "Target Poin Hari Ini"}
              </div>
              <div className="text-xs text-slate-500">
                {progress.total_earned} / {progress.daily_goal} poin
                {progress.bonus_earned > 0 && ` (+${progress.bonus_earned} bonus)`}
              </div>
            </div>
            <div className="font-fun font-bold text-2xl text-slate-900">{progress.goal_percent}%</div>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress.goal_percent}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className={`h-full rounded-full ${progress.goal_met ? "bg-gradient-to-r from-green-400 to-emerald-500" : "bg-gradient-to-r from-orange-400 to-orange-500"}`}
            />
          </div>
        </motion.div>
      )}

      {isToday && progress?.perfect_day && !progress?.perfect_day_claimed && (
        <MysteryBox childId={child?.id} soundTheme={child?.sound_theme} onClaimed={load} />
      )}

      {/* Treasure Map */}
      {loading ? (
        <div className="text-center text-slate-400 py-8">Memuat…</div>
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

            {/* Quest timeline — required + bonus interleaved by time-of-day */}
            <div className="relative z-10 px-4">
              <div className="relative z-10 space-y-2 pb-4">
                {timeline.map((t, idx) => {
                  const isDone = t.status === "approved" || t.status === "skipped" || t.status === "completed";
                  const gate = timeGate(t);
                  const overdue = isDurationExceeded(t);
                  if (t.is_bonus) {
                    // Bonus node — never blocked by the required sequence, always
                    // startable/skippable directly, sits in its time slot.
                    return (
                      <QuestNode key={t.id} task={t} idx={idx} total={timeline.length}
                        isActive={!isDone} isDone={isDone} theme={theme}
                        busy={busyId === t.id} gate={gate} overdue={overdue}
                        canStart={!isDone && !t.timer_started_at && gate.allowed}
                        canFinish={!isDone && !!t.timer_started_at && gate.allowed && !overdue}
                        onStart={() => startTimer(t)} onFinish={() => finishTask(t)}
                        onSkip={() => skipTask(t)}
                        isBonus
                      />
                    );
                  }
                  // Required node — gated by sequence (only the frontmost open one is active).
                  const isActive = next?.id === t.id;
                  const timeStuck = isActive && !isDone && isTimeStuck(t);
                  return (
                    <QuestNode key={t.id} task={t} idx={idx} total={timeline.length}
                      isActive={isActive} isDone={isDone} theme={theme}
                      busy={busyId === t.id} gate={gate} overdue={overdue} timeStuck={timeStuck}
                      canStart={isActive && !t.timer_started_at && gate.allowed}
                      canFinish={isActive && !!t.timer_started_at && gate.allowed && !overdue}
                      onStart={() => startTimer(t)} onFinish={() => finishTask(t)} onSkip={() => skipTask(t)}
                      onFreeWithCard={() => freeWithCard(t)}
                      freezeCardsAvailable={child?.freeze_cards_available ?? 0}
                    />
                  );
                })}
              </div>
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

/* ======================== QUEST NODE (treasure map stop) ======================== */
function QuestNode({ task, idx, total, isActive, isDone, theme, busy, gate, overdue, timeStuck, canStart, canFinish, onStart, onFinish, onSkip, onFreeWithCard, freezeCardsAvailable, isBonus }) {
  const c = theme.colors;
  const bg = isDone ? c.nodeDone : isActive ? c.node : c.nodeLocked;
  const started = !!task.timer_started_at;
  const gateReason = gate?.reason;

  // Node connector line (clean vertical, not zigzag)
  const showConnector = !isBonus && idx > 0;

  return (
    <div className="relative">
      {showConnector && (
        <div className="absolute left-6 md:left-7 -top-2 h-2 w-0.5" style={{ background: theme.colors.path, opacity: 0.4 }} />
      )}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: idx * 0.06 }}
        className={`rounded-2xl p-3 flex items-center gap-3 border-2 ${isActive && !isDone ? "ring-2 ring-white/60" : ""}`}
        style={{
          background: isDone ? "rgba(255,255,255,0.85)" : isActive ? "rgba(255,255,255,0.96)" : "rgba(255,255,255,0.55)",
          borderColor: bg,
          color: "#1E293B",
        }}
      >
      {/* Node circle with animated glow for active */}
      <motion.div
        animate={isActive && !isDone && started ? { scale: [1, 1.08, 1], boxShadow: [`0 0 0px ${bg}`, `0 0 20px ${bg}`, `0 0 0px ${bg}`] } : {}}
        transition={isActive && started ? { duration: 1.5, repeat: Infinity } : {}}
        className="w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center text-xl md:text-2xl shrink-0"
        style={{ background: bg, color: "white", boxShadow: isActive ? `0 4px 16px ${bg}80` : "0 2px 6px rgba(0,0,0,0.15)" }}
      >
        {isDone ? <CheckCircle2 className="w-7 h-7 text-white" strokeWidth={2.5} /> :
         isActive ? <span>{theme.activeIcon}</span> :
         <Lock className="w-5 h-5 text-white opacity-60" strokeWidth={2.5} />}
      </motion.div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className={`font-fun font-bold text-sm ${isDone ? "line-through text-slate-500" : "text-slate-900"} truncate`}>
          {task.title}
        </div>
        {task.description && isActive && <div className="text-xs text-slate-600 truncate">{task.description}</div>}
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <span className="inline-flex items-center gap-0.5 text-xs font-bold text-amber-600">
            <Star className="w-3 h-3 fill-amber-500 text-amber-500" /> +{task.points}
          </span>
          {isBonus && !task.is_coop && <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-amber-500 text-white">✨ Bonus</span>}
          {task.is_coop && (
            <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-teal-500 text-white">🤝 Bersama</span>
          )}
          {task.recurrence && task.recurrence !== "none" && (
            <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
              🔁 {task.recurrence === "daily" ? "Harian" : "Mingguan"}
            </span>
          )}
          {task.due_time && !isDone && <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">🕒 {task.due_time}</span>}
          {task.duration_minutes && !isDone && <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">⏱️ {task.duration_minutes}m</span>}
          {task.photo_required && !isDone && <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-fuchsia-100 text-fuchsia-700">📷 butuh foto</span>}
          {task.together_bonus_enabled && !isDone && <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-pink-100 text-pink-700">🎁 bonus jika bersama</span>}
          {task.together_bonus_enabled && isDone && task.done_together === true && <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-pink-500 text-white">🤝 Bersama! +{task.together_bonus_points}</span>}
        </div>
        {started && !isDone && <LiveTimer startedAt={task.timer_started_at} durationMinutes={task.duration_minutes} />}
        {!isDone && gateReason === "past" && (
          <div className="mt-1 inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">⌛ Hari ini sudah lewat</div>
        )}
        {!isDone && gateReason === "future" && (
          <div className="mt-1 inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-500">🔮 Belum tiba harinya</div>
        )}
        {isDone && task.early_bonus_awarded > 0 && (
          <div className="mt-1 inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-green-500 text-white">⚡ Cepat! +{task.early_bonus_awarded} bonus</div>
        )}
        {isDone && (task.encouragement_message || task.encouragement_voice_url) && (
          <div className="mt-2 bg-pink-50 border border-pink-200 rounded-xl px-2.5 py-1.5">
            <div className="text-[10px] font-bold text-pink-500 mb-0.5">💌 Pesan dari orang tuamu</div>
            {task.encouragement_message && <div className="text-xs text-pink-700">{task.encouragement_message}</div>}
            {task.encouragement_voice_url && (
              <audio controls src={task.encouragement_voice_url} className="h-8 w-full mt-1" />
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      {isActive && !isDone && (
        <div className="flex flex-col gap-1.5 shrink-0">
          {canStart && (
            <button onClick={onStart} disabled={busy} className="press-btn chunky-shadow bg-blue-500 hover:bg-blue-600 text-white font-fun font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1 disabled:opacity-60">
              <Play className="w-3.5 h-3.5" strokeWidth={2.5} /> Mulai
            </button>
          )}
          {canFinish && (
            <button onClick={onFinish} disabled={busy} className="press-btn chunky-shadow bg-[#34D399] hover:bg-[#2bbf88] text-white font-fun font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1 disabled:opacity-60">
              <Square className="w-3.5 h-3.5" strokeWidth={2.5} /> Selesai!
            </button>
          )}
          {overdue && !!task.timer_started_at && (
            <button disabled className="press-btn bg-slate-200 text-slate-400 font-fun font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1 cursor-not-allowed" title="Waktu sudah habis — lewati misi ini untuk lanjut">
              <Square className="w-3.5 h-3.5" strokeWidth={2.5} /> Waktu Habis
            </button>
          )}
          {timeStuck && onFreeWithCard && (
            <button
              onClick={onFreeWithCard}
              disabled={busy || freezeCardsAvailable < 1}
              title={freezeCardsAvailable < 1 ? "Kartu Bebas minggu ini sudah habis" : "Bebaskan misi ini tanpa poin, pakai 1 Kartu Bebas"}
              className="press-btn bg-sky-100 hover:bg-sky-200 text-sky-700 font-fun font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              🧊 Pakai Kartu Bebas {freezeCardsAvailable > 0 ? `(${freezeCardsAvailable})` : ""}
            </button>
          )}
          {onSkip && (canStart || canFinish || overdue) && (
            <button onClick={onSkip} disabled={busy} className="press-btn bg-slate-100 hover:bg-slate-200 text-slate-600 font-fun font-semibold px-3 py-1 rounded-xl text-[10px] flex items-center gap-1 disabled:opacity-60">
              <FastForward className="w-3 h-3" /> Lewati
            </button>
          )}
        </div>
      )}
      </motion.div>
    </div>
  );
}

/* ======================== LIVE TIMER ======================== */
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
