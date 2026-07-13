import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const WEEKDAY_LABELS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

export default function MonthHeatmap({ childId, childName }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-12
  const [days, setDays] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!childId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/children/${childId}/month-progress`, { params: { year, month } });
      setDays(data.days || {});
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setLoading(false);
    }
  }, [childId, year, month]);

  useEffect(() => { load(); }, [load]);

  const shiftMonth = (delta) => {
    let m = month + delta;
    let y = year;
    if (m > 12) { m = 1; y += 1; }
    if (m < 1) { m = 12; y -= 1; }
    setMonth(m);
    setYear(y);
  };

  // Build calendar grid: leading blanks + all days of month
  const firstOfMonth = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7; // convert Sun=0 to Mon-first index
  const cells = [...Array(leadingBlanks).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const colorFor = (dayInfo) => {
    if (!dayInfo || dayInfo.task_count === 0) return "bg-slate-100";
    if (dayInfo.goal_met) return "bg-green-500";
    if (dayInfo.percent >= 50) return "bg-amber-400";
    return "bg-red-300";
  };

  const isFutureCell = (day) => {
    const cellDate = new Date(year, month - 1, day);
    return cellDate > now;
  };

  return (
    <div className="bg-white rounded-2xl border-2 border-slate-100 chunky-shadow p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-parent font-bold text-slate-900 flex items-center gap-2 text-sm">
          <CalendarDays className="w-4 h-4 text-indigo-500" /> Kalender {childName ? `— ${childName}` : ""}
        </h3>
        <div className="flex items-center gap-1">
          <button onClick={() => shiftMonth(-1)} className="press-btn p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-semibold text-slate-600 w-28 text-center">{MONTH_NAMES[month - 1]} {year}</span>
          <button onClick={() => shiftMonth(1)} className="press-btn p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-slate-400 text-sm py-6">Memuat…</div>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAY_LABELS.map((d) => (
              <div key={d} className="text-[10px] text-slate-400 text-center font-semibold">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (day === null) return <div key={`blank-${i}`} />;
              const dk = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const info = days[dk];
              const future = isFutureCell(day);
              return (
                <motion.div
                  key={dk}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.01 }}
                  title={info ? `${dk}: ${info.earned}/${info.goal} poin (${info.percent}%)` : dk}
                  className={`aspect-square rounded-md flex items-center justify-center text-[10px] font-semibold ${
                    future ? "bg-slate-50 text-slate-300" : `${colorFor(info)} text-white/90`
                  }`}
                >
                  {day}
                </motion.div>
              );
            })}
          </div>
          <div className="flex items-center gap-3 mt-3 text-[10px] text-slate-400 flex-wrap">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-green-500 inline-block" /> Target tercapai</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block" /> Sebagian</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-300 inline-block" /> Kurang</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-slate-100 inline-block" /> Tidak ada misi</span>
          </div>
        </>
      )}
    </div>
  );
}
