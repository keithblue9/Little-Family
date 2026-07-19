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
import PetManagerCard from "@/components/PetManagerCard";
import DailyRecapCard from "@/components/DailyRecapCard";
import RewardSuggestions from "@/components/RewardSuggestions";
import CheersReceived from "@/components/CheersReceived";
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
  const [consequences, setConsequences] = useState([]);
  const [levelTitles, setLevelTitles] = useState(null); // family's custom level ladder, from config
  const [petStageNames, setPetStageNames] = useState(null);
  const [petFeedThresholds, setPetFeedThresholds] = useState(null);
  const [feedCostPerMeal, setFeedCostPerMeal] = useState(5);
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
      const [cRes, rRes, wRes, cfgRes, consRes] = await Promise.all([
        api.get("/children"),
        api.get("/rewards"),
        api.get("/wishlist"),
        api.get("/config"),
        api.get("/consequences"),
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
      setConsequences(consRes.data);
      setLevelTitles(cfgRes.data.level_titles);
      setPetStageNames(cfgRes.data.pet_stage_names);
      setPetFeedThresholds(cfgRes.data.pet_stage_feed_thresholds);
      setFeedCostPerMeal(cfgRes.data.feed_cost_per_meal ?? 5);
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

  const levelInfo = computeLevel(child.lifetime_points || 0, levelTitles);

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
            <div className="flex items-center gap-1.5 text-sm font-semibold text-[#FF5C5C]">
              <Flame className="w-4 h-4" strokeWidth={2.5} />
              <span>Streak {child.streak_days || 0} hari</span>
              {(child.best_streak_days || 0) > (child.streak_days || 0) && (
                <span className="text-xs font-bold text-amber-600" title="Rekor streak terbaikmu">
                  · 🏅 {child.best_streak_days}
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
      <div className="relative z-10 px-5 md:px-10 pt-5">
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-gradient-to-br from-[#7C5CFF] via-[#6B5CFF] to-[#4DB8FF] rounded-3xl p-5 chunky-shadow-lg text-white overflow-hidden relative"
        >
          <div className="absolute -right-8 -top-8 w-36 h-36 rounded-full bg-white/10" />
          <div className="absolute right-12 bottom-2 w-20 h-20 rounded-full bg-white/5" />
          <div className="relative flex items-center justify-between">
            <div>
              <div className="flex items-center gap-1.5 mb-0.5 text-white/80 text-xs font-bold uppercase tracking-wide">
                <Sparkles className="w-3.5 h-3.5" strokeWidth={2.5} /> Poin kamu
              </div>
              <div className="font-fun font-bold text-6xl leading-none">{child.points || 0}</div>
            </div>
            <button
              onClick={() => setTab("money")}
              className="press-btn bg-white/20 hover:bg-white/30 backdrop-blur text-white font-fun font-bold px-4 py-2.5 rounded-2xl text-sm shrink-0"
            >
              Tukar 💰
            </button>
          </div>

          {/* Compact stat chips */}
          <div className="relative flex items-center gap-2 mt-3 flex-wrap">
            <span className="inline-flex items-center gap-1 bg-white/15 rounded-full px-2.5 py-1 text-xs font-semibold">
              🏆 {child.lifetime_points || 0} total
            </span>
            <span className="inline-flex items-center gap-1 bg-white/15 rounded-full px-2.5 py-1 text-xs font-semibold">
              ✅ {child.tasks_completed || 0} misi
            </span>
            {(child.freeze_cards_available ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 bg-white/15 rounded-full px-2.5 py-1 text-xs font-semibold" title="Kartu Bebas — melindungi streak-mu kalau kelewat 1 hari">
                🧊 {child.freeze_cards_available} Kartu Bebas
              </span>
            )}
          </div>

          {/* Level bar — permanent progress from lifetime points, unaffected by spending */}
          <div className="relative mt-4 pt-3.5 border-t border-white/20">
            <div className="flex items-center justify-between text-xs font-bold text-white/90 mb-1.5">
              <span>{levelInfo.emoji} Lvl {levelInfo.level} · {levelInfo.title}</span>
              <span>{levelInfo.maxed ? "MAX! 🌟" : `${levelInfo.xp}/${levelInfo.nextMin} XP`}</span>
            </div>
            <div className="h-2.5 bg-white/20 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${levelInfo.percent}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="h-full rounded-full bg-white"
              />
            </div>
          </div>
        </motion.div>
      </div>

      {/* Tab content */}
      <div className="relative z-10 px-5 md:px-10 pt-6">
        <AnimatePresence mode="wait">
          {tab === "tasks" && (
            <motion.div key="tasks" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="mb-5">
                <VirtualPetMascot child={child} onChanged={load} levelTitles={levelTitles} petStageNames={petStageNames} petFeedThresholds={petFeedThresholds} feedCostPerMeal={feedCostPerMeal} />
              </div>
              <h2 className="font-fun font-bold text-xl text-slate-900 mb-3">Misi Hari Ini 🗺️</h2>

              {child.mbti && personalityMeta(child.mbti) && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="mb-4 rounded-2xl px-4 py-3 flex items-center gap-3 text-white chunky-shadow"
                  style={{ background: personalityMeta(child.mbti).color }}
                >
                  <div className="text-2xl shrink-0">{personalityMeta(child.mbti).emoji}</div>
                  <div className="font-body text-sm leading-snug min-w-0">
                    {personalityMeta(child.mbti).motivation}
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

              {/* Consequences awareness — so kids know what reduces points */}
              {consequences.length > 0 && (
                <div className="mt-6 bg-white rounded-3xl p-4 border-2 border-red-100 chunky-shadow">
                  <h3 className="font-fun font-bold text-slate-900 mb-1 flex items-center gap-2">
                    <span className="text-xl">⚠️</span> Hati-hati, ini bisa mengurangi poin
                  </h3>
                  <p className="text-xs text-slate-500 mb-3">Kalau melakukan ini, poinmu bisa berkurang ya.</p>
                  <div className="space-y-2">
                    {consequences.map((c) => (
                      <div key={c.id} className="flex items-center gap-3 bg-red-50/60 rounded-2xl px-3 py-2 border border-red-100">
                        <div className="w-9 h-9 rounded-xl bg-red-100 flex items-center justify-center shrink-0 text-lg">🚫</div>
                        <div className="flex-1 min-w-0">
                          <div className="font-fun font-bold text-sm text-slate-800 truncate">{c.name}</div>
                          {c.description && <div className="text-xs text-slate-500 truncate">{c.description}</div>}
                        </div>
                        {c.points_deducted > 0 && (
                          <div className="text-sm font-fun font-bold text-red-500 shrink-0">−{c.points_deducted}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {tab === "rewards" && (
            <motion.div key="rewards" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <h2 className="font-fun font-bold text-2xl text-slate-900 mb-3">Toko Hadiah 🎁</h2>

              <RewardSuggestions />

              {wishlist.length > 0 && (
                <div className="mb-5">
                  <h3 className="font-fun font-bold text-sm text-slate-500 mb-2 flex items-center gap-1.5">
                    <Heart className="w-4 h-4 fill-pink-400 text-pink-400" /> Wishlist-ku
                  </h3>
                  <div className="space-y-2">
                    {wishlist.map((w) => (
                      <div key={w.id} className="bg-white rounded-2xl p-3 border-2 border-pink-100 flex items-center gap-3">
                        {w.reward.image ? (
                          <img src={w.reward.image} alt={w.reward.name} className="w-12 h-12 rounded-xl object-cover shrink-0 border border-pink-100" />
                        ) : (
                          <div className="w-12 h-12 rounded-xl bg-pink-50 flex items-center justify-center shrink-0">
                            <Gift className="w-6 h-6 text-pink-400" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-fun font-bold text-sm text-slate-800 truncate">{w.reward.name}</div>
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
                            <div
                              className={`h-full rounded-full ${w.goal_met ? "bg-green-500" : "bg-pink-400"}`}
                              style={{ width: `${w.percent}%` }}
                            />
                          </div>
                          <div className="text-[11px] text-slate-500 mt-1">
                            {w.goal_met ? (
                              <span className="text-green-600 font-bold">Tabunganmu cukup! 🎉</span>
                            ) : (
                              <>
                                Tabungan {w.current_points}/{w.reward.cost_points} · kurang <b>{w.remaining}</b>
                                {w.days_estimate != null && <> · ~<b>{w.days_estimate} hari</b> lagi</>}
                              </>
                            )}
                          </div>
                        </div>
                        <div className="text-xs font-bold text-slate-500 shrink-0">
                          {w.goal_met ? "Siap!" : `${w.percent}%`}
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
                    // Rewards are bought from the Tabungan (savings) bucket.
                    const savings = child.chiky_save || 0;
                    const canAfford = savings >= r.cost_points;
                    const wished = wishlist.some((w) => w.reward_id === r.id);
                    return (
                      <div key={r.id} className="bg-white rounded-3xl p-4 border-2 border-slate-100 chunky-shadow relative overflow-hidden">
                        <button
                          onClick={() => toggleWishlist(r)}
                          className="absolute top-3 right-3 z-10 press-btn p-1.5 rounded-full bg-white/80 backdrop-blur hover:bg-pink-50"
                          title={wished ? "Hapus dari wishlist" : "Tambah ke wishlist"}
                        >
                          <Heart className={`w-5 h-5 ${wished ? "fill-pink-500 text-pink-500" : "text-slate-300"}`} strokeWidth={2} />
                        </button>

                        {/* Reward image banner (if any) */}
                        {r.image && (
                          <img src={r.image} alt={r.name} className="w-full h-32 object-cover rounded-2xl mb-3" />
                        )}

                        <div className="flex items-start gap-3 mb-3">
                          {!r.image && (
                            <div className="w-12 h-12 rounded-2xl bg-[#FF9D23]/15 flex items-center justify-center flex-shrink-0">
                              <Gift className="w-6 h-6 text-[#FF9D23]" strokeWidth={2.5} />
                            </div>
                          )}
                          <div className="flex-1 min-w-0 pr-6">
                            <div className="font-fun font-bold text-lg text-slate-900">{r.name}</div>
                            {r.description && <div className="text-sm text-slate-500">{r.description}</div>}
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1" title="Harga diambil dari Tabungan">
                            <span className="text-sm">🐔</span>
                            <span className="font-fun font-bold text-slate-900">{r.cost_points}</span>
                            <span className="text-xs text-slate-400">tabungan</span>
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
              <CheersReceived childId={childId} />
              <Leaderboard currentChildId={childId} />
              <KidChallenges />
              <StickerBook childId={childId} />
              <Achievements childId={childId} />
              <GrowthTrail childId={childId} childName={child.name} />
            </motion.div>
          )}

          {tab === "profile" && (
            <motion.div key="profile" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="bg-white rounded-3xl p-6 border-2 border-slate-100 chunky-shadow">
                <PetManagerCard
                  child={child}
                  onChanged={load}
                  petStageNames={petStageNames}
                  petFeedThresholds={petFeedThresholds}
                />
              </div>
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
