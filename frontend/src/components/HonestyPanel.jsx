import { useCallback, useEffect, useState } from "react";
import { Camera } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { fileToDownscaledDataUrl } from "@/lib/imageUpload";
import { humanDateKey } from "@/lib/dates";
import { countWords } from "@/components/SummaryBox";

const REFLECTION_MIN = 8;

/**
 * What the child has to look at on top of today's list, kindly worded:
 * a surprise photo check, a mission to fix, a reflection to write, a watch
 * period, and the one bonus mission they get to pick themselves.
 * Renders nothing when there's nothing to show.
 */
export default function HonestyPanel({ child, big = false }) {
  const [h, setH] = useState(null);
  const [bonus, setBonus] = useState(null);

  const load = useCallback(async () => {
    if (!child?.id) return;
    try {
      const [a, b] = await Promise.all([
        api.get(`/children/${child.id}/honesty`, { fresh: true }),
        api.get("/bonus-options", { params: { child_id: child.id }, fresh: true }),
      ]);
      setH(a.data);
      setBonus(b.data);
    } catch { /* the day's list still works without this */ }
  }, [child?.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const on = () => load();
    window.addEventListener("app:honesty-refresh", on);
    return () => window.removeEventListener("app:honesty-refresh", on);
  }, [load]);

  if (!h) return null;
  const checks = h.spot_checks || [];
  const redo = h.redo || [];
  const refl = h.reflections || [];
  const opts = bonus?.options || [];
  const showBonus = opts.length > 0;
  if (!h.probation_until && !checks.length && !redo.length && !refl.length && !showBonus) return null;

  const text = big ? "text-base" : "text-sm";
  return (
    <div className="space-y-3 mb-4">
      {h.probation_until && (
        <div className={`rounded-2xl bg-sky-50 border-2 border-sky-100 px-4 py-3 ${text} text-sky-900`}>
          🤝 <b>Masa latihan jujur</b> sampai {humanDateKey(h.probation_until)}. Abi/Ummi akan melihat dulu setiap bagian
          yang kamu selesaikan. Tetap jujur — nanti selesai sendiri dan kepercayaan naik lagi 💪
        </div>
      )}

      {checks.map((c) => <SpotCheckCard key={c.id} check={c} onDone={load} big={big} />)}

      {redo.map((t) => <RedoCard key={t.id} task={t} onDone={load} big={big} />)}

      {refl.map((r) => <ReflectionCard key={r.id} reflection={r} onDone={load} big={big} />)}

      {showBonus && <BonusPicker child={child} data={bonus} onDone={load} big={big} />}
    </div>
  );
}

