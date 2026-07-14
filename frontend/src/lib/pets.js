// 10 cute pet options, each with its own emoji across 4 growth stages
// (Telur → Bayi → Remaja → Dewasa), tied to the same level system used for
// points (lifetime_points), so the pet visually grows alongside a kid's
// permanent progress.

export const PET_CATALOG = [
  { key: "chicken", name: "Ayam", stages: ["🥚", "🐣", "🐥", "🐓"] },
  { key: "bird", name: "Burung", stages: ["🥚", "🐣", "🐦", "🦜"] },
  { key: "rabbit", name: "Kelinci", stages: ["🥚", "🐰", "🐰", "🐇"] },
  { key: "cat", name: "Kucing", stages: ["🥚", "🐱", "🐱", "🐈"] },
  { key: "dragon", name: "Naga", stages: ["🥚", "🐣", "🐲", "🐉"] },
  { key: "hedgehog", name: "Landak", stages: ["🥚", "🦔", "🦔", "🦔"] },
  { key: "squirrel", name: "Tupai", stages: ["🥚", "🐿️", "🐿️", "🐿️"] },
  { key: "panda", name: "Panda", stages: ["🥚", "🐼", "🐼", "🐼"] },
  { key: "fox", name: "Rubah", stages: ["🥚", "🦊", "🦊", "🦊"] },
  { key: "turtle", name: "Kura-kura", stages: ["🥚", "🐢", "🐢", "🐢"] },
];

const STAGE_NAMES = ["Telur", "Bayi", "Remaja", "Dewasa"];

export function getPetDef(petType) {
  return PET_CATALOG.find((p) => p.key === petType) || PET_CATALOG[0];
}

/** Growth stage index (0-3) from the kid's point-system level (1-10). */
export function stageIndexForLevel(level) {
  if (level <= 1) return 0;
  if (level <= 3) return 1;
  if (level <= 6) return 2;
  return 3;
}

export function petAppearance(petType, level) {
  const def = getPetDef(petType);
  const idx = stageIndexForLevel(level);
  return {
    emoji: def.stages[idx],
    stageName: STAGE_NAMES[idx],
    petName: def.name,
    isAdult: idx === 3,
  };
}

// Food tiers unlock as the pet's LIFETIME feed grows (never decreases, same
// pattern as the points level system) — gives feeding a sense of variety and
// progression separate from just "how much feed is in the bank right now".
export const FOOD_TIERS = [
  { minFeed: 0, name: "Biji-bijian", emoji: "🌾" },
  { minFeed: 30, name: "Buah Segar", emoji: "🍎" },
  { minFeed: 80, name: "Roti Lezat", emoji: "🍞" },
  { minFeed: 200, name: "Kue Manis", emoji: "🍰" },
  { minFeed: 500, name: "Pesta Besar", emoji: "🍗" },
  { minFeed: 1000, name: "Hidangan Kerajaan", emoji: "👑" },
];

export function computeFoodTier(feedLifetime) {
  const feed = Math.max(0, feedLifetime || 0);
  let current = FOOD_TIERS[0];
  let next = FOOD_TIERS[1];
  for (let i = 0; i < FOOD_TIERS.length; i++) {
    if (feed >= FOOD_TIERS[i].minFeed) {
      current = FOOD_TIERS[i];
      next = FOOD_TIERS[i + 1] || null;
    }
  }
  return { ...current, nextName: next?.name || null, nextMin: next?.minFeed ?? current.minFeed, maxed: !next };
}

// A handful of cute reactions for when the kid taps/pets their animal —
// purely for delight, no game-state implications.
export const TAP_REACTIONS = ["💕", "✨", "😊", "🎵", "⭐"];
