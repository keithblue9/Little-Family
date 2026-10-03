import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lightbulb, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { qk } from "@/lib/queries";

/**
 * Saran Jadwal — looks at the last four weeks and points out missions that keep
 * being missed (maybe too hard, too long, or at the wrong time of day) and
 * habits that are already solid. Nothing changes until a parent taps Terapkan,
 * and then only the routine going forward.
 */
export default function ScheduleSuggestionsCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: qk.suggestions,
    queryFn: async () => (await api.get("/schedule/suggestions")).data,
    staleTime: 10 * 60_000,
  });

  const apply = async (s) => {
    try {
      await api.post("/schedule/suggestions/apply", {
        slot_id: s.slot_id, type: s.action.type, points: s.action.points,
      });
      toast.success("Rutinitas diperbarui untuk hari-hari berikutnya");
      qc.invalidateQueries({ queryKey: qk.suggestions });
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const list = data?.suggestions || [];
  return (
    <div>
      <h3 className="font-parent font-bold text-lg text-slate-900 flex items-center gap-2">
        <Lightbulb className="w-5 h-5 text-amber-500" /> Saran Jadwal
      </h3>
      <p className="text-sm text-slate-500 mt-1">Dari 4 minggu terakhir. Hanya saran — Anda yang memutuskan.</p>
      {isLoading ? (
        <div className="space-y-2 mt-3">
          <div className="skeleton-block h-14 rounded-xl" />
          <div className="skeleton-block h-14 rounded-xl" />
        </div>
      ) : list.length === 0 ? (
        <div className="text-sm text-slate-500 mt-3">Belum ada saran — jadwalnya berjalan wajar. 👍</div>
      ) : (
        <div className="space-y-2 mt-3">
          {list.map((s) => (
            <div key={`${s.child_id}-${s.title}`}
                 className={`rounded-xl border p-3 flex gap-3 ${s.kind === "struggling" ? "border-amber-200 bg-amber-50/60" : "border-emerald-200 bg-emerald-50/60"}`}>
              <div className="shrink-0 mt-0.5">
                {s.kind === "struggling"
                  ? <TrendingDown className="w-5 h-5 text-amber-600" />
                  : <TrendingUp className="w-5 h-5 text-emerald-600" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-800">
                  {s.avatar_emoji} {s.child_name} · {s.title} <span className="text-slate-500 font-normal">({s.rate}%)</span>
                </div>
                <div className="text-xs text-slate-600 mt-0.5">{s.message}</div>
              </div>
              {s.action && (
                <button onClick={() => apply(s)}
                        className="press-btn shrink-0 self-center px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  {s.action.type === "set_points" ? `Poin → ${s.action.points}` : "Jadikan bonus"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
