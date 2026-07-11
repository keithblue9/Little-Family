import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Rocket, ArrowLeft } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { TEST_IDS } from "@/constants/testIds/app";
import PinInputModal from "@/components/PinInputModal";

export default function ChildPicker() {
  const nav = useNavigate();
  const { setParentUnlocked } = useAuth();
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedChild, setSelectedChild] = useState(null);
  const [showPinModal, setShowPinModal] = useState(false);

  useEffect(() => {
    // Entering kid mode locks the parent controls
    setParentUnlocked(false);
    api
      .get("/children")
      .then((r) => setChildren(r.data))
      .catch((e) => toast.error(formatApiError(e)))
      .finally(() => setLoading(false));
  }, [setParentUnlocked]);

  return (
    <div className="min-h-screen kid-shell grain relative font-body pb-16" data-testid={TEST_IDS.kid.picker}>
      <nav className="relative z-10 flex items-center justify-between px-6 md:px-12 py-6">
        <button
          onClick={() => nav("/parent")}
          className="press-btn inline-flex items-center gap-2 bg-white/80 backdrop-blur border-2 border-slate-200 text-slate-700 font-fun font-semibold px-4 py-2 rounded-2xl"
          data-testid="child-picker-back-btn"
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={2.5} /> Parent
        </button>
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-2xl bg-[#FF9D23] flex items-center justify-center chunky-shadow">
            <Rocket className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-fun font-bold text-2xl text-slate-800">My Lil Famz</span>
        </div>
        <div className="w-24" />
      </nav>

      <div className="max-w-4xl mx-auto px-6 md:px-12 pt-8">
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-fun font-bold text-4xl md:text-6xl text-slate-900 text-center mb-2"
        >
          Who&apos;s playing?
        </motion.h1>
        <p className="text-center text-slate-600 mb-12">Tap your name to see your quests!</p>

        {loading ? (
          <div className="text-center text-slate-400">Loading…</div>
        ) : children.length === 0 ? (
          <div className="bg-white rounded-3xl p-8 text-center chunky-shadow border-2 border-slate-100">
            <p className="text-slate-600 mb-4">No kid profiles yet. Ask a parent to add one!</p>
            <button
              onClick={() => nav("/parent")}
              className="press-btn chunky-shadow bg-[#FF9D23] text-white font-fun font-semibold px-6 py-3 rounded-2xl"
            >
              Go to parent dashboard
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
            {children.map((c, i) => (
              <motion.button
                key={c.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08, type: "spring" }}
                whileHover={{ y: -4 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => {
                  if (c.passcode_hash) {
                    setSelectedChild(c);
                    setShowPinModal(true);
                  } else {
                    nav(`/kid/${c.id}`);
                  }
                }}
                data-testid={`${TEST_IDS.kid.childOption}-${c.name}`}
                className="press-btn chunky-shadow-lg bg-white rounded-3xl p-6 border-2 border-slate-100 flex flex-col items-center gap-3"
              >
                <div
                  className="w-24 h-24 rounded-3xl flex items-center justify-center text-5xl chunky-shadow"
                  style={{ background: c.avatar_color }}
                >
                  {c.avatar_emoji}
                </div>
                <div className="font-fun font-bold text-2xl text-slate-900">{c.name}</div>
                <div className="text-sm text-slate-500">{c.points} ⭐ points</div>
              </motion.button>
            ))}
          </div>
        )}
      </div>

      {showPinModal && selectedChild && (
        <PinInputModal
          childId={selectedChild.id}
          childName={selectedChild.name}
          onSuccess={() => {
            setShowPinModal(false);
            nav(`/kid/${selectedChild.id}`);
          }}
          onClose={() => {
            setShowPinModal(false);
            setSelectedChild(null);
          }}
        />
      )}
    </div>
  );
}
