import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BarChart3, TrendingUp, Flame, Trophy, Share2, Download } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

const fmtRp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
const DAYS_ID = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

/** Draws the weekly report as a shareable PNG using canvas — no extra library needed. */
function drawReportImage(report) {
  const W = 900;
  const rowH = 190;
  const H = 140 + report.children.length * rowH + 40;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#EEF2FF");
  bg.addColorStop(1, "#FFFFFF");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = "#1E293B";
  ctx.font = "bold 34px sans-serif";
  ctx.fillText("📊 Laporan Mingguan Keluarga", 32, 55);
  ctx.font = "16px sans-serif";
  ctx.fillStyle = "#64748B";
  ctx.fillText(`${report.period_start} — ${report.period_end}`, 32, 85);

  let y = 130;
  report.children.forEach((entry) => {
    const c = entry.child;
    // Card background
    ctx.fillStyle = "#FFFFFF";
    ctx.strokeStyle = "#E2E8F0";
    ctx.lineWidth = 2;
    roundRect(ctx, 32, y, W - 64, rowH - 20, 16);
    ctx.fill();
    ctx.stroke();

    // Name + avatar circle
    ctx.fillStyle = c.avatar_color || "#6366F1";
    ctx.beginPath();
    ctx.arc(70, y + 40, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "24px sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.fillText(c.avatar_emoji || "🙂", 70, y + 49);
    ctx.textAlign = "left";

    ctx.fillStyle = "#1E293B";
    ctx.font = "bold 22px sans-serif";
    ctx.fillText(c.name, 110, y + 35);
    ctx.font = "14px sans-serif";
    ctx.fillStyle = "#64748B";
    ctx.fillText(`${c.mbti || ""}  ·  streak ${c.streak_days || 0} hari`, 110, y + 56);

    ctx.textAlign = "right";
    ctx.font = "bold 26px sans-serif";
    ctx.fillStyle = "#4338CA";
    ctx.fillText(`${entry.week_points} poin`, W - 56, y + 45);
    ctx.textAlign = "left";

    // Mini bar chart
    const days = Object.keys(entry.days).sort();
    const maxEarned = Math.max(1, ...days.map((dk) => entry.days[dk].earned));
    const barAreaX = 56, barAreaY = y + 90, barAreaW = W - 112, barAreaH = 60;
    const barW = barAreaW / days.length - 8;
    days.forEach((dk, i) => {
      const d = entry.days[dk];
      const h = Math.max(3, (d.earned / maxEarned) * barAreaH);
      const x = barAreaX + i * (barAreaW / days.length);
      ctx.fillStyle = d.earned > 0 ? "#6366F1" : "#E2E8F0";
      ctx.fillRect(x, barAreaY + barAreaH - h, barW, h);
      ctx.fillStyle = "#94A3B8";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      const dayName = DAYS_ID[new Date(dk + "T00:00:00").getDay()];
      ctx.fillText(dayName, x + barW / 2, barAreaY + barAreaH + 16);
      ctx.textAlign = "left";
    });

    y += rowH;
  });

  ctx.fillStyle = "#94A3B8";
  ctx.font = "13px sans-serif";
  ctx.fillText("Dibuat dengan My Lil Famz 🚀", 32, H - 14);

  return canvas;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export default function WeeklyReport() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

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

  const handleExport = async () => {
    if (!report) return;
    setExporting(true);
    try {
      const canvas = drawReportImage(report);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Gagal membuat gambar");
      const file = new File([blob], `laporan-mingguan-${report.period_end}.png`, { type: "image/png" });

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "Laporan Mingguan Keluarga",
          text: `Laporan mingguan ${report.period_start} — ${report.period_end}`,
        });
      } else {
        // Fallback: trigger a download
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
        toast.success("Gambar laporan diunduh!");
      }
    } catch (e) {
      if (e?.name !== "AbortError") toast.error("Gagal membuat/membagikan gambar laporan");
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <div className="bg-white rounded-2xl p-8 text-center text-slate-400">Memuat laporan…</div>;
  if (!report) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-indigo-500" />
          <h3 className="font-parent font-bold text-lg text-slate-900">Laporan Minggu Ini</h3>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="press-btn inline-flex items-center gap-1.5 bg-white border-2 border-indigo-200 text-indigo-600 hover:bg-indigo-50 font-semibold px-3 py-1.5 rounded-xl text-sm disabled:opacity-60"
        >
          {navigator.share ? <Share2 className="w-4 h-4" /> : <Download className="w-4 h-4" />}
          {exporting ? "Membuat…" : navigator.share ? "Bagikan" : "Unduh Gambar"}
        </button>
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

              {/* ChikyBank summary */}
              <div className="px-4 pb-4 grid grid-cols-3 gap-2 text-center">
                <div className="bg-blue-50 rounded-xl py-2"><div className="text-lg">🐔</div><div className="text-xs font-bold text-blue-600">{c.chiky_save || 0}</div><div className="text-[9px] text-slate-400">Tabungan</div></div>
                <div className="bg-amber-50 rounded-xl py-2"><div className="text-lg">🐥</div><div className="text-xs font-bold text-amber-600">{c.chiky_spend || 0}</div><div className="text-[9px] text-slate-400">Belanja</div></div>
                <div className="bg-pink-50 rounded-xl py-2"><div className="text-lg">🐣</div><div className="text-xs font-bold text-pink-600">{c.chiky_share || 0}</div><div className="text-[9px] text-slate-400">Sedekah</div></div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
