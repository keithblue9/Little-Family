import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Rocket, ArrowLeft, Delete, ChevronRight, Sparkles, Star, Trophy } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { formatApiError } from "@/lib/api";

export default function LoginPage() {
  const { login, fetchMembers } = useAuth();
  const nav = useNavigate();
  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState(null);
  const [passcode, setPasscode] = useState("");
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchMembers()
      .then((data) => {
        if (!alive) return;
        setMembers(data || []);
        setLoadError(!data || data.length === 0);
      })
      .finally(() => alive && setLoadingMembers(false));
    return () => {
      alive = false;
    };
  }, [fetchMembers]);

  const retry = () => {
    setLoadingMembers(true);
    setLoadError(false);
    fetchMembers()
      .then((data) => {
        setMembers(data || []);
        setLoadError(!data || data.length === 0);
      })
      .finally(() => setLoadingMembers(false));
  };

  const handleDigit = (d) => {
    if (passcode.length >= 6 || loading) return;
    const next = passcode + d;
    setPasscode(next);
    if (next.length === 6) submit(next);
  };

  const handleBackspace = () => setPasscode((p) => p.slice(0, -1));

  const submit = async (code) => {
    setLoading(true);
    try {
      const data = await login(selected.id, code);
      toast.success(`Halo, ${data.name}! 👋`);
      if (data.is_default_passcode) {
        toast.warning("Passcode kamu masih bawaan (123456). Ganti di menu Profil ya!");
      }
      nav(data.role === "parent" ? "/parent" : `/kid/${data.id}`);
    } catch (err) {
      setShake(true);
      setTimeout(() => setShake(false), 500);
      toast.error(formatApiError(err) || "Passcode salah");
      setPasscode("");
    } finally {
      setLoading(false);
    }
  };

  const roleLabel = (m) => (m.role === "parent" ? "Orang Tua" : "Anak");

  const LogoBlock = (
    <div className="flex items-center gap-2.5">
      <div className="w-10 h-10 rounded-2xl bg-[#FF9D23] flex items-center justify-center chunky-shadow shrink-0">
        <Rocket className="w-5 h-5 text-white" strokeWidth={2.5} />
      </div>
      <span className="font-fun font-bold text-xl text-slate-900">My Lil Famz</span>
    </div>
  );

  const AuthCard = (
    <motion.div
      layout
      animate={shake ? { x: [-10, 10, -8, 8, -4, 4, 0] } : {}}
      transition={shake ? { duration: 0.45 } : { layout: { type: "spring", stiffness: 300, damping: 30 } }}
      className="w-full"
    >
      <AnimatePresence mode="wait">
        {!selected ? (
          <motion.div
            key="picker"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
              Masuk sebagai
            </div>

            {loadingMembers ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-16 rounded-2xl bg-slate-100 animate-pulse" />
                ))}
              </div>
            ) : loadError ? (
              <div className="text-center py-8">
                <div className="text-3xl mb-2">🔌</div>
                <p className="text-slate-500 text-sm mb-4">
                  Tidak bisa terhubung ke server.
                  <br />
                  Coba lagi sebentar lagi ya.
                </p>
                <button
                  onClick={retry}
                  className="press-btn bg-slate-900 hover:bg-slate-800 text-white font-fun font-semibold px-5 py-2 rounded-xl text-sm"
                >
                  Coba Lagi
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {members.map((m, i) => (
                  <motion.button
                    key={m.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.06 }}
                    onClick={() => {
                      setSelected(m);
                      setPasscode("");
                    }}
                    className="press-btn w-full flex items-center gap-3 bg-slate-50 hover:bg-orange-50 border-2 border-slate-100 hover:border-orange-200 rounded-2xl p-3 transition-colors"
                    data-testid={`login-member-${m.name}`}
                  >
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl chunky-shadow shrink-0"
                      style={{ background: m.avatar_color }}
                    >
                      {m.avatar_emoji}
                    </div>
                    <div className="flex-1 text-left">
                      <div className="font-fun font-bold text-slate-900">{m.name}</div>
                      <div className="text-xs text-slate-500">{roleLabel(m)}</div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-300" />
                  </motion.button>
                ))}
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="passcode"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <button
              onClick={() => {
                setSelected(null);
                setPasscode("");
              }}
              className="flex items-center gap-1 text-slate-400 hover:text-slate-600 mb-4 text-sm font-semibold"
            >
              <ArrowLeft className="w-4 h-4" /> Kembali
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl chunky-shadow"
                style={{ background: selected.avatar_color }}
              >
                {selected.avatar_emoji}
              </div>
              <div>
                <div className="font-fun font-bold text-lg text-slate-900">{selected.name}</div>
                <div className="text-xs text-slate-500">Masukkan passcode 6 digit</div>
              </div>
            </div>

            <div className="flex justify-center gap-2 mb-5">
              {Array.from({ length: 6 }).map((_, i) => (
                <motion.div
                  key={i}
                  animate={i === passcode.length ? { scale: [1, 1.08, 1] } : {}}
                  transition={{ repeat: Infinity, duration: 1.2 }}
                  className={`w-9 h-11 rounded-xl border-2 flex items-center justify-center text-xl transition-colors ${
                    i < passcode.length
                      ? "border-[#FF9D23] bg-orange-50"
                      : i === passcode.length
                      ? "border-[#FF9D23]/50"
                      : "border-slate-200"
                  }`}
                >
                  {i < passcode.length ? "●" : ""}
                </motion.div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <button
                  key={n}
                  onClick={() => handleDigit(String(n))}
                  disabled={loading}
                  className="press-btn bg-slate-50 hover:bg-slate-100 active:bg-orange-50 rounded-2xl py-3.5 font-fun font-bold text-xl text-slate-800 disabled:opacity-50"
                >
                  {n}
                </button>
              ))}
              <div />
              <button
                onClick={() => handleDigit("0")}
                disabled={loading}
                className="press-btn bg-slate-50 hover:bg-slate-100 active:bg-orange-50 rounded-2xl py-3.5 font-fun font-bold text-xl text-slate-800 disabled:opacity-50"
              >
                0
              </button>
              <button
                onClick={handleBackspace}
                disabled={loading}
                className="press-btn bg-slate-50 hover:bg-slate-100 rounded-2xl py-3.5 flex items-center justify-center text-slate-500 disabled:opacity-50"
              >
                <Delete className="w-5 h-5" />
              </button>
            </div>

            {loading && <div className="text-center text-sm text-slate-400 mt-4">Memeriksa…</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );

  return (
    <div className="min-h-screen bg-white font-body">
      {/* ===== Desktop / tablet: WorkPulse-style split layout ===== */}
      <div className="hidden md:flex min-h-screen">
        {/* Left: narrow clean auth panel */}
        <div className="w-full max-w-md flex flex-col justify-center px-10 lg:px-14 py-10 border-r border-slate-100">
          <div className="mb-10">{LogoBlock}</div>
          {AuthCard}
          <p className="text-xs text-slate-400 mt-6">
            Lupa passcode? Minta Abi/Ummi untuk reset ya 😊
          </p>
        </div>

        {/* Right: brand panel */}
        <div className="flex-1 relative overflow-hidden bg-gradient-to-br from-[#FF9D23] via-[#FF8A3D] to-[#FF6B00] flex items-center justify-center">
          <div className="absolute top-16 left-16 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute bottom-24 right-20 w-56 h-56 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute top-1/3 right-24 w-24 h-24 rounded-full bg-white/10 blur-xl" />

          <div className="relative z-10 text-center px-12 max-w-lg">
            <motion.div
              initial={{ scale: 0, rotate: -15 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 200, damping: 15 }}
              className="w-20 h-20 rounded-3xl bg-white/20 backdrop-blur flex items-center justify-center mx-auto mb-6"
            >
              <Sparkles className="w-10 h-10 text-white" strokeWidth={2} />
            </motion.div>
            <h1 className="font-fun font-bold text-4xl text-white mb-3 leading-tight">
              Petualangan seru
              <br />
              keluarga kita 🏡
            </h1>
            <p className="text-white/80 text-base">
              Selesaikan misi, kumpulkan poin, dan tukar jadi hadiah — bersama Abi, Ummi, Adskhan &amp; Syila.
            </p>

            <div className="flex items-center justify-center gap-6 mt-10 text-white/90">
              <div className="flex flex-col items-center gap-1">
                <Trophy className="w-6 h-6" />
                <span className="text-xs font-semibold">Misi Seru</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <Star className="w-6 h-6" />
                <span className="text-xs font-semibold">Kumpulkan Poin</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <Rocket className="w-6 h-6" />
                <span className="text-xs font-semibold">Tukar Hadiah</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ===== Mobile / PWA: clean full-screen single column ===== */}
      <div className="md:hidden min-h-screen flex flex-col justify-center px-6 py-10 kid-shell grain">
        <div className="mb-8 flex flex-col items-center">
          <motion.div
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 18 }}
            className="w-16 h-16 rounded-3xl bg-[#FF9D23] flex items-center justify-center chunky-shadow-lg mb-3"
          >
            <Rocket className="w-8 h-8 text-white" strokeWidth={2.5} />
          </motion.div>
          <h1 className="font-fun font-bold text-2xl text-slate-900">My Lil Famz</h1>
          <p className="text-slate-500 text-sm mt-1">Petualangan seru keluarga kita 🏡</p>
        </div>

        <div className="bg-white rounded-3xl p-6 chunky-shadow-lg border-2 border-slate-100">
          {AuthCard}
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          Lupa passcode? Minta Abi/Ummi untuk reset ya 😊
        </p>
      </div>
    </div>
  );
}
