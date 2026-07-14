// XP/Level system: derived purely from `lifetime_points` (a running total that
// only ever goes up, unlike spendable `points` which decreases on redeem).
// This gives kids a sense of permanent progress separate from their wallet.
//
// The ladder itself is now parent-editable (stored in app config as
// `level_titles`, a list of {title, emoji, min_xp} ordered lowest-to-highest —
// position in the array IS the level number). DEFAULT_LEVEL_TITLES below is
// just the starting point / offline fallback if config hasn't loaded yet.

export const DEFAULT_LEVEL_TITLES = [
  { title: "Pemula", min_xp: 0, emoji: "🌱" },
  { title: "Petualang", min_xp: 50, emoji: "🧭" },
  { title: "Ksatria Muda", min_xp: 150, emoji: "🗡️" },
  { title: "Ksatria Madya", min_xp: 350, emoji: "⚔️" },
  { title: "Ksatria Utama", min_xp: 700, emoji: "🛡️" },
  { title: "Pahlawan", min_xp: 1200, emoji: "🦸" },
  { title: "Pahlawan Legendaris", min_xp: 2000, emoji: "👑" },
  { title: "Juara Sejati", min_xp: 3500, emoji: "🏅" },
  { title: "Master Misi", min_xp: 6000, emoji: "🌟" },
  { title: "Legenda Keluarga", min_xp: 10000, emoji: "💫" },
];

/** Returns { level, title, emoji, xp, currentMin, nextMin, percent, totalLevels }
 * for a given lifetime_points total. `levelTitles` (from app config) overrides
 * the default ladder when provided — any custom length works correctly, not
 * just exactly 10. */
export function computeLevel(lifetimePoints, levelTitles) {
  const ladder = levelTitles && levelTitles.length ? levelTitles : DEFAULT_LEVEL_TITLES;
  const xp = Math.max(0, lifetimePoints || 0);
  let currentIdx = 0;
  for (let i = 0; i < ladder.length; i++) {
    if (xp >= ladder[i].min_xp) currentIdx = i;
  }
  const current = ladder[currentIdx];
  const next = ladder[currentIdx + 1] || null;
  const currentMin = current.min_xp;
  const nextMin = next ? next.min_xp : currentMin; // maxed out
  const span = nextMin - currentMin;
  const percent = next ? Math.min(100, Math.round(((xp - currentMin) / span) * 100)) : 100;
  return {
    level: currentIdx + 1,
    title: current.title,
    emoji: current.emoji || "⭐",
    xp,
    nextTitle: next ? next.title : null,
    nextMin,
    percent,
    maxed: !next,
    totalLevels: ladder.length,
  };
}
