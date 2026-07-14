import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { todayKey } from "@/lib/dates";

const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const WEEKDAY_LABELS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

/**
 * Month calendar for the kid's own quest view. Tapping any day selects it —
 * the mission list below updates to that day (replaces the old prev/next
 * arrow navigation with an at-a-glance month view, colored by how each day
 * went, same as the parent's Monitor Harian heatmap).
 */
export default function KidMonthCalendar({ childId, selectedDateKey, onSelectDate }) {
  const initial = new Date(selectedDateKey + "T00:00:00");
  const [year, setYear] = useState(initial.getFullYear());
  const [month, setMonth] = useState(initial.getMonth() + 1);
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

  const firstOfMonth = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7;
  const cells = [...Array(leadingBlanks).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const colorFor = (dayInfo, isSelected, isToday) => {
    if (isSelected) return "bg-indigo-600 text-white ring-2 ring-indigo-300";
    if (!dayInfo || dayInfo.task_count === 0) return isToday ? "bg-white border-2 border-indigo-300 text-slate-700" : "bg-slate-50 text-slate-400";
    if (dayInfo.goal_met) return "bg-green-400 text-white";
    if (dayInfo.percent >= 50) return "bg-amber-300 text-white";
    return "bg-red-200 text-red-700";
  };

  return (
    <div className="bg-white rounded-2xl border-2 border-slate-100 chunky-shadow p-4">
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => shiftMonth(-1)} className="press-btn p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="font-fun font-bold text-slate-800 text-sm">{MONTH_NAMES[month - 1]} {year}</span>
        <button onClick={() => shiftMonth(1)} className="press-btn p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        <div className="text-center text-slate-400 text-sm py-6">Memuat…</div>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAY_LABELS.map((d) => (
              <div key={d} className="text-[10px] text-slate-400 text-center font-bold">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {cells.map((day, i) => {
              if (day === null) return <div key={`blank-${i}`} />;
              const dk = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const info = days[dk];
              const isSelected = dk === selectedDateKey;
              const isToday = dk === todayKey();
              return (
                <motion.button
                  key={dk}
                  onClick={() => onSelectDate(dk)}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.008 }}
                  whileTap={{ scale: 0.9 }}
                  className={`press-btn aspect-square rounded-lg flex flex-col items-center justify-center text-xs font-bold transition-colors ${colorFor(info, isSelected, isToday)}`}
                >
                  {day}
                  {isToday && !isSelected && <span className="w-1 h-1 rounded-full bg-indigo-400 mt-0.5" />}
                </motion.button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 mt-3 text-[9px] text-slate-400 flex-wrap justify-center">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-400 inline-block" /> Tercapai</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-300 inline-block" /> Sebagian</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-200 inline-block" /> Kurang</span>
          </div>
        </>
      )}
    </div>
  );
}
