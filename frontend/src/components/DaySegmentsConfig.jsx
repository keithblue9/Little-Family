import { useEffect, useState } from "react";
import { LayoutList, Plus, Trash2, Save } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

/**
 * Controls the sections of the child's timeline (Pagi / Siang / Sore / Malam …).
 * Tasks land in a section by their scheduled time, so the ranges must not
 * overlap — the server enforces that too, but catching it here gives a much
 * faster, clearer message than a round-trip.
 */
export default function DaySegmentsConfig({ onChanged }) {
  const [segments, setSegments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get("/config");
      setSegments(data.day_segments || []);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const update = (i, patch) => setSegments((ss) => ss.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const add = () => setSegments((ss) => [...ss, { label: "", emoji: "", start_time: "00:00", end_time: "23:59" }]);
  const remove = (i) => setSegments((ss) => ss.filter((_, idx) => idx !== i));

  const toMin = (t) => {
    const [h, m] = (t || "00:00").split(":").map(Number);
    return h * 60 + m;
  };

  const save = async () => {
    const cleaned = segments
      .map((s) => ({ ...s, label: (s.label || "").trim(), emoji: (s.emoji || "").trim() }))
      .filter((s) => s.label);
    if (cleaned.length === 0) return toast.error("Minimal harus ada satu bagian waktu");
    for (const s of cleaned) {
      if (toMin(s.start_time) > toMin(s.end_time)) {
        return toast.error(`"${s.label}": jam mulai harus sebelum jam selesai`);
      }
    }
    const sorted = [...cleaned].sort((a, b) => toMin(a.start_time) - toMin(b.start_time));
    for (let i = 0; i < sorted.length - 1; i++) {
      if (toMin(sorted[i + 1].start_time) <= toMin(sorted[i].end_time)) {
        return toast.error(`"${sorted[i].label}" dan "${sorted[i + 1].label}" waktunya bertabrakan`);
      }
    }
    setSaving(true);
    try {
      await api.post("/config", { day_segments: cleaned });
      toast.success("Bagian waktu tersimpan");
      load();
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-sm text-slate-400">Memuat…</div>;

  return (
    <div>
      <h3 className="font-parent font-bold text-lg text-slate-900 mb-1 flex items-center gap-2">
        <LayoutList className="w-5 h-5 text-indigo-500" /> Bagian Waktu Timeline
      </h3>
      <p className="text-sm text-slate-500 mb-4">
        Timeline misi anak dibagi ke bagian-bagian ini. Setiap misi masuk ke bagian sesuai jamnya, dan misi bonus
        ikut tersisip di garis waktu yang sama. Misi tanpa jam otomatis masuk grup <b>Kapan Saja</b> di paling akhir.
      </p>

      <div className="space-y-2 mb-3">
        {segments.map((s, i) => (
          <div key={s.id || i} className="rounded-2xl border-2 border-slate-100 p-3">
            <div className="flex items-center gap-2">
              <input
                value={s.emoji || ""}
                onChange={(e) => update(i, { emoji: e.target.value.slice(0, 4) })}
                placeholder="🌅"
                className="w-14 text-center px-2 py-2 rounded-xl border-2 border-slate-200 focus:border-indigo-400 focus:outline-none text-sm"
              />
              <input
                value={s.label}
                onChange={(e) => update(i, { label: e.target.value.slice(0, 40) })}
                placeholder="Nama bagian, mis. Pagi"
                className="flex-1 min-w-0 px-3 py-2 rounded-xl border-2 border-slate-200 focus:border-indigo-400 focus:outline-none text-sm"
              />
              <button
                onClick={() => remove(i)}
                className="press-btn p-2 rounded-lg hover:bg-red-100 text-red-500 shrink-0"
                title="Hapus bagian ini"
              >
                <Trash2 className="w-4 h-4" strokeWidth={2.5} />
              </button>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <label className="text-[11px] font-bold text-slate-500">Dari</label>
              <input
                type="time"
                value={s.start_time}
                onChange={(e) => update(i, { start_time: e.target.value })}
                className="px-2 py-1.5 rounded-xl border-2 border-slate-200 text-sm"
              />
              <label className="text-[11px] font-bold text-slate-500">sampai</label>
              <input
                type="time"
                value={s.end_time}
                onChange={(e) => update(i, { end_time: e.target.value })}
                className="px-2 py-1.5 rounded-xl border-2 border-slate-200 text-sm"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={add}
          className="press-btn inline-flex items-center gap-1.5 border-2 border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold px-3 py-2 rounded-xl text-sm"
        >
          <Plus className="w-4 h-4" /> Tambah Bagian
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="press-btn inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4 py-2 rounded-xl text-sm disabled:opacity-60 ml-auto"
        >
          <Save className="w-4 h-4" /> {saving ? "Menyimpan…" : "Simpan"}
        </button>
      </div>
    </div>
  );
}
