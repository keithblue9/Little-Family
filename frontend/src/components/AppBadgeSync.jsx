import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api";

/**
 * Keeps the installed PWA's home-screen icon badge in sync with how many
 * things need attention: pending approvals for a parent, open misi for a kid.
 *
 * True native home-screen WIDGETS (the kind that show live content without
 * opening the app) aren't available to web PWAs — only installed native apps
 * can do that. The App Badging API (navigator.setAppBadge) is the closest
 * equivalent the web platform offers, and this is that.
 */
export default function AppBadgeSync() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user || user === false || user === "error" || user === null) return;
    if (!("setAppBadge" in navigator)) return; // not supported on this browser/OS

    let cancelled = false;
    const sync = async () => {
      try {
        const { data } = await api.get("/badge-count");
        if (!cancelled) {
          if (data.count > 0) navigator.setAppBadge(data.count).catch(() => {});
          else navigator.clearAppBadge().catch(() => {});
        }
      } catch {
        // Non-fatal — badge just won't update this cycle.
      }
    };

    // Wait until the first screen has painted, and skip ticks while the app is
    // in the background — the badge only matters when someone can see it.
    const first = setTimeout(sync, 4000);
    const interval = setInterval(() => { if (!document.hidden) sync(); }, 60000);
    const onVisible = () => { if (!document.hidden) sync(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user]);

  return null;
}
