import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Camera, Check, ChevronLeft, ChevronRight, Lock, Clock, PartyPopper, Play } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { cacheGet, cacheSet } from "@/lib/localCache";
import { todayKey, shiftDateKey, humanDateKey } from "@/lib/dates";
import { enqueue, isNetworkError, haptic } from "@/lib/offlineQueue";
import PageSkeleton from "@/components/PageSkeleton";
import { fileToDownscaledDataUrl } from "@/lib/imageUpload";

/**
 * The child's day as a handful of sections, each a checklist.
 *
 * A section opens at its start time. The child taps Mulai, ticks activities in
 * any order, and taps Selesai once everything required is ticked. Lateness is
 * only ever judged at the two ends — starting past the grace window, or
 * finishing past the end time — and the end time never moves.
 */
export default function SegmentQuestView({ child, onCelebrate }) {
  const [dateKey, setDateKey] = useState(todayKey());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);          // segment id currently acting
  const [reasonFor, setReasonFor] = useState(null); // { segment, action }

  const cacheKey = child?.id ? `segday:${child.id}:${dateKey}` : null;

  const load = useCallback(async () => {
    if (!child?.id) return;
    const cached = cacheKey ? cacheGet(cacheKey) : null;
    if (cached) { setData(cached); setLoading(false); } else { setLoading(true); }
    try {
      const { data: d } = await api.get(`/children/${child.id}/segments-day`, { params: { date_key: dateKey } });
      setData(d);
      if (cacheKey) cacheSet(cacheKey, d);
    } catch (e) {
      if (!cached) toast.error(formatApiError(e));
    } finally {
      setLoading(false);
    }
  }, [child?.id, dateKey, cacheKey]);

  useEffect(() => { load(); }, [load]);

  // Keep "locked → ready" and lateness honest without the child refreshing.
  useEffect(() => {
    if (dateKey !== todayKey()) return undefined;
    const t = setInterval(() => { if (!document.hidden) load(); }, 60000);
    return () => clearInterval(t);
  }, [dateKey, load]);

  const body = (seg, extra = {}) => ({
    child_id: child.id, date_key: dateKey, segment_id: seg.id, ...extra,
  });

  // A refusal usually means the screen was a step behind — re-sync quietly.
  const onFail = async (e, seg, action) => {
    const detail = e?.response?.data?.detail;
    if (detail === "LATE_REASON_REQUIRED") {
      setReasonFor({ segment: seg, action });
      load(); // undo the optimistic status while the child picks a reason
      return;
    }
    await load();
    toast(formatApiError(e), { duration: 4000 });
  };

  const start = async (seg, lateReasonId) => {
    if (seg.late_start && !lateReasonId) {
      setReasonFor({ segment: seg, action: "start" });
      return;
    }
    setBusy(seg.id);
    setSegStatus(seg.id, "in_progress");
    try {
      await api.post("/segment-sessions/start", body(seg, lateReasonId ? { late_reason_id: lateReasonId } : {}));
      toast.success(`${seg.label} dimulai. Semangat! 💪`);
      await load();
    } catch (e) { await onFail(e, seg, "start"); }
    finally { setBusy(null); }
  };

  const finish = async (seg, lateReasonId) => {
    if (seg.late_finish && !seg.start_late && !lateReasonId) {
      setReasonFor({ segment: seg, action: "finish" });
      return;
    }
    setBusy(seg.id);
    setSegStatus(seg.id, "done");
    try {
      const { data: r } = await api.post(
        "/segment-sessions/finish", body(seg, lateReasonId ? { late_reason_id: lateReasonId } : {})
      );
      haptic([20, 40, 20]);
      onCelebrate?.();
      toast.success(
        r.no_points
          ? `${seg.label} selesai — kali ini tanpa poin.`
          : `${seg.label} selesai! 🎉`
      );
      await load();
    } catch (e) { await onFail(e, seg, "finish"); }
    finally { setBusy(null); }
  };

  const patchPhoto = (segId, actId, patch) =>
    setData((d) => d && {
      ...d,
      segments: d.segments.map((s) => s.id !== segId ? s : {
        ...s, activities: s.activities.map((a) => a.id === actId ? { ...a, ...patch } : a),
      }),
    });

  // Start/finish show their new state at once; a refusal re-syncs via onFail.
  const setSegStatus = (segId, status) =>
    setData((d) => d && { ...d, segments: d.segments.map((s) => s.id === segId ? { ...s, status } : s) });

  // Ticks update on screen instantly and roll back if the server refuses.
  const patchActivity = (segId, actId, checked) =>
    setData((d) => d && {
      ...d,
      segments: d.segments.map((s) => s.id !== segId ? s : {
        ...s,
        activities: s.activities.map((a) => a.id === actId ? { ...a, checked } : a),
        checked_required: s.activities.filter((a) =>
          !a.is_bonus && (a.id === actId ? checked : a.checked)).length,
      }),
    });

  const toggle = async (seg, act) => {
    const next = !act.checked;
    patchActivity(seg.id, act.id, next);
    if (next) haptic();
    try {
      await api.post(`/tasks/${act.id}/check`, { checked: next });
    } catch (e) {
      if (isNetworkError(e)) {
        // No connection: keep the tick and send it when we're back online.
        enqueue(`/tasks/${act.id}/check`, { checked: next });
        toast("Tersimpan di HP — dikirim otomatis saat internet kembali 📶", { duration: 3000 });
        return;
      }
      patchActivity(seg.id, act.id, !next);
      await onFail(e, seg, "check");
    }
  };

  // Queued ticks reached the server: show the server's view again.
  useEffect(() => {
    const onFlushed = () => load();
    window.addEventListener("app:offline-flushed", onFlushed);
    return () => window.removeEventListener("app:offline-flushed", onFlushed);
  }, [load]);

  const toggleAll = async (seg, checked) => {
    setData((d) => d && {
      ...d,
      segments: d.segments.map((s) => s.id !== seg.id ? s : {
        ...s,
        activities: s.activities.map((a) => ({ ...a, checked })),
        checked_required: checked ? s.required_count : 0,
      }),
    });
    try {
      await api.post("/segment-sessions/check-all", body(seg, { checked }));
    } catch (e) { await onFail(e, seg, "check"); }
  };

  const pickReason = (reasonId) => {
    const r = reasonFor;
    setReasonFor(null);
    if (!r) return;
    if (r.action === "start") start(r.segment, reasonId);
    else if (r.action === "finish") finish(r.segment, reasonId);
  };

  const fmtTime = (iso) => {
    try {
      return new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
    } catch { return ""; }
  };

  const quick = [
    { label: "Kemarin", key: shiftDateKey(todayKey(), -1) },
    { label: "Hari Ini", key: todayKey() },
    { label: "Besok", key: shiftDateKey(todayKey(), 1) },
  ];

  return (
    <div className="space-y-4">
      {/* Date bar */}
      <div className="flex items-center gap-1.5 bg-white rounded-2xl px-2.5 py-2 border-2 border-slate-100 chunky-shadow overflow-x-auto">
        <button onClick={() => setDateKey(shiftDateKey(dateKey, -1))} aria-label="Hari sebelumnya"
                className="press-btn shrink-0 w-8 h-8 rounded-full border-2 border-slate-200 text-slate-500 flex items-center justify-center">
          <ChevronLeft className="w-4 h-4" strokeWidth={2.5} />
        </button>
        {quick.map((q) => (
          <button key={q.label} onClick={() => setDateKey(q.key)}
                  className={`press-btn shrink-0 font-fun font-bold px-3 py-1.5 rounded-xl text-xs ${
                    dateKey === q.key ? "bg-indigo-500 text-white" : "bg-slate-50 text-slate-600"}`}>
            {q.label}
          </button>
        ))}
        <button onClick={() => setDateKey(shiftDateKey(dateKey, 1))} aria-label="Hari berikutnya"
                className="press-btn shrink-0 w-8 h-8 rounded-full border-2 border-slate-200 text-slate-500 flex items-center justify-center">
          <ChevronRight className="w-4 h-4" strokeWidth={2.5} />
        </button>
        <input type="date" value={dateKey} onChange={(e) => e.target.value && setDateKey(e.target.value)}
               className="shrink-0 px-2 py-1.5 rounded-xl border-2 border-slate-200 text-xs bg-white" aria-label="Pilih tanggal" />
        {!quick.some((q) => q.key === dateKey) && (
          <span className="shrink-0 text-[11px] font-semibold text-slate-500 pl-1">{humanDateKey(dateKey)}</span>
        )}
      </div>

      {loading && !data && <PageSkeleton compact rows={2} />}

      {data && data.segments.length === 0 && (
        <div className="bg-white rounded-3xl p-6 text-center text-slate-500 border-2 border-slate-100">
          Belum ada aktivitas untuk hari ini 🌤️
        </div>
      )}

      {data?.segments.map((seg) => {
        const allDone = seg.required_count > 0 && seg.checked_required >= seg.required_count;
        const anyUnticked = seg.activities.some((a) => !a.checked);
        const running = seg.status === "in_progress";
        const done = seg.status === "done";
        return (
          <motion.div key={seg.id} layout
            className={`rounded-3xl border-2 p-4 bg-white chunky-shadow ${
              done ? "border-emerald-200" : running ? "border-indigo-300" : "border-slate-100"}`}>
            {/* Header */}
            <div className="flex items-start gap-2 mb-3">
              <div className="text-2xl leading-none">{seg.emoji || "🕒"}</div>
              <div className="flex-1 min-w-0">
                <div className="font-fun font-bold text-slate-900 text-lg leading-tight">{seg.label}</div>
                {seg.start_time && (
                  <div className="text-xs text-slate-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {seg.start_time} – {seg.end_time}
                    <span className="text-slate-400">· toleransi {data.grace_minutes} mnt</span>
                  </div>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="font-fun font-bold text-slate-700 text-sm">{seg.checked_required}/{seg.required_count}</div>
                <div className="text-[10px] text-indigo-600 font-semibold">+{seg.points_total} poin</div>
              </div>
            </div>

            {/* Status line */}
            {seg.status === "locked" && (
              <div className="text-xs text-slate-500 bg-slate-50 rounded-xl px-3 py-2 mb-3 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5" /> {seg.start_time ? `Mulai jam ${seg.start_time}` : "Belum waktunya"}
              </div>
            )}
            {seg.status === "ready" && seg.late_start && (
              <div className="text-xs text-amber-800 bg-amber-50 rounded-xl px-3 py-2 mb-3">
                Sudah lewat batas toleransi — saat mulai, kamu akan diminta memilih alasannya.
              </div>
            )}
            {running && seg.late_finish && (
              <div className="text-xs text-amber-800 bg-amber-50 rounded-xl px-3 py-2 mb-3">
                Sudah lewat jam {seg.end_time} — selesaikan secepatnya ya.
              </div>
            )}
            {done && (
              <div className={`text-xs rounded-xl px-3 py-2 mb-3 ${
                seg.no_points ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
                ✅ Selesai jam {fmtTime(seg.completed_at)}
                {(seg.start_late || seg.finish_late) && seg.late_reason_label && ` · terlambat: ${seg.late_reason_label}`}
                {seg.no_points && " · tanpa poin"}
              </div>
            )}

            {/* Checklist */}
            <div className="space-y-1.5">
              {seg.activities.map((a) => {
                const canTick = running;
                return (
                  <div key={a.id} className="space-y-1.5">
                  <button type="button" disabled={!canTick}
                    onClick={() => canTick && toggle(seg, a)}
                    className={`w-full flex items-center gap-3 rounded-2xl border-2 px-3 py-2.5 text-left transition-colors ${
                      a.checked ? "border-emerald-200 bg-emerald-50/60" : "border-slate-100 bg-white"
                    } ${canTick ? "press-btn hover:border-indigo-200" : "opacity-70 cursor-default"}`}>
                    <span className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 ${
                      a.checked ? "bg-emerald-500 border-emerald-500" : "border-slate-300 bg-white"}`}>
                      {a.checked && <Check className="w-4 h-4 text-white pop-check" strokeWidth={3} />}
                    </span>
                    <span className={`flex-1 min-w-0 font-semibold text-sm ${
                      a.checked ? "text-slate-500 line-through" : "text-slate-800"}`}>
                      {a.title}
                      {a.is_bonus && <span className="ml-1.5 text-[10px] text-amber-600 font-bold">BONUS</span>}
                    </span>
                    <span className="text-[11px] font-bold text-indigo-600 shrink-0">+{a.points}</span>
                  </button>
                  {(a.photo_required || a.before_photo_url || a.completion_photo_url) && (
                    <PhotoRow activity={a} canEdit={running && a.status !== "approved"}
                              onSaved={(patch) => patchPhoto(seg.id, a.id, patch)} />
                  )}
                  </div>
                );
              })}
            </div>

            {/* Actions */}
            {seg.status === "ready" && (
              <button onClick={() => start(seg)} disabled={busy === seg.id}
                className="press-btn mt-3 w-full py-3 rounded-2xl font-fun font-bold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center gap-2 disabled:opacity-60">
                <Play className="w-4 h-4" /> {busy === seg.id ? "Memulai…" : `Mulai ${seg.label}`}
              </button>
            )}
            {running && (
              <div className="mt-3 flex gap-2">
                <button onClick={() => toggleAll(seg, anyUnticked)}
                  className="press-btn px-3 py-3 rounded-2xl font-fun font-bold border-2 border-slate-200 text-slate-600 text-sm">
                  {anyUnticked ? "Centang semua" : "Hapus centang"}
                </button>
                <button onClick={() => finish(seg)} disabled={!allDone || busy === seg.id}
                  className="press-btn flex-1 py-3 rounded-2xl font-fun font-bold bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                  <PartyPopper className="w-4 h-4" />
                  {busy === seg.id ? "Menyimpan…" : allDone ? "Selesai" : `Centang ${seg.required_count - seg.checked_required} lagi`}
                </button>
              </div>
            )}
          </motion.div>
        );
      })}

      {/* Lateness reason picker */}
      {reasonFor && data && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setReasonFor(null)}>
          <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-3xl p-5 max-w-sm w-full chunky-shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="text-3xl mb-1">🕐</div>
            <h3 className="font-fun font-bold text-lg text-slate-900 mb-1">Kenapa terlambat?</h3>
            <p className="text-xs text-slate-500 mb-3">
              {reasonFor.action === "start"
                ? `Kamu memulai ${reasonFor.segment.label} lewat dari batas toleransi.`
                : `${reasonFor.segment.label} diselesaikan lewat dari jam ${reasonFor.segment.end_time}.`}{" "}
              Pilih alasan yang paling jujur ya.
            </p>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {(data.late_reasons || []).length === 0 && (
                <div className="text-sm text-slate-400 text-center py-4">Belum ada pilihan alasan. Minta Abi/Ummi mengaturnya dulu.</div>
              )}
              {(data.late_reasons || []).map((r) => (
                <button key={r.id} onClick={() => pickReason(r.id)}
                  className={`press-btn w-full text-left px-3 py-2.5 rounded-2xl border-2 ${
                    r.gives_penalty_card ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}`}>
                  <div className="font-fun font-bold text-sm text-slate-800">{r.label}</div>
                  <div className={`text-[11px] ${r.gives_penalty_card ? "text-red-600" : "text-emerald-700"}`}>
                    {r.gives_penalty_card ? "Dapat Kartu Hukuman" : "Dimaklumi"} · {r.award_points ? "poin tetap utuh" : "tanpa poin"}
                  </div>
                </button>
              ))}
            </div>
            <button onClick={() => setReasonFor(null)}
              className="press-btn w-full mt-3 py-2.5 rounded-xl font-fun font-bold border-2 border-slate-200 text-slate-600">
              Batal
            </button>
          </motion.div>
        </div>
      )}
    </div>
  );
}


