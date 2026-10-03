import { lazy } from "react";
import { Gift, Plus, Trash2, CheckCircle2, XCircle, Star, Pencil } from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { TEST_IDS } from "@/constants/testIds/app";
import { btnDanger, btnGhost, btnPrimary } from "@/pages/parent/shared";

const RewardSuggestionsReview = lazy(() => import("@/components/RewardSuggestionsReview"));

export function RewardsView({ rewards, redemptions, kids, selectedChildId, onAdd, onEdit, onRefresh }) {
  const del = async (r) => {
    try { await api.delete(`/rewards/${r.id}`); toast.success("Reward deleted"); onRefresh(); }
    catch (e) { toast.error(formatApiError(e)); }
  };
  const fulfill = async (r) => {
    try { await api.post(`/redemptions/${r.id}/fulfill`); toast.success("Ditandai sudah diberikan"); onRefresh(); }
    catch (e) { toast.error(formatApiError(e)); }
  };
  const cancelRedemption = async (r) => {
    if (!window.confirm(`Batalkan penukaran "${r.reward_name}"? ${r.cost_points} poin akan dikembalikan ke Tabungan anak.`)) return;
    try { await api.post(`/redemptions/${r.id}/cancel`); toast.success("Dibatalkan, tabungan dikembalikan"); onRefresh(); }
    catch (e) { toast.error(formatApiError(e)); }
  };
  const filteredRedemptions = selectedChildId
    ? redemptions.filter((r) => r.child_id === selectedChildId)
    : redemptions;

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button onClick={onAdd} data-testid={TEST_IDS.parent.addRewardBtn} className={btnPrimary}>
          <Plus className="w-4 h-4" strokeWidth={2.5} /> New reward
        </button>
      </div>

      <RewardSuggestionsReview kids={kids} onRewardCreated={onRefresh} />

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h3 className="font-parent font-bold text-lg text-slate-900 mb-4">Reward store</h3>
        {rewards.length === 0 ? (
          <div className="text-sm text-slate-400 text-center py-8">No rewards yet. Create one to motivate your kids!</div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {rewards.map((r) => (
              <div key={r.id} data-testid={`${TEST_IDS.parent.rewardItem}-${r.id}`} className="border border-slate-200 rounded-xl p-4">
                <div className="flex items-start gap-3 mb-3">
                  {r.image ? (
                    <img src={r.image} alt={r.name} className="w-10 h-10 rounded-xl object-cover flex-shrink-0 border border-slate-200" />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-[#FF9D23]/15 flex items-center justify-center flex-shrink-0">
                      <Gift className="w-5 h-5 text-[#FF9D23]" strokeWidth={2.5} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-900 truncate">{r.name}</div>
                    <div className="text-xs text-slate-500 truncate">{r.description}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 text-sm">
                    <Star className="w-4 h-4 text-[#FF9D23]" strokeWidth={2.5} />
                    <span className="font-bold">{r.cost_points}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => onEdit(r)} data-testid={`edit-reward-btn-${r.id}`} className={btnGhost} title="Edit hadiah">
                      <Pencil className="w-4 h-4" strokeWidth={2.5} />
                    </button>
                    <button onClick={() => del(r)} data-testid={`${TEST_IDS.parent.deleteRewardBtn}-${r.id}`} className={btnDanger}>
                      <Trash2 className="w-4 h-4" strokeWidth={2.5} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h3 className="font-parent font-bold text-lg text-slate-900 mb-4">Redemption requests</h3>
        {filteredRedemptions.length === 0 ? (
          <div className="text-sm text-slate-400 text-center py-6">No requests yet.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredRedemptions.map((r) => {
              const child = kids.find((c) => c.id === r.child_id);
              return (
                <div key={r.id} className="py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-900">{r.reward_name}</div>
                    <div className="text-xs text-slate-500">
                      {child?.name || "—"} · {r.cost_points} pts · {new Date(r.created_at).toLocaleString()}
                    </div>
                  </div>
                  {r.status === "pending" ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => fulfill(r)} data-testid={`${TEST_IDS.parent.fulfillRedemptionBtn}-${r.id}`} className="press-btn inline-flex items-center gap-1 bg-[#34D399] hover:bg-[#22c583] text-white font-semibold px-3 py-1.5 rounded-lg text-sm">
                        <CheckCircle2 className="w-4 h-4" strokeWidth={2.5} /> Diberikan
                      </button>
                      <button onClick={() => cancelRedemption(r)} className="press-btn inline-flex items-center gap-1 border-2 border-slate-200 text-slate-500 hover:bg-slate-50 font-semibold px-2.5 py-1.5 rounded-lg text-sm" title="Batalkan & kembalikan tabungan">
                        <XCircle className="w-4 h-4" strokeWidth={2.5} />
                      </button>
                    </div>
                  ) : r.status === "cancelled" ? (
                    <span className="text-xs text-slate-400 font-semibold shrink-0">Dibatalkan</span>
                  ) : (
                    <span className="text-xs text-[#34D399] font-semibold shrink-0">Diberikan</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
