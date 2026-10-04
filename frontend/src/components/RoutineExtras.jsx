import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { humanDateKey, todayKey } from "@/lib/dates";

const card = "bg-white rounded-2xl border border-slate-200 p-5";
const input = "px-2.5 py-2 rounded-xl border-2 border-slate-200 text-sm bg-white";
const primary = "press-btn bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4 py-2 rounded-xl text-sm disabled:opacity-50";

/**
 * The extras around the weekly routine, each in its own small card:
 * saved routines to switch between, relaxed days, and the bonus list
 * children pick one from each day.
 */
export default function RoutineExtras({ onChanged }) {
  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <PresetsCard onChanged={onChanged} />
      <RelaxedDaysCard />
      <BonusOptionsCard />
    </div>
  );
}

function useList(url) {
  const [rows, setRows] = useState(null);
  const load = useCallback(() => api.get(url, { fresh: true }).then((r) => setRows(r.data)).catch(() => setRows([])), [url]);
  useEffect(() => { load(); }, [load]);
  return [rows, load];
}

function PresetsCard({ onChanged }) {
  const [rows, load] = useList("/routine/presets");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn, msg) => {
    setBusy(true);
    try { await fn(); if (msg) toast.success(msg); await load(); onChanged?.(); }
    catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };
  const save = () => {
    if (!name.trim()) return toast.error("Beri nama dulu, mis. \"Hari sekolah\"");
    run(() => api.post("/routine/presets", { name: name.trim() }), "Rutinitas disimpan 💾").then(() => setName(""));
  };
  const apply = (p) => {
    if (!window.confirm(`Ganti rutinitas mingguan dengan "${p.name}"?\n\nRutinitas sekarang otomatis disimpan sebagai cadangan. Berlaku mulai besok.`)) return;
    run(() => api.post(`/routine/presets/${p.id}/apply`), `Sekarang memakai "${p.name}"`);
  };
  return (
    <div className={card}>
      <h3 className="font-parent font-bold text-slate-900">💾 Rutinitas tersimpan</h3>
      <p className="text-xs text-slate-500 mb-3">Simpan rutinitas sekarang (mis. "Hari sekolah"), lalu ganti ke "Libur" atau "Ujian" dengan sekali ketuk.</p>
      <div className="flex gap-2 mb-3">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Nama, mis. Hari sekolah"
               onKeyDown={(e) => e.key === "Enter" && save()} className={`flex-1 min-w-0 ${input}`} />
        <button onClick={save} disabled={busy} className={primary}>Simpan</button>
      </div>
      {rows === null ? <div className="text-xs text-slate-400">Memuat…</div> : rows.length === 0 ? (
        <div className="text-xs text-slate-400">Belum ada yang disimpan.</div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((p) => (
            <div key={p.id} className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-800 truncate">{p.emoji} {p.name}</div>
                <div className="text-[11px] text-slate-400">{p.slot_count} aktivitas{p.auto ? " · cadangan otomatis" : ""}</div>
              </div>
              <button onClick={() => apply(p)} disabled={busy}
                className="press-btn text-xs font-semibold px-3 py-1.5 rounded-lg border-2 border-indigo-200 text-indigo-700 bg-white">Pakai</button>
              <button onClick={() => window.confirm(`Hapus "${p.name}"?`) && run(() => api.delete(`/routine/presets/${p.id}`))}
                disabled={busy} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50" aria-label="Hapus"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RelaxedDaysCard() {
  const [rows, load] = useList("/relaxed-days");
  const [f, setF] = useState({ start_date: todayKey(), end_date: "", note: "" });
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      await api.post("/relaxed-days", { ...f, end_date: f.end_date || f.start_date });
      toast.success("Hari santai ditambahkan 🌴");
      setF({ start_date: todayKey(), end_date: "", note: "" });
      await load();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };
  const del = async (r) => {
    try { await api.delete(`/relaxed-days/${r.id}`); await load(); } catch (e) { toast.error(formatApiError(e)); }
  };
  const upcoming = (rows || []).filter((r) => r.end_date >= todayKey());
  return (
    <div className={card}>
      <h3 className="font-parent font-bold text-slate-900">🌴 Hari santai</h3>
      <p className="text-xs text-slate-500 mb-3">Mis. libur sekolah: rutinitas tetap jalan, tapi jam pribadi anak diabaikan dan tidak ada yang dihitung terlambat.</p>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <label className="text-[11px] text-slate-500">Dari
          <input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} className={`w-full ${input}`} />
        </label>
        <label className="text-[11px] text-slate-500">Sampai
          <input type="date" value={f.end_date} min={f.start_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} className={`w-full ${input}`} />
        </label>
      </div>
      <div className="flex gap-2 mb-3">
        <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={100} placeholder="Catatan (opsional)" className={`flex-1 min-w-0 ${input}`} />
        <button onClick={add} disabled={busy || !f.start_date} className={primary}>Tambah</button>
      </div>
      {upcoming.length === 0 ? <div className="text-xs text-slate-400">Belum ada hari santai ke depan.</div> : (
        <div className="space-y-1.5">
          {upcoming.map((r) => (
            <div key={r.id} className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2">
              <div className="flex-1 min-w-0 text-sm text-slate-700">
                {humanDateKey(r.start_date)}{r.end_date !== r.start_date ? ` – ${humanDateKey(r.end_date)}` : ""}
                {r.note && <span className="text-slate-400"> · {r.note}</span>}
              </div>
              <button onClick={() => del(r)} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50" aria-label="Hapus"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BonusOptionsCard() {
  const [data, load] = useList("/bonus-options");
  const [f, setF] = useState({ title: "", points: "5", emoji: "" });
  const rows = data?.options || [];
  const add = async () => {
    if (!f.title.trim()) return toast.error("Isi nama bonusnya dulu");
    try {
      await api.post("/bonus-options", { title: f.title.trim(), points: parseInt(f.points || "0", 10), emoji: f.emoji.trim() });
      setF({ title: "", points: "5", emoji: "" });
      await load();
    } catch (e) { toast.error(formatApiError(e)); }
  };
  const del = async (o) => {
    try { await api.delete(`/bonus-options/${o.id}`); await load(); } catch (e) { toast.error(formatApiError(e)); }
  };
  return (
    <div className={card}>
      <h3 className="font-parent font-bold text-slate-900">⭐ Bonus pilihan anak</h3>
      <p className="text-xs text-slate-500 mb-3">Anak memilih satu bonus sendiri tiap hari dari daftar ini. Kosongkan daftar untuk mematikan.</p>
      <div className="flex gap-2 mb-3">
        <input value={f.emoji} onChange={(e) => setF({ ...f, emoji: e.target.value })} maxLength={8} placeholder="🙂" className={`w-12 text-center ${input}`} />
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={120} placeholder="mis. Bantu cuci piring"
               onKeyDown={(e) => e.key === "Enter" && add()} className={`flex-1 min-w-0 ${input}`} />
        <input value={f.points} onChange={(e) => setF({ ...f, points: e.target.value.replace(/\D/g, "").slice(0, 4) })} inputMode="numeric"
               className={`w-14 text-center ${input}`} aria-label="Poin" />
        <button onClick={add} className={primary}>+</button>
      </div>
      {rows.length === 0 ? <div className="text-xs text-slate-400">Belum ada pilihan bonus.</div> : (
        <div className="flex flex-wrap gap-1.5">
          {rows.map((o) => (
            <span key={o.id} className="inline-flex items-center gap-1 bg-amber-50 border border-amber-200 rounded-full pl-3 pr-1 py-1 text-xs font-semibold text-amber-900">
              {o.emoji} {o.title} <span className="text-amber-600">+{o.points}</span>
              <button onClick={() => del(o)} className="p-0.5 rounded-full hover:bg-amber-100" aria-label="Hapus"><Trash2 className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
