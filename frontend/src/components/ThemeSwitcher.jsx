import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Palette } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

const THEMES = [
  {
    value: "clean",
    label: "Clean",
    icon: "🧼",
    colors: { primary: "#64748b", accent: "#e2e8f0" },
  },
  {
    value: "candy",
    label: "Candy",
    icon: "🍭",
    colors: { primary: "#ec4899", accent: "#fce7f3" },
  },
  {
    value: "mermaid",
    label: "Mermaid",
    icon: "🧜‍♀️",
    colors: { primary: "#06b6d4", accent: "#cffafe" },
  },
  {
    value: "cyber",
    label: "Cyber",
    icon: "⚡",
    colors: { primary: "#a855f7", accent: "#f3e8ff" },
  },
  {
    value: "galaxy",
    label: "Galaxy",
    icon: "🌌",
    colors: { primary: "#4f46e5", accent: "#e0e7ff" },
  },
];

export default function ThemeSwitcher({ childId, onThemeChange }) {
  const [currentTheme, setCurrentTheme] = useState("clean");
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (childId) {
      fetchTheme();
    }
  }, [childId]);

  const fetchTheme = async () => {
    try {
      const response = await api.get(`/children/${childId}/theme`);
      setCurrentTheme(response.data.theme);
      setLoading(false);
    } catch (err) {
      console.error("Failed to fetch theme:", err);
      setLoading(false);
    }
  };

  const handleThemeChange = async (theme) => {
    if (theme === currentTheme) return;

    setSwitching(true);
    try {
      await api.post(`/children/${childId}/theme`, { theme });
      setCurrentTheme(theme);
      onThemeChange?.(theme);
      toast.success(`Theme changed to ${theme}!`);

      // Apply theme to document
      document.documentElement.setAttribute("data-theme", theme);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSwitching(false);
    }
  };

  if (loading) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-3">
        <Palette className="w-5 h-5 text-purple-500" />
        <h3 className="font-fun font-bold text-slate-900">Choose Your Theme</h3>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {THEMES.map((theme) => (
          <motion.button
            key={theme.value}
            onClick={() => handleThemeChange(theme.value)}
            disabled={switching}
            whileHover={{ y: -4 }}
            whileTap={{ scale: 0.96 }}
            className={`relative p-4 rounded-2xl border-3 transition-all flex flex-col items-center gap-2 ${
              currentTheme === theme.value
                ? "border-orange-500 bg-orange-50"
                : "border-slate-200 bg-white hover:border-slate-300"
            } ${switching ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
          >
            <span className="text-3xl">{theme.icon}</span>
            <span className="text-sm font-fun font-semibold text-slate-900">
              {theme.label}
            </span>
            {currentTheme === theme.value && (
              <motion.div
                layoutId="activeTheme"
                className="absolute top-1 right-1 w-3 h-3 bg-orange-500 rounded-full"
              />
            )}
          </motion.button>
        ))}
      </div>

      <p className="text-xs text-slate-500 mt-4">
        The app will update with your chosen theme. Dark themes (Cyber &
        Galaxy) are great at night!
      </p>
    </div>
  );
}
