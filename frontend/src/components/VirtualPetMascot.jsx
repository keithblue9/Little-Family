import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { computeLevel } from "@/lib/levels";
import { PET_CATALOG, petAppearance, computeFoodTier, TAP_REACTIONS, ACCESSORY_CATALOG, isAccessoryUnlocked } from "@/lib/pets";

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

export default function VirtualPetMascot({ child, onChanged, levelTitles }) {
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
  const FEED_COST = 5;
  const equipped = child.pet_equipped || [];

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

  // No pet chosen yet — show the picker instead of the mascot card.
  if (!child.pet_type || picking) {
    return (
      <div className="bg-white rounded-3xl p-5 border-2 border-slate-100 chunky-shadow">
        <h3 className="font-fun font-bold text-slate-900 mb-1">
          {child.pet_type ? "Ganti Peliharaan" : "Pilih Peliharaanmu! 🐾"}
        </h3>
        <p className="text-xs text-slate-500 mb-3">Dia akan tumbuh besar seiring kamu rajin mengerjakan misi.</p>
        <div className="grid grid-cols-5 gap-2">
          {PET_CATALOG.map((p) => (
            <button
              key={p.key}
              onClick={() => choosePet(p.key)}
              disabled={saving}
              className="press-btn flex flex-col items-center gap-1 p-2 rounded-2xl border-2 border-slate-100 hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50"
            >
              <span className="text-3xl">{p.stages[2]}</span>
              <span className="text-[10px] font-bold text-slate-600">{p.name}</span>
            </button>
          ))}
        </div>
        {child.pet_type && (
          <button onClick={() => setPicking(false)} className="text-xs text-slate-400 mt-3 underline">
            Batal
          </button>
        )}
      </div>
    );
  }

  const appearance = petAppearance(child.pet_type, levelInfo.level, levelInfo.totalLevels);
  const mood = moodFor(child);

  return (
    <div className="bg-white rounded-3xl p-5 border-2 border-slate-100 chunky-shadow">
      <div className="flex items-center gap-4">
        <button onClick={handleTap} className="relative shrink-0" title="Sentuh aku!">
          <motion.div
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
            whileTap={{ scale: 1.15, rotate: [0, -8, 8, 0] }}
            className={`relative w-20 h-20 rounded-full bg-gradient-to-br from-orange-50 to-amber-100 flex items-center justify-center text-5xl ring-4 ${mood.ring} shadow-lg ${mood.glow}`}
          >
            {appearance.emoji}
            <span className="absolute -bottom-1 -right-1 text-xl">{mood.face}</span>
            {equipped.map((key, i) => {
              const acc = ACCESSORY_CATALOG.find((a) => a.key === key);
              if (!acc) return null;
              // Simple fixed-position overlay slots so multiple accessories don't stack exactly on top of each other.
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
            <span className="font-fun font-bold text-slate-900">{appearance.stageName} {appearance.petName}-mu</span>
            <button onClick={() => setPicking(true)} className="text-[10px] text-indigo-400 underline">ganti</button>
          </div>
          <div className="text-xs text-slate-500 mb-2">Suasana hati: {mood.label}</div>

          <button
            onClick={feedPet}
            disabled={feeding || feedBalance < FEED_COST}
            className="press-btn inline-flex items-center gap-1.5 bg-amber-400 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-400 text-white font-fun font-bold px-3 py-1.5 rounded-xl text-xs"
          >
            {foodTier.emoji} Beri Makan ({FEED_COST} pakan)
          </button>
          <button
            onClick={() => setShowAccessories((v) => !v)}
            className="press-btn ml-2 inline-flex items-center gap-1.5 bg-white border-2 border-slate-200 hover:bg-slate-50 text-slate-600 font-fun font-bold px-3 py-1.5 rounded-xl text-xs"
          >
            👒 Aksesori
          </button>
          <div className="text-[10px] text-slate-400 mt-1">
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
                      isEquipped ? "border-amber-400 bg-amber-50" : unlocked ? "border-slate-100 hover:bg-slate-50" : "border-slate-100 opacity-40 cursor-not-allowed"
                    }`}
                  >
                    <span className="text-lg">{unlocked ? acc.emoji : "🔒"}</span>
                    <span className="text-[8px] font-bold text-slate-500 leading-none">{unlocked ? acc.name : `Lv${acc.unlockLevel}`}</span>
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
