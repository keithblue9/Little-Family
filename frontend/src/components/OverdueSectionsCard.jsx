import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { humanDateKey, todayKey } from "@/lib/dates";

/**
 * Sections whose finish time passed with the list unfinished. Nothing is
 * penalised automatically — the parent decides here: record the leftovers as
 * missed (each mission's own penalty applies), or let it go.
 */
export default function OverdueSectionsCard({ onChanged }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/family/overdue-sections", { fresh: true });
      setRows(data.sections || []);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const resolve = async (r, action, taskIds) => {
    const key = `${r.child_id}:${r.date_key}:${r.segment_id}`;
    setBusy(key);
    try {
      const { data } = await api.post("/family/overdue-sections/resolve", {
        child_id: r.child_id, date_key: r.date_key, segment_id: r.segment_id, action,
        ...(taskIds ? { task_ids: taskIds } : {}),
      });
      toast.success(action === "miss"
        ? `${data.missed} tugas dicatat terlewat${data.penalty ? ` (−${data.penalty} poin)` : ""}`
        : "Dibiarkan — tidak ada perubahan");
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(null);
    }
  };

  if (!rows || rows.length === 0) return null;

  return (
    <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-amber-600" />
        <div className="font-parent font-bold text-slate-900">Perlu keputusanmu</div>
        <span className="ml-auto text-xs font-bold bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full">{rows.length}</span>
      </div>
      <p className="text-xs text-amber-800">
        Bagian ini sudah lewat jam selesainya tapi belum dituntaskan. Tidak ada hukuman otomatis — kamu yang memutuskan.
      </p>
      {rows.map((r) => {
        const key = `${r.child_id}:${r.date_key}:${r.segment_id}`;
        const penalty = r.left.reduce((n, t) => n + (t.penalty_points || 0), 0);
        return (
          <div key={key} className="bg-white rounded-xl border border-amber-100 p-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg" aria-hidden="true">{r.avatar_emoji || "🙂"}</span>
              <span className="font-semibold text-slate-800 text-sm">{r.child_name}</span>
              <span className="text-sm text-slate-600">· {r.emoji} {r.label}</span>
              <span className="text-xs text-slate-400">
                {r.date_key !== todayKey() ? `${humanDateKey(r.date_key)} · ` : ""}batas {r.end_time}
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {r.started ? `${r.left.length} dari ${r.total} tugas belum dicentang` : "Belum dimulai sama sekali"}
            </div>
            {r.left.length > 0 && (
              <ul className="mt-2 space-y-1">
                {r.left.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                    <span className="flex-1 min-w-0 truncate">{t.title}</span>
                    {t.penalty_points > 0 && <span className="text-[11px] text-red-500">−{t.penalty_points}</span>}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2 mt-3 flex-wrap">
              <button
                onClick={() => resolve(r, "miss")}
                disabled={busy === key || r.left.length === 0}
                className="press-btn inline-flex items-center gap-1.5 bg-red-500 hover:bg-red-600 text-white font-semibold px-3 py-1.5 rounded-lg text-xs disabled:opacity-50"
              >
                <X className="w-3.5 h-3.5" /> Catat terlewat{penalty ? ` (−${penalty})` : ""}
              </button>
              <button
                onClick={() => resolve(r, "dismiss")}
                disabled={busy === key}
                className="press-btn inline-flex items-center gap-1.5 bg-white border-2 border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold px-3 py-1.5 rounded-lg text-xs disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" /> Biarkan
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
