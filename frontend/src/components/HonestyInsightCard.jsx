import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import api from "@/lib/api";

/**
 * Gentle working-pattern insight per child, from how each SECTION was worked
 * through: finished far faster than its estimate, every box ticked within a
 * few seconds, or started/finished late. Conversation starters, never
 * verdicts — a fast finish can simply mean a capable kid.
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

  const measured = data.children.filter((c) => c.sections_measured > 0);

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
        Dihitung per bagian hari (Pagi, Sore, …): berapa lama dari Mulai sampai Selesai, dan kapan tiap tugas
        dicentang. Ini bahan obrolan, bukan tuduhan.
      </p>

      {measured.length === 0 ? (
        <div className="text-sm text-slate-400 bg-slate-50 rounded-2xl p-4 text-center">
          Belum ada data. Data muncul setelah anak menyelesaikan satu bagian.
        </div>
      ) : (
        <div className="space-y-3">
          {measured.map((c) => {
            const worry = c.bursts > 0 || c.sections_rushed > 0;
            return (
              <div key={c.child_id} className={`rounded-2xl p-3 border-2 ${worry ? "border-amber-200 bg-amber-50/50" : "border-slate-100"}`}>
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-base shrink-0"
                    style={{ background: `${c.avatar_color}22` }}
                  >
                    {c.avatar_emoji || "🙂"}
                  </div>
                  <div className="font-semibold text-slate-800 text-sm">{c.child_name}</div>
                  <div className="text-xs text-slate-400 ml-auto">{c.sections_measured} bagian selesai</div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
                  <Stat label="Rata-rata asli" value={c.avg_actual_minutes != null ? `${c.avg_actual_minutes} mnt` : "—"} />
                  <Stat label="Perkiraan" value={c.avg_estimated_minutes != null ? `${c.avg_estimated_minutes} mnt` : "—"} />
                  <Stat label="Terlalu cepat ⚡" value={c.sections_rushed} warn={c.sections_rushed > 0} />
                  <Stat label="Centang serentak" value={c.bursts} warn={c.bursts > 0} />
                  <Stat label="Terlambat 🕐" value={c.late} />
                </div>
                {c.bursts > 0 && (
                  <div className="text-xs text-amber-700 mt-2">
                    💡 {c.bursts} kali semua tugas dicentang dalam beberapa detik sekaligus. Bisa jadi dicentang setelah
                    semua selesai — atau asal centang. Coba cek salah satu tugasnya dan obrolkan santai.
                  </div>
                )}
                {c.sections_rushed > 0 && (
                  <div className="text-xs text-amber-700 mt-2">
                    💡 {c.sections_rushed} bagian selesai jauh lebih cepat dari perkiraan (kurang dari seperempatnya).
                    Mungkin perkiraannya terlalu panjang, atau ada yang terlewat.
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

function Stat({ label, value, warn }) {
  return (
    <div className="bg-white rounded-xl py-2 border border-slate-100">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className={`font-bold text-sm ${warn ? "text-amber-600" : "text-slate-800"}`}>{value}</div>
    </div>
  );
}
