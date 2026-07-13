import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Bell, AlertCircle, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { urlBase64ToUint8Array } from "@/lib/push";

export default function PushNotificationManager() {
  const [pushEnabled, setPushEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);
  const [subscriptionCount, setSubscriptionCount] = useState(0);

  useEffect(() => {
    checkPushSupport();
  }, []);

  const checkPushSupport = async () => {
    try {
      // Check if browser supports push notifications
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        console.log("Push notifications not supported");
        setLoading(false);
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();
      setPushEnabled(!!subscription);

      // Get subscription count from backend
      const response = await api.get("/push/subscriptions");
      setSubscriptionCount(response.data.length);
      setLoading(false);
    } catch (err) {
      console.error("Failed to check push support:", err);
      setLoading(false);
    }
  };

  const handleTogglePush = async () => {
    if (pushEnabled) {
      await handleUnsubscribe();
    } else {
      await handleSubscribe();
    }
  };

  const handleSubscribe = async () => {
    setSubscribing(true);
    try {
      // Request permission
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error("Notification permission denied");
        setSubscribing(false);
        return;
      }

      // Get service worker registration
      const reg = await navigator.serviceWorker.ready;

      // Fetch the server's actual VAPID public key — a mismatched/placeholder
      // key would let the browser "subscribe" successfully while every real
      // push send silently fails, so this must come from the backend.
      const { data } = await api.get("/push/vapid-public-key");
      if (!data.key) {
        toast.error("Notifikasi push belum diaktifkan oleh admin");
        setSubscribing(false);
        return;
      }
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.key),
      });

      // Save subscription to backend
      await api.post("/push/subscribe", { subscription: subscription.toJSON() });

      setPushEnabled(true);
      setSubscriptionCount((prev) => prev + 1);
      toast.success("Notifications enabled!");
    } catch (err) {
      console.error("Push subscription error:", err);
      toast.error("Failed to enable notifications");
    } finally {
      setSubscribing(false);
    }
  };

  const handleUnsubscribe = async () => {
    setSubscribing(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();

      if (subscription) {
        // Notify backend
        await api.post("/push/unsubscribe", {
          subscription: subscription.toJSON(),
        });

        // Unsubscribe from push
        await subscription.unsubscribe();
      }

      setPushEnabled(false);
      setSubscriptionCount(Math.max(0, subscriptionCount - 1));
      toast.success("Notifications disabled");
    } catch (err) {
      console.error("Push unsubscription error:", err);
      toast.error("Failed to disable notifications");
    } finally {
      setSubscribing(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center text-slate-400 py-4">Checking notifications...</div>
    );
  }

  // Check if browser supports push
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return (
      <div className="bg-amber-50 rounded-2xl p-4 border-2 border-amber-200 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-800">
          <p className="font-semibold mb-1">Push notifications not supported</p>
          <p className="text-xs">
            Your browser doesn't support push notifications yet
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="font-fun font-bold text-lg text-slate-900 flex items-center gap-2">
        <Bell className="w-5 h-5 text-purple-500" />
        Notifications
      </h3>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl p-4 border-2 border-slate-100 space-y-4"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {pushEnabled ? (
              <CheckCircle className="w-6 h-6 text-green-500" />
            ) : (
              <Bell className="w-6 h-6 text-slate-300" />
            )}
            <div>
              <p className="font-fun font-semibold text-slate-900">
                Push Notifications
              </p>
              <p className="text-xs text-slate-500">
                {pushEnabled ? "Enabled" : "Disabled"}
              </p>
            </div>
          </div>

          <button
            onClick={handleTogglePush}
            disabled={subscribing}
            className={`px-6 py-2 rounded-lg font-fun font-semibold transition-all ${
              pushEnabled
                ? "bg-red-100 text-red-600 hover:bg-red-200"
                : "bg-green-100 text-green-600 hover:bg-green-200"
            } ${subscribing ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {subscribing ? "Loading..." : pushEnabled ? "Disable" : "Enable"}
          </button>
        </div>

        <p className="text-sm text-slate-600">
          Get reminders for tasks, achievements, and important events. Notifications will appear
          at scheduled times.
        </p>

        {pushEnabled && (
          <div className="bg-blue-50 rounded-lg p-3 border-l-4 border-blue-500 text-sm text-blue-800">
            ✓ You'll receive notifications for task reminders and achievements
          </div>
        )}

        <div className="text-xs text-slate-500 pt-2 border-t border-slate-100">
          Active subscriptions: {subscriptionCount}
        </div>
      </motion.div>
    </div>
  );
}
