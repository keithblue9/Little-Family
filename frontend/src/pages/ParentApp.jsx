import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Home, ListChecks, Gift, ShieldAlert, Activity, Settings, LogOut,
  Plus, Trash2, CheckCircle2, XCircle, AlertTriangle, Star, Users,
  Rocket, Menu, X, PartyPopper, Clock, ChevronLeft, ChevronRight, Undo2,
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
import FamilyDayMonitor from "@/components/FamilyDayMonitor";
import WeeklyReport from "@/components/WeeklyReport";
import LabelEditor from "@/components/LabelEditor";
import ViewLinksManager from "@/components/ViewLinksManager";
import FamilyChallenges from "@/components/FamilyChallenges";
import { useLabels } from "@/lib/labels";
import { TEST_IDS } from "@/constants/testIds/app";
import { ALL_MBTI, PERSONALITY_PROFILES, TASK_STYLES } from "@/lib/personality";
import { QUEST_THEME_LIST } from "@/lib/questThemes";
import { todayKey } from "@/lib/dates";
import { ROUTINE_TEMPLATES } from "@/lib/routineTemplates";

const AVATAR_COLORS = ["#FF9D23", "#4DB8FF", "#34D399", "#FF5C5C", "#A78BFA", "#F472B6"];
const AVATAR_EMOJIS = ["🦁", "🐯", "🐻", "🦊", "🐼", "🐨", "🐰", "🐸", "🦄", "🐢", "🦖", "🐝"];

