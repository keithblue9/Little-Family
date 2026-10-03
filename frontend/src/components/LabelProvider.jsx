import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LabelContext } from "@/lib/labels";
import { useAuth } from "@/contexts/AuthContext";
import { useConfigLite, qk } from "@/lib/queries";

export default function LabelProvider({ children }) {
  const { user } = useAuth();
  const signedIn = !!user && typeof user === "object" && !user.maintenance;
  const qc = useQueryClient();
  // Shared, cached and light (no uploaded images) — one request for the whole app.
  const { data } = useConfigLite(signedIn);

  // Allow children to trigger a refresh after editing labels
  useEffect(() => {
    const handler = () => qc.invalidateQueries({ queryKey: qk.configLite });
    window.addEventListener("labels-updated", handler);
    return () => window.removeEventListener("labels-updated", handler);
  }, [qc]);

  const value = useMemo(
    () => ({ custom: data?.custom_labels || {}, language: data?.language || "id" }),
    [data],
  );

  return <LabelContext.Provider value={value}>{children}</LabelContext.Provider>;
}
