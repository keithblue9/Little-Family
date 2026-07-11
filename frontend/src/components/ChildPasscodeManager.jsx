import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Lock, RefreshCw, KeyRound } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

export default function ChildPasscodeManager() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [newCode, setNewCode] = useState("");

  useEffect(() => {
    fetchMembers();
  }, []);

  const fetchMembers = async () => {
    try {
      const response = await api.get("/admin/members-passcodes");
      setMembers(response.data);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (memberId, name) => {
    if (!window.confirm(`Reset passcode for ${name} back to the default (123456)?`)) return;
    try {
      await api.post(`/members/${memberId}/reset-passcode`);
      toast.success(`${name}'s passcode reset to default`);
      fetchMembers();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const handleSetNew = async (memberId, name) => {
    if (!/^\d{6}$/.test(newCode)) {
      toast.error("Passcode must be exactly 6 digits");
      return;
    }
    try {
      await api.post(`/members/${memberId}/passcode`, { passcode: newCode });
      toast.success(`${name}'s passcode updated`);
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
        Family Passcodes
      </h3>
      <p className="text-sm text-slate-500 -mt-2">
        Every family member signs in with their own 6-digit passcode.
      </p>

      {loading ? (
        <div className="text-center text-slate-400 py-8">Loading…</div>
      ) : members.length === 0 ? (
        <div className="bg-blue-50 rounded-xl p-4 text-slate-600">No members found.</div>
      ) : (
        <div className="space-y-3">
          {members.map((m) => (
            <motion.div
              key={m.member_id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-xl p-4 border-2 border-slate-100"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="font-fun font-semibold text-slate-900">
                    {m.name}{" "}
                    <span className="text-xs font-normal text-slate-400 uppercase">
                      {m.role}
                    </span>
                  </p>
                  <div className="text-sm mt-1">
                    {m.is_default ? (
                      <span className="text-amber-600 font-semibold">
                        Still using default passcode (123456)
                      </span>
                    ) : (
                      <span className="text-green-600 font-semibold">Custom passcode set</span>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditingId(editingId === m.member_id ? null : m.member_id);
                      setNewCode("");
                    }}
                    className="p-2 hover:bg-blue-100 text-blue-600 rounded-lg transition-colors"
                    title="Set new passcode"
                  >
                    <KeyRound className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => handleReset(m.member_id, m.name)}
                    className="p-2 hover:bg-red-100 text-red-600 rounded-lg transition-colors"
                    title="Reset to default"
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
                    placeholder="New 6-digit passcode"
                    className="flex-1 px-3 py-2 border-2 border-slate-200 rounded-lg font-mono tracking-widest focus:border-blue-500 focus:outline-none"
                  />
                  <button
                    onClick={() => handleSetNew(m.member_id, m.name)}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg font-fun font-semibold hover:bg-blue-600"
                  >
                    Save
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
