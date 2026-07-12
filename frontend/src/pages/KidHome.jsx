import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import Confetti from "react-confetti";
import {
  Star, Trophy, CheckCircle2, Gift, Home as HomeIcon,
  LogOut, Flame, Lock, Sparkles, Banknote, User, FastForward, Map,
} from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { TEST_IDS } from "@/constants/testIds/app";
import { useAuth } from "@/contexts/AuthContext";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import ProfilePhotoUpload from "@/components/ProfilePhotoUpload";
import Leaderboard from "@/components/Leaderboard";
import Achievements from "@/components/Achievements";
import MoneyExchange from "@/components/MoneyExchange";
import ProfileEditor from "@/components/ProfileEditor";
import DailyQuestView from "@/components/DailyQuestView";
import { personalityMeta } from "@/lib/personality";
import { pickQuestTheme } from "@/lib/questThemes";

const TABS = [
  { key: "tasks", label: "Misi", icon: Map, testId: TEST_IDS.kid.tabTasks },
  { key: "money", label: "Tukar", icon: Banknote, testId: "tab-money" },
  { key: "rewards", label: "Toko", icon: Gift, testId: TEST_IDS.kid.tabRewards },
  { key: "champs", label: "Juara", icon: Trophy, testId: "tab-champs" },
  { key: "profile", label: "Profil", icon: User, testId: "tab-profile" },
];

