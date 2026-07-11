import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Lock, RefreshCw, KeyRound, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

export default function ChildPasscodeManager() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [newCode, setNewCode] = useState("");
  const [visibleId, setVisibleId] = useState(null);

  const fetchMembers = useCallback(async () => {
    try {
      const response = await api.get("/admin/members-passcodes");
      setMembers(response.data);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const handleReset = async (memberId, name) => {
    if (!window.confirm(`Reset passcode ${name} kembali ke bawaan (123456)?`)) return;
    try {
      await api.post(`/members/${memberId}/reset-passcode`);
      toast.success(`Passcode ${name} direset ke 123456`);
      fetchMembers();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const handleSetNew = async (memberId, name) => {
    if (!/^\d{6}$/.test(newCode)) {
      toast.error("Passcode harus tepat 6 digit angka");
      return;
    }
    try {
      await api.post(`/members/${memberId}/passcode`, { passcode: newCode });
      toast.success(`Passcode ${name} diperbarui`);
      setEditingId(null);
      setNewCode("");
      fetchMembers();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="font-fun font-bold text-lg text-slate-900 flex items-center gap-2">
        <Lock className="w-5 h-5 text-blue-500" />
        Passcode Keluarga
      </h3>
      <p className="text-sm text-slate-500 -mt-2">
        Setiap anggota masuk dengan passcode 6 digit. Passcode anak bisa dilihat & direset di sini.
      </p>

      {loading ? (
        <div className="text-center text-slate-400 py-8">Memuat…</div>
      ) : members.length === 0 ? (
        <div className="bg-blue-50 rounded-xl p-4 text-slate-600">Tidak ada anggota.</div>
      ) : (
        <div className="space-y-3">
          {members.map((m) => (
            <motion.div
              key={m.member_id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-xl p-4 border-2 border-slate-100"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-fun font-semibold text-slate-900">
                    {m.name}{" "}
                    <span className="text-xs font-normal text-slate-400 uppercase">
                      {m.role === "parent" ? "Orang Tua" : "Anak"}
                    </span>
                  </p>
                  <div className="text-sm mt-1 flex items-center gap-2 flex-wrap">
                    {m.is_default ? (
                      <span className="text-amber-600 font-semibold">Masih passcode bawaan (123456)</span>
                    ) : (
                      <span className="text-green-600 font-semibold">Passcode sudah diganti</span>
                    )}
                    {m.role === "child" && m.passcode_plain && (
                      <span className="inline-flex items-center gap-1.5 bg-slate-100 rounded-lg px-2 py-0.5 font-mono text-slate-700">
                        {visibleId === m.member_id ? m.passcode_plain : "••••••"}
                        <button
                          onClick={() => setVisibleId(visibleId === m.member_id ? null : m.member_id)}
                          className="text-slate-400 hover:text-slate-600"
                          title={visibleId === m.member_id ? "Sembunyikan" : "Lihat passcode"}
                        >
                          {visibleId === m.member_id ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => {
                      setEditingId(editingId === m.member_id ? null : m.member_id);
                      setNewCode("");
                    }}
                    className="p-2 hover:bg-blue-100 text-blue-600 rounded-lg transition-colors"
                    title="Setel passcode baru"
                  >
                    <KeyRound className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => handleReset(m.member_id, m.name)}
                    className="p-2 hover:bg-red-100 text-red-600 rounded-lg transition-colors"
                    title="Reset ke bawaan (123456)"
                  >
                    <RefreshCw className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {editingId === m.member_id && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="flex gap-2 mt-3 pt-3 border-t border-slate-100"
                >
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="Passcode baru (6 digit)"
                    className="flex-1 px-3 py-2 border-2 border-slate-200 rounded-lg font-mono tracking-widest focus:border-blue-500 focus:outline-none"
                  />
                  <button
                    onClick={() => handleSetNew(m.member_id, m.name)}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg font-fun font-semibold hover:bg-blue-600"
                  >
                    Simpan
                  </button>
                </motion.div>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
