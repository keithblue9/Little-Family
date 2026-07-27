import { useEffect, useState } from "react";
import { Check, X, Clock } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

/**
 * Parent review of kids' late-arrival exception requests. Approving reflows
 * the rest of that day's schedule automatically from the confirmed arrival
 * time (backend shifts every remaining timed task by one shared delta).
 * Self-hides when there's nothing pending.
 */
export default function LateExceptionsReview({ onChanged }) {
  const [requests, setRequests] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get("/late-exceptions");
      setRequests(data.filter((r) => r.status === "pending"));
    } catch { /* non-fatal */ }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (r, action) => {
    setBusyId(r.id);
    try {
      const { data } = await api.post(`/late-exceptions/${r.id}/${action}`);
      if (action === "approve") {
        const s = data.shift_result;
        toast.success(
          s && s.shifted > 0
            ? `Disetujui — ${s.shifted} misi digeser +${s.delta_minutes} menit mulai jam ${r.arrival_time}`
            : "Disetujui — tidak ada jadwal yang perlu digeser"
        );
      } else {
        toast.info("Pengajuan ditolak, jadwal tetap");
      }
      load();
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusyId(null);
    }
  };

  if (requests.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <h3 className="font-parent font-bold text-lg text-slate-900 mb-1 flex items-center gap-2">
        <Clock className="w-5 h-5 text-amber-500" /> Pengajuan Keterlambatan
      </h3>
      <p className="text-sm text-slate-500 mb-4">
        Anak lapor terlambat karena keperluan di luar kuasanya. Kalau disetujui, sisa jadwal hari itu otomatis
        digeser mulai dari jam sampai rumah yang dikonfirmasi.
      </p>
      <div className="space-y-3">
        {requests.map((r) => (
          <div key={r.id} className="border-2 border-amber-100 bg-amber-50/50 rounded-2xl p-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-amber-100 flex items-center justify-center shrink-0 text-xl">🕐</div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-800 text-sm">
                  {r.child_name} · sampai rumah <b className="text-amber-700">{r.arrival_time}</b>
                </div>
                <div className="text-xs text-slate-600 mt-0.5">"{r.reason}"</div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {r.date_key} · diajukan {new Date(r.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2 pl-14">
              <button
                onClick={() => act(r, "approve")}
                disabled={busyId === r.id}
                className="press-btn inline-flex items-center gap-1 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-3 py-1.5 rounded-lg text-sm disabled:opacity-60"
              >
                <Check className="w-4 h-4" strokeWidth={2.5} /> Setujui & Geser Jadwal
              </button>
              <button
                onClick={() => act(r, "reject")}
                disabled={busyId === r.id}
                className="press-btn inline-flex items-center gap-1 border-2 border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold px-3 py-1.5 rounded-lg text-sm disabled:opacity-60"
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
