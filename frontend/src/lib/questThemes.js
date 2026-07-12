// Five illustrated visual themes for the treasure-hunt quest line. Each is
// picked automatically for a child based on their age, gender cues, and MBTI
// personality — but the child can also override in Profile.

export const QUEST_THEMES = {
  space: {
    label: "Petualangan Angkasa",
    emoji: "🚀",
    tagline: "Mendaki bintang-bintang, satu misi demi satu misi.",
    colors: {
      bg: "linear-gradient(160deg, #0F172A 0%, #1E1B4B 50%, #312E81 100%)",
      path: "#818CF8",
      node: "#FBBF24",
      nodeDone: "#34D399",
      nodeLocked: "#334155",
      text: "#F1F5F9",
      textDim: "#94A3B8",
      accent: "#FBBF24",
    },
    activeIcon: "🚀",
    doneIcon: "⭐",
    lockedIcon: "🌑",
    goalIcon: "🌟",
    decorEmojis: ["✨", "⭐", "🪐", "☄️", "🌙"],
    pathStyle: "starfield",
  },

  garden: {
    label: "Taman Impian",
    emoji: "🌸",
    tagline: "Bunga bermekaran setiap kamu selesaikan satu misi.",
    colors: {
      bg: "linear-gradient(160deg, #FFF1F5 0%, #FCE7F3 50%, #F5D0FE 100%)",
      path: "#F472B6",
      node: "#EC4899",
      nodeDone: "#22C55E",
      nodeLocked: "#E9D5FF",
      text: "#4C1D95",
      textDim: "#9333EA",
      accent: "#EC4899",
    },
    activeIcon: "🌸",
    doneIcon: "🌺",
    lockedIcon: "🌱",
    goalIcon: "🏵️",
    decorEmojis: ["🌷", "🌼", "🦋", "🌿", "🍃"],
    pathStyle: "vines",
  },

  ninja: {
    label: "Ninja Dojo",
    emoji: "🥷",
    tagline: "Bergerak dalam bayangan, taklukkan setiap tantangan.",
    colors: {
      bg: "linear-gradient(160deg, #0F172A 0%, #1E293B 60%, #7F1D1D 100%)",
      path: "#F87171",
      node: "#EF4444",
      nodeDone: "#FACC15",
      nodeLocked: "#334155",
      text: "#F8FAFC",
      textDim: "#94A3B8",
      accent: "#EF4444",
    },
    activeIcon: "🥷",
    doneIcon: "⚔️",
    lockedIcon: "🗿",
    goalIcon: "🏯",
    decorEmojis: ["🍥", "🎌", "🀄", "⛩️", "🈲"],
    pathStyle: "brushstroke",
  },

  rainbow: {
    label: "Kerajaan Pelangi",
    emoji: "🦄",
    tagline: "Ikuti jalan pelangi menuju kastil ajaib!",
    colors: {
      bg: "linear-gradient(160deg, #FFE4E6 0%, #FEF3C7 30%, #DBEAFE 60%, #E9D5FF 100%)",
      path: "#A855F7",
      node: "#EC4899",
      nodeDone: "#F59E0B",
      nodeLocked: "#E9D5FF",
      text: "#4C1D95",
      textDim: "#7E22CE",
      accent: "#A855F7",
    },
    activeIcon: "🦄",
    doneIcon: "💖",
    lockedIcon: "🍬",
    goalIcon: "🏰",
    decorEmojis: ["🌈", "✨", "💫", "🍭", "🎀"],
    pathStyle: "rainbow",
  },

  ocean: {
    label: "Petualangan Laut",
    emoji: "🐠",
    tagline: "Selami samudra dan temukan harta karun tersembunyi.",
    colors: {
      bg: "linear-gradient(160deg, #E0F2FE 0%, #7DD3FC 45%, #0369A1 100%)",
      path: "#0EA5E9",
      node: "#F97316",
      nodeDone: "#22C55E",
      nodeLocked: "#BAE6FD",
      text: "#0C4A6E",
      textDim: "#0369A1",
      accent: "#F97316",
    },
    activeIcon: "🐠",
    doneIcon: "🐚",
    lockedIcon: "🫧",
    goalIcon: "💎",
    decorEmojis: ["🐡", "🐬", "🌊", "🐙", "⭐"],
    pathStyle: "waves",
  },
};

/**
 * Pick the best default theme for a child. Priority:
 *  1) Explicit override on the child (`quest_theme`)
 *  2) Personality (MBTI) — the strongest signal
 *  3) Gender cues in avatar_emoji + age band
 *  4) Fallback: ocean (neutral, works for everyone)
 */
export function pickQuestTheme(child) {
  if (!child) return "ocean";
  if (child.quest_theme && QUEST_THEMES[child.quest_theme]) return child.quest_theme;

  const mbti = child.mbti || "";
  // Strategic/analytical types → space
  if (/^(INTJ|INTP|ENTJ|ENTP)/.test(mbti)) return "space";
  // Warm helper/leader types → garden
  if (/^(ENFJ|ESFJ|ISFJ|INFJ)/.test(mbti)) return "garden";

  const age = child.age || 0;
  const femaleCue = /🦋|🧜|👩|🌸|🌺|🦄|💖|🎀/.test(child.avatar_emoji || "");
  const maleCue = /🦸|🥷|🐯|🦁|🐺|👨|⚔️|🚀|🦖/.test(child.avatar_emoji || "");

  if (femaleCue && age <= 9) return "rainbow";
  if (femaleCue) return "garden";
  if (maleCue && age >= 8) return "ninja";
  return "ocean";
}

export const QUEST_THEME_LIST = Object.entries(QUEST_THEMES).map(([key, t]) => ({
  key,
  ...t,
}));
