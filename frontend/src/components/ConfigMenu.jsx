import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Settings, Save } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

const THEME_OPTIONS = [
  { value: "clean", label: "Clean (Parent)", color: "bg-slate-100" },
  { value: "candy", label: "Candy (Girls 8-10)", color: "bg-pink-100" },
  { value: "mermaid", label: "Mermaid (Girls 8-10)", color: "bg-cyan-100" },
  { value: "cyber", label: "Cyber (Boys 11-14)", color: "bg-purple-100" },
  { value: "galaxy", label: "Galaxy (Boys 11-14)", color: "bg-indigo-100" },
];

export default function ConfigMenu() {
  const [config, setConfig] = useState({
    app_name: "My Lil Famz",
    default_theme: "clean",
    slideshow_background_url: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [edited, setEdited] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const response = await api.get("/config");
      setConfig(response.data);
      setLoading(false);
    } catch (err) {
      toast.error(formatApiError(err));
      setLoading(false);
    }
  };

  const handleChange = (field, value) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
    setEdited(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.post("/config", config);
      toast.success("Configuration saved!");
      setEdited(false);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center text-slate-400">Loading config...</div>;
  }

  return (
    <div className="space-y-6">
      <h3 className="font-fun font-bold text-lg text-slate-900 flex items-center gap-2">
        <Settings className="w-5 h-5 text-orange-500" />
        App Configuration
      </h3>

      {/* App Name */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-xl p-4 border-2 border-slate-100"
      >
        <label className="block text-sm font-semibold text-slate-700 mb-2">
          App Name
        </label>
        <input
          type="text"
          value={config.app_name}
          onChange={(e) => handleChange("app_name", e.target.value)}
          className="w-full px-4 py-2 border-2 border-slate-200 rounded-lg focus:border-orange-500 focus:outline-none font-fun"
          placeholder="My Lil Famz"
        />
      </motion.div>

      {/* Default Theme */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white rounded-xl p-4 border-2 border-slate-100"
      >
        <label className="block text-sm font-semibold text-slate-700 mb-3">
          Default Theme
        </label>
        <div className="grid grid-cols-2 gap-3">
          {THEME_OPTIONS.map((theme) => (
            <button
              key={theme.value}
              onClick={() => handleChange("default_theme", theme.value)}
              className={`p-3 rounded-lg border-2 transition-all text-left ${
                config.default_theme === theme.value
                  ? "border-orange-500 bg-orange-50"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className={`w-8 h-8 rounded-lg ${theme.color} mb-2`} />
              <p className="text-sm font-semibold text-slate-900">
                {theme.label}
              </p>
            </button>
          ))}
        </div>
      </motion.div>

      {/* Slideshow Background */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-white rounded-xl p-4 border-2 border-slate-100"
      >
        <label className="block text-sm font-semibold text-slate-700 mb-2">
          Login Slideshow Background URL
        </label>
        <input
          type="url"
          value={config.slideshow_background_url}
          onChange={(e) =>
            handleChange("slideshow_background_url", e.target.value)
          }
          className="w-full px-4 py-2 border-2 border-slate-200 rounded-lg focus:border-orange-500 focus:outline-none font-mono text-sm"
          placeholder="https://example.com/background.jpg"
        />
        <p className="text-xs text-slate-500 mt-2">
          Optional: Paste image URL for login screen background
        </p>
      </motion.div>

      {/* Save Button */}
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        onClick={handleSave}
        disabled={!edited || saving}
        className={`w-full py-3 rounded-xl font-fun font-semibold flex items-center justify-center gap-2 transition-all ${
          edited && !saving
            ? "bg-orange-500 text-white hover:bg-orange-600 active:scale-95"
            : "bg-slate-200 text-slate-500 cursor-not-allowed"
        }`}
      >
        <Save className="w-5 h-5" />
        {saving ? "Saving..." : "Save Configuration"}
      </motion.button>
    </div>
  );
}
