import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Trophy, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

export default function Leaderboard() {
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeaderboard();
  }, []);

  const fetchLeaderboard = async () => {
    try {
      const response = await api.get("/leaderboard");
      setLeaderboard(response.data);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const getMedalEmoji = (rank) => {
    if (rank === 1) return "🥇";
    if (rank === 2) return "🥈";
    if (rank === 3) return "🥉";
    return `#${rank}`;
  };

  if (loading) {
    return <div className="text-center text-slate-400 py-8">Loading leaderboard...</div>;
  }

  if (leaderboard.length === 0) {
    return (
      <div className="bg-slate-50 rounded-2xl p-8 text-center text-slate-600">
        <Trophy className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <p>No children yet. Add one to start the challenge!</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-fun font-bold text-lg text-slate-900 flex items-center gap-2">
          <Trophy className="w-5 h-5 text-amber-500" />
          Leaderboard
        </h3>
        <button
          onClick={fetchLeaderboard}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          title="Refresh"
        >
          <TrendingUp className="w-5 h-5 text-slate-600" />
        </button>
      </div>

      <div className="space-y-2">
        {leaderboard.map((child, idx) => (
          <motion.div
            key={child.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.05 }}
            className={`rounded-xl p-4 border-2 flex items-center gap-4 ${
              idx < 3
                ? "bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200"
                : "bg-white border-slate-100"
            }`}
          >
            {/* Rank */}
            <div className="font-fun font-bold text-2xl w-12 text-center">
              {getMedalEmoji(child.rank)}
            </div>

            {/* Avatar */}
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0"
              style={{ background: child.avatar_color }}
            >
              {child.avatar_emoji}
            </div>

            {/* Name & Points */}
            <div className="flex-1">
              <p className="font-fun font-semibold text-slate-900">{child.name}</p>
              <p className="text-xs text-slate-500">
                Lifetime: {child.lifetime_points} pts
              </p>
            </div>

            {/* Current Points */}
            <div className="text-right">
              <p className="font-fun font-bold text-lg text-slate-900">
                {child.points}
              </p>
              <p className="text-xs text-slate-500">current</p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
