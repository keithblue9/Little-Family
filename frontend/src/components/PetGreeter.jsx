import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import PetSprite from "@/components/PetSprite";
import { playPetSound, soundReady } from "@/lib/petSound";
import { todayKey } from "@/lib/dates";

const GREETING = {
  morning: { mood: "wake", text: (n) => `Selamat pagi, ${n}! Aku baru bangun~ Yuk mulai harinya 🌅` },
  noon: { mood: "happy", text: (n) => `Halo ${n}! Siang yang seru ya. Semangat! ☀️` },
  evening: { mood: "happy", text: (n) => `Sore, ${n}! Masih ada yang bisa kita selesaikan 🌇` },
  night: { mood: "sleepy", text: (n) => `${n}, sudah malam… aku ngantuk. Jangan begadang ya 🌙` },
};
const FROM_MOOD = {
  sad: { mood: "sad", text: () => "Aku sedikit sedih hari ini… tapi aku percaya kamu bisa 💛" },
  hungry: { mood: "hungry", text: () => "Perutku keroncongan… ada makanan buatku? 🍖" },
  thirsty: { mood: "sad", text: () => "Aku haus… boleh minum? 💧" },
  bored: { mood: "bored", text: () => "Aku bosan… main yuk! 🎾" },
};

/**
 * The pet speaks up in a small pop-up: a greeting when the child opens the app
 * (once per part of the day), and whatever the app wants to tell them — a timer
 * reaching its minimum, a time running out — via the "app:pet-say" event.
 * It speaks in its own voice once the child has touched the screen.
 */
export default function PetGreeter({ child, state }) {
  const [say, setSay] = useState(null);   // { text, mood }
  const timer = useRef(null);

  const show = useCallback((s, ms = 8000) => {
    clearTimeout(timer.current);
    setSay(s);
    if (s.sound !== false) playPetSound(child.pet_type, s.mood);
    timer.current = setTimeout(() => setSay(null), ms);
  }, [child.pet_type]);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Greeting: once per day-phase per child.
  useEffect(() => {
    if (!state?.has_pet || state.dead || !state.phase) return;
    const key = `pet:greet:${child.id}:${todayKey()}:${state.phase.key}`;
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, "1"); } catch { /* still greet */ }
    const g = FROM_MOOD[state.mood?.key] || GREETING[state.phase.key] || GREETING.noon;
    const t = setTimeout(() => show({ text: g.text(child.name), mood: state.phase.key === "night" ? "sleepy" : g.mood }), 900);
    return () => clearTimeout(t);
  }, [state?.has_pet, state?.dead, state?.phase?.key, state?.mood?.key, child.id, child.name, show]); // eslint-disable-line react-hooks/exhaustive-deps

  // Messages from elsewhere in the app.
  useEffect(() => {
    const on = (e) => {
      const d = e.detail || {};
      if (!d.text) return;
      d.handled = true;
      show({ text: d.text, mood: d.mood || "happy", sound: d.sound }, 9000);
    };
    window.addEventListener("app:pet-say", on);
    return () => window.removeEventListener("app:pet-say", on);
  }, [show]);

  return (
    <AnimatePresence>
      {say && (
        <motion.div key={say.text} initial={{ y: -60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -40, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 28 }}
          role="status" aria-live="polite"
          className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] w-[min(92vw,26rem)] bg-white rounded-3xl border-2 border-indigo-100 chunky-shadow-lg px-3 py-2.5 flex items-center gap-3">
          <div className="shrink-0 w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center">
            <PetSprite petType={child.pet_type} stageIndex={Math.max(1, state?.stage_index ?? 1)} size={48} mood={say.mood} />
          </div>
          <div className="flex-1 min-w-0 text-sm font-fun text-slate-800 leading-snug">{say.text}</div>
          <div className="shrink-0 flex flex-col gap-1">
            <button onClick={() => { if (soundReady()) playPetSound(child.pet_type, say.mood); else show({ ...say }); }}
              className="press-btn w-8 h-8 rounded-full bg-indigo-50 text-base" aria-label="Dengarkan suaranya">🔊</button>
            <button onClick={() => setSay(null)} className="press-btn w-8 h-8 rounded-full bg-slate-50 text-slate-500 text-sm" aria-label="Tutup">✕</button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
