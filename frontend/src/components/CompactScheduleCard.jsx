import { useState } from "react";
import { Sparkles, Undo2 } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

/**
 * "Rapikan Jadwal" — removes the untouched copies of future days that older
 * versions of the app built two weeks ahead. Days are now built when they're
 * needed, so these copies only weigh the database down. Only copies that would
 * be rebuilt exactly the same are removed; anything edited, started or done is
 * kept. Everything removed is archived and can be put back.
 */
export default function CompactScheduleCard({ onChanged }) {
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lastBatch, setLastBatch] = useState(null);

  const check = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/maintenance/compact-schedule", null, { params: { dry_run: true } });
      setPreview(data);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/maintenance/compact-schedule", null, { params: { dry_run: false } });
      toast.success(`${data.removed} salinan dirapikan dari ${data.days.length} hari`);
      setLastBatch(data.archive_batch || null);
      setPreview(null);
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!lastBatch) return;
    setBusy(true);
    try {
      const { data } = await api.post("/tasks/undo-restart", null, { params: { archive_batch: lastBatch } });
      toast.success(`${data.restored_tasks} misi dikembalikan`);
      setLastBatch(null);
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h3 className="font-parent font-bold text-lg text-slate-900 flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-indigo-500" /> Rapikan Jadwal
      </h3>
      <p className="text-sm text-slate-500 mt-1">
        Hari-hari ke depan sekarang disiapkan otomatis saat dibutuhkan. Salinan lama yang dibuat
        dua minggu di muka dan belum disentuh bisa dirapikan supaya aplikasi lebih ringan.
        Misi yang sudah diubah, dimulai, atau selesai tidak disentuh.
      </p>
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button
          onClick={check}
          disabled={busy}
          className="press-btn px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm disabled:opacity-50"
        >
          Cek dulu
        </button>
        {preview && preview.removable_tasks > 0 && (
          <button
            onClick={run}
            disabled={busy}
            className="press-btn px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-semibold text-sm disabled:opacity-50"
          >
            Rapikan {preview.removable_tasks} salinan
          </button>
        )}
        {lastBatch && (
          <button
            onClick={undo}
            disabled={busy}
            className="press-btn px-4 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 font-semibold text-sm flex items-center gap-1.5 disabled:opacity-50"
          >
            <Undo2 className="w-4 h-4" /> Batalkan
          </button>
        )}
      </div>
      {preview && (
        <div className="text-sm mt-2 text-slate-600">
          {preview.removable_tasks > 0
            ? `${preview.removable_tasks} salinan di ${preview.days.length} hari bisa dirapikan.`
            : "Sudah rapi — tidak ada salinan yang perlu dihapus. ✨"}
        </div>
      )}
    </div>
  );
}
