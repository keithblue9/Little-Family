// Registers the My Lil Famz service worker so the app can be installed as a PWA
// and reminder notifications can be shown even when the tab is in the background.
// Safe no-op in browsers without service worker support.

export function registerServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then((reg) => {
        // Check for updates on each load.
        reg.update?.();
      })
      .catch((err) => {
        // Non-fatal: the app still works without offline support.
        console.warn("[pwa] service worker registration failed:", err);
      });
  });
}

// Ask the service worker to show a notification (works better than page-level
// Notification on mobile). Falls back to a page Notification if no SW controller.
export async function showReminderNotification(title, body, tag = "mylilfamz-reminder") {
  try {
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: "SHOW_NOTIFICATION",
        title,
        body,
        tag,
      });
      return true;
    }
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body, tag, icon: "/icons/icon-192.png" });
      return true;
    }
  } catch (err) {
    console.warn("[pwa] notification failed:", err);
  }
  return false;
}

export async function requestNotificationPermission() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}
