import { motion } from "framer-motion";
import { X } from "lucide-react";

// Format a stored ISO timestamp as the family-local wall clock (GMT+7). Used
// in the approval list so parents can see exactly when a kid started/finished.
export function fmtClock(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
  } catch { return ""; }
}
export function fmtDuration(startIso, endIso) {
  try {
    const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
    if (ms < 0) return "";
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    if (mins < 1) return `${secs} dtk`;
    if (mins < 60) return `${mins} mnt`;
    return `${Math.floor(mins / 60)} jam ${mins % 60} mnt`;
  } catch { return ""; }
}

export const AVATAR_COLORS = ["#FF9D23", "#4DB8FF", "#34D399", "#FF5C5C", "#A78BFA", "#F472B6"];
export const AVATAR_EMOJIS = ["🦁", "🐯", "🐻", "🦊", "🐼", "🐨", "🐰", "🐸", "🦄", "🐢", "🦖", "🐝"];

// Modal wrapper
export function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.95, y: 10, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        className="bg-white rounded-3xl w-full max-w-lg border border-slate-200 shadow-xl max-h-[90vh] flex flex-col"
      >
        <div className="flex justify-between items-center px-6 pt-6 pb-4 shrink-0">
          <h3 className="font-parent font-bold text-xl text-slate-900">{title}</h3>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100" data-testid="modal-close-btn">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <div className="px-6 pb-6 overflow-y-auto">
          {children}
        </div>
      </motion.div>
    </div>
  );
}

export const inputClass = "w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-[#6366F1] focus:outline-none font-body text-slate-800";
export const labelClass = "block text-sm font-semibold text-slate-700 mb-1";
export const btnPrimary = "inline-flex items-center gap-2 bg-[#6366F1] hover:bg-[#4f46e5] text-white font-semibold px-4 py-2.5 rounded-xl transition-colors";
export const btnGhost = "inline-flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold px-4 py-2.5 rounded-xl transition-colors";
export const btnDanger = "inline-flex items-center gap-2 bg-white border border-red-200 hover:bg-red-50 text-red-600 font-semibold px-3 py-2 rounded-xl transition-colors";

export function StatCard({ label, value, sub, color = "#6366F1", icon: Icon, onClick }) {
  const clickable = !!onClick;
  return (
    <button
      onClick={onClick}
      disabled={!clickable}
      className={`text-left bg-white rounded-2xl p-5 border border-slate-200 transition-all w-full ${
        clickable ? "hover:border-slate-300 hover:shadow-md hover:-translate-y-0.5 cursor-pointer active:scale-[0.98]" : "cursor-default"
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${color}22` }}>
          <Icon className="w-5 h-5" style={{ color }} strokeWidth={2.5} />
        </div>
        {clickable && <span className="text-xs text-slate-300">›</span>}
      </div>
      <div className="font-parent font-bold text-3xl text-slate-900">{value}</div>
      <div className="text-sm text-slate-500">{label}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </button>
  );
}
