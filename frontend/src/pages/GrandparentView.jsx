import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Rocket, Trophy, Flame, Star, Sparkles } from "lucide-react";
import api from "@/lib/api";

export default function GrandparentView() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/public/view/${token}`)
      .then(({ data }) => setData(data))
      .catch((e) => setError(e?.response?.status === 404 ? "Link ini tidak ditemukan atau sudah tidak berlaku." : "Gagal memuat halaman."))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-white">
        <div className="text-slate-400">Memuat…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-white p-6">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-3">🔒</div>
          <div className="font-fun font-bold text-lg text-slate-800 mb-1">Tidak Bisa Dibuka</div>
          <div className="text-sm text-slate-500">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-indigo-50">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-center gap-2 mb-2">
          <div className="w-10 h-10 rounded-2xl bg-[#FF9D23] flex items-center justify-center chunky-shadow">
            <Rocket className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-fun font-bold text-xl text-slate-900">My Lil Famz</span>
        </div>
        <div className="text-center text-slate-500 text-sm mb-4">
          👋 Progress {data.family_label} — hanya untuk dilihat
        </div>

        {data.children.map((child, i) => (
          <motion.div
            key={child.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-white rounded-3xl border-2 border-slate-100 chunky-shadow-lg overflow-hidden"
          >
            <div className="p-5 flex items-center gap-4" style={{ background: `${child.avatar_color}22` }}>
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl chunky-shadow shrink-0" style={{ background: child.avatar_color }}>
                {child.avatar_emoji}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-fun font-bold text-xl text-slate-900">{child.name}</div>
                <div className="flex items-center gap-3 text-sm text-slate-600 flex-wrap mt-1">
                  <span className="flex items-center gap-1"><Star className="w-4 h-4 text-amber-500 fill-amber-500" /> {child.points} poin</span>
                  <span className="flex items-center gap-1"><Flame className="w-4 h-4 text-red-500" /> streak {child.streak_days} hari</span>
                  <span className="flex items-center gap-1"><Trophy className="w-4 h-4 text-indigo-500" /> {child.tasks_completed} misi selesai</span>
                </div>
              </div>
            </div>

            {child.badges.length > 0 && (
              <div className="px-5 py-3 border-t border-slate-100">
                <div className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Lencana
                </div>
                <div className="flex flex-wrap gap-2">
                  {child.badges.map((b) => (
                    <span key={b.id} className="text-xs font-semibold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700">
                      🏆 {b.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {child.recent_missions.length > 0 && (
              <div className="px-5 py-4 border-t border-slate-100">
                <div className="text-xs font-bold text-slate-400 uppercase mb-2">Misi Terbaru</div>
                <div className="space-y-2">
                  {child.recent_missions.slice(0, 5).map((m, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      {m.completion_photo_url && (
                        <img src={m.completion_photo_url} alt={m.title} className="w-10 h-10 rounded-lg object-cover shrink-0 border border-slate-200" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-800 truncate">{m.title}</div>
                        <div className="text-xs text-slate-400">
                          {m.approved_at ? new Date(m.approved_at).toLocaleDateString("id-ID", { day: "numeric", month: "short" }) : ""}
                        </div>
                      </div>
                      <div className="text-xs font-bold text-amber-600 shrink-0">+{m.points}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        ))}

        <div className="text-center text-xs text-slate-300 pt-4">My Lil Famz 🚀</div>
      </div>
    </div>
  );
}
