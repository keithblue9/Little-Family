import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Confetti from "react-confetti";
import { X, Share2, Download, Sparkles } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { todayKey, humanDateKey } from "@/lib/dates";

function drawRecapImage(child, progress) {
  const W = 640;
  const H = 500;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#FF9D23");
  bg.addColorStop(1, "#FF6B00");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "center";
  ctx.font = "bold 26px sans-serif";
  ctx.fillText("Hari Ini Kamu...", W / 2, 70);
  ctx.font = "18px sans-serif";
  ctx.globalAlpha = 0.85;
  ctx.fillText(humanDateKey(todayKey()), W / 2, 100);
  ctx.globalAlpha = 1;

  const stats = [
    { label: "Misi Selesai", value: `${progress.required_done}/${progress.required_count}` },
    { label: "Poin Terkumpul", value: `${progress.total_earned}` },
    { label: "Streak Saat Ini", value: `${child.streak_days || 0} hari` },
  ];
  let y = 180;
  stats.forEach((s) => {
    ctx.font = "bold 48px sans-serif";
    ctx.fillText(s.value, W / 2, y);
    ctx.font = "16px sans-serif";
    ctx.globalAlpha = 0.85;
    ctx.fillText(s.label, W / 2, y + 30);
    ctx.globalAlpha = 1;
    y += 100;
  });

  ctx.font = "14px sans-serif";
  ctx.globalAlpha = 0.7;
  ctx.fillText("Dibuat dengan My Lil Famz 🚀", W / 2, H - 20);

  return canvas;
}

export default function DailyRecapCard({ childId, child, onClose }) {
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dims] = useState({ w: window.innerWidth, h: window.innerHeight });

  useEffect(() => {
    if (!childId) return;
    api.get(`/children/${childId}/day-progress`, { params: { date_key: todayKey() } })
      .then(({ data }) => setProgress(data))
      .catch((e) => toast.error(formatApiError(e)))
      .finally(() => setLoading(false));
  }, [childId]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const canvas = drawRecapImage(child, progress);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Gagal membuat gambar");
      const file = new File([blob], `rekap-${child.name}-${todayKey()}.png`, { type: "image/png" });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Rekap Hariku" });
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

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center">
        <div className="text-white text-sm">Menyiapkan rekap…</div>
      </div>
    );
  }
  if (!progress) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={onClose}
      >
        <Confetti width={dims.w} height={dims.h} numberOfPieces={150} recycle={false} gravity={0.2} />
        <motion.div
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-gradient-to-br from-[#FF9D23] to-[#FF6B00] rounded-3xl p-6 text-white text-center chunky-shadow-lg max-w-sm w-full relative"
        >
          <button onClick={onClose} className="absolute top-3 right-3 p-1.5 rounded-full hover:bg-white/20">
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center justify-center gap-2 mb-1">
            <Sparkles className="w-5 h-5" />
            <span className="font-fun font-bold text-xl">Hari Ini Kamu...</span>
          </div>
          <div className="text-sm text-white/80 mb-5">{humanDateKey(todayKey())}</div>

          <div className="space-y-3 mb-5">
            <div className="bg-white/15 rounded-2xl py-3">
              <div className="font-fun font-bold text-4xl">{progress.required_done}/{progress.required_count}</div>
              <div className="text-xs text-white/80">Misi Selesai</div>
            </div>
            <div className="bg-white/15 rounded-2xl py-3">
              <div className="font-fun font-bold text-4xl">{progress.total_earned}</div>
              <div className="text-xs text-white/80">Poin Terkumpul</div>
            </div>
            <div className="bg-white/15 rounded-2xl py-3">
              <div className="font-fun font-bold text-4xl">{child.streak_days || 0} 🔥</div>
              <div className="text-xs text-white/80">Streak Saat Ini</div>
            </div>
          </div>

          <button
            onClick={handleExport}
            disabled={exporting}
            className="press-btn inline-flex items-center gap-1.5 bg-white text-orange-600 font-fun font-bold px-5 py-2.5 rounded-2xl disabled:opacity-60"
          >
            {navigator.share ? <Share2 className="w-4 h-4" /> : <Download className="w-4 h-4" />}
            {exporting ? "Membuat…" : navigator.share ? "Bagikan" : "Unduh"}
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
