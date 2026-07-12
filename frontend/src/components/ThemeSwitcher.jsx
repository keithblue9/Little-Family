import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Palette } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

export const APP_THEMES = [
  {
    value: "clean",
    label: "Clean",
    icon: "🧼",
    tagline: "Netral & profesional",
    colors: { primary: "#64748b", accent: "#e2e8f0" },
  },
  {
    value: "candy",
    label: "Candy",
    icon: "🍭",
    tagline: "Manis & ceria",
    colors: { primary: "#ec4899", accent: "#fce7f3" },
  },
  {
    value: "mermaid",
    label: "Mermaid",
    icon: "🧜‍♀️",
    tagline: "Segar & tenang",
    colors: { primary: "#06b6d4", accent: "#cffafe" },
  },
  {
    value: "cyber",
    label: "Cyber",
    icon: "⚡",
    tagline: "Modern & energik",
    colors: { primary: "#a855f7", accent: "#f3e8ff" },
  },
  {
    value: "galaxy",
    label: "Galaxy",
    icon: "🌌",
    tagline: "Misterius & luas",
    colors: { primary: "#4f46e5", accent: "#e0e7ff" },
  },
];

/**
 * Auto-suggest an app theme for a child based on MBTI, gender cues, and age.
 * Same logic style as pickQuestTheme.
 *   INTJ/INTP/ENTJ/ENTP → cyber (analytic, futuristic)
 *   INFJ/INFP → galaxy (introspective, dreamy)
 *   ENFJ/ESFJ/ISFJ → candy (warm, social)
 *   ISFP/ESFP → mermaid (aesthetic, gentle)
 *   Female cue + age <=9 → candy
 *   Female cue + age >=10 → mermaid
 *   Male cue + age >=10 → cyber
 *   Younger → candy; older neutral → galaxy; else clean
 */
export function pickAppTheme(child) {
  if (!child) return "clean";
  const mbti = child.mbti || "";
  if (/^(INTJ|INTP|ENTJ|ENTP)/.test(mbti)) return "cyber";
  if (/^(INFJ|INFP)/.test(mbti)) return "galaxy";
  if (/^(ENFJ|ESFJ|ISFJ)/.test(mbti)) return "candy";
  if (/^(ISFP|ESFP)/.test(mbti)) return "mermaid";

  const age = child.age || 0;
  const femaleCue = /🦋|🧜|👩|🌸|🌺|🦄|💖|🎀/.test(child.avatar_emoji || "");
  const maleCue = /🦸|🥷|🐯|🦁|🐺|👨|⚔️|🚀|🦖/.test(child.avatar_emoji || "");
  if (femaleCue && age <= 9) return "candy";
  if (femaleCue) return "mermaid";
  if (maleCue && age >= 10) return "cyber";
  if (age <= 7) return "candy";
  return "clean";
}

const THEMES = APP_THEMES;


export default function ThemeSwitcher({ childId, onThemeChange }) {
  const [currentTheme, setCurrentTheme] = useState("clean");
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);

  const fetchTheme = useCallback(async () => {
    try {
      const response = await api.get(`/children/${childId}/theme`);
      setCurrentTheme(response.data.theme);
      setLoading(false);
    } catch (err) {
      console.error("Failed to fetch theme:", err);
      setLoading(false);
    }
  }, [childId]);

  useEffect(() => {
    if (childId) {
      fetchTheme();
    }
  }, [childId, fetchTheme]);

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
