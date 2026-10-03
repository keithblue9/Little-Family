import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings2, Users } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { qk } from "@/lib/queries";

/**
 * Misi Keluarga — one weekly goal the whole family fills together. Every
 * approved point from every child counts, the bar is shared, and so is the
 * reward. Shown on the child's Misi tab and on the parent's Overview; parents
 * can switch it on and set the target right here.
 */
export default function FamilyMissionCard({ editable = false, compact = false }) {
  const qc = useQueryClient();
  const { data: m } = useQuery({
    queryKey: qk.familyMission,
    queryFn: async () => (await api.get("/family-mission")).data,
    staleTime: 60_000,
  });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  if (!m) return null;
  if (!m.enabled && !editable) return null;

  const startEdit = () => {
    setForm({
      enabled: true,
      title: m.title,
      target_points: m.target_points,
      reward: m.reward,
      emoji: m.emoji,
    });
    setEditing(true);
  };

  const save = async (patch) => {
    setSaving(true);
    try {
      const { data } = await api.put("/family-mission", { ...form, ...patch });
      qc.setQueryData(qk.familyMission, data);
      setEditing(false);
      toast.success(data.enabled ? "Misi Keluarga disimpan" : "Misi Keluarga dimatikan");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  if (editing && form) {
    const inputCls = "w-full px-3 py-2 border-2 border-slate-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none";
    return (
      <div className="bg-white rounded-2xl border-2 border-indigo-100 p-5 space-y-3">
        <div className="font-parent font-bold text-slate-900">Atur Misi Keluarga</div>
        <div className="grid grid-cols-[4rem_1fr] gap-2">
          <input aria-label="Emoji" className={`${inputCls} text-center text-xl`} value={form.emoji}
                 onChange={(e) => setForm({ ...form, emoji: e.target.value })} maxLength={8} />
          <input aria-label="Nama misi" className={inputCls} value={form.title}
                 onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={60} />
        </div>
        <label className="block text-sm text-slate-600">
          Target poin seminggu (semua anak digabung)
          <input type="number" min={10} className={`${inputCls} mt-1`} value={form.target_points}
                 onChange={(e) => setForm({ ...form, target_points: Number(e.target.value) || 0 })} />
        </label>
        <label className="block text-sm text-slate-600">
          Hadiah bersama
          <input className={`${inputCls} mt-1`} placeholder="mis. Piknik ke taman hari Minggu" value={form.reward}
                 onChange={(e) => setForm({ ...form, reward: e.target.value })} maxLength={120} />
        </label>
        <div className="flex flex-wrap gap-2 pt-1">
          <button onClick={() => save({})} disabled={saving || form.target_points < 10}
                  className="press-btn px-4 py-2 rounded-xl bg-indigo-500 text-white font-semibold text-sm disabled:opacity-50">
            Simpan
          </button>
          <button onClick={() => setEditing(false)} disabled={saving}
                  className="press-btn px-4 py-2 rounded-xl bg-slate-100 text-slate-600 font-semibold text-sm">
            Batal
          </button>
          {m.enabled && (
            <button onClick={() => save({ enabled: false })} disabled={saving}
                    className="press-btn px-4 py-2 rounded-xl text-red-600 hover:bg-red-50 font-semibold text-sm ml-auto">
              Matikan
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!m.enabled) {
    return (
      <div className="bg-white rounded-2xl border-2 border-dashed border-indigo-200 p-5 flex items-center gap-4">
        <div className="text-3xl">🏰</div>
        <div className="flex-1 min-w-0">
          <div className="font-parent font-bold text-slate-900">Misi Keluarga</div>
          <div className="text-sm text-slate-500">Satu target mingguan yang dikumpulkan bersama semua anak, dengan hadiah bersama.</div>
        </div>
        <button onClick={startEdit} className="press-btn px-4 py-2 rounded-xl bg-indigo-500 text-white font-semibold text-sm shrink-0">
          Aktifkan
        </button>
      </div>
    );
  }

  const total = Math.max(1, m.earned_points);
  return (
    <div className={`rounded-3xl p-4 border-2 chunky-shadow ${m.goal_met ? "bg-emerald-50 border-emerald-200" : "bg-white border-indigo-100"}`}>
      <div className="flex items-center gap-3">
        <div className="text-3xl" aria-hidden="true">{m.goal_met ? "🎉" : m.emoji}</div>
        <div className="flex-1 min-w-0">
          <div className="font-fun font-bold text-slate-900 truncate flex items-center gap-1.5">
            <Users className="w-4 h-4 text-indigo-500 shrink-0" /> {m.title}
          </div>
          <div className="text-xs text-slate-500">
            {m.goal_met
              ? `Tercapai! ${m.reward ? `Hadiah: ${m.reward}` : "Hebat, tim!"}`
              : `${m.earned_points}/${m.target_points} poin bersama${m.reward ? ` · 🎁 ${m.reward}` : ""}`}
          </div>
        </div>
        {editable && (
          <button onClick={startEdit} className="press-btn p-2 rounded-xl hover:bg-slate-100 text-slate-500" title="Atur misi">
            <Settings2 className="w-4 h-4" />
          </button>
        )}
      </div>
      {/* One shared bar, coloured by who contributed — teamwork made visible. */}
      <div className="h-3 bg-slate-100 rounded-full overflow-hidden mt-3 flex" role="progressbar"
           aria-valuenow={m.percent} aria-valuemin={0} aria-valuemax={100}>
        {m.contributions.filter((c) => c.points > 0).map((c) => (
          <div key={c.id} title={`${c.name}: ${c.points}`}
               style={{ width: `${(c.points / total) * m.percent}%`, background: c.avatar_color || "#6366F1" }} />
        ))}
      </div>
      {!compact && (
        <div className="flex items-center justify-between mt-2 text-xs text-slate-500 gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {m.contributions.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.avatar_color || "#6366F1" }} />
                {c.avatar_emoji} {c.points}
              </span>
            ))}
          </div>
          {!m.goal_met && m.days_left > 0 && (
            <span className="font-semibold">±{m.per_day_needed} poin/hari · {m.days_left} hari lagi</span>
          )}
        </div>
      )}
    </div>
  );
}
