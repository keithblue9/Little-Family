import { useEffect, useState } from "react";
import api from "@/lib/api";
import { trustTone } from "@/lib/honesty";

/** A gentle week in review per child: trust, owning up, checks, corrections. */
export default function HonestyWeeklyCard() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get("/family/honesty-weekly").then((r) => setData(r.data)).catch(() => setData({ children: [] })); }, []);
  if (!data) return null;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <h3 className="font-parent font-bold text-lg text-slate-900">🤝 Rekap kejujuran 7 hari</h3>
      <p className="text-xs text-slate-500 mb-4">Untuk bahan ngobrol santai — bukan untuk menghakimi.</p>
      {data.children.length === 0 ? <div className="text-sm text-slate-400">Belum ada data.</div> : (
        <div className="grid sm:grid-cols-2 gap-3">
          {data.children.map((c) => {
            const diff = c.trust_now - c.trust_week_ago;
            const tone = trustTone(c.trust_now);
            return (
              <div key={c.child_id} className="rounded-xl border border-slate-100 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{c.avatar_emoji || "🙂"}</span>
                  <span className="font-semibold text-slate-800">{c.child_name}</span>
                  <span className={`ml-auto text-xs font-semibold rounded-full px-2 py-0.5 ${tone.cls}`}>
                    {c.trust_now}{diff ? ` (${diff > 0 ? "+" : ""}${diff})` : ""}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-xs text-slate-600">
                  <span>✅ Tepat waktu: {c.sections_on_time}/{c.sections_finished} bagian</span>
                  <span>🙏 Jujur mengaku: {c.admits}×</span>
                  <span>📸 Cek kejutan lolos: {c.spot_passed}/{c.spot_checks}</span>
                  <span>🔁 Dikoreksi: {c.corrections}×</span>
                </div>
                <div className="text-xs text-indigo-800 bg-indigo-50 rounded-lg px-3 py-2">💡 {c.note}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