function SpotCheckCard({ check, onDone, big }) {
  const [busy, setBusy] = useState(false);
  const send = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const url = await fileToDownscaledDataUrl(file, { maxDim: 960, quality: 0.78 });
      await api.post(`/spot-checks/${check.id}/answer`, { photo_url: url });
      toast.success("Foto terkirim 📸 Terima kasih!");
      onDone();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };
  const admit = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/tasks/${check.task_id}/admit`);
      toast.success(`Terima kasih sudah jujur 🙏${data.bonus ? ` +${data.bonus} poin kejujuran` : ""}`, { duration: 4000 });
      onDone();
      window.dispatchEvent(new Event("app:honesty-refresh"));
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-2xl bg-violet-50 border-2 border-violet-200 p-4 space-y-2">
      <div className={`font-fun font-bold text-violet-900 ${big ? "text-xl" : "text-base"}`}>📸 Cek kejutan!</div>
      <div className={`${big ? "text-base" : "text-sm"} text-violet-900`}>
        Kirim foto <b>“{check.title}”</b> ({check.segment}). Kalau ternyata belum dikerjakan, bilang saja —
        jujur malah dapat bonus.
      </div>
      <div className="flex gap-2 flex-wrap">
        <label className={`press-btn inline-flex items-center gap-2 rounded-xl bg-violet-600 text-white font-fun font-bold cursor-pointer ${
          big ? "px-5 py-3" : "px-4 py-2 text-sm"} ${busy ? "opacity-50" : ""}`}>
          <Camera className="w-4 h-4" /> {busy ? "Mengirim…" : "Ambil foto"}
          <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={busy}
                 onChange={(e) => send(e.target.files?.[0])} />
        </label>
        <button type="button" onClick={admit} disabled={busy}
          className={`press-btn rounded-xl border-2 border-violet-200 bg-white text-violet-700 font-bold ${big ? "px-5 py-3" : "px-4 py-2 text-sm"}`}>
          Ternyata belum
        </button>
      </div>
    </div>
  );
}

function RedoCard({ task, onDone, big }) {
  const [busy, setBusy] = useState(false);
  const claimed = !!task.redo_claimed_at;
  const claim = async () => {
    setBusy(true);
    try {
      await api.post(`/tasks/${task.id}/redo-done`);
      toast.success("Sip! Abi/Ummi akan mengeceknya 👍");
      onDone();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-2xl bg-amber-50 border-2 border-amber-200 p-4 space-y-2">
      <div className={`font-fun font-bold text-amber-900 ${big ? "text-xl" : "text-base"}`}>🔁 Perlu dibetulkan</div>
      <div className={`${big ? "text-base" : "text-sm"} text-amber-900`}>
        <b>“{task.title}”</b> ternyata belum selesai. Kerjakan sekarang, lalu ketuk tombol di bawah.
      </div>
      {claimed ? (
        <div className="text-sm font-semibold text-amber-700">⏳ Menunggu dicek Abi/Ummi</div>
      ) : (
        <button type="button" onClick={claim} disabled={busy}
          className={`press-btn rounded-xl bg-amber-500 text-white font-fun font-bold disabled:opacity-50 ${big ? "px-5 py-3" : "px-4 py-2 text-sm"}`}>
          {busy ? "…" : "Sudah kubetulkan"}
        </button>
      )}
    </div>
  );
}

function ReflectionCard({ reflection, onDone, big }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const words = countWords(text);
  const save = async () => {
    if (words < REFLECTION_MIN) { toast(`Tulis sedikit lagi ya (${words}/${REFLECTION_MIN} kata)`); return; }
    setBusy(true);
    try {
      await api.post(`/reflections/${reflection.id}`, { text: text.trim() });
      toast.success("Terima kasih sudah menulis 💛");
      onDone();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-2xl bg-rose-50 border-2 border-rose-100 p-4 space-y-2">
      <div className={`font-fun font-bold text-rose-900 ${big ? "text-xl" : "text-base"}`}>💭 Yuk, renungkan sebentar</div>
      <div className={`${big ? "text-base" : "text-sm"} text-rose-900`}>
        Tentang <b>“{reflection.title}”</b>: kenapa waktu itu dicentang padahal belum? Lain kali apa yang mau kamu lakukan?
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={2000}
        placeholder="Tulis dengan jujur, tidak apa-apa…"
        className={`w-full rounded-xl border-2 border-rose-100 bg-white px-3 py-2 focus:border-rose-300 focus:outline-none ${big ? "text-lg" : "text-sm"}`} />
      <div className="flex items-center">
        <span className={`text-xs font-semibold ${words >= REFLECTION_MIN ? "text-emerald-600" : "text-slate-500"}`}>{words}/{REFLECTION_MIN} kata</span>
        <button type="button" onClick={save} disabled={busy}
          className={`ml-auto press-btn rounded-xl bg-rose-500 text-white font-fun font-bold disabled:opacity-50 ${big ? "px-5 py-3" : "px-4 py-2 text-sm"}`}>
          {busy ? "…" : "Kirim"}
        </button>
      </div>
    </div>
  );
}

function BonusPicker({ child, data, onDone, big }) {
  const [busy, setBusy] = useState(null);
  const picked = data.picked_today;
  const pick = async (opt) => {
    setBusy(opt.id);
    try {
      await api.post(`/kid/${child.id}/pick-bonus`, { option_id: opt.id });
      toast.success(`Bonus dipilih: ${opt.title} ⭐ — ada di "Kapan Saja"`);
      onDone();
      window.dispatchEvent(new Event("app:day-refresh"));
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="rounded-2xl bg-white border-2 border-amber-100 p-4">
      <div className={`font-fun font-bold text-slate-900 ${big ? "text-xl" : "text-base"} mb-2`}>⭐ Pilih bonus hari ini</div>
      {picked ? (
        <div className={`${big ? "text-base" : "text-sm"} text-slate-600`}>
          Hari ini kamu memilih <b>{picked.title}</b>. Besok bisa pilih lagi!
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {data.options.map((o) => (
            <button key={o.id} type="button" onClick={() => pick(o)} disabled={!!busy}
              className={`press-btn rounded-xl border-2 border-amber-200 bg-amber-50 font-semibold text-amber-900 disabled:opacity-50 ${
                big ? "px-4 py-3 text-base" : "px-3 py-2 text-sm"}`}>
              {o.emoji} {o.title} <span className="text-amber-600 font-bold">+{o.points}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
