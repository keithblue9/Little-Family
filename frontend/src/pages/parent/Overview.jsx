import { lazy, Suspense } from "react";
import { Plus, CheckCircle2, Star, Users, Clock } from "lucide-react";
import { TEST_IDS } from "@/constants/testIds/app";
import { StatCard, btnPrimary } from "@/pages/parent/shared";

const Leaderboard = lazy(() => import("@/components/Leaderboard"));
const WeeklyReport = lazy(() => import("@/components/WeeklyReport"));
const FamilyChallenges = lazy(() => import("@/components/FamilyChallenges"));
const FamilyMissionCard = lazy(() => import("@/components/FamilyMissionCard"));

export function Overview({ stats, kids, tasks, pendingRedemptions, onAddChild, onNavigate }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Anak" value={stats?.children_count ?? "—"} icon={Users} color="#6366F1" onClick={() => onNavigate("settings")} />
        <StatCard label="Menunggu cek" value={stats?.pending_approval ?? "—"} sub="Tugas menunggumu" icon={Clock} color="#FF9D23" onClick={() => onNavigate("tasks")} />
        <StatCard label="Disetujui hari ini" value={stats?.approved_today ?? "—"} icon={CheckCircle2} color="#34D399" onClick={() => onNavigate("monitor")} />
        <StatCard label="Total poin" value={stats?.total_points ?? "—"} sub="Semua anak" icon={Star} color="#4DB8FF" onClick={() => onNavigate("money")} />
      </div>

      <Suspense fallback={null}><FamilyMissionCard editable /></Suspense>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 bg-white rounded-2xl p-6 border border-slate-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-parent font-bold text-lg text-slate-900">Anak-anak</h3>
            <button onClick={onAddChild} data-testid={TEST_IDS.parent.addChildBtn} className={btnPrimary}>
              <Plus className="w-4 h-4" strokeWidth={2.5} /> Tambah anak
            </button>
          </div>
          {kids.length === 0 ? (
            <div className="text-center py-10 text-slate-400">Belum ada anak. Tambahkan untuk mulai.</div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              {kids.map((c) => {
                const pending = tasks.filter((t) => t.child_id === c.id && t.status === "completed").length;
                return (
                  <div key={c.id} data-testid={`${TEST_IDS.parent.childCard}-${c.name}`} className="border border-slate-200 rounded-2xl p-4 flex gap-3 items-center">
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0" style={{ background: c.avatar_color }}>
                      {c.avatar_emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-parent font-bold text-slate-900 truncate">{c.name}</div>
                      <div className="text-xs text-slate-500">{c.points} poin · {c.streak_days || 0} hari streak</div>
                      {pending > 0 && (
                        <div className="text-xs text-[#FF9D23] font-semibold mt-1">{pending} menunggu cek</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl p-6 border border-slate-200">
          <h3 className="font-parent font-bold text-lg text-slate-900 mb-4">Permintaan hadiah</h3>
          {pendingRedemptions.length === 0 ? (
            <div className="text-sm text-slate-400 py-4">Tidak ada permintaan hadiah.</div>
          ) : (
            <div className="space-y-3">
              {pendingRedemptions.slice(0, 5).map((r) => (
                <div key={r.id} className="text-sm">
                  <div className="font-semibold text-slate-800">{r.reward_name}</div>
                  <div className="text-xs text-slate-500">{r.cost_points} poin</div>
                </div>
              ))}
              <button onClick={() => onNavigate("rewards")} className="text-sm text-[#6366F1] font-semibold mt-2">Kelola →</button>
            </div>
          )}
        </div>
      </div>

      {/* Merged: Leaderboard */}
      {kids.length > 0 && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200">
          <Leaderboard />
        </div>
      )}

      {/* Family challenges */}
      {kids.length > 0 && <FamilyChallenges kids={kids} />}

      {/* Merged: Weekly report */}
      {kids.length > 0 && <WeeklyReport />}
    </div>
  );
}
