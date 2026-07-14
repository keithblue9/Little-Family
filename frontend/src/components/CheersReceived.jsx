import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Heart } from "lucide-react";
import api from "@/lib/api";

export default function CheersReceived({ childId }) {
  const [cheers, setCheers] = useState([]);

  useEffect(() => {
    if (!childId) return;
    api.get(`/children/${childId}/cheers`)
      .then(({ data }) => setCheers(data))
      .catch(() => {}); // non-critical, fail silently
  }, [childId]);

  if (cheers.length === 0) return null;

  return (
    <div className="bg-pink-50 rounded-2xl p-4 border-2 border-pink-100">
      <h3 className="font-fun font-bold text-sm text-pink-600 mb-2 flex items-center gap-1.5">
        <Heart className="w-4 h-4 fill-pink-400 text-pink-400" /> Semangat dari Saudara
      </h3>
      <div className="space-y-1.5">
        {cheers.slice(0, 5).map((c, i) => (
          <motion.div
            key={c.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className="text-sm text-pink-700 flex items-center gap-1.5"
          >
            <span className="text-base">{c.emoji}</span>
            <span className="font-semibold">{c.from_child_name}:</span>
            <span className="truncate">{c.message}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
