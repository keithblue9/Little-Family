/**
 * Offline-first for the child's checklist: ticks, and starting / finishing a
 * section.
 *
 * When an action can't reach the server because the connection dropped (no
 * response at all — not a refusal), it is kept here and sent, in the order it
 * happened, as soon as the device is back online or the app is opened again.
 * Start/finish carry the moment they were pressed (`happened_at`) so a
 * section done on time offline isn't judged late when the signal returns.
 * Server refusals are never queued: those are real answers.
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

/**
 * Queue one action. Items sharing a `key` replace each other in place (the
 * latest tick of a task wins but keeps its spot), so the replay order still
 * matches what the child did: start → ticks → finish.
 */
export function enqueue(url, body, key = url) {
  const items = read();
  const item = { url, body, key, at: Date.now() };
  const i = items.findIndex((x) => (x.key || x.url) === key);
  if (i >= 0) items[i] = item; else items.push(item);
  write(items);
}

/** Queue a section start/finish, stamped with the moment it was pressed. */
export function enqueueSegmentAction(action, body) {
  enqueue(`/segment-sessions/${action}`, { ...body, happened_at: new Date().toISOString() },
    `${action}:${body.child_id}:${body.date_key}:${body.segment_id}`);
}

/**
 * Send now, or queue when there's no connection. While earlier actions are
 * still waiting, a new one joins the back of the line instead of overtaking
 * them (a tick must not reach the server before the start it depends on).
 * Resolves to { queued: true } when queued, else the server response.
 */
export async function sendOrQueue(url, body, key = url) {
  if (pendingCount() > 0) {
    enqueue(url, body, key);
    flushQueue();
    return { queued: true };
  }
  try {
    return await api.post(url, body);
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    enqueue(url, body, key);
    return { queued: true };
  }
}

export function pendingCount() {
  return read().length;
}

export async function flushQueue() {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let sent = 0;
  const refused = [];
  try {
    let items = read();
    while (items.length) {
      const [item, ...rest] = items;
      try {
        await api.post(item.url, item.body);
        sent += 1;
      } catch (err) {
        if (isNetworkError(err)) break; // still offline: try again later
        // A refusal (e.g. the day already closed) — drop it, nothing to retry,
        // but tell the screen so it can re-sync and say why.
        refused.push(err?.response?.data?.detail);
      }
      items = rest;
      write(items);
    }
  } finally {
    flushing = false;
  }
  if (sent || refused.length) {
    window.dispatchEvent(new CustomEvent("app:offline-flushed", { detail: { sent, refused } }));
  }
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
