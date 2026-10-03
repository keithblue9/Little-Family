import axios from "axios";

// Frontend and API now live on the same Vercel deployment (no separate
// Render backend), so the default is a relative path — same-origin, no CORS,
// no cross-site cookie issues. REACT_APP_BACKEND_URL can still override this
// for local dev against a different host if ever needed.
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";

export const API_BASE = `${BACKEND_URL}/api`;

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

// ---------------------------------------------------------------------------
// Shared GET cache.
//
// Many screens ask for the same thing (family settings alone was fetched from
// 14 places). Identical GETs that are already in flight share one request,
// and a few slow-changing endpoints are reused for a short while. Any write
// (POST/PUT/PATCH/DELETE) clears the cache, so a screen never reads its own
// change back stale. `{ fresh: true }` in a request's config skips it.
// ---------------------------------------------------------------------------
const GET_TTL = [
  [/^\/config$/, 60_000],
  [/^\/children$/, 30_000],
  [/^\/push\/vapid-public-key$/, 60 * 60_000],
  [/^\/(rewards|punishments|wishlist|exam-periods|off-days|view-links)$/, 20_000],
];
const getCache = new Map(); // key -> { at, ttl, promise }

function ttlFor(path) {
  for (const [re, ttl] of GET_TTL) if (re.test(path)) return ttl;
  return 0; // only share while in flight
}

function cacheKeyFor(config) {
  const path = (config.url || "").split("?")[0];
  const params = config.params ? JSON.stringify(config.params, Object.keys(config.params).sort()) : "";
  const auth = String(config.headers?.get?.("Authorization") ?? config.headers?.Authorization ?? "");
  return { path, key: `${auth.slice(-16)}|${config.url}|${params}` };
}

export function clearApiCache() {
  getCache.clear();
}

// Each caller gets its own copy, so a screen that edits what it received
// can't change what the next screen reads.
const copy = (v) => (typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
const clone = (res) => ({ ...res, data: res.data && typeof res.data === "object" ? copy(res.data) : res.data });

const baseAdapter = axios.getAdapter(axios.defaults.adapter);

api.defaults.adapter = (config) => {
  const method = (config.method || "get").toLowerCase();
  if (method !== "get") {
    getCache.clear();
    return baseAdapter(config).finally(() => getCache.clear());
  }
  if (config.fresh || config.responseType === "blob" || config.responseType === "arraybuffer") {
    return baseAdapter(config);
  }
  const { path, key } = cacheKeyFor(config);
  const now = Date.now();
  const hit = getCache.get(key);
  if (hit && (hit.pending || now - hit.at < hit.ttl)) {
    return hit.promise.then(clone);
  }
  const ttl = ttlFor(path);
  const entry = { at: now, ttl, pending: true, promise: null };
  entry.promise = baseAdapter(config).then(
    (res) => {
      entry.pending = false;
      entry.at = Date.now();
      if (!ttl && getCache.get(key) === entry) getCache.delete(key);
      return res;
    },
    (err) => {
      if (getCache.get(key) === entry) getCache.delete(key);
      throw err;
    },
  );
  getCache.set(key, entry);
  return entry.promise.then(clone);
};

// Attach token from localStorage as fallback (also we have httpOnly cookie)
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("cq_token");
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// If ANY request comes back locked out by maintenance mode, broadcast it so
// the top-level AuthContext can switch the whole app to the maintenance
// screen immediately — not just when the initial session check happens to
// run. This is what makes an already-open tab react right away when a parent
// flips the switch mid-session.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 503) {
      window.dispatchEvent(new CustomEvent("app:maintenance", {
        detail: { message: error.response.data?.detail || "Aplikasi sedang nonaktif sementara." },
      }));
    }
    return Promise.reject(error);
  }
);

export default api;

export function formatApiError(err) {
  const detail = err?.response?.data?.detail;
  if (detail == null) return err?.message || "Something went wrong.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e)))
      .join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}
