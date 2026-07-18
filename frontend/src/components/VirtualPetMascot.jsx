import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { computeLevel } from "@/lib/levels";
import { PET_CATALOG, petAppearanceByFeed, computeFoodTier, TAP_REACTIONS, ACCESSORY_CATALOG, isAccessoryUnlocked } from "@/lib/pets";
import PetSprite from "@/components/PetSprite";

/**
 * Mood is a gentle, non-punitive signal: it reflects whether the kid has been
 * showing up lately, not a scolding mechanic. A few missed days just means
 * the pet looks a little sleepy until they're back in the swing of things.
 */
function moodFor(child) {
  const streak = child.streak_days || 0;
  const lastCompletion = child.last_completion_date;
  let daysSince = null;
  if (lastCompletion) {
    const last = new Date(lastCompletion + "T00:00:00");
    const now = new Date();
    daysSince = Math.floor((now - last) / (1000 * 60 * 60 * 24));
  }

  if (streak >= 7) return { label: "Sangat Senang", face: "😄", ring: "ring-green-300", glow: "shadow-green-200" };
  if (streak >= 3) return { label: "Senang", face: "😊", ring: "ring-lime-300", glow: "shadow-lime-200" };
  if (daysSince === null || daysSince <= 1) return { label: "Baik", face: "🙂", ring: "ring-blue-200", glow: "shadow-blue-100" };
  if (daysSince <= 3) return { label: "Rindu Kamu", face: "😴", ring: "ring-amber-200", glow: "shadow-amber-100" };
  if (daysSince <= 6) return { label: "Sedih", face: "😢", ring: "ring-slate-300", glow: "shadow-slate-100" };
  return { label: "Kangen Banget", face: "🥺", ring: "ring-slate-400", glow: "shadow-slate-200" };
}

