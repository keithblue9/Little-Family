/**
 * Keeps every open copy of the app on the version that is actually deployed.
 *
 * Root cause this addresses: an installed PWA can keep running an old bundle
 * long after a deploy — the service worker and the browser's HTTP cache both
 * hold on to it — so changes appear to "not land" even when they did. There
 * was also no way to tell which version a device was running.
 *
 * The bundle knows the commit it was built from; the server reports the commit
 * it is running. When they differ, caches are dropped and the page reloads
 * once. A per-version guard makes a reload loop impossible even if something
 * unexpected keeps the two out of step.
 */
export const BUNDLE_VERSION = (process.env.REACT_APP_BUILD_SHA || "dev").slice(0, 7);

function alreadyTried(version) {
  try {
    const key = `mlf:reloaded-for:${version}`;
    if (sessionStorage.getItem(key)) return true;
    sessionStorage.setItem(key, "1");
    return false;
  } catch {
    // Storage refused (private mode): reload at most once per page lifetime.
    if (window.__mlfReloadTried) return true;
    window.__mlfReloadTried = true;
    return false;
  }
}

export async function checkForNewVersion() {
  if (BUNDLE_VERSION === "dev") return { status: "dev" };
  let server;
  try {
    const res = await fetch(`/api/version?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return { status: "unknown" };
    server = (await res.json())?.version;
  } catch {
    return { status: "offline" };
  }
  if (!server || server === "dev" || server === BUNDLE_VERSION) {
    return { status: "current", server };
  }
  if (alreadyTried(server)) return { status: "stale", server };

  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    await reg?.update?.();
  } catch { /* best effort */ }
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch { /* best effort */ }
  window.location.reload();
  return { status: "reloading", server };
}

/** Check now, whenever the app returns to the foreground, and every 10 minutes. */
export function startVersionWatcher() {
  if (typeof window === "undefined") return;
  const run = () => { checkForNewVersion(); };
  run();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) run();
  });
  setInterval(run, 10 * 60 * 1000);
}
