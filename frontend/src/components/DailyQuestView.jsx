import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Calendar, Target, Sparkles, Play, Square, CheckCircle2, FastForward, Lock, Trophy, Star, Timer } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { QUEST_THEMES } from "@/lib/questThemes";
import { styleMeta } from "@/lib/personality";
import { todayKey, shiftDateKey, humanDateKey, localTimeHHMM, isFutureDate } from "@/lib/dates";

// Sound effect for task completion (tiny inline WAV)
const playDing = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
    // Haptic feedback if available
    if (navigator.vibrate) navigator.vibrate([50, 30, 100]);
  } catch { /* audio not available */ }
};

export default function DailyQuestView({ child, themeKey, onCelebrate }) {
  const [dateKey, setDateKey] = useState(todayKey());
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [nowHHMM, setNowHHMM] = useState(localTimeHHMM());
  useEffect(() => {
    const t = setInterval(() => setNowHHMM(localTimeHHMM()), 30000);
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

  const { required, bonus, next, done } = useMemo(() => {
    const tasks = progress?.tasks || [];
    const req = tasks.filter((t) => !t.is_bonus).sort((a, b) => (a.order || 0) - (b.order || 0));
    const bon = tasks.filter((t) => t.is_bonus);
    const openReq = req.filter((t) => t.status === "pending" || t.status === "rejected");
    const first = openReq[0] || null;
    const doneReq = req.filter((t) => t.status === "approved" || t.status === "skipped" || t.status === "completed");
    return { required: req, bonus: bon, next: first, done: doneReq };
  }, [progress]);

  const isToday = dateKey === todayKey();
  const isFuture = isFutureDate(dateKey);

  const timeGate = (task) => {
    if (!isToday) return { allowed: false, reason: isFuture ? "future" : "past" };
    if (!task.due_time) return { allowed: true, reason: null };
    const [dh, dm] = task.due_time.split(":").map(Number);
    const [nh, nm] = nowHHMM.split(":").map(Number);
    const dueMin = dh * 60 + dm;
    const nowMin = nh * 60 + nm;
    const lead = task.duration_minutes && task.duration_minutes > 0 ? task.duration_minutes : 120;
    if (nowMin < dueMin - lead) return { allowed: false, reason: "early" };
    if (nowMin > dueMin) return { allowed: false, reason: "late" };
    return { allowed: true, reason: null };
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

  const finishTask = async (task) => {
    setBusyId(task.id);
    try {
      await api.post(`/tasks/${task.id}/complete`);
      playDing();
      onCelebrate?.();
      toast.success("Misi selesai! Menunggu dicek Abi/Ummi ⭐");
      await load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally { setBusyId(null); }
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
      {/* Date nav */}
      <div className="flex items-center gap-2 bg-white rounded-2xl px-3 py-2 border-2 border-slate-100 chunky-shadow">
        <button onClick={() => setDateKey(shiftDateKey(dateKey, -1))} className="press-btn p-2 rounded-xl hover:bg-slate-100 text-slate-600">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 text-center">
          <div className="font-fun font-bold text-slate-900 text-sm">{humanDateKey(dateKey)}</div>
          <div className="text-xs text-slate-400">{dateKey}</div>
        </div>
        <button onClick={() => setDateKey(shiftDateKey(dateKey, 1))} disabled={isFuture} className="press-btn p-2 rounded-xl hover:bg-slate-100 text-slate-600 disabled:opacity-40">
          <ChevronRight className="w-5 h-5" />
        </button>
        {!isToday && (
          <button onClick={() => setDateKey(todayKey())} className="press-btn ml-1 bg-[#FF9D23] hover:bg-[#f08e14] text-white font-fun font-bold px-3 py-1.5 rounded-xl text-xs">
            <Calendar className="w-3.5 h-3.5 inline mr-1" /> Hari Ini
          </button>
        )}
      </div>

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

      {/* Treasure Map */}
      {loading ? (
        <div className="text-center text-slate-400 py-8">Memuat…</div>
      ) : required.length === 0 && bonus.length === 0 ? (
        <div className="rounded-3xl p-8 text-center chunky-shadow-lg" style={{ background: theme.colors.bg, color: theme.colors.text }}>
          <div className="text-5xl mb-3">{theme.goalIcon}</div>
          <div className="font-fun font-bold text-xl">{isToday ? "Belum ada misi hari ini" : "Tidak ada misi di hari ini"}</div>
          <div className="opacity-80 text-sm">{theme.tagline}</div>
        </div>
      ) : (
        <>
          {required.length > 0 && (
            <div className="rounded-3xl overflow-hidden chunky-shadow-lg relative" style={{ background: theme.colors.bg, color: theme.colors.text }}>
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

              {/* Quest nodes — clean vertical list */}
              <div className="relative z-10 px-4">
                <div className="relative z-10 space-y-2 pb-4">
                  {required.map((t, idx) => {
                    const isActive = next?.id === t.id;
                    const isDone = t.status === "approved" || t.status === "skipped" || t.status === "completed";
                    const gate = timeGate(t);
                    return (
                      <QuestNode key={t.id} task={t} idx={idx} total={required.length}
                        isActive={isActive} isDone={isDone} theme={theme}
                        busy={busyId === t.id} gate={gate}
                        canStart={isActive && !t.timer_started_at && gate.allowed}
                        canFinish={isActive && !!t.timer_started_at && gate.allowed}
                        onStart={() => startTimer(t)} onFinish={() => finishTask(t)} onSkip={() => skipTask(t)}
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
          )}

          {/* Bonus quests */}
          {bonus.length > 0 && (
            <div className="bg-gradient-to-br from-amber-50 to-yellow-50 rounded-3xl p-4 border-2 border-amber-200 chunky-shadow">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-5 h-5 text-amber-500" />
                <h3 className="font-fun font-bold text-slate-900">Misi Bonus ✨</h3>
              </div>
              <div className="space-y-2">
                {bonus.map((t) => {
                  const isDone = t.status === "approved" || t.status === "skipped" || t.status === "completed";
                  const gate = timeGate(t);
                  return (
                    <QuestNode key={t.id} task={t} idx={0} total={1}
                      isActive={!isDone} isDone={isDone} theme={theme}
                      busy={busyId === t.id} gate={gate}
                      canStart={!isDone && !t.timer_started_at && gate.allowed}
                      canFinish={!isDone && !!t.timer_started_at && gate.allowed}
                      onStart={() => startTimer(t)} onFinish={() => finishTask(t)}
                      isBonus
                    />
                  );
                })}
              </div>
            </div>
          )}
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
function QuestNode({ task, idx, total, isActive, isDone, theme, busy, gate, canStart, canFinish, onStart, onFinish, onSkip, isBonus }) {
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
          {isBonus && <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-amber-500 text-white">✨ Bonus</span>}
          {task.recurrence && task.recurrence !== "none" && (
            <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
              🔁 {task.recurrence === "daily" ? "Harian" : "Mingguan"}
            </span>
          )}
          {task.due_time && !isDone && <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">🕒 {task.due_time}</span>}
          {task.duration_minutes && !isDone && <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">⏱️ {task.duration_minutes}m</span>}
        </div>
        {started && !isDone && <LiveTimer startedAt={task.timer_started_at} durationMinutes={task.duration_minutes} />}
        {isActive && !isDone && !started && gateReason === "early" && (
          <div className="mt-1 inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">🔒 Belum waktunya</div>
        )}
        {isActive && !isDone && !started && gateReason === "late" && (
          <div className="mt-1 inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600">⌛ Waktu sudah lewat</div>
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
          {!isBonus && onSkip && (canStart || canFinish) && (
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