export default function VirtualPetMascot({ child, onChanged, levelTitles, petStageNames, petFeedThresholds, feedCostPerMeal }) {
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feeding, setFeeding] = useState(false);
  const [taps, setTaps] = useState([]); // floating reaction emojis
  const [feedBurst, setFeedBurst] = useState(false);
  const [showAccessories, setShowAccessories] = useState(false);
  const [savingAccessory, setSavingAccessory] = useState(false);

  const levelInfo = computeLevel(child.lifetime_points || 0, levelTitles);
  const foodTier = computeFoodTier(child.feed_lifetime || 0);
  const feedBalance = Math.max(0, child.feed_balance || 0);
  const FEED_COST = feedCostPerMeal ?? 5;
  const equipped = child.pet_equipped || [];
  const isDead = !!child.pet_is_dead;

  const toggleAccessory = async (key) => {
    const isEquipped = equipped.includes(key);
    let next;
    if (isEquipped) {
      next = equipped.filter((k) => k !== key);
    } else {
      if (equipped.length >= 4) {
        toast.error("Maksimal 4 aksesori sekaligus — lepas satu dulu ya!");
        return;
      }
      next = [...equipped, key];
    }
    setSavingAccessory(true);
    try {
      await api.patch("/me/profile", { pet_equipped: next });
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSavingAccessory(false);
    }
  };

  const choosePet = async (petKey) => {
    setSaving(true);
    try {
      await api.patch("/me/profile", { pet_type: petKey });
      toast.success("Peliharaanmu siap! 🎉");
      setPicking(false);
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const handleTap = () => {
    if (isDead) return;
    const id = Date.now() + Math.random();
    const emoji = TAP_REACTIONS[Math.floor(Math.random() * TAP_REACTIONS.length)];
    setTaps((prev) => [...prev, { id, emoji }]);
    setTimeout(() => setTaps((prev) => prev.filter((t) => t.id !== id)), 1000);
    if (navigator.vibrate) navigator.vibrate(15);
  };

  const feedPet = async () => {
    if (feedBalance < FEED_COST) {
      toast.error(`Butuh ${FEED_COST} pakan — selesaikan misi dulu untuk dapat pakan!`);
      return;
    }
    setFeeding(true);
    try {
      await api.post(`/children/${child.id}/feed-pet`);
      setFeedBurst(true);
      if (navigator.vibrate) navigator.vibrate([20, 20, 20]);
      setTimeout(() => setFeedBurst(false), 1200);
      toast.success(`${foodTier.emoji} Nyam nyam! Peliharaanmu senang~`);
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setFeeding(false);
    }
  };

  // Tamagotchi-style device shell: rounded egg-shaped body + a dark LCD screen
  // with a faint scanline/grid texture, wrapping whatever's inside (picker,
  // mourning state, or the live pet) so every state feels like the same toy.
  const shell = (inner, opts = {}) => (
    <div className="bg-gradient-to-b from-white to-slate-50 rounded-[2rem] p-4 border-2 border-slate-100 chunky-shadow">
      <div
        className="relative rounded-[1.5rem] p-4 overflow-hidden"
        style={{
          background: opts.screenBg || "linear-gradient(155deg, #cfe8c9 0%, #a9d6a1 55%, #8fc987 100%)",
          boxShadow: "inset 0 2px 10px rgba(0,0,0,0.25), inset 0 0 0 3px rgba(255,255,255,0.35)",
        }}
      >
        {/* Faint scanline texture for that retro-LCD feel */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.15]"
          style={{ backgroundImage: "repeating-linear-gradient(0deg, #000 0px, #000 1px, transparent 1px, transparent 3px)" }}
        />
        {inner}
      </div>
    </div>
  );

  // No pet chosen yet — show the picker instead of the mascot card.
  if (!child.pet_type && !picking) {
    return shell(
      <div className="relative">
        <h3 className="font-fun font-bold text-slate-800 mb-1">Pilih Peliharaanmu! 🐾</h3>
        <p className="text-xs text-slate-600 mb-3">
          Sekali pilih, dia jadi tanggung jawabmu sampai tumbuh dewasa — nggak bisa ganti-ganti, ya!
        </p>
        <div className="grid grid-cols-5 gap-2">
          {PET_CATALOG.map((p) => (
            <button
              key={p.key}
              onClick={() => choosePet(p.key)}
              disabled={saving}
              className="press-btn flex flex-col items-center gap-1 p-2 rounded-2xl bg-white/70 hover:bg-white border-2 border-white/50 hover:border-indigo-300 disabled:opacity-50"
            >
              <PetSprite petType={p.key} stageIndex={3} size={44} />
              <span className="text-[10px] font-bold text-slate-700">{p.name}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Pet died from neglect — mourning state, then a fresh pick is unlocked.
  if (isDead && !picking) {
    return shell(
      <div className="relative text-center py-2">
        <div className="text-5xl mb-2">🪦</div>
        <div className="font-fun font-bold text-slate-800 mb-1">Peliharaanmu sudah pergi…</div>
        <p className="text-xs text-slate-600 mb-3">
          Kelamaan nggak dikasih makan. Yuk mulai lagi dengan peliharaan baru — kali ini rawat dia baik-baik ya!
        </p>
        <button
          onClick={() => setPicking(true)}
          className="press-btn bg-indigo-500 hover:bg-indigo-600 text-white font-fun font-bold px-4 py-2 rounded-xl text-sm"
        >
          Pilih Peliharaan Baru
        </button>
      </div>,
      { screenBg: "linear-gradient(155deg, #cbb8c9 0%, #ab8fa6 55%, #8f748a 100%)" }
    );
  }

  // Picker re-opened (only reachable after death, or first pick above).
  if (picking) {
    return shell(
      <div className="relative">
        <h3 className="font-fun font-bold text-slate-800 mb-1">Pilih Peliharaan Baru! 🐾</h3>
        <p className="text-xs text-slate-600 mb-3">Dia akan tumbuh besar seiring kamu rajin mengerjakan misi.</p>
        <div className="grid grid-cols-5 gap-2">
          {PET_CATALOG.map((p) => (
            <button
              key={p.key}
              onClick={() => choosePet(p.key)}
              disabled={saving}
              className="press-btn flex flex-col items-center gap-1 p-2 rounded-2xl bg-white/70 hover:bg-white border-2 border-white/50 hover:border-indigo-300 disabled:opacity-50"
            >
              <PetSprite petType={p.key} stageIndex={3} size={44} />
              <span className="text-[10px] font-bold text-slate-700">{p.name}</span>
            </button>
          ))}
        </div>
        <button onClick={() => setPicking(false)} className="text-xs text-slate-600 mt-3 underline">
          Batal
        </button>
      </div>
    );
  }

  const appearance = petAppearanceByFeed(child.pet_type, child.pet_feed_count || 0, petFeedThresholds, petStageNames);
  const mood = moodFor(child);
  // The pet is drawn as a real SVG creature (PetSprite) that physically grows
  // each stage. Size scales up baby→adult so growth is unmistakable.
  const SPRITE_SIZE_BY_STAGE = [58, 54, 66, 76];

  return shell(
    <div className="relative">
      <div className="flex items-center gap-4">
        <button onClick={handleTap} className="relative shrink-0" title="Sentuh aku!">
          <motion.div
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
            whileTap={{ scale: 1.15, rotate: [0, -8, 8, 0] }}
            className={`relative w-24 h-24 rounded-full bg-white/40 flex items-center justify-center ring-4 ${mood.ring} shadow-lg ${mood.glow}`}
          >
            <PetSprite petType={child.pet_type} stageIndex={appearance.stageIndex} size={SPRITE_SIZE_BY_STAGE[appearance.stageIndex]} />
            <span className="absolute -bottom-1 -right-1 text-xl">{mood.face}</span>
            {equipped.map((key, i) => {
              const acc = ACCESSORY_CATALOG.find((a) => a.key === key);
              if (!acc) return null;
              const positions = ["-top-2 left-1/2 -translate-x-1/2", "-top-1 -left-2", "-top-1 -right-2", "top-1/2 -left-3 -translate-y-1/2"];
              return (
                <span key={key} className={`absolute ${positions[i % positions.length]} text-lg pointer-events-none`}>
                  {acc.emoji}
                </span>
              );
            })}
            <AnimatePresence>
              {feedBurst && (
                <motion.span
                  initial={{ opacity: 0, y: 0, scale: 0.5 }}
                  animate={{ opacity: 1, y: -30, scale: 1.3 }}
                  exit={{ opacity: 0 }}
                  className="absolute -top-2 left-1/2 -translate-x-1/2 text-2xl"
                >
                  {foodTier.emoji}
                </motion.span>
              )}
            </AnimatePresence>
          </motion.div>
          <AnimatePresence>
            {taps.map((t) => (
              <motion.span
                key={t.id}
                initial={{ opacity: 1, y: 0, x: 0, scale: 0.6 }}
                animate={{ opacity: 0, y: -40, x: (Math.random() - 0.5) * 30, scale: 1.1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.9 }}
                className="absolute top-0 left-1/2 text-xl pointer-events-none"
              >
                {t.emoji}
              </motion.span>
            ))}
          </AnimatePresence>
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-fun font-bold text-slate-800 bg-white/50 rounded-full px-2 py-0.5 text-sm">{appearance.stageName} {appearance.petName}-mu</span>
          </div>
          <div className="flex items-center gap-1 mt-1" title={`Tahap: ${appearance.stageName} (${appearance.stageIndex + 1}/4)`}>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`w-1.5 h-1.5 rounded-full ${i <= appearance.stageIndex ? "bg-emerald-500" : "bg-white/40"}`} />
            ))}
            {!appearance.isAdult && appearance.feedsNeeded != null && (
              <span className="text-[10px] text-slate-600 ml-1">
                {appearance.feedsNeeded} kali makan lagi → {["Bayi", "Remaja", "Dewasa"][appearance.stageIndex]}
              </span>
            )}
            {appearance.isAdult && <span className="text-[10px] text-emerald-600 font-bold ml-1">Dewasa! 🌟</span>}
          </div>
          <div className="text-xs text-slate-700 mb-2 mt-1">Suasana hati: {mood.label}</div>

          <button
            onClick={feedPet}
            disabled={feeding || feedBalance < FEED_COST}
            className="press-btn inline-flex items-center gap-1.5 bg-amber-400 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-400 text-white font-fun font-bold px-3 py-1.5 rounded-xl text-xs"
          >
            {foodTier.emoji} Beri Makan ({FEED_COST} pakan)
          </button>
          <button
            onClick={() => setShowAccessories((v) => !v)}
            className="press-btn ml-2 inline-flex items-center gap-1.5 bg-white/70 border-2 border-white/50 hover:bg-white text-slate-700 font-fun font-bold px-3 py-1.5 rounded-xl text-xs"
          >
            👒 Aksesori
          </button>
          <div className="text-[10px] text-slate-600 mt-1">
            Pakan: {feedBalance} · Level pakan: {foodTier.name} {foodTier.maxed ? "(MAX)" : `(menuju ${foodTier.nextName})`}
          </div>

          {showAccessories && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-2 grid grid-cols-4 gap-1.5">
              {ACCESSORY_CATALOG.map((acc) => {
                const unlocked = isAccessoryUnlocked(acc.key, levelInfo.level);
                const isEquipped = equipped.includes(acc.key);
                return (
                  <button
                    key={acc.key}
                    onClick={() => unlocked && !savingAccessory && toggleAccessory(acc.key)}
                    disabled={!unlocked || savingAccessory}
                    title={unlocked ? acc.name : `Terbuka di Level ${acc.unlockLevel}`}
                    className={`flex flex-col items-center gap-0.5 p-1.5 rounded-xl border-2 text-center ${
                      isEquipped ? "border-amber-400 bg-white" : unlocked ? "border-white/40 bg-white/40 hover:bg-white/70" : "border-white/30 bg-white/20 opacity-50 cursor-not-allowed"
                    }`}
                  >
                    <span className="text-lg">{unlocked ? acc.emoji : "🔒"}</span>
                    <span className="text-[8px] font-bold text-slate-700 leading-none">{unlocked ? acc.name : `Lv${acc.unlockLevel}`}</span>
                  </button>
                );
              })}
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
