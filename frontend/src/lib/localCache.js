/**
 * A tiny read-through cache for the last known API response.
 *
 * The point is perceived speed: the child's screen can paint from what it saw
 * last time while the real request is still in flight. On a cold serverless
 * container that first request can take seconds, and staring at a spinner is
 * the entire complaint.
 *
 * Storage is best-effort. Safari's private mode (which is how this app is
 * tested) can refuse writes or report a zero quota, so every access is guarded
 * and falls back to an in-memory map for the life of the tab. A cache that
 * throws would be worse than no cache at all.
 */
const MEMORY = new Map();

// Bump when a cached shape changes, so stale entries from an older deploy are
// ignored rather than rendered.
const VERSION = "v1";
const PREFIX = `mlf:${VERSION}:`;

let storageWorks = null;

function storage() {
  if (storageWorks === false) return null;
  try {
    const s = window.localStorage;
    if (storageWorks === null) {
      const probe = `${PREFIX}__probe`;
      s.setItem(probe, "1");
      s.removeItem(probe);
      storageWorks = true;
    }
    return s;
  } catch {
    storageWorks = false;
    return null;
  }
}

/** Read a cached value, or null when absent, expired or unreadable. */
export function cacheGet(key, maxAgeMs = 12 * 60 * 60 * 1000) {
  const full = PREFIX + key;
  let raw = MEMORY.get(full) ?? null;
  if (raw == null) {
    const s = storage();
    if (s) {
      try { raw = s.getItem(full); } catch { raw = null; }
    }
  }
  if (!raw) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > maxAgeMs) return null;
    return parsed.value;
  } catch {
    return null;
  }
}

/** Store a value. Never throws — a failed write simply means no cache. */
export function cacheSet(key, value) {
  const full = PREFIX + key;
  const payload = { at: Date.now(), value };
  MEMORY.set(full, payload);
  const s = storage();
  if (!s) return;
  try {
    s.setItem(full, JSON.stringify(payload));
  } catch {
    // Quota exceeded or private-mode refusal: drop older entries and give up
    // quietly rather than breaking the screen we were trying to speed up.
    try {
      for (let i = s.length - 1; i >= 0; i--) {
        const k = s.key(i);
        if (k && k.startsWith(PREFIX) && k !== full) s.removeItem(k);
      }
      s.setItem(full, JSON.stringify(payload));
    } catch { /* give up */ }
  }
}

/** Forget everything we cached — used on logout so nothing leaks between kids. */
export function cacheClear() {
  MEMORY.clear();
  const s = storage();
  if (!s) return;
  try {
    for (let i = s.length - 1; i >= 0; i--) {
      const k = s.key(i);
      if (k && k.startsWith(PREFIX)) s.removeItem(k);
    }
  } catch { /* nothing to do */ }
}
