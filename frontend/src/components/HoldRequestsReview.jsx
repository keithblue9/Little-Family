import { useEffect, useState } from "react";
import { PauseCircle, Check, X } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

/**
 * Missions a child has asked to put on hold — guests turning up, being taken
 * out to eat. Approving stops that mission's clock entirely until they start
 * it, so there's no rush to get home by a particular minute. Self-hides when
 * nothing is waiting.
 */
export default function HoldRequestsReview({ onChanged }) {
  const [items, setItems] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get("/hold-requests");
      setItems(data || []);
    } catch { /* non-fatal */ }
  };
  useEffect(() => { load(); }, []);

  const act = async (task, action) => {
    setBusyId(task.id);
    try {
      await api.post(`/tasks/${task.id}/hold-${action}`);
      toast.success(
        action === "approve"
          ? `"${task.title}" ditahan — anak bisa mulai kapan saja`
          : "Permintaan tunda ditolak"
      );
      load();
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusyId(null);
    }
  };

  if (items.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <h3 className="font-parent font-bold text-lg text-slate-900 mb-1 flex items-center gap-2">
        <PauseCircle className="w-5 h-5 text-sky-500" /> Minta Tunda Misi
      </h3>
      <p className="text-sm text-slate-500 mb-4">
        Ada halangan mendadak. Kalau disetujui, waktu misi ini berhenti dulu — anak boleh memulainya kapan saja
        setelah urusannya selesai, tanpa dianggap terlambat.
      </p>
      <div className="space-y-3">
        {items.map((t) => (
          <div key={t.id} className="border-2 border-sky-100 bg-sky-50/50 rounded-2xl p-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-sky-100 flex items-center justify-center shrink-0 text-lg">
                ⏸️
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-800 text-sm">{t.title}</div>
                <div className="text-xs text-slate-600 mt-0.5">"{t.hold_reason}"</div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  diminta {t.hold_requested_by || "anak"}
                  {t.hold_requested_at
                    ? ` · ${new Date(t.hold_requested_at).toLocaleTimeString("id-ID", {
                        hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
                      })}`
                    : ""}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2 pl-13">
              <button
                onClick={() => act(t, "approve")}
                disabled={busyId === t.id}
                className="press-btn inline-flex items-center gap-1 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-3 py-1.5 rounded-lg text-sm disabled:opacity-60"
              >
                <Check className="w-4 h-4" strokeWidth={2.5} /> Izinkan Tunda
              </button>
              <button
                onClick={() => act(t, "reject")}
                disabled={busyId === t.id}
                className="press-btn inline-flex items-center gap-1 border-2 border-slate-200 text-slate-600 hover:bg-white font-semibold px-3 py-1.5 rounded-lg text-sm disabled:opacity-60"
              >
                <X className="w-4 h-4" strokeWidth={2.5} /> Tolak
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
