import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import Confetti from "react-confetti";
import {
  Star, Trophy, CheckCircle2, Gift, Home as HomeIcon,
  LogOut, Flame, Lock, Sparkles, Banknote, User, FastForward, Map, Heart,
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
import ChikyBankCard from "@/components/ChikyBankCard";
import KidChallenges from "@/components/KidChallenges";
import GrowthTrail from "@/components/GrowthTrail";
import StickerBook from "@/components/StickerBook";
import VirtualPetMascot from "@/components/VirtualPetMascot";
import DailyRecapCard from "@/components/DailyRecapCard";
import ProfileEditor from "@/components/ProfileEditor";
import DailyQuestView from "@/components/DailyQuestView";
import { personalityMeta } from "@/lib/personality";
import { pickQuestTheme } from "@/lib/questThemes";
import { computeLevel } from "@/lib/levels";
import { useLabels } from "@/lib/labels";

const TABS = [
  { key: "tasks", label: "Misi", labelKey: "kid.tab_tasks", icon: Map, testId: TEST_IDS.kid.tabTasks },
  { key: "money", label: "Tukar", labelKey: "kid.tab_money", icon: Banknote, testId: "tab-money" },
  { key: "rewards", label: "Toko", labelKey: "kid.tab_rewards", icon: Gift, testId: TEST_IDS.kid.tabRewards },
  { key: "champs", label: "Juara", labelKey: "kid.tab_champs", icon: Trophy, testId: "tab-champs" },
  { key: "profile", label: "Profil", labelKey: "kid.tab_profile", icon: User, testId: "tab-profile" },
];

export default function KidHome() {
  const { childId } = useParams();
  const nav = useNavigate();
  const { user, logout } = useAuth();
  const { t: L } = useLabels();
  const [child, setChild] = useState(null);
  const [rewards, setRewards] = useState([]);
  const [wishlist, setWishlist] = useState([]); // array of { id, reward_id, ... }
  const [showRecap, setShowRecap] = useState(false);
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
      const [cRes, rRes, wRes] = await Promise.all([
        api.get("/children"),
        api.get("/rewards"),
        api.get("/wishlist"),
      ]);
      const c = cRes.data.find((x) => x.id === childId);
      if (!c) {
        toast.error("Profil tidak ditemukan");
        nav("/");
        return;
      }
      setChild(c);
      setRewards(rRes.data);
      setWishlist(wRes.data);
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }, [childId, nav]);

  useEffect(() => { load(); }, [load]);

  const toggleWishlist = async (reward) => {
    const existing = wishlist.find((w) => w.reward_id === reward.id);
    try {
      if (existing) {
        await api.delete(`/wishlist/${existing.id}`);
        toast.success(`${reward.name} dihapus dari wishlist`);
      } else {
        await api.post("/wishlist", { reward_id: reward.id });
        toast.success(`${reward.name} ditambahkan ke wishlist! ⭐`);
      }
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

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

  const levelInfo = computeLevel(child.lifetime_points || 0);

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
            <div className="flex items-center gap-2 text-sm text-slate-500 flex-wrap">
              <Flame className="w-4 h-4 text-[#FF5C5C]" strokeWidth={2.5} />
              Streak {child.streak_days || 0} hari
              {(child.best_streak_days || 0) > (child.streak_days || 0) && (
                <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700" title="Rekor streak terbaikmu">
                  🏅 Rekor: {child.best_streak_days} hari
                </span>
              )}
              {(child.freeze_cards_available ?? 1) > 0 && (
                <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-700" title="Kartu Bebas — melindungi streak-mu kalau kelewat 1 hari">
                  🧊 {child.freeze_cards_available ?? 1} Kartu Bebas
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRecap(true)}
            className="press-btn bg-white/80 backdrop-blur border-2 border-slate-200 p-3 rounded-2xl"
            title="Rekap hari ini"
          >
            <Sparkles className="w-5 h-5 text-amber-500" strokeWidth={2.5} />
          </button>
          <button
            onClick={tryExit}
            data-testid={TEST_IDS.kid.exitKidBtn}
            className="press-btn bg-white/80 backdrop-blur border-2 border-slate-200 p-3 rounded-2xl"
            title={user?.role === "parent" ? "Kembali ke dashboard orang tua" : "Keluar"}
          >
            <LogOut className="w-5 h-5 text-slate-700" strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {showRecap && (
        <DailyRecapCard childId={childId} child={child} onClose={() => setShowRecap(false)} />
      )}

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

          {/* Level bar — permanent progress from lifetime points, unaffected by spending */}
          <div className="relative mt-4 pt-4 border-t border-white/20">
            <div className="flex items-center justify-between text-xs font-bold text-white/90 mb-1">
              <span>{levelInfo.emoji} Level {levelInfo.level} — {levelInfo.title}</span>
              <span>{levelInfo.maxed ? "MAX!" : `${levelInfo.xp}/${levelInfo.nextMin} XP`}</span>
            </div>
            <div className="h-2.5 bg-white/20 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${levelInfo.percent}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="h-full rounded-full bg-white"
              />
            </div>
            {!levelInfo.maxed && (
              <div className="text-[10px] text-white/70 mt-1">Menuju {levelInfo.nextTitle}</div>
            )}
          </div>
        </motion.div>
      </div>

      {/* Tab content */}
      <div className="relative z-10 px-5 md:px-10 pt-6">
        <AnimatePresence mode="wait">
          {tab === "tasks" && (
            <motion.div key="tasks" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="mb-4">
                <VirtualPetMascot child={child} />
              </div>
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
              <ChikyBankCard child={child} />
              <MoneyExchange childId={childId} points={child.points || 0} child={child} onChanged={load} />
            </motion.div>
          )}

          {tab === "rewards" && (
            <motion.div key="rewards" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <h2 className="font-fun font-bold text-2xl text-slate-900 mb-3">Toko Hadiah 🎁</h2>

              {wishlist.length > 0 && (
                <div className="mb-5">
                  <h3 className="font-fun font-bold text-sm text-slate-500 mb-2 flex items-center gap-1.5">
                    <Heart className="w-4 h-4 fill-pink-400 text-pink-400" /> Wishlist-ku
                  </h3>
                  <div className="space-y-2">
                    {wishlist.map((w) => (
                      <div key={w.id} className="bg-white rounded-2xl p-3 border-2 border-pink-100 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-pink-50 flex items-center justify-center shrink-0">
                          <Gift className="w-5 h-5 text-pink-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-fun font-bold text-sm text-slate-800 truncate">{w.reward.name}</div>
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
                            <div
                              className={`h-full rounded-full ${w.goal_met ? "bg-green-500" : "bg-pink-400"}`}
                              style={{ width: `${w.percent}%` }}
                            />
                          </div>
                        </div>
                        <div className="text-xs font-bold text-slate-500 shrink-0">
                          {w.goal_met ? "Siap ditukar! 🎉" : `${w.percent}%`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
                    const wished = wishlist.some((w) => w.reward_id === r.id);
                    return (
                      <div key={r.id} className="bg-white rounded-3xl p-4 border-2 border-slate-100 chunky-shadow relative">
                        <button
                          onClick={() => toggleWishlist(r)}
                          className="absolute top-3 right-3 press-btn p-1.5 rounded-full hover:bg-pink-50"
                          title={wished ? "Hapus dari wishlist" : "Tambah ke wishlist"}
                        >
                          <Heart className={`w-5 h-5 ${wished ? "fill-pink-500 text-pink-500" : "text-slate-300"}`} strokeWidth={2} />
                        </button>
                        <div className="flex items-start gap-3 mb-3">
                          <div className="w-12 h-12 rounded-2xl bg-[#FF9D23]/15 flex items-center justify-center flex-shrink-0">
                            <Gift className="w-6 h-6 text-[#FF9D23]" strokeWidth={2.5} />
                          </div>
                          <div className="flex-1 min-w-0 pr-6">
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
              <KidChallenges />
              <StickerBook childId={childId} />
              <Achievements childId={childId} />
              <GrowthTrail childId={childId} childName={child.name} />
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
            const lbl = t.labelKey ? L(t.labelKey) : t.label;
            if (lbl === "") return null; // hidden by parent
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
                {lbl}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
