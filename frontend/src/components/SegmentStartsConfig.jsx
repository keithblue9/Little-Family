import { useEffect, useState } from "react";
import { CalendarClock, Save } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

const DAYS = [
  { i: "0", label: "Sen" }, { i: "1", label: "Sel" }, { i: "2", label: "Rab" },
  { i: "3", label: "Kam" }, { i: "4", label: "Jum" }, { i: "5", label: "Sab" },
  { i: "6", label: "Min" },
];

/**
 * Personal start time per child, per section, per weekday.
 *
 * Siblings genuinely don't share one clock — one gets home from an activity at
 * 18:50 while the other starts at 18:00, and it shifts by weekday. Only the
 * START moves; the section's END stays shared, since "when the day wraps up"
 * is a household rule rather than a personal one.
 *
 * Left blank, a day simply falls back to the section's shared start time, so
 * partial configuration is always safe.
 */
export default function SegmentStartsConfig({ kids = [], onChanged }) {
  const [segments, setSegments] = useState([]);
  const [byChild, setByChild] = useState({}); // childId -> { segId: { day: "HH:MM" } }
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  const load = async () => {
    try {
      const { data: cfg } = await api.get("/config");
      setSegments(cfg.day_segments || []);
      const entries = await Promise.all(
        kids.map(async (k) => {
          try {
            const { data } = await api.get(`/children/${k.id}/segment-starts`);
            return [k.id, data.segment_starts || {}];
          } catch {
            return [k.id, {}];
          }
        })
      );
      setByChild(Object.fromEntries(entries));
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [kids.length]);

  const setVal = (childId, segId, day, value) =>
    setByChild((prev) => ({
      ...prev,
      [childId]: {
        ...(prev[childId] || {}),
        [segId]: { ...((prev[childId] || {})[segId] || {}), [day]: value },
      },
    }));

  const save = async (kid) => {
    setSavingId(kid.id);
    try {
      const { data } = await api.put(`/children/${kid.id}/segment-starts`, {
        starts: byChild[kid.id] || {},
      });
      setByChild((prev) => ({ ...prev, [kid.id]: data.segment_starts || {} }));
      toast.success(`Jam mulai ${kid.name} tersimpan`);
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSavingId(null);
    }
  };

  if (loading) return <div className="text-sm text-slate-400">Memuat…</div>;

  return (
    <div>
      <h3 className="font-parent font-bold text-lg text-slate-900 mb-1 flex items-center gap-2">
        <CalendarClock className="w-5 h-5 text-teal-600" /> Jam Mulai per Anak
      </h3>
      <p className="text-sm text-slate-500 mb-4">
        Atur jam mulai tiap bagian hari untuk masing-masing anak, per hari. Berguna kalau jam pulang ekskul
        berbeda-beda. Dikosongkan = ikut jam bagian yang umum. Jam selesai bagian tetap sama untuk semua.
      </p>

      {kids.length === 0 && <div className="text-sm text-slate-400">Belum ada anak.</div>}

      <div className="space-y-5">
        {kids.map((kid) => (
          <div key={kid.id} className="border-2 border-slate-100 rounded-2xl p-3">
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-base shrink-0"
                style={{ background: `${kid.avatar_color}22` }}
              >
                {kid.avatar_emoji || "🙂"}
              </div>
              <span className="font-semibold text-slate-800 text-sm">{kid.name}</span>
              <button
                onClick={() => save(kid)}
                disabled={savingId === kid.id}
                className="press-btn ml-auto inline-flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white font-semibold px-3 py-1.5 rounded-lg text-xs disabled:opacity-60"
              >
                <Save className="w-3.5 h-3.5" /> {savingId === kid.id ? "Menyimpan…" : "Simpan"}
              </button>
            </div>

            <div className="space-y-3">
              {segments.map((sg) => (
                <div key={sg.id}>
                  <div className="text-xs font-bold text-slate-600 mb-1">
                    {sg.emoji ? `${sg.emoji} ` : ""}{sg.label}
                    <span className="font-normal text-slate-400"> · umum {sg.start_time}–{sg.end_time}</span>
                  </div>
                  <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                    {DAYS.map((d) => (
                      <div key={d.i} className="text-center">
                        <div className="text-[10px] text-slate-400 mb-0.5">{d.label}</div>
                        <input
                          type="time"
                          value={((byChild[kid.id] || {})[sg.id] || {})[d.i] || ""}
                          onChange={(e) => setVal(kid.id, sg.id, d.i, e.target.value)}
                          className="w-full px-1 py-1 rounded-lg border-2 border-slate-200 text-[11px] text-center"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
