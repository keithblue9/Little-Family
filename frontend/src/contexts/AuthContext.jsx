import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null=loading, false=logged out, object=logged in
  const [members, setMembers] = useState([]);

  const fetchMe = useCallback(async (attempt = 0) => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401) {
        // Genuinely not authenticated — clear the stale token and send to login.
        setUser(false);
        localStorage.removeItem("cq_token");
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

  const login = async (memberId, passcode) => {
    const { data } = await api.post("/auth/login", { member_id: memberId, passcode });
    if (data.token) localStorage.setItem("cq_token", data.token);
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
