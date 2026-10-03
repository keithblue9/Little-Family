import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import PageSkeleton from "@/components/PageSkeleton";
import { useNavigate } from "react-router-dom";
import { Home, ListChecks, Gift, ShieldAlert, Activity, Settings, LogOut, Rocket, Menu, PartyPopper, Clock, ChevronLeft, ChevronRight, Search } from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import { cacheGet, cacheSet } from "@/lib/localCache";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queries";
import { useLabels } from "@/lib/labels";
import { TEST_IDS } from "@/constants/testIds/app";
import { todayKey, shiftDateKey } from "@/lib/dates";
import { Overview } from "@/pages/parent/Overview";

// The Overview is the first screen and ships with this file; every other
// view and form is its own chunk, fetched on first use.
const TasksView = lazy(() => import("@/pages/parent/TasksView").then((m) => ({ default: m.TasksView })));
const RewardsView = lazy(() => import("@/pages/parent/RewardsView").then((m) => ({ default: m.RewardsView })));
const ConsequencesView = lazy(() => import("@/pages/parent/ConsequencesView").then((m) => ({ default: m.ConsequencesView })));
const SettingsView = lazy(() => import("@/pages/parent/SettingsView").then((m) => ({ default: m.SettingsView })));
const ChildFormModal = lazy(() => import("@/pages/parent/ChildFormModal").then((m) => ({ default: m.ChildFormModal })));
const TaskFormModal = lazy(() => import("@/pages/parent/TaskFormModal").then((m) => ({ default: m.TaskFormModal })));
const RewardFormModal = lazy(() => import("@/pages/parent/RewardFormModal").then((m) => ({ default: m.RewardFormModal })));
const TemplateModal = lazy(() => import("@/pages/parent/TemplateModal").then((m) => ({ default: m.TemplateModal })));
const ConsequenceFormModal = lazy(() => import("@/pages/parent/ConsequenceModals").then((m) => ({ default: m.ConsequenceFormModal })));
const ApplyConsequenceModal = lazy(() => import("@/pages/parent/ConsequenceModals").then((m) => ({ default: m.ApplyConsequenceModal })));
const MoneyApprovals = lazy(() => import("@/components/MoneyApprovals"));
const CharityRequestsReview = lazy(() => import("@/components/CharityRequestsReview"));
const AnalyticsDashboard = lazy(() => import("@/components/AnalyticsDashboard"));
const FamilyDayMonitor = lazy(() => import("@/components/FamilyDayMonitor"));
const ScheduleSuggestionsCard = lazy(() => import("@/components/ScheduleSuggestionsCard"));
const MemoriesCollage = lazy(() => import("@/components/MemoriesCollage"));
const CommandPalette = lazy(() => import("@/components/CommandPalette"));
const HonestyInsightCard = lazy(() => import("@/components/HonestyInsightCard"));
const ActivityLogCard = lazy(() => import("@/components/ActivityLogCard"));
const HoldRequestsReview = lazy(() => import("@/components/HoldRequestsReview"));

// Start downloading a tab's code the moment a finger or cursor reaches it.
const VIEW_PREFETCH = {
  tasks: () => import("@/pages/parent/TasksView"),
  rewards: () => import("@/pages/parent/RewardsView"),
  consequences: () => import("@/pages/parent/ConsequencesView"),
  settings: () => import("@/pages/parent/SettingsView"),
  monitor: () => import("@/components/FamilyDayMonitor"),
  money: () => import("@/components/MoneyApprovals"),
  analytics: () => import("@/components/AnalyticsDashboard"),
};
function prefetchView(key) {
  VIEW_PREFETCH[key]?.().catch(() => {});
}

const BOTTOM_NAV = ["overview", "tasks", "monitor", "money"];
const BOTTOM_LABELS = { overview: "Beranda", tasks: "Tugas", monitor: "Monitor", money: "Uang" };

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

