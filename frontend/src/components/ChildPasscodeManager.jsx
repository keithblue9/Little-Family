import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Lock, RefreshCw, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

export default function ChildPasscodeManager() {
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [visiblePins, setVisiblePins] = useState({});

  useEffect(() => {
    fetchChildrenPasscodes();
  }, []);

  const fetchChildrenPasscodes = async () => {
    try {
      const response = await api.get("/admin/children-passcodes");
      setChildren(response.data);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResetPasscode = async (childId, childName) => {
    if (!window.confirm(`Reset PIN for ${childName}? This cannot be undone.`)) return;

    try {
      await api.post(`/children/${childId}/reset-passcode`);
      toast.success("PIN reset successfully");
      fetchChildrenPasscodes();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const togglePinVisibility = (childId) => {
    setVisiblePins((prev) => ({
      ...prev,
      [childId]: !prev[childId],
    }));
  };

  return (
    <div className="space-y-4">
      <h3 className="font-fun font-bold text-lg text-slate-900 flex items-center gap-2">
        <Lock className="w-5 h-5 text-blue-500" />
        Child PINs Management
      </h3>

      {loading ? (
        <div className="text-center text-slate-400 py-8">Loading PINs...</div>
      ) : children.length === 0 ? (
        <div className="bg-blue-50 rounded-xl p-4 text-slate-600">
          No children yet. Add one to set up PINs.
        </div>
      ) : (
        <div className="space-y-3">
          {children.map((child) => (
            <motion.div
              key={child.child_id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-xl p-4 border-2 border-slate-100 flex items-center justify-between"
            >
              <div className="flex-1">
                <p className="font-fun font-semibold text-slate-900">
                  {child.name}
                </p>
                <div className="text-sm text-slate-500 mt-1">
                  {child.has_passcode ? (
                    <div className="flex items-center gap-2">
                      <span className="font-mono">
                        {visiblePins[child.child_id]
                          ? child.passcode_hint
                          : "●●●●●●●●●●●●●●●●●●●●"}
                      </span>
                      <button
                        onClick={() => togglePinVisibility(child.child_id)}
                        className="p-1 hover:bg-slate-100 rounded"
                      >
                        {visiblePins[child.child_id] ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  ) : (
                    <span className="text-amber-600 font-semibold">
                      No PIN set yet
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={() => handleResetPasscode(child.child_id, child.name)}
                disabled={!child.has_passcode}
                className={`p-2 rounded-lg transition-colors ${
                  child.has_passcode
                    ? "hover:bg-red-100 text-red-600"
                    : "text-slate-300 cursor-not-allowed"
                }`}
                title="Reset PIN"
              >
                <RefreshCw className="w-5 h-5" />
              </button>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
