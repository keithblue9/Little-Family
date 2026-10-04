import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Volume2, Check, Play, PartyPopper, Lock } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { cacheGet, cacheSet } from "@/lib/localCache";
import { todayKey } from "@/lib/dates";
import { sendOrQueue, isNetworkError, enqueueSegmentAction, pendingCount, haptic } from "@/lib/offlineQueue";
import PageSkeleton from "@/components/PageSkeleton";
import SummaryBox from "@/components/SummaryBox";
import { StepsList, ReadingForm } from "@/components/MissionExtras";
import { withLiveClock } from "@/lib/segmentClock";

function speak(text) {
  try {
    const synth = window.speechSynthesis;
    if (!synth || !text) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "id-ID";
    u.rate = 0.9;
    u.pitch = 1.1;
    synth.speak(u);
  } catch { /* speech unavailable: the big text still works */ }
}

/**
 * Mode Sederhana — for children who can't comfortably read a checklist yet.
 * One thing on screen at a time, huge buttons, and every instruction can be
 * read aloud. Uses the same endpoints as the full checklist, so progress is
 * identical whichever view a parent picks.
 */
export default function SimpleQuestView({ child, onCelebrate, onUseFullView }) {
  const dateKey = todayKey();
  const cacheKey = `segday:${child.id}:${dateKey}`;
  const [data, setData] = useState(() => cacheGet(cacheKey));
  const [busy, setBusy] = useState(false);
  const lastSpoken = useRef("");

  const load = useCallback(async () => {
    try {
      const { data: d } = await api.get(`/children/${child.id}/segments-day`, { params: { date_key: dateKey } });
      setData(d);
      cacheSet(cacheKey, d);
    } catch (e) {
      if (!data) toast.error(formatApiError(e));
    }
  }, [child.id, dateKey, cacheKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onFlushed = () => load();
    const onDay = () => load();
    window.addEventListener("app:offline-flushed", onFlushed);
    window.addEventListener("app:day-refresh", onDay);
    return () => {
      window.removeEventListener("app:offline-flushed", onFlushed);
      window.removeEventListener("app:day-refresh", onDay);
    };
  }, [load]);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(); }, 60000);
    return () => clearInterval(t);
  }, [load]);

  const [clock, setClock] = useState(0);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) setClock((c) => c + 1); }, 30000);
    return () => clearInterval(t);
  }, []);
  const segments = useMemo(
    () => withLiveClock(data, dateKey)?.segments || [],
    [data, dateKey, clock], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const current = useMemo(
    () => segments.find((s) => s.status === "in_progress") || segments.find((s) => s.status === "ready"),
    [segments],
  );
  const nextLocked = segments.find((s) => s.status === "locked");
  const nextAct = current?.status === "in_progress"
    ? current.activities.find((a) => !a.checked)
    : null;
  const allTicked = current && current.status === "in_progress" && !nextAct;

  // Say what's on screen once, when it changes.
  const prompt = !current
    ? (nextLocked ? `Istirahat dulu ya. ${nextLocked.label} nanti jam ${nextLocked.start_time}.` : "Hebat! Semua misi hari ini sudah selesai!")
    : current.status === "ready"
      ? `Waktunya ${current.label}! Tekan tombol mulai.`
      : nextAct
        ? (nextAct.summary_required
          ? `${nextAct.title}. Lalu ceritakan apa yang sudah kamu pelajari.`
          : nextAct.title)
        : `Semua sudah! Tekan selesai.`;
  useEffect(() => {
    if (prompt && prompt !== lastSpoken.current) {
      lastSpoken.current = prompt;
      speak(prompt);
    }
  }, [prompt]);

  const body = (extra = {}) => ({ child_id: child.id, date_key: dateKey, segment_id: current.id, ...extra });

  const [reasonFor, setReasonFor] = useState(null); // "start" | "finish"

  const onFail = async (e, action) => {
    const detail = e?.response?.data?.detail;
    if (detail === "LATE_REASON_REQUIRED") {
      setReasonFor(action);
      return;
    }
    toast(formatApiError(e), { duration: 4000 });
    await load();
  };

  // Show a section's new state at once; with no connection it stays that way
  // (saved on the phone) and the action is sent once back online.
  const setStatus = (segId, status) =>
    setData((d) => d && { ...d, segments: d.segments.map((s) => s.id === segId ? { ...s, status } : s) });
  const queueOffline = (action, payload) => {
    enqueueSegmentAction(action, payload);
    setData((d) => { if (d) cacheSet(cacheKey, d); return d; });
    toast("Tersimpan di HP 📶", { duration: 2500, id: "offline" });
  };

  const start = async (reasonId) => {
    if (current.late_start && !reasonId) { setReasonFor("start"); return; }
    setBusy(true);
    const payload = body(reasonId ? { late_reason_id: reasonId } : {});
    try {
      haptic();
      setStatus(current.id, "in_progress");
      if (pendingCount() > 0) { queueOffline("start", payload); return; }
      await api.post("/segment-sessions/start", payload);
      await load();
    } catch (e) {
      if (isNetworkError(e)) queueOffline("start", payload);
      else await onFail(e, "start");
    } finally { setBusy(false); }
  };

  const tick = async () => {
    if (!nextAct) return;
    const act = nextAct;
    haptic();
    setData((d) => d && {
      ...d,
      segments: d.segments.map((s) => s.id !== current.id ? s : {
        ...s, activities: s.activities.map((a) => a.id === act.id ? { ...a, checked: true } : a),
      }),
    });
    try {
      const r = await sendOrQueue(`/tasks/${act.id}/check`, { checked: true });
      if (r?.queued) setData((d) => { if (d) cacheSet(cacheKey, d); return d; });
    } catch (e) {
      await onFail(e, "check");
    }
  };

  const finish = async (reasonId) => {
    if (current.late_finish && !current.start_late && !reasonId) { setReasonFor("finish"); return; }
    setBusy(true);
    const payload = body(reasonId ? { late_reason_id: reasonId } : {});
    const segId = current.id;
    const done = () => { haptic([20, 40, 20]); onCelebrate?.(); setStatus(segId, "done"); };
    try {
      if (pendingCount() > 0) { done(); queueOffline("finish", payload); return; }
      const { data: r } = await api.post("/segment-sessions/finish", payload);
      done();
      if (r?.spot_check) speak(`Cek kejutan! Kirim foto ${r.spot_check.title} ya.`);
      if (r?.pet_gift) toast(`🎁 Peliharaanmu ${r.pet_gift.text}`, { duration: 5000 });
      window.dispatchEvent(new Event("app:honesty-refresh"));
      window.dispatchEvent(new Event("app:pet-refresh"));
      await load();
    } catch (e) {
      if (isNetworkError(e)) { done(); queueOffline("finish", payload); }
      else await onFail(e, "finish");
    } finally { setBusy(false); }
  };

  const pickReason = (id) => {
    const action = reasonFor;
    setReasonFor(null);
    if (action === "start") start(id);
    else if (action === "finish") finish(id);
  };

  useEffect(() => {
    if (reasonFor) speak("Kenapa terlambat? Pilih alasan yang paling jujur ya.");
  }, [reasonFor]);

  if (!data) return <PageSkeleton compact rows={1} />;

  const doneCount = current ? current.activities.filter((a) => a.checked).length : 0;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-[2rem] border-4 border-indigo-100 chunky-shadow-lg p-6 text-center min-h-[22rem] flex flex-col items-center justify-center gap-5">
        {!current ? (
          <>
            <div className="text-7xl" aria-hidden="true">{nextLocked ? "😴" : "🏆"}</div>
            <div className="font-fun font-bold text-3xl text-slate-900">
              {nextLocked ? "Istirahat dulu" : "Semua selesai!"}
            </div>
            {nextLocked && (
              <div className="text-xl text-slate-500 flex items-center gap-2">
                <Lock className="w-6 h-6" /> {nextLocked.label} · {nextLocked.start_time}
              </div>
            )}
          </>
        ) : current.status === "ready" ? (
          <>
            <div className="text-7xl" aria-hidden="true">🚀</div>
            <div className="font-fun font-bold text-3xl text-slate-900">{current.label}</div>
            <button onClick={() => start()} disabled={busy}
                    className="press-btn w-full max-w-xs py-6 rounded-3xl bg-indigo-600 text-white font-fun font-bold text-3xl flex items-center justify-center gap-3 disabled:opacity-60">
              <Play className="w-9 h-9" /> Mulai
            </button>
          </>
        ) : nextAct ? (
          <>
            <div className="text-sm font-bold text-indigo-500 uppercase tracking-wide">{current.label}</div>
            <div className="font-fun font-bold text-4xl leading-tight text-slate-900 break-words">{nextAct.title}</div>
            <button onClick={() => speak(nextAct.title)} aria-label="Dengarkan"
                    className="press-btn w-16 h-16 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
              <Volume2 className="w-8 h-8" />
            </button>
            {(nextAct.steps || []).length > 0 ? (
              <div className="w-full text-left">
                <StepsList big activity={nextAct} canEdit onChange={(patch) => {
                  setData((d) => {
                    const nd = d && { ...d, segments: d.segments.map((sg) => sg.id !== current.id ? sg : {
                      ...sg, activities: sg.activities.map((x) => x.id === nextAct.id ? { ...x, ...patch } : x),
                    }) };
                    if (nd) cacheSet(cacheKey, nd);
                    return nd;
                  });
                }} />
              </div>
            ) : nextAct.reading ? (
              <div className="w-full text-left">
                <ReadingForm big activity={nextAct} onSaved={(patch) => {
                  haptic();
                  setData((d) => {
                    const nd = d && { ...d, segments: d.segments.map((sg) => sg.id !== current.id ? sg : {
                      ...sg, activities: sg.activities.map((x) => x.id === nextAct.id ? { ...x, ...patch } : x),
                    }) };
                    if (nd) cacheSet(cacheKey, nd);
                    return nd;
                  });
                }} />
              </div>
            ) : nextAct.summary_required ? (
              <div className="w-full text-left">
                <SummaryBox big activity={nextAct} onSaved={(txt) => {
                  haptic();
                  setData((d) => {
                    const nd = d && { ...d, segments: d.segments.map((sg) => sg.id !== current.id ? sg : {
                      ...sg, activities: sg.activities.map((x) => x.id === nextAct.id
                        ? { ...x, checked: true, summary_text: txt } : x),
                    }) };
                    if (nd) cacheSet(cacheKey, nd);
                    return nd;
                  });
                }} />
              </div>
            ) : (
              <button onClick={tick}
                      className="press-btn w-full max-w-xs py-6 rounded-3xl bg-emerald-500 text-white font-fun font-bold text-3xl flex items-center justify-center gap-3">
                <Check className="w-10 h-10" strokeWidth={3} /> Sudah!
              </button>
            )}
          </>
        ) : allTicked ? (
          <>
            <div className="text-7xl" aria-hidden="true">🎉</div>
            <div className="font-fun font-bold text-3xl text-slate-900">Semua sudah!</div>
            <button onClick={() => finish()} disabled={busy}
                    className="press-btn w-full max-w-xs py-6 rounded-3xl bg-orange-500 text-white font-fun font-bold text-3xl flex items-center justify-center gap-3 disabled:opacity-60">
              <PartyPopper className="w-9 h-9" /> Selesai
            </button>
          </>
        ) : null}

        {current && current.activities.length > 0 && (
          <div className="flex gap-2 flex-wrap justify-center" aria-label={`${doneCount} dari ${current.activities.length} selesai`}>
            {current.activities.map((a) => (
              <span key={a.id} className={`w-4 h-4 rounded-full ${a.checked ? "bg-emerald-500" : "bg-slate-200"}`} />
            ))}
          </div>
        )}
      </div>
      {reasonFor && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-[2rem] p-5 w-full max-w-sm space-y-3">
            <div className="text-5xl text-center" aria-hidden="true">🕐</div>
            <div className="font-fun font-bold text-2xl text-center text-slate-900">Kenapa terlambat?</div>
            {(data.late_reasons || []).length === 0 && (
              <div className="text-center text-slate-500">Minta bantuan Abi/Ummi ya 🙂</div>
            )}
            {(data.late_reasons || []).map((r) => (
              <button key={r.id} onClick={() => pickReason(r.id)} onPointerEnter={() => speak(r.label)}
                      className={`press-btn w-full py-4 rounded-2xl font-fun font-bold text-xl border-4 ${
                        r.gives_penalty_card ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                {r.label}
              </button>
            ))}
            <button onClick={() => setReasonFor(null)} className="w-full py-3 text-slate-500 font-semibold">Batal</button>
          </div>
        </div>
      )}
      {onUseFullView && (
        <button onClick={onUseFullView} className="w-full text-center text-sm text-slate-400 underline">
          Tampilan lengkap
        </button>
      )}
    </div>
  );
}