export default function ParentApp() {
  const nav = useNavigate();
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const { t } = useLabels();
  const navLabelKey = {
    overview: "nav.overview", monitor: "nav.monitor", tasks: "nav.tasks",
    rewards: "nav.rewards", money: "nav.money", consequences: "nav.consequences",
    analytics: "nav.analytics", settings: "nav.settings",
  };
  const [view, setView] = useState("overview");
  const viewTitle = (() => {
    const key = navLabelKey[view];
    return (key && t(key)) || NAV.find((x) => x.key === view)?.label || view;
  })();
  const [children, setChildren] = useState([]);
  const [selectedChildId, setSelectedChildId] = useState(undefined); // undefined = not yet initialized, null = "All"
  const [tasks, setTasks] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [consequences, setConsequences] = useState([]);
  const [redemptions, setRedemptions] = useState([]);
  const [stats, setStats] = useState(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Ctrl/⌘+K opens the palette even before its code has loaded.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && !paletteOpen) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Modals
  const [childModal, setChildModal] = useState(false);
  const [taskModal, setTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [templateModal, setTemplateModal] = useState(false);
  const [rewardModal, setRewardModal] = useState(false);
  const [editingReward, setEditingReward] = useState(null);
  const [consModal, setConsModal] = useState(false);
  const [editingCons, setEditingCons] = useState(null);
  const [applyConsModal, setApplyConsModal] = useState(null);

  // The task list covers a window around today (plus anything still waiting
  // on a parent), not the family's entire history. Opening a date outside it
  // widens the window; opening a future day builds that day first.
  const [taskWindow, setTaskWindow] = useState(() => ({
    start: shiftDateKey(todayKey(), -14),
    end: shiftDateKey(todayKey(), 14),
  }));
  const applyBootstrap = useCallback((d) => {
    setChildren(d.children || []);
    setTasks(d.tasks || []);
    setRewards(d.rewards || []);
    setConsequences(d.consequences || []);
    setRedemptions(d.redemptions || []);
    setStats(d.stats || null);
  }, []);
  // Paint instantly from the last visit, then refresh from the server.
  const [hydrated] = useState(() => {
    const cached = cacheGet("parent:bootstrap", 24 * 60 * 60 * 1000);
    return cached || null;
  });
  useEffect(() => {
    if (hydrated) applyBootstrap(hydrated);
  }, [hydrated, applyBootstrap]);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/parent/bootstrap", {
        params: { start_date: taskWindow.start, end_date: taskWindow.end },
      });
      applyBootstrap(data);
      cacheSet("parent:bootstrap", data);
      queryClient.invalidateQueries({ queryKey: qk.familyMission });
      if (selectedChildId === undefined) setSelectedChildId(null);
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }, [selectedChildId, taskWindow, applyBootstrap, queryClient]);

  useEffect(() => {
    load();
  }, [load]);

  const ensureDate = useCallback(async (dk) => {
    if (!dk || dk === "all") return;
    const tomorrow = shiftDateKey(todayKey(), 1);
    let built = false;
    if (dk > tomorrow) {
      try {
        const { data } = await api.post(`/days/${dk}/prepare`);
        built = (data?.created || 0) > 0;
      } catch { /* outside the allowed range — just show what exists */ }
    }
    if (dk < taskWindow.start || dk > taskWindow.end) {
      setTaskWindow((w) => ({ start: dk < w.start ? dk : w.start, end: dk > w.end ? dk : w.end }));
    } else if (built) {
      load();
    }
  }, [taskWindow, load]);

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
                onPointerDown={() => prefetchView(n.key)}
                onMouseEnter={() => prefetchView(n.key)}
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
        <div className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-slate-200 px-4 md:px-8 py-4 flex items-center gap-4" style={{ paddingTop: "calc(1rem + env(safe-area-inset-top))" }}>
          <button className="md:hidden p-2" onClick={() => setMobileNavOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="font-parent font-bold text-xl md:text-2xl text-slate-900 truncate">{viewTitle}</div>
            <div className="text-sm text-slate-500 truncate">Hi {user?.name} · kelola keluargamu</div>
          </div>
          <button
            onClick={() => setPaletteOpen(true)}
            className="press-btn flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 text-sm shrink-0"
            title="Perintah cepat (Ctrl+K)"
            aria-label="Perintah cepat"
          >
            <Search className="w-4 h-4" />
            <span className="hidden md:inline">Cari / perintah</span>
            <kbd className="hidden md:inline text-[10px] bg-slate-100 rounded px-1.5 py-0.5">Ctrl K</kbd>
          </button>
        </div>

        <div className="p-4 md:p-8 max-w-6xl pb-28 md:pb-8">
          <Suspense fallback={<PageSkeleton compact rows={2} />}>
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
          {view === "monitor" && (
            <div className="space-y-4">
              <FamilyDayMonitor />
              <div className="bg-white rounded-2xl border border-slate-200 p-6">
                <ScheduleSuggestionsCard />
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 p-6">
                <HonestyInsightCard />
              </div>
              <MemoriesCollage title="Kenangan Keluarga" />
              <div className="bg-white rounded-2xl border border-slate-200 p-6">
                <ActivityLogCard kids={children} />
              </div>
            </div>
          )}
          {view === "tasks" && (
            <div className="space-y-4">
              <HoldRequestsReview onChanged={load} />
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
                onEnsureDate={ensureDate}
                taskWindow={taskWindow}
                onApplyConsequence={(task) => setApplyConsModal({ task })}
                onAddChild={() => setChildModal(true)}
              />
            </div>
          )}
          {view === "rewards" && (
            <RewardsView
              rewards={rewards}
              redemptions={redemptions}
              kids={children}
              selectedChildId={selectedChildId}
              onAdd={() => { setEditingReward(null); setRewardModal(true); }}
              onEdit={(r) => { setEditingReward(r); setRewardModal(true); }}
              onRefresh={load}
            />
          )}
          {view === "money" && (
            <div className="space-y-4">
              <CharityRequestsReview onChanged={load} />
              <div className="bg-white rounded-2xl border border-slate-200 p-6">
                <MoneyApprovals />
              </div>
            </div>
          )}
          {view === "consequences" && (
            <ConsequencesView
              consequences={consequences}
              onAdd={() => { setEditingCons(null); setConsModal(true); }}
              onEdit={(c) => { setEditingCons(c); setConsModal(true); }}
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
          </Suspense>
        </div>

        {/* Mobile bottom navigation: the four places a parent goes most, one
            thumb-tap away; everything else stays in the side menu. */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200 flex justify-around px-2 pt-1.5"
             style={{ paddingBottom: "calc(0.375rem + env(safe-area-inset-bottom))" }} aria-label="Navigasi utama">
          {BOTTOM_NAV.map((key) => {
            const n = NAV.find((x) => x.key === key);
            const active = view === key;
            return (
              <button key={key} onClick={() => setView(key)} onPointerDown={() => prefetchView(key)} aria-current={active ? "page" : undefined}
                      className={`press-btn relative flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold ${active ? "text-indigo-600" : "text-slate-500"}`}>
                <n.icon className="w-5 h-5" strokeWidth={2.5} />
                {BOTTOM_LABELS[key]}
                {key === "tasks" && (stats?.pending_approval || 0) > 0 && (
                  <span className="absolute top-0 right-1 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-orange-500 text-white text-[10px] leading-[1.1rem]">
                    {stats.pending_approval}
                  </span>
                )}
              </button>
            );
          })}
          <button onClick={() => setMobileNavOpen(true)}
                  className="press-btn flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold text-slate-500">
            <Menu className="w-5 h-5" strokeWidth={2.5} />
            Lainnya
          </button>
        </nav>
      </main>

      <Suspense fallback={null}>
        {paletteOpen && (
          <CommandPalette
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            kids={children}
            nav={NAV}
            onNavigate={setView}
            onOpenTaskForm={() => { setEditingTask(null); setTaskModal(true); }}
            onCreated={load}
          />
        )}
      </Suspense>

      <Suspense fallback={null}>
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
      <RewardFormModal open={rewardModal} onClose={() => { setRewardModal(false); setEditingReward(null); }} onSaved={load} editReward={editingReward} />
      <ConsequenceFormModal open={consModal} onClose={() => { setConsModal(false); setEditingCons(null); }} onSaved={load} editConsequence={editingCons} />
      <ApplyConsequenceModal
        open={!!applyConsModal}
        onClose={() => setApplyConsModal(null)}
        consequences={consequences}
        kids={children}
        preselect={applyConsModal}
        selectedChildId={selectedChildId}
        onSaved={load}
      />
      </Suspense>
    </div>
  );
}
