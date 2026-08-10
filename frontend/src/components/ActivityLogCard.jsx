import { useEffect, useState } from "react";
import { ScrollText, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

/**
 * A plain, chronological record of what actually happened.
 *
 * The insight cards summarise patterns; this is the raw trail behind them —
 * who started what, who snoozed, who reported being late and why. Useful
 * precisely when a summary looks odd and you want to see the actual sequence
 * rather than a statistic about it.
 */
const ACTION_META = {
  task_started: { icon: "▶️", label: "Memulai misi" },
  task_completed: { icon: "✅", label: "Menyelesaikan misi" },
  task_approved: { icon: "⭐", label: "Misi disetujui" },
  task_rejected: { icon: "↩️", label: "Misi perlu diulang" },
  task_skipped: { icon: "⏭️", label: "Melewati misi" },
  task_snoozed: { icon: "⏰", label: "Menunda misi" },
  task_started_early: { icon: "⚡", label: "Mulai lebih cepat (lewati jeda)" },
  task_late_reason: { icon: "🕐", label: "Lapor terlambat" },
  punishment_issued: { icon: "⚖️", label: "Hukuman terbit" },
  punishment_chosen: { icon: "🖐️", label: "Memilih hukuman" },
  punishment_served: { icon: "🤝", label: "Hukuman dijalani" },
  punishment_expired: { icon: "💔", label: "Hukuman kedaluwarsa" },
  streak_bonus_card: { icon: "🔥", label: "Bonus streak" },
  family_combo_awarded: { icon: "🎉", label: "Bonus kompak" },
};

function describe(item) {
  const meta = ACTION_META[item.action] || { icon: "•", label: item.action };
  const d = item.details || {};
  let extra = d.title || "";
  if (item.action === "task_snoozed" && d.minutes) extra = `${d.title} · ${d.minutes} menit`;
  if (item.action === "task_started_early") extra = `${d.title} · jeda ${d.gap_seconds ?? 0} detik`;
  if (item.action === "task_late_reason" && d.reason) {
    extra = `${d.title} · "${d.reason}"${d.penalized ? " · kena kartu" : ""}`;
  }
  if (item.action === "task_approved" && d.points != null) extra = `${d.title || ""} · +${d.points} poin`;
  return { ...meta, extra };
}

export default function ActivityLogCard({ kids = [] }) {
  const [childId, setChildId] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async (cid = childId) => {
    setLoading(true);
    try {
      const { data } = await api.get("/activity", {
        params: { limit: 60, ...(cid ? { child_id: cid } : {}) },
      });
      setItems(data || []);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [childId]);

  const fmtWhen = (iso) => {
    try {
      return new Date(iso).toLocaleString("id-ID", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
        timeZone: "Asia/Jakarta",
      });
    } catch {
      return iso;
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="font-parent font-bold text-lg text-slate-900 flex items-center gap-2">
          <ScrollText className="w-5 h-5 text-slate-500" /> Log Aktivitas
        </h3>
        <button
          onClick={() => load()}
          className="press-btn p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"
          title="Muat ulang"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      <p className="text-sm text-slate-500 mb-3">
        Catatan urut waktu dari semua yang terjadi — mulai, selesai, tunda, lapor terlambat, hingga hukuman.
      </p>

      <div className="flex flex-wrap gap-1.5 mb-3">
        <button
          onClick={() => setChildId("")}
          className={`press-btn px-3 py-1.5 rounded-xl text-xs font-semibold border-2 ${
            childId === "" ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600"
          }`}
        >
          Semua
        </button>
        {kids.map((k) => (
          <button
            key={k.id}
            onClick={() => setChildId(k.id)}
            className={`press-btn px-3 py-1.5 rounded-xl text-xs font-semibold border-2 ${
              childId === k.id ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600"
            }`}
          >
            {k.avatar_emoji || "🙂"} {k.name}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-slate-400">Memuat…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-slate-400 bg-slate-50 rounded-2xl p-4 text-center">Belum ada aktivitas.</div>
      ) : (
        <div className="max-h-96 overflow-y-auto space-y-1.5 pr-1">
          {items.map((it, i) => {
            const d = describe(it);
            const kid = kids.find((k) => k.id === it.child_id);
            return (
              <div key={it.id || i} className="flex items-start gap-2 border-2 border-slate-100 rounded-xl px-2.5 py-2">
                <span className="text-base shrink-0">{d.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-slate-800">
                    {kid ? `${kid.name} · ` : ""}{d.label}
                  </div>
                  {d.extra && <div className="text-[11px] text-slate-500 truncate">{d.extra}</div>}
                </div>
                <div className="text-[10px] text-slate-400 shrink-0">{fmtWhen(it.created_at)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
