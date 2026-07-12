import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Star, Plus, Trash2, Lock } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

export default function Achievements({ childId }) {
  const [achievements, setAchievements] = useState([]);
  const [earned, setEarned] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    icon: "⭐",
    threshold_points: 100,
  });

  const PRESET_ICONS = ["⭐", "🏆", "🎯", "💎", "🚀", "👑", "🌟", "💪"];

  const fetchAchievements = useCallback(async () => {
    try {
      const [achRes, earnedRes] = await Promise.all([
        api.get("/achievements"),
        childId ? api.get(`/achievements/earned?child_id=${childId}`) : Promise.resolve({ data: [] }),
      ]);
      setAchievements(achRes.data);
      setEarned(earnedRes.data || []);
      setLoading(false);
    } catch (err) {
      toast.error(formatApiError(err));
      setLoading(false);
    }
  }, [childId]);

  useEffect(() => {
    fetchAchievements();
  }, [fetchAchievements]);

  const handleAddAchievement = async () => {
    if (!formData.name.trim()) {
      toast.error("Achievement name required");
      return;
    }

    try {
      await api.post("/achievements", formData);
      toast.success("Achievement created!");
      setFormData({ name: "", description: "", icon: "⭐", threshold_points: 100 });
      setShowForm(false);
      fetchAchievements();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const handleDeleteAchievement = async (achId) => {
    if (!window.confirm("Delete this achievement?")) return;

    try {
      await api.delete(`/achievements/${achId}`);
      toast.success("Achievement deleted");
      fetchAchievements();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const isEarned = (achId) => earned.some((e) => e.id === achId);

  if (loading) {
    return <div className="text-center text-slate-400 py-8">Loading achievements...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-fun font-bold text-lg text-slate-900 flex items-center gap-2">
          <Star className="w-5 h-5 text-yellow-500" />
          Achievements
        </h3>
        {!showForm && !childId && (
          <button
            onClick={() => setShowForm(true)}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            title="Add achievement"
          >
            <Plus className="w-5 h-5 text-slate-600" />
          </button>
        )}
      </div>

      {achievements.length === 0 ? (
        <div className="bg-slate-50 rounded-2xl p-8 text-center text-slate-600">
          <Star className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p>No achievements set yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {achievements.map((ach, idx) => {
            const earned_status = isEarned(ach.id);
            return (
              <motion.div
                key={ach.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.05 }}
                className={`relative rounded-2xl p-4 border-2 transition-all cursor-pointer ${
                  earned_status
                    ? "bg-gradient-to-br from-yellow-50 to-amber-50 border-yellow-300"
                    : "bg-white border-slate-100 opacity-60"
                }`}
              >
                {!earned_status && (
                  <div className="absolute top-2 right-2">
                    <Lock className="w-4 h-4 text-slate-400" />
                  </div>
                )}

                <div className="text-4xl mb-2 text-center">{ach.icon}</div>
                <p className="font-fun font-semibold text-sm text-slate-900 text-center mb-1">
                  {ach.name}
                </p>
                <p className="text-xs text-slate-600 text-center mb-2">
                  {ach.threshold_points} pts
                </p>
                {ach.description && (
                  <p className="text-xs text-slate-500 text-center">{ach.description}</p>
                )}

                {!childId && (
                  <button
                    onClick={() => handleDeleteAchievement(ach.id)}
                    className="absolute bottom-2 right-2 p-1 hover:bg-red-100 text-red-600 rounded"
                    title="Delete"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}

                {earned_status && (
                  <div className="absolute bottom-2 left-2 px-2 py-1 bg-yellow-500 text-white rounded text-xs font-fun font-semibold">
                    ✓ Earned
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {showForm && !childId && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-4 border-2 border-slate-100 space-y-3"
        >
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Achievement name"
            className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg focus:border-yellow-500 focus:outline-none"
          />

          <input
            type="text"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Description (optional)"
            className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg focus:border-yellow-500 focus:outline-none"
          />

          <div className="flex gap-2">
            <select
              value={formData.icon}
              onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
              className="px-3 py-2 border-2 border-slate-200 rounded-lg focus:border-yellow-500 focus:outline-none text-2xl"
            >
              {PRESET_ICONS.map((icon) => (
                <option key={icon} value={icon}>
                  {icon}
                </option>
              ))}
            </select>

            <input
              type="number"
              min="0"
              value={formData.threshold_points}
              onChange={(e) =>
                setFormData({ ...formData, threshold_points: parseInt(e.target.value) || 0 })
              }
              placeholder="Points needed"
              className="flex-1 px-3 py-2 border-2 border-slate-200 rounded-lg focus:border-yellow-500 focus:outline-none"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setShowForm(false)}
              className="flex-1 px-3 py-2 rounded-lg border-2 border-slate-200 text-slate-700 font-fun font-semibold hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleAddAchievement}
              className="flex-1 px-3 py-2 rounded-lg bg-yellow-500 text-white font-fun font-semibold hover:bg-yellow-600"
            >
              Create
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
