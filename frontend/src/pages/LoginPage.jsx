import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Rocket, ArrowLeft, Delete } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatApiError } from "@/lib/api";
import LanguageToggle from "@/components/LanguageToggle";

export default function LoginPage() {
  const { login, fetchMembers } = useAuth();
  const { t } = useLanguage();
  const nav = useNavigate();
  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [selected, setSelected] = useState(null);
  const [passcode, setPasscode] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchMembers().then((data) => {
      setMembers(data);
      setLoadingMembers(false);
    });
  }, [fetchMembers]);

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
      toast.success(`${t("welcomeBack")}, ${data.name}!`);
      if (data.is_default_passcode) {
        toast.warning(t("defaultPasscodeWarning"));
      }
      nav(data.role === "parent" ? "/parent" : `/kid/${data.id}`);
    } catch (err) {
      toast.error(formatApiError(err) || t("incorrectPasscode"));
      setPasscode("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen kid-shell flex items-center justify-center px-4 py-8 font-body">
      <div className="absolute top-6 right-6">
        <LanguageToggle />
      </div>

      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2 justify-center mb-8">
          <div className="w-10 h-10 rounded-2xl bg-[#FF9D23] flex items-center justify-center chunky-shadow">
            <Rocket className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-fun font-bold text-2xl text-slate-800">My Lil Famz</span>
        </Link>

        <div className="bg-white rounded-3xl p-8 chunky-shadow-lg border-2 border-slate-100">
          <AnimatePresence mode="wait">
            {!selected ? (
              <motion.div
                key="picker"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
              >
                <h1 className="font-fun font-bold text-3xl text-slate-900 mb-1 text-center">
                  {t("whoIsThis")}
                </h1>
                <p className="text-slate-500 mb-6 text-center">{t("tapYourProfile")}</p>

                {loadingMembers ? (
                  <div className="text-center text-slate-400 py-8">…</div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    {members.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => {
                          setSelected(m);
                          setPasscode("");
                        }}
                        className="press-btn chunky-shadow bg-slate-50 hover:bg-slate-100 rounded-2xl p-4 border-2 border-slate-100 flex flex-col items-center gap-2"
                      >
                        <div
                          className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl chunky-shadow"
                          style={{ background: m.avatar_color }}
                        >
                          {m.avatar_emoji}
                        </div>
                        <div className="font-fun font-bold text-slate-900">{m.name}</div>
                        <div className="text-xs text-slate-500">
                          {m.role === "parent" ? t("parent") : t("child")}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="passcode"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
              >
                <button
                  onClick={() => {
                    setSelected(null);
                    setPasscode("");
                  }}
                  className="flex items-center gap-1 text-slate-500 hover:text-slate-700 mb-4 text-sm font-semibold"
                >
                  <ArrowLeft className="w-4 h-4" /> {t("cancel")}
                </button>

                <div className="flex flex-col items-center mb-6">
                  <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl chunky-shadow mb-2"
                    style={{ background: selected.avatar_color }}
                  >
                    {selected.avatar_emoji}
                  </div>
                  <div className="font-fun font-bold text-xl text-slate-900">{selected.name}</div>
                  <p className="text-slate-500 text-sm mt-1">{t("enterPasscode")}</p>
                </div>

                <div className="flex justify-center gap-2 mb-6">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-9 h-11 rounded-xl border-2 flex items-center justify-center font-mono text-xl ${
                        i < passcode.length
                          ? "border-[#FF9D23] bg-orange-50"
                          : "border-slate-200"
                      }`}
                    >
                      {i < passcode.length ? "●" : ""}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                    <button
                      key={n}
                      onClick={() => handleDigit(String(n))}
                      disabled={loading}
                      className="press-btn bg-slate-50 hover:bg-slate-100 rounded-2xl py-4 font-fun font-bold text-xl text-slate-800"
                    >
                      {n}
                    </button>
                  ))}
                  <div />
                  <button
                    onClick={() => handleDigit("0")}
                    disabled={loading}
                    className="press-btn bg-slate-50 hover:bg-slate-100 rounded-2xl py-4 font-fun font-bold text-xl text-slate-800"
                  >
                    0
                  </button>
                  <button
                    onClick={handleBackspace}
                    disabled={loading}
                    className="press-btn bg-slate-50 hover:bg-slate-100 rounded-2xl py-4 flex items-center justify-center text-slate-500"
                  >
                    <Delete className="w-5 h-5" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
