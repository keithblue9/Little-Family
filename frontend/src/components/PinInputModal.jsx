import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, X } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

export default function PinInputModal({ childId, childName, onSuccess, onClose }) {
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handlePinChange = (e) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 6);
    setPin(value);
    setError("");
  };

  const handleSubmit = async () => {
    if (pin.length !== 6) {
      setError("PIN must be 6 digits");
      return;
    }

    setLoading(true);
    try {
      const response = await api.post(`/children/${childId}/validate-passcode`, {
        passcode: pin,
      });
      toast.success("PIN verified!");
      onSuccess();
    } catch (err) {
      setError("Incorrect PIN");
      setPin("");
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") handleSubmit();
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-white rounded-3xl p-8 max-w-sm w-full chunky-shadow"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center">
                <Lock className="w-5 h-5 text-white" />
              </div>
              <h2 className="font-fun font-bold text-xl text-slate-900">
                {childName}&apos;s PIN
              </h2>
            </div>
            <button
              onClick={onClose}
              className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>

          <p className="text-slate-600 mb-6">
            Enter your 6-digit PIN to unlock kid mode.
          </p>

          <div className="mb-6">
            <input
              type="text"
              inputMode="numeric"
              value={pin}
              onChange={handlePinChange}
              onKeyPress={handleKeyPress}
              maxLength="6"
              placeholder="000000"
              className={`w-full px-4 py-3 border-2 rounded-xl font-mono text-2xl text-center tracking-widest transition-colors ${
                error
                  ? "border-red-500 bg-red-50"
                  : "border-slate-200 focus:border-blue-500 focus:bg-blue-50"
              }`}
              autoFocus
            />
            {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
          </div>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-3 rounded-xl border-2 border-slate-200 text-slate-700 font-fun font-semibold hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || pin.length !== 6}
              className={`flex-1 px-4 py-3 rounded-xl font-fun font-semibold text-white transition-all ${
                loading || pin.length !== 6
                  ? "bg-slate-300 cursor-not-allowed"
                  : "bg-blue-500 hover:bg-blue-600 active:scale-95"
              }`}
            >
              {loading ? "Verifying..." : "Unlock"}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
