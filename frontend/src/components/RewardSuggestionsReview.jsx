import { useEffect, useState } from "react";
import { Sparkles, Check, X } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

export default function RewardSuggestionsReview({ kids, onRewardCreated }) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [costDrafts, setCostDrafts] = useState({}); // id -> string
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    api.get("/reward-suggestions")
      .then(({ data }) => setSuggestions(data.filter((s) => s.status === "pending")))
      .catch((e) => toast.error(formatApiError(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const kidName = (id) => kids.find((k) => k.id === id)?.name || "?";

  const approve = async (s) => {
    const draft = costDrafts[s.id];
    const cost = draft ? Number(draft) : s.suggested_cost_points;
    if (!cost || cost < 1) {
      toast.error("Tentukan harga poin untuk hadiah ini");
      return;
    }
    setBusyId(s.id);
    try {
      await api.post(`/reward-suggestions/${s.id}/approve`, { cost_points: cost });
      toast.success(`"${s.name}" ditambahkan ke toko hadiah!`);
      load();
      onRewardCreated?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (s) => {
    const note = window.prompt(`Kasih tahu ${kidName(s.child_id)} kenapa (opsional):`, "") || "";
    setBusyId(s.id);
    try {
      await api.post(`/reward-suggestions/${s.id}/reject`, { note });
      toast("Usulan ditolak, anak akan diberi tahu");
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusyId(null);
    }
  };

  if (loading || suggestions.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-violet-200 p-6">
      <h3 className="font-parent font-bold text-lg text-slate-900 mb-1 flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-violet-500" /> Usulan Hadiah dari Anak
      </h3>
      <p className="text-sm text-slate-500 mb-4">{suggestions.length} usulan menunggu keputusanmu.</p>
      <div className="space-y-3">
        {suggestions.map((s) => (
          <div key={s.id} className="border border-slate-200 rounded-xl p-3 flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[140px]">
              <div className="font-semibold text-slate-900">{s.name}</div>
              <div className="text-xs text-slate-500">
                {kidName(s.child_id)}{s.description ? ` — ${s.description}` : ""}
              </div>
            </div>
            <input
              type="number" min="1"
              placeholder={s.suggested_cost_points ? String(s.suggested_cost_points) : "Poin"}
              value={costDrafts[s.id] ?? ""}
              onChange={(e) => setCostDrafts((prev) => ({ ...prev, [s.id]: e.target.value }))}
              className="w-24 px-2 py-1.5 border-2 border-slate-200 rounded-lg text-sm"
            />
            <button
              onClick={() => approve(s)}
              disabled={busyId === s.id}
              className="press-btn inline-flex items-center gap-1 bg-[#34D399] hover:bg-[#22c583] text-white font-semibold px-3 py-1.5 rounded-lg text-sm disabled:opacity-60"
            >
              <Check className="w-4 h-4" /> Terima
            </button>
            <button
              onClick={() => reject(s)}
              disabled={busyId === s.id}
              className="press-btn p-1.5 rounded-lg hover:bg-red-50 text-red-500 disabled:opacity-60"
              title="Tolak usulan"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
