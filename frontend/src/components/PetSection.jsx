import { useCallback, useEffect, useState } from "react";
import api from "@/lib/api";
import VirtualPetMascot from "@/components/VirtualPetMascot";
import PetWorld from "@/components/PetWorld";

/**
 * The pet card plus everything around it, sharing one pet state so the mood,
 * time of day and path shown on the card match what the rest of the screen says.
 */
export default function PetSection({ child, onChanged, ...rest }) {
  const [state, setState] = useState(null);
  const reload = useCallback(async () => {
    if (!child?.id || !child.pet_type) { setState(null); return; }
    try {
      const { data } = await api.get(`/children/${child.id}/pet`, { fresh: true });
      setState(data);
    } catch { /* the card still works from the child record */ }
  }, [child?.id, child?.pet_type]);

  useEffect(() => { reload(); }, [reload, child?.pet_feed_count, child?.feed_balance]);
  useEffect(() => {
    window.addEventListener("app:pet-refresh", reload);
    return () => window.removeEventListener("app:pet-refresh", reload);
  }, [reload]);

  const live = state?.has_pet && !state.dead;
  const changed = () => { onChanged?.(); reload(); };
  return (
    <>
      <VirtualPetMascot child={child} onChanged={changed} {...rest}
        serverMood={live ? state.mood : undefined} phase={live ? state.phase : undefined}
        pathIcon={live ? state.path_icon : undefined} pathLabel={live ? state.path_label : undefined} />
      {state && <PetWorld child={child} state={state} reload={reload} onChanged={onChanged} />}
    </>
  );
}
