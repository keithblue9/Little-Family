import { useEffect, useState } from "react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

/**
 * How the family handles a tick that wasn't really done. The ladder itself
 * is fixed (fair and predictable for the child); these numbers tune it.
 */
export default function HonestyConfig() {
  const [f, setF] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/config").then(({ data }) => setF({
      honesty_bonus_points: data.honesty_bonus_points ?? 2,
      spot_checks_enabled: data.spot_checks_enabled ?? true,
      probation_days: data.probation_days ?? 3,
      strike_window_days: data.strike_window_days ?? 14,
    })).catch((e) => toast.error(formatApiError(e)));
  }, []);

  if (!f) return <div className="text-sm text-slate-400">Memuat…</div>;

  const num = (k, lo, hi) => (e) => {
    const n = parseInt(e.target.value.replace(/\D/g, "") || "0", 10);
    setF({ ...f, [k]: Math.min(hi, Math.max(lo, n)) });
  };
  const save = async () => {
    setSaving(true);
    try {
      await api.post("/config", f);
      toast.success("Pengaturan kejujuran tersimpan");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };
  const field = "w-16 px-2 py-1.5 rounded-lg border-2 border-slate-200 text-sm text-center";

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-parent font-bold text-lg text-slate-900">🤝 Kejujuran</h3>
        <p className="text-sm text-slate-500">
          Kalau misi dicentang tapi ternyata tidak dikerjakan, tekan <b>Tidak dikerjakan</b> di Monitor atau Beranda.
        </p>
      </div>
      <ol className="text-xs text-slate-600 space-y-1.5 bg-slate-50 rounded-xl p-3 list-decimal list-inside">
        <li><b>Koreksi pertama:</b> poin misi ditarik + minus sebesar poinnya. Misi harus dibetulkan; kalau sudah, minusnya dikembalikan.</li>
        <li><b>Koreksi kedua:</b> seperti di atas + 1 Kartu Hukuman + masa pengawasan (setiap bagian dicek orang tua dulu).</li>
        <li><b>Koreksi ketiga:</b> kartu langsung penuh → hukuman keluarga berlaku.</li>
        <li>Hitungan koreksi kembali bersih setelah {f.strike_window_days} hari tanpa koreksi. Setiap koreksi anak diminta menulis refleksi.</li>
        <li>Anak yang <b>mengaku sendiri</b> ("Ternyata belum") tidak kena minus apa pun.</li>
      </ol>
      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        <label className="flex items-center justify-between gap-2 bg-white border border-slate-100 rounded-xl px-3 py-2">
          <span>Bonus jujur saat cek kejutan</span>
          <span><input value={f.honesty_bonus_points} onChange={num("honesty_bonus_points", 0, 100)} inputMode="numeric" className={field} /> poin</span>
        </label>
        <label className="flex items-center justify-between gap-2 bg-white border border-slate-100 rounded-xl px-3 py-2">
          <span>Lama masa pengawasan</span>
          <span><input value={f.probation_days} onChange={num("probation_days", 1, 14)} inputMode="numeric" className={field} /> hari</span>
        </label>
        <label className="flex items-center justify-between gap-2 bg-white border border-slate-100 rounded-xl px-3 py-2">
          <span>Koreksi dihitung selama</span>
          <span><input value={f.strike_window_days} onChange={num("strike_window_days", 1, 60)} inputMode="numeric" className={field} /> hari</span>
        </label>
        <label className="flex items-center justify-between gap-2 bg-white border border-slate-100 rounded-xl px-3 py-2 cursor-pointer">
          <span>Cek kejutan (minta foto acak)</span>
          <input type="checkbox" checked={f.spot_checks_enabled} onChange={(e) => setF({ ...f, spot_checks_enabled: e.target.checked })} className="w-5 h-5" />
        </label>
      </div>
      <p className="text-[11px] text-slate-400">
        Cek kejutan makin jarang kalau kepercayaan anak tinggi, dan muncul di setiap bagian selama masa pengawasan.
      </p>
      <button onClick={save} disabled={saving}
        className="press-btn bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4 py-2 rounded-xl text-sm disabled:opacity-50">
        {saving ? "Menyimpan…" : "Simpan"}
      </button>
    </div>
  );
}
