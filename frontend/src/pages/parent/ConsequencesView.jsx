import { ShieldAlert, Plus, Trash2, Pencil } from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { TEST_IDS } from "@/constants/testIds/app";
import { btnDanger, btnGhost, btnPrimary } from "@/pages/parent/shared";

export function ConsequencesView({ consequences, kids, onAdd, onEdit, onRefresh, onApply }) {
  const del = async (c) => {
    try { await api.delete(`/consequences/${c.id}`); toast.success("Deleted"); onRefresh(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button onClick={onAdd} data-testid={TEST_IDS.parent.addConsequenceBtn} className={btnPrimary}>
          <Plus className="w-4 h-4" strokeWidth={2.5} /> New consequence
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        {consequences.length === 0 ? (
          <div className="text-sm text-slate-400 text-center py-8">No consequences configured. Add ones that fit your family.</div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {consequences.map((c) => (
              <div key={c.id} data-testid={`${TEST_IDS.parent.consequenceItem}-${c.id}`} className="border border-slate-200 rounded-xl p-4">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-[#FF5C5C]/15 flex items-center justify-center flex-shrink-0">
                    <ShieldAlert className="w-5 h-5 text-[#FF5C5C]" strokeWidth={2.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-900">{c.name}</div>
                    <div className="text-xs text-slate-500">{c.description}</div>
                    {c.points_deducted > 0 && (
                      <div className="text-xs text-red-500 font-semibold mt-1">−{c.points_deducted} pts</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => onApply(c)}
                    disabled={kids.length === 0}
                    data-testid={`${TEST_IDS.parent.applyConsequenceBtn}-${c.id}`}
                    className="press-btn inline-flex items-center gap-1 bg-[#FF5C5C] disabled:bg-slate-200 text-white font-semibold px-3 py-1.5 rounded-lg text-sm"
                  >
                    Terapkan
                  </button>
                  <div className="flex items-center gap-2">
                    <button onClick={() => onEdit(c)} data-testid={`edit-cons-btn-${c.id}`} className={btnGhost} title="Edit konsekuensi">
                      <Pencil className="w-4 h-4" strokeWidth={2.5} />
                    </button>
                    <button onClick={() => del(c)} className={btnDanger}>
                      <Trash2 className="w-4 h-4" strokeWidth={2.5} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
