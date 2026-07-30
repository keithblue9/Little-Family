import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import api from "@/lib/api";

/**
 * Gentle working-pattern insight per child, computed from the start/finish
 * timestamps. Deliberately framed as conversation starters, never verdicts —
 * a kid finishing fast might be efficient, and a slow one might be struggling
 * or just distracted. The parent knows their kid; this only surfaces signals.
 */
export default function HonestyInsightCard() {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(14);

  useEffect(() => {
    let cancelled = false;
    api.get("/family/honesty-insight", { params: { days } })
      .then(({ data }) => { if (!cancelled) setData(data); })
      .catch(() => { if (!cancelled) setData({ children: [] }); });
    return () => { cancelled = true; };
  }, [days]);

  if (!data) return <div className="text-sm text-slate-400">Memuat…</div>;

  const measured = data.children.filter((c) => c.tasks_measured > 0);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="font-parent font-bold text-lg text-slate-900 flex items-center gap-2">
          <Activity className="w-5 h-5 text-indigo-500" /> Pola Pengerjaan Anak
        </h3>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="text-xs border-2 border-slate-200 rounded-lg px-2 py-1 bg-white"
        >
          <option value={7}>7 hari</option>
          <option value={14}>14 hari</option>
          <option value={30}>30 hari</option>
        </select>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Dihitung dari jam mulai & selesai tiap misi. Ini cuma bahan obrolan, bukan tuduhan — selesai cepat
        bisa berarti anak memang cekatan, dan kelamaan bisa berarti dia butuh bantuan.
      </p>

      {measured.length === 0 ? (
        <div className="text-sm text-slate-400 bg-slate-50 rounded-2xl p-4 text-center">
          Belum ada data yang cukup. Data muncul setelah anak memakai tombol Mulai & Selesai.
        </div>
      ) : (
        <div className="space-y-3">
          {measured.map((c) => {
            const flashRatio = c.tasks_measured ? c.flash_count / c.tasks_measured : 0;
            const tone = flashRatio >= 0.4 ? "amber" : "slate";
            return (
              <div key={c.child_id} className={`rounded-2xl p-3 border-2 ${tone === "amber" ? "border-amber-200 bg-amber-50/50" : "border-slate-100"}`}>
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-base shrink-0"
                    style={{ background: `${c.avatar_color}22` }}
                  >
                    {c.avatar_emoji || "🙂"}
                  </div>
                  <div className="font-semibold text-slate-800 text-sm">{c.child_name}</div>
                  <div className="text-xs text-slate-400 ml-auto">{c.tasks_measured} misi terukur</div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div className="bg-white rounded-xl py-2 border border-slate-100">
                    <div className="text-[10px] text-slate-400">Rata-rata asli</div>
                    <div className="font-bold text-slate-800 text-sm">{c.avg_actual_minutes ?? "—"} mnt</div>
                  </div>
                  <div className="bg-white rounded-xl py-2 border border-slate-100">
                    <div className="text-[10px] text-slate-400">Perkiraan</div>
                    <div className="font-bold text-slate-800 text-sm">{c.avg_estimated_minutes ?? "—"} mnt</div>
                  </div>
                  <div className="bg-white rounded-xl py-2 border border-slate-100">
                    <div className="text-[10px] text-slate-400">Kilat ⚡</div>
                    <div className={`font-bold text-sm ${c.flash_count > 0 ? "text-amber-600" : "text-slate-800"}`}>{c.flash_count}</div>
                  </div>
                  <div className="bg-white rounded-xl py-2 border border-slate-100">
                    <div className="text-[10px] text-slate-400">Kelamaan 🐢</div>
                    <div className={`font-bold text-sm ${c.overrun_count > 0 ? "text-sky-600" : "text-slate-800"}`}>{c.overrun_count}</div>
                  </div>
                </div>
                {flashRatio >= 0.4 && (
                  <div className="text-xs text-amber-700 mt-2">
                    💡 Cukup sering selesai sangat cepat. Mungkin bagus diobrolkan santai — apa misinya terlalu mudah,
                    atau ada yang perlu dibantu?
                  </div>
                )}
                {c.overrun_count > 0 && flashRatio < 0.4 && (
                  <div className="text-xs text-sky-700 mt-2">
                    💡 Ada beberapa misi yang jauh lebih lama dari perkiraan. Mungkin durasinya perlu disesuaikan.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
