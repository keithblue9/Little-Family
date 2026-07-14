// XP/Level system: derived purely from `lifetime_points` (a running total that
// only ever goes up, unlike spendable `points` which decreases on redeem).
// This gives kids a sense of permanent progress separate from their wallet.

export const LEVEL_TITLES = [
  { level: 1, title: "Pemula", minXP: 0, emoji: "🌱" },
  { level: 2, title: "Petualang", minXP: 50, emoji: "🧭" },
  { level: 3, title: "Ksatria Muda", minXP: 150, emoji: "🗡️" },
  { level: 4, title: "Ksatria Madya", minXP: 350, emoji: "⚔️" },
  { level: 5, title: "Ksatria Utama", minXP: 700, emoji: "🛡️" },
  { level: 6, title: "Pahlawan", minXP: 1200, emoji: "🦸" },
  { level: 7, title: "Pahlawan Legendaris", minXP: 2000, emoji: "👑" },
  { level: 8, title: "Juara Sejati", minXP: 3500, emoji: "🏅" },
  { level: 9, title: "Master Misi", minXP: 6000, emoji: "🌟" },
  { level: 10, title: "Legenda Keluarga", minXP: 10000, emoji: "💫" },
];

/** Returns { level, title, emoji, xp, currentMin, nextMin, percent } for a given lifetime_points total. */
export function computeLevel(lifetimePoints) {
  const xp = Math.max(0, lifetimePoints || 0);
  let current = LEVEL_TITLES[0];
  let next = LEVEL_TITLES[1];
  for (let i = 0; i < LEVEL_TITLES.length; i++) {
    if (xp >= LEVEL_TITLES[i].minXP) {
      current = LEVEL_TITLES[i];
      next = LEVEL_TITLES[i + 1] || null;
    }
  }
  const currentMin = current.minXP;
  const nextMin = next ? next.minXP : currentMin; // maxed out
  const span = nextMin - currentMin;
  const percent = next ? Math.min(100, Math.round(((xp - currentMin) / span) * 100)) : 100;
  return {
    level: current.level,
    title: current.title,
    emoji: current.emoji,
    xp,
    nextTitle: next ? next.title : null,
    nextMin,
    percent,
    maxed: !next,
  };
}
