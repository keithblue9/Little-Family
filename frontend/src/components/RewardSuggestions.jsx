import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, Plus, Clock, CheckCircle2, XCircle, X } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

export default function RewardSuggestions() {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => {
    api.get("/reward-suggestions")
      .then(({ data }) => setSuggestions(data))
      .catch((e) => toast.error(formatApiError(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!name.trim()) return toast.error("Kasih nama hadiahnya dulu ya");
    setSaving(true);
    try {
      await api.post("/reward-suggestions", {
        name: name.trim(), description,
        suggested_cost_points: cost ? Number(cost) : null,
      });
      toast.success("Usulan terkirim! Tunggu jawaban Abi/Ummi ya 🎉");
      setName(""); setDescription(""); setCost(""); setShowForm(false);
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const withdraw = async (id) => {
    try {
      await api.delete(`/reward-suggestions/${id}`);
      toast.success("Usulan dibatalkan");
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const statusMeta = {
    pending: { label: "Menunggu", icon: Clock, color: "text-amber-600 bg-amber-50" },
    approved: { label: "Diterima! 🎉", icon: CheckCircle2, color: "text-green-600 bg-green-50" },
    rejected: { label: "Belum bisa", icon: XCircle, color: "text-slate-500 bg-slate-100" },
  };

  if (loading) return null;

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-fun font-bold text-sm text-slate-500 flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-violet-400" /> Usulan Hadiahku
        </h3>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="press-btn inline-flex items-center gap-1 text-xs font-bold text-violet-500 bg-violet-50 hover:bg-violet-100 px-2.5 py-1 rounded-full"
        >
          {showForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />} {showForm ? "Batal" : "Usul Hadiah"}
        </button>
      </div>

      {showForm && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="bg-white rounded-2xl p-3 border-2 border-violet-100 mb-2 space-y-2">
          <input
            value={name} onChange={(e) => setName(e.target.value.slice(0, 80))}
            placeholder="Nama hadiah, mis. Lego Ninjago"
            className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg text-sm focus:border-violet-400 focus:outline-none"
          />
          <input
            value={description} onChange={(e) => setDescription(e.target.value.slice(0, 200))}
            placeholder="Ceritain sedikit (opsional)"
            className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg text-sm focus:border-violet-400 focus:outline-none"
          />
          <input
            type="number" min="1" value={cost} onChange={(e) => setCost(e.target.value)}
            placeholder="Kira-kira berapa poin? (opsional)"
            className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg text-sm focus:border-violet-400 focus:outline-none"
          />
          <button
            onClick={submit} disabled={saving}
            className="w-full py-2 rounded-lg font-semibold text-sm bg-violet-500 hover:bg-violet-600 text-white disabled:opacity-60"
          >
            {saving ? "Mengirim…" : "Kirim Usulan"}
          </button>
        </motion.div>
      )}

      {suggestions.length > 0 && (
        <div className="space-y-1.5">
          {suggestions.map((s) => {
            const meta = statusMeta[s.status] || statusMeta.pending;
            const Icon = meta.icon;
            return (
              <div key={s.id} className="bg-white rounded-xl px-3 py-2 border border-slate-100 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-800 truncate">{s.name}</div>
                  {s.review_note && <div className="text-xs text-slate-400 truncate">{s.review_note}</div>}
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shrink-0 ${meta.color}`}>
                  <Icon className="w-3 h-3" /> {meta.label}
                </span>
                {s.status === "pending" && (
                  <button onClick={() => withdraw(s.id)} className="press-btn p-1 rounded-full hover:bg-red-50 text-red-400 shrink-0" title="Batalkan usulan">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
