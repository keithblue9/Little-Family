import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronUp, ChevronDown, Trash2, Plus, Copy, RefreshCw, CalendarOff, Repeat, Sparkles, X, Users, CheckSquare } from "lucide-react";
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
// `childId` (the child picked at the top of the page) narrows the routine to
// that child: their own activities plus the ones shared by every child.
export default function RoutineManager({ kids = [], childId = null, onChanged }) {
  const [data, setData] = useState(null);
  const [weekday, setWeekday] = useState(todayWeekday());
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyTo, setCopyTo] = useState([]);
  const [kidCopyOpen, setKidCopyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Activities ticked for copying, and whether the destination panel is open.
  const [sel, setSel] = useState(() => new Set());
  const [itemCopyOpen, setItemCopyOpen] = useState(false);

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
  const visible = useMemo(
    () => (data?.slots || []).filter((s) => !childId || !s.child_id || s.child_id === childId),
    [data, childId],
  );
  const daySlots = useMemo(() => visible.filter((s) => s.weekday === weekday), [visible, weekday]);
  // A different day or child means a different list — the old ticks no longer apply.
  useEffect(() => { setSel(new Set()); setItemCopyOpen(false); }, [weekday, childId]);
  const toggleSel = (id) => setSel((v) => { const n = new Set(v); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const setMany = (ids, on) => setSel((v) => { const n = new Set(v); ids.forEach((i) => (on ? n.add(i) : n.delete(i))); return n; });
  const copyItems = (opts) => run(async () => {
    const { data: r } = await api.post("/routine/copy-items", { slot_ids: [...sel], ...opts });
    toast.success(r.copied
      ? `${r.copied} aktivitas disalin${r.skipped ? ` · ${r.skipped} sudah ada` : ""}${r.removed ? ` · ${r.removed} diganti` : ""}`
      : "Semua aktivitas itu sudah ada di sana");
    setItemCopyOpen(false); setSel(new Set());
  });
  const countFor = (wd) => visible.filter((s) => s.weekday === wd).length;

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
  // Copy the picked child's own activities to siblings (whole week or just
  // this day), so a parent never types the same list twice.
  const copyToKids = (opts) => run(async () => {
    const { data: r } = await api.post("/routine/copy-child", { from_child_id: childId, ...opts });
    toast.success(r.copied
      ? `${r.copied} aktivitas disalin${r.skipped ? ` · ${r.skipped} sudah ada` : ""}`
      : "Semua aktivitas itu sudah ada di sana");
    setKidCopyOpen(false);
  });
  const copySlot = (slot, toIds) => run(async () => {
    const { data: r } = await api.post("/routine/copy-child", {
      from_child_id: slot.child_id, to_child_ids: toIds, slot_ids: [slot.id] });
    toast.success(r.copied ? `"${slot.title}" disalin` : `"${slot.title}" sudah ada di sana`);
  });
  const childName = (id) => kids.find((k) => k.id === id)?.name || "";

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
            {childId && kids.length > 1 && (
              <button onClick={() => { setKidCopyOpen((v) => !v); setCopyOpen(false); }} disabled={busy}
                className="press-btn inline-flex items-center gap-1.5 border-2 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold px-3 py-2 rounded-xl text-sm">
                <Users className="w-4 h-4" /> Salin ke anak lain…
              </button>
            )}
            <button onClick={() => { setCopyOpen((v) => !v); setKidCopyOpen(false); }} disabled={busy}
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

        {kidCopyOpen && childId && (
          <CopyToKidsPanel
            fromName={childName(childId)} weekdayLabel={DAYS[weekday]} busy={busy}
            others={kids.filter((k) => k.id !== childId)}
            onCancel={() => setKidCopyOpen(false)}
            onCopy={({ to, scope, mode }) => copyToKids({
              to_child_ids: to, mode, ...(scope === "day" ? { weekdays: [weekday] } : {}) })}
          />
        )}

        {copyOpen && (
          <div className="border-2 border-slate-100 rounded-2xl p-3 mb-4 bg-slate-50">
            <div className="text-sm font-semibold text-slate-700 mb-2">
              Salin seluruh jadwal {DAYS[weekday]} ke hari: <span className="font-normal text-slate-500">(jadwal hari tujuan akan diganti{childId ? ", untuk semua anak" : ""})</span>
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

        {sel.size > 0 && (
          <div className="sticky top-2 z-20 mb-4 rounded-2xl border-2 border-indigo-200 bg-indigo-50 p-3 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <CheckSquare className="w-4 h-4 text-indigo-600" />
              <span className="text-sm font-bold text-indigo-900">{sel.size} aktivitas dipilih</span>
              <button onClick={() => setMany(daySlots.map((x) => x.id), true)}
                className="press-btn text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-white border border-indigo-200 text-indigo-700">Pilih semua hari ini</button>
              <button onClick={() => setItemCopyOpen((v) => !v)}
                className="press-btn ml-auto inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl bg-indigo-600 text-white">
                <Copy className="w-4 h-4" /> Salin…
              </button>
              <button onClick={() => { setSel(new Set()); setItemCopyOpen(false); }}
                className="press-btn text-xs font-semibold px-2.5 py-1.5 rounded-lg text-slate-500">Batal</button>
            </div>
            {itemCopyOpen && (
              <CopyItemsPanel weekday={weekday} kids={kids} busy={busy} count={sel.size}
                onCancel={() => setItemCopyOpen(false)} onCopy={copyItems} />
            )}
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
            <SegmentCard key={sg.id} segment={sg} weekday={weekday} kids={kids} busy={busy} childId={childId}
              slots={daySlots.filter((s) => (s.segment_id || ANYTIME) === sg.id)}
              onAdd={(body) => run(() => api.post("/routine/slots", {
                weekdays: [weekday], segment_id: sg.id === ANYTIME ? null : sg.id, ...body }))}
              selected={sel} onToggle={toggleSel} onSelectMany={setMany}
              onCopySection={(ids) => { setSel(new Set(ids)); setItemCopyOpen(true); }}
              onPatch={patch} onMove={move} onRemove={remove} onCopySlot={copySlot} />
          ))}
        </div>
      </div>

      <ExceptionsPanel kids={kids} segments={data.segments || []} onChanged={onChanged} />
    </div>
  );
}

function CopyToKidsPanel({ fromName, weekdayLabel, others, busy, onCopy, onCancel }) {
  const [to, setTo] = useState(others.map((k) => k.id));
  const [scope, setScope] = useState("week");
  const [mode, setMode] = useState("add");
  const pill = (on) => `press-btn px-3 py-1.5 rounded-xl text-xs font-semibold border-2 ${
    on ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-200 bg-white text-slate-600"}`;
  return (
    <div className="border-2 border-emerald-100 rounded-2xl p-3 mb-4 bg-emerald-50/50 space-y-3">
      <div className="text-sm font-semibold text-slate-700">
        Salin aktivitas khusus <b>{fromName}</b> ke:
        <span className="font-normal text-slate-500"> (aktivitas "Semua anak" sudah otomatis dimiliki semua)</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {others.map((k) => (
          <button key={k.id} onClick={() => setTo((v) => v.includes(k.id) ? v.filter((x) => x !== k.id) : [...v, k.id])}
            className={pill(to.includes(k.id))}>{k.avatar_emoji || "🙂"} {k.name}</button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-xs text-slate-500 mr-1">Yang disalin:</span>
        <button onClick={() => setScope("week")} className={pill(scope === "week")}>Seminggu penuh</button>
        <button onClick={() => setScope("day")} className={pill(scope === "day")}>Hanya {weekdayLabel}</button>
      </div>
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-xs text-slate-500 mr-1">Caranya:</span>
        <button onClick={() => setMode("add")} className={pill(mode === "add")}>Tambahkan</button>
        <button onClick={() => setMode("replace")} className={pill(mode === "replace")}>Ganti yang lama</button>
      </div>
      <p className="text-[11px] text-slate-500">
        {mode === "add"
          ? "Aktivitas yang sudah ada (judul sama di bagian yang sama) dilewati, jadi tidak dobel."
          : "Aktivitas khusus anak tujuan di hari & bagian yang sama diganti dengan salinan ini."}
      </p>
      <div className="flex gap-2">
        <button onClick={() => onCopy({ to, scope, mode })} disabled={busy || to.length === 0}
          className="press-btn bg-emerald-600 text-white font-semibold px-4 py-2 rounded-xl text-sm disabled:opacity-50">Salin</button>
        <button onClick={onCancel}
          className="press-btn border-2 border-slate-200 text-slate-600 font-semibold px-4 py-2 rounded-xl text-sm">Batal</button>
      </div>
    </div>
  );
}

/** Where the ticked activities go: other days, another child, or both. */
function CopyItemsPanel({ weekday, kids, busy, count, onCopy, onCancel }) {
  const [days, setDays] = useState([]);
  const [to, setTo] = useState([]);
  const [mode, setMode] = useState("add");
  const pill = (on) => `press-btn px-3 py-1.5 rounded-xl text-xs font-semibold border-2 ${
    on ? "border-indigo-500 bg-indigo-500 text-white" : "border-slate-200 bg-white text-slate-600"}`;
  const flip = (setter) => (v) => setter((a) => (a.includes(v) ? a.filter((x) => x !== v) : [...a, v]));
  const ok = days.length > 0 || to.length > 0;
  return (
    <div className="rounded-xl bg-white border border-indigo-100 p-3 space-y-3">
      <div>
        <div className="text-xs font-semibold text-slate-700 mb-1.5">Salin ke hari: <span className="font-normal text-slate-400">(kosongkan kalau hanya ke anak lain)</span></div>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d, i) => (
            <button key={d} onClick={() => flip(setDays)(i)} className={pill(days.includes(i))}>
              {d.slice(0, 3)}{i === weekday ? " •" : ""}
            </button>
          ))}
        </div>
      </div>
      {kids.length > 1 && (
        <div>
          <div className="text-xs font-semibold text-slate-700 mb-1.5">Salin ke anak: <span className="font-normal text-slate-400">(kosongkan kalau tetap untuk anak yang sama)</span></div>
          <div className="flex flex-wrap gap-1.5">
            {kids.map((k) => (
              <button key={k.id} onClick={() => flip(setTo)(k.id)} className={pill(to.includes(k.id))}>{k.avatar_emoji || "🙂"} {k.name}</button>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Aktivitas "Semua anak" tidak digandakan ke anak lain — mereka sudah ikut memilikinya.</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-slate-500 mr-1">Caranya:</span>
        <button onClick={() => setMode("add")} className={pill(mode === "add")}>Tambahkan</button>
        <button onClick={() => setMode("replace")} className={pill(mode === "replace")}>Ganti bagian tujuan</button>
      </div>
      <p className="text-[11px] text-slate-500">
        {mode === "add"
          ? "Aktivitas dengan judul sama di bagian yang sama dilewati, jadi tidak dobel."
          : "Isi bagian tujuan (hari, bagian, dan anak yang sama) dihapus dulu, lalu diganti salinan ini."}
      </p>
      <div className="flex gap-2">
        <button disabled={busy || !ok}
          onClick={() => {
            if (mode === "replace" && !window.confirm("Isi bagian tujuan akan diganti. Lanjutkan?")) return;
            onCopy({ mode, ...(days.length ? { to_weekdays: days } : {}), ...(to.length ? { to_child_ids: to } : {}) });
          }}
          className="press-btn bg-indigo-600 text-white font-semibold px-4 py-2 rounded-xl text-sm disabled:opacity-50">
          Salin {count} aktivitas
        </button>
        <button onClick={onCancel} className="press-btn border-2 border-slate-200 text-slate-600 font-semibold px-4 py-2 rounded-xl text-sm">Tutup</button>
      </div>
    </div>
  );
}

function SegmentCard({ segment, slots, kids, busy, childId, selected, onToggle, onSelectMany, onCopySection, onAdd, onPatch, onMove, onRemove, onCopySlot }) {
  const [title, setTitle] = useState("");
  const [dur, setDur] = useState("");
  const [pts, setPts] = useState("10");
  const [who, setWho] = useState(childId || "");
  const [openProof, setOpenProof] = useState(null); // slot whose proof options are open
  useEffect(() => { setWho(childId || ""); }, [childId]); // new activities go to the picked child
  const window_ = segment.start_time ? toMin(segment.end_time) - toMin(segment.start_time) : null;
  const total = slots.reduce((n, s) => n + (s.duration_minutes || 0), 0);
  const over = window_ != null && total > window_;
  const allSel = slots.length > 0 && slots.every((x) => selected.has(x.id));

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
        {slots.length > 0 && (
          <span className="ml-1 flex items-center gap-1">
            <button onClick={() => onSelectMany(slots.map((x) => x.id), !allSel)}
              className="press-btn text-[11px] font-semibold px-2 py-1 rounded-lg border border-slate-200 text-slate-600 bg-white">
              {allSel ? "Batal pilih" : "Pilih semua"}
            </button>
            <button onClick={() => onCopySection(slots.map((x) => x.id))} title="Salin seluruh bagian ini ke hari atau anak lain"
              className="press-btn inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border border-indigo-200 text-indigo-700 bg-indigo-50">
              <Copy className="w-3 h-3" /> Salin bagian
            </button>
          </span>
        )}
        <span className={`ml-auto text-[11px] font-semibold ${over ? "text-amber-600" : "text-slate-400"}`}>
          {total ? `${total} mnt` : ""}{window_ != null && total ? ` dari ${window_} mnt` : ""}{over ? " · melebihi waktu bagian" : ""}
        </span>
      </div>

      {slots.length === 0 && <div className="text-xs text-slate-400 mb-2">Belum ada aktivitas.</div>}
      <div className="space-y-1.5">
        {slots.map((s, i) => (
          <div key={s.id} className={`flex flex-wrap items-center gap-1.5 rounded-xl px-2 py-1.5 ${selected.has(s.id) ? "bg-indigo-50 ring-2 ring-indigo-200" : "bg-slate-50"}`}>
            <input type="checkbox" checked={selected.has(s.id)} onChange={() => onToggle(s.id)}
              className="w-4 h-4 accent-indigo-600 shrink-0" aria-label={`Pilih ${s.title}`} />
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
            <button onClick={() => setOpenProof((v) => v === s.id ? null : s.id)}
              className={`px-2 py-1.5 rounded-lg text-[11px] font-bold border ${proofIcons(s) ? "bg-indigo-100 border-indigo-300 text-indigo-700" : "border-slate-200 text-slate-400 bg-white"}`}
              title="Bukti: ringkasan, kuis, foto, halaman buku, checklist kecil">{proofIcons(s) || "Bukti"} ▾</button>
            <button onClick={() => onPatch(s, { is_bonus: !s.is_bonus })}
              className={`px-2 py-1.5 rounded-lg text-[11px] font-bold border ${s.is_bonus ? "bg-amber-100 border-amber-300 text-amber-700" : "border-slate-200 text-slate-400 bg-white"}`}
              title="Bonus = tidak wajib dicentang">Bonus</button>
            {s.child_id && kids.length > 1 && (
              <select value="" disabled={busy} aria-label="Salin ke anak lain" title="Salin ke anak lain"
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  onCopySlot(s, v === "*" ? kids.filter((k) => k.id !== s.child_id).map((k) => k.id) : [v]);
                }}
                className="w-9 px-1 py-1.5 rounded-lg border border-slate-200 text-xs bg-white text-slate-500 cursor-pointer">
                <option value="">⧉</option>
                {kids.filter((k) => k.id !== s.child_id).map((k) => <option key={k.id} value={k.id}>Salin ke {k.name}</option>)}
                {kids.length > 2 && <option value="*">Salin ke semua anak lain</option>}
              </select>
            )}
            <button onClick={() => onRemove(s)} disabled={busy} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50" aria-label="Hapus">
              <Trash2 className="w-4 h-4" />
            </button>
            {openProof === s.id && <ProofEditor slot={s} onPatch={onPatch} />}
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


const proofIcons = (s) => [
  s.summary_required && ((s.summary_questions || []).length ? "❓" : "📝"),
  (s.photo_required || s.before_photo_required) && "📷",
  s.reading && "📖",
  s.timed && "⏱",
  (s.steps || []).length > 0 && "☑️",
].filter(Boolean).join("");

/**
 * How a child shows a mission was really done — pick any mix. Each choice
 * travels to every day built from this routine.
 */
function ProofEditor({ slot: s, onPatch }) {
  const chip = (on) => `press-btn px-2.5 py-1.5 rounded-lg text-[11px] font-bold border ${
    on ? "bg-indigo-500 border-indigo-500 text-white" : "border-slate-200 text-slate-600 bg-white"}`;
  const lines = (v) => v.split("\n").map((x) => x.trim()).filter(Boolean);
  const quiz = (s.summary_questions || []).length > 0;
  return (
    <div className="basis-full ml-6 mt-1 rounded-xl border border-indigo-100 bg-white p-2.5 space-y-2.5">
      <div className="text-[11px] text-slate-500">Bukti yang diminta (boleh lebih dari satu):</div>
      <div className="flex flex-wrap gap-1.5">
        <button className={chip(s.summary_required && !quiz)}
          onClick={() => onPatch(s, s.summary_required && !quiz ? { summary_required: false } : { summary_required: true, summary_questions: [] })}>
          📝 Tulis ringkasan</button>
        <button className={chip(s.summary_required && quiz)}
          onClick={() => onPatch(s, s.summary_required && quiz
            ? { summary_required: false, summary_questions: [] }
            : { summary_required: true, summary_questions: quiz ? s.summary_questions : ["Apa yang kamu pelajari hari ini?"] })}>
          ❓ Jawab kuis</button>
        <button className={chip(s.photo_required)} onClick={() => onPatch(s, { photo_required: !s.photo_required })}>📷 Foto sesudah</button>
        <button className={chip(s.before_photo_required)} onClick={() => onPatch(s, { before_photo_required: !s.before_photo_required })}>📷 Foto sebelum</button>
        <button className={chip(s.reading)} onClick={() => onPatch(s, { reading: !s.reading })}>📖 Halaman buku</button>
        <button className={chip(s.timed)} onClick={() => onPatch(s, { timed: !s.timed })}
          title="Anak menekan Mulai lalu Selesai; waktunya dicatat">⏱ Pakai timer</button>
        <button className={chip((s.steps || []).length > 0)}
          onClick={() => onPatch(s, { steps: (s.steps || []).length ? [] : ["Langkah 1", "Langkah 2"] })}>☑️ Checklist kecil</button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-slate-500">Hadiah misi untuk hewan:</span>
        {[["food", "🍖 Pakan"], ["water", "💧 Air"], ["play", "🎾 Mainan"]].map(([k, l]) => (
          <button key={k} className={chip((s.pet_care || "food") === k)}
            onClick={() => onPatch(s, { pet_care: k })}>{l}</button>
        ))}
      </div>

      {s.summary_required && !quiz && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-indigo-700 font-semibold">📝 Pertanyaan:</span>
          <input defaultValue={s.summary_prompt || ""} key={`q${s.id}${s.summary_prompt}`}
            placeholder="Apa yang sudah kamu pelajari?"
            onBlur={(e) => { const v = e.target.value.trim(); if (v !== (s.summary_prompt || "")) onPatch(s, { summary_prompt: v || null }); }}
            className="flex-1 min-w-[10rem] px-2 py-1 rounded-lg border border-indigo-100 text-xs bg-white" />
          <label className="flex items-center gap-1 text-[11px] text-slate-500">min
            <input defaultValue={s.summary_min_words || 15} key={`w${s.id}${s.summary_min_words}`} inputMode="numeric"
              onBlur={(e) => { const n = Math.min(300, Math.max(3, parseInt(e.target.value.replace(/\D/g, "") || "15", 10)));
                if (n !== (s.summary_min_words || 15)) onPatch(s, { summary_min_words: n }); }}
              className="w-12 px-1 py-1 rounded-lg border border-indigo-100 text-xs text-center bg-white" />kata
          </label>
        </div>
      )}
      {s.summary_required && quiz && (
        <label className="block">
          <span className="text-[11px] text-indigo-700 font-semibold">❓ Pertanyaan kuis — satu per baris, maks 3 (tiap jawaban min 3 kata)</span>
          <textarea rows={3} defaultValue={(s.summary_questions || []).join("\n")} key={`z${s.id}${(s.summary_questions || []).join("|")}`}
            onBlur={(e) => { const v = lines(e.target.value).slice(0, 3);
              if (v.join("|") !== (s.summary_questions || []).join("|")) onPatch(s, v.length ? { summary_questions: v } : { summary_required: false, summary_questions: [] }); }}
            className="mt-1 w-full px-2 py-1.5 rounded-lg border border-indigo-100 text-xs bg-white" />
        </label>
      )}
      {s.reading && (
        <label className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-sky-700 font-semibold">📖 Judul buku (kosongkan = anak menulis sendiri):</span>
          <input defaultValue={s.reading_book || ""} key={`b${s.id}${s.reading_book}`} maxLength={120}
            onBlur={(e) => { const v = e.target.value.trim(); if (v !== (s.reading_book || "")) onPatch(s, { reading_book: v || null }); }}
            className="flex-1 min-w-[10rem] px-2 py-1 rounded-lg border border-sky-100 text-xs bg-white" />
        </label>
      )}
      {(s.steps || []).length > 0 && (
        <label className="block">
          <span className="text-[11px] text-slate-700 font-semibold">☑️ Isi checklist — satu per baris, maks 10</span>
          <textarea rows={3} defaultValue={(s.steps || []).join("\n")} key={`s${s.id}${(s.steps || []).join("|")}`}
            onBlur={(e) => { const v = lines(e.target.value).slice(0, 10);
              if (v.join("|") !== (s.steps || []).join("|")) onPatch(s, { steps: v }); }}
            className="mt-1 w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white" />
        </label>
      )}
    </div>
  );
}
