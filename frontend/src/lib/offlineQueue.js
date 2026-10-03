/**
 * Offline-first for the child's ticks.
 *
 * When a tick can't reach the server because the connection dropped (no
 * response at all — not a refusal), it is kept here and sent as soon as the
 * device is back online or the app is opened again. The tick stays on screen
 * the whole time. Server refusals are never queued: those are real answers.
 */
import api from "@/lib/api";

const KEY = "mlf:offline-queue:v1";
let flushing = false;

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}
function write(items) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* storage refused */ }
}

export function isNetworkError(err) {
  return !!err && !err.response;
}

export function enqueue(url, body) {
  const items = read().filter((i) => i.url !== url); // latest tick for a task wins
  items.push({ url, body, at: Date.now() });
  write(items);
}

export function pendingCount() {
  return read().length;
}

export async function flushQueue() {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let sent = 0;
  try {
    let items = read();
    while (items.length) {
      const [item, ...rest] = items;
      try {
        await api.post(item.url, item.body);
        sent += 1;
      } catch (err) {
        if (isNetworkError(err)) break; // still offline: try again later
        // A refusal (e.g. the day already closed) — drop it, nothing to retry.
      }
      items = rest;
      write(items);
    }
  } finally {
    flushing = false;
  }
  if (sent) window.dispatchEvent(new CustomEvent("app:offline-flushed", { detail: { sent } }));
  return sent;
}

export function startOfflineSync() {
  if (typeof window === "undefined") return;
  window.addEventListener("online", () => { flushQueue(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) flushQueue(); });
  setTimeout(flushQueue, 3000);
}

/** A tiny buzz on supporting phones — feedback a child can feel. */
export function haptic(pattern = 12) {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}
