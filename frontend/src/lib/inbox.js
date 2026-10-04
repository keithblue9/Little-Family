import api from "@/lib/api";

// "Perlu perhatian" is read by the app shell (badge) and by Beranda (the list).
// Sharing one short-lived copy means a screen change never costs a second
// request, and one poller serves both.
let cache = null;
let at = 0;
let inflight = null;

export function fetchInbox(force = false) {
  if (!force && cache && Date.now() - at < 15000) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = api.get("/parent/inbox", { fresh: true })
    .then((r) => {
      cache = r.data; at = Date.now();
      window.dispatchEvent(new CustomEvent("app:inbox-updated", { detail: cache }));
      return cache;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

export const cachedInbox = () => cache;
