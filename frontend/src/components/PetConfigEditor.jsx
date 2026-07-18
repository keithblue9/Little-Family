import { useEffect, useState } from "react";
import { PawPrint, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

const DEFAULTS = {
  feed_per_point: 1,
  feed_cost_per_meal: 5,
  pet_neglect_days: 14,
  pet_stage_names: ["Telur", "Bayi", "Remaja", "Dewasa"],
  pet_stage_feed_thresholds: [3, 8, 15],
};

export default function PetConfigEditor() {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/config")
      .then(({ data }) => setForm({
        feed_per_point: data.feed_per_point ?? DEFAULTS.feed_per_point,
        feed_cost_per_meal: data.feed_cost_per_meal ?? DEFAULTS.feed_cost_per_meal,
        pet_neglect_days: data.pet_neglect_days ?? DEFAULTS.pet_neglect_days,
        pet_stage_names: data.pet_stage_names && data.pet_stage_names.length === 4 ? data.pet_stage_names : DEFAULTS.pet_stage_names,
        feed_baby: data.pet_stage_feed_thresholds?.[0] ?? DEFAULTS.pet_stage_feed_thresholds[0],
        feed_teen: data.pet_stage_feed_thresholds?.[1] ?? DEFAULTS.pet_stage_feed_thresholds[1],
        feed_adult: data.pet_stage_feed_thresholds?.[2] ?? DEFAULTS.pet_stage_feed_thresholds[2],
      }))
      .catch((e) => toast.error(formatApiError(e)));
  }, []);

  if (!form) return <div className="text-sm text-slate-400">Memuat…</div>;

  const updateStageName = (idx, value) => {
    setForm((prev) => ({ ...prev, pet_stage_names: prev.pet_stage_names.map((s, i) => (i === idx ? value : s)) }));
  };

  const resetToDefault = () => {
    if (!window.confirm("Kembalikan pengaturan peliharaan ke bawaan? Perubahan yang belum disimpan akan hilang.")) return;
    setForm({
      feed_per_point: DEFAULTS.feed_per_point,
      feed_cost_per_meal: DEFAULTS.feed_cost_per_meal,
      pet_neglect_days: DEFAULTS.pet_neglect_days,
      pet_stage_names: [...DEFAULTS.pet_stage_names],
      feed_baby: DEFAULTS.pet_stage_feed_thresholds[0],
      feed_teen: DEFAULTS.pet_stage_feed_thresholds[1],
      feed_adult: DEFAULTS.pet_stage_feed_thresholds[2],
    });
  };

  const validate = () => {
    if (!form.feed_cost_per_meal || Number(form.feed_cost_per_meal) < 1) return "Biaya makan minimal 1 pakan";
    if (!form.pet_neglect_days || Number(form.pet_neglect_days) < 1) return "Batas hari kelalaian minimal 1 hari";
    if (form.pet_stage_names.some((s) => !s.trim())) return "Setiap tahap pertumbuhan butuh nama";
    const f1 = Number(form.feed_baby), f2 = Number(form.feed_teen), f3 = Number(form.feed_adult);
    if (!(f1 >= 1 && f1 < f2 && f2 < f3)) return "Jumlah pemberian pakan harus menaik: Bayi < Remaja < Dewasa (min. 1)";
    return null;
  };

  const save = async () => {
    const error = validate();
    if (error) return toast.error(error);
    setSaving(true);
    try {
      await api.post("/config", {
        feed_per_point: Number(form.feed_per_point) || 0,
        feed_cost_per_meal: Number(form.feed_cost_per_meal),
        pet_neglect_days: Number(form.pet_neglect_days),
        pet_stage_names: form.pet_stage_names.map((s) => s.trim()),
        pet_stage_feed_thresholds: [Number(form.feed_baby), Number(form.feed_teen), Number(form.feed_adult)],
      });
      toast.success("Pengaturan peliharaan disimpan!");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-parent font-bold text-lg text-slate-900 flex items-center gap-2">
          <PawPrint className="w-5 h-5 text-amber-500" /> Peliharaan Virtual
        </h3>
        <button onClick={resetToDefault} className="press-btn inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 px-2.5 py-1.5 rounded-lg">
          <RotateCcw className="w-3.5 h-3.5" /> Reset ke bawaan
        </button>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Atur ekonomi pakan dan pertumbuhan peliharaan anak. Sekali anak memilih peliharaan, ia terkunci
        (tidak bisa ganti) sampai peliharaan itu "pergi" karena kelamaan tidak diberi makan — baru bisa pilih yang baru.
      </p>

      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="text-xs font-bold text-slate-500 mb-1 block">Pakan per poin misi</label>
          <input
            type="number" min="0" value={form.feed_per_point}
            onChange={(e) => setForm((p) => ({ ...p, feed_per_point: e.target.value.replace(/\D/g, "") }))}
            className="w-full px-2 py-1.5 border-2 border-slate-200 rounded-lg text-sm"
          />
          <p className="text-[10px] text-slate-400 mt-1">Tiap 1 poin misi = berapa pakan didapat.</p>
        </div>
        <div>
          <label className="text-xs font-bold text-slate-500 mb-1 block">Biaya sekali "Beri Makan"</label>
          <input
            type="number" min="1" value={form.feed_cost_per_meal}
            onChange={(e) => setForm((p) => ({ ...p, feed_cost_per_meal: e.target.value.replace(/\D/g, "") }))}
            className="w-full px-2 py-1.5 border-2 border-slate-200 rounded-lg text-sm"
          />
          <p className="text-[10px] text-slate-400 mt-1">Pakan yang habis tiap kali anak menekan "Beri Makan".</p>
        </div>
        <div>
          <label className="text-xs font-bold text-slate-500 mb-1 block">Batas hari tanpa makan</label>
          <input
            type="number" min="1" value={form.pet_neglect_days}
            onChange={(e) => setForm((p) => ({ ...p, pet_neglect_days: e.target.value.replace(/\D/g, "") }))}
            className="w-full px-2 py-1.5 border-2 border-slate-200 rounded-lg text-sm"
          />
          <p className="text-[10px] text-slate-400 mt-1">Kalau tidak diberi makan sekian hari, peliharaan "pergi".</p>
        </div>
      </div>

      <div className="mb-2">
        <label className="text-xs font-bold text-slate-500 mb-1 block">Nama tahap pertumbuhan (4 tahap)</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {form.pet_stage_names.map((name, i) => (
            <input
              key={i}
              value={name}
              onChange={(e) => updateStageName(i, e.target.value.slice(0, 30))}
              className="px-2 py-1.5 border-2 border-slate-200 rounded-lg text-sm text-center"
              placeholder={DEFAULTS.pet_stage_names[i]}
            />
          ))}
        </div>
      </div>

      <label className="text-xs font-bold text-slate-500 mb-1 block">Pertumbuhan berdasarkan jumlah pemberian pakan</label>
      <div className="grid grid-cols-3 gap-3 mb-1">
        <div>
          <div className="text-[11px] text-slate-500 mb-1">Menetas jadi <b>{form.pet_stage_names[1] || "Bayi"}</b> setelah</div>
          <div className="flex items-center gap-1">
            <input type="number" min="1" value={form.feed_baby}
              onChange={(e) => setForm((p) => ({ ...p, feed_baby: e.target.value.replace(/\D/g, "") }))}
              className="w-full px-2 py-1.5 border-2 border-slate-200 rounded-lg text-sm" />
            <span className="text-[11px] text-slate-400">kali</span>
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500 mb-1">Jadi <b>{form.pet_stage_names[2] || "Remaja"}</b> setelah</div>
          <div className="flex items-center gap-1">
            <input type="number" min="2" value={form.feed_teen}
              onChange={(e) => setForm((p) => ({ ...p, feed_teen: e.target.value.replace(/\D/g, "") }))}
              className="w-full px-2 py-1.5 border-2 border-slate-200 rounded-lg text-sm" />
            <span className="text-[11px] text-slate-400">kali</span>
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500 mb-1">Jadi <b>{form.pet_stage_names[3] || "Dewasa"}</b> setelah</div>
          <div className="flex items-center gap-1">
            <input type="number" min="3" value={form.feed_adult}
              onChange={(e) => setForm((p) => ({ ...p, feed_adult: e.target.value.replace(/\D/g, "") }))}
              className="w-full px-2 py-1.5 border-2 border-slate-200 rounded-lg text-sm" />
            <span className="text-[11px] text-slate-400">kali</span>
          </div>
        </div>
      </div>
      <p className="text-[10px] text-slate-400 mb-4">
        Jumlah total "Beri Makan" yang dibutuhkan sejak peliharaan dipilih. Contoh bawaan: menetas setelah 3×,
        remaja setelah 8×, dewasa setelah 15× diberi makan.
      </p>

      <button
        onClick={save}
        disabled={saving}
        className="press-btn bg-indigo-500 hover:bg-indigo-600 text-white font-semibold px-4 py-2 rounded-xl text-sm disabled:opacity-60"
      >
        {saving ? "Menyimpan…" : "Simpan Pengaturan Peliharaan"}
      </button>
    </div>
  );
}
