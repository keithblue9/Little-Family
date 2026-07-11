// The 5 My Lil Famz themes.
// - "clean" is the calm default meant for parents / admin.
// - "candy" and "mermaid" are tuned for girls aged ~8-10.
// - "cyber" and "galaxy" are tuned for boys aged ~11-14.
// Each theme is applied by setting <html data-theme="<id>"> (see lib/theme.js).
// The CSS that these ids map to lives in src/index.css.

export const THEMES = [
  {
    id: "clean",
    label: "Bersih & Tenang",
    audience: "parent",
    ageHint: "Orang tua / admin",
    emoji: "🧑‍💼",
    dark: false,
    preview: { bg: "#f4f6fb", primary: "#6366f1", secondary: "#0ea5e9", accent: "#14b8a6" },
  },
  {
    id: "candy",
    label: "Permen Kapas",
    audience: "girl",
    ageHint: "Anak perempuan 8-10",
    emoji: "🍭",
    dark: false,
    preview: { bg: "#ffe3f1", primary: "#ff5fa2", secondary: "#b07bff", accent: "#ffb347" },
  },
  {
    id: "mermaid",
    label: "Putri Duyung",
    audience: "girl",
    ageHint: "Anak perempuan 8-10",
    emoji: "🧜‍♀️",
    dark: false,
    preview: { bg: "#d8fff6", primary: "#12b5c9", secondary: "#7c6cff", accent: "#ff8fab" },
  },
  {
    id: "cyber",
    label: "Cyber Neon",
    audience: "boy",
    ageHint: "Anak laki-laki 11-14",
    emoji: "🎮",
    dark: true,
    preview: { bg: "#0a0e1a", primary: "#00e5ff", secondary: "#b14bff", accent: "#39ff14" },
  },
  {
    id: "galaxy",
    label: "Luar Angkasa",
    audience: "boy",
    ageHint: "Anak laki-laki 11-14",
    emoji: "🚀",
    dark: true,
    preview: { bg: "#120c33", primary: "#7c5cff", secondary: "#3ad0ff", accent: "#ff9e57" },
  },
];

export const DEFAULT_PARENT_THEME = "clean";
export const DEFAULT_CHILD_THEME = "candy";

export const THEME_IDS = THEMES.map((t) => t.id);
export const getTheme = (id) => THEMES.find((t) => t.id === id) || THEMES[0];
export const childThemes = () => THEMES.filter((t) => t.audience !== "parent");
