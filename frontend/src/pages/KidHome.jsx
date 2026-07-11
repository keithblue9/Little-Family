import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [tasks, setTasks] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [config, setConfig] = useState({ skip_cost_points: 20, rupiah_per_point: 100 });
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
      const [cRes, tRes, rRes, cfgRes] = await Promise.all([
        api.get("/children"),
        api.get("/tasks", { params: { child_id: childId } }),
        api.get("/rewards"),
        api.get("/config"),
      ]);
      const c = cRes.data.find((x) => x.id === childId);
      if (!c) {
        toast.error("Profil tidak ditemukan");
        nav("/");
        return;
      }
      setChild(c);
      setTasks(tRes.data);
      setRewards(rRes.data);
      setConfig(cfgRes.data);
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }, [childId, nav]);

  useEffect(() => { load(); }, [load]);

  // Treasure hunt: open tasks sorted by order; first one is the active quest.
  const questLine = useMemo(() => {
    const open = tasks
      .filter((t) => t.status === "pending" || t.status === "rejected")
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    return open;
  }, [tasks]);

  const pendingApproval = useMemo(
    () => tasks.filter((t) => t.status === "completed"),
    [tasks]
  );
  const doneTasks = useMemo(
    () => tasks
      .filter((t) => t.status === "approved" || t.status === "skipped")
      .sort((a, b) => (a.order || 0) - (b.order || 0)),
    [tasks]
  );

  const completeTask = async (task) => {
    try {
      await api.post(`/tasks/${task.id}/complete`);
      setCelebrate(true);
      setTimeout(() => setCelebrate(false), 3000);
      toast.success("Misi selesai! Tunggu dicek Abi/Ummi ya ⭐");
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const skipTask = async (task) => {
    const cost = config.skip_cost_points ?? 20;
    if (!window.confirm(`Lewati misi "${task.title}" dengan membayar ${cost} poin?`)) return;
    try {
      await api.post(`/tasks/${task.id}/skip`);
      toast.success(`Misi dilewati! -${cost} poin ⏭️`);
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

  const skipCost = config.skip_cost_points ?? 20;

  return (
    <div className="min-h-screen kid-shell grain relative font-body pb-28" data-testid={TEST_IDS.kid.home}>
      {celebrate && (
        <Confetti width={dims.w} height={dims.h} numberOfPieces={220} recycle={false} gravity={0.25} />
      )}

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between px-5 md:px-10 pt-6">
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
                Selesaikan misi secara berurutan. Misi berikutnya terbuka setelah yang sebelumnya selesai!
              </p>

              {questLine.length === 0 && pendingApproval.length === 0 ? (
                <div className="bg-white rounded-3xl p-8 text-center border-2 border-slate-100 chunky-shadow">
                  <div className="text-5xl mb-3">🎉</div>
                  <div className="font-fun font-bold text-xl text-slate-900">Semua misi beres!</div>
                  <div className="text-slate-500 text-sm">Cek lagi nanti untuk petualangan baru.</div>
                </div>
              ) : (
                <div className="relative">
                  {/* Quest path line */}
                  <div className="absolute left-7 top-8 bottom-8 w-1 bg-slate-200 rounded-full" />

                  <div className="space-y-3">
                    {questLine.map((t, idx) => {
                      const isActive = idx === 0;
                      return (
                        <motion.div
                          key={t.id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.05 }}
                          data-testid={`${TEST_IDS.kid.taskItem}-${t.id}`}
                          className={`relative rounded-3xl p-4 border-2 flex items-center gap-4 ${
                            isActive
                              ? "bg-white border-[#FF9D23] chunky-shadow-lg"
                              : "bg-slate-50/80 border-slate-100 opacity-75"
                          }`}
                        >
                          {/* Step number / lock */}
                          <div
                            className={`relative z-10 w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0 font-fun font-bold text-lg ${
                              isActive
                                ? "bg-gradient-to-br from-[#FF9D23] to-[#FF6B00] text-white chunky-shadow"
                                : "bg-slate-200 text-slate-400"
                            }`}
                          >
                            {isActive ? t.order || idx + 1 : <Lock className="w-5 h-5" strokeWidth={2.5} />}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className={`font-fun font-bold text-lg truncate ${isActive ? "text-slate-900" : "text-slate-500"}`}>
                              {t.title}
                            </div>
                            {t.description && (
                              <div className="text-sm text-slate-500 truncate">{t.description}</div>
                            )}
                            {t.status === "rejected" && isActive && (
                              <div className="text-xs font-bold text-red-500 mt-0.5">Dikembalikan — coba lagi ya!</div>
                            )}
                            <div className="flex items-center gap-1 mt-1">
                              <Star className="w-3.5 h-3.5 text-[#FF9D23] fill-[#FF9D23]" />
                              <span className="text-sm font-bold text-slate-700">+{t.points} poin</span>
                            </div>
                          </div>

                          {isActive ? (
                            <div className="flex flex-col gap-2 flex-shrink-0">
                              <button
                                onClick={() => completeTask(t)}
                                data-testid={`${TEST_IDS.kid.completeTaskBtn}-${t.id}`}
                                className="press-btn chunky-shadow bg-[#34D399] hover:bg-[#2bbf88] text-white font-fun font-bold px-4 py-2.5 rounded-2xl flex items-center gap-1.5 text-sm"
                              >
                                <CheckCircle2 className="w-4 h-4" strokeWidth={2.5} /> Selesai!
                              </button>
                              <button
                                onClick={() => skipTask(t)}
                                className="press-btn bg-slate-100 hover:bg-slate-200 text-slate-600 font-fun font-semibold px-4 py-1.5 rounded-2xl flex items-center gap-1.5 text-xs"
                                title={`Bayar ${skipCost} poin untuk melewati`}
                              >
                                <FastForward className="w-3.5 h-3.5" /> Lewati ({skipCost} ⭐)
                              </button>
                            </div>
                          ) : (
                            <div className="text-xs font-bold text-slate-400 flex-shrink-0">Terkunci</div>
                          )}
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              )}

              {pendingApproval.length > 0 && (
                <div className="mt-6">
                  <h3 className="font-fun font-semibold text-base text-slate-500 mb-2">Menunggu dicek Abi/Ummi</h3>
                  <div className="space-y-2">
                    {pendingApproval.map((t) => (
                      <div key={t.id} className="bg-[#FFF4D1] rounded-3xl p-4 border-2 border-[#FFE4A0] flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-[#FFE4A0] flex items-center justify-center flex-shrink-0">
                          <Trophy className="w-5 h-5 text-[#FF9D23]" strokeWidth={2.5} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-fun font-bold text-slate-900 truncate">{t.title}</div>
                          <div className="text-xs text-slate-600">Kerja bagus! Menunggu persetujuan.</div>
                        </div>
                        <div className="text-sm font-bold text-[#FF9D23] flex-shrink-0">+{t.points} ⭐</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {doneTasks.length > 0 && (
                <div className="mt-6">
                  <h3 className="font-fun font-semibold text-base text-slate-500 mb-2">Sudah selesai ✅</h3>
                  <div className="space-y-2">
                    {doneTasks.slice(-5).map((t) => (
                      <div key={t.id} className="bg-white/60 rounded-2xl px-4 py-2.5 border border-slate-100 flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${t.status === "approved" ? "bg-green-100" : "bg-slate-100"}`}>
                          {t.status === "approved" ? (
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                          ) : (
                            <FastForward className="w-4 h-4 text-slate-400" />
                          )}
                        </div>
                        <div className="flex-1 text-sm text-slate-500 line-through truncate">{t.title}</div>
                        <div className="text-xs font-bold text-slate-400">
                          {t.status === "approved" ? `+${t.points}` : "dilewati"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
      <div className="fixed bottom-4 left-4 right-4 z-30">
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
