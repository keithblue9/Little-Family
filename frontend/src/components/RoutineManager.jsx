import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronUp, ChevronDown, Trash2, Plus, Copy, RefreshCw, CalendarOff, Repeat, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { todayKey, humanDateKey } from "@/lib/dates";

const DAYS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];
const ANYTIME = "__anytime__";
const toMin = (hhmm) => { const [h, m] = (hhmm || "0:0").split(":").map(Number); return h * 60 + m; };
const todayWeekday = () => (new Date().getDay() + 6) % 7; // Monday = 0

/**
 * The whole schedule in one place: a week of sections, each a short checklist.
 * Set it once; every week repeats it. Dates that differ are handled below as
 * exceptions, so the routine itself never has to be edited for a one-off.
 */
export default function RoutineManager({ kids = [], onChanged }) {
  const [data, setData] = useState(null);
  const [weekday, setWeekday] = useState(todayWeekday());
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyTo, setCopyTo] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: d } = await api.get("/routine");
      setData(d);
      if (d.migrated && d.migrated.slots > 0) {
        toast.success(`${d.migrated.slots} aktivitas dari jadwal lama sudah dipindahkan ke rutinitas mingguan.`);
      }
    } catch (e) { toast.error(formatApiError(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const segments = useMemo(() => [...(data?.segments || []), { id: ANYTIME, label: "Kapan Saja", emoji: "✨" }], [data]);
  const daySlots = useMemo(() => (data?.slots || []).filter((s) => s.weekday === weekday), [data, weekday]);
  const countFor = (wd) => (data?.slots || []).filter((s) => s.weekday === wd).length;

  const run = async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); if (okMsg) toast.success(okMsg); await load(); onChanged?.(); }
    catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  const patch = (slot, body) => run(() => api.patch(`/routine/slots/${slot.id}`, body));
  const move = (slot, direction) => run(() => api.post(`/routine/slots/${slot.id}/move`, { direction }));
  const remove = (slot) => {
    if (!window.confirm(`Hapus "${slot.title}" dari ${DAYS[slot.weekday]}?`)) return;
    run(() => api.delete(`/routine/slots/${slot.id}`), "Aktivitas dihapus");
  };
  const copyDay = () => run(async () => {
    await api.post("/routine/copy-day", { from_weekday: weekday, to_weekdays: copyTo, replace: true });
    setCopyOpen(false); setCopyTo([]);
  }, `Jadwal ${DAYS[weekday]} disalin`);
  const applyToday = () => {
    if (!window.confirm("Terapkan rutinitas terbaru ke hari ini juga?\n\nBagian yang sudah dimulai anak tidak akan diubah.")) return;
    run(() => api.post("/routine/apply-today"), "Hari ini sudah memakai rutinitas terbaru");
  };

  if (!data) return <div className="text-sm text-slate-400 py-6">Memuat rutinitas…</div>;

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
          <div>
            <h2 className="font-parent font-bold text-xl text-slate-900">📋 Rutinitas Mingguan</h2>
            <p className="text-sm text-slate-500">
              Atur sekali, berulang tiap minggu. Pilih hari, lalu isi aktivitas di tiap bagian.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setCopyOpen((v) => !v)} disabled={busy}
              className="press-btn inline-flex items-center gap-1.5 border-2 border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold px-3 py-2 rounded-xl text-sm">
              <Copy className="w-4 h-4" /> Salin {DAYS[weekday]} ke…
            </button>
            <button onClick={applyToday} disabled={busy}
              className="press-btn inline-flex items-center gap-1.5 border-2 border-indigo-200 bg-indigo-50 text-indigo-700 font-semibold px-3 py-2 rounded-xl text-sm">
              <RefreshCw className="w-4 h-4" /> Terapkan ke hari ini
            </button>
          </div>
        </div>
        <p className="text-[11px] text-slate-400 mb-4">
          Perubahan berlaku mulai besok. Tekan <b>Terapkan ke hari ini</b> kalau ingin langsung dipakai hari ini.
        </p>

        {copyOpen && (
          <div className="border-2 border-slate-100 rounded-2xl p-3 mb-4 bg-slate-50">
            <div className="text-sm font-semibold text-slate-700 mb-2">
              Salin seluruh jadwal {DAYS[weekday]} ke hari: <span className="font-normal text-slate-500">(jadwal hari tujuan akan diganti)</span>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {DAYS.map((d, i) => i === weekday ? null : (
                <button key={d} onClick={() => setCopyTo((v) => v.includes(i) ? v.filter((x) => x !== i) : [...v, i])}
                  className={`press-btn px-3 py-1.5 rounded-xl text-xs font-semibold border-2 ${
                    copyTo.includes(i) ? "border-indigo-400 bg-indigo-500 text-white" : "border-slate-200 bg-white text-slate-600"}`}>
                  {d}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={copyDay} disabled={busy || copyTo.length === 0}
                className="press-btn bg-indigo-600 text-white font-semibold px-4 py-2 rounded-xl text-sm disabled:opacity-50">Salin</button>
              <button onClick={() => { setCopyOpen(false); setCopyTo([]); }}
                className="press-btn border-2 border-slate-200 text-slate-600 font-semibold px-4 py-2 rounded-xl text-sm">Batal</button>
            </div>
          </div>
        )}

        {/* Weekday tabs */}
        <div className="grid grid-cols-7 gap-1.5 mb-5">
          {DAYS.map((d, i) => (
            <button key={d} onClick={() => setWeekday(i)}
              className={`press-btn py-2 rounded-xl text-xs sm:text-sm font-bold border-2 ${
                weekday === i ? "border-indigo-500 bg-indigo-500 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
              <div>{d.slice(0, 3)}</div>
              <div className={`text-[10px] font-semibold ${weekday === i ? "text-indigo-100" : "text-slate-400"}`}>{countFor(i)} aktivitas</div>
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {segments.map((sg) => (
            <SegmentCard key={sg.id} segment={sg} weekday={weekday} kids={kids} busy={busy}
              slots={daySlots.filter((s) => (s.segment_id || ANYTIME) === sg.id)}
              onAdd={(body) => run(() => api.post("/routine/slots", {
                weekdays: [weekday], segment_id: sg.id === ANYTIME ? null : sg.id, ...body }))}
              onPatch={patch} onMove={move} onRemove={remove} />
          ))}
        </div>
      </div>

      <ExceptionsPanel kids={kids} segments={data.segments || []} onChanged={onChanged} />
    </div>
  );
}

function SegmentCard({ segment, slots, kids, busy, onAdd, onPatch, onMove, onRemove }) {
  const [title, setTitle] = useState("");
  const [dur, setDur] = useState("");
  const [pts, setPts] = useState("10");
  const [who, setWho] = useState("");
  const window_ = segment.start_time ? toMin(segment.end_time) - toMin(segment.start_time) : null;
  const total = slots.reduce((n, s) => n + (s.duration_minutes || 0), 0);
  const over = window_ != null && total > window_;

  const add = () => {
    if (!title.trim()) return toast.error("Isi nama aktivitasnya dulu");
    onAdd({ title: title.trim(), duration_minutes: dur ? parseInt(dur, 10) : null,
            points: pts === "" ? 10 : parseInt(pts, 10), child_id: who || null });
    setTitle(""); setDur("");
  };

  return (
    <div className="rounded-2xl border-2 border-slate-100 p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl">{segment.emoji || "🕒"}</span>
        <span className="font-bold text-slate-800">{segment.label}</span>
        {segment.start_time && <span className="text-xs text-slate-400">{segment.start_time}–{segment.end_time}</span>}
        <span className={`ml-auto text-[11px] font-semibold ${over ? "text-amber-600" : "text-slate-400"}`}>
          {total ? `${total} mnt` : ""}{window_ != null && total ? ` dari ${window_} mnt` : ""}{over ? " · melebihi waktu bagian" : ""}
        </span>
      </div>

      {slots.length === 0 && <div className="text-xs text-slate-400 mb-2">Belum ada aktivitas.</div>}
      <div className="space-y-1.5">
        {slots.map((s, i) => (
          <div key={s.id} className="flex flex-wrap items-center gap-1.5 bg-slate-50 rounded-xl px-2 py-1.5">
            <div className="flex flex-col">
              <button onClick={() => onMove(s, "up")} disabled={busy || i === 0} className="text-slate-400 disabled:opacity-20" aria-label="Naik"><ChevronUp className="w-3.5 h-3.5" /></button>
              <button onClick={() => onMove(s, "down")} disabled={busy || i === slots.length - 1} className="text-slate-400 disabled:opacity-20" aria-label="Turun"><ChevronDown className="w-3.5 h-3.5" /></button>
            </div>
            <input defaultValue={s.title} key={`t${s.id}${s.title}`}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.title) onPatch(s, { title: v }); }}
              className="flex-1 min-w-[9rem] px-2 py-1.5 rounded-lg border border-slate-200 text-sm bg-white" />
            <label className="flex items-center gap-1 text-[11px] text-slate-500">⏱
              <input defaultValue={s.duration_minutes || ""} key={`d${s.id}${s.duration_minutes}`} inputMode="numeric" placeholder="–"
                onBlur={(e) => { const v = e.target.value.replace(/\D/g, ""); const n = v ? parseInt(v, 10) : null;
                  if (n !== (s.duration_minutes || null)) onPatch(s, { duration_minutes: n }); }}
                className="w-12 px-1 py-1.5 rounded-lg border border-slate-200 text-xs text-center bg-white" />mnt
            </label>
            <label className="flex items-center gap-1 text-[11px] text-slate-500">⭐
              <input defaultValue={s.points} key={`p${s.id}${s.points}`} inputMode="numeric"
                onBlur={(e) => { const n = parseInt(e.target.value.replace(/\D/g, "") || "0", 10); if (n !== s.points) onPatch(s, { points: n }); }}
                className="w-12 px-1 py-1.5 rounded-lg border border-slate-200 text-xs text-center bg-white" />
            </label>
            <select value={s.child_id || ""} onChange={(e) => onPatch(s, { child_id: e.target.value || null })}
              className="px-1.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white">
              <option value="">Semua anak</option>
              {kids.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
            <button onClick={() => onPatch(s, { is_bonus: !s.is_bonus })}
              className={`px-2 py-1.5 rounded-lg text-[11px] font-bold border ${s.is_bonus ? "bg-amber-100 border-amber-300 text-amber-700" : "border-slate-200 text-slate-400 bg-white"}`}
              title="Bonus = tidak wajib dicentang">Bonus</button>
            <button onClick={() => onRemove(s)} disabled={busy} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50" aria-label="Hapus">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {/* Quick add */}
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder={`Tambah aktivitas ${segment.label}…`}
          className="flex-1 min-w-[9rem] px-2.5 py-2 rounded-xl border-2 border-dashed border-slate-200 text-sm" />
        <input value={dur} onChange={(e) => setDur(e.target.value.replace(/\D/g, "").slice(0, 3))} placeholder="mnt" inputMode="numeric"
          className="w-14 px-1 py-2 rounded-xl border-2 border-slate-200 text-xs text-center" />
        <input value={pts} onChange={(e) => setPts(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="poin" inputMode="numeric"
          className="w-14 px-1 py-2 rounded-xl border-2 border-slate-200 text-xs text-center" />
        <select value={who} onChange={(e) => setWho(e.target.value)} className="px-1.5 py-2 rounded-xl border-2 border-slate-200 text-xs bg-white">
          <option value="">Semua anak</option>
          {kids.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
        <button onClick={add} disabled={busy}
          className="press-btn inline-flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-3 py-2 rounded-xl text-sm disabled:opacity-50">
          <Plus className="w-4 h-4" /> Tambah
        </button>
      </div>
    </div>
  );
}

const KINDS = [
  { key: "off", icon: CalendarOff, title: "Libur", desc: "Tidak ada aktivitas — seharian, atau mulai dari bagian tertentu." },
  { key: "swap", icon: Repeat, title: "Pakai jadwal hari lain", desc: "Mis. tanggal merah hari Senin memakai jadwal Minggu." },
  { key: "extra", icon: Sparkles, title: "Aktivitas tambahan", desc: "Kegiatan khusus di tanggal tertentu, di luar rutinitas." },
];

function ExceptionsPanel({ kids, segments, onChanged }) {
  const [list, setList] = useState(null);
  const [kind, setKind] = useState(null);
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const { data } = await api.get("/routine/exceptions"); setList(data); }
    catch (e) { toast.error(formatApiError(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const segLabel = (id) => segments.find((s) => s.id === id)?.label;
  const kidName = (id) => kids.find((k) => k.id === id)?.name;
  const range = (a, b) => (a === b || !b ? humanDateKey(a) : `${humanDateKey(a)} – ${humanDateKey(b)}`);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const open = (k) => { setKind(k); setF({ start_date: todayKey(), end_date: "", use_weekday: 6, points: "10" }); };

  const save = async () => {
    if (!f.start_date) return toast.error("Pilih tanggalnya dulu");
    const dates = { start_date: f.start_date, end_date: f.end_date || null };
    setBusy(true);
    try {
      if (kind === "off") {
        await api.post("/off-days", { ...dates, end_date: f.end_date || f.start_date, note: f.note || "",
          start_segment_id: f.from_seg || null, end_segment_id: f.to_seg || null });
      } else if (kind === "swap") {
        await api.post("/routine/swaps", { ...dates, use_weekday: Number(f.use_weekday), note: f.note || "" });
      } else {
        if (!f.title?.trim()) { toast.error("Isi nama aktivitasnya"); setBusy(false); return; }
        await api.post("/routine/extras", { ...dates, segment_id: f.segment_id || null, child_id: f.child_id || null,
          title: f.title.trim(), duration_minutes: f.duration ? parseInt(f.duration, 10) : null,
          points: f.points === "" ? 10 : parseInt(f.points, 10), note: f.note || "" });
      }
      toast.success("Pengecualian disimpan");
      setKind(null); await load(); onChanged?.();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  const del = async (path, label) => {
    if (!window.confirm(`Hapus pengecualian "${label}"?`)) return;
    try { await api.delete(path); toast.success("Dihapus"); await load(); onChanged?.(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const items = [
    ...(list?.off_days || []).map((o) => ({ key: `o${o.id}`, icon: "🏖️", start: o.start_date, path: `/off-days/${o.id}`,
      label: `Libur${o.start_segment_id ? ` mulai ${segLabel(o.start_segment_id) || ""}` : ""}${o.end_segment_id ? ` sampai ${segLabel(o.end_segment_id) || ""}` : ""}`,
      when: range(o.start_date, o.end_date), note: o.note })),
    ...(list?.swaps || []).map((w) => ({ key: `w${w.id}`, icon: "🔁", start: w.start_date, path: `/routine/swaps/${w.id}`,
      label: `Pakai jadwal ${DAYS[w.use_weekday]}`, when: range(w.start_date, w.end_date), note: w.note })),
    ...(list?.extras || []).map((x) => ({ key: `x${x.id}`, icon: "➕", start: x.start_date, path: `/routine/extras/${x.id}`,
      label: `${x.title}${x.duration_minutes ? ` (${x.duration_minutes} mnt)` : ""} · ${segLabel(x.segment_id) || "Kapan Saja"} · ${kidName(x.child_id) || "semua anak"}`,
      when: range(x.start_date, x.end_date), note: x.note })),
  ].sort((a, b) => a.start.localeCompare(b.start));

  const input = "w-full px-3 py-2 rounded-xl border-2 border-slate-200 text-sm bg-white";

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <h2 className="font-parent font-bold text-xl text-slate-900">📌 Pengecualian</h2>
      <p className="text-sm text-slate-500 mb-4">Untuk tanggal yang berbeda dari biasanya. Rutinitas mingguan tidak ikut berubah.</p>

      {list && items.length === 0 && !kind && <div className="text-sm text-slate-400 mb-3">Belum ada pengecualian yang akan datang.</div>}
      <div className="space-y-2 mb-4">
        {items.map((it) => (
          <div key={it.key} className="flex items-center gap-3 border-2 border-slate-100 rounded-2xl px-3 py-2.5">
            <span className="text-xl">{it.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-800">{it.when}</div>
              <div className="text-xs text-slate-500 truncate">{it.label}{it.note ? ` · "${it.note}"` : ""}</div>
            </div>
            <button onClick={() => del(it.path, it.when)} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50" aria-label="Hapus">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {!kind ? (
        <div className="grid sm:grid-cols-3 gap-2">
          {KINDS.map(({ key, icon: Icon, title, desc }) => (
            <button key={key} onClick={() => open(key)}
              className="press-btn text-left border-2 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 rounded-2xl p-3">
              <div className="flex items-center gap-2 font-semibold text-slate-800 text-sm"><Icon className="w-4 h-4 text-indigo-600" /> {title}</div>
              <div className="text-[11px] text-slate-500 mt-1">{desc}</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="border-2 border-indigo-100 bg-indigo-50/30 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-slate-800">{KINDS.find((k) => k.key === kind).title}</div>
            <button onClick={() => setKind(null)} className="text-slate-400" aria-label="Tutup"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-semibold text-slate-600">Dari tanggal
              <input type="date" value={f.start_date || ""} onChange={(e) => set("start_date", e.target.value)} className={`${input} mt-1`} />
            </label>
            <label className="text-xs font-semibold text-slate-600">Sampai <span className="font-normal text-slate-400">(opsional)</span>
              <input type="date" value={f.end_date || ""} min={f.start_date} onChange={(e) => set("end_date", e.target.value)} className={`${input} mt-1`} />
            </label>
          </div>

          {kind === "off" && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-semibold text-slate-600">Mulai libur dari
                <select value={f.from_seg || ""} onChange={(e) => set("from_seg", e.target.value)} className={`${input} mt-1`}>
                  <option value="">Awal hari</option>
                  {segments.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">Libur sampai
                <select value={f.to_seg || ""} onChange={(e) => set("to_seg", e.target.value)} className={`${input} mt-1`}>
                  <option value="">Akhir hari</option>
                  {segments.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
              <p className="col-span-2 text-[11px] text-slate-500">
                Mis. dari Jumat <b>Sore</b> sampai Senin <b>Pagi</b>: pagi Jumat tetap jalan, siang Senin aktif lagi.
              </p>
            </div>
          )}

          {kind === "swap" && (
            <label className="block text-xs font-semibold text-slate-600">Pakai jadwal hari
              <select value={f.use_weekday} onChange={(e) => set("use_weekday", e.target.value)} className={`${input} mt-1`}>
                {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </label>
          )}

          {kind === "extra" && (
            <div className="grid grid-cols-2 gap-2">
              <label className="col-span-2 text-xs font-semibold text-slate-600">Nama aktivitas
                <input value={f.title || ""} onChange={(e) => set("title", e.target.value)} placeholder="Mis. Latihan pentas" className={`${input} mt-1`} />
              </label>
              <label className="text-xs font-semibold text-slate-600">Bagian
                <select value={f.segment_id || ""} onChange={(e) => set("segment_id", e.target.value)} className={`${input} mt-1`}>
                  <option value="">Kapan Saja</option>
                  {segments.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">Untuk
                <select value={f.child_id || ""} onChange={(e) => set("child_id", e.target.value)} className={`${input} mt-1`}>
                  <option value="">Semua anak</option>
                  {kids.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">Durasi (mnt)
                <input value={f.duration || ""} inputMode="numeric" onChange={(e) => set("duration", e.target.value.replace(/\D/g, "").slice(0, 3))} className={`${input} mt-1`} />
              </label>
              <label className="text-xs font-semibold text-slate-600">Poin
                <input value={f.points ?? ""} inputMode="numeric" onChange={(e) => set("points", e.target.value.replace(/\D/g, "").slice(0, 4))} className={`${input} mt-1`} />
              </label>
            </div>
          )}

          <input value={f.note || ""} onChange={(e) => set("note", e.target.value.slice(0, 100))}
            placeholder="Catatan (opsional), mis. Tanggal merah" className={input} />
          <div className="flex gap-2">
            <button onClick={save} disabled={busy}
              className="press-btn bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4 py-2 rounded-xl text-sm disabled:opacity-50">
              {busy ? "Menyimpan…" : "Simpan"}
            </button>
            <button onClick={() => setKind(null)} className="press-btn border-2 border-slate-200 text-slate-600 font-semibold px-4 py-2 rounded-xl text-sm">Batal</button>
          </div>
        </div>
      )}
    </div>
  );
}
