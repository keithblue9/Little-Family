import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Home, ListChecks, Gift, ShieldAlert, Activity, Settings, LogOut,
  Plus, Trash2, CheckCircle2, XCircle, AlertTriangle, Star, Users,
  Rocket, Menu, X, PartyPopper, Clock,
} from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import MoneyApprovals from "@/components/MoneyApprovals";
import ProfileEditor from "@/components/ProfileEditor";
import ConfigMenu from "@/components/ConfigMenu";
import MemberPasscodeManager from "@/components/ChildPasscodeManager";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import ProfilePhotoUpload from "@/components/ProfilePhotoUpload";
import ReminderCreator from "@/components/ReminderCreator";
import Leaderboard from "@/components/Leaderboard";
import Achievements from "@/components/Achievements";
import AnalyticsDashboard from "@/components/AnalyticsDashboard";
import PushNotificationManager from "@/components/PushNotificationManager";
import { TEST_IDS } from "@/constants/testIds/app";

const AVATAR_COLORS = ["#FF9D23", "#4DB8FF", "#34D399", "#FF5C5C", "#A78BFA", "#F472B6"];
const AVATAR_EMOJIS = ["🦁", "🐯", "🐻", "🦊", "🐼", "🐨", "🐰", "🐸", "🦄", "🐢", "🦖", "🐝"];

const NAV = [
  { key: "overview", label: "Overview", icon: Home },
  { key: "tasks", label: "Tasks", icon: ListChecks, testId: TEST_IDS.parent.tabTasks },
  { key: "rewards", label: "Rewards", icon: Gift, testId: TEST_IDS.parent.tabRewards },
  { key: "money", label: "Uang & Poin", icon: Gift, testId: "tab-money" },
  { key: "consequences", label: "Consequences", icon: ShieldAlert, testId: TEST_IDS.parent.tabConsequences },
  { key: "activity", label: "Activity", icon: Activity, testId: TEST_IDS.parent.tabActivity },
  { key: "leaderboard", label: "Leaderboard", icon: Users, testId: "tab-leaderboard" },
  { key: "analytics", label: "Analytics", icon: Activity, testId: "tab-analytics" },
  { key: "settings", label: "Settings", icon: Settings, testId: TEST_IDS.parent.tabSettings },
];

// ─────────────────────────────────────────────────────────
// Modal wrapper
function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.95, y: 10, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        className="bg-white rounded-3xl w-full max-w-lg p-6 border border-slate-200 shadow-xl"
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-parent font-bold text-xl text-slate-900">{title}</h3>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100" data-testid="modal-close-btn">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

const inputClass = "w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-[#6366F1] focus:outline-none font-body text-slate-800";
const labelClass = "block text-sm font-semibold text-slate-700 mb-1";
const btnPrimary = "inline-flex items-center gap-2 bg-[#6366F1] hover:bg-[#4f46e5] text-white font-semibold px-4 py-2.5 rounded-xl transition-colors";
const btnGhost = "inline-flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold px-4 py-2.5 rounded-xl transition-colors";
const btnDanger = "inline-flex items-center gap-2 bg-white border border-red-200 hover:bg-red-50 text-red-600 font-semibold px-3 py-2 rounded-xl transition-colors";

