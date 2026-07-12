import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, X } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Small floating card that asks the currently signed-in member to turn on
 * notifications, once. We remember the choice per-member in localStorage so
 * we don't nag them again. Only appears when the browser supports push and
 * the user hasn't decided yet.
 */
export default function PushPermissionPrompt() {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user || !user.id) return;

    const storageKey = `mlf_push_decision_${user.id}`;
    if (localStorage.getItem(storageKey)) return;

    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    // Already granted → check whether a subscription exists.
    if (Notification.permission === "granted") {
      navigator.serviceWorker.ready
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => {
          if (!sub) setVisible(true);
          else localStorage.setItem(storageKey, "granted");
        })
        .catch(() => {});
      return;
    }
    // Already denied → don't nag.
    if (Notification.permission === "denied") {
      localStorage.setItem(storageKey, "denied");
      return;
    }
    // Default → show the prompt after a short delay so it doesn't compete
    // with the login toast.
    const t = setTimeout(() => setVisible(true), 1500);
    return () => clearTimeout(t);
  }, [user]);

  const remember = (value) => {
    if (user?.id) localStorage.setItem(`mlf_push_decision_${user.id}`, value);
  };

  const later = () => {
    setVisible(false);
    // deliberately not saved — we may ask again next session
  };

  const decline = () => {
    remember("declined");
    setVisible(false);
  };

  const enable = async () => {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        remember(perm);
        setVisible(false);
        toast.info("Notifikasi tidak diaktifkan. Bisa diubah di menu Pengaturan browser kapan saja.");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        // Best-effort: without a real VAPID key we skip the endpoint subscribe
        // but still register that the user opted in so we can surface reminders
        // via the service worker locally.
        try {
          sub = await reg.pushManager.subscribe({ userVisibleOnly: true });
        } catch {
          // No VAPID configured on this deployment — that's fine, we just
          // won't send remote push. Local reminders still work.
        }
      }

      if (sub) {
        try {
          await api.post("/push/subscribe", { subscription: sub.toJSON() });
        } catch {
          // Non-fatal.
        }
      }

      remember("granted");
      setVisible(false);
      toast.success("Notifikasi aktif! Kami akan mengingatkan misi kamu ya 🔔");
    } catch (err) {
      console.error("push enable failed:", err);
      toast.error("Gagal mengaktifkan notifikasi. Coba lagi nanti ya.");
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: "spring", stiffness: 300, damping: 26 }}
          className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:bottom-6 md:max-w-sm z-40"
        >
          <div className="bg-white rounded-3xl border-2 border-slate-100 chunky-shadow-lg p-4 flex gap-3 items-start">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#FF9D23] to-[#FF6B00] flex items-center justify-center shrink-0 chunky-shadow">
              <Bell className="w-6 h-6 text-white" strokeWidth={2.5} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-fun font-bold text-slate-900 text-sm">Aktifkan pengingat misi?</div>
              <div className="text-xs text-slate-500 mt-0.5">
                {user.role === "parent"
                  ? "Dapat pemberitahuan saat anak menyelesaikan misi atau mengajukan tukar poin."
                  : "Kami akan ingatkan kalau ada misi baru atau jadwal misimu, biar ga kelewat! ⏰"}
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={enable}
                  disabled={busy}
                  className="press-btn bg-[#FF9D23] hover:bg-[#f08e14] text-white font-fun font-bold px-3 py-1.5 rounded-xl text-xs disabled:opacity-50"
                >
                  {busy ? "Mengaktifkan…" : "Aktifkan 🔔"}
                </button>
                <button
                  onClick={later}
                  className="press-btn bg-slate-100 hover:bg-slate-200 text-slate-600 font-fun font-semibold px-3 py-1.5 rounded-xl text-xs"
                >
                  Nanti
                </button>
                <button
                  onClick={decline}
                  className="press-btn text-slate-400 hover:text-slate-600 font-fun font-semibold px-2 py-1.5 rounded-xl text-xs ml-auto"
                >
                  Tidak
                </button>
              </div>
            </div>
            <button
              onClick={later}
              className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 shrink-0"
              aria-label="Tutup"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
