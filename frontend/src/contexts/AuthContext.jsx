import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null=loading, false=logged out, object=logged in
  const [parentUnlocked, setParentUnlocked] = useState(false);

  const fetchMe = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch {
      setUser(false);
      localStorage.removeItem("cq_token");
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    if (data.token) localStorage.setItem("cq_token", data.token);
    setUser({ id: data.id, email: data.email, name: data.name, has_pin: data.has_pin });
    setParentUnlocked(true);
    return data;
  };

  const register = async (name, email, password) => {
    const { data } = await api.post("/auth/register", { name, email, password });
    if (data.token) localStorage.setItem("cq_token", data.token);
    setUser({ id: data.id, email: data.email, name: data.name, has_pin: data.has_pin });
    setParentUnlocked(true);
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
    setParentUnlocked(false);
  };

  const setPin = async (pin) => {
    await api.post("/parent/pin", { pin });
    setUser((u) => (u ? { ...u, has_pin: true } : u));
  };

  const verifyPin = async (pin) => {
    await api.post("/parent/pin/verify", { pin });
    setParentUnlocked(true);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        parentUnlocked,
        setParentUnlocked,
        login,
        register,
        logout,
        setPin,
        verifyPin,
        refresh: fetchMe,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
