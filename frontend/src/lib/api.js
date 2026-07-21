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
