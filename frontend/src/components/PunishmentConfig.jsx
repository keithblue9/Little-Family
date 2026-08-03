import { useEffect, useState } from "react";
import { Gavel, Plus, Trash2, Save, Check, X, HeartPulse } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

const WEEKDAY_NAMES = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];

/**
 * The consequence layer behind Kartu Hukuman.
 *
 * Once a child reaches the card threshold a punishment is issued — either
 * auto-assigned or picked by the child (ownership tends to land better than a
 * sentence handed down). It must be carried out by the deadline day; if it
 * isn't, the configured overdue action fires. Parents confirm completion,
 * which wipes the cards back to zero.
 */
export default function PunishmentConfig({ onChanged }) {
  const [options, setOptions] = useState([]);
  const [mode, setMode] = useState("choice");
  const [deadlineDay, setDeadlineDay] = useState(6);
  const [overdue, setOverdue] = useState("reset_points");
  const [active, setActive] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    try {
      const [{ data: cfg }, { data: puns }] = await Promise.all([
        api.get("/config"),
        api.get("/punishments", { params: { active_only: true } }).catch(() => ({ data: [] })),
      ]);
      setOptions(cfg.punishment_options || []);
      setMode(cfg.punishment_mode || "choice");
      setDeadlineDay(cfg.punishment_deadline_weekday ?? 6);
      setOverdue(cfg.punishment_overdue_action || "reset_points");
      setActive(puns || []);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const update = (i, patch) => setOptions((os) => os.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  const add = () => setOptions((os) => [...os, { label: "", description: "" }]);
  const remove = (i) => setOptions((os) => os.filter((_, idx) => idx !== i));

  const save = async () => {
    const cleaned = options
      .map((o) => ({ ...o, label: (o.label || "").trim(), description: (o.description || "").trim() }))
      .filter((o) => o.label);
    if (cleaned.length === 0) return toast.error("Minimal harus ada satu pilihan hukuman");
    const labels = cleaned.map((o) => o.label.toLowerCase());
    if (new Set(labels).size !== labels.length) return toast.error("Ada hukuman yang sama persis — bedakan dulu ya");
    setSaving(true);
    try {
      await api.post("/config", {
        punishment_options: cleaned,
        punishment_mode: mode,
        punishment_deadline_weekday: Number(deadlineDay),
        punishment_overdue_action: overdue,
      });
      toast.success("Pengaturan hukuman tersimpan");
      load();
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const act = async (p, action) => {
    const confirmText = action === "serve"
      ? `Tandai hukuman ${p.child_name} sudah dijalani?\n\nKartu Hukumannya akan kembali ke 0.`
      : `Batalkan hukuman ${p.child_name}?\n\nKartu Hukumannya juga akan dikosongkan.`;
    if (!window.confirm(confirmText)) return;
    setBusyId(p.id);
    try {
      await api.post(`/punishments/${p.id}/${action}`);
      toast.success(action === "serve" ? "Hukuman selesai, kartu direset" : "Hukuman dibatalkan");
      load();
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <div className="text-sm text-slate-400">Memuat…</div>;

  return (
    <div>
      <h3 className="font-parent font-bold text-lg text-slate-900 mb-1 flex items-center gap-2">
        <Gavel className="w-5 h-5 text-red-500" /> Hukuman Otomatis
      </h3>
      <p className="text-sm text-slate-500 mb-4">
        Saat Kartu Hukuman anak mencapai batas, hukuman otomatis diterbitkan dan <b>harus dijalani paling lambat
        hari {WEEKDAY_NAMES[deadlineDay]}</b>. Kalau lewat batas, konsekuensi di bawah yang berlaku.
      </p>

      {active.length > 0 && (
        <div className="mb-5 space-y-2">
          <div className="text-sm font-bold text-slate-800">Hukuman Berjalan</div>
          {active.map((p) => (
            <div key={p.id} className="rounded-2xl border-2 border-red-200 bg-red-50 p-3">
              <div className="font-semibold text-slate-800 text-sm">
                {p.child_name} · {p.status === "pending_choice" ? "menunggu anak memilih" : p.option_label}
              </div>
              {p.option_description && <div className="text-xs text-slate-600 mt-0.5">{p.option_description}</div>}
              <div className="text-[11px] text-red-700 mt-0.5">
                Batas: {p.deadline_date} · {p.cards_at_issue} kartu · kalau lewat:{" "}
                {p.overdue_action === "pet_dies" ? "peliharaan mati" : p.overdue_action === "reset_points" ? "poin direset 0" : "tidak ada"}
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => act(p, "serve")}
                  disabled={busyId === p.id || p.status !== "assigned"}
                  title={p.status !== "assigned" ? "Anak belum memilih hukumannya" : ""}
                  className="press-btn inline-flex items-center gap-1 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-3 py-1.5 rounded-lg text-xs disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" strokeWidth={2.5} /> Sudah Dijalani
                </button>
                <button
                  onClick={() => act(p, "cancel")}
                  disabled={busyId === p.id}
                  className="press-btn inline-flex items-center gap-1 border-2 border-slate-200 bg-white text-slate-600 font-semibold px-3 py-1.5 rounded-lg text-xs disabled:opacity-60"
                >
                  <X className="w-3.5 h-3.5" strokeWidth={2.5} /> Batalkan
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">Cara menentukan</label>
          <select value={mode} onChange={(e) => setMode(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border-2 border-slate-200 text-sm bg-white">
            <option value="choice">Anak memilih sendiri</option>
            <option value="auto">Otomatis ditentukan</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">Batas waktu</label>
          <select value={deadlineDay} onChange={(e) => setDeadlineDay(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl border-2 border-slate-200 text-sm bg-white">
            {WEEKDAY_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">Kalau lewat batas</label>
          <select value={overdue} onChange={(e) => setOverdue(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border-2 border-slate-200 text-sm bg-white">
            <option value="reset_points">Poin direset ke 0</option>
            <option value="pet_dies">Peliharaan mati</option>
            <option value="none">Tidak ada (dicatat saja)</option>
          </select>
        </div>
      </div>

      <div className="space-y-2 mb-3">
        {options.map((o, i) => (
          <div key={o.id || i} className="rounded-2xl border-2 border-slate-100 p-3">
            <div className="flex items-center gap-2">
              <input
                value={o.label}
                onChange={(e) => update(i, { label: e.target.value.slice(0, 120) })}
                placeholder="Nama hukuman, mis. Tidak nonton TV"
                className="flex-1 min-w-0 px-3 py-2 rounded-xl border-2 border-slate-200 focus:border-indigo-400 focus:outline-none text-sm"
              />
              <button onClick={() => remove(i)} className="press-btn p-2 rounded-lg hover:bg-red-100 text-red-500 shrink-0" title="Hapus">
                <Trash2 className="w-4 h-4" strokeWidth={2.5} />
              </button>
            </div>
            <input
              value={o.description || ""}
              onChange={(e) => update(i, { description: e.target.value.slice(0, 300) })}
              placeholder="Keterangan (opsional), mis. selama satu hari penuh"
              className="w-full mt-2 px-3 py-1.5 rounded-xl border-2 border-slate-100 focus:border-indigo-400 focus:outline-none text-xs"
            />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={add}
                className="press-btn inline-flex items-center gap-1.5 border-2 border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold px-3 py-2 rounded-xl text-sm">
          <Plus className="w-4 h-4" /> Tambah Hukuman
        </button>
        <button onClick={save} disabled={saving}
                className="press-btn inline-flex items-center gap-1.5 bg-red-500 hover:bg-red-600 text-white font-semibold px-4 py-2 rounded-xl text-sm disabled:opacity-60 ml-auto">
          <Save className="w-4 h-4" /> {saving ? "Menyimpan…" : "Simpan"}
        </button>
      </div>

      {overdue === "pet_dies" && (
        <p className="text-[11px] text-slate-500 mt-3 flex items-start gap-1">
          <HeartPulse className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
          Peliharaan yang mati karena hukuman bisa kamu hidupkan kembali kapan saja lewat tombol di kartu anak.
        </p>
      )}
    </div>
  );
}
