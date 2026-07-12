import { motion } from "framer-motion";

const fmtRp = (n, rate) => "Rp " + (Number(n || 0) * rate).toLocaleString("id-ID");

export default function PiggyBankCard({ child, rate = 100 }) {
  const save = child?.piggy_save || 0;
  const spend = child?.piggy_spend || 0;
  const share = child?.piggy_share || 0;
  const total = save + spend + share || 1;

  const banks = [
    { key: "save", label: "Tabungan", emoji: "🏦", color: "#3B82F6", pts: save, desc: "Untuk tujuanmu" },
    { key: "spend", label: "Belanja", emoji: "🛍️", color: "#F59E0B", pts: spend, desc: "Boleh dipakai" },
    { key: "share", label: "Sedekah", emoji: "💝", color: "#EC4899", pts: share, desc: "Berbagi kebaikan" },
  ];

  return (
    <div className="bg-white rounded-3xl border-2 border-slate-100 chunky-shadow p-4">
      <h3 className="font-fun font-bold text-lg text-slate-900 mb-3 flex items-center gap-2">
        🐷 Tiga Celenganku
      </h3>

      <div className="grid grid-cols-3 gap-2 mb-3">
        {banks.map((b) => (
          <motion.div
            key={b.key}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-center rounded-2xl p-3 border-2"
            style={{ borderColor: b.color + "40", background: b.color + "10" }}
          >
            <div className="text-2xl mb-1">{b.emoji}</div>
            <div className="font-fun font-bold text-xs" style={{ color: b.color }}>{b.label}</div>
            <div className="font-fun font-bold text-lg text-slate-900">{b.pts}</div>
            <div className="text-[10px] text-slate-500">{fmtRp(b.pts, rate)}</div>
          </motion.div>
        ))}
      </div>

      {/* Visual split bar */}
      <div className="h-3 rounded-full overflow-hidden flex bg-slate-100">
        {banks.map((b) => (
          <motion.div
            key={b.key}
            initial={{ width: 0 }}
            animate={{ width: `${(b.pts / total) * 100}%` }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="h-full"
            style={{ background: b.color }}
            title={`${b.label}: ${b.pts} poin`}
          />
        ))}
      </div>
      <div className="flex justify-between mt-1 text-[10px] text-slate-400">
        <span>Tabungan</span>
        <span>Belanja</span>
        <span>Sedekah</span>
      </div>
    </div>
  );
}
