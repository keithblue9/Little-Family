import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { playSoundTheme } from "@/lib/sounds";

export default function MysteryBox({ childId, soundTheme, onClaimed }) {
  const [opening, setOpening] = useState(false);
  const [result, setResult] = useState(null); // bonus amount once opened
  const claimTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (claimTimeoutRef.current) clearTimeout(claimTimeoutRef.current);
    };
  }, []);

  const open = async () => {
    setOpening(true);
    try {
      const { data } = await api.post(`/children/${childId}/claim-perfect-day`);
      setResult(data.bonus);
      playSoundTheme(soundTheme || "fanfare");
      if (navigator.vibrate) navigator.vibrate([40, 30, 40, 30, 100]);
      toast.success(`Kotak misteri terbuka! +${data.bonus} poin bonus 🎉`);
      // Let the celebration animation show for a moment before refreshing the
      // parent's data — refreshing immediately would flip perfect_day_claimed
      // to true and unmount this card mid-animation. Cleared on unmount (e.g.
      // the kid switches tabs) so we never call back into an unmounted parent.
      claimTimeoutRef.current = setTimeout(() => onClaimed?.(), 2200);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setOpening(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-3xl p-5 text-white text-center chunky-shadow-lg relative overflow-hidden"
    >
      <div className="absolute -right-8 -top-8 w-32 h-32 rounded-full bg-white/10" />
      <div className="absolute -left-6 -bottom-6 w-24 h-24 rounded-full bg-white/10" />

      <AnimatePresence mode="wait">
        {result === null ? (
          <motion.div key="closed" exit={{ opacity: 0, scale: 0.8 }}>
            <motion.div
              animate={{ rotate: [0, -5, 5, -5, 0], scale: [1, 1.05, 1] }}
              transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 1 }}
              className="text-6xl mb-2"
            >
              🎁
            </motion.div>
            <div className="font-fun font-bold text-lg">Hari Sempurna!</div>
            <div className="text-sm text-white/90 mb-4">Semua misi wajib selesai — ada kotak misteri untukmu!</div>
            <button
              onClick={open}
              disabled={opening}
              className="press-btn bg-white text-fuchsia-600 font-fun font-bold px-6 py-2.5 rounded-2xl disabled:opacity-60"
            >
              {opening ? "Membuka…" : "Buka Kotak! ✨"}
            </button>
          </motion.div>
        ) : (
          <motion.div key="opened" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}>
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: [0, 1.3, 1] }}
              transition={{ duration: 0.5 }}
              className="text-6xl mb-2"
            >
              🌟
            </motion.div>
            <div className="font-fun font-bold text-xl">+{result} Poin Bonus!</div>
            <div className="text-sm text-white/90">Sampai jumpa besok untuk kotak misteri berikutnya!</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