const NAV = [
  { key: "overview", label: "Overview", icon: Home },
  { key: "monitor", label: "Monitor Harian", icon: Clock, testId: "tab-monitor" },
  { key: "tasks", label: "Tugas", icon: ListChecks, testId: TEST_IDS.parent.tabTasks },
  { key: "rewards", label: "Hadiah", icon: Gift, testId: TEST_IDS.parent.tabRewards },
  { key: "money", label: "Uang & Poin", icon: Gift, testId: "tab-money" },
  { key: "consequences", label: "Konsekuensi", icon: ShieldAlert, testId: TEST_IDS.parent.tabConsequences },
  { key: "analytics", label: "Analitik", icon: Activity, testId: "tab-analytics" },
  { key: "settings", label: "Pengaturan", icon: Settings, testId: TEST_IDS.parent.tabSettings },
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
        className="bg-white rounded-3xl w-full max-w-lg border border-slate-200 shadow-xl max-h-[90vh] flex flex-col"
      >
        <div className="flex justify-between items-center px-6 pt-6 pb-4 shrink-0">
          <h3 className="font-parent font-bold text-xl text-slate-900">{title}</h3>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100" data-testid="modal-close-btn">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <div className="px-6 pb-6 overflow-y-auto">
          {children}
        </div>
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
  const { t } = useLabels();
  const navLabelKey = {
    overview: "nav.overview", monitor: "nav.monitor", tasks: "nav.tasks",
    rewards: "nav.rewards", money: "nav.money", consequences: "nav.consequences",
    analytics: "nav.analytics", settings: "nav.settings",
  };
  const [view, setView] = useState("overview");
  const [children, setChildren] = useState([]);
  const [selectedChildId, setSelectedChildId] = useState(undefined); // undefined = not yet initialized, null = "All"
  const [tasks, setTasks] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [consequences, setConsequences] = useState([]);
  const [redemptions, setRedemptions] = useState([]);
  const [stats, setStats] = useState(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Modals
  const [childModal, setChildModal] = useState(false);
  const [taskModal, setTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [templateModal, setTemplateModal] = useState(false);
  const [rewardModal, setRewardModal] = useState(false);
  const [consModal, setConsModal] = useState(false);
  const [applyConsModal, setApplyConsModal] = useState(null);

  const load = useCallback(async () => {
    try {
      const [c, t, r, cq, rd, s] = await Promise.all([
        api.get("/children"),
        api.get("/tasks"),
        api.get("/rewards"),
        api.get("/consequences"),
        api.get("/redemptions"),
        api.get("/stats/dashboard"),
      ]);
      setChildren(c.data);
      setTasks(t.data);
      setRewards(r.data);
      setConsequences(cq.data);
      setRedemptions(rd.data);
      setStats(s.data);
      if (selectedChildId === undefined) setSelectedChildId(null);
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
        } md:translate-x-0 fixed md:sticky top-0 left-0 h-screen ${
          sidebarCollapsed ? "md:w-20" : "w-64"
        } bg-white border-r border-slate-200 z-40 transition-all duration-300 flex flex-col`}
      >
        <div className={`p-6 flex items-center gap-2 border-b border-slate-100 ${sidebarCollapsed ? "md:justify-center md:px-0" : ""}`}>
          <div className="w-9 h-9 rounded-xl bg-[#FF9D23] flex items-center justify-center shrink-0">
            <Rocket className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <span className={`font-fun font-bold text-xl text-slate-900 ${sidebarCollapsed ? "md:hidden" : ""}`}>My Lil Famz</span>
        </div>
        <div className={`px-6 py-3 flex items-center justify-between border-b border-slate-100 ${sidebarCollapsed ? "md:hidden" : ""}`}>
          <span className="text-sm text-slate-500">
            Hi, <span className="font-semibold text-slate-700">{user?.name}</span>
          </span>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV.map((n) => {
            const lblKey = navLabelKey[n.key];
            const lbl = lblKey ? t(lblKey) : n.label;
            if (lbl === "") return null; // hidden by parent
            return (
              <button
                key={n.key}
                onClick={() => { setView(n.key); setMobileNavOpen(false); }}
                data-testid={n.testId}
                title={lbl}
                className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl font-parent font-semibold text-sm transition-colors ${sidebarCollapsed ? "md:justify-center" : ""} ${
                  view === n.key
                    ? "bg-[#EEF2FF] text-[#4338CA]"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <n.icon className="w-4 h-4 shrink-0" strokeWidth={2.5} />
                <span className={sidebarCollapsed ? "md:hidden" : ""}>{lbl}</span>
              </button>
            );
          })}
        </nav>
        <div className="p-3 border-t border-slate-100 space-y-2">
          {/* Desktop collapse toggle */}
          <button
            onClick={() => setSidebarCollapsed((v) => !v)}
            className={`hidden md:flex w-full items-center gap-2 justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-50 px-3 py-2 rounded-xl text-sm transition-colors`}
            title={sidebarCollapsed ? "Perlebar sidebar" : "Perkecil sidebar"}
          >
            {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <><ChevronLeft className="w-4 h-4" /> <span>Sembunyikan</span></>}
          </button>
          <button
            onClick={() => nav("/kid")}
            data-testid={TEST_IDS.parent.switchToKidBtn}
            title="Kid mode"
            className={`w-full flex items-center gap-2 justify-center bg-[#FFF4D1] hover:bg-[#FFE4A0] text-[#B4770F] font-semibold px-3 py-2.5 rounded-xl transition-colors ${sidebarCollapsed ? "md:px-0" : ""}`}
          >
            <PartyPopper className="w-4 h-4 shrink-0" strokeWidth={2.5} />
            <span className={sidebarCollapsed ? "md:hidden" : ""}>Kid mode</span>
          </button>
          <button
            onClick={doLogout}
            data-testid={TEST_IDS.parent.logoutBtn}
            title="Sign out"
            className={`w-full flex items-center gap-2 justify-center text-slate-500 hover:text-red-600 px-3 py-2 text-sm transition-colors ${sidebarCollapsed ? "md:px-0" : ""}`}
          >
            <LogOut className="w-4 h-4 shrink-0" strokeWidth={2.5} /> <span className={sidebarCollapsed ? "md:hidden" : ""}>Sign out</span>
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
        </div>

        <div className="p-4 md:p-8 max-w-6xl">
          {/* Child filter tabs */}
          {children.length > 0 && view !== "settings" && view !== "monitor" && (
            <div className="flex items-center gap-2 mb-5 flex-wrap" data-testid="parent-child-tabs">
              <button
                onClick={() => setSelectedChildId(null)}
                className={`press-btn px-4 py-2 rounded-xl font-parent font-semibold text-sm transition-colors ${
                  selectedChildId === null || selectedChildId === undefined
                    ? "bg-[#6366F1] text-white chunky-shadow"
                    : "bg-white border-2 border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                👨‍👩‍👧‍👦 Semua
              </button>
              {children.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedChildId(c.id)}
                  className={`press-btn px-4 py-2 rounded-xl font-parent font-semibold text-sm transition-colors flex items-center gap-2 ${
                    selectedChildId === c.id
                      ? "bg-[#6366F1] text-white chunky-shadow"
                      : "bg-white border-2 border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <span className="w-6 h-6 rounded-lg flex items-center justify-center text-sm" style={{ background: selectedChildId === c.id ? "rgba(255,255,255,0.25)" : c.avatar_color }}>
                    {c.avatar_emoji}
                  </span>
                  {c.name}
                </button>
              ))}
            </div>
          )}

          {view === "overview" && (
            <Overview stats={stats} kids={children} tasks={tasks} pendingRedemptions={pendingRedemptions} onAddChild={() => setChildModal(true)} onNavigate={setView} />
          )}
          {view === "monitor" && <FamilyDayMonitor />}
          {view === "tasks" && (
            <TasksView
              kids={children}
              tasks={filteredTasks}
              selectedChildId={selectedChildId}
              onAddTask={() => { setEditingTask(null); setTaskModal(true); }}
              onOpenTemplates={() => setTemplateModal(true)}
              onEditTask={(t) => { setEditingTask(t); setTaskModal(true); }}
              onDuplicate={(t) => {
                // Pre-fill form with task values but as a NEW task (not edit)
                setEditingTask({ ...t, id: null, _isDuplicate: true });
                setTaskModal(true);
              }}
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
        onClose={() => { setTaskModal(false); setEditingTask(null); }}
        kids={children}
        defaultChildId={selectedChildId}
        onSaved={load}
        editTask={editingTask}
      />
      <TemplateModal open={templateModal} onClose={() => setTemplateModal(false)} kids={children} onSaved={load} />
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
function StatCard({ label, value, sub, color = "#6366F1", icon: Icon, onClick }) {
  const clickable = !!onClick;
  return (
    <button
      onClick={onClick}
      disabled={!clickable}
      className={`text-left bg-white rounded-2xl p-5 border border-slate-200 transition-all w-full ${
        clickable ? "hover:border-slate-300 hover:shadow-md hover:-translate-y-0.5 cursor-pointer active:scale-[0.98]" : "cursor-default"
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${color}22` }}>
          <Icon className="w-5 h-5" style={{ color }} strokeWidth={2.5} />
        </div>
        {clickable && <span className="text-xs text-slate-300">›</span>}
      </div>
      <div className="font-parent font-bold text-3xl text-slate-900">{value}</div>
      <div className="text-sm text-slate-500">{label}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </button>
  );
}

function Overview({ stats, kids, tasks, pendingRedemptions, onAddChild, onNavigate }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Anak" value={stats?.children_count ?? "—"} icon={Users} color="#6366F1" onClick={() => onNavigate("settings")} />
        <StatCard label="Menunggu cek" value={stats?.pending_approval ?? "—"} sub="Tugas menunggumu" icon={Clock} color="#FF9D23" onClick={() => onNavigate("tasks")} />
        <StatCard label="Disetujui hari ini" value={stats?.approved_today ?? "—"} icon={CheckCircle2} color="#34D399" onClick={() => onNavigate("monitor")} />
        <StatCard label="Total poin" value={stats?.total_points ?? "—"} sub="Semua anak" icon={Star} color="#4DB8FF" onClick={() => onNavigate("money")} />
      </div>

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

// ─────────────────────────────────────────────────────────
function TasksView({ kids, tasks, selectedChildId, onAddTask, onOpenTemplates, onEditTask, onDuplicate, onRefresh, onApplyConsequence, onAddChild }) {
  // When viewing "Semua" (selectedChildId === null), collapse broadcast siblings
  // (same broadcast_id) into a single representative row that lists all the kids
  // it was assigned to — e.g. "Adskhan & Syila". Editing/duplicating still targets
  // the representative task; deleting removes the whole group. When a specific
  // child is selected, tasks show individually so per-child edits are possible.
  const kidName = (id) => kids.find((k) => k.id === id)?.name || "?";

  const displayTasks = useMemo(() => {
    if (selectedChildId) return tasks; // specific child → individual tasks
    const groups = new Map();
    const singles = [];
    for (const t of tasks) {
      if (t.broadcast_id) {
        const key = `${t.broadcast_id}::${t.date_key}::${t.title}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(t);
      } else {
        singles.push(t);
      }
    }
    const collapsed = [];
    for (const [, siblings] of groups) {
      // representative = first sibling, annotated with the group's kid names + ids
      const rep = { ...siblings[0], _groupKidIds: siblings.map((s) => s.child_id), _groupTaskIds: siblings.map((s) => s.id) };
      collapsed.push(rep);
    }
    return [...singles, ...collapsed];
  }, [tasks, selectedChildId, kids]); // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = useMemo(() => {
    const byOrder = (a, b) => (a.order || 0) - (b.order || 0);
    const pending = displayTasks.filter((t) => t.status === "pending" || t.status === "rejected").sort(byOrder);
    const awaiting = displayTasks.filter((t) => t.status === "completed").sort(byOrder);
    const done = displayTasks.filter((t) => t.status === "approved" || t.status === "skipped").sort(byOrder);
    const missed = displayTasks.filter((t) => t.status === "missed");
    return { pending, awaiting, done, missed };
  }, [displayTasks]);

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
    toast.success(`Disetujui! +${t.points} poin`);
    if (data.new_badges?.length) {
      data.new_badges.forEach((b) => toast.success(`Badge baru terbuka: ${b.name} 🏆`));
    }
  });
  const reject = (t) => act(async () => { await api.post(`/tasks/${t.id}/reject`); toast.info("Dikembalikan ke anak"); });
  const miss = (t) => act(async () => { await api.post(`/tasks/${t.id}/miss`); toast(`Ditandai terlewat${t.penalty_points ? ` · -${t.penalty_points} poin` : ""}`); });
  const undoApproval = (t) => {
    if (!window.confirm(`Batalkan persetujuan "${t.title}"? Poin akan dikembalikan.`)) return;
    act(async () => {
      await api.post(`/tasks/${t.id}/undo-approval`);
      toast.success("Persetujuan dibatalkan, poin dikembalikan");
    });
  };
  const del = (t) => {
    const isGroup = t._groupTaskIds && t._groupTaskIds.length > 1;
    const msg = isGroup
      ? `Hapus tugas "${t.title}" untuk ${t._groupKidIds.map(kidName).join(" & ")}?`
      : `Hapus tugas "${t.title}"?`;
    if (!window.confirm(msg)) return;
    act(async () => {
      if (isGroup) {
        await Promise.all(t._groupTaskIds.map((id) => api.delete(`/tasks/${id}`)));
      } else {
        await api.delete(`/tasks/${t.id}`);
      }
      toast.success("Tugas dihapus");
    });
  };

  // Display name for a task row: group kids ("Adskhan & Syila") or single kid.
  const rowName = (t) =>
    t._groupKidIds && t._groupKidIds.length > 1
      ? t._groupKidIds.map(kidName).join(" & ")
      : kidName(t.child_id);

  const editBtn = (t) => (
    <div className="flex gap-1 flex-wrap">
      <button onClick={() => onEditTask(t)} className="press-btn inline-flex items-center gap-1 bg-white border border-slate-200 text-slate-700 font-semibold px-3 py-1.5 rounded-lg text-sm" title="Edit tugas">
        <Settings className="w-4 h-4" strokeWidth={2.5} /> Edit
      </button>
      <button onClick={() => onDuplicate(t)} className="press-btn inline-flex items-center gap-1 bg-white border border-indigo-200 text-indigo-600 font-semibold px-3 py-1.5 rounded-lg text-sm" title="Duplikat tugas ke hari/anak lain">
        📋 Duplikat
      </button>
    </div>
  );

  if (kids.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-10 text-center border border-slate-200">
        <Users className="w-10 h-10 text-slate-300 mx-auto mb-3" strokeWidth={2.5} />
        <div className="font-parent font-bold text-lg text-slate-900">Tambah anak dulu</div>
        <div className="text-sm text-slate-500 mb-4">Tugas harus diberikan ke seorang anak.</div>
        <button onClick={onAddChild} className={btnPrimary} data-testid={TEST_IDS.parent.addChildBtn}>
          <Plus className="w-4 h-4" strokeWidth={2.5} /> Tambah anak
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end gap-2 flex-wrap">
        <button onClick={onOpenTemplates} className="press-btn inline-flex items-center gap-1.5 bg-white border-2 border-indigo-200 text-indigo-600 hover:bg-indigo-50 font-semibold px-4 py-2 rounded-xl text-sm">
          📋 Dari Template
        </button>
        <button onClick={onAddTask} data-testid={TEST_IDS.parent.addTaskBtn} className={btnPrimary}>
          <Plus className="w-4 h-4" strokeWidth={2.5} /> Tugas baru
        </button>
      </div>

      {grouped.awaiting.length > 0 && (
        <Section title="⏳ Menunggu persetujuan" count={grouped.awaiting.length}>
          {grouped.awaiting.map((t) => (
            <TaskRow key={t.id} task={t} childName={rowName(t)}>
              <button onClick={() => approve(t)} data-testid={`${TEST_IDS.parent.approveTaskBtn}-${t.id}`} className="press-btn inline-flex items-center gap-1 bg-[#34D399] hover:bg-[#22c583] text-white font-semibold px-3 py-1.5 rounded-lg text-sm">
                <CheckCircle2 className="w-4 h-4" strokeWidth={2.5} /> Setujui
              </button>
              <button onClick={() => reject(t)} data-testid={`${TEST_IDS.parent.rejectTaskBtn}-${t.id}`} className="press-btn inline-flex items-center gap-1 bg-white border border-slate-200 text-slate-600 font-semibold px-3 py-1.5 rounded-lg text-sm">
                <XCircle className="w-4 h-4" strokeWidth={2.5} /> Tolak
              </button>
            </TaskRow>
          ))}
        </Section>
      )}

      <Section title="📋 Aktif" count={grouped.pending.length}>
        {grouped.pending.length === 0 ? (
          <div className="text-sm text-slate-400 py-3">Tidak ada tugas aktif.</div>
        ) : grouped.pending.map((t) => (
          <TaskRow key={t.id} task={t} childName={rowName(t)}>
            {editBtn(t)}
            <button onClick={() => miss(t)} data-testid={`${TEST_IDS.parent.missTaskBtn}-${t.id}`} className="press-btn inline-flex items-center gap-1 bg-white border border-red-200 text-red-600 font-semibold px-3 py-1.5 rounded-lg text-sm">
              <AlertTriangle className="w-4 h-4" strokeWidth={2.5} /> Terlewat
            </button>
            <button onClick={() => onApplyConsequence(t)} className="press-btn inline-flex items-center gap-1 bg-white border border-slate-200 text-slate-700 font-semibold px-3 py-1.5 rounded-lg text-sm">
              <ShieldAlert className="w-4 h-4" strokeWidth={2.5} /> Konsekuensi
            </button>
            <button onClick={() => del(t)} data-testid={`${TEST_IDS.parent.deleteTaskBtn}-${t.id}`} className="press-btn p-1.5 rounded-lg hover:bg-red-50 text-red-500">
              <Trash2 className="w-4 h-4" strokeWidth={2.5} />
            </button>
          </TaskRow>
        ))}
      </Section>

      {grouped.done.length > 0 && (
        <Section title="✅ Selesai" count={grouped.done.length}>
          {grouped.done.slice(0, 10).map((t) => (
            <TaskRow key={t.id} task={t} childName={rowName(t)} dim>
              <span className="text-sm text-slate-400">+{t.points} poin</span>
              {t.status === "approved" && (
                <button
                  onClick={() => undoApproval(t)}
                  title="Batalkan persetujuan (dalam 30 menit)"
                  className="press-btn inline-flex items-center gap-1 bg-white border border-amber-200 text-amber-600 font-semibold px-2.5 py-1 rounded-lg text-xs"
                >
                  <Undo2 className="w-3.5 h-3.5" /> Batalkan
                </button>
              )}
            </TaskRow>
          ))}
        </Section>
      )}

      {grouped.missed.length > 0 && (
        <Section title="❌ Terlewat" count={grouped.missed.length}>
          {grouped.missed.slice(0, 10).map((t) => (
            <TaskRow key={t.id} task={t} childName={rowName(t)} dim>
              {editBtn(t)}
              <span className="text-sm text-red-500">−{t.penalty_points || 0} poin</span>
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
        <div className="font-parent font-semibold text-slate-900 truncate flex items-center gap-2">
          {task.title}
          {task._groupKidIds && task._groupKidIds.length > 1 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600 shrink-0" title="Tugas bersama — klik tab anak untuk edit khusus">
              👥 Bersama
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500 flex gap-2 flex-wrap">
          <span>{childName}</span>
          <span>·</span>
          <span>+{task.points} pts</span>
          {task.penalty_points > 0 && <><span>·</span><span>penalty −{task.penalty_points}</span></>}
          {task.due_date && <><span>·</span><span>tgl {new Date(task.due_date).toLocaleDateString("id-ID")}</span></>}
          {task.due_time && <><span>·</span><span className="text-indigo-600 font-semibold">🕒 sblm {task.due_time}</span></>}
          {task.duration_minutes && <><span>·</span><span className="text-indigo-600 font-semibold">⏱️ {task.duration_minutes} mnt</span></>}
          {task.recurrence !== "none" && <><span>·</span><span>{task.recurrence === "daily" ? "harian" : "mingguan"}</span></>}
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
                    disabled={kids.length === 0}
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
          <div className="text-sm text-slate-400 text-center py-6">Belum ada anak.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {kids.map((c) => (
              <div key={c.id} className="py-3 flex items-center gap-3 flex-wrap">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: c.avatar_color }}>{c.avatar_emoji}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-900 flex items-center gap-2 flex-wrap">
                    {c.name}
                    {c.mbti && (
                      <span
                        className="text-xs font-bold px-2 py-0.5 rounded-full text-white"
                        style={{ background: PERSONALITY_PROFILES[c.mbti]?.color || "#94A3B8" }}
                        title={PERSONALITY_PROFILES[c.mbti]?.nickname || c.mbti}
                      >
                        {c.mbti}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">
                    {c.age ? `Umur ${c.age} · ` : ""}{c.points} poin · {c.lifetime_points || 0} total
                    {c.mbti && PERSONALITY_PROFILES[c.mbti] && ` · ${PERSONALITY_PROFILES[c.mbti].nickname}`}
                  </div>
                </div>
                <select
                  value={c.mbti || ""}
                  onChange={async (e) => {
                    try {
                      await api.patch(`/children/${c.id}`, { mbti: e.target.value || null });
                      toast.success(`Kepribadian ${c.name} diperbarui`);
                      onRefresh();
                    } catch (err) { toast.error(formatApiError(err)); }
                  }}
                  className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 focus:border-indigo-500 focus:outline-none"
                  title="Ubah tipe kepribadian"
                >
                  <option value="">MBTI —</option>
                  {ALL_MBTI.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <select
                  value={c.quest_theme || ""}
                  onChange={async (e) => {
                    try {
                      await api.patch(`/children/${c.id}`, { quest_theme: e.target.value || null });
                      toast.success(`Tema misi ${c.name} diperbarui`);
                      onRefresh();
                    } catch (err) { toast.error(formatApiError(err)); }
                  }}
                  className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 focus:border-amber-500 focus:outline-none"
                  title="Ubah tema petualangan"
                >
                  <option value="">Tema misi —</option>
                  {QUEST_THEME_LIST.map((t) => (
                    <option key={t.key} value={t.key}>{t.emoji} {t.label}</option>
                  ))}
                </select>
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
        <LabelEditor />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <ViewLinksManager />
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
  const [mbti, setMbti] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => { setName(""); setAge(""); setColor(AVATAR_COLORS[0]); setEmoji(AVATAR_EMOJIS[0]); setMbti(""); };

  const submit = async () => {
    if (!name.trim()) return toast.error("Nama wajib diisi");
    setSaving(true);
    try {
      await api.post("/children", {
        name: name.trim(),
        age: age ? parseInt(age) : null,
        avatar_color: color,
        avatar_emoji: emoji,
        mbti: mbti || null,
      });
      toast.success(`${name} ditambahkan!`);
      reset();
      onSaved();
      onClose();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Tambah anak">
      <div className="space-y-4">
        <div>
          <label className={labelClass}>Nama</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Adskhan" data-testid="child-name-input" />
        </div>
        <div>
          <label className={labelClass}>Umur (opsional)</label>
          <input type="number" min="1" max="25" value={age} onChange={(e) => setAge(e.target.value)} className={inputClass} data-testid="child-age-input" />
        </div>
        <div>
          <label className={labelClass}>Tipe Kepribadian (MBTI, opsional)</label>
          <select value={mbti} onChange={(e) => setMbti(e.target.value)} className={inputClass}>
            <option value="">— Pilih tipe —</option>
            {ALL_MBTI.map((t) => (
              <option key={t} value={t}>
                {t}{PERSONALITY_PROFILES[t] ? ` · ${PERSONALITY_PROFILES[t].nickname}` : ""}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-400 mt-1">
            Membantu aplikasi menyarankan gaya tugas & pesan motivasi yang cocok untuk anak.
          </p>
        </div>
        <div>
          <label className={labelClass}>Warna avatar</label>
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
          <button onClick={onClose} className={btnGhost}>Batal</button>
          <button onClick={submit} disabled={saving} className={btnPrimary} data-testid="child-submit-btn">
            {saving ? "Menyimpan…" : "Tambah anak"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function TaskFormModal({ open, onClose, kids, defaultChildId, onSaved, editTask }) {
  const isDuplicate = editTask && editTask._isDuplicate;
  const isEdit = !!editTask && !isDuplicate;
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [points, setPoints] = useState(10);
  const [penalty, setPenalty] = useState(0);
  const [dateKey, setDateKey] = useState(todayKey());
  const [scheduleMode, setScheduleMode] = useState("weekdays"); // "weekdays" default | "date"
  const [weekdays, setWeekdays] = useState([new Date().getDay() === 0 ? 6 : new Date().getDay() - 1]); // default = today's weekday (Mon=0..Sun=6)
  const [dueTime, setDueTime] = useState("");
  const [duration, setDuration] = useState("");
  const [isBonus, setIsBonus] = useState(false);
  const [photoRequired, setPhotoRequired] = useState(false);
  const [isCoop, setIsCoop] = useState(false);
  const [recurrence, setRecurrence] = useState("none");
  const [order, setOrder] = useState("");
  const [taskStyle, setTaskStyle] = useState("");
  // Selected kid ids: [] means "everyone" (broadcast). Edit mode is always the task's own child.
  const [selectedKidIds, setSelectedKidIds] = useState(
    defaultChildId ? [defaultChildId] : []
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editTask && !isDuplicate) {
      setSelectedKidIds([editTask.child_id]);
      setTitle(editTask.title || "");
      setDesc(editTask.description || "");
      setPoints(editTask.points ?? 10);
      setPenalty(editTask.penalty_points ?? 0);
      setDateKey(editTask.date_key || todayKey());
      setScheduleMode("date"); // editing is always a single existing date
      setWeekdays([]);
      setDueTime(editTask.due_time || "");
      setDuration(editTask.duration_minutes ? String(editTask.duration_minutes) : "");
      setIsBonus(!!editTask.is_bonus);
      setPhotoRequired(!!editTask.photo_required);
      setIsCoop(!!editTask.is_coop);
      setRecurrence(editTask.recurrence || "none");
      setOrder(editTask.order ? String(editTask.order) : "");
      setTaskStyle(editTask.task_style || "");
    } else if (isDuplicate) {
      // Pre-fill from source task but as NEW — allow changing kid/schedule
      setSelectedKidIds(defaultChildId ? [defaultChildId] : []);
      setTitle(editTask.title || "");
      setDesc(editTask.description || "");
      setPoints(editTask.points ?? 10);
      setPenalty(editTask.penalty_points ?? 0);
      setDateKey(todayKey());
      setScheduleMode("weekdays");
      const todayWd = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
      setWeekdays([todayWd]);
      setDueTime(editTask.due_time || "");
      setDuration(editTask.duration_minutes ? String(editTask.duration_minutes) : "");
      setIsBonus(!!editTask.is_bonus);
      setPhotoRequired(!!editTask.photo_required);
      setIsCoop(false);
      setRecurrence(editTask.recurrence || "none");
      setOrder(""); // fresh order
      setTaskStyle(editTask.task_style || "");
    } else {
      setSelectedKidIds(defaultChildId ? [defaultChildId] : []);
      setTitle(""); setDesc(""); setPoints(10); setPenalty(0);
      setDateKey(todayKey());
      setScheduleMode("weekdays");
      const todayWd = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
      setWeekdays([todayWd]);
      setDueTime(""); setDuration(""); setIsBonus(false); setPhotoRequired(false); setIsCoop(false);
      setRecurrence("none"); setOrder(""); setTaskStyle("");
    }
  }, [open, defaultChildId, editTask, isDuplicate]);

  const toggleKid = (id) => {
    setSelectedKidIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const isBroadcast = selectedKidIds.length === 0;
  const isSingle = selectedKidIds.length === 1;

  const toggleWeekday = (d) => {
    setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  };

  const submit = async () => {
    if (!title.trim()) return toast.error("Judul tugas wajib diisi");
    if (dueTime && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(dueTime)) {
      return toast.error("Format jam harus HH:MM (contoh 18:00)");
    }
    if (!isEdit && scheduleMode === "weekdays" && weekdays.length === 0) {
      return toast.error("Pilih minimal satu hari");
    }
    if (!isEdit && isCoop && selectedKidIds.length < 2) {
      return toast.error("Misi bersama butuh minimal 2 anak dipilih (bukan Semua/1 anak)");
    }
    setSaving(true);
    try {
      const useWeekdays = !isEdit && scheduleMode === "weekdays";
      const body = {
        title: title.trim(),
        description: desc,
        points: Number(points) || 0,
        penalty_points: Number(penalty) || 0,
        date_key: useWeekdays ? null : (dateKey || null),
        weekdays: useWeekdays ? weekdays : null,
        due_time: dueTime || null,
        duration_minutes: duration ? Number(duration) : null,
        is_bonus: isCoop ? true : isBonus,
        photo_required: photoRequired,
        coop: !isEdit && isCoop,
        // Rutin (weekday) mode auto-repeats weekly so the task comes back each
        // week on the same day. Non-rutin uses the chosen recurrence dropdown.
        recurrence: useWeekdays ? "weekly" : recurrence,
        order: order ? Number(order) : null,
        task_style: taskStyle || null,
      };
      if (isEdit) {
        await api.patch(`/tasks/${editTask.id}`, body);
        toast.success("Tugas diperbarui");
      } else if (isCoop) {
        await api.post("/tasks", { ...body, target_children: selectedKidIds });
        toast.success(`Misi bersama dibuat untuk ${selectedKidIds.length} anak 🤝`);
      } else {
        // Broadcast: send empty target_children (or all kid ids). Backend treats empty as "all".
        if (isBroadcast) {
          await api.post("/tasks", { ...body, target_children: [] });
          toast.success(`Tugas dibuat untuk semua anak (${kids.length})`);
        } else if (isSingle) {
          await api.post("/tasks", { ...body, child_id: selectedKidIds[0] });
          toast.success("Tugas dibuat");
        } else {
          await api.post("/tasks", { ...body, target_children: selectedKidIds });
          toast.success(`Tugas dibuat untuk ${selectedKidIds.length} anak`);
        }
      }
      onSaved();
      onClose();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "Edit tugas" : isDuplicate ? "Duplikat tugas" : "Tugas baru"}>
      <div className="space-y-4">
        <div>
          <label className={labelClass}>Tugas</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} placeholder="Rapikan tempat tidur" data-testid="task-title-input" />
        </div>
        <div>
          <label className={labelClass}>Deskripsi (opsional)</label>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} className={inputClass} rows={2} />
        </div>
        {/* Kid selection */}
        <div>
          <label className={labelClass}>Untuk anak</label>
          {isEdit ? (
            <div className="text-sm text-slate-500 bg-slate-50 rounded-xl px-3 py-2 border border-slate-200">
              {kids.find((k) => k.id === selectedKidIds[0])?.name || "—"}
              <span className="text-xs text-slate-400 ml-2">(tidak bisa diubah saat edit)</span>
            </div>
          ) : (
            <div className="space-y-2">
              {!isCoop && (
                <button
                  type="button"
                  onClick={() => setSelectedKidIds([])}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition-colors ${
                    isBroadcast ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${
                    isBroadcast ? "bg-indigo-500 border-indigo-500" : "border-slate-300"
                  }`}>
                    {isBroadcast && <span className="text-white text-xs">✓</span>}
                  </div>
                  <span className="font-semibold text-slate-800">🌟 Semua anak (broadcast)</span>
                  <span className="text-xs text-slate-500 ml-auto">1 tugas untuk tiap anak</span>
                </button>
              )}
              <div className="grid grid-cols-2 gap-2">
                {kids.map((c) => {
                  const checked = selectedKidIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleKid(c.id)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition-colors ${
                        checked ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${
                        checked ? "bg-indigo-500 border-indigo-500" : "border-slate-300"
                      }`}>
                        {checked && <span className="text-white text-xs">✓</span>}
                      </div>
                      <div className="w-6 h-6 rounded-lg flex items-center justify-center text-sm" style={{ background: c.avatar_color }}>
                        {c.avatar_emoji}
                      </div>
                      <span className="font-semibold text-slate-800 text-sm truncate">{c.name}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-slate-400">
                {isCoop
                  ? selectedKidIds.length < 2
                    ? "Pilih minimal 2 anak untuk misi bersama."
                    : `Misi bersama untuk ${selectedKidIds.length} anak — poin dibagi otomatis saat disetujui.`
                  : isBroadcast
                  ? `Akan dibuat 1 tugas untuk masing-masing dari ${kids.length} anak.`
                  : selectedKidIds.length === 0
                  ? "Pilih setidaknya satu anak, atau pilih 'Semua anak'."
                  : `Akan dibuat untuk ${selectedKidIds.length} anak.`}
              </p>
            </div>
          )}
        </div>

        {/* Schedule: specific date OR weekdays */}
        <div>
          <label className={labelClass}>📅 Jadwal misi</label>
          {isEdit ? (
            <input type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} className={inputClass} />
          ) : (
            <>
              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setScheduleMode("weekdays")}
                  className={`flex-1 px-3 py-2 rounded-xl border-2 text-sm font-semibold transition-colors ${
                    scheduleMode === "weekdays" ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  🔁 Rutin (per hari)
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleMode("date")}
                  className={`flex-1 px-3 py-2 rounded-xl border-2 text-sm font-semibold transition-colors ${
                    scheduleMode === "date" ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  🗓️ Non-rutin (tanggal)
                </button>
              </div>
              {scheduleMode === "date" ? (
                <div>
                  <input type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} className={inputClass} />
                  <p className="text-xs text-slate-400 mt-1.5">
                    Untuk aktivitas tidak rutin / anomali — misal ada acara khusus di tanggal tertentu.
                  </p>
                </div>
              ) : (
                <div>
                  <div className="grid grid-cols-7 gap-1">
                    {[["Sen", 0], ["Sel", 1], ["Rab", 2], ["Kam", 3], ["Jum", 4], ["Sab", 5], ["Min", 6]].map(([label, d]) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => toggleWeekday(d)}
                        className={`py-2 rounded-xl border-2 text-xs font-bold transition-colors ${
                          weekdays.includes(d) ? "border-indigo-500 bg-indigo-500 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400 mt-1.5">
                    Misi rutin diulang tiap minggu di hari terpilih. Tiap hari bisa punya misi berbeda.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Repeat — only for non-rutin (date) mode; rutin auto-repeats weekly */}
        {(isEdit || scheduleMode === "date") && (
          <div>
            <label className={labelClass}>Ulangi</label>
            <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} className={inputClass}>
              <option value="none">Sekali</option>
              <option value="daily">Harian</option>
              <option value="weekly">Mingguan</option>
            </select>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelClass}>Poin</label>
            <input type="number" min="0" value={points} onChange={(e) => setPoints(e.target.value)} className={inputClass} data-testid="task-points-input" />
          </div>
          <div>
            <label className={labelClass}>Penalti</label>
            <input type="number" min="0" value={penalty} onChange={(e) => setPenalty(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Urutan (opsional)</label>
            <input type="number" min="1" value={order} onChange={(e) => setOrder(e.target.value)} className={inputClass} placeholder="Auto" />
          </div>
        </div>

        {/* Bonus toggle */}
        <button
          type="button"
          onClick={() => setIsBonus(!isBonus)}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-colors ${
            isBonus ? "border-amber-400 bg-amber-50" : "border-slate-200 hover:bg-slate-50"
          }`}
        >
          <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${
            isBonus ? "bg-amber-500 border-amber-500" : "border-slate-300"
          }`}>
            {isBonus && <span className="text-white text-xs">✓</span>}
          </div>
          <div className="flex-1 text-left">
            <div className="font-semibold text-slate-800 text-sm">✨ Tugas Bonus</div>
            <div className="text-xs text-slate-500">Tidak wajib, tidak menghalangi urutan misi. Poinnya jadi ekstra.</div>
          </div>
        </button>

        {/* Photo verification toggle */}
        <button
          type="button"
          onClick={() => setPhotoRequired(!photoRequired)}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-colors ${
            photoRequired ? "border-purple-400 bg-purple-50" : "border-slate-200 hover:bg-slate-50"
          }`}
        >
          <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${
            photoRequired ? "bg-purple-500 border-purple-500" : "border-slate-300"
          }`}>
            {photoRequired && <span className="text-white text-xs">✓</span>}
          </div>
          <div className="flex-1 text-left">
            <div className="font-semibold text-slate-800 text-sm">📷 Butuh Foto Bukti</div>
            <div className="text-xs text-slate-500">Anak harus lampirkan foto sebelum bisa menandai selesai.</div>
          </div>
        </button>

        {/* Co-op quest toggle — only offered when creating (not editing), since
            an existing task's coop-ness can't be changed after the fact. */}
        {!isEdit && (
          <button
            type="button"
            onClick={() => setIsCoop(!isCoop)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-colors ${
              isCoop ? "border-teal-400 bg-teal-50" : "border-slate-200 hover:bg-slate-50"
            }`}
          >
            <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${
              isCoop ? "bg-teal-500 border-teal-500" : "border-slate-300"
            }`}>
              {isCoop && <span className="text-white text-xs">✓</span>}
            </div>
            <div className="flex-1 text-left">
              <div className="font-semibold text-slate-800 text-sm">🤝 Misi Bersama (Co-op)</div>
              <div className="text-xs text-slate-500">
                Dikerjakan berdua — siapa saja dari mereka bisa menandai selesai, poin dibagi otomatis. Pilih minimal 2 anak di atas.
              </div>
            </div>
          </button>
        )}
        {isEdit && editTask?.is_coop && (
          <div className="text-xs text-teal-600 bg-teal-50 border border-teal-200 rounded-xl px-3 py-2">
            🤝 Ini misi bersama — poin akan dibagi ke semua peserta saat disetujui.
          </div>
        )}

        {/* Duration & time — both optional, either or both */}
        <div className="grid grid-cols-2 gap-3 bg-slate-50 rounded-xl p-3 border border-slate-100">
          <div>
            <label className={labelClass}>⏱️ Durasi (menit, opsional)</label>
            <input
              type="number" min="1" max="1440" value={duration}
              onChange={(e) => setDuration(e.target.value.replace(/\D/g, ""))}
              className={inputClass}
              placeholder="mis. 15"
            />
            <p className="text-xs text-slate-400 mt-1">Berapa lama tugas dikerjakan.</p>
          </div>
          <div>
            <label className={labelClass}>🕒 Harus sebelum jam (opsional)</label>
            <input
              type="time" value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              className={inputClass}
            />
            <p className="text-xs text-slate-400 mt-1">Batas waktu dalam sehari, mis. 18:00.</p>
          </div>
        </div>

        <div>
          <label className={labelClass}>Gaya tugas (opsional)</label>
          <select value={taskStyle} onChange={(e) => setTaskStyle(e.target.value)} className={inputClass}>
            <option value="">— Otomatis sesuai kepribadian anak —</option>
            {Object.entries(TASK_STYLES).map(([key, s]) => (
              <option key={key} value={key}>{s.emoji} {s.label} — {s.desc}</option>
            ))}
          </select>
          <p className="text-xs text-slate-400 mt-1">
            Kalau dikosongkan, gaya dipilih otomatis dari tipe kepribadian anak (mis. INTJ-T → Tantangan, ENFJ-T → Membantu).
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className={btnGhost}>Batal</button>
          <button onClick={submit} disabled={saving} className={btnPrimary} data-testid="task-submit-btn">
            {saving ? "Menyimpan…" : isEdit ? "Simpan perubahan" : "Buat tugas"}
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

function TemplateModal({ open, onClose, kids, onSaved }) {
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [selectedKidIds, setSelectedKidIds] = useState([]); // [] = semua anak
  const [dateKey, setDateKey] = useState(todayKey());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedTemplate(null);
      setSelectedKidIds([]);
      setDateKey(todayKey());
    }
  }, [open]);

  const toggleKid = (id) => {
    setSelectedKidIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const isBroadcast = selectedKidIds.length === 0;

  const apply = async () => {
    if (!selectedTemplate) return toast.error("Pilih template dulu");
    setSaving(true);
    try {
      // Create each template task in order via the existing endpoint. Sequential
      // so per-child quest order stays deterministic.
      for (const t of selectedTemplate.tasks) {
        const body = {
          title: t.title,
          description: "",
          points: t.points,
          penalty_points: 0,
          date_key: dateKey,
          due_time: t.due_time || null,
          duration_minutes: t.duration_minutes || null,
          is_bonus: false,
          recurrence: "none",
          order: null,
          task_style: t.task_style || null,
        };
        if (isBroadcast) {
          await api.post("/tasks", { ...body, target_children: [] });
        } else if (selectedKidIds.length === 1) {
          await api.post("/tasks", { ...body, child_id: selectedKidIds[0] });
        } else {
          await api.post("/tasks", { ...body, target_children: selectedKidIds });
        }
      }
      const target = isBroadcast ? `semua anak (${kids.length})` : `${selectedKidIds.length} anak`;
      toast.success(`${selectedTemplate.label} dibuat untuk ${target} — ${selectedTemplate.tasks.length} misi 🎉`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Buat dari Template Rutinitas">
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ROUTINE_TEMPLATES.map((tpl) => {
            const active = selectedTemplate?.key === tpl.key;
            return (
              <button
                key={tpl.key}
                type="button"
                onClick={() => setSelectedTemplate(tpl)}
                className={`text-left rounded-2xl border-2 p-3 transition-colors ${
                  active ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <div className="font-semibold text-slate-900 text-sm">
                  {tpl.emoji} {tpl.label}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">{tpl.desc}</div>
                <div className="text-xs text-indigo-500 font-semibold mt-1">
                  {tpl.tasks.length} misi · {tpl.tasks.reduce((s, t) => s + t.points, 0)} poin total
                </div>
              </button>
            );
          })}
        </div>

        {selectedTemplate && (
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
            <div className="text-xs font-bold text-slate-500 uppercase mb-2">Isi template</div>
            <div className="space-y-1">
              {selectedTemplate.tasks.map((t, i) => (
                <div key={i} className="text-sm text-slate-700 flex items-center gap-2 flex-wrap">
                  <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                  <span className="flex-1 min-w-0 truncate">{t.title}</span>
                  <span className="text-xs text-slate-400 shrink-0">
                    +{t.points}{t.due_time ? ` · 🕒 ${t.due_time}` : ""}{t.duration_minutes ? ` · ⏱️ ${t.duration_minutes}m` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className={labelClass}>Untuk anak</label>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setSelectedKidIds([])}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition-colors ${
                isBroadcast ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${
                isBroadcast ? "bg-indigo-500 border-indigo-500" : "border-slate-300"
              }`}>
                {isBroadcast && <span className="text-white text-xs">✓</span>}
              </div>
              <span className="font-semibold text-slate-800 text-sm">🌟 Semua anak</span>
            </button>
            <div className="grid grid-cols-2 gap-2">
              {kids.map((c) => {
                const checked = selectedKidIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleKid(c.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition-colors ${
                      checked ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${
                      checked ? "bg-indigo-500 border-indigo-500" : "border-slate-300"
                    }`}>
                      {checked && <span className="text-white text-xs">✓</span>}
                    </div>
                    <div className="w-6 h-6 rounded-lg flex items-center justify-center text-sm" style={{ background: c.avatar_color }}>
                      {c.avatar_emoji}
                    </div>
                    <span className="font-semibold text-slate-800 text-sm truncate">{c.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div>
          <label className={labelClass}>📅 Tanggal misi</label>
          <input type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} className={inputClass} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className={btnGhost}>Batal</button>
          <button onClick={apply} disabled={saving || !selectedTemplate} className={btnPrimary}>
            {saving ? "Membuat…" : "Buat Misi"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
