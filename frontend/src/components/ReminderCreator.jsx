import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Clock, Plus, Trash2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

export default function ReminderCreator({ childId, childName }) {
  const [reminders, setReminders] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    task_id: "",
    time: "09:00",
    message: "",
  });

  const fetchReminders = useCallback(async () => {
    try {
      const response = await api.get("/reminders", {
        params: { child_id: childId },
      });
      setReminders(response.data);
    } catch (err) {
      console.error("Failed to fetch reminders:", err);
    }
  }, [childId]);

  const fetchTasks = useCallback(async () => {
    try {
      const response = await api.get("/tasks", {
        params: { child_id: childId },
      });
      setTasks(response.data.filter((t) => t.status === "pending"));
      setLoading(false);
    } catch (err) {
      toast.error(formatApiError(err));
      setLoading(false);
    }
  }, [childId]);

  useEffect(() => {
    if (childId) {
      fetchReminders();
      fetchTasks();
    }
  }, [childId, fetchReminders, fetchTasks]);

  const handleAddReminder = async () => {
    if (!formData.task_id || !formData.time) {
      toast.error("Please select task and time");
      return;
    }

    try {
      await api.post("/reminders", {
        child_id: childId,
        task_id: formData.task_id,
        time: formData.time,
        message:
          formData.message || `Reminder: ${getTaskName(formData.task_id)}`,
      });
      toast.success("Reminder created!");
      setFormData({ task_id: "", time: "09:00", message: "" });
      setShowForm(false);
      fetchReminders();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const handleDeleteReminder = async (reminderId) => {
    if (!window.confirm("Delete this reminder?")) return;

    try {
      await api.delete(`/reminders/${reminderId}`);
      toast.success("Reminder deleted");
      fetchReminders();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const getTaskName = (taskId) => {
    return tasks.find((t) => t.id === taskId)?.title || "Task";
  };

  if (loading) {
    return <div className="text-center text-slate-400">Loading reminders...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-fun font-bold text-lg text-slate-900 flex items-center gap-2">
          <Clock className="w-5 h-5 text-amber-500" />
          Task Reminders
        </h3>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            title="Add reminder"
          >
            <Plus className="w-5 h-5 text-slate-600" />
          </button>
        )}
      </div>

      {reminders.length === 0 ? (
        <div className="bg-slate-50 rounded-xl p-4 text-slate-600 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          No reminders set yet
        </div>
      ) : (
        <div className="space-y-3">
          {reminders.map((reminder) => (
            <motion.div
              key={reminder.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-xl p-4 border-2 border-slate-100 flex items-center justify-between"
            >
              <div className="flex-1">
                <p className="font-fun font-semibold text-slate-900">
                  {getTaskName(reminder.task_id)}
                </p>
                <p className="text-sm text-slate-600 mt-1">
                  ⏰ {reminder.time}
                </p>
                {reminder.message && (
                  <p className="text-xs text-slate-500 mt-1">
                    {reminder.message}
                  </p>
                )}
              </div>

              <button
                onClick={() => handleDeleteReminder(reminder.id)}
                className="p-2 hover:bg-red-100 text-red-600 rounded-lg transition-colors"
                title="Delete reminder"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </motion.div>
          ))}
        </div>
      )}

      {showForm && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-xl p-4 border-2 border-slate-100 space-y-4"
        >
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Task
            </label>
            <select
              value={formData.task_id}
              onChange={(e) =>
                setFormData({ ...formData, task_id: e.target.value })
              }
              className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg focus:border-amber-500 focus:outline-none"
            >
              <option value="">Select a task</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Reminder Time
            </label>
            <input
              type="time"
              value={formData.time}
              onChange={(e) =>
                setFormData({ ...formData, time: e.target.value })
              }
              className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Custom Message (Optional)
            </label>
            <input
              type="text"
              value={formData.message}
              onChange={(e) =>
                setFormData({ ...formData, message: e.target.value })
              }
              placeholder="e.g., Time to do your homework!"
              className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg focus:border-amber-500 focus:outline-none"
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
              onClick={handleAddReminder}
              className="flex-1 px-3 py-2 rounded-lg bg-amber-500 text-white font-fun font-semibold hover:bg-amber-600"
            >
              Add Reminder
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
