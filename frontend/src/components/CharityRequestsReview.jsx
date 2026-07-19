import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

const fmtRp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

/**
 * Parent review of kids' sedekah (charity) requests. Approving confirms the
 * parent has handed over the cash to be donated (points already left the
 * child's balance when they requested). Rejecting refunds the sedekah points.
 * Self-hides when there are no pending requests.
 */
export default function CharityRequestsReview({ onChanged }) {
  const [requests, setRequests] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get("/charity-requests");
      setRequests(data.filter((r) => r.status === "pending"));
    } catch { /* non-fatal */ }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (r, action) => {
    setBusyId(r.id);
    try {
      await api.post(`/charity-requests/${r.id}/${action}`);
      toast.success(action === "approve" ? `Sedekah ${r.child_name} disalurkan 🤲` : "Permintaan ditolak, poin dikembalikan");
      load();
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusyId(null);
    }
  };

  if (requests.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <h3 className="font-parent font-bold text-lg text-slate-900 mb-1 flex items-center gap-2">
        <span className="text-xl">🤲</span> Permintaan Sedekah
      </h3>
      <p className="text-sm text-slate-500 mb-4">
        Anak ingin bersedekah dari poin Sedekahnya. Setujui jika kamu sudah menyalurkan uangnya, atau tolak untuk mengembalikan poinnya.
      </p>
      <div className="space-y-3">
        {requests.map((r) => (
          <div key={r.id} className="flex items-center gap-3 border-2 border-slate-100 rounded-2xl p-3">
            <div className="w-11 h-11 rounded-full bg-pink-50 flex items-center justify-center shrink-0 text-xl">🤲</div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-slate-800 text-sm">{r.child_name}</div>
              <div className="text-xs text-slate-500">
                {r.points} poin = <b className="text-pink-600">{fmtRp(r.rupiah)}</b>
                {r.note ? ` · "${r.note}"` : ""}
              </div>
            </div>
            <button
              onClick={() => act(r, "approve")}
              disabled={busyId === r.id}
              className="press-btn inline-flex items-center gap-1 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-3 py-1.5 rounded-lg text-sm disabled:opacity-60"
            >
              <Check className="w-4 h-4" strokeWidth={2.5} /> Salurkan
            </button>
            <button
              onClick={() => act(r, "reject")}
              disabled={busyId === r.id}
              className="press-btn inline-flex items-center gap-1 border-2 border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold px-3 py-1.5 rounded-lg text-sm disabled:opacity-60"
            >
              <X className="w-4 h-4" strokeWidth={2.5} /> Tolak
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
