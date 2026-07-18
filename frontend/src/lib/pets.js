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

const DEFAULT_STAGE_NAMES = ["Telur", "Bayi", "Remaja", "Dewasa"];
const DEFAULT_STAGE_THRESHOLDS = [0.25, 0.6];

export function getPetDef(petType) {
  return PET_CATALOG.find((p) => p.key === petType) || PET_CATALOG[0];
}

/** Growth stage index (0-3) from the kid's level, scaled proportionally to
 * however many levels the family's (customizable) ladder actually has —
 * doesn't assume exactly 10 like the original hardcoded version did.
 * `thresholds` is [babyToTeen, teenToAdult], both parent-configurable ratios
 * in (0,1) via app config (pet_stage_thresholds). */
export function stageIndexForLevel(level, totalLevels = 10, thresholds = DEFAULT_STAGE_THRESHOLDS) {
  if (level <= 1) return 0;
  if (totalLevels <= 1) return 3; // a single-tier ladder has nowhere to "grow" toward — show fully grown
  const [t1, t2] = thresholds && thresholds.length === 2 ? thresholds : DEFAULT_STAGE_THRESHOLDS;
  const ratio = (level - 1) / Math.max(1, totalLevels - 1);
  if (ratio < t1) return 1;
  if (ratio < t2) return 2;
  return 3;
}

export function petAppearance(petType, level, totalLevels = 10, stageNames = DEFAULT_STAGE_NAMES, thresholds = DEFAULT_STAGE_THRESHOLDS) {
  const def = getPetDef(petType);
  const idx = stageIndexForLevel(level, totalLevels, thresholds);
  const names = stageNames && stageNames.length === 4 ? stageNames : DEFAULT_STAGE_NAMES;
  return {
    emoji: def.stages[idx],
    stageName: names[idx],
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

// Cute cosmetic accessories that unlock as the pet levels up (same level
// system as points/lifetime_points) — purely for delight, kid picks which
// unlocked ones to display, no economy impact.
export const ACCESSORY_CATALOG = [
  { key: "bow", name: "Pita", emoji: "🎀", unlockLevel: 2 },
  { key: "flower", name: "Bunga", emoji: "🌸", unlockLevel: 2 },
  { key: "glasses", name: "Kacamata", emoji: "👓", unlockLevel: 3 },
  { key: "bandana", name: "Bandana", emoji: "🎗️", unlockLevel: 3 },
  { key: "sunglasses", name: "Kacamata Hitam", emoji: "🕶️", unlockLevel: 4 },
  { key: "scarf", name: "Syal", emoji: "🧣", unlockLevel: 5 },
  { key: "hat", name: "Topi", emoji: "🎩", unlockLevel: 6 },
  { key: "crown", name: "Mahkota", emoji: "👑", unlockLevel: 8 },
];

export function isAccessoryUnlocked(key, level) {
  const acc = ACCESSORY_CATALOG.find((a) => a.key === key);
  return acc ? level >= acc.unlockLevel : false;
}

// A handful of cute reactions for when the kid taps/pets their animal —
// purely for delight, no game-state implications.
export const TAP_REACTIONS = ["💕", "✨", "😊", "🎵", "⭐"];
