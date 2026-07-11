import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import Confetti from "react-confetti";
import {
  Star, Trophy, CheckCircle2, Gift, Award, Home as HomeIcon,
  LogOut, Flame, Lock, Sparkles,
} from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { TEST_IDS } from "@/constants/testIds/app";
import PinGate from "@/components/PinGate";
import { useAuth } from "@/contexts/AuthContext";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import ProfilePhotoUpload from "@/components/ProfilePhotoUpload";
import ReminderCreator from "@/components/ReminderCreator";
import Leaderboard from "@/components/Leaderboard";
import Achievements from "@/components/Achievements";
import AnalyticsDashboard from "@/components/AnalyticsDashboard";

const TABS = [
  { key: "tasks", label: "Quests", icon: HomeIcon, testId: TEST_IDS.kid.tabTasks },
  { key: "rewards", label: "Rewards", icon: Gift, testId: TEST_IDS.kid.tabRewards },
  { key: "badges", label: "Badges", icon: Award, testId: TEST_IDS.kid.tabBadges },
  { key: "leaderboard", label: "Leaderboard", icon: Trophy, testId: "tab-leaderboard" },
  { key: "achievements", label: "Achievements", icon: Star, testId: "tab-achievements" },
  { key: "analytics", label: "Stats", icon: Sparkles, testId: "tab-analytics" },
  { key: "theme", label: "Theme", icon: Sparkles, testId: "tab-theme" },
  { key: "reminders", label: "Reminders", icon: Flame, testId: "tab-reminders" },
  { key: "settings", label: "Settings", icon: HomeIcon, testId: "tab-settings" },
];

