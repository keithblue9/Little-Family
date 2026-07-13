import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Trophy, Plus, Trash2, Users, Target, Gift, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { todayKey } from "@/lib/dates";

export default function FamilyChallenges({ kids }) {
  const [challenges, setChallenges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/challenges");
      setChallenges(data);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const del = async (c) => {
    if (!window.confirm(`Hapus tantangan "${c.title}"?`)) return;
    try {
      await api.delete(`/challenges/${c.id}`);
      toast.success("Tantangan dihapus");
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-parent font-bold text-lg text-slate-900 flex items-center gap-2">
          <Trophy className="w-5 h-5 text-amber-500" /> Tantangan Keluarga
        </h3>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="press-btn inline-flex items-center gap-1.5 bg-indigo-500 hover:bg-indigo-600 text-white font-semibold px-4 py-2 rounded-xl text-sm"
        >
          <Plus className="w-4 h-4" /> {showForm ? "Batal" : "Buat Tantangan"}
        </button>
      </div>

      {showForm && (
        <ChallengeForm kids={kids} onCreated={() => { setShowForm(false); load(); }} />
      )}

      {loading ? (
        <div className="text-center text-slate-400 py-6">Memuat…</div>
      ) : challenges.length === 0 ? (
        <div className="text-center text-slate-400 py-6 text-sm">
          Belum ada tantangan. Buat satu untuk mendorong kerja sama antar anak!
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {challenges.map((c) => (
            <ChallengeCard key={c.id} challenge={c} kids={kids} onDelete={() => del(c)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChallengeForm({ kids, onCreated }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedKids, setSelectedKids] = useState(kids.map((k) => k.id));
  const [targetPoints, setTargetPoints] = useState(50);
  const [startDate, setStartDate] = useState(todayKey());
  const [endDate, setEndDate] = useState(todayKey());
  const [reward, setReward] = useState("");
  const [saving, setSaving] = useState(false);

  const toggleKid = (id) => {
    setSelectedKids((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const submit = async () => {
    if (!title.trim()) return toast.error("Judul tantangan wajib diisi");
    if (selectedKids.length === 0) return toast.error("Pilih minimal satu anak");
    if (!targetPoints || targetPoints < 1) return toast.error("Target poin harus lebih dari 0");
    if (endDate < startDate) return toast.error("Tanggal selesai harus setelah tanggal mulai");
    setSaving(true);
    try {
      await api.post("/challenges", {
        title: title.trim(),
        description,
        participant_ids: selectedKids,
        target_points: Number(targetPoints),
        start_date: startDate,
        end_date: endDate,
        reward_description: reward,
      });
      toast.success("Tantangan dibuat! 🎉");
      onCreated();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-slate-50 rounded-xl p-4 mb-4 border border-slate-200 space-y-3">
      <input
        value={title} onChange={(e) => setTitle(e.target.value)}
        placeholder="Judul, mis. Minggu Rajin Bersama"
        className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none"
      />
      <textarea
        value={description} onChange={(e) => setDescription(e.target.value)}
        placeholder="Deskripsi (opsional)"
        className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none resize-none"
        rows={2}
      />
      <div>
        <span className="text-xs font-semibold text-slate-600 block mb-1">Anak yang ikut</span>
        <div className="flex gap-2 flex-wrap">
          {kids.map((k) => (
            <button
              key={k.id}
              onClick={() => toggleKid(k.id)}
              className={`px-3 py-1.5 rounded-lg border-2 text-sm font-semibold flex items-center gap-1.5 ${
                selectedKids.includes(k.id) ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600"
              }`}
            >
              <span>{k.avatar_emoji}</span> {k.name}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <span className="text-xs text-slate-500">Target poin gabungan</span>
          <input type="number" min="1" value={targetPoints} onChange={(e) => setTargetPoints(e.target.value)}
            className="w-full px-3 py-1.5 border-2 border-slate-200 rounded-lg text-sm" />
        </div>
        <div>
          <span className="text-xs text-slate-500">Mulai</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
            className="w-full px-3 py-1.5 border-2 border-slate-200 rounded-lg text-sm" />
        </div>
        <div>
          <span className="text-xs text-slate-500">Selesai</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
            className="w-full px-3 py-1.5 border-2 border-slate-200 rounded-lg text-sm" />
        </div>
      </div>
      <input
        value={reward} onChange={(e) => setReward(e.target.value)}
        placeholder="Hadiah kalau tercapai, mis. Nonton bareng 🎬"
        className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none"
      />
      <button
        onClick={submit}
        disabled={saving}
        className="w-full py-2.5 rounded-xl font-semibold bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-60"
      >
        {saving ? "Membuat…" : "Buat Tantangan"}
      </button>
    </div>
  );
}

function ChallengeCard({ challenge: c, kids, onDelete }) {
  const participants = c.participant_ids.map((id) => kids.find((k) => k.id === id)).filter(Boolean);
  const statusMeta = {
    active: { label: "Berjalan", color: "text-blue-600 bg-blue-50", icon: Clock },
    completed: { label: "Tercapai!", color: "text-green-600 bg-green-50", icon: CheckCircle2 },
    expired: { label: "Waktu habis", color: "text-slate-500 bg-slate-100", icon: Clock },
  }[c.status] || { label: c.status, color: "text-slate-500 bg-slate-100", icon: Clock };
  const StatusIcon = statusMeta.icon;

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="border-2 border-slate-100 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-fun font-bold text-slate-900">{c.title}</div>
          {c.description && <div className="text-xs text-slate-500 mt-0.5">{c.description}</div>}
        </div>
        <button onClick={onDelete} className="press-btn p-1.5 rounded-lg hover:bg-red-50 text-red-400 shrink-0">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${statusMeta.color}`}>
          <StatusIcon className="w-3 h-3" /> {statusMeta.label}
        </span>
        <span className="text-xs text-slate-400 flex items-center gap-1">
          <Users className="w-3 h-3" /> {participants.map((p) => p.name).join(" & ")}
        </span>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
          <span className="flex items-center gap-1"><Target className="w-3 h-3" /> {c.earned_points} / {c.target_points} poin</span>
          <span className="font-bold text-slate-700">{c.percent}%</span>
        </div>
        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${c.percent}%` }}
            transition={{ duration: 0.6 }}
            className={`h-full rounded-full ${c.goal_met ? "bg-gradient-to-r from-green-400 to-emerald-500" : "bg-gradient-to-r from-indigo-400 to-indigo-500"}`}
          />
        </div>
      </div>

      <div className="text-xs text-slate-400 mt-2">{c.start_date} — {c.end_date}</div>
      {c.reward_description && (
        <div className="mt-2 text-xs font-semibold text-amber-600 flex items-center gap-1">
          <Gift className="w-3.5 h-3.5" /> {c.reward_description}
        </div>
      )}
    </motion.div>
  );
}
