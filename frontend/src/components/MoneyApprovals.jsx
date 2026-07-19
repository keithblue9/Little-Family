import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Banknote, CheckCircle2, XCircle, Settings2 } from "lucide-react";
import api, { formatApiError } from "@/lib/api";

const fmtRp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

export default function MoneyApprovals() {
  const [items, setItems] = useState([]);
  const [rate, setRate] = useState("");
  const [skipCost, setSkipCost] = useState("");
  const [earlyBonus, setEarlyBonus] = useState("");
  const [freezePerWeek, setFreezePerWeek] = useState("");
  const [freezeResetDay, setFreezeResetDay] = useState("0");
  const [savingCfg, setSavingCfg] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [red, cfg] = await Promise.all([
        api.get("/money-redemptions"),
        api.get("/config"),
      ]);
      setItems(red.data);
      setRate(String(cfg.data.rupiah_per_point ?? 100));
      setSkipCost(String(cfg.data.skip_cost_points ?? 20));
      setEarlyBonus(String(cfg.data.early_bonus_pct ?? 10));
      setFreezePerWeek(String(cfg.data.freeze_cards_per_week ?? 3));
      setFreezeResetDay(String(cfg.data.freeze_reset_weekday ?? 0));
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveConfig = async () => {
    const r = parseInt(rate || "0", 10);
    const s = parseInt(skipCost || "0", 10);
    const eb = parseInt(earlyBonus || "0", 10);
    const fpw = parseInt(freezePerWeek || "0", 10);
    const frd = parseInt(freezeResetDay || "0", 10);
    if (r < 1) { toast.error("Kurs minimal Rp 1 per poin"); return; }
    if (eb < 0 || eb > 100) { toast.error("Bonus cepat harus 0–100%"); return; }
    if (fpw < 0 || fpw > 7) { toast.error("Kartu Bebas per minggu harus 0–7"); return; }
    setSavingCfg(true);
    try {
      await api.post("/config", {
        rupiah_per_point: r, skip_cost_points: s,
        early_bonus_pct: eb, freeze_cards_per_week: fpw, freeze_reset_weekday: frd,
      });
      toast.success("Pengaturan tersimpan");
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSavingCfg(false);
    }
  };

  const pay = async (item) => {
    if (!window.confirm(`Tandai sudah dibayar ${fmtRp(item.rupiah)} ke ${item.child_name}?`)) return;
    try {
      await api.post(`/money-redemptions/${item.id}/pay`);
      toast.success(`Pembayaran ${fmtRp(item.rupiah)} dicatat ✅`);
      load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const cancel = async (item) => {
    if (!window.confirm(`Batalkan penukaran ini? ${item.points} poin akan dikembalikan ke ${item.child_name}.`)) return;
    try {
      await api.post(`/money-redemptions/${item.id}/cancel`);
      toast.success("Dibatalkan, poin dikembalikan");
      load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const pending = items.filter((i) => i.status === "pending");
  const done = items.filter((i) => i.status !== "pending").slice(0, 10);

  return (
    <div className="space-y-6">
      {/* Config */}
      <div>
        <h3 className="font-parent font-bold text-lg text-slate-900 flex items-center gap-2 mb-1">
          <Settings2 className="w-5 h-5 text-indigo-500" /> Pengaturan Poin & Uang
        </h3>
        <p className="text-sm text-slate-500 mb-4">
          Atur nilai tukar poin ke rupiah, biaya melewati misi, bonus selesai cepat, dan jatah Kartu Bebas.
        </p>
        <div className="grid sm:grid-cols-2 gap-4 max-w-lg">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">1 poin = berapa rupiah?</label>
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-sm font-semibold">Rp</span>
              <input
                type="text" inputMode="numeric" value={rate}
                onChange={(e) => setRate(e.target.value.replace(/\D/g, "").slice(0, 7))}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Biaya lewati misi (poin)</label>
            <input
              type="text" inputMode="numeric" value={skipCost}
              onChange={(e) => setSkipCost(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Bonus selesai lebih cepat (%)</label>
            <input
              type="text" inputMode="numeric" value={earlyBonus}
              onChange={(e) => setEarlyBonus(e.target.value.replace(/\D/g, "").slice(0, 3))}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 focus:outline-none"
            />
            <p className="text-[11px] text-slate-400 mt-1">Ekstra poin jika misi selesai sebelum jam-nya. 0 = mati.</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Kartu Bebas per minggu</label>
            <input
              type="text" inputMode="numeric" value={freezePerWeek}
              onChange={(e) => setFreezePerWeek(e.target.value.replace(/\D/g, "").slice(0, 1))}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 focus:outline-none"
            />
            <p className="text-[11px] text-slate-400 mt-1">Jatah untuk menyelamatkan misi macet (0–7).</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Hari reset Kartu Bebas</label>
            <select
              value={freezeResetDay}
              onChange={(e) => setFreezeResetDay(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 focus:outline-none bg-white"
            >
              <option value="0">Senin</option>
              <option value="1">Selasa</option>
              <option value="2">Rabu</option>
              <option value="3">Kamis</option>
              <option value="4">Jumat</option>
              <option value="5">Sabtu</option>
              <option value="6">Minggu</option>
            </select>
            <p className="text-[11px] text-slate-400 mt-1">Jatah kembali penuh tiap hari ini.</p>
          </div>
        </div>
        <button
          onClick={saveConfig}
          disabled={savingCfg}
          className="mt-3 inline-flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 text-white font-semibold px-4 py-2.5 rounded-xl disabled:opacity-50"
        >
          {savingCfg ? "Menyimpan…" : "Simpan Pengaturan"}
        </button>
      </div>

      {/* Pending payouts */}
      <div className="border-t border-slate-100 pt-5">
        <h3 className="font-parent font-bold text-lg text-slate-900 flex items-center gap-2 mb-3">
          <Banknote className="w-5 h-5 text-green-500" /> Permintaan Pencairan
          {pending.length > 0 && (
            <span className="text-xs font-bold bg-red-100 text-red-600 px-2 py-0.5 rounded-full">{pending.length}</span>
          )}
        </h3>

        {loading ? (
          <div className="text-slate-400 text-sm">Memuat…</div>
        ) : pending.length === 0 ? (
          <div className="text-sm text-slate-400 bg-slate-50 rounded-xl py-5 text-center">
            Tidak ada permintaan pencairan. 👍
          </div>
        ) : (
          <div className="space-y-2">
            {pending.map((i) => (
              <motion.div
                key={i.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3"
              >
                <div className="flex-1">
                  <div className="font-semibold text-slate-900">
                    {i.child_name}: {i.points} poin → <span className="text-green-700">{fmtRp(i.rupiah)}</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    Kurs {fmtRp(i.rate)}/poin · {new Date(i.created_at).toLocaleDateString("id-ID")}
                  </div>
                </div>
                <button
                  onClick={() => pay(i)}
                  className="inline-flex items-center gap-1 bg-green-500 hover:bg-green-600 text-white font-semibold px-3 py-2 rounded-xl text-sm"
                >
                  <CheckCircle2 className="w-4 h-4" /> Sudah Dibayar
                </button>
                <button
                  onClick={() => cancel(i)}
                  className="inline-flex items-center gap-1 bg-white border border-red-200 hover:bg-red-50 text-red-600 font-semibold px-3 py-2 rounded-xl text-sm"
                >
                  <XCircle className="w-4 h-4" /> Batal
                </button>
              </motion.div>
            ))}
          </div>
        )}

        {done.length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-bold uppercase text-slate-400 mb-2">Riwayat</div>
            <div className="space-y-1.5">
              {done.map((i) => (
                <div key={i.id} className="flex items-center justify-between text-sm bg-white border border-slate-100 rounded-lg px-3 py-2">
                  <span className="text-slate-600">
                    {i.child_name} · {i.points} poin → {fmtRp(i.rupiah)}
                  </span>
                  <span className={`text-xs font-bold ${i.status === "paid" ? "text-green-600" : "text-slate-400"}`}>
                    {i.status === "paid" ? "Dibayar" : "Dibatalkan"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
