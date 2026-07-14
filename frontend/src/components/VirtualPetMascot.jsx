import { motion } from "framer-motion";
import { computeLevel } from "@/lib/levels";

// Growth stages driven by the SAME lifetime-points progression as the level
// system, so the pet visually "grows up" alongside the kid's permanent
// progress (never regresses just because points got spent on rewards).
const GROWTH_STAGES = [
  { minLevel: 1, emoji: "🥚", name: "Telur" },
  { minLevel: 2, emoji: "🐣", name: "Menetas" },
  { minLevel: 3, emoji: "🐥", name: "Anak Ayam" },
  { minLevel: 5, emoji: "🐓", name: "Ayam Muda" },
  { minLevel: 7, emoji: "🦅", name: "Elang Gagah" },
  { minLevel: 9, emoji: "🐉", name: "Naga Legendaris" },
];

function growthStageFor(level) {
  let stage = GROWTH_STAGES[0];
  for (const s of GROWTH_STAGES) {
    if (level >= s.minLevel) stage = s;
  }
  return stage;
}

/**
 * Mood is a gentle, non-punitive signal: it reflects whether the kid has been
 * showing up lately, not a scolding mechanic. A few missed days just means
 * the pet looks a little sleepy until they're back in the swing of things.
 */
function moodFor(child) {
  const streak = child.streak_days || 0;
  const lastCompletion = child.last_completion_date;
  let daysSinceLastCompletion = null;
  if (lastCompletion) {
    const last = new Date(lastCompletion + "T00:00:00");
    const now = new Date();
    daysSinceLastCompletion = Math.floor((now - last) / (1000 * 60 * 60 * 24));
  }

  if (streak >= 7) return { label: "Sangat Senang", face: "😄", ring: "ring-green-300", glow: "shadow-green-200" };
  if (streak >= 3) return { label: "Senang", face: "😊", ring: "ring-lime-300", glow: "shadow-lime-200" };
  if (daysSinceLastCompletion === null || daysSinceLastCompletion <= 1) return { label: "Baik", face: "🙂", ring: "ring-blue-200", glow: "shadow-blue-100" };
  if (daysSinceLastCompletion <= 3) return { label: "Rindu Kamu", face: "😴", ring: "ring-amber-200", glow: "shadow-amber-100" };
  return { label: "Kangen Banget", face: "🥺", ring: "ring-slate-300", glow: "shadow-slate-100" };
}

export default function VirtualPetMascot({ child }) {
  const levelInfo = computeLevel(child.lifetime_points || 0);
  const stage = growthStageFor(levelInfo.level);
  const mood = moodFor(child);

  return (
    <div className="bg-white rounded-3xl p-5 border-2 border-slate-100 chunky-shadow flex items-center gap-4">
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
        className={`relative w-20 h-20 rounded-full bg-gradient-to-br from-orange-50 to-amber-100 flex items-center justify-center text-5xl shrink-0 ring-4 ${mood.ring} shadow-lg ${mood.glow}`}
      >
        {stage.emoji}
        <span className="absolute -bottom-1 -right-1 text-xl">{mood.face}</span>
      </motion.div>
      <div className="flex-1 min-w-0">
        <div className="font-fun font-bold text-slate-900">{stage.name}-mu</div>
        <div className="text-xs text-slate-500 mb-1.5">Suasana hati: {mood.label}</div>
        <div className="text-[11px] text-slate-400">
          Terus kerjakan misi supaya {stage.name.toLowerCase()}-mu tumbuh dan makin senang!
        </div>
      </div>
    </div>
  );
}
