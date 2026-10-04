import { useCallback, useEffect, useState } from "react";
import { Inbox, Check, X } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { humanDateKey, todayKey } from "@/lib/dates";
import { correctTask } from "@/lib/honesty";
import { fetchInbox, cachedInbox } from "@/lib/inbox";

const REQUEST_LABELS = {
  money: { label: "Tukar uang", view: "money" },
  rewards: { label: "Hadiah", view: "rewards" },
  charity: { label: "Sedekah", view: "money" },
  pet_reset: { label: "Reset hewan", view: "settings" },
  reward_ideas: { label: "Usulan hadiah", view: "rewards" },
};

const btn = "press-btn inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50";
const okBtn = `${btn} bg-emerald-500 hover:bg-emerald-600 text-white`;
const noBtn = `${btn} bg-white border border-rose-200 text-rose-600 hover:bg-rose-50`;
const plainBtn = `${btn} bg-white border border-slate-200 text-slate-600 hover:bg-slate-50`;

/**
 * "Perlu perhatian" — everything waiting on a parent, in one list, each with
 * the action it needs right there: decide a late section, look at a surprise
 * photo, confirm a fix, read a reflection, approve a mission.
 */
export default function ParentInbox({ onNavigate, onCount }) {
  const [data, setData] = useState(() => cachedInbox());
  const [busy, setBusy] = useState(null);

  // The app shell does the polling; this list just shows what it fetched.
  const load = useCallback(async (force = true) => {
    try {
      const d = await fetchInbox(force);
      setData(d);
      onCount?.(d.total || 0);
    } catch { /* the rest of the page still works */ }
  }, [onCount]);

  useEffect(() => { load(false); }, [load]);
  useEffect(() => {
    const onData = (e) => { setData(e.detail); onCount?.(e.detail?.total || 0); };
    const onRefresh = () => load(true);
    window.addEventListener("app:inbox-updated", onData);
    window.addEventListener("app:parent-refresh", onRefresh);
    return () => {
      window.removeEventListener("app:inbox-updated", onData);
      window.removeEventListener("app:parent-refresh", onRefresh);
    };
  }, [load, onCount]);

  const act = async (key, fn, msg) => {
    setBusy(key);
    try {
      const r = await fn();
      if (msg) toast.success(typeof msg === "function" ? msg(r?.data) : msg);
      await load();
      window.dispatchEvent(new Event("app:parent-refresh"));
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(null);
    }
  };

  if (!data) return null;
  const items = data.items || [];
  const reqs = Object.entries(data.requests || {}).filter(([, n]) => n > 0);

  if (!items.length && !reqs.length) {
    return (
      <div className="bg-emerald-50 border-2 border-emerald-100 rounded-2xl px-5 py-4 flex items-center gap-3">
        <span className="text-2xl">🌿</span>
        <div>
          <div className="font-parent font-bold text-emerald-900">Semua beres</div>
          <div className="text-xs text-emerald-700">Tidak ada yang menunggu keputusanmu saat ini.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border-2 border-indigo-100 p-4 sm:p-5 space-y-3" data-testid="parent-inbox">
      <div className="flex items-center gap-2">
        <Inbox className="w-5 h-5 text-indigo-600" />
        <h3 className="font-parent font-bold text-lg text-slate-900">Perlu perhatian</h3>
        <span className="ml-auto text-xs font-bold bg-indigo-600 text-white px-2 py-0.5 rounded-full">{data.total}</span>
      </div>

      {reqs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {reqs.map(([k, n]) => (
            <button key={k} onClick={() => onNavigate?.(REQUEST_LABELS[k]?.view || "overview")}
              className="press-btn text-xs font-semibold px-3 py-1.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
              {REQUEST_LABELS[k]?.label || k}: {n} →
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {items.map((it, i) => {
          const key = `${it.kind}:${it.check_id || it.task_id || it.reflection_id || it.segment_id}:${it.child_id}:${it.date_key || ""}:${i}`;
          const b = busy === key;
          return (
            <div key={key} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
              <div className="flex items-start gap-2">
                <span className="text-lg leading-none" aria-hidden="true">{it.avatar_emoji || "🙂"}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-800">
                    <span className="text-slate-500 font-normal">{it.child_name} · </span>{it.title}
                    {it.date_key && it.date_key !== todayKey() && (
                      <span className="text-xs text-slate-400 font-normal"> · {humanDateKey(it.date_key)}</span>
                    )}
                  </div>
                  {it.detail && (
                    <div className={`text-xs text-slate-600 mt-0.5 ${it.kind === "reflection" || it.kind === "summary" ? "whitespace-pre-wrap" : ""} ${
                      it.kind === "summary" ? "line-clamp-4" : ""}`}>
                      {it.kind === "reflection" ? `“${it.detail}”` : it.detail}
                      {it.kind === "summary" && it.pasted && <span className="text-amber-600"> · ⚠️ ada yang ditempel</span>}
                    </div>
                  )}
                  {it.photo && (
                    <a href={it.photo} target="_blank" rel="noreferrer">
                      <img src={it.photo} alt="" loading="lazy" className="mt-2 w-32 h-32 rounded-xl object-cover border border-slate-200" />
                    </a>
                  )}
                  {it.kind === "overdue_section" && it.left?.length > 0 && (
                    <div className="text-xs text-slate-500 mt-1">Belum: {it.left.map((t) => t.title).join(", ")}</div>
                  )}
                  {it.kind === "suspicious" && it.tasks?.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {it.tasks.map((t) => (
                        <div key={t.id} className="flex items-center gap-2 text-xs">
                          <span className="flex-1 min-w-0 truncate text-slate-700">{t.title}</span>
                          <button className={noBtn} disabled={b}
                            onClick={() => act(key, () => correctTask(t))}>Tidak dikerjakan</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-2 mt-2 flex-wrap pl-7">
                {it.kind === "overdue_section" && (<>
                  <button className={noBtn} disabled={b || !it.left?.length}
                    onClick={() => act(key, () => api.post("/family/overdue-sections/resolve", {
                      child_id: it.child_id, date_key: it.date_key, segment_id: it.segment_id, action: "miss" }),
                    (d) => `${d?.missed ?? 0} tugas dicatat terlewat`)}>
                    <X className="w-3.5 h-3.5" /> Catat terlewat
                  </button>
                  <button className={plainBtn} disabled={b}
                    onClick={() => act(key, () => api.post("/family/overdue-sections/resolve", {
                      child_id: it.child_id, date_key: it.date_key, segment_id: it.segment_id, action: "dismiss" }), "Dibiarkan")}>
                    Biarkan
                  </button>
                </>)}
                {it.kind === "spot_check" && (<>
                  <button className={okBtn} disabled={b || it.status !== "answered"}
                    onClick={() => act(key, () => api.post(`/spot-checks/${it.check_id}/review`, { ok: true }),
                      (d) => `Lolos 👍 Anak dapat kejutan +${d?.surprise ?? 0} poin`)}>
                    <Check className="w-3.5 h-3.5" /> Sesuai
                  </button>
                  <button className={noBtn} disabled={b}
                    onClick={() => {
                      const note = window.prompt("Tidak sesuai — misi ini akan dikoreksi. Pesan untuk anak (opsional):", "");
                      if (note === null) return;
                      act(key, () => api.post(`/spot-checks/${it.check_id}/review`, { ok: false, note }), "Dikoreksi");
                    }}>
                    Tidak sesuai
                  </button>
                </>)}
                {it.kind === "redo_claimed" && (<>
                  <button className={okBtn} disabled={b}
                    onClick={() => act(key, () => api.post(`/corrections/${it.correction_id}/confirm-redo`, { ok: true }),
                      (d) => d?.refunded ? `Beres 👍 Minus ${d.refunded} poin dikembalikan` : "Beres 👍")}>
                    <Check className="w-3.5 h-3.5" /> Sudah beres
                  </button>
                  <button className={noBtn} disabled={b}
                    onClick={() => {
                      const note = window.prompt("Pesan untuk anak (opsional):", "");
                      if (note === null) return;
                      act(key, () => api.post(`/corrections/${it.correction_id}/confirm-redo`, { ok: false, note }), "Dikirim ke anak");
                    }}>
                    Belum beres
                  </button>
                </>)}
                {it.kind === "suspicious" && (
                  <button className={plainBtn} disabled={b}
                    onClick={() => act(key, () => api.post("/family/sections/ack", {
                      child_id: it.child_id, date_key: it.date_key, segment_id: it.segment_id }), "Ditandai aman")}>
                    <Check className="w-3.5 h-3.5" /> Sudah kucek, aman
                  </button>
                )}
                {it.kind === "approval" && (<>
                  <button className={okBtn} disabled={b}
                    onClick={() => act(key, () => api.post(`/tasks/${it.task_id}/approve`, {}), "Disetujui ⭐")}>
                    <Check className="w-3.5 h-3.5" /> Setujui
                  </button>
                  <button className={noBtn} disabled={b}
                    onClick={() => act(key, () => api.post(`/tasks/${it.task_id}/reject`, {}), "Ditolak")}>
                    Tolak
                  </button>
                </>)}
                {it.kind === "summary" && (<>
                  <button className={okBtn} disabled={b}
                    onClick={() => act(key, () => api.post(`/tasks/${it.task_id}/summary-review`, { verdict: "good", note: "" }), "Ditandai bagus 👍")}>
                    👍 Bagus
                  </button>
                  <button className={plainBtn} disabled={b}
                    onClick={() => {
                      const note = window.prompt("Pesan untuk anak (opsional):", "");
                      if (note === null) return;
                      act(key, () => api.post(`/tasks/${it.task_id}/summary-review`, { verdict: "redo", note }), "Diminta tulis ulang");
                    }}>
                    ✍️ Tulis ulang
                  </button>
                </>)}
                {it.kind === "reflection" && (
                  <button className={plainBtn} disabled={b}
                    onClick={() => act(key, () => api.post(`/reflections/${it.reflection_id}/read`), "Ditandai sudah dibaca")}>
                    <Check className="w-3.5 h-3.5" /> Sudah dibaca
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
