import { lazy } from "react";

/**
 * Route-level code splitting with two extras:
 *
 * 1. Retry once on a failed chunk download. After a deploy, an open tab can
 *    ask for a chunk file that no longer exists; a single hard reload fetches
 *    the new index.html instead of leaving a blank screen. A sessionStorage
 *    guard makes a reload loop impossible.
 * 2. prefetchRoute(name): start downloading a screen before it is needed —
 *    e.g. as soon as we know who is signed in, or when a finger touches a tab.
 */
const loaders = {};
const started = {};

export function lazyWithRetry(factory, name) {
  loaders[name] = factory;
  return lazy(async () => {
    try {
      const mod = await (started[name] || factory());
      try { sessionStorage.removeItem(`mlf:chunk-retry:${name}`); } catch { /* storage refused */ }
      return mod;
    } catch (err) {
      let tried = false;
      try {
        tried = !!sessionStorage.getItem(`mlf:chunk-retry:${name}`);
        sessionStorage.setItem(`mlf:chunk-retry:${name}`, "1");
      } catch {
        tried = !!window.__mlfChunkRetry;
        window.__mlfChunkRetry = true;
      }
      if (!tried) {
        window.location.reload();
        return new Promise(() => {}); // wait for the reload
      }
      throw err;
    }
  });
}

export function prefetchRoute(name) {
  const f = loaders[name];
  if (!f || started[name]) return;
  started[name] = f().catch(() => { delete started[name]; });
}