export default function KidHome() {
  const { childId } = useParams();
  const nav = useNavigate();
  const { user, logout } = useAuth();
  const [child, setChild] = useState(null);
  const [rewards, setRewards] = useState([]);
  const [tab, setTab] = useState("tasks");
  const [celebrate, setCelebrate] = useState(false);
  const [dims, setDims] = useState({ w: window.innerWidth, h: window.innerHeight });

  useEffect(() => {
    const onResize = () => setDims({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const load = useCallback(async () => {
    try {
      const [cRes, rRes] = await Promise.all([
        api.get("/children"),
        api.get("/rewards"),
      ]);
      const c = cRes.data.find((x) => x.id === childId);
      if (!c) {
        toast.error("Profil tidak ditemukan");
        nav("/");
        return;
      }
      setChild(c);
      setRewards(rRes.data);
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }, [childId, nav]);

  useEffect(() => { load(); }, [load]);

  const redeem = async (reward) => {
    try {
      await api.post(`/rewards/${reward.id}/redeem`, null, { params: { child_id: childId } });
      toast.success(`Berhasil menukar ${reward.name}! 🎁`);
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const tryExit = async () => {
    if (user?.role === "parent") {
      nav("/parent");
    } else {
      await logout();
      nav("/login");
    }
  };

  if (!child) {
    return <div className="min-h-screen kid-shell flex items-center justify-center font-parent text-slate-500">Memuat…</div>;
  }

  return (
    <div className="min-h-screen kid-shell grain relative font-body pb-28 safe-x" data-testid={TEST_IDS.kid.home}>
      {celebrate && (
        <Confetti width={dims.w} height={dims.h} numberOfPieces={220} recycle={false} gravity={0.25} />
      )}

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between px-5 md:px-10 safe-top">
        <div className="flex items-center gap-3">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl chunky-shadow overflow-hidden"
            style={{ background: child.avatar_color }}
          >
            {child.profile_photo_url ? (
              <img src={child.profile_photo_url} alt={child.name} className="w-full h-full object-cover" />
            ) : (
              child.avatar_emoji
            )}
          </motion.div>
          <div>
            <div className="font-fun font-bold text-2xl text-slate-900">Halo, {child.name}!</div>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Flame className="w-4 h-4 text-[#FF5C5C]" strokeWidth={2.5} />
              Streak {child.streak_days || 0} hari
            </div>
          </div>
        </div>
        <button
          onClick={tryExit}
          data-testid={TEST_IDS.kid.exitKidBtn}
          className="press-btn bg-white/80 backdrop-blur border-2 border-slate-200 p-3 rounded-2xl"
          title={user?.role === "parent" ? "Kembali ke dashboard orang tua" : "Keluar"}
        >
          <LogOut className="w-5 h-5 text-slate-700" strokeWidth={2.5} />
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
          <div className="relative flex items-end justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1 text-white/90 text-sm font-semibold">
                <Sparkles className="w-4 h-4" strokeWidth={2.5} /> Poin kamu
              </div>
              <div className="font-fun font-bold text-6xl leading-none">{child.points || 0}</div>
              <div className="text-white/80 text-sm mt-2">
                Total sepanjang masa: {child.lifetime_points || 0} · Misi selesai: {child.tasks_completed || 0}
              </div>
            </div>
            <button
              onClick={() => setTab("money")}
              className="press-btn bg-white/20 hover:bg-white/30 backdrop-blur text-white font-fun font-bold px-4 py-2 rounded-2xl text-sm"
            >
              Tukar 💰
            </button>
          </div>
        </motion.div>
      </div>

      {/* Tab content */}
      <div className="relative z-10 px-5 md:px-10 pt-6">
        <AnimatePresence mode="wait">
          {tab === "tasks" && (
            <motion.div key="tasks" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <h2 className="font-fun font-bold text-2xl text-slate-900 mb-1">Petualangan Misi 🗺️</h2>
              <p className="text-sm text-slate-500 mb-4">
                Selesaikan misi harianmu sesuai urutan. Selesaikan target poin harianmu untuk jadi juara!
              </p>

              {child.mbti && personalityMeta(child.mbti) && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="mb-4 rounded-2xl p-4 flex items-center gap-3 text-white chunky-shadow"
                  style={{ background: personalityMeta(child.mbti).color }}
                >
                  <div className="text-3xl">{personalityMeta(child.mbti).emoji}</div>
                  <div className="min-w-0">
                    <div className="font-fun font-bold text-sm opacity-90">
                      {personalityMeta(child.mbti).nickname}
                    </div>
                    <div className="font-body text-sm leading-snug">
                      {personalityMeta(child.mbti).motivation}
                    </div>
                  </div>
                </motion.div>
              )}

              <DailyQuestView
                child={child}
                themeKey={pickQuestTheme(child)}
                onCelebrate={() => {
                  setCelebrate(true);
                  setTimeout(() => setCelebrate(false), 3000);
                  load();
                }}
              />
            </motion.div>
          )}

          {tab === "money" && (
            <motion.div key="money" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <MoneyExchange childId={childId} points={child.points || 0} onChanged={load} />
            </motion.div>
          )}

          {tab === "rewards" && (
            <motion.div key="rewards" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <h2 className="font-fun font-bold text-2xl text-slate-900 mb-3">Toko Hadiah 🎁</h2>
              {rewards.length === 0 ? (
                <div className="bg-white rounded-3xl p-8 text-center border-2 border-slate-100 chunky-shadow">
                  <Gift className="w-10 h-10 text-slate-300 mx-auto mb-3" strokeWidth={2.5} />
                  <div className="font-fun font-bold text-xl text-slate-900">Belum ada hadiah</div>
                  <div className="text-slate-500 text-sm">Minta Abi/Ummi menambahkan!</div>
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
                            className="press-btn chunky-shadow bg-[#FF9D23] disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-fun font-semibold px-4 py-2 rounded-2xl transition-colors"
                          >
                            {canAfford ? "Tukar" : "Belum cukup"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}

          {tab === "champs" && (
            <motion.div key="champs" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-8">
              <Leaderboard />
              <Achievements childId={childId} />
            </motion.div>
          )}

          {tab === "profile" && (
            <motion.div key="profile" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="bg-white rounded-3xl p-6 border-2 border-slate-100 chunky-shadow">
                <ProfileEditor />
              </div>
              <div className="bg-white rounded-3xl p-6 border-2 border-slate-100 chunky-shadow">
                <ProfilePhotoUpload
                  childId={childId}
                  childName={child.name}
                  currentPhoto={child.profile_photo_url}
                />
              </div>
              <div className="bg-white rounded-3xl p-6 border-2 border-slate-100 chunky-shadow">
                <ThemeSwitcher
                  childId={childId}
                  onThemeChange={(theme) => {
                    setChild((prev) => ({ ...prev, theme_preference: theme }));
                  }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom nav */}
      <div className="fixed safe-bottom-nav left-4 right-4 z-30">
        <div className="max-w-md mx-auto bg-white rounded-full p-2 chunky-shadow-lg border-2 border-slate-100 flex items-center justify-around">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                data-testid={t.testId}
                className={`press-btn flex flex-col items-center gap-0.5 px-4 py-2 rounded-full font-fun font-semibold text-xs transition-colors ${
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
    </div>
  );
}
