import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BarChart3, TrendingUp, Flame, Trophy } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

const fmtRp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
const DAYS_ID = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

export default function WeeklyReport() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/family/weekly-report");
      setReport(data);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="bg-white rounded-2xl p-8 text-center text-slate-400">Memuat laporan…</div>;
  if (!report) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BarChart3 className="w-5 h-5 text-indigo-500" />
        <h3 className="font-parent font-bold text-lg text-slate-900">Laporan Minggu Ini</h3>
      </div>
      <p className="text-sm text-slate-500 -mt-2">
        {report.period_start} — {report.period_end}
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {report.children.map((entry) => {
          const c = entry.child;
          const dayKeys = Object.keys(entry.days).sort();
          const maxEarned = Math.max(1, ...dayKeys.map((dk) => entry.days[dk].earned));
          return (
            <motion.div key={c.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl border-2 border-slate-100 chunky-shadow overflow-hidden"
            >
              <div className="p-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: c.avatar_color }}>{c.avatar_emoji}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-fun font-bold text-slate-900">{c.name}</div>
                    <div className="text-xs text-slate-500">{c.mbti || ""} · streak {c.streak_days || 0} hari</div>
                  </div>
                  <div className="text-right">
                    <div className="font-fun font-bold text-xl text-slate-900">{entry.week_points}</div>
                    <div className="text-xs text-slate-500">poin minggu ini</div>
                  </div>
                </div>
              </div>

              {/* Mini bar chart: daily points */}
              <div className="px-4 py-3">
                <div className="flex items-end justify-between gap-1 h-16">
                  {dayKeys.map((dk) => {
                    const d = entry.days[dk];
                    const pct = (d.earned / maxEarned) * 100;
                    const dateObj = new Date(dk + "T00:00:00");
                    const dayName = DAYS_ID[dateObj.getDay()];
                    return (
                      <div key={dk} className="flex-1 flex flex-col items-center gap-0.5">
                        <motion.div
                          initial={{ height: 0 }}
                          animate={{ height: `${Math.max(4, pct)}%` }}
                          transition={{ duration: 0.5 }}
                          className="w-full max-w-[24px] rounded-t-md"
                          style={{ background: d.earned > 0 ? "#6366F1" : "#E2E8F0" }}
                          title={`${dk}: ${d.earned} poin`}
                        />
                        <span className="text-[9px] text-slate-400">{dayName}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Stats row */}
              <div className="px-4 pb-4 flex items-center gap-4 text-xs text-slate-600 flex-wrap">
                <span className="flex items-center gap-1"><Trophy className="w-3 h-3 text-amber-500" /> {entry.week_tasks_done}/{entry.week_tasks_total} misi</span>
                <span className="flex items-center gap-1"><Flame className="w-3 h-3 text-orange-500" /> streak {c.streak_days}</span>
                <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3 text-green-500" /> total {c.points} poin</span>
              </div>

              {/* Piggy summary */}
              <div className="px-4 pb-4 grid grid-cols-3 gap-2 text-center">
                <div className="bg-blue-50 rounded-xl py-2"><div className="text-lg">🏦</div><div className="text-xs font-bold text-blue-600">{c.piggy_save || 0}</div><div className="text-[9px] text-slate-400">Tabungan</div></div>
                <div className="bg-amber-50 rounded-xl py-2"><div className="text-lg">🛍️</div><div className="text-xs font-bold text-amber-600">{c.piggy_spend || 0}</div><div className="text-[9px] text-slate-400">Belanja</div></div>
                <div className="bg-pink-50 rounded-xl py-2"><div className="text-lg">💝</div><div className="text-xs font-bold text-pink-600">{c.piggy_share || 0}</div><div className="text-[9px] text-slate-400">Sedekah</div></div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
