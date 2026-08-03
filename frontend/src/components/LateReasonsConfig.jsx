import { useEffect, useState } from "react";
import { Clock, Plus, Trash2, Save, ShieldAlert, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

/**
 * Config for the "Terlambat" system.
 *
 * Each reason option carries two independent switches, because they really are
 * separate questions:
 *   • gives_penalty_card — is this the kid's fault? (earns a Kartu Hukuman)
 *   • award_points       — do they still earn the task's points?
 * Typical excused reason: no card, keeps points. Typical at-fault reason: card,
 * no points (they may still do the task — owning up shouldn't be punished with
 * a dead end). There is deliberately no limit on how many options a parent adds.
 */
export default function LateReasonsConfig({ kids = [], onChanged }) {
  const [reasons, setReasons] = useState([]);
  const [threshold, setThreshold] = useState(3);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyKid, setBusyKid] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get("/config");
      setReasons(data.late_reasons || []);
      setThreshold(data.penalty_card_threshold ?? 3);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const update = (i, patch) =>
    setReasons((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const add = () =>
    setReasons((rs) => [...rs, { label: "", gives_penalty_card: false, award_points: true }]);

  const remove = (i) => setReasons((rs) => rs.filter((_, idx) => idx !== i));

  const save = async () => {
    const cleaned = reasons
      .map((r) => ({ ...r, label: (r.label || "").trim() }))
      .filter((r) => r.label);
    if (cleaned.length === 0) {
      toast.error("Minimal harus ada satu pilihan alasan");
      return;
    }
    const labels = cleaned.map((r) => r.label.toLowerCase());
    if (new Set(labels).size !== labels.length) {
      toast.error("Ada alasan yang sama persis — bedakan dulu ya");
      return;
    }
    setSaving(true);
    try {
      await api.post("/config", { late_reasons: cleaned, penalty_card_threshold: Number(threshold) || 3 });
      toast.success("Pilihan alasan tersimpan");
      load();
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const resetCards = async (kid) => {
    if (!window.confirm(`Reset Kartu Hukuman ${kid.name} ke 0?\n\nLakukan ini setelah konsekuensinya dijalankan.`)) return;
    setBusyKid(kid.id);
    try {
      await api.post(`/children/${kid.id}/penalty-cards`, { penalty_cards: 0 });
      toast.success(`Kartu Hukuman ${kid.name} direset`);
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusyKid(null);
    }
  };

  if (loading) return <div className="text-sm text-slate-400">Memuat…</div>;

  return (
    <div>
      <h3 className="font-parent font-bold text-lg text-slate-900 mb-1 flex items-center gap-2">
        <Clock className="w-5 h-5 text-amber-500" /> Alasan Terlambat & Kartu Hukuman
      </h3>
      <p className="text-sm text-slate-500 mb-4">
        Kalau ada misi yang terlewat, anak menekan tombol <b>Terlambat</b> lalu memilih salah satu alasan di bawah.
        Alasan di luar kuasa anak tidak mengurangi apa pun; alasan yang memang kelalaian memberi <b>Kartu Hukuman</b>
        dan misinya boleh dilanjutkan tapi tanpa poin.
      </p>

      <div className="space-y-2 mb-3">
        {reasons.map((r, i) => (
          <div key={r.id || i} className={`rounded-2xl border-2 p-3 ${r.gives_penalty_card ? "border-red-100 bg-red-50/40" : "border-emerald-100 bg-emerald-50/40"}`}>
            <div className="flex items-center gap-2">
              <input
                value={r.label}
                onChange={(e) => update(i, { label: e.target.value.slice(0, 120) })}
                placeholder="Tulis alasannya, mis. Kena macet di jalan"
                className="flex-1 min-w-0 px-3 py-2 rounded-xl border-2 border-slate-200 focus:border-indigo-400 focus:outline-none text-sm bg-white"
              />
              <button
                onClick={() => remove(i)}
                className="press-btn p-2 rounded-lg hover:bg-red-100 text-red-500 shrink-0"
                title="Hapus alasan ini"
              >
                <Trash2 className="w-4 h-4" strokeWidth={2.5} />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-2 pl-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={!!r.gives_penalty_card}
                  onChange={(e) => update(i, { gives_penalty_card: e.target.checked })}
                  className="w-4 h-4 accent-red-500"
                />
                <span className="text-xs font-semibold text-slate-700">Dapat Kartu Hukuman</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={r.award_points !== false}
                  onChange={(e) => update(i, { award_points: e.target.checked })}
                  className="w-4 h-4 accent-emerald-500"
                />
                <span className="text-xs font-semibold text-slate-700">Poin tetap didapat</span>
              </label>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          onClick={add}
          className="press-btn inline-flex items-center gap-1.5 border-2 border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold px-3 py-2 rounded-xl text-sm"
        >
          <Plus className="w-4 h-4" /> Tambah Alasan
        </button>
        <div className="flex items-center gap-2 ml-auto">
          <label className="text-xs font-semibold text-slate-600">Batas kartu</label>
          <input
            type="text"
            inputMode="numeric"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value.replace(/\D/g, "").slice(0, 2))}
            className="w-16 px-2 py-2 rounded-xl border-2 border-slate-200 text-sm text-center"
          />
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="press-btn inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4 py-2 rounded-xl text-sm disabled:opacity-60"
        >
          <Save className="w-4 h-4" /> {saving ? "Menyimpan…" : "Simpan"}
        </button>
      </div>

      {kids.length > 0 && (
        <div className="border-t border-slate-100 pt-4">
          <div className="text-sm font-bold text-slate-800 mb-2 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-red-500" /> Kartu Hukuman Terkumpul
          </div>
          <div className="space-y-2">
            {kids.map((k) => {
              const n = k.penalty_cards ?? 0;
              const hit = n >= (Number(threshold) || 3);
              return (
                <div key={k.id} className={`flex items-center gap-3 rounded-2xl border-2 px-3 py-2.5 ${hit ? "border-red-200 bg-red-50" : "border-slate-100"}`}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-base shrink-0" style={{ background: `${k.avatar_color}22` }}>
                    {k.avatar_emoji || "🙂"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-800 text-sm">{k.name}</div>
                    <div className={`text-xs ${hit ? "text-red-600 font-semibold" : "text-slate-400"}`}>
                      {n} kartu {hit ? "· sudah mencapai batas, waktunya konsekuensi" : `dari batas ${threshold}`}
                    </div>
                  </div>
                  {n > 0 && (
                    <button
                      onClick={() => resetCards(k)}
                      disabled={busyKid === k.id}
                      className="press-btn inline-flex items-center gap-1 border-2 border-slate-200 hover:bg-white text-slate-600 font-semibold px-3 py-1.5 rounded-lg text-xs shrink-0 disabled:opacity-60"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Reset
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
