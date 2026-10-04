import { useEffect, useState } from "react";
import api from "@/lib/api";
import { humanDateKey } from "@/lib/dates";

/** "Hari terbaikmu minggu ini" — a little story of the best day of the week. */
export default function BestDayCard({ childId }) {
  const [best, setBest] = useState(null);
  useEffect(() => {
    if (!childId) return;
    api.get(`/children/${childId}/best-day`).then((r) => setBest(r.data?.best || null)).catch(() => {});
  }, [childId]);
  if (!best) return null;
  return (
    <div className="rounded-3xl bg-gradient-to-br from-amber-50 to-pink-50 border-2 border-amber-100 p-4 chunky-shadow">
      <div className="font-fun font-bold text-lg text-slate-900">🌟 Hari terbaikmu minggu ini</div>
      <div className="text-sm text-slate-700 mt-1">
        <b>{humanDateKey(best.date_key)}</b>: {best.done}/{best.required} misi selesai
        {best.on_time_sections ? `, ${best.on_time_sections} bagian tepat waktu` : ""}
        {best.points ? `, +${best.points} poin` : ""}.
      </div>
      {best.photos?.length > 0 && (
        <div className="flex gap-2 mt-2 overflow-x-auto">
          {best.photos.map((p, i) => <img key={i} src={p} alt="" className="w-16 h-16 rounded-xl object-cover shrink-0" />)}
        </div>
      )}
      {best.summaries?.map((s, i) => (
        <div key={i} className="text-xs text-slate-600 italic mt-2 line-clamp-2">📝 {s.title}: “{s.text}”</div>
      ))}
    </div>
  );
}
