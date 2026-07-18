import { useEffect, useState } from "react";
import { PawPrint, Check, X } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { getPetDef } from "@/lib/pets";
import PetSprite from "@/components/PetSprite";

/**
 * Parent-side review of kids' "please let me swap my pet" requests. Approving
 * clears that child's pet (they'll pick a new one); rejecting keeps it and
 * lets the parent leave a short note the kid will see.
 */
export default function PetResetRequestsReview({ onChanged }) {
  const [requests, setRequests] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get("/pet-reset-requests");
      setRequests(data.filter((r) => r.status === "pending"));
    } catch { /* non-fatal */ }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const approve = async (r) => {
    setBusyId(r.id);
    try {
      await api.post(`/pet-reset-requests/${r.id}/approve`, { note: "" });
      toast.success(`${r.child_name} boleh pilih peliharaan baru 🎉`);
      load();
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (r) => {
    const note = window.prompt(`Tolak permintaan ${r.child_name}? Pesan untuk anak (opsional):`, "Rawat dulu peliharaanmu yang sekarang ya 💛");
    if (note === null) return; // cancelled
    setBusyId(r.id);
    try {
      await api.post(`/pet-reset-requests/${r.id}/reject`, { note });
      toast("Permintaan ditolak, anak akan diberi tahu");
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusyId(null);
    }
  };

  if (requests.length === 0) return null; // hide entirely when nothing pending

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <h3 className="font-parent font-bold text-lg text-slate-900 mb-1 flex items-center gap-2">
        <PawPrint className="w-5 h-5 text-amber-500" /> Permintaan Ganti Peliharaan
      </h3>
      <p className="text-sm text-slate-500 mb-4">
        Anak mengajukan ingin mengganti peliharaannya. Setujui untuk membuka layar pilih peliharaan baru, atau tolak agar ia merawat yang sekarang.
      </p>
      <div className="space-y-3">
        {requests.map((r) => {
          const def = getPetDef(r.current_pet);
          return (
            <div key={r.id} className="flex items-center gap-3 border-2 border-slate-100 rounded-2xl p-3">
              <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center shrink-0">
                <PetSprite petType={r.current_pet} stageIndex={3} size={40} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-800 text-sm">{r.child_name}</div>
                <div className="text-xs text-slate-500">
                  Peliharaan sekarang: {def.name}
                  {r.reason ? ` · "${r.reason}"` : ""}
                </div>
              </div>
              <button
                onClick={() => approve(r)}
                disabled={busyId === r.id}
                className="press-btn inline-flex items-center gap-1 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-3 py-1.5 rounded-lg text-sm disabled:opacity-60"
              >
                <Check className="w-4 h-4" strokeWidth={2.5} /> Setujui
              </button>
              <button
                onClick={() => reject(r)}
                disabled={busyId === r.id}
                className="press-btn inline-flex items-center gap-1 border-2 border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold px-3 py-1.5 rounded-lg text-sm disabled:opacity-60"
              >
                <X className="w-4 h-4" strokeWidth={2.5} /> Tolak
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
