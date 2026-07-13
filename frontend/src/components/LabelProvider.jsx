import { useEffect, useState, useCallback } from "react";
import { LabelContext } from "@/lib/labels";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api";

export default function LabelProvider({ children }) {
  const { user } = useAuth();
  const [custom, setCustom] = useState({});
  const [language, setLanguage] = useState("id");

  const refresh = useCallback(async () => {
    // Only fetch when authenticated (config endpoint requires auth)
    if (!user || user === false || user === "error" || user === null) return;
    try {
      const { data } = await api.get("/config");
      setCustom(data.custom_labels || {});
      setLanguage(data.language || "id");
    } catch {
      // Non-fatal: fall back to default labels
    }
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  // Allow children to trigger a refresh after editing labels
  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener("labels-updated", handler);
    return () => window.removeEventListener("labels-updated", handler);
  }, [refresh]);

  return (
    <LabelContext.Provider value={{ custom, language }}>
      {children}
    </LabelContext.Provider>
  );
}
