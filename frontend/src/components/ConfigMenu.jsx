import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Settings, Save, Upload, Target, PiggyBank, Coins, Image as ImageIcon, X } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

const THEME_OPTIONS = [
  { value: "clean", label: "Clean", color: "bg-slate-100" },
  { value: "candy", label: "Candy", color: "bg-pink-100" },
  { value: "mermaid", label: "Mermaid", color: "bg-cyan-100" },
  { value: "cyber", label: "Cyber", color: "bg-purple-100" },
  { value: "galaxy", label: "Galaxy", color: "bg-indigo-100" },
];

const WEEKDAYS = [
  ["Senin", "0"], ["Selasa", "1"], ["Rabu", "2"], ["Kamis", "3"],
  ["Jumat", "4"], ["Sabtu", "5"], ["Minggu", "6"],
];

export default function ConfigMenu() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [edited, setEdited] = useState(false);
  const [uploadingBg, setUploadingBg] = useState(false);

  useEffect(() => { fetchConfig(); }, []);

  const fetchConfig = async () => {
    try {
      const { data } = await api.get("/config");
      setConfig({ ...data, weekday_goals: data.weekday_goals || {} });
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const change = (field, value) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
    setEdited(true);
  };

  const changeWeekdayGoal = (wd, value) => {
    setConfig((prev) => ({
      ...prev,
      weekday_goals: { ...prev.weekday_goals, [wd]: value === "" ? null : Math.max(0, parseInt(value) || 0) },
    }));
    setEdited(true);
  };

  const handleBgUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Pilih file gambar ya");
    if (file.size > 2.5 * 1024 * 1024) return toast.error("Ukuran gambar maksimal 2.5MB");
    setUploadingBg(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result;
      if (dataUrl) {
        change("slideshow_background_image", dataUrl);
        toast.success("Gambar latar siap. Klik Simpan untuk menerapkan.");
      }
      setUploadingBg(false);
    };
    reader.onerror = () => { toast.error("Gagal membaca gambar"); setUploadingBg(false); };
    reader.readAsDataURL(file);
  };

  const piggyTotal = (config?.piggy_save_pct || 0) + (config?.piggy_spend_pct || 0) + (config?.piggy_share_pct || 0);

  const handleSave = async () => {
    if (piggyTotal !== 100) {
      return toast.error(`Total persen celengan harus 100% (sekarang ${piggyTotal}%)`);
    }
    setSaving(true);
    try {
      await api.post("/config", config);
      toast.success("Pengaturan disimpan!");
      setEdited(false);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading || !config) return <div className="text-center text-slate-400">Memuat pengaturan…</div>;

  const cardCls = "bg-white rounded-xl p-4 border-2 border-slate-100";
  const inputCls = "w-full px-3 py-2 border-2 border-slate-200 rounded-lg focus:border-orange-500 focus:outline-none";

  return (
    <div className="space-y-5">
      <h3 className="font-fun font-bold text-lg text-slate-900 flex items-center gap-2">
        <Settings className="w-5 h-5 text-orange-500" /> Pengaturan Aplikasi
      </h3>

      <div className={cardCls}>
        <label className="block text-sm font-semibold text-slate-700 mb-2">Nama Aplikasi</label>
        <input type="text" value={config.app_name} onChange={(e) => change("app_name", e.target.value)} className={inputCls} placeholder="My Lil Famz" />
      </div>

      <div className={cardCls}>
        <label className="block text-sm font-semibold text-slate-700 mb-3">Tema Default</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {THEME_OPTIONS.map((t) => (
            <button key={t.value} onClick={() => change("default_theme", t.value)}
              className={`p-3 rounded-lg border-2 transition-all text-left ${config.default_theme === t.value ? "border-orange-500 bg-orange-50" : "border-slate-200 hover:border-slate-300"}`}>
              <div className={`w-8 h-8 rounded-lg ${t.color} mb-2`} />
              <p className="text-sm font-semibold text-slate-900">{t.label}</p>
            </button>
          ))}
        </div>
      </div>

      <div className={cardCls}>
        <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-orange-500" /> Latar Layar Login
        </label>
        {config.slideshow_background_image ? (
          <div className="relative mb-3">
            <img src={config.slideshow_background_image} alt="Latar" className="w-full h-32 object-cover rounded-lg border border-slate-200" />
            <button onClick={() => change("slideshow_background_image", "")} className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : null}
        <div className="flex items-center gap-2 mb-2">
          <label className={`press-btn cursor-pointer inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold px-4 py-2 rounded-lg text-sm ${uploadingBg ? "opacity-60" : ""}`}>
            <Upload className="w-4 h-4" /> {uploadingBg ? "Memuat…" : "Upload Gambar"}
            <input type="file" accept="image/*" onChange={handleBgUpload} className="hidden" disabled={uploadingBg} />
          </label>
          <span className="text-xs text-slate-400">maks 2.5MB</span>
        </div>
        <div className="text-xs text-slate-400 mb-1">atau tempel URL gambar:</div>
        <input type="url" value={config.slideshow_background_url || ""} onChange={(e) => change("slideshow_background_url", e.target.value)}
          className={`${inputCls} font-mono text-xs`} placeholder="https://example.com/background.jpg" />
        <p className="text-xs text-slate-500 mt-2">Gambar upload diprioritaskan. Kosongkan keduanya untuk latar default.</p>
      </div>

      <div className={cardCls}>
        <label className="block text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <Coins className="w-4 h-4 text-amber-500" /> Ekonomi
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="text-xs text-slate-500">Rupiah per poin</span>
            <input type="number" min="1" value={config.rupiah_per_point} onChange={(e) => change("rupiah_per_point", parseInt(e.target.value) || 1)} className={inputCls} />
          </div>
          <div>
            <span className="text-xs text-slate-500">Biaya lewati misi (poin)</span>
            <input type="number" min="0" value={config.skip_cost_points} onChange={(e) => change("skip_cost_points", parseInt(e.target.value) || 0)} className={inputCls} />
          </div>
        </div>
      </div>

      <div className={cardCls}>
        <label className="block text-sm font-semibold text-slate-700 mb-1 flex items-center gap-2">
          <Target className="w-4 h-4 text-indigo-500" /> Target Poin Minimal per Hari
        </label>
        <p className="text-xs text-slate-500 mb-3">
          Kosongkan = otomatis dari jumlah poin misi hari itu. Anak boleh melebihi target.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {WEEKDAYS.map(([label, wd]) => (
            <div key={wd} className="flex items-center gap-2">
              <span className="text-sm text-slate-600 w-16">{label}</span>
              <input type="number" min="0" placeholder="auto"
                value={config.weekday_goals[wd] ?? ""}
                onChange={(e) => changeWeekdayGoal(wd, e.target.value)}
                className="flex-1 px-3 py-1.5 border-2 border-slate-200 rounded-lg focus:border-indigo-500 focus:outline-none text-sm" />
            </div>
          ))}
        </div>
      </div>

      <div className={cardCls}>
        <label className="block text-sm font-semibold text-slate-700 mb-1 flex items-center gap-2">
          <PiggyBank className="w-4 h-4 text-pink-500" /> Pembagian Celengan
        </label>
        <p className="text-xs text-slate-500 mb-3">Bagaimana poin dibagi otomatis. Total harus 100%.</p>
        <div className="grid grid-cols-3 gap-2">
          {[
            ["piggy_save_pct", "🏦 Tabungan"],
            ["piggy_spend_pct", "🛍️ Belanja"],
            ["piggy_share_pct", "💝 Sedekah"],
          ].map(([field, label]) => (
            <div key={field}>
              <span className="text-xs text-slate-500 block mb-1">{label}</span>
              <div className="relative">
                <input type="number" min="0" max="100" value={config[field]}
                  onChange={(e) => change(field, Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))}
                  className={`${inputCls} pr-7`} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">%</span>
              </div>
            </div>
          ))}
        </div>
        <div className={`text-xs font-semibold mt-2 ${piggyTotal === 100 ? "text-green-600" : "text-red-500"}`}>
          Total: {piggyTotal}% {piggyTotal !== 100 && "(harus 100%)"}
        </div>
      </div>

      <motion.button
        onClick={handleSave}
        disabled={!edited || saving}
        className={`w-full py-3 rounded-xl font-fun font-semibold flex items-center justify-center gap-2 transition-all ${
          edited && !saving ? "bg-orange-500 text-white hover:bg-orange-600 active:scale-95" : "bg-slate-200 text-slate-500 cursor-not-allowed"
        }`}
      >
        <Save className="w-5 h-5" /> {saving ? "Menyimpan…" : "Simpan Pengaturan"}
      </motion.button>
    </div>
  );
}
