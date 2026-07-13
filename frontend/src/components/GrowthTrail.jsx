import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, Trophy, Camera, TrendingUp, Download, Share2 } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

const TYPE_META = {
  badge: { icon: Trophy, color: "#F59E0B", bg: "#FEF3C7" },
  photo: { icon: Camera, color: "#8B5CF6", bg: "#EDE9FE" },
  milestone: { icon: TrendingUp, color: "#10B981", bg: "#D1FAE5" },
};

function fmtDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "";
  }
}

/** Draws the growth trail as a shareable PNG using canvas — no extra library needed. */
function drawTrailImage(child, events) {
  const W = 800;
  const rowH = 100;
  const H = 160 + Math.min(events.length, 15) * rowH + 40;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#FFF7ED");
  bg.addColorStop(1, "#FFFFFF");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#1E293B";
  ctx.font = "bold 30px sans-serif";
  ctx.fillText(`🌱 Jejak Tumbuh ${child.name}`, 32, 55);
  ctx.font = "14px sans-serif";
  ctx.fillStyle = "#94A3B8";
  ctx.fillText("Kenang-kenangan perjalanan misi & pencapaian", 32, 80);

  let y = 130;
  events.slice(0, 15).forEach((e) => {
    ctx.fillStyle = "#FFFFFF";
    ctx.strokeStyle = "#F1F5F9";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(32, y, W - 64, rowH - 16, 14) : ctx.rect(32, y, W - 64, rowH - 16);
    ctx.fill();
    ctx.stroke();

    const meta = TYPE_META[e.type] || TYPE_META.milestone;
    ctx.fillStyle = meta.bg;
    ctx.beginPath();
    ctx.arc(70, y + (rowH - 16) / 2, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = meta.color;
    ctx.font = "bold 18px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(e.type === "badge" ? "🏆" : e.type === "photo" ? "📷" : "⭐", 70, y + (rowH - 16) / 2 + 6);
    ctx.textAlign = "left";

    ctx.fillStyle = "#1E293B";
    ctx.font = "bold 16px sans-serif";
    ctx.fillText(e.title.slice(0, 45), 110, y + 32);
    ctx.fillStyle = "#64748B";
    ctx.font = "13px sans-serif";
    ctx.fillText(`${e.detail || ""}  ·  ${fmtDate(e.date)}`, 110, y + 54);

    y += rowH;
  });

  ctx.fillStyle = "#CBD5E1";
  ctx.font = "12px sans-serif";
  ctx.fillText("Dibuat dengan My Lil Famz 🚀", 32, H - 14);

  return canvas;
}

export default function GrowthTrail({ childId, childName }) {
  const [trail, setTrail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!childId) return;
    setLoading(true);
    api.get(`/children/${childId}/growth-trail`)
      .then(({ data }) => setTrail(data))
      .catch((e) => toast.error(formatApiError(e)))
      .finally(() => setLoading(false));
  }, [childId]);

  const handleExport = async () => {
    if (!trail) return;
    setExporting(true);
    try {
      const canvas = drawTrailImage(trail.child, trail.events);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Gagal membuat gambar");
      const file = new File([blob], `jejak-tumbuh-${trail.child.name}.png`, { type: "image/png" });

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `Jejak Tumbuh ${trail.child.name}` });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
        toast.success("Gambar diunduh!");
      }
    } catch (e) {
      if (e?.name !== "AbortError") toast.error("Gagal membuat/membagikan gambar");
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <div className="text-center text-slate-400 py-6 text-sm">Memuat jejak tumbuh…</div>;
  if (!trail) return null;

  return (
    <div className="bg-white rounded-3xl p-5 border-2 border-slate-100 chunky-shadow">
      <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
        <h3 className="font-fun font-bold text-lg text-slate-900 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-amber-500" /> Jejak Tumbuh {childName || trail.child.name}
        </h3>
        <button
          onClick={handleExport}
          disabled={exporting || trail.events.length === 0}
          className="press-btn inline-flex items-center gap-1.5 bg-white border-2 border-amber-200 text-amber-600 hover:bg-amber-50 font-semibold px-3 py-1.5 rounded-xl text-xs disabled:opacity-50"
        >
          {navigator.share ? <Share2 className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
          {exporting ? "Membuat…" : navigator.share ? "Bagikan" : "Unduh"}
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-4">Lencana, misi berfoto, dan pencapaian — otomatis terkumpul di sini.</p>

      {trail.events.length === 0 ? (
        <div className="text-center text-slate-400 py-8 text-sm">Belum ada momen tercatat. Selesaikan misi untuk mulai mengisi jejak tumbuh!</div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {trail.events.map((e, i) => {
            const meta = TYPE_META[e.type] || TYPE_META.milestone;
            const Icon = meta.icon;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.5) }}
                className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-100"
              >
                {e.image ? (
                  <img src={e.image} alt={e.title} className="w-11 h-11 rounded-lg object-cover shrink-0 border border-slate-200" />
                ) : (
                  <div className="w-11 h-11 rounded-lg flex items-center justify-center shrink-0" style={{ background: meta.bg }}>
                    <Icon className="w-5 h-5" style={{ color: meta.color }} />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-800 truncate">{e.title}</div>
                  <div className="text-xs text-slate-400">{e.detail} {e.detail && e.date ? "·" : ""} {fmtDate(e.date)}</div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
