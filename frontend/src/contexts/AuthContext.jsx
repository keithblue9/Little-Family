import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null=loading, false=logged out, object=logged in
  const [members, setMembers] = useState([]);

  const fetchMe = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch {
      setUser(false);
      localStorage.removeItem("cq_token");
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
