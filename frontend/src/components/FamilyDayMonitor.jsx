import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Calendar, Target, Trophy, CheckCircle2, Clock, Lock, Sparkles, Star, XCircle } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { QUEST_THEMES, pickQuestTheme } from "@/lib/questThemes";
import { todayKey, shiftDateKey, humanDateKey, isFutureDate } from "@/lib/dates";
import BeforeAfter from "@/components/BeforeAfter";
import MonthHeatmap from "@/components/MonthHeatmap";
import GrowthTrail from "@/components/GrowthTrail";
import OverdueSectionsCard from "@/components/OverdueSectionsCard";

const statusLabel = {
  pending: { icon: Clock, label: "Belum", color: "text-slate-400" },
  rejected: { icon: XCircle, label: "Ditolak", color: "text-red-500" },
  completed: { icon: Clock, label: "Menunggu", color: "text-amber-500" },
  approved: { icon: CheckCircle2, label: "Selesai", color: "text-green-500" },
  skipped: { icon: Lock, label: "Dilewati", color: "text-slate-400" },
  missed: { icon: XCircle, label: "Terlewat", color: "text-red-500" },
};

export default function FamilyDayMonitor() {
  const [dateKey, setDateKey] = useState(todayKey());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/family/day-progress", { params: { date_key: dateKey } });
      setData(data);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally { setLoading(false); }
  }, [dateKey]);

  useEffect(() => { load(); }, [load]);

  const isToday = dateKey === todayKey();

  return (
    <div className="space-y-4">
      {/* Date navigation */}
      <div className="bg-white rounded-2xl border-2 border-slate-100 chunky-shadow p-3 flex items-center gap-2">
        <button onClick={() => setDateKey(shiftDateKey(dateKey, -1))} className="press-btn p-2 rounded-xl hover:bg-slate-100 text-slate-600">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 text-center">
          <div className="font-parent font-bold text-slate-900">{humanDateKey(dateKey)}</div>
          <div className="text-xs text-slate-400">{dateKey}</div>
        </div>
        <button onClick={() => setDateKey(shiftDateKey(dateKey, 1))} disabled={isFutureDate(dateKey)} className="press-btn p-2 rounded-xl hover:bg-slate-100 text-slate-600 disabled:opacity-40">
          <ChevronRight className="w-5 h-5" />
        </button>
        {!isToday && (
          <button onClick={() => setDateKey(todayKey())} className="press-btn ml-1 bg-indigo-500 hover:bg-indigo-600 text-white font-semibold px-3 py-1.5 rounded-xl text-xs">
            <Calendar className="w-3.5 h-3.5 inline mr-1" /> Hari Ini
          </button>
        )}
      </div>

      <OverdueSectionsCard onChanged={load} />

      {data?.children?.[0]?.vacation_mode && (
        <div className="bg-sky-50 border-2 border-sky-200 rounded-2xl px-4 py-3 flex items-center gap-2 text-sky-700">
          <span className="text-xl">🏖️</span>
          <span className="text-sm font-semibold">Mode liburan aktif — misi rutin dijeda, tidak akan menumpuk.</span>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-2xl p-8 text-center text-slate-400">Memuat…</div>
      ) : !data || data.children.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center text-slate-500">Belum ada anak.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {data.children.map((entry) => (
              <ChildDayCard key={entry.child.id} entry={entry} onChanged={load} />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {data.children.map((entry) => (
              <MonthHeatmap key={entry.child.id} childId={entry.child.id} childName={entry.child.name} />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {data.children.map((entry) => (
              <GrowthTrail key={entry.child.id} childId={entry.child.id} childName={entry.child.name} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ChildDayCard({ entry, onChanged }) {
  const child = entry.child;
  const theme = QUEST_THEMES[pickQuestTheme(child)] || QUEST_THEMES.ocean;

  const required = (entry.tasks || []).filter((t) => !t.is_bonus).sort((a, b) => (a.order || 0) - (b.order || 0));
  const bonus = (entry.tasks || []).filter((t) => t.is_bonus);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border-2 border-slate-100 chunky-shadow overflow-hidden"
    >
      {/* Header with themed banner */}
      <div
        className="relative p-4 text-white"
        style={{ background: theme.colors.bg }}
      >
        <div className="flex items-center gap-3 relative z-10">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl chunky-shadow" style={{ background: child.avatar_color }}>
            {child.avatar_emoji}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-fun font-bold text-lg" style={{ color: theme.colors.text }}>{child.name}</div>
            <div className="text-xs opacity-90" style={{ color: theme.colors.textDim }}>
              {theme.emoji} {theme.label} · {child.points || 0} poin
              {child.mbti && ` · ${child.mbti}`}
            </div>
          </div>
          <div className="text-4xl">{theme.goalIcon}</div>
        </div>
      </div>

      {/* Goal progress bar */}
      <div className={`p-4 border-b border-slate-100 ${entry.goal_met ? "bg-green-50" : "bg-white"}`}>
        <div className="flex items-center gap-2 mb-2">
          {entry.goal_met ? (
            <Trophy className="w-4 h-4 text-green-500" strokeWidth={2.5} />
          ) : (
            <Target className="w-4 h-4 text-orange-500" strokeWidth={2.5} />
          )}
          <div className="font-parent font-semibold text-sm text-slate-700 flex-1">
            {entry.goal_met ? "Target harian tercapai!" : "Target harian"}
          </div>
          <div className="font-bold text-sm text-slate-900">
            {entry.total_earned} / {entry.daily_goal}
          </div>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${entry.goal_met ? "bg-green-500" : "bg-orange-500"}`}
            style={{ width: `${entry.goal_percent}%` }}
          />
        </div>
        <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
          <span>✅ {entry.required_done}/{entry.required_count} wajib</span>
          {entry.bonus_earned > 0 && <span>✨ +{entry.bonus_earned} bonus</span>}
        </div>
      </div>

      {/* Quest map preview: required chain */}
      <div className="p-4 space-y-2">
        {required.length === 0 && bonus.length === 0 ? (
          <div className="text-sm text-slate-400 text-center py-3">Tidak ada misi di hari ini.</div>
        ) : (
          <>
            {required.map((t) => (
              <TaskRow key={t.id} task={t} onChanged={onChanged} />
            ))}
            {bonus.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <div className="flex items-center gap-1 text-xs font-bold text-amber-500 mb-2">
                  <Sparkles className="w-3 h-3" /> Bonus
                </div>
                {bonus.map((t) => (
                  <TaskRow key={t.id} task={t} bonus onChanged={onChanged} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}

function fmtClock(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
  } catch { return ""; }
}
function TaskRow({ task, bonus, onChanged }) {
  const s = statusLabel[task.status] || statusLabel.pending;
  const Icon = s.icon;
  const isDone = task.status === "approved" || task.status === "completed" || task.status === "skipped";
  const hasPhoto = task.before_photo_url || task.completion_photo_url;
  const [showPhoto, setShowPhoto] = useState(false);

  return (
    <div className="space-y-1.5">
    <div className={`flex items-center gap-2 p-2 rounded-xl ${isDone ? "bg-slate-50" : "bg-white"} border border-slate-100`}>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
        task.status === "approved" ? "bg-green-100" :
        task.status === "completed" ? "bg-amber-100" :
        task.status === "skipped" ? "bg-slate-100" :
        task.status === "rejected" ? "bg-red-100" :
        task.status === "missed" ? "bg-red-100" :
        "bg-slate-50"
      }`}>
        <Icon className={`w-4 h-4 ${s.color}`} strokeWidth={2.5} />
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-semibold ${isDone ? "text-slate-500 line-through" : "text-slate-800"} truncate`}>
          {task.order && !bonus && <span className="text-xs text-slate-400 mr-1">#{task.order}</span>}
          {task.title}
        </div>
        <div className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
          <span>{s.label}</span>
          {task.is_coop && <span className="text-teal-600 font-bold">🤝 Bersama</span>}
          {task.duration_minutes && <span>· ±{task.duration_minutes}m</span>}
          {task.checked_at && <span title="Waktu anak mencentang">· ✔️ {fmtClock(task.checked_at)}</span>}
        </div>
      </div>
      {hasPhoto && (
        <button onClick={() => setShowPhoto((v) => !v)} title="Lihat foto misi"
                className="press-btn shrink-0 w-9 h-9 rounded-lg overflow-hidden border border-slate-200">
          <img src={task.completion_photo_url || task.before_photo_url} alt="" loading="lazy" className="w-full h-full object-cover" />
        </button>
      )}
      <div className="flex items-center gap-0.5 text-xs font-bold text-amber-600 shrink-0">
        <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
        {task.points}
      </div>
    </div>
    {showPhoto && hasPhoto && (
      <BeforeAfter before={task.before_photo_url} after={task.completion_photo_url} alt={task.title} />
    )}
    {task.summary_required && (task.summary_text || task.summary_previous) && (
      <SummaryReview task={task} onChanged={onChanged} />
    )}
    </div>
  );
}


/** What the child wrote for a summary mission, with a quick 👍 / rewrite. */
function SummaryReview({ task, onChanged }) {
  const [busy, setBusy] = useState(false);
  const review = async (verdict) => {
    let note = "";
    if (verdict === "redo") {
      const v = window.prompt("Pesan untuk anak (opsional), mis. \"Ceritakan contohnya ya\":", "");
      if (v === null) return;
      note = v;
    }
    setBusy(true);
    try {
      const { data } = await api.post(`/tasks/${task.id}/summary-review`, { verdict, note });
      toast.success(verdict === "good" ? "Ditandai bagus 👍"
        : data.reopened ? "Diminta tulis ulang — centangnya dibuka lagi" : "Catatan terkirim ke anak");
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };
  const text = task.summary_text || task.summary_previous;
  const mins = task.summary_typing_seconds != null ? Math.max(1, Math.round(task.summary_typing_seconds / 60)) : null;
  return (
    <div className="ml-10 rounded-xl border border-indigo-100 bg-indigo-50/50 px-3 py-2 space-y-1">
      <div className="text-[11px] text-indigo-700 font-semibold flex items-center gap-2 flex-wrap">
        <span>📝 Ringkasan</span>
        {task.summary_words ? <span className="text-slate-400 font-normal">{task.summary_words} kata</span> : null}
        {mins != null && <span className="text-slate-400 font-normal">· ditulis ±{mins} mnt</span>}
        {task.summary_pasted && <span className="text-amber-600">· ⚠️ ada yang ditempel (copy-paste)</span>}
        {!task.summary_text && <span className="text-amber-600">· diminta tulis ulang</span>}
        {task.summary_review === "good" && <span className="text-emerald-600">· 👍 sudah dibaca</span>}
      </div>
      <div className="text-sm text-slate-700 whitespace-pre-wrap break-words">{text}</div>
      {task.summary_note && <div className="text-xs text-amber-700">💬 {task.summary_note}</div>}
      {task.summary_text && (
        <div className="flex gap-2 pt-1">
          <button onClick={() => review("good")} disabled={busy}
            className="press-btn px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500 text-white disabled:opacity-50">👍 Bagus</button>
          <button onClick={() => review("redo")} disabled={busy}
            className="press-btn px-2.5 py-1 rounded-lg text-xs font-semibold border border-amber-300 text-amber-700 bg-white disabled:opacity-50">✍️ Tulis ulang</button>
        </div>
      )}
    </div>
  );
}
