import { useState } from "react";
import { RotateCcw, RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { todayKey, shiftDateKey, humanDateKey } from "@/lib/dates";

/**
 * Two schedule-maintenance actions in one place:
 *
 *  • Segarkan Jadwal — fills in any missing upcoming occurrences of repeating
 *    tasks. Normally automatic; the button exists for when a parent wants to
 *    see it happen immediately.
 *  • Mulai Ulang — clears the accumulated backlog and restarts the routine
 *    from a chosen day. Points, rewards and pet progress are never touched;
 *    only the schedule is rebuilt.
 */
export default function RestartScheduleCard({ onChanged }) {
  const [startDate, setStartDate] = useState(shiftDateKey(todayKey(), 1));
  const [resetStreaks, setResetStreaks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const { data } = await api.post("/tasks/materialize-recurring", null, { params: { days_ahead: 14 } });
      toast.success(
        data.created > 0
          ? `Jadwal disegarkan — ${data.created} misi mendatang ditambahkan`
          : "Jadwal sudah lengkap, tidak ada yang perlu ditambahkan"
      );
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setRefreshing(false);
    }
  };

  const restart = async () => {
    if (!startDate) return toast.error("Pilih tanggal mulai");
    if (!window.confirm(
      `Mulai ulang jadwal dari ${humanDateKey(startDate)}?\n\n` +
      `• SEMUA misi sebelum tanggal itu akan DIHAPUS (yang sudah selesai, terlewat, maupun belum dikerjakan)\n` +
      `• Tugas berulang akan dibuat ulang mulai tanggal tersebut\n` +
      `${resetStreaks ? "• Streak anak direset ke 0\n" : ""}` +
      `\nPoin, hadiah, dan peliharaan TIDAK terpengaruh.\n\nLanjutkan?`
    )) return;
    setBusy(true);
    try {
      const { data } = await api.post("/tasks/restart-schedule", {
        start_date: startDate,
        reset_streaks: resetStreaks,
        clear_pending_requests: true,
        days_ahead: 14,
      });
      toast.success(
        `Jadwal dimulai ulang — ${data.deleted_tasks} misi lama dihapus, ${data.upcoming_created} misi baru disiapkan`
      );
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h3 className="font-parent font-bold text-lg text-slate-900 mb-1 flex items-center gap-2">
        <RotateCcw className="w-5 h-5 text-orange-500" /> Jadwal & Mulai Ulang
      </h3>
      <p className="text-sm text-slate-500 mb-4">
        Tugas berulang otomatis terisi untuk 2 minggu ke depan, jadi jadwal tidak pernah putus walau ada hari
        yang terlewat. Kalau menumpuk terlalu banyak, kamu bisa mulai ulang dari tanggal tertentu.
      </p>

      <button
        onClick={refresh}
        disabled={refreshing}
        className="press-btn inline-flex items-center gap-2 border-2 border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold px-4 py-2 rounded-xl text-sm disabled:opacity-60"
      >
        <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} /> Segarkan Jadwal
      </button>

      <div className="mt-4 bg-orange-50 border-2 border-orange-200 rounded-2xl p-4 max-w-lg">
        <div className="flex items-center gap-2 text-orange-800 font-bold text-sm mb-2">
          <AlertTriangle className="w-4 h-4" /> Mulai Ulang Jadwal
        </div>
        <label className="text-xs font-bold text-slate-600 block mb-1">Mulai bersih dari tanggal</label>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border-2 border-orange-200 text-sm bg-white"
        />
        <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={resetStreaks}
            onChange={(e) => setResetStreaks(e.target.checked)}
            className="w-4 h-4 accent-orange-500"
          />
          <span className="text-sm text-slate-700">Reset juga streak anak ke 0</span>
        </label>
        <p className="text-[11px] text-orange-700 mt-2">
          Semua misi sebelum tanggal tersebut dihapus permanen. Poin, hadiah, dan peliharaan tetap aman.
        </p>
        <button
          onClick={restart}
          disabled={busy}
          className="mt-3 press-btn inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold px-4 py-2 rounded-xl text-sm disabled:opacity-60"
        >
          <RotateCcw className="w-4 h-4" /> {busy ? "Memproses…" : "Mulai Ulang Sekarang"}
        </button>
      </div>
    </div>
  );
}
