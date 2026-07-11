import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { BarChart3, TrendingUp, Users, ListChecks } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

export default function AnalyticsDashboard({ childId }) {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const fetchAnalytics = useCallback(async () => {
    try {
      const response = childId
        ? await api.get(`/analytics/child/${childId}`)
        : await api.get("/analytics/family");

      setAnalytics(response.data);
      setLoading(false);
    } catch (err) {
      toast.error(formatApiError(err));
      setLoading(false);
    }
  }, [childId]);

  if (loading) {
    return <div className="text-center text-slate-400 py-8">Loading analytics...</div>;
  }

  if (!analytics) {
    return (
      <div className="bg-slate-50 rounded-2xl p-8 text-center text-slate-600">
        No data yet
      </div>
    );
  }

  // Child analytics
  if (childId && analytics.child_name) {
    return (
      <div className="space-y-4">
        <h3 className="font-fun font-bold text-lg text-slate-900 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-blue-500" />
          {analytics.child_name}'s Analytics
        </h3>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {/* Points */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl p-4 border-2 border-blue-200"
          >
            <p className="text-sm text-blue-600 font-semibold mb-1">Current Points</p>
            <p className="font-fun font-bold text-3xl text-blue-900">
              {analytics.current_points}
            </p>
          </motion.div>

          {/* Lifetime Points */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-2xl p-4 border-2 border-purple-200"
          >
            <p className="text-sm text-purple-600 font-semibold mb-1">Lifetime</p>
            <p className="font-fun font-bold text-3xl text-purple-900">
              {analytics.lifetime_points}
            </p>
          </motion.div>

          {/* Completion Rate */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-gradient-to-br from-green-50 to-green-100 rounded-2xl p-4 border-2 border-green-200"
          >
            <p className="text-sm text-green-600 font-semibold mb-1">Completion</p>
            <p className="font-fun font-bold text-3xl text-green-900">
              {analytics.stats.completion_rate}%
            </p>
          </motion.div>

          {/* Completed Tasks */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="bg-white rounded-2xl p-4 border-2 border-slate-100"
          >
            <p className="text-sm text-slate-600 font-semibold mb-1">Completed</p>
            <p className="font-fun font-bold text-2xl text-slate-900">
              {analytics.stats.completed_tasks}/{analytics.stats.total_tasks}
            </p>
          </motion.div>

          {/* Pending Tasks */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white rounded-2xl p-4 border-2 border-amber-100"
          >
            <p className="text-sm text-amber-600 font-semibold mb-1">Pending</p>
            <p className="font-fun font-bold text-2xl text-amber-900">
              {analytics.stats.pending_tasks}
            </p>
          </motion.div>

          {/* Missed Tasks */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="bg-white rounded-2xl p-4 border-2 border-red-100"
          >
            <p className="text-sm text-red-600 font-semibold mb-1">Missed</p>
            <p className="font-fun font-bold text-2xl text-red-900">
              {analytics.stats.missed_tasks}
            </p>
          </motion.div>
        </div>

        {/* Recent Activity */}
        {analytics.recent_activity && analytics.recent_activity.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white rounded-2xl p-4 border-2 border-slate-100"
          >
            <h4 className="font-fun font-semibold text-slate-900 mb-3">Recent Activity</h4>
            <div className="space-y-2">
              {analytics.recent_activity.slice(0, 5).map((act, idx) => (
                <div key={idx} className="text-sm text-slate-600 flex justify-between">
                  <span className="capitalize">{act.action?.replace(/_/g, " ")}</span>
                  <span className="text-xs text-slate-400">
                    {new Date(act.created_at).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    );
  }

  // Family analytics
  return (
    <div className="space-y-4">
      <h3 className="font-fun font-bold text-lg text-slate-900 flex items-center gap-2">
        <BarChart3 className="w-5 h-5 text-blue-500" />
        Family Analytics
      </h3>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {/* Children Count */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-br from-pink-50 to-pink-100 rounded-2xl p-4 border-2 border-pink-200"
        >
          <p className="text-sm text-pink-600 font-semibold mb-1 flex items-center gap-1">
            <Users className="w-4 h-4" /> Children
          </p>
          <p className="font-fun font-bold text-3xl text-pink-900">
            {analytics.children_count}
          </p>
        </motion.div>

        {/* Total Points */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-2xl p-4 border-2 border-indigo-200"
        >
          <p className="text-sm text-indigo-600 font-semibold mb-1 flex items-center gap-1">
            <TrendingUp className="w-4 h-4" /> Total Points
          </p>
          <p className="font-fun font-bold text-3xl text-indigo-900">
            {analytics.total_family_points}
          </p>
        </motion.div>

        {/* Avg per Child */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-2xl p-4 border-2 border-orange-200"
        >
          <p className="text-sm text-orange-600 font-semibold mb-1">Avg per Child</p>
          <p className="font-fun font-bold text-3xl text-orange-900">
            {analytics.average_points_per_child}
          </p>
        </motion.div>

        {/* Tasks Created */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-white rounded-2xl p-4 border-2 border-slate-100"
        >
          <p className="text-sm text-slate-600 font-semibold mb-1 flex items-center gap-1">
            <ListChecks className="w-4 h-4" /> Tasks Created
          </p>
          <p className="font-fun font-bold text-2xl text-slate-900">
            {analytics.total_tasks_created}
          </p>
        </motion.div>

        {/* Tasks Approved */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-2xl p-4 border-2 border-green-100"
        >
          <p className="text-sm text-green-600 font-semibold mb-1">Tasks Approved</p>
          <p className="font-fun font-bold text-2xl text-green-900">
            {analytics.total_tasks_approved}
          </p>
        </motion.div>

        {/* Completion Rate */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="bg-white rounded-2xl p-4 border-2 border-blue-100"
        >
          <p className="text-sm text-blue-600 font-semibold mb-1">Completion Rate</p>
          <p className="font-fun font-bold text-2xl text-blue-900">
            {analytics.family_completion_rate}%
          </p>
        </motion.div>
      </div>
    </div>
  );
}
