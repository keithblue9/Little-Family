// Mirror of backend personality metadata for instant UI rendering.
// The backend remains the source of truth via /personality/types.

export const TASK_STYLES = {
  challenge: { label: "Tantangan", emoji: "⚔️", color: "#6366F1", desc: "Misi seru yang butuh usaha & strategi" },
  helper: { label: "Membantu", emoji: "🤝", color: "#F472B6", desc: "Membantu keluarga atau orang lain" },
  creative: { label: "Kreatif", emoji: "🎨", color: "#F59E0B", desc: "Berkreasi & berekspresi" },
  routine: { label: "Rutin", emoji: "🔁", color: "#34D399", desc: "Kebiasaan baik sehari-hari" },
  learning: { label: "Belajar", emoji: "📚", color: "#3B82F6", desc: "Menambah ilmu & keterampilan" },
  social: { label: "Sosial", emoji: "👥", color: "#EC4899", desc: "Bermain & berbagi bersama" },
};

export const PERSONALITY_PROFILES = {
  "INTJ-T": {
    nickname: "Sang Ahli Strategi",
    emoji: "🧠",
    color: "#6366F1",
    summary: "Mandiri, suka merencanakan, dan senang tantangan yang butuh berpikir.",
    likes: ["Tujuan jangka panjang yang jelas", "Kebebasan menyelesaikan dengan caranya sendiri", "Tantangan logika & strategi"],
    best_styles: ["challenge", "learning"],
    motivation: "Kamu jenius strategi! Selesaikan misi ini dengan caramu sendiri. 🧩",
  },
  "ESFJ-T": {
    nickname: "Sang Penolong Ceria",
    emoji: "💛",
    color: "#F472B6",
    summary: "Ramah, suka membantu, dan senang dihargai atas kebaikannya.",
    likes: ["Tugas membantu keluarga", "Langkah-langkah yang jelas", "Pujian & pengakuan"],
    best_styles: ["helper", "social", "routine"],
    motivation: "Keluarga senang dengan bantuanmu! Yuk selesaikan misi ini bersama. 🤗",
  },
};

// All 32 MBTI codes for the parent's dropdown.
export const ALL_MBTI = [
  "INTJ-T", "INTJ-A", "INTP-T", "INTP-A", "ENTJ-T", "ENTJ-A", "ENTP-T", "ENTP-A",
  "INFJ-T", "INFJ-A", "INFP-T", "INFP-A", "ENFJ-T", "ENFJ-A", "ENFP-T", "ENFP-A",
  "ISTJ-T", "ISTJ-A", "ISFJ-T", "ISFJ-A", "ESTJ-T", "ESTJ-A", "ESFJ-T", "ESFJ-A",
  "ISTP-T", "ISTP-A", "ISFP-T", "ISFP-A", "ESTP-T", "ESTP-A", "ESFP-T", "ESFP-A",
];

export function styleMeta(style) {
  return TASK_STYLES[style] || null;
}

export function personalityMeta(mbti) {
  if (!mbti) return null;
  return (
    PERSONALITY_PROFILES[mbti] || {
      nickname: mbti,
      emoji: "✨",
      color: "#94A3B8",
      summary: "Setiap anak istimewa dengan caranya sendiri.",
      likes: [],
      best_styles: [],
      motivation: "Ayo selesaikan misimu, kamu hebat! ✨",
    }
  );
}
