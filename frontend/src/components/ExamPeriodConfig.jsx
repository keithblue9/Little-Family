import { useEffect, useState } from "react";
import { BookOpen, Plus, Trash2, X, Check } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { todayKey, shiftDateKey, humanDateKey } from "@/lib/dates";

/**
 * Exam weeks break the normal rhythm: studying runs long, and everything after
 * it — dinner, shower, bedtime — shifts with it. Rather than have a child fight
 * the clock (or quietly cheat it), a period can be declared and the timing
 * rules stand down from a chosen "pivot" mission to the end of each study day.
 *
 * Either side can raise it and it takes effect immediately, because asking a
 * child to wait for approval on the very evening they need to study defeats the
 * point. A parent who finds the claim untrue rejects it, and the configured
 * penalty applies.
 */
export default function ExamPeriodConfig({ kids = [], onChanged }) {
  const [items, setItems] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [open, setOpen] = useState(false);
  const [childId, setChildId] = useState("");
  const [examStart, setExamStart] = useState(shiftDateKey(todayKey(), 1));
  const [examEnd, setExamEnd] = useState(shiftDateKey(todayKey(), 3));
  const [flexStart, setFlexStart] = useState("");
  const [flexEnd, setFlexEnd] = useState("");
  const [pivots, setPivots] = useState([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const [{ data }, { data: t }] = await Promise.all([
        api.get("/exam-periods"),
        api.get("/tasks").catch(() => ({ data: [] })),
      ]);
      setItems(data || []);
      setTasks(t || []);
    } catch { /* non-fatal */ }
  };
  useEffect(() => { load(); }, []);

  // Distinct mission titles for the chosen child — the pivot is picked from
  // what actually exists, so there's nothing to type or misspell.
  const titlesFor = (cid) => {
    const seen = new Set();
    for (const t of tasks) {
      const mine = t.child_id === cid || (t.is_coop && (t.coop_participants || []).includes(cid));
      if (mine && t.title) seen.add(t.title);
    }
    return [...seen].sort();
  };

  const derivedFlex = () => ({
    start: flexStart || (examStart ? shiftDateKey(examStart, -1) : ""),
    end: flexEnd || (examEnd ? shiftDateKey(examEnd, -1) : ""),
  });

  const submit = async () => {
    if (!childId) return toast.error("Pilih anaknya dulu");
    if (!examStart || !examEnd) return toast.error("Isi tanggal ujiannya");
    if (examEnd < examStart) return toast.error("Tanggal selesai ujian harus sesudah tanggal mulai");
    setSaving(true);
    try {
      await api.post("/exam-periods", {
        child_id: childId,
        exam_start: examStart,
        exam_end: examEnd,
        flex_start: flexStart || null,
        flex_end: flexEnd || null,
        pivot_task_titles: pivots,
        note: note.trim(),
      });
      toast.success("Hari Ujian didaftarkan");
      setOpen(false); setPivots([]); setNote(""); setFlexStart(""); setFlexEnd("");
      load();
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const reject = async (x) => {
    if (!window.confirm(
      `Tolak Hari Ujian ${x.child_name}?\n\nPoinnya akan dikurangi sesuai pengaturan, dan keringanan waktunya dihentikan.`
    )) return;
    try {
      const { data } = await api.post(`/exam-periods/${x.id}/reject`, { note: "" });
      toast.success(`Ditolak — poin dikurangi ${data.penalty_points}`);
      load();
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const remove = async (x) => {
    if (!window.confirm(`Hapus Hari Ujian ${x.child_name}?`)) return;
    try {
      await api.delete(`/exam-periods/${x.id}`);
      toast.success("Dihapus");
      load();
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const flex = derivedFlex();

  return (
    <div>
      <h3 className="font-parent font-bold text-lg text-slate-900 mb-1 flex items-center gap-2">
        <BookOpen className="w-5 h-5 text-violet-600" /> Hari Ujian
      </h3>
      <p className="text-sm text-slate-500 mb-4">
        Saat ujian, belajar bisa molor dan seluruh rutinitas setelahnya ikut mundur. Tandai periodenya, lalu
        aturan waktu berhenti menghakimi mulai dari misi yang kamu pilih sampai akhir hari. Hari belajar otomatis
        diambil H-1 dari rentang ujian.
      </p>

      {items.length > 0 && (
        <div className="space-y-2 mb-4">
          {items.map((x) => (
            <div
              key={x.id}
              className={`rounded-2xl border-2 p-3 ${
                x.status === "rejected" ? "border-slate-200 bg-slate-50" : "border-violet-200 bg-violet-50"
              }`}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-800 text-sm">
                    {x.child_name} · ujian {humanDateKey(x.exam_start)} – {humanDateKey(x.exam_end)}
                    {x.status === "rejected" && (
                      <span className="ml-1.5 text-[10px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full">
                        ditolak −{x.penalty_points}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Belajar longgar: {humanDateKey(x.flex_start)} – {humanDateKey(x.flex_end)}
                    {x.pivot_task_titles?.length ? ` · mulai dari "${x.pivot_task_titles.join('", "')}"` : " · seharian"}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {x.note ? `"${x.note}" · ` : ""}didaftarkan {x.created_by || "?"}
                    {x.created_by_role === "child" ? " (anak)" : ""}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {x.status !== "rejected" && (
                    <button
                      onClick={() => reject(x)}
                      className="press-btn p-1.5 rounded-lg hover:bg-red-100 text-red-500"
                      title="Tolak — poin dikurangi"
                    >
                      <X className="w-4 h-4" strokeWidth={2.5} />
                    </button>
                  )}
                  <button
                    onClick={() => remove(x)}
                    className="press-btn p-1.5 rounded-lg hover:bg-slate-200 text-slate-400"
                    title="Hapus"
                  >
                    <Trash2 className="w-4 h-4" strokeWidth={2.5} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="press-btn inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-semibold px-4 py-2 rounded-xl text-sm"
        >
          <Plus className="w-4 h-4" /> Tandai Hari Ujian
        </button>
      ) : (
        <div className="bg-violet-50 border-2 border-violet-100 rounded-2xl p-4 max-w-lg">
          <label className="text-xs font-bold text-slate-600 block mb-1">Untuk anak</label>
          <select
            value={childId}
            onChange={(e) => { setChildId(e.target.value); setPivots([]); }}
            className="w-full px-3 py-2 rounded-xl border-2 border-violet-200 text-sm bg-white mb-3"
          >
            <option value="">— pilih anak —</option>
            {kids.map((k) => (
              <option key={k.id} value={k.id}>{k.avatar_emoji || "🙂"} {k.name}</option>
            ))}
          </select>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1">Ujian mulai</label>
              <input type="date" value={examStart} onChange={(e) => setExamStart(e.target.value)}
                     className="w-full px-2 py-2 rounded-xl border-2 border-violet-200 text-sm bg-white" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1">Ujian selesai</label>
              <input type="date" value={examEnd} onChange={(e) => setExamEnd(e.target.value)}
                     className="w-full px-2 py-2 rounded-xl border-2 border-violet-200 text-sm bg-white" />
            </div>
          </div>

          <p className="text-[11px] text-violet-700 mt-2">
            📚 Hari belajar longgar otomatis: <b>{flex.start ? humanDateKey(flex.start) : "—"}</b> sampai{" "}
            <b>{flex.end ? humanDateKey(flex.end) : "—"}</b> (H-1 tiap hari ujian).
          </p>

          <details className="mt-2">
            <summary className="text-[11px] text-slate-500 cursor-pointer">Atur sendiri rentang belajarnya</summary>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <input type="date" value={flexStart} onChange={(e) => setFlexStart(e.target.value)}
                     className="w-full px-2 py-2 rounded-xl border-2 border-slate-200 text-sm bg-white" />
              <input type="date" value={flexEnd} onChange={(e) => setFlexEnd(e.target.value)}
                     className="w-full px-2 py-2 rounded-xl border-2 border-slate-200 text-sm bg-white" />
            </div>
          </details>

          {childId && (
            <div className="mt-3">
              <label className="text-xs font-bold text-slate-600 block mb-1">
                Mulai longgar dari misi (boleh lebih dari satu)
              </label>
              <div className="max-h-36 overflow-y-auto space-y-1 bg-white rounded-xl border-2 border-violet-200 p-2">
                {titlesFor(childId).length === 0 && (
                  <div className="text-[11px] text-slate-400">Belum ada misi untuk anak ini.</div>
                )}
                {titlesFor(childId).map((t) => (
                  <label key={t} className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={pivots.includes(t)}
                      onChange={(e) =>
                        setPivots((p) => (e.target.checked ? [...p, t] : p.filter((x) => x !== t)))
                      }
                      className="w-4 h-4 accent-violet-600"
                    />
                    <span className="text-xs text-slate-700">{t}</span>
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Dikosongkan = seharian longgar. Biasanya cukup pilih misi belajarnya saja.
              </p>
            </div>
          )}

          <input
            value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))}
            placeholder="Catatan (opsional), mis. PAS Ganjil"
            className="w-full mt-3 px-3 py-2 rounded-xl border-2 border-violet-200 text-sm bg-white"
          />

          <div className="flex gap-2 mt-3">
            <button
              onClick={() => setOpen(false)}
              className="press-btn flex-1 py-2 rounded-xl font-semibold border-2 border-slate-200 text-slate-600 text-sm"
            >
              Batal
            </button>
            <button
              onClick={submit}
              disabled={saving}
              className="press-btn flex-1 inline-flex items-center justify-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white font-semibold px-4 py-2 rounded-xl text-sm disabled:opacity-60"
            >
              <Check className="w-4 h-4" /> {saving ? "Menyimpan…" : "Simpan"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
