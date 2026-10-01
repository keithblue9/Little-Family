import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import { cacheGet, cacheSet, cacheClear } from "@/lib/localCache";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Start from whoever was signed in last time, so the app can render straight
  // away instead of holding a blank "Memuat…" while /auth/me travels to a
  // possibly-sleeping server. The real check still runs below and corrects
  // this within the same second; the token in localStorage is what actually
  // authorises anything, so an out-of-date guess here can't grant access —
  // every request is still validated server-side.
  const [user, setUser] = useState(() => {
    try {
      if (!localStorage.getItem("cq_token")) return false; // no token = logged out
    } catch {
      return null;
    }
    return cacheGet("auth:me", 7 * 24 * 60 * 60 * 1000) ?? null;
  });
  const [members, setMembers] = useState([]);

  const fetchMe = useCallback(async (attempt = 0) => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
      cacheSet("auth:me", data);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401) {
        // Genuinely not authenticated — clear the stale token and send to login.
        setUser(false);
        cacheClear();  // the guess above must not outlive the session it came from
        localStorage.removeItem("cq_token");
      } else if (status === 503) {
        // Maintenance mode locked this session out. This is a deliberate,
        // long-lived state (not a network hiccup) — surface it immediately
        // instead of burning retries that can't possibly succeed.
        setUser({ maintenance: true, message: err?.response?.data?.detail || "Aplikasi sedang nonaktif sementara." });
      } else if (attempt < 5) {
        // Transient error (network hiccup, cold-start 500, timeout). Don't
        // destroy the session over this — retry with backoff instead of
        // forcing the user back to the login screen.
        setTimeout(() => fetchMe(attempt + 1), 1000 * (attempt + 1));
      } else {
        // Persistent failure that isn't a 401 — surface a distinct "connection
        // error" state so the UI can offer a retry, rather than silently
        // wiping the session and pretending the person logged out.
        setUser("error");
      }
    }
  }, []);

  const fetchMembers = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/members");
      setMembers(data);
      return data;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    fetchMe();
    fetchMembers();
  }, [fetchMe, fetchMembers]);

  useEffect(() => {
    // Any in-flight request elsewhere in the app hitting a 503 lockout should
    // flip the whole app to the maintenance screen right away, not just the
    // next time fetchMe happens to run.
    const onMaintenance = (e) => setUser({ maintenance: true, message: e.detail?.message });
    window.addEventListener("app:maintenance", onMaintenance);
    return () => window.removeEventListener("app:maintenance", onMaintenance);
  }, []);

  const login = async (memberId, passcode) => {
    const { data } = await api.post("/auth/login", { member_id: memberId, passcode });
    if (data.token) localStorage.setItem("cq_token", data.token);
    // A new sign-in starts clean, then seeds its own identity.
    cacheClear();
    cacheSet("auth:me", data);
    setUser(data);
    return data;
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // ignore
    }
    localStorage.removeItem("cq_token");
    // Wipe every cached screen, not just the token: the next person to sign in
    // on this device must never glimpse the previous one's data.
    cacheClear();
    setUser(false);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        members,
        fetchMembers,
        login,
        logout,
        refresh: fetchMe,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
