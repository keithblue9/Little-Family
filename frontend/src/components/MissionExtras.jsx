import { useEffect, useState } from "react";
import { Check, Play, Square } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { haptic, sendOrQueue } from "@/lib/offlineQueue";

/**
 * Small pieces a mission can carry besides its own tick:
 *  - a checklist inside it (tas sekolah: buku, pensil, botol),
 *  - "sampai halaman berapa" for a reading mission,
 *  - "Ternyata belum" — owning up to a tick that wasn't really done.
 */

export function StepsList({ activity, canEdit, onChange, big = false }) {
  const [busy, setBusy] = useState(null);
  const steps = activity.steps || [];
  const done = activity.steps_done || [];
  const tick = async (i) => {
    if (!canEdit || busy !== null) return;
    const next = !done[i];
    setBusy(i);
    try {
      const { data } = await api.post(`/tasks/${activity.id}/steps`, { index: i, done: next });
      if (next) haptic();
      onChange?.({ steps_done: data.steps_done || [], checked: !!data.checked });
      if (data.checked && !activity.checked) toast.success(`${activity.title} lengkap ✅`);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className={`${big ? "pl-4" : "pl-9"} space-y-1`}>
      {steps.map((s, i) => (
        <button key={i} type="button" onClick={() => tick(i)} disabled={!canEdit}
          className={`w-full flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-left border ${
            done[i] ? "bg-emerald-50 border-emerald-100" : "bg-slate-50 border-slate-100"} ${
            canEdit ? "press-btn" : "opacity-70 cursor-default"} ${big ? "text-base" : "text-xs"}`}>
          <span className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
            done[i] ? "bg-emerald-500 border-emerald-500" : "border-slate-300 bg-white"}`}>
            {done[i] && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
          </span>
          <span className={`font-semibold ${done[i] ? "text-slate-400 line-through" : "text-slate-700"}`}>{s}</span>
          {busy === i && <span className="ml-auto text-[10px] text-slate-400">…</span>}
        </button>
      ))}
    </div>
  );
}

export function ReadingForm({ activity, onSaved, onCancel, big = false }) {
  const last = activity.reading_last;
  const [book, setBook] = useState(activity.reading_book || last?.book || "");
  const [page, setPage] = useState("");
  const [newBook, setNewBook] = useState(false);
  const [busy, setBusy] = useState(false);
  const fixedBook = !!activity.reading_book;
  const save = async () => {
    const p = parseInt(page, 10);
    if (!p || p < 1) { toast("Tulis halaman terakhir yang kamu baca ya 📖"); return; }
    if (!fixedBook && !book.trim()) { toast("Tulis judul bukunya dulu ya"); return; }
    setBusy(true);
    try {
      const { data } = await api.post(`/tasks/${activity.id}/reading`, {
        page: p, book: fixedBook ? undefined : book.trim(), new_book: newBook });
      haptic();
      toast.success(`Sampai halaman ${p} — hebat! 📚`);
      onSaved?.({ checked: true, reading_page: data.reading_page, reading_book: data.reading_book,
                  reading_last: { book: data.reading_book, page: data.reading_page } });
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };
  const input = `rounded-xl border-2 border-sky-100 bg-white px-3 py-2 focus:border-sky-400 focus:outline-none ${big ? "text-lg" : "text-sm"}`;
  return (
    <div className={`rounded-2xl border-2 border-sky-200 bg-sky-50/60 ${big ? "p-4" : "p-3"} space-y-2`}>
      <div className={`font-fun font-bold text-sky-900 ${big ? "text-xl" : "text-sm"}`}>📖 Sampai halaman berapa?</div>
      {last?.page && !newBook && (
        <div className="text-xs text-sky-800">Terakhir: <b>{last.book}</b> halaman {last.page}</div>
      )}
      {!fixedBook && (
        <input value={book} onChange={(e) => setBook(e.target.value)} maxLength={120}
               placeholder="Judul buku" className={`w-full ${input}`} />
      )}
      <div className="flex gap-2 items-center">
        <input type="number" inputMode="numeric" min={1} value={page} onChange={(e) => setPage(e.target.value)}
               placeholder="Halaman" className={`w-32 ${input}`} />
        {last?.page && (
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={newBook} onChange={(e) => setNewBook(e.target.checked)} /> Buku baru
          </label>
        )}
        <div className="ml-auto flex gap-2">
          {onCancel && (
            <button type="button" onClick={onCancel} className="press-btn px-3 py-2 rounded-xl text-xs font-bold text-slate-500">Batal</button>
          )}
          <button type="button" onClick={save} disabled={busy}
            className={`press-btn rounded-xl font-fun font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 ${big ? "px-5 py-3" : "px-3 py-2 text-sm"}`}>
            {busy ? "Menyimpan…" : "Simpan"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Ternyata belum": owning up costs nothing — the mission just doesn't count. */
export function AdmitButton({ activity, onDone, big = false }) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const admit = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/tasks/${activity.id}/admit`);
      toast.success(
        data.bonus ? `Terima kasih sudah jujur 🙏 +${data.bonus} poin kejujuran`
          : data.reopened ? "Terima kasih sudah jujur 🙏 Kerjakan sekarang ya." : "Terima kasih sudah jujur 🙏",
        { duration: 4000 });
      setAsk(false);
      onDone?.(data);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };
  if (!ask) {
    return (
      <button type="button" onClick={() => setAsk(true)}
        className={`${big ? "text-sm" : "text-[11px]"} font-semibold text-slate-400 hover:text-amber-600 underline-offset-2 hover:underline`}>
        Ternyata belum?
      </button>
    );
  }
  return (
    <div className={`rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 ${big ? "text-sm" : "text-xs"} text-amber-900 space-y-1.5`}>
      <div>Belum benar-benar dikerjakan? Bilang saja — <b>tidak ada minus</b> kalau kamu jujur sendiri.</div>
      <div className="flex gap-2">
        <button type="button" onClick={admit} disabled={busy}
          className="press-btn px-3 py-1.5 rounded-lg bg-amber-500 text-white font-bold disabled:opacity-50">
          {busy ? "…" : "Iya, belum"}
        </button>
        <button type="button" onClick={() => setAsk(false)} className="press-btn px-3 py-1.5 rounded-lg font-bold text-amber-800">
          Sudah kok
        </button>
      </div>
    </div>
  );
}


// One interval shared by every running timer on screen, alive only while at
// least one is running — a stopwatch costs nothing when nobody is timing.
const tickSubs = new Set();
let tickId = null;
function useTick(active) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const fn = () => set((n) => n + 1);
    tickSubs.add(fn);
    if (!tickId) tickId = setInterval(() => { if (!document.hidden) tickSubs.forEach((f) => f()); }, 1000);
    return () => {
      tickSubs.delete(fn);
      if (!tickSubs.size && tickId) { clearInterval(tickId); tickId = null; }
    };
  }, [active]);
}

