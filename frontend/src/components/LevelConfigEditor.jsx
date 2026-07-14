import { useEffect, useState } from "react";
import { Plus, Trash2, TrendingUp, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { DEFAULT_LEVEL_TITLES } from "@/lib/levels";

export default function LevelConfigEditor() {
  const [levels, setLevels] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/config")
      .then(({ data }) => setLevels(data.level_titles || DEFAULT_LEVEL_TITLES))
      .catch((e) => toast.error(formatApiError(e)));
  }, []);

  if (!levels) return <div className="text-sm text-slate-400">Memuat…</div>;

  const updateLevel = (idx, field, value) => {
    setLevels((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  };
  const addLevel = () => {
    const lastXP = levels[levels.length - 1]?.min_xp || 0;
    setLevels((prev) => [...prev, { title: `Level ${prev.length + 1}`, emoji: "⭐", min_xp: lastXP + 500 }]);
  };
  const removeLevel = (idx) => {
    if (levels.length <= 1) return toast.error("Minimal harus ada 1 level");
    setLevels((prev) => prev.filter((_, i) => i !== idx));
  };
  const resetToDefault = () => {
    if (!window.confirm("Kembalikan ke 10 level bawaan? Perubahan yang belum disimpan akan hilang.")) return;
    setLevels(DEFAULT_LEVEL_TITLES);
  };

  const validate = () => {
    if (levels.length < 1 || levels.length > 20) return "Jumlah level harus antara 1 dan 20";
    if (Number(levels[0].min_xp) !== 0) return "Level pertama harus mulai dari 0 XP";
    for (let i = 1; i < levels.length; i++) {
      if (Number(levels[i].min_xp) <= Number(levels[i - 1].min_xp)) {
        return `XP Level ${i + 1} harus lebih besar dari Level ${i}`;
      }
    }
    for (const l of levels) {
      if (!l.title || !l.title.trim()) return "Setiap level butuh nama";
    }
    return null;
  };

  const save = async () => {
    const error = validate();
    if (error) return toast.error(error);
    setSaving(true);
    try {
      const cleaned = levels.map((l) => ({ title: l.title.trim(), emoji: l.emoji || "⭐", min_xp: Number(l.min_xp) }));
      await api.post("/config", { level_titles: cleaned });
      toast.success("Level disimpan!");
      setLevels(cleaned);
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
          <TrendingUp className="w-5 h-5 text-indigo-500" /> Level Anak
        </h3>
        <button onClick={resetToDefault} className="press-btn inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 px-2.5 py-1.5 rounded-lg">
          <RotateCcw className="w-3.5 h-3.5" /> Reset ke bawaan
        </button>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Atur nama, emoji, dan berapa poin sepanjang masa (lifetime) yang dibutuhkan untuk naik tiap level.
        Level pertama harus 0 XP; tiap level berikutnya harus lebih besar dari sebelumnya.
      </p>

      <div className="space-y-2 mb-3">
        {levels.map((l, i) => (
          <div key={i} className="flex items-center gap-2 bg-slate-50 rounded-xl p-2 border border-slate-100">
            <span className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-600 text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
            <input
              value={l.emoji}
              onChange={(e) => updateLevel(i, "emoji", e.target.value.slice(0, 4))}
              className="w-12 px-1 py-1.5 border-2 border-slate-200 rounded-lg text-center"
            />
            <input
              value={l.title}
              onChange={(e) => updateLevel(i, "title", e.target.value.slice(0, 40))}
              placeholder="Nama level"
              className="flex-1 min-w-0 px-2 py-1.5 border-2 border-slate-200 rounded-lg text-sm"
            />
            <input
              type="number" min="0" value={l.min_xp}
              disabled={i === 0}
              onChange={(e) => updateLevel(i, "min_xp", e.target.value.replace(/\D/g, ""))}
              title={i === 0 ? "Level pertama selalu 0 XP" : "XP minimal"}
              className="w-24 px-2 py-1.5 border-2 border-slate-200 rounded-lg text-sm disabled:bg-slate-100 disabled:text-slate-400"
            />
            <button onClick={() => removeLevel(i)} className="press-btn p-1.5 rounded-lg hover:bg-red-50 text-red-400 shrink-0">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={addLevel}
          className="press-btn inline-flex items-center gap-1 text-sm font-bold text-indigo-500 bg-indigo-50 hover:bg-indigo-100 px-3 py-2 rounded-xl"
        >
          <Plus className="w-4 h-4" /> Tambah Level
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="press-btn ml-auto bg-indigo-500 hover:bg-indigo-600 text-white font-semibold px-4 py-2 rounded-xl text-sm disabled:opacity-60"
        >
          {saving ? "Menyimpan…" : "Simpan Level"}
        </button>
      </div>
    </div>
  );
}