// ─────────────────────────────────────────────────────────
export default function ParentApp() {
  const nav = useNavigate();
  const { user, logout } = useAuth();
  const [view, setView] = useState("overview");
  const [children, setChildren] = useState([]);
  const [selectedChildId, setSelectedChildId] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [consequences, setConsequences] = useState([]);
  const [redemptions, setRedemptions] = useState([]);
  const [activity, setActivity] = useState([]);
  const [stats, setStats] = useState(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Modals
  const [childModal, setChildModal] = useState(false);
  const [taskModal, setTaskModal] = useState(false);
  const [rewardModal, setRewardModal] = useState(false);
  const [consModal, setConsModal] = useState(false);
  const [applyConsModal, setApplyConsModal] = useState(null);

  const load = useCallback(async () => {
    try {
      const [c, t, r, cq, rd, a, s] = await Promise.all([
        api.get("/children"),
        api.get("/tasks"),
        api.get("/rewards"),
        api.get("/consequences"),
        api.get("/redemptions"),
        api.get("/activity", { params: { limit: 40 } }),
        api.get("/stats/dashboard"),
      ]);
      setChildren(c.data);
      setTasks(t.data);
      setRewards(r.data);
      setConsequences(cq.data);
      setRedemptions(rd.data);
      setActivity(a.data);
      setStats(s.data);
      if (!selectedChildId && c.data[0]) setSelectedChildId(c.data[0].id);
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }, [selectedChildId]);

  useEffect(() => {
    load();
  }, [load]);

  const doLogout = async () => {
    await logout();
    nav("/");
  };

  const filteredTasks = useMemo(
    () => (selectedChildId ? tasks.filter((t) => t.child_id === selectedChildId) : tasks),
    [tasks, selectedChildId]
  );
  const pendingRedemptions = useMemo(
    () => redemptions.filter((r) => r.status === "pending"),
    [redemptions]
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-body flex" data-testid={TEST_IDS.parent.dashboard}>
      {/* Sidebar */}
      <aside
        className={`${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0 fixed md:sticky top-0 left-0 h-screen w-64 bg-white border-r border-slate-200 z-40 transition-transform flex flex-col`}
      >
        <div className="p-6 flex items-center gap-2 border-b border-slate-100">
          <div className="w-9 h-9 rounded-xl bg-[#FF9D23] flex items-center justify-center">
            <Rocket className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-fun font-bold text-xl text-slate-900">My Lil Famz</span>
        </div>
        <div className="px-6 py-3 flex items-center justify-between border-b border-slate-100">
          <span className="text-sm text-slate-500">
            Hi, <span className="font-semibold text-slate-700">{user?.name}</span>
          </span>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((n) => (
            <button
              key={n.key}
              onClick={() => { setView(n.key); setMobileNavOpen(false); }}
              data-testid={n.testId}
              className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl font-parent font-semibold text-sm transition-colors ${
                view === n.key
                  ? "bg-[#EEF2FF] text-[#4338CA]"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <n.icon className="w-4 h-4" strokeWidth={2.5} />
              {n.label}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-slate-100 space-y-2">
          <button
            onClick={() => nav("/kid")}
            data-testid={TEST_IDS.parent.switchToKidBtn}
            className="w-full flex items-center gap-2 justify-center bg-[#FFF4D1] hover:bg-[#FFE4A0] text-[#B4770F] font-semibold px-3 py-2.5 rounded-xl transition-colors"
          >
            <PartyPopper className="w-4 h-4" strokeWidth={2.5} />
            Kid mode
          </button>
          <button
            onClick={doLogout}
            data-testid={TEST_IDS.parent.logoutBtn}
            className="w-full flex items-center gap-2 justify-center text-slate-500 hover:text-red-600 px-3 py-2 text-sm transition-colors"
          >
            <LogOut className="w-4 h-4" strokeWidth={2.5} /> Sign out
          </button>
        </div>
      </aside>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-30 bg-slate-900/30 md:hidden" onClick={() => setMobileNavOpen(false)} />
      )}

      {/* Main */}
      <main className="flex-1 min-w-0">
        {/* Topbar */}
        <div className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-slate-200 px-4 md:px-8 py-4 flex items-center gap-4">
          <button className="md:hidden p-2" onClick={() => setMobileNavOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <div className="font-parent font-bold text-xl md:text-2xl text-slate-900 capitalize">{view}</div>
            <div className="text-sm text-slate-500">Hi {user?.name} · manage your family</div>
          </div>
          {children.length > 0 && view !== "settings" && view !== "activity" && (
            <select
              value={selectedChildId || ""}
              onChange={(e) => setSelectedChildId(e.target.value || null)}
              className="hidden sm:block px-3 py-2 rounded-xl border border-slate-200 font-semibold text-sm text-slate-700 bg-white"
              data-testid="parent-child-selector"
            >
              <option value="">All children</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </div>

        <div className="p-4 md:p-8 max-w-6xl">
          {view === "overview" && (
            <Overview stats={stats} kids={children} tasks={tasks} pendingRedemptions={pendingRedemptions} onAddChild={() => setChildModal(true)} onNavigate={setView} />
          )}
          {view === "tasks" && (
            <TasksView
              kids={children}
              tasks={filteredTasks}
              selectedChildId={selectedChildId}
              onAddTask={() => setTaskModal(true)}
              onRefresh={load}
              onApplyConsequence={(task) => setApplyConsModal({ task })}
              onAddChild={() => setChildModal(true)}
            />
          )}
          {view === "rewards" && (
            <RewardsView
              rewards={rewards}
              redemptions={redemptions}
              kids={children}
              selectedChildId={selectedChildId}
              onAdd={() => setRewardModal(true)}
              onRefresh={load}
            />
          )}
          {view === "money" && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <MoneyApprovals />
            </div>
          )}
          {view === "consequences" && (
            <ConsequencesView
              consequences={consequences}
              onAdd={() => setConsModal(true)}
              onRefresh={load}
              kids={children}
              onApply={(c) => setApplyConsModal({ consequence: c })}
            />
          )}
          {view === "activity" && <ActivityView activity={activity} kids={children} />}
          
          {/* Stage 4: Leaderboard */}
          {view === "leaderboard" && (
            <div className="space-y-6">
              <Leaderboard />
            </div>
          )}

          {/* Stage 4: Analytics */}
          {view === "analytics" && (
            <div className="space-y-6">
              <AnalyticsDashboard />
            </div>
          )}

          {view === "settings" && (
            <SettingsView
              kids={children}
              onAdd={() => setChildModal(true)}
              onRefresh={load}
            />
          )}
        </div>
      </main>

      {/* Modals */}
      <ChildFormModal open={childModal} onClose={() => setChildModal(false)} onSaved={load} />
      <TaskFormModal
        open={taskModal}
        onClose={() => setTaskModal(false)}
        kids={children}
        defaultChildId={selectedChildId}
        onSaved={load}
      />
      <RewardFormModal open={rewardModal} onClose={() => setRewardModal(false)} onSaved={load} />
      <ConsequenceFormModal open={consModal} onClose={() => setConsModal(false)} onSaved={load} />
      <ApplyConsequenceModal
        open={!!applyConsModal}
        onClose={() => setApplyConsModal(null)}
        consequences={consequences}
        kids={children}
        preselect={applyConsModal}
        selectedChildId={selectedChildId}
        onSaved={load}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color = "#6366F1", icon: Icon }) {
  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200">
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${color}22` }}>
          <Icon className="w-5 h-5" style={{ color }} strokeWidth={2.5} />
        </div>
      </div>
      <div className="font-parent font-bold text-3xl text-slate-900">{value}</div>
      <div className="text-sm text-slate-500">{label}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

function Overview({ stats, kids, tasks, pendingRedemptions, onAddChild, onNavigate }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Children" value={stats?.children_count ?? "—"} icon={Users} color="#6366F1" />
        <StatCard label="Pending approval" value={stats?.pending_approval ?? "—"} sub="Tasks waiting for you" icon={Clock} color="#FF9D23" />
        <StatCard label="Approved today" value={stats?.approved_today ?? "—"} icon={CheckCircle2} color="#34D399" />
        <StatCard label="Total points" value={stats?.total_points ?? "—"} sub="Across all kids" icon={Star} color="#4DB8FF" />
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 bg-white rounded-2xl p-6 border border-slate-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-parent font-bold text-lg text-slate-900">Your children</h3>
            <button
              onClick={onAddChild}
              data-testid={TEST_IDS.parent.addChildBtn}
              className={btnPrimary}
            >
              <Plus className="w-4 h-4" strokeWidth={2.5} /> Add child
            </button>
          </div>
          {kids.length === 0 ? (
            <div className="text-center py-10 text-slate-400">
              No children yet. Add your first child to get started.
            </div>
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
                      <div className="text-xs text-slate-500">{c.points} pts · {c.streak_days || 0}d streak</div>
                      {pending > 0 && (
                        <div className="text-xs text-[#FF9D23] font-semibold mt-1">
                          {pending} awaiting approval
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl p-6 border border-slate-200">
          <h3 className="font-parent font-bold text-lg text-slate-900 mb-4">Reward requests</h3>
          {pendingRedemptions.length === 0 ? (
            <div className="text-sm text-slate-400 py-4">No pending rewards.</div>
          ) : (
            <div className="space-y-3">
              {pendingRedemptions.slice(0, 5).map((r) => (
                <div key={r.id} className="text-sm">
                  <div className="font-semibold text-slate-800">{r.reward_name}</div>
                  <div className="text-xs text-slate-500">{r.cost_points} pts</div>
                </div>
              ))}
              <button onClick={() => onNavigate("rewards")} className="text-sm text-[#6366F1] font-semibold mt-2">
                Manage →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
function TasksView({ kids, tasks, selectedChildId, onAddTask, onRefresh, onApplyConsequence, onAddChild }) {
  const grouped = useMemo(() => {
    const byOrder = (a, b) => (a.order || 0) - (b.order || 0);
    const pending = tasks.filter((t) => t.status === "pending" || t.status === "rejected").sort(byOrder);
    const awaiting = tasks.filter((t) => t.status === "completed").sort(byOrder);
    const done = tasks.filter((t) => t.status === "approved" || t.status === "skipped").sort(byOrder);
    const missed = tasks.filter((t) => t.status === "missed");
    return { pending, awaiting, done, missed };
  }, [tasks]);

  const act = async (fn) => {
    try {
      await fn();
      onRefresh();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const approve = (t) => act(async () => {
    const { data } = await api.post(`/tasks/${t.id}/approve`);
    toast.success(`Approved! +${t.points} points`);
    if (data.new_badges?.length) {
      data.new_badges.forEach((b) => toast.success(`New badge unlocked: ${b.name} 🏆`));
    }
  });
  const reject = (t) => act(async () => { await api.post(`/tasks/${t.id}/reject`); toast.info("Sent back to your kid"); });
  const miss = (t) => act(async () => { await api.post(`/tasks/${t.id}/miss`); toast(`Marked missed${t.penalty_points ? ` · -${t.penalty_points} pts` : ""}`); });
  const del = (t) => act(async () => { await api.delete(`/tasks/${t.id}`); toast.success("Task deleted"); });

  if (kids.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-10 text-center border border-slate-200">
        <Users className="w-10 h-10 text-slate-300 mx-auto mb-3" strokeWidth={2.5} />
        <div className="font-parent font-bold text-lg text-slate-900">Add a child first</div>
        <div className="text-sm text-slate-500 mb-4">Tasks need to be assigned to a child.</div>
        <button onClick={onAddChild} className={btnPrimary} data-testid={TEST_IDS.parent.addChildBtn}>
          <Plus className="w-4 h-4" strokeWidth={2.5} /> Add child
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button onClick={onAddTask} data-testid={TEST_IDS.parent.addTaskBtn} className={btnPrimary}>
          <Plus className="w-4 h-4" strokeWidth={2.5} /> New task
        </button>
      </div>

      {grouped.awaiting.length > 0 && (
        <Section title="⏳ Awaiting approval" count={grouped.awaiting.length}>
          {grouped.awaiting.map((t) => (
            <TaskRow key={t.id} task={t} childName={kids.find((c) => c.id === t.child_id)?.name}>
              <button onClick={() => approve(t)} data-testid={`${TEST_IDS.parent.approveTaskBtn}-${t.id}`} className="press-btn inline-flex items-center gap-1 bg-[#34D399] hover:bg-[#22c583] text-white font-semibold px-3 py-1.5 rounded-lg text-sm">
                <CheckCircle2 className="w-4 h-4" strokeWidth={2.5} /> Approve
              </button>
              <button onClick={() => reject(t)} data-testid={`${TEST_IDS.parent.rejectTaskBtn}-${t.id}`} className="press-btn inline-flex items-center gap-1 bg-white border border-slate-200 text-slate-600 font-semibold px-3 py-1.5 rounded-lg text-sm">
                <XCircle className="w-4 h-4" strokeWidth={2.5} /> Reject
              </button>
            </TaskRow>
          ))}
        </Section>
      )}

      <Section title="📋 Pending" count={grouped.pending.length}>
        {grouped.pending.length === 0 ? (
          <div className="text-sm text-slate-400 py-3">No pending tasks.</div>
        ) : grouped.pending.map((t) => (
          <TaskRow key={t.id} task={t} childName={kids.find((c) => c.id === t.child_id)?.name}>
            <button onClick={() => miss(t)} data-testid={`${TEST_IDS.parent.missTaskBtn}-${t.id}`} className="press-btn inline-flex items-center gap-1 bg-white border border-red-200 text-red-600 font-semibold px-3 py-1.5 rounded-lg text-sm">
              <AlertTriangle className="w-4 h-4" strokeWidth={2.5} /> Missed
            </button>
            <button onClick={() => onApplyConsequence(t)} className="press-btn inline-flex items-center gap-1 bg-white border border-slate-200 text-slate-700 font-semibold px-3 py-1.5 rounded-lg text-sm">
              <ShieldAlert className="w-4 h-4" strokeWidth={2.5} /> Consequence
            </button>
            <button onClick={() => del(t)} data-testid={`${TEST_IDS.parent.deleteTaskBtn}-${t.id}`} className="press-btn p-1.5 rounded-lg hover:bg-red-50 text-red-500">
              <Trash2 className="w-4 h-4" strokeWidth={2.5} />
            </button>
          </TaskRow>
        ))}
      </Section>

      {grouped.done.length > 0 && (
        <Section title="✅ Completed" count={grouped.done.length}>
          {grouped.done.slice(0, 10).map((t) => (
            <TaskRow key={t.id} task={t} childName={children.find((c) => c.id === t.child_id)?.name} dim>
              <span className="text-sm text-slate-400">+{t.points} pts</span>
            </TaskRow>
          ))}
        </Section>
      )}

      {grouped.missed.length > 0 && (
        <Section title="❌ Missed" count={grouped.missed.length}>
          {grouped.missed.slice(0, 10).map((t) => (
            <TaskRow key={t.id} task={t} childName={children.find((c) => c.id === t.child_id)?.name} dim>
              <span className="text-sm text-red-500">−{t.penalty_points || 0} pts</span>
            </TaskRow>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, count, children }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <h4 className="font-parent font-bold text-slate-900">{title}</h4>
        {typeof count === "number" && <span className="text-sm text-slate-400">{count}</span>}
      </div>
      <div className="divide-y divide-slate-100">{children}</div>
    </div>
  );
}

function TaskRow({ task, childName, children, dim = false }) {
  return (
    <div className={`p-4 flex flex-wrap items-center gap-3 ${dim ? "opacity-60" : ""}`} data-testid={`${TEST_IDS.parent.taskItem}-${task.id}`}>
      {task.order != null && (
        <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 font-bold text-sm flex items-center justify-center shrink-0" title="Urutan misi">
          {task.order}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="font-parent font-semibold text-slate-900 truncate">{task.title}</div>
        <div className="text-xs text-slate-500 flex gap-2 flex-wrap">
          <span>{childName}</span>
          <span>·</span>
          <span>+{task.points} pts</span>
          {task.penalty_points > 0 && <><span>·</span><span>penalty −{task.penalty_points}</span></>}
          {task.due_date && <><span>·</span><span>due {new Date(task.due_date).toLocaleDateString()}</span></>}
          {task.recurrence !== "none" && <><span>·</span><span>{task.recurrence}</span></>}
          {task.status === "skipped" && <><span>·</span><span className="text-slate-400">dilewati</span></>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
function RewardsView({ rewards, redemptions, kids, selectedChildId, onAdd, onRefresh }) {
  const del = async (r) => {
    try { await api.delete(`/rewards/${r.id}`); toast.success("Reward deleted"); onRefresh(); }
    catch (e) { toast.error(formatApiError(e)); }
  };
  const fulfill = async (r) => {
    try { await api.post(`/redemptions/${r.id}/fulfill`); toast.success("Marked delivered"); onRefresh(); }
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

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h3 className="font-parent font-bold text-lg text-slate-900 mb-4">Reward store</h3>
        {rewards.length === 0 ? (
          <div className="text-sm text-slate-400 text-center py-8">No rewards yet. Create one to motivate your kids!</div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {rewards.map((r) => (
              <div key={r.id} data-testid={`${TEST_IDS.parent.rewardItem}-${r.id}`} className="border border-slate-200 rounded-xl p-4">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-[#FF9D23]/15 flex items-center justify-center flex-shrink-0">
                    <Gift className="w-5 h-5 text-[#FF9D23]" strokeWidth={2.5} />
                  </div>
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
                  <button onClick={() => del(r)} data-testid={`${TEST_IDS.parent.deleteRewardBtn}-${r.id}`} className={btnDanger}>
                    <Trash2 className="w-4 h-4" strokeWidth={2.5} />
                  </button>
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
                    <button onClick={() => fulfill(r)} data-testid={`${TEST_IDS.parent.fulfillRedemptionBtn}-${r.id}`} className="press-btn inline-flex items-center gap-1 bg-[#34D399] hover:bg-[#22c583] text-white font-semibold px-3 py-1.5 rounded-lg text-sm">
                      <CheckCircle2 className="w-4 h-4" strokeWidth={2.5} /> Mark delivered
                    </button>
                  ) : (
                    <span className="text-xs text-[#34D399] font-semibold">Delivered</span>
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

// ─────────────────────────────────────────────────────────
function ConsequencesView({ consequences, kids, onAdd, onRefresh, onApply }) {
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
                    disabled={children.length === 0}
                    data-testid={`${TEST_IDS.parent.applyConsequenceBtn}-${c.id}`}
                    className="press-btn inline-flex items-center gap-1 bg-[#FF5C5C] disabled:bg-slate-200 text-white font-semibold px-3 py-1.5 rounded-lg text-sm"
                  >
                    Apply
                  </button>
                  <button onClick={() => del(c)} className={btnDanger}>
                    <Trash2 className="w-4 h-4" strokeWidth={2.5} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
function ActivityView({ activity, kids }) {
  const label = {
    task_created: "created task",
    task_completed: "completed task",
    task_approved: "approved task",
    task_rejected: "rejected task",
    task_missed: "marked task missed",
    reward_redeemed: "redeemed reward",
    consequence_applied: "applied consequence",
    child_created: "added child",
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <h3 className="font-parent font-bold text-lg text-slate-900 mb-4">Recent activity</h3>
      {activity.length === 0 ? (
        <div className="text-sm text-slate-400 text-center py-8">Nothing yet.</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {activity.map((a) => {
            const child = kids.find((c) => c.id === a.child_id);
            const time = new Date(a.created_at).toLocaleString();
            const details = a.details || {};
            const detailText = details.title || details.reward || details.name || "";
            return (
              <div key={a.id} className="py-3 flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#6366F1]/10 flex items-center justify-center flex-shrink-0">
                  <Activity className="w-4 h-4 text-[#6366F1]" strokeWidth={2.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-800">
                    <span className="font-semibold">{child?.name || "System"}</span>{" "}
                    {label[a.action] || a.action}
                    {detailText && <span className="text-slate-600">: {detailText}</span>}
                  </div>
                  <div className="text-xs text-slate-400">{time}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
function SettingsView({ kids, onAdd, onRefresh }) {
  const { user } = useAuth();

  const delChild = async (c) => {
    if (!window.confirm(`Delete ${c.name}? This removes all their tasks and history.`)) return;
    try { await api.delete(`/children/${c.id}`); toast.success("Child removed"); onRefresh(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h3 className="font-parent font-bold text-lg text-slate-900 mb-1">Account</h3>
        <div className="text-sm text-slate-500">
          Signed in as <span className="font-semibold text-slate-700">{user?.name}</span> ({user?.role})
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-parent font-bold text-lg text-slate-900">Children</h3>
          <button onClick={onAdd} className={btnPrimary} data-testid={TEST_IDS.parent.addChildBtn}>
            <Plus className="w-4 h-4" strokeWidth={2.5} /> Add child
          </button>
        </div>
        {kids.length === 0 ? (
          <div className="text-sm text-slate-400 text-center py-6">No children yet.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {kids.map((c) => (
              <div key={c.id} className="py-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: c.avatar_color }}>{c.avatar_emoji}</div>
                <div className="flex-1">
                  <div className="font-semibold text-slate-900">{c.name}</div>
                  <div className="text-xs text-slate-500">
                    {c.age ? `Age ${c.age} · ` : ""}{c.points} pts · {c.lifetime_points || 0} lifetime
                  </div>
                </div>
                <button onClick={() => delChild(c)} className={btnDanger}>
                  <Trash2 className="w-4 h-4" strokeWidth={2.5} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <ProfileEditor />
      </div>

      {/* Stage 2 & 3: New Features */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <ConfigMenu />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <MemberPasscodeManager />
      </div>

      {/* Stage 4: Achievements & Push Notifications */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <Achievements />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <PushNotificationManager />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
function ChildFormModal({ open, onClose, onSaved }) {
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [color, setColor] = useState(AVATAR_COLORS[0]);
  const [emoji, setEmoji] = useState(AVATAR_EMOJIS[0]);
  const [saving, setSaving] = useState(false);

  const reset = () => { setName(""); setAge(""); setColor(AVATAR_COLORS[0]); setEmoji(AVATAR_EMOJIS[0]); };

  const submit = async () => {
    if (!name.trim()) return toast.error("Name is required");
    setSaving(true);
    try {
      await api.post("/children", {
        name: name.trim(),
        age: age ? parseInt(age) : null,
        avatar_color: color,
        avatar_emoji: emoji,
      });
      toast.success(`${name} added!`);
      reset();
      onSaved();
      onClose();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add a child">
      <div className="space-y-4">
        <div>
          <label className={labelClass}>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Maya" data-testid="child-name-input" />
        </div>
        <div>
          <label className={labelClass}>Age (optional)</label>
          <input type="number" min="1" max="25" value={age} onChange={(e) => setAge(e.target.value)} className={inputClass} data-testid="child-age-input" />
        </div>
        <div>
          <label className={labelClass}>Avatar color</label>
          <div className="flex gap-2 flex-wrap">
            {AVATAR_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-10 h-10 rounded-full border-2 transition-transform ${color === c ? "border-slate-900 scale-110" : "border-transparent"}`}
                style={{ background: c }}
                data-testid={`avatar-color-${c}`}
              />
            ))}
          </div>
        </div>
        <div>
          <label className={labelClass}>Avatar</label>
          <div className="flex gap-2 flex-wrap">
            {AVATAR_EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => setEmoji(e)}
                className={`w-10 h-10 rounded-xl border-2 text-xl transition-colors ${emoji === e ? "border-[#6366F1] bg-[#EEF2FF]" : "border-slate-200"}`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={submit} disabled={saving} className={btnPrimary} data-testid="child-submit-btn">
            {saving ? "Saving…" : "Add child"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function TaskFormModal({ open, onClose, kids, defaultChildId, onSaved }) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [points, setPoints] = useState(10);
  const [penalty, setPenalty] = useState(0);
  const [dueDate, setDueDate] = useState("");
  const [recurrence, setRecurrence] = useState("none");
  const [order, setOrder] = useState("");
  const [childId, setChildId] = useState(defaultChildId || (kids[0] && kids[0].id) || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setChildId(defaultChildId || (kids[0] && kids[0].id) || "");
      setTitle(""); setDesc(""); setPoints(10); setPenalty(0); setDueDate(""); setRecurrence("none"); setOrder("");
    }
  }, [open, defaultChildId, kids]);

  const submit = async () => {
    if (!title.trim()) return toast.error("Title required");
    if (!childId) return toast.error("Pick a child");
    setSaving(true);
    try {
      await api.post("/tasks", {
        child_id: childId,
        title: title.trim(),
        description: desc,
        points: Number(points) || 0,
        penalty_points: Number(penalty) || 0,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
        recurrence,
        order: order ? Number(order) : null,
      });
      toast.success("Task created");
      onSaved();
      onClose();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="New task">
      <div className="space-y-4">
        <div>
          <label className={labelClass}>Task</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} placeholder="Make the bed" data-testid="task-title-input" />
        </div>
        <div>
          <label className={labelClass}>Description (optional)</label>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} className={inputClass} rows={2} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Assign to</label>
            <select value={childId} onChange={(e) => setChildId(e.target.value)} className={inputClass} data-testid="task-child-select">
              {kids.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Repeat</label>
            <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} className={inputClass}>
              <option value="none">Once</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelClass}>Points</label>
            <input type="number" min="0" value={points} onChange={(e) => setPoints(e.target.value)} className={inputClass} data-testid="task-points-input" />
          </div>
          <div>
            <label className={labelClass}>Penalty</label>
            <input type="number" min="0" value={penalty} onChange={(e) => setPenalty(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Due date</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
          </div>
        </div>
        <div>
          <label className={labelClass}>Urutan misi (opsional)</label>
          <input
            type="number" min="1" value={order}
            onChange={(e) => setOrder(e.target.value)}
            className={inputClass}
            placeholder="Kosongkan = otomatis di akhir urutan"
          />
          <p className="text-xs text-slate-400 mt-1">
            Anak harus menyelesaikan misi sesuai urutan (konsep treasure hunt). Misi berikutnya terkunci sampai yang sebelumnya selesai/dilewati.
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={submit} disabled={saving} className={btnPrimary} data-testid="task-submit-btn">
            {saving ? "Saving…" : "Create task"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RewardFormModal({ open, onClose, onSaved }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [cost, setCost] = useState(50);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setName(""); setDesc(""); setCost(50); } }, [open]);

  const submit = async () => {
    if (!name.trim()) return toast.error("Name required");
    setSaving(true);
    try {
      await api.post("/rewards", { name: name.trim(), description: desc, cost_points: Number(cost) || 1 });
      toast.success("Reward added");
      onSaved(); onClose();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="New reward">
      <div className="space-y-4">
        <div>
          <label className={labelClass}>Reward name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="30 min screen time" data-testid="reward-name-input" />
        </div>
        <div>
          <label className={labelClass}>Description (optional)</label>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} className={inputClass} rows={2} />
        </div>
        <div>
          <label className={labelClass}>Cost (points)</label>
          <input type="number" min="1" value={cost} onChange={(e) => setCost(e.target.value)} className={inputClass} data-testid="reward-cost-input" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={submit} disabled={saving} className={btnPrimary} data-testid="reward-submit-btn">
            {saving ? "Saving…" : "Add reward"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ConsequenceFormModal({ open, onClose, onSaved }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [deduct, setDeduct] = useState(10);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setName(""); setDesc(""); setDeduct(10); } }, [open]);

  const submit = async () => {
    if (!name.trim()) return toast.error("Name required");
    setSaving(true);
    try {
      await api.post("/consequences", { name: name.trim(), description: desc, points_deducted: Number(deduct) || 0 });
      toast.success("Consequence added");
      onSaved(); onClose();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="New consequence">
      <div className="space-y-4">
        <div>
          <label className={labelClass}>Consequence</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Lose screen time" data-testid="cons-name-input" />
        </div>
        <div>
          <label className={labelClass}>Description</label>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} className={inputClass} rows={2} placeholder="No TV for the evening" />
        </div>
        <div>
          <label className={labelClass}>Points to deduct</label>
          <input type="number" min="0" value={deduct} onChange={(e) => setDeduct(e.target.value)} className={inputClass} data-testid="cons-deduct-input" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={submit} disabled={saving} className={btnPrimary} data-testid="cons-submit-btn">
            {saving ? "Saving…" : "Add"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ApplyConsequenceModal({ open, onClose, consequences, kids, preselect, selectedChildId, onSaved }) {
  const [consId, setConsId] = useState("");
  const [childId, setChildId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setConsId(preselect?.consequence?.id || "");
      setChildId(preselect?.task?.child_id || selectedChildId || (kids[0] && kids[0].id) || "");
      setNotes("");
    }
  }, [open, preselect, kids, selectedChildId]);

  const submit = async () => {
    if (!consId || !childId) return toast.error("Pick child and consequence");
    setSaving(true);
    try {
      await api.post("/consequences/apply", { consequence_id: consId, child_id: childId, notes, task_id: preselect?.task?.id || null });
      toast.success("Consequence applied");
      onSaved(); onClose();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Apply consequence">
      <div className="space-y-4">
        <div>
          <label className={labelClass}>Child</label>
          <select value={childId} onChange={(e) => setChildId(e.target.value)} className={inputClass}>
            <option value="">— Select —</option>
            {kids.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>Consequence</label>
          <select value={consId} onChange={(e) => setConsId(e.target.value)} className={inputClass}>
            <option value="">— Select —</option>
            {consequences.map((c) => <option key={c.id} value={c.id}>{c.name} {c.points_deducted ? `(−${c.points_deducted})` : ""}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>Notes (optional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} rows={2} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={submit} disabled={saving} className={btnPrimary} data-testid="apply-cons-submit-btn">
            {saving ? "Saving…" : "Apply"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
