import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Calendar, Target, Sparkles, Play, Square, CheckCircle2, FastForward, Lock, Trophy, Star, Timer } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { QUEST_THEMES } from "@/lib/questThemes";
import { styleMeta } from "@/lib/personality";

const todayKey = () => new Date().toISOString().slice(0, 10);
const shiftDate = (key, days) => {
  const d = new Date(key + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const humanDate = (key) => {
  if (key === todayKey()) return "Hari Ini";
  const d = new Date(key + "T00:00:00");
  return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" });
};

export default function DailyQuestView({ child, themeKey, onCelebrate }) {
  const [dateKey, setDateKey] = useState(todayKey());
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

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
      onCelebrate?.();
      toast.success("Misi selesai! Menunggu dicek Abi/Ummi ⭐");
      await load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally { setBusyId(null); }
  };

  const skipTask = async (task) => {
    const cost = progress?.tasks?.[0] && 20; // display only; server enforces
    if (!window.confirm(`Lewati misi "${task.title}" dengan bayar poin?`)) return;
    setBusyId(task.id);
    try {
      const { data } = await api.post(`/tasks/${task.id}/skip`);
      toast.success(`Dilewati! -${data.points_spent} poin`);
      await load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally { setBusyId(null); }
    void cost;
  };

  const isToday = dateKey === todayKey();
  const isFuture = dateKey > todayKey();

  return (
    <div className="space-y-4">
      {/* Date navigation */}
      <div className="flex items-center gap-2 bg-white rounded-2xl px-3 py-2 border-2 border-slate-100 chunky-shadow">
        <button
          onClick={() => setDateKey(shiftDate(dateKey, -1))}
          className="press-btn p-2 rounded-xl hover:bg-slate-100 text-slate-600"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 text-center">
          <div className="font-fun font-bold text-slate-900 text-sm">{humanDate(dateKey)}</div>
          <div className="text-xs text-slate-400">{dateKey}</div>
        </div>
        <button
          onClick={() => setDateKey(shiftDate(dateKey, 1))}
          className="press-btn p-2 rounded-xl hover:bg-slate-100 text-slate-600"
          disabled={isFuture}
        >
          <ChevronRight className="w-5 h-5" />
        </button>
        {!isToday && (
          <button
            onClick={() => setDateKey(todayKey())}
            className="press-btn ml-1 bg-[#FF9D23] hover:bg-[#f08e14] text-white font-fun font-bold px-3 py-1.5 rounded-xl text-xs"
          >
            <Calendar className="w-3.5 h-3.5 inline mr-1" /> Hari Ini
          </button>
        )}
      </div>

      {/* Daily goal progress */}
      {progress && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-2xl p-4 border-2 ${
            progress.goal_met
              ? "bg-gradient-to-br from-green-50 to-emerald-50 border-green-200"
              : "bg-white border-slate-100"
          } chunky-shadow`}
        >
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              progress.goal_met ? "bg-green-500" : "bg-orange-500"
            }`}>
              {progress.goal_met ? (
                <Trophy className="w-5 h-5 text-white" strokeWidth={2.5} />
              ) : (
                <Target className="w-5 h-5 text-white" strokeWidth={2.5} />
              )}
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
            <div className="font-fun font-bold text-2xl text-slate-900">
              {progress.goal_percent}%
            </div>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress.goal_percent}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className={`h-full rounded-full ${
                progress.goal_met
                  ? "bg-gradient-to-r from-green-400 to-emerald-500"
                  : "bg-gradient-to-r from-orange-400 to-orange-500"
              }`}
            />
          </div>
          <div className="text-xs text-slate-500 mt-2">
            <CheckCircle2 className="w-3 h-3 inline mr-1 text-green-500" />
            {progress.required_done} dari {progress.required_count} misi wajib selesai
          </div>
        </motion.div>
      )}

      {/* Themed quest list */}
      {loading ? (
        <div className="text-center text-slate-400 py-8">Memuat…</div>
      ) : required.length === 0 && bonus.length === 0 ? (
        <div
          className="rounded-3xl p-8 text-center chunky-shadow-lg"
          style={{ background: theme.colors.bg, color: theme.colors.text }}
        >
          <div className="text-5xl mb-3">{theme.goalIcon}</div>
          <div className="font-fun font-bold text-xl">
            {isToday ? "Belum ada misi hari ini" : "Tidak ada misi di hari ini"}
          </div>
          <div className="opacity-80 text-sm">{isToday ? "Cek lagi nanti ya!" : "Coba lihat tanggal lain."}</div>
        </div>
      ) : (
        <>
          {/* Required quest chain (treasure map) */}
          {required.length > 0 && (
            <div
              className="rounded-3xl overflow-hidden p-4 md:p-5 chunky-shadow-lg relative"
              style={{ background: theme.colors.bg, color: theme.colors.text }}
            >
              {/* Decorative background */}
              {theme.decorEmojis.map((e, i) => (
                <motion.div
                  key={i}
                  className="absolute select-none pointer-events-none opacity-25"
                  style={{
                    top: `${(i * 23 + 8) % 90}%`,
                    left: `${(i * 37 + 12) % 88}%`,
                    fontSize: 18 + (i % 3) * 6,
                  }}
                  animate={{ y: [0, -8, 0], rotate: [0, 8, 0] }}
                  transition={{ duration: 4 + i, repeat: Infinity, ease: "easeInOut", delay: i * 0.4 }}
                >
                  {e}
                </motion.div>
              ))}

              <div className="relative z-10 mb-3 flex items-center justify-between">
                <div>
                  <div className="font-fun font-bold text-lg flex items-center gap-2">
                    <span className="text-2xl">{theme.emoji}</span> {theme.label}
                  </div>
                  <div className="text-xs opacity-80" style={{ color: theme.colors.textDim }}>
                    {theme.tagline}
                  </div>
                </div>
                <div className="text-4xl">{theme.goalIcon}</div>
              </div>

              <div className="relative z-10 space-y-2">
                {required.map((t, idx) => {
                  const isActive = next?.id === t.id;
                  const isDone = t.status === "approved" || t.status === "skipped" || t.status === "completed";
                  return (
                    <QuestCard
                      key={t.id}
                      task={t}
                      isActive={isActive}
                      isDone={isDone}
                      theme={theme}
                      busy={busyId === t.id}
                      canStart={isActive && !t.timer_started_at && !isFuture}
                      canFinish={isActive && !!t.timer_started_at && !isFuture}
                      onStart={() => startTimer(t)}
                      onFinish={() => finishTask(t)}
                      onSkip={() => skipTask(t)}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Bonus quests */}
          {bonus.length > 0 && (
            <div className="bg-gradient-to-br from-amber-50 to-yellow-50 rounded-3xl p-4 border-2 border-amber-200 chunky-shadow">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-5 h-5 text-amber-500" />
                <h3 className="font-fun font-bold text-slate-900">Misi Bonus ✨</h3>
                <span className="text-xs text-slate-500">Kerjain kalau mau poin ekstra!</span>
              </div>
              <div className="space-y-2">
                {bonus.map((t) => {
                  const isDone = t.status === "approved" || t.status === "skipped" || t.status === "completed";
                  return (
                    <QuestCard
                      key={t.id}
                      task={t}
                      isActive={!isDone}
                      isDone={isDone}
                      theme={theme}
                      busy={busyId === t.id}
                      canStart={!isDone && !t.timer_started_at && !isFuture}
                      canFinish={!isDone && !!t.timer_started_at && !isFuture}
                      onStart={() => startTimer(t)}
                      onFinish={() => finishTask(t)}
                      isBonus
                    />
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Recently done */}
      {done.length > 0 && !loading && (
        <div>
          <h3 className="font-fun font-semibold text-slate-500 text-sm mb-2">Sudah selesai ✅</h3>
          <div className="space-y-1.5">
            {done.slice(-5).reverse().map((t) => (
              <div key={t.id} className="bg-white/60 rounded-2xl px-3 py-2 border border-slate-100 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                <div className="flex-1 text-sm text-slate-500 line-through truncate">{t.title}</div>
                <div className="text-xs font-bold text-slate-400">
                  {t.status === "skipped" ? "dilewati" : `+${t.points}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** ==================== QuestCard with live timer ==================== */
function QuestCard({ task, isActive, isDone, theme, busy, canStart, canFinish, onStart, onFinish, onSkip, isBonus }) {
  const c = theme.colors;
  const bg = isDone ? c.nodeDone : isActive ? c.node : c.nodeLocked;
  const icon = isDone ? theme.doneIcon : isActive ? theme.activeIcon : theme.lockedIcon;
  const style = task.task_style ? styleMeta(task.task_style) : null;

  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      className={`rounded-2xl p-3 flex items-center gap-3 relative border-2 ${isActive ? "ring-2 ring-white/60" : ""}`}
      style={{
        background: isDone ? "rgba(255,255,255,0.85)" : isActive ? "rgba(255,255,255,0.96)" : "rgba(255,255,255,0.55)",
        borderColor: bg,
        color: "#1E293B",
      }}
    >
      <motion.div
        animate={isActive && !isDone ? { scale: [1, 1.05, 1] } : {}}
        transition={isActive ? { duration: 2, repeat: Infinity } : {}}
        className="w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center text-2xl md:text-3xl shrink-0"
        style={{ background: bg, color: "white", boxShadow: isActive ? `0 4px 16px ${bg}80` : "0 2px 6px rgba(0,0,0,0.15)" }}
      >
        {isDone ? (
          <CheckCircle2 className="w-7 h-7 text-white" strokeWidth={2.5} />
        ) : isActive ? (
          <span>{icon}</span>
        ) : (
          <Lock className="w-5 h-5 text-white" strokeWidth={2.5} />
        )}
      </motion.div>

      <div className="flex-1 min-w-0">
        <div className={`font-fun font-bold text-sm md:text-base ${isDone ? "line-through text-slate-500" : "text-slate-900"} truncate`}>
          {task.title}
        </div>
        {task.description && isActive && (
          <div className="text-xs text-slate-600 truncate">{task.description}</div>
        )}
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <span className="inline-flex items-center gap-0.5 text-xs font-bold text-amber-600">
            <Star className="w-3 h-3 fill-amber-500 text-amber-500" /> +{task.points}
          </span>
          {isBonus && (
            <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-amber-500 text-white">
              ✨ Bonus
            </span>
          )}
          {style && isActive && (
            <span className="text-xs font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: style.color }}>
              {style.emoji} {style.label}
            </span>
          )}
          {task.due_time && !isDone && (
            <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
              🕒 {task.due_time}
            </span>
          )}
          {task.duration_minutes && !isDone && (
            <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">
              ⏱️ {task.duration_minutes}m
            </span>
          )}
        </div>
        {task.timer_started_at && !isDone && (
          <LiveTimer startedAt={task.timer_started_at} durationMinutes={task.duration_minutes} />
        )}
      </div>

      {isActive && !isDone && (
        <div className="flex flex-col gap-1.5 shrink-0">
          {canStart && (
            <button
              onClick={onStart}
              disabled={busy}
              className="press-btn chunky-shadow bg-blue-500 hover:bg-blue-600 text-white font-fun font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1 disabled:opacity-60"
            >
              <Play className="w-3.5 h-3.5" strokeWidth={2.5} /> Mulai
            </button>
          )}
          {canFinish && (
            <button
              onClick={onFinish}
              disabled={busy}
              className="press-btn chunky-shadow bg-[#34D399] hover:bg-[#2bbf88] text-white font-fun font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1 disabled:opacity-60"
            >
              <Square className="w-3.5 h-3.5" strokeWidth={2.5} /> Selesai!
            </button>
          )}
          {!isBonus && onSkip && (canStart || canFinish) && (
            <button
              onClick={onSkip}
              disabled={busy}
              className="press-btn bg-slate-100 hover:bg-slate-200 text-slate-600 font-fun font-semibold px-3 py-1 rounded-xl text-[10px] flex items-center gap-1 disabled:opacity-60"
            >
              <FastForward className="w-3 h-3" /> Lewati
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}

/** ==================== Live countdown / elapsed timer ==================== */
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
    return (
      <div className={`mt-1 inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${
        over ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-700"
      }`}>
        <Timer className="w-3 h-3" />
        {over ? "waktu habis!" : `${mm}:${ss} tersisa`}
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

// AnimatePresence not used here, just keep exports minimal
export { QuestCard };
void AnimatePresence;
