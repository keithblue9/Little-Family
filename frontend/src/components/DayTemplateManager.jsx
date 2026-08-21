import { useEffect, useMemo, useState } from "react";
import { LayoutTemplate, Plus, Trash2, Copy, Star, ChevronLeft, ChevronRight, X, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { todayKey } from "@/lib/dates";

const WEEKDAYS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli",
  "Agustus", "September", "Oktober", "November", "Desember"];

/**
 * Routines are defined once per KIND of day — "Hari Biasa", "Tanggal Merah" —
 * broken down by weekday and section. Real dates then simply point at one.
 *
 * The old way meant rebuilding a day mission by mission whenever a public
 * holiday landed on a Monday. Here that's one tap on the calendar: pick the
 * template, pick the date. Normal days fall back to whichever template is
 * marked as the default, so only the exceptions need any attention at all.
 */
export default function DayTemplateManager({ kids = [], onChanged }) {
  const [templates, setTemplates] = useState([]);
  const [segments, setSegments] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [slots, setSlots] = useState([]);
  const [weekday, setWeekday] = useState(0);
  const [assignments, setAssignments] = useState({});
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [paintId, setPaintId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const monthRange = useMemo(() => {
    const first = new Date(month.y, month.m, 1);
    const last = new Date(month.y, month.m + 1, 0);
    const fmt = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { start: fmt(first), end: fmt(last), first, last };
  }, [month]);

  const loadTemplates = async () => {
    try {
      const [{ data: tpl }, { data: cfg }] = await Promise.all([
        api.get("/day-templates"),
        api.get("/config"),
      ]);
      setTemplates(tpl || []);
      setSegments(cfg.day_segments || []);
      if (!activeId && tpl?.length) setActiveId(tpl[0].id);
      if (!paintId && tpl?.length) setPaintId(tpl[0].id);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadTemplates(); }, []);

  const loadSlots = async (tid) => {
    if (!tid) return setSlots([]);
    try {
      const { data } = await api.get("/template-tasks", { params: { template_id: tid } });
      setSlots(data || []);
    } catch { setSlots([]); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadSlots(activeId); }, [activeId]);

  const loadAssignments = async () => {
    try {
      const { data } = await api.get("/template-assignments", {
        params: { start_date: monthRange.start, end_date: monthRange.end },
      });
      setAssignments(Object.fromEntries((data || []).map((a) => [a.date_key, a.template_id])));
    } catch { setAssignments({}); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadAssignments(); }, [monthRange.start]);

  // Downloads through the browser rather than an <a href>, so the request
  // still carries the auth header the API expects.
  const exportXlsx = async (params, label) => {
    try {
      const res = await api.get("/export/weekly-xlsx", { params, responseType: "blob" });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `jadwal-${label}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("File Excel diunduh");
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const addTemplate = async () => {
    const name = window.prompt("Nama jenis hari?\n\nMis. Hari Biasa, Tanggal Merah, Libur Sekolah");
    if (!name?.trim()) return;
    try {
      const { data } = await api.post("/day-templates", {
        name: name.trim(), emoji: "", is_default: templates.length === 0,
      });
      toast.success(`Template "${data.name}" dibuat`);
      setActiveId(data.id);
      loadTemplates();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const makeDefault = async (t) => {
    try {
      await api.patch(`/day-templates/${t.id}`, {
        name: t.name, emoji: t.emoji || "", description: t.description || "", is_default: true,
      });
      toast.success(`"${t.name}" jadi template harian biasa`);
      loadTemplates();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const duplicate = async (t) => {
    try {
      const { data } = await api.post(`/day-templates/${t.id}/duplicate`);
      toast.success(`Disalin jadi "${data.name}"`);
      setActiveId(data.id);
      loadTemplates();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const removeTemplate = async (t) => {
    if (!window.confirm(
      `Hapus template "${t.name}"?\n\nSemua slot di dalamnya ikut terhapus. Misi yang sudah terlanjur dibuat di kalender tetap aman.`
    )) return;
    try {
      await api.delete(`/day-templates/${t.id}`);
      toast.success("Template dihapus");
      setActiveId("");
      loadTemplates();
      loadAssignments();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const addSlot = async () => {
    if (!activeId) return;
    const title = window.prompt(`Nama misi untuk ${WEEKDAYS[weekday]}?`);
    if (!title?.trim()) return;
    try {
      await api.post("/template-tasks", {
        template_id: activeId, weekday, segment_id: segments[0]?.id || null,
        title: title.trim(), points: 10, duration_minutes: 10,
      });
      loadSlots(activeId);
      loadTemplates();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const patchSlot = async (slot, patch) => {
    try {
      await api.patch(`/template-tasks/${slot.id}`, patch);
      loadSlots(activeId);
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const removeSlot = async (slot) => {
    try {
      await api.delete(`/template-tasks/${slot.id}`);
      loadSlots(activeId);
      loadTemplates();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const paintDate = async (dateKey) => {
    if (!paintId) return toast.error("Pilih dulu template yang mau ditempel");
    setBusy(true);
    try {
      const { data } = await api.post("/template-assignments", {
        template_id: paintId, start_date: dateKey, replace_existing: true,
      });
      toast.success(`${data.template_name} → ${dateKey} (${data.created} misi)`);
      loadAssignments();
      onChanged?.();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  const clearDate = async (dateKey) => {
    if (!window.confirm(`Lepas template dari ${dateKey}?\n\nMisi yang belum dikerjakan pada hari itu akan dihapus.`)) return;
    setBusy(true);
    try {
      const { data } = await api.delete(`/template-assignments/${dateKey}`);
      toast.success(`Dilepas — ${data.removed_tasks} misi dibersihkan`);
      loadAssignments();
      onChanged?.();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  const tplById = (id) => templates.find((t) => t.id === id);
  const slotsForDay = slots.filter((s) => s.weekday === weekday);
  const segLabel = (id) => segments.find((sg) => sg.id === id)?.label || "Kapan saja";

  // Monday-first grid, matching how the weekday tabs read.
  const grid = useMemo(() => {
    const cells = [];
    const lead = (monthRange.first.getDay() + 6) % 7;
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= monthRange.last.getDate(); d++) {
      const dt = new Date(month.y, month.m, d);
      cells.push({
        day: d,
        key: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      });
    }
    return cells;
  }, [month, monthRange]);

  if (loading) return <div className="text-sm text-slate-400">Memuat…</div>;

  return (
    <div>
      <h3 className="font-parent font-bold text-lg text-slate-900 mb-1 flex items-center gap-2">
        <LayoutTemplate className="w-5 h-5 text-indigo-600" /> Template Hari
      </h3>
      <p className="text-sm text-slate-500 mb-4">
        Susun rutinitas sekali per <b>jenis hari</b> (Hari Biasa, Tanggal Merah, dst), lengkap per hari dan per
        bagian waktu. Lalu tinggal tempel ke tanggal di kalender — tidak perlu lagi mengatur tugas satu per satu
        tiap ada hari libur.
      </p>

      {/* Templates */}
      <div className="flex flex-wrap gap-2 mb-4">
        {templates.map((t) => (
          <div
            key={t.id}
            className={`rounded-2xl border-2 px-3 py-2 flex items-center gap-2 ${
              activeId === t.id ? "border-indigo-300 bg-indigo-50" : "border-slate-200"
            }`}
          >
            <button onClick={() => setActiveId(t.id)} className="press-btn text-left">
              <div className="font-semibold text-sm text-slate-800 flex items-center gap-1">
                {t.emoji} {t.name}
                {t.is_default && <Star className="w-3.5 h-3.5 text-amber-500" fill="currentColor" />}
              </div>
              <div className="text-[11px] text-slate-400">{t.task_count} misi</div>
            </button>
            <div className="flex items-center gap-0.5">
              {!t.is_default && (
                <button onClick={() => makeDefault(t)} className="press-btn p-1 rounded hover:bg-amber-100 text-amber-500"
                        title="Jadikan template harian biasa">
                  <Star className="w-3.5 h-3.5" />
                </button>
              )}
              <button onClick={() => duplicate(t)} className="press-btn p-1 rounded hover:bg-slate-100 text-slate-400" title="Salin">
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => removeTemplate(t)} className="press-btn p-1 rounded hover:bg-red-100 text-red-500" title="Hapus">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
        {activeId && (
          <button
            onClick={() => exportXlsx({ template_id: activeId }, tplById(activeId)?.name || "template")}
            className="press-btn rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-100 flex items-center gap-1"
            title="Unduh rutinitas Senin–Minggu template ini sebagai Excel"
          >
            <FileSpreadsheet className="w-4 h-4" /> Export Excel
          </button>
        )}
        <button
          onClick={addTemplate}
          className="press-btn rounded-2xl border-2 border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 flex items-center gap-1"
        >
          <Plus className="w-4 h-4" /> Jenis hari baru
        </button>
      </div>

      {/* Slots for the selected template */}
      {activeId && (
        <div className="border-2 border-slate-100 rounded-2xl p-3 mb-5">
          <div className="flex flex-wrap gap-1 mb-3">
            {WEEKDAYS.map((w, i) => {
              const count = slots.filter((s) => s.weekday === i).length;
              return (
                <button
                  key={w}
                  onClick={() => setWeekday(i)}
                  className={`press-btn px-2.5 py-1.5 rounded-xl text-xs font-semibold border-2 ${
                    weekday === i ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600"
                  }`}
                >
                  {w}{count ? ` · ${count}` : ""}
                </button>
              );
            })}
          </div>

          <div className="space-y-1.5">
            {slotsForDay.length === 0 && (
              <div className="text-xs text-slate-400 py-2">Belum ada misi untuk {WEEKDAYS[weekday]}.</div>
            )}
            {slotsForDay.map((sl) => (
              <div key={sl.id} className="flex flex-wrap items-center gap-1.5 border-2 border-slate-100 rounded-xl px-2 py-1.5">
                <input
                  defaultValue={sl.title}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== sl.title && patchSlot(sl, { title: e.target.value.trim() })}
                  className="flex-1 min-w-[8rem] px-2 py-1 rounded-lg border border-slate-200 text-xs"
                />
                <select
                  value={sl.segment_id || ""}
                  onChange={(e) => patchSlot(sl, { segment_id: e.target.value || null })}
                  className="px-1.5 py-1 rounded-lg border border-slate-200 text-[11px] bg-white"
                  title="Bagian hari"
                >
                  <option value="">Kapan saja</option>
                  {segments.map((sg) => <option key={sg.id} value={sg.id}>{sg.label}</option>)}
                </select>
                <select
                  value={sl.child_id || ""}
                  onChange={(e) => patchSlot(sl, { child_id: e.target.value || null })}
                  className="px-1.5 py-1 rounded-lg border border-slate-200 text-[11px] bg-white"
                  title="Untuk siapa"
                >
                  <option value="">Semua anak</option>
                  {kids.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                </select>
                <input
                  type="text" inputMode="numeric" defaultValue={sl.points} title="Poin"
                  onBlur={(e) => patchSlot(sl, { points: parseInt(e.target.value || "0", 10) })}
                  className="w-12 px-1 py-1 rounded-lg border border-slate-200 text-[11px] text-center"
                />
                <input
                  type="text" inputMode="numeric" defaultValue={sl.duration_minutes || ""} title="Durasi (menit)"
                  onBlur={(e) => patchSlot(sl, { duration_minutes: e.target.value ? parseInt(e.target.value, 10) : null })}
                  className="w-12 px-1 py-1 rounded-lg border border-slate-200 text-[11px] text-center"
                  placeholder="m"
                />
                <label className="flex items-center gap-1 text-[10px] text-slate-500 cursor-pointer" title="Misi bonus">
                  <input type="checkbox" checked={!!sl.is_bonus}
                         onChange={(e) => patchSlot(sl, { is_bonus: e.target.checked })}
                         className="w-3.5 h-3.5 accent-amber-500" />
                  bonus
                </label>
                <button onClick={() => removeSlot(sl)} className="press-btn p-1 rounded hover:bg-red-100 text-red-500">
                  <Trash2 className="w-3.5 h-3.5" strokeWidth={2.5} />
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={addSlot}
            className="press-btn mt-2 inline-flex items-center gap-1.5 border-2 border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold px-3 py-1.5 rounded-xl text-xs"
          >
            <Plus className="w-3.5 h-3.5" /> Tambah misi ke {WEEKDAYS[weekday]}
          </button>
          <p className="text-[11px] text-slate-400 mt-2">
            Urutan mengikuti posisi di daftar ini. Ubah nilainya lalu klik di luar kolom untuk menyimpan.
          </p>
        </div>
      )}

      {/* Calendar */}
      <div className="border-2 border-slate-100 rounded-2xl p-3">
        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => setMonth((m) => (m.m === 0 ? { y: m.y - 1, m: 11 } : { ...m, m: m.m - 1 }))}
                  className="press-btn p-1.5 rounded-lg border-2 border-slate-200 text-slate-500">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="font-semibold text-sm text-slate-800">{MONTHS[month.m]} {month.y}</div>
          <button onClick={() => setMonth((m) => (m.m === 11 ? { y: m.y + 1, m: 0 } : { ...m, m: m.m + 1 }))}
                  className="press-btn p-1.5 rounded-lg border-2 border-slate-200 text-slate-500">
            <ChevronRight className="w-4 h-4" />
          </button>
          <select
            value={paintId}
            onChange={(e) => setPaintId(e.target.value)}
            className="ml-auto px-2 py-1.5 rounded-xl border-2 border-indigo-200 text-xs bg-white"
          >
            {templates.map((t) => <option key={t.id} value={t.id}>{t.emoji} {t.name}</option>)}
          </select>
        </div>
        <p className="text-[11px] text-slate-500 mb-2">
          Pilih template di atas, lalu ketuk tanggalnya untuk menempel. Ketuk ✕ pada tanggal untuk melepas.
        </p>

        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((w) => (
            <div key={w} className="text-[10px] text-slate-400 text-center font-semibold">{w.slice(0, 3)}</div>
          ))}
          {grid.map((cell, i) => {
            if (!cell) return <div key={`e${i}`} />;
            const tid = assignments[cell.key];
            const tpl = tid ? tplById(tid) : null;
            const isToday = cell.key === todayKey();
            return (
              <div
                key={cell.key}
                className={`relative rounded-xl border-2 p-1 min-h-[3.2rem] ${
                  tpl ? "border-indigo-200 bg-indigo-50" : "border-slate-100"
                } ${isToday ? "ring-2 ring-amber-300" : ""}`}
              >
                <button
                  onClick={() => paintDate(cell.key)}
                  disabled={busy}
                  className="press-btn w-full text-left disabled:opacity-60"
                  title={tpl ? `Ganti ke template terpilih` : "Tempel template terpilih"}
                >
                  <div className="text-[11px] font-semibold text-slate-700">{cell.day}</div>
                  {tpl && (
                    <div className="text-[9px] text-indigo-700 leading-tight truncate">
                      {tpl.emoji} {tpl.name}
                    </div>
                  )}
                </button>
                {tpl && (
                  <button
                    onClick={() => clearDate(cell.key)}
                    disabled={busy}
                    className="press-btn absolute top-0.5 right-0.5 p-0.5 rounded text-slate-400 hover:text-red-500 hover:bg-white"
                    title="Lepas template dari tanggal ini"
                  >
                    <X className="w-3 h-3" strokeWidth={3} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-slate-400 mt-2">
          Tanggal tanpa template otomatis memakai template bertanda ⭐ (harian biasa).
        </p>
        <button
          onClick={() => exportXlsx({ start_date: monthRange.start }, "minggu-ini")}
          className="press-btn mt-2 inline-flex items-center gap-1.5 border-2 border-emerald-200 bg-emerald-50 text-emerald-700 font-semibold px-3 py-1.5 rounded-xl text-xs hover:bg-emerald-100"
        >
          <FileSpreadsheet className="w-3.5 h-3.5" /> Export jadwal nyata (Senin–Minggu)
        </button>
      </div>
    </div>
  );
}
