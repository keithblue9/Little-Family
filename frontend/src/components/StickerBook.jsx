import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BookOpen, Lock } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

export default function StickerBook({ childId }) {
  const [catalog, setCatalog] = useState([]);
  const [earned, setEarned] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!childId) return;
    setLoading(true);
    Promise.all([
      api.get("/badges/catalog"),
      api.get(`/children/${childId}/growth-trail`), // reuse: includes earned badges with dates
    ])
      .then(([catRes, trailRes]) => {
        setCatalog(catRes.data);
        const badgeEvents = trailRes.data.events.filter((e) => e.type === "badge");
        setEarned(badgeEvents);
      })
      .catch((e) => toast.error(formatApiError(e)))
      .finally(() => setLoading(false));
  }, [childId]);

  const earnedTitles = new Set(earned.map((e) => e.title));

  if (loading) return <div className="text-center text-slate-400 text-sm py-6">Memuat buku stiker…</div>;

  return (
    <div className="bg-white rounded-3xl p-5 border-2 border-slate-100 chunky-shadow">
      <h3 className="font-fun font-bold text-lg text-slate-900 flex items-center gap-2 mb-1">
        <BookOpen className="w-5 h-5 text-indigo-500" /> Buku Stiker
      </h3>
      <p className="text-xs text-slate-500 mb-4">
        {earnedTitles.size} dari {catalog.length} lencana terkumpul — lengkapi semuanya!
      </p>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
        {catalog.map((b, i) => {
          const isEarned = earnedTitles.has(b.name);
          return (
            <motion.div
              key={b.key}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.04 }}
              className={`rounded-2xl p-3 text-center border-2 ${isEarned ? "border-amber-200 bg-amber-50" : "border-slate-100 bg-slate-50"}`}
            >
              <div className={`text-3xl mb-1 ${isEarned ? "" : "grayscale opacity-30"}`}>
                {isEarned ? b.emoji : <Lock className="w-7 h-7 mx-auto text-slate-300" />}
              </div>
              <div className={`text-[10px] font-bold leading-tight ${isEarned ? "text-amber-700" : "text-slate-400"}`}>
                {isEarned ? b.name : "???"}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
