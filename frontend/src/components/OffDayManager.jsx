import { useEffect, useState } from "react";
import { Umbrella, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { todayKey, humanDateKey } from "@/lib/dates";

/**
 * Parent-declared "off days": one date or a range where all tasks are paused —
 * parked tasks disappear from the kids' quest line (no penalties), recurrence
 * skips over the range, and streaks bridge across it. Deleting an off-day
 * restores exactly the tasks it parked.
 */
export default function OffDayManager() {
  const [items, setItems] = useState([]);
  const [startDate, setStartDate] = useState(todayKey());
  const [multi, setMulti] = useState(false);
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get("/off-days");
      setItems(data);
    } catch { /* non-fatal */ }
  };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!startDate) return toast.error("Pilih tanggal mulai");
    if (multi && !endDate) return toast.error("Pilih tanggal akhir (s/d)");
    setSaving(true);
    try {
      const { data } = await api.post("/off-days", {
        start_date: startDate,
        end_date: multi ? endDate : startDate,
        note: note.trim(),
      });
      toast.success(`Hari libur dibuat — ${data.parked_tasks} misi dijeda sementara`);
      setNote(""); setMulti(false); setEndDate("");
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const del = async (o) => {
    if (!window.confirm(
      `Hapus hari libur ${o.start_date}${o.end_date !== o.start_date ? ` s/d ${o.end_date}` : ""}?\n\nMisi yang tadinya dijeda akan aktif kembali.`
    )) return;
    try {
      const { data } = await api.delete(`/off-days/${o.id}`);
      toast.success(`Hari libur dihapus — ${data.restored_tasks} misi aktif kembali`);
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const fmtRange = (o) =>
    o.start_date === o.end_date ? humanDateKey(o.start_date) : `${humanDateKey(o.start_date)} s/d ${humanDateKey(o.end_date)}`;

  return (
    <div>
      <h3 className="font-parent font-bold text-lg text-slate-900 mb-1 flex items-center gap-2">
        <Umbrella className="w-5 h-5 text-sky-500" /> Hari Libur Tugas (Off Day)
      </h3>
      <p className="text-sm text-slate-500 mb-4">
        Ada acara keluarga? Liburkan tugas di hari itu — misi dijeda (tanpa penalti), tugas berulang otomatis
        melompati harinya, dan streak anak tetap nyambung. Bisa dibatalkan kapan saja.
      </p>

      <div className="bg-sky-50 border-2 border-sky-100 rounded-2xl p-4 max-w-lg">
        <label className="text-xs font-bold text-slate-500 block mb-1">Tanggal libur</label>
        <input
          type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border-2 border-sky-200 text-sm bg-white"
        />
        <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
          <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} className="w-4 h-4 accent-sky-500" />
          <span className="text-sm font-semibold text-slate-700">Lebih dari 1 hari</span>
        </label>
        {multi && (
          <div className="mt-2">
            <label className="text-xs font-bold text-slate-500 block mb-1">Sampai dengan (s/d)</label>
            <input
              type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border-2 border-sky-200 text-sm bg-white"
            />
          </div>
        )}
        <input
          value={note} onChange={(e) => setNote(e.target.value.slice(0, 100))}
          placeholder="Catatan (opsional), mis. Jalan-jalan keluarga"
          className="w-full mt-3 px-3 py-2 rounded-xl border-2 border-sky-200 text-sm bg-white"
        />
        <button
          onClick={submit}
          disabled={saving}
          className="mt-3 press-btn inline-flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white font-semibold px-4 py-2 rounded-xl text-sm disabled:opacity-60"
        >
          <Umbrella className="w-4 h-4" /> {saving ? "Menyimpan…" : "Liburkan Hari Ini/Ini Saja"}
        </button>
      </div>

      {items.length > 0 && (
        <div className="mt-4 space-y-2 max-w-lg">
          {items.map((o) => (
            <div key={o.id} className="flex items-center gap-3 border-2 border-slate-100 rounded-2xl px-3 py-2.5">
              <div className="text-xl shrink-0">🏖️</div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-800 text-sm truncate">{fmtRange(o)}</div>
                <div className="text-[11px] text-slate-400">
                  {o.note ? `"${o.note}" · ` : ""}dibuat {o.created_by_name || "orang tua"}
                </div>
              </div>
              <button
                onClick={() => del(o)}
                className="press-btn p-1.5 rounded-lg hover:bg-red-50 text-red-500 shrink-0"
                title="Hapus hari libur (misi aktif kembali)"
              >
                <Trash2 className="w-4 h-4" strokeWidth={2.5} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