/**
 * "Sebelum" and "Sesudah" photos for a mission — e.g. a messy room and the
 * tidied one. Pictures are shrunk on the phone before upload.
 */
function PhotoRow({ activity, canEdit, onSaved }) {
  const [busy, setBusy] = useState(null);
  const upload = async (kind, file) => {
    if (!file) return;
    setBusy(kind);
    try {
      const dataUrl = await fileToDownscaledDataUrl(file, { maxDim: 960, quality: 0.78 });
      const { data } = await api.post(`/tasks/${activity.id}/photo`, { kind, photo_url: dataUrl });
      onSaved({ before_photo_url: data.before_photo_url, completion_photo_url: data.completion_photo_url });
      toast.success(kind === "before" ? "Foto sebelum tersimpan 📸" : "Foto sesudah tersimpan ✨");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(null);
    }
  };
  const slot = (kind, label, url) => (
    <label className={`flex-1 flex items-center gap-2 rounded-xl border-2 border-dashed px-2 py-1.5 text-xs font-semibold ${
      url ? "border-emerald-200 bg-emerald-50/50 text-emerald-700" : "border-slate-200 text-slate-500"} ${
      canEdit ? "cursor-pointer hover:border-indigo-300" : "opacity-70"}`}>
      {url
        ? <img src={url} alt={label} className="w-8 h-8 rounded-lg object-cover" />
        : <Camera className="w-4 h-4" />}
      <span>{busy === kind ? "Mengunggah…" : label}</span>
      {canEdit && (
        <input type="file" accept="image/*" capture="environment" className="sr-only"
               onChange={(e) => upload(kind, e.target.files?.[0])} disabled={!!busy} />
      )}
    </label>
  );
  return (
    <div className="flex gap-2 pl-9">
      {slot("before", "Foto sebelum", activity.before_photo_url)}
      {slot("after", activity.photo_required ? "Foto sesudah (wajib)" : "Foto sesudah", activity.completion_photo_url)}
    </div>
  );
}