export default function KidHome() {
  const { childId } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [child, setChild] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [badges, setBadges] = useState([]);
  const [tab, setTab] = useState("tasks");
  const [celebrate, setCelebrate] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [pinAction, setPinAction] = useState("exit"); // "exit" or "set"
  const [dims, setDims] = useState({ w: window.innerWidth, h: window.innerHeight });

  useEffect(() => {
    const onResize = () => setDims({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const load = useCallback(async () => {
    try {
      const [cRes, tRes, rRes, bRes] = await Promise.all([
        api.get("/children"),
        api.get("/tasks", { params: { child_id: childId } }),
        api.get("/rewards"),
        api.get("/badges", { params: { child_id: childId } }),
      ]);
      const c = cRes.data.find((x) => x.id === childId);
      if (!c) {
        toast.error("Profile not found");
        nav("/kid");
        return;
      }
      setChild(c);
      setTasks(tRes.data);
      setRewards(rRes.data);
      setBadges(bRes.data);
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }, [childId, nav]);

  useEffect(() => { load(); }, [load]);

  const openTasks = useMemo(
    () => tasks.filter((t) => t.status === "pending" || t.status === "rejected"),
    [tasks]
  );
  const pendingApproval = useMemo(
    () => tasks.filter((t) => t.status === "completed"),
    [tasks]
  );

  const completeTask = async (task) => {
    try {
      await api.post(`/tasks/${task.id}/complete`);
      setCelebrate(true);
      setTimeout(() => setCelebrate(false), 3000);
      toast.success("Task marked done! Waiting for a grown-up to approve ⭐");
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const redeem = async (reward) => {
    try {
      await api.post(`/rewards/${reward.id}/redeem`, null, { params: { child_id: childId } });
      toast.success(`You redeemed ${reward.name}!`);
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const tryExit = () => {
    if (!user?.has_pin) {
      setPinAction("set");
    } else {
      setPinAction("exit");
    }
    setShowPin(true);
  };

  if (!child) {
    return <div className="min-h-screen kid-shell flex items-center justify-center font-parent text-slate-500">Loading…</div>;
  }

  return (
    <div className="min-h-screen kid-shell grain relative font-body pb-24" data-testid={TEST_IDS.kid.home}>
      {celebrate && (
        <Confetti
          width={dims.w}
          height={dims.h}
          numberOfPieces={220}
          recycle={false}
          gravity={0.25}
        />
      )}

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between px-5 md:px-10 pt-6">
        <div className="flex items-center gap-3">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl chunky-shadow"
            style={{ background: child.avatar_color }}
          >
            {child.avatar_emoji}
          </motion.div>
          <div>
            <div className="font-fun font-bold text-2xl text-slate-900">Hi, {child.name}!</div>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Flame className="w-4 h-4 text-[#FF5C5C]" strokeWidth={2.5} />
              {child.streak_days || 0}-day streak
            </div>
          </div>
        </div>
        <button
          onClick={tryExit}
          data-testid={TEST_IDS.kid.exitKidBtn}
          className="press-btn bg-white/80 backdrop-blur border-2 border-slate-200 p-3 rounded-2xl"
          title="Parent access"
        >
          <Lock className="w-5 h-5 text-slate-700" strokeWidth={2.5} />
        </button>
      </div>

      {/* Points hero */}
      <div className="relative z-10 px-5 md:px-10 pt-6">
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-gradient-to-br from-[#FF9D23] to-[#FF6B00] rounded-3xl p-6 chunky-shadow-lg text-white overflow-hidden relative"
        >
          <div className="absolute -right-6 -top-6 w-32 h-32 rounded-full bg-white/10" />
          <div className="absolute right-10 bottom-4 w-20 h-20 rounded-full bg-white/10" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-1 text-white/90 text-sm font-semibold">
              <Sparkles className="w-4 h-4" strokeWidth={2.5} /> Your points
            </div>
            <div className="font-fun font-bold text-6xl leading-none">{child.points || 0}</div>
            <div className="text-white/80 text-sm mt-2">Lifetime: {child.lifetime_points || 0} · Tasks done: {child.tasks_completed || 0}</div>
          </div>
        </motion.div>
      </div>

      {/* Tab content */}
      <div className="relative z-10 px-5 md:px-10 pt-6">
        <AnimatePresence mode="wait">
          {tab === "tasks" && (
            <motion.div
              key="tasks"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <h2 className="font-fun font-bold text-2xl text-slate-900 mb-3">Your quests</h2>
              {openTasks.length === 0 && pendingApproval.length === 0 ? (
                <div className="bg-white rounded-3xl p-8 text-center border-2 border-slate-100 chunky-shadow">
                  <div className="text-5xl mb-3">🎉</div>
                  <div className="font-fun font-bold text-xl text-slate-900">All done!</div>
                  <div className="text-slate-500 text-sm">Come back later for new quests.</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {openTasks.map((t) => (
                    <motion.div
                      key={t.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      data-testid={`${TEST_IDS.kid.taskItem}-${t.id}`}
                      className="bg-white rounded-3xl p-4 border-2 border-slate-100 chunky-shadow flex items-center gap-4"
                    >
                      <button
                        onClick={() => completeTask(t)}
                        data-testid={`${TEST_IDS.kid.completeTaskBtn}-${t.id}`}
                        className="press-btn w-14 h-14 rounded-full border-4 border-slate-200 hover:border-[#34D399] hover:bg-[#E6F9F0] flex items-center justify-center transition-colors flex-shrink-0"
                      >
                        <CheckCircle2 className="w-7 h-7 text-slate-300 hover:text-[#34D399]" strokeWidth={2.5} />
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="font-fun font-bold text-lg text-slate-900 truncate">{t.title}</div>
                        {t.description && <div className="text-sm text-slate-500 truncate">{t.description}</div>}
                      </div>
                      <div className="bg-[#FFF4D1] px-3 py-2 rounded-2xl flex items-center gap-1 flex-shrink-0">
                        <Star className="w-4 h-4 text-[#FF9D23] fill-[#FF9D23]" strokeWidth={2.5} />
                        <span className="font-fun font-bold text-slate-900">+{t.points}</span>
                      </div>
                    </motion.div>
                  ))}
                  {pendingApproval.length > 0 && (
                    <>
                      <h3 className="font-fun font-semibold text-base text-slate-500 pt-4">Waiting for approval</h3>
                      {pendingApproval.map((t) => (
                        <div key={t.id} className="bg-[#FFF4D1] rounded-3xl p-4 border-2 border-[#FFE4A0] flex items-center gap-4 opacity-90">
                          <div className="w-14 h-14 rounded-full bg-[#FFE4A0] flex items-center justify-center">
                            <Trophy className="w-6 h-6 text-[#FF9D23]" strokeWidth={2.5} />
                          </div>
                          <div className="flex-1">
                            <div className="font-fun font-bold text-lg text-slate-900">{t.title}</div>
                            <div className="text-sm text-slate-600">Great job! Waiting for a grown-up.</div>
                          </div>
                          <div className="text-sm font-bold text-[#FF9D23]">+{t.points} ⭐</div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {tab === "rewards" && (
            <motion.div
              key="rewards"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <h2 className="font-fun font-bold text-2xl text-slate-900 mb-3">Reward store</h2>
              {rewards.length === 0 ? (
                <div className="bg-white rounded-3xl p-8 text-center border-2 border-slate-100 chunky-shadow">
                  <Gift className="w-10 h-10 text-slate-300 mx-auto mb-3" strokeWidth={2.5} />
                  <div className="font-fun font-bold text-xl text-slate-900">No rewards yet</div>
                  <div className="text-slate-500 text-sm">Ask a parent to add some!</div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {rewards.map((r) => {
                    const canAfford = (child.points || 0) >= r.cost_points;
                    return (
                      <div key={r.id} className="bg-white rounded-3xl p-4 border-2 border-slate-100 chunky-shadow">
                        <div className="flex items-start gap-3 mb-3">
                          <div className="w-12 h-12 rounded-2xl bg-[#FF9D23]/15 flex items-center justify-center flex-shrink-0">
                            <Gift className="w-6 h-6 text-[#FF9D23]" strokeWidth={2.5} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-fun font-bold text-lg text-slate-900">{r.name}</div>
                            {r.description && <div className="text-sm text-slate-500">{r.description}</div>}
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <Star className="w-4 h-4 text-[#FF9D23] fill-[#FF9D23]" strokeWidth={2.5} />
                            <span className="font-fun font-bold text-slate-900">{r.cost_points}</span>
                          </div>
                          <button
                            onClick={() => redeem(r)}
                            disabled={!canAfford}
                            data-testid={`${TEST_IDS.kid.redeemBtn}-${r.id}`}
                            className="press-btn chunky-shadow bg-[#FF9D23] disabled:bg-slate-200 disabled:text-slate-400 disabled:chunky-shadow disabled:cursor-not-allowed text-white font-fun font-semibold px-4 py-2 rounded-2xl transition-colors"
                          >
                            {canAfford ? "Redeem" : "Locked"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}

          {tab === "badges" && (
            <motion.div
              key="badges"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <h2 className="font-fun font-bold text-2xl text-slate-900 mb-3">Your badges</h2>
              {badges.length === 0 ? (
                <div className="bg-white rounded-3xl p-8 text-center border-2 border-slate-100 chunky-shadow">
                  <Award className="w-10 h-10 text-slate-300 mx-auto mb-3" strokeWidth={2.5} />
                  <div className="font-fun font-bold text-xl text-slate-900">No badges yet</div>
                  <div className="text-slate-500 text-sm">Complete quests to earn badges!</div>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {badges.map((b) => (
                    <motion.div
                      key={b.id}
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="bg-white rounded-3xl p-4 border-2 border-slate-100 chunky-shadow text-center"
                    >
                      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#FF9D23] to-[#FF6B00] mx-auto flex items-center justify-center mb-2 chunky-shadow">
                        <Trophy className="w-8 h-8 text-white" strokeWidth={2.5} />
                      </div>
                      <div className="font-fun font-bold text-sm text-slate-900">{b.name}</div>
                      <div className="text-xs text-slate-500 mt-1">{b.description}</div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* Stage 4: Leaderboard Tab */}
          {tab === "leaderboard" && (
            <motion.div
              key="leaderboard"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <Leaderboard />
            </motion.div>
          )}

          {/* Stage 4: Achievements Tab */}
          {tab === "achievements" && (
            <motion.div
              key="achievements"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <Achievements childId={childId} />
            </motion.div>
          )}

          {/* Stage 4: Analytics Tab */}
          {tab === "analytics" && (
            <motion.div
              key="analytics"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <AnalyticsDashboard childId={childId} />
            </motion.div>
          )}

          {/* Stage 2 & 3: Theme Tab */}
          {tab === "theme" && (
            <motion.div
              key="theme"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <ThemeSwitcher
                childId={childId}
                onThemeChange={(theme) => {
                  setChild((prev) => ({ ...prev, theme_preference: theme }));
                }}
              />
            </motion.div>
          )}

          {/* Stage 3: Reminders Tab */}
          {tab === "reminders" && (
            <motion.div
              key="reminders"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <ReminderCreator childId={childId} childName={child?.name} />
            </motion.div>
          )}

          {/* Stage 3: Settings Tab (Profile Photo) */}
          {tab === "settings" && child && (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              <ProfilePhotoUpload
                childId={childId}
                childName={child.name}
                currentPhoto={child.profile_photo_url}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom nav */}
      <div className="fixed bottom-4 left-4 right-4 z-30">
        <div className="max-w-md mx-auto bg-white rounded-full p-2 chunky-shadow-lg border-2 border-slate-100 flex items-center justify-around">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                data-testid={t.testId}
                className={`press-btn flex flex-col items-center gap-0.5 px-5 py-2 rounded-full font-fun font-semibold text-sm transition-colors ${
                  active ? "bg-[#FF9D23] text-white" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                <t.icon className="w-5 h-5" strokeWidth={2.5} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <PinGate
        open={showPin}
        onClose={() => setShowPin(false)}
        mode={pinAction === "set" ? "set" : "verify"}
        onSuccess={() => {
          setShowPin(false);
          nav("/parent");
        }}
      />
    </div>
  );
}
