import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Trophy, Target, Gift, Users } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

export default function KidChallenges() {
  const [challenges, setChallenges] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/challenges")
      .then(({ data }) => setChallenges(data.filter((c) => c.status === "active" || c.status === "completed")))
      .catch((e) => toast.error(formatApiError(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading || challenges.length === 0) return null; // nothing to show, don't clutter the UI

  return (
    <div className="bg-white rounded-3xl p-5 border-2 border-slate-100 chunky-shadow">
      <h3 className="font-fun font-bold text-lg text-slate-900 flex items-center gap-2 mb-3">
        <Trophy className="w-5 h-5 text-amber-500" /> Tantangan Keluarga
      </h3>
      <div className="space-y-3">
        {challenges.map((c) => (
          <motion.div key={c.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            className={`rounded-2xl p-3 border-2 ${c.goal_met ? "border-green-200 bg-green-50" : "border-slate-100"}`}
          >
            <div className="font-fun font-bold text-sm text-slate-900">{c.title}</div>
            <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
              <Users className="w-3 h-3" /> Bersama teman satu tim
            </div>
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                <span className="flex items-center gap-1"><Target className="w-3 h-3" /> {c.earned_points}/{c.target_points}</span>
                <span className="font-bold">{c.percent}%</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${c.percent}%` }} transition={{ duration: 0.6 }}
                  className={`h-full rounded-full ${c.goal_met ? "bg-green-500" : "bg-indigo-500"}`} />
              </div>
            </div>
            {c.reward_description && (
              <div className="text-xs font-semibold text-amber-600 mt-2 flex items-center gap-1">
                <Gift className="w-3.5 h-3.5" /> {c.reward_description}
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