export const fmtClock = (secs) => {
  const s = Math.max(0, Math.round(secs));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
export const fmtTook = (secs) => (secs < 90 ? `${Math.max(1, Math.round(secs))} dtk` : `${Math.round(secs / 60)} mnt`);

/**
 * Mulai → Selesai for an activity the parent chose to time. The clock is just
 * the stored start time, so it survives closing the app; Selesai also ticks
 * the activity. Updates show at once and are queued if there's no signal.
 */
export function TimerControl({ activity, canEdit, onChange, big = false }) {
  const [busy, setBusy] = useState(false);
  const running = !!activity.timer_started_at && !activity.timer_ended_at;
  useTick(running);
  const done = !!activity.timer_ended_at;
  const elapsed = running ? (Date.now() - new Date(activity.timer_started_at).getTime()) / 1000 : 0;
  const target = (activity.duration_minutes || 0) * 60;

  const go = async (kind) => {
    if (busy) return;
    setBusy(true);
    const nowIso = new Date().toISOString();
    haptic(kind === "start" ? 10 : [20, 30, 20]);
    const prev = { timer_started_at: activity.timer_started_at, timer_ended_at: activity.timer_ended_at,
                   timer_seconds: activity.timer_seconds, checked: activity.checked };
    onChange?.(kind === "start"
      ? { timer_started_at: nowIso }
      : { timer_ended_at: nowIso, timer_seconds: Math.max(1, Math.round(elapsed)), checked: true });
    try {
      await sendOrQueue(`/tasks/${activity.id}/timer/${kind === "start" ? "start" : "stop"}`, {}, `timer:${kind}:${activity.id}`);
    } catch (e) {
      onChange?.(prev);
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const size = big ? "px-5 py-3 text-lg" : "px-2.5 py-1.5 text-xs";
  if (done) {
    return <span className={`shrink-0 font-bold text-emerald-600 ${big ? "text-lg" : "text-[11px]"}`}>⏱ {fmtTook(activity.timer_seconds || 0)}</span>;
  }
  if (!canEdit) return null;
  if (running) {
    const over = target && elapsed > target;
    return (
      <div className="shrink-0 flex items-center gap-1.5">
        <span className={`font-mono font-bold tabular-nums ${over ? "text-amber-600" : "text-indigo-600"} ${big ? "text-2xl" : "text-xs"}`}>{fmtClock(elapsed)}</span>
        <button type="button" onClick={() => go("stop")} disabled={busy}
          className={`press-btn inline-flex items-center gap-1 rounded-xl bg-emerald-500 text-white font-fun font-bold ${size}`}>
          <Square className="w-3 h-3 fill-current" /> Selesai
        </button>
      </div>
    );
  }
  return (
    <button type="button" onClick={() => go("start")} disabled={busy}
      className={`press-btn shrink-0 inline-flex items-center gap-1 rounded-xl bg-indigo-600 text-white font-fun font-bold ${size}`}>
      <Play className="w-3 h-3 fill-current" /> Mulai{target ? ` · ${activity.duration_minutes} mnt` : ""}
    </button>
  );
}
