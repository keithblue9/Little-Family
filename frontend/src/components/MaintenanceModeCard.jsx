import { useEffect, useState } from "react";
import { PowerOff, Power, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

/**
 * Lets a parent temporarily pause the whole app for everyone EXCEPT
 * themselves — the account that flips this switch is the one that stays
 * exempt (not a fixed name), so it works correctly regardless of which
 * parent is doing the toggling.
 */
export default function MaintenanceModeCard() {
  const [state, setState] = useState(null); // { maintenance_mode, maintenance_message, maintenance_enabled_by_name, maintenance_enabled_at }
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get("/config");
      setState(data);
      setMessage(data.maintenance_message || "");
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };
  useEffect(() => { load(); }, []);

  if (!state) return <div className="text-sm text-slate-400">Memuat…</div>;

  const isOn = !!state.maintenance_mode;

  const turnOn = async () => {
    if (!window.confirm(
      "Nonaktifkan sementara aplikasi untuk semua orang KECUALI akunmu sendiri?\n\n" +
      "Pasangan dan anak-anak tidak akan bisa masuk atau memakai app sampai kamu nyalakan lagi. Lanjutkan?"
    )) return;
    setSaving(true);
    try {
      await api.post("/maintenance/toggle", { enabled: true, message });
      toast.success("Aplikasi dinonaktifkan sementara untuk yang lain");
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const turnOff = async () => {
    setSaving(true);
    try {
      await api.post("/maintenance/toggle", { enabled: false });
      toast.success("Aplikasi aktif kembali untuk semua orang");
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h3 className="font-parent font-bold text-lg text-slate-900 mb-1 flex items-center gap-2">
        {isOn ? <PowerOff className="w-5 h-5 text-red-500" /> : <Power className="w-5 h-5 text-slate-400" />}
        Nonaktifkan Sementara
      </h3>
      <p className="text-sm text-slate-500 mb-4">
        Kalau dinyalakan, semua orang <b>kecuali akun yang menyalakannya</b> (pasangan & anak-anak) tidak bisa masuk atau
        memakai app sampai dimatikan lagi. Cocok untuk situasi darurat atau jeda sementara.
      </p>

      {isOn ? (
        <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 text-red-700 font-bold mb-1">
            <AlertTriangle className="w-4 h-4" /> Sedang Nonaktif
          </div>
          <p className="text-sm text-red-700 mb-1">
            Dinyalakan oleh <b>{state.maintenance_enabled_by_name || "seseorang"}</b>
            {state.maintenance_enabled_at ? ` pada ${new Date(state.maintenance_enabled_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}` : ""}.
          </p>
          {state.maintenance_message && (
            <p className="text-sm text-red-600 italic mb-3">Pesan: "{state.maintenance_message}"</p>
          )}
          <button
            onClick={turnOff}
            disabled={saving}
            className="press-btn inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-4 py-2 rounded-xl text-sm disabled:opacity-60"
          >
            <Power className="w-4 h-4" /> {saving ? "Memproses…" : "Aktifkan Kembali"}
          </button>
        </div>
      ) : (
        <div className="bg-slate-50 border-2 border-slate-200 rounded-2xl p-4">
          <label className="text-xs font-bold text-slate-500 mb-1 block">Pesan untuk yang diblokir (opsional)</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, 300))}
            rows={2}
            placeholder="Misal: Lagi maintenance, coba lagi nanti ya!"
            className="w-full px-3 py-2 rounded-xl border-2 border-slate-200 text-sm mb-3"
          />
          <button
            onClick={turnOn}
            disabled={saving}
            className="press-btn inline-flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white font-semibold px-4 py-2 rounded-xl text-sm disabled:opacity-60"
          >
            <PowerOff className="w-4 h-4" /> {saving ? "Memproses…" : "Nonaktifkan Sekarang"}
          </button>
        </div>
      )}
    </div>
  );
}
