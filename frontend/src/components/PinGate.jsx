import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { formatApiError } from "@/lib/api";
import { TEST_IDS } from "@/constants/testIds/app";

export default function PinGate({ open, onClose, onSuccess, mode = "verify" }) {
  // mode: "verify" (enter existing) or "set" (create new)
  const { setPin, verifyPin, user } = useAuth();
  const [digits, setDigits] = useState(["", "", "", ""]);
  const [confirmMode, setConfirmMode] = useState(false);
  const [firstPin, setFirstPin] = useState("");
  const [loading, setLoading] = useState(false);

  const isSetMode = mode === "set" || !user?.has_pin;

  const handleChange = (i, val) => {
    if (!/^\d?$/.test(val)) return;
    const next = [...digits];
    next[i] = val;
    setDigits(next);
    if (val && i < 3) {
      const el = document.getElementById(`pin-d-${i + 1}`);
      el?.focus();
    }
    if (next.every((d) => d !== "")) {
      submit(next.join(""));
    }
  };

  const handleKeyDown = (i, e) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      const el = document.getElementById(`pin-d-${i - 1}`);
      el?.focus();
    }
  };

  const submit = async (pin) => {
    setLoading(true);
    try {
      if (isSetMode) {
        if (!confirmMode) {
          setFirstPin(pin);
          setConfirmMode(true);
          setDigits(["", "", "", ""]);
          setLoading(false);
          setTimeout(() => document.getElementById("pin-d-0")?.focus(), 50);
          return;
        }
        if (pin !== firstPin) {
          toast.error("PINs don't match. Try again.");
          setConfirmMode(false);
          setFirstPin("");
          setDigits(["", "", "", ""]);
          setLoading(false);
          return;
        }
        await setPin(pin);
        toast.success("Parent PIN set!");
        onSuccess?.();
      } else {
        await verifyPin(pin);
        toast.success("Unlocked");
        onSuccess?.();
      }
      setDigits(["", "", "", ""]);
    } catch (err) {
      toast.error(formatApiError(err));
      setDigits(["", "", "", ""]);
      setConfirmMode(false);
      setFirstPin("");
      setTimeout(() => document.getElementById("pin-d-0")?.focus(), 50);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  const title = isSetMode
    ? confirmMode
      ? "Confirm your PIN"
      : "Set a Parent PIN"
    : "Enter Parent PIN";
  const desc = isSetMode
    ? "This 4-digit PIN protects the parent controls from little hands."
    : "Enter your 4-digit PIN to unlock parent controls.";

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          className="bg-white rounded-3xl p-8 w-full max-w-md chunky-shadow-lg border-2 border-slate-100"
        >
          <div className="flex justify-between items-start mb-4">
            <div className="w-14 h-14 rounded-2xl bg-[#6366F1] flex items-center justify-center">
              <Lock className="w-7 h-7 text-white" strokeWidth={2.5} />
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="p-2 rounded-full hover:bg-slate-100 transition-colors"
                data-testid="pin-close-btn"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            )}
          </div>
          <h2 className="font-parent font-bold text-2xl text-slate-900 mb-1">{title}</h2>
          <p className="text-slate-500 mb-6">{desc}</p>

          <div className="flex gap-3 justify-center mb-6">
            {digits.map((d, i) => (
              <input
                key={i}
                id={`pin-d-${i}`}
                data-testid={`pin-digit-${i}`}
                type="password"
                inputMode="numeric"
                maxLength={1}
                autoFocus={i === 0}
                disabled={loading}
                value={d}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                className="w-14 h-16 text-center text-3xl font-fun font-bold border-2 border-slate-200 focus:border-[#6366F1] rounded-2xl focus:outline-none"
              />
            ))}
          </div>

          <p className="text-xs text-center text-slate-400">
            {loading ? "Checking…" : "PIN entered automatically"}
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
