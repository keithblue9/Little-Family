import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Banknote, Coins, ArrowRight, Clock, CheckCircle2, XCircle, Bird, Pencil } from "lucide-react";
import api, { formatApiError } from "@/lib/api";

const fmtRp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

export default function MoneyExchange({ childId, points, child, onChanged }) {
  const [rate, setRate] = useState(100);
  const [amount, setAmount] = useState("");
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  // Savings goal (BusyKid-inspired)
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalName, setGoalName] = useState("");
  const [goalAmount, setGoalAmount] = useState("");
  const [savingGoal, setSavingGoal] = useState(false);

  const currentGoalName = child?.savings_goal_name || "";
  const currentGoalAmount = child?.savings_goal_amount || 0;
  const walletRupiah = (points || 0) * rate;
  const goalPercent = currentGoalAmount > 0 ? Math.min(100, Math.round((walletRupiah / currentGoalAmount) * 100)) : 0;

  const saveGoal = async () => {
    const amt = parseInt(goalAmount || "0", 10);
    if (!goalName.trim()) return toast.error("Tulis nama tujuan tabunganmu ya");
    if (!amt || amt < 1) return toast.error("Masukkan target rupiah yang valid");
    setSavingGoal(true);
    try {
      await api.patch("/me/profile", { savings_goal_name: goalName.trim(), savings_goal_amount: amt });
      toast.success("Target tabungan disimpan! Semangat menabung 🐔");
      setEditingGoal(false);
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSavingGoal(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const [cfg, hist] = await Promise.all([
        api.get("/config"),
        api.get("/money-redemptions", { params: { child_id: childId } }),
      ]);
      setRate(cfg.data.rupiah_per_point || 100);
      setHistory(hist.data);
    } catch (e) {
      console.error(e);
    }
  }, [childId]);

  useEffect(() => {
    load();
  }, [load]);

  const pts = parseInt(amount || "0", 10);
  const rupiah = pts * rate;

  const redeem = async () => {
    if (!pts || pts < 1) {
      toast.error("Masukkan jumlah poin yang mau ditukar");
      return;
    }
    if (pts > points) {
      toast.error("Poin kamu tidak cukup 😅");
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post("/points/redeem-money", { child_id: childId, points: pts });
      toast.success(`Berhasil! ${pts} poin → ${fmtRp(data.rupiah)} 🎉 Tunggu dibayar Abi/Ummi ya`);
      setAmount("");
      load();
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const statusBadge = (s) => {
    if (s === "paid")
      return (
        <span className="inline-flex items-center gap-1 text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded-full">
          <CheckCircle2 className="w-3 h-3" /> Dibayar
        </span>
      );
    if (s === "cancelled")
      return (
        <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
          <XCircle className="w-3 h-3" /> Dibatalkan
        </span>
      );
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-full">
        <Clock className="w-3 h-3" /> Menunggu
      </span>
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-fun font-bold text-xl text-slate-900 flex items-center gap-2">
          <Banknote className="w-6 h-6 text-green-500" /> Tukar Poin Jadi Uang
        </h3>
        <p className="text-sm text-slate-500 mt-1">
          Kurs saat ini: <span className="font-bold text-green-600">1 poin = {fmtRp(rate)}</span>
        </p>
      </div>

      {/* Savings goal (BusyKid-inspired) */}
      <div className="bg-gradient-to-br from-pink-50 to-rose-50 border-2 border-pink-100 rounded-3xl p-5">
        <div className="flex items-center justify-between gap-2 mb-1">
          <h4 className="font-fun font-bold text-slate-900 flex items-center gap-2">
            <Bird className="w-5 h-5 text-amber-500" /> Target Tabunganku
          </h4>
          <button
            onClick={() => {
              setGoalName(currentGoalName);
              setGoalAmount(currentGoalAmount ? String(currentGoalAmount) : "");
              setEditingGoal(!editingGoal);
            }}
            className="press-btn text-pink-500 hover:text-pink-600 p-1.5 rounded-lg hover:bg-pink-100"
            title={currentGoalAmount ? "Ubah target" : "Buat target"}
          >
            <Pencil className="w-4 h-4" />
          </button>
        </div>

        {editingGoal ? (
          <div className="space-y-2 mt-2">
            <input
              value={goalName}
              onChange={(e) => setGoalName(e.target.value.slice(0, 60))}
              placeholder="Mau nabung untuk apa? mis. Sepeda baru"
              className="w-full px-3 py-2 rounded-xl border-2 border-pink-200 focus:border-pink-400 focus:outline-none text-sm"
            />
            <div className="flex gap-2">
              <input
                inputMode="numeric"
                value={goalAmount}
                onChange={(e) => setGoalAmount(e.target.value.replace(/\D/g, "").slice(0, 9))}
                placeholder="Target rupiah, mis. 500000"
                className="flex-1 px-3 py-2 rounded-xl border-2 border-pink-200 focus:border-pink-400 focus:outline-none text-sm"
              />
              <button
                onClick={saveGoal}
                disabled={savingGoal}
                className="press-btn bg-pink-500 hover:bg-pink-600 text-white font-fun font-bold px-4 py-2 rounded-xl text-sm disabled:opacity-50"
              >
                {savingGoal ? "…" : "Simpan"}
              </button>
            </div>
          </div>
        ) : currentGoalAmount > 0 ? (
          <div className="mt-1">
            <div className="flex items-baseline justify-between gap-2">
              <div className="font-fun font-bold text-slate-800">🎯 {currentGoalName}</div>
              <div className="text-xs font-bold text-pink-600">{goalPercent}%</div>
            </div>
            <div className="h-3 bg-white rounded-full overflow-hidden border border-pink-100 mt-1.5">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${goalPercent}%` }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="h-full rounded-full bg-gradient-to-r from-pink-400 to-rose-500"
              />
            </div>
            <div className="text-xs text-slate-500 mt-1.5">
              Nilai poinmu sekarang <span className="font-bold text-slate-700">{fmtRp(walletRupiah)}</span> dari target{" "}
              <span className="font-bold text-slate-700">{fmtRp(currentGoalAmount)}</span>
              {goalPercent >= 100 && " — Tercapai! 🎉"}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Belum ada target. Yuk tentukan mau nabung untuk apa — nanti kelihatan progresnya di sini! 🐔
          </p>
        )}
      </div>

      {/* Converter card */}
      <div className="bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-100 rounded-3xl p-5">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Poin</label>
            <div className="flex items-center gap-2 bg-white rounded-2xl border-2 border-green-200 px-3 py-2 mt-1">
              <Coins className="w-5 h-5 text-amber-500 shrink-0" />
              <input
                type="text"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="0"
                className="w-full font-fun font-bold text-2xl text-slate-900 outline-none bg-transparent"
              />
            </div>
          </div>
          <ArrowRight className="w-6 h-6 text-green-400 mt-5 shrink-0" />
          <div className="flex-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Rupiah</label>
            <div className="bg-white rounded-2xl border-2 border-green-200 px-3 py-2 mt-1">
              <div className="font-fun font-bold text-2xl text-green-600 truncate">{fmtRp(rupiah)}</div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between mt-4">
          <div className="text-sm text-slate-500">
            Poinmu: <span className="font-bold text-slate-700">{points} ⭐</span>
          </div>
          <button
            onClick={redeem}
            disabled={loading || !pts}
            className="press-btn chunky-shadow bg-green-500 hover:bg-green-600 text-white font-fun font-bold px-6 py-2.5 rounded-2xl disabled:opacity-40"
          >
            {loading ? "Memproses…" : "Tukar! 💰"}
          </button>
        </div>
      </div>

      {/* History */}
      <div>
        <h4 className="font-fun font-bold text-slate-700 mb-2">Riwayat Penukaran</h4>
        {history.length === 0 ? (
          <div className="text-center text-sm text-slate-400 bg-slate-50 rounded-2xl py-6">
            Belum ada penukaran. Kumpulkan poin dan tukar jadi uang! 🤑
          </div>
        ) : (
          <div className="space-y-2">
            {history.map((h) => (
              <motion.div
                key={h.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-between bg-white border-2 border-slate-100 rounded-2xl px-4 py-3"
              >
                <div>
                  <div className="font-fun font-bold text-slate-800">
                    {h.points} poin → {fmtRp(h.rupiah)}
                  </div>
                  <div className="text-xs text-slate-400">
                    {new Date(h.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                  </div>
                </div>
                {statusBadge(h.status)}
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
