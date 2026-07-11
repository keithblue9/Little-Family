import { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { KeyRound, Palette, Check } from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const EMOJIS = ["🦁", "🐯", "🐻", "🦊", "🐼", "🐨", "🐰", "🐸", "🦄", "🐢", "🦖", "🐝", "🦋", "🦸‍♂️", "🧜‍♀️", "🚀", "👨", "👩", "😎", "🌟"];
const COLORS = ["#FF9D23", "#4DB8FF", "#34D399", "#FF5C5C", "#A78BFA", "#F472B6", "#FBBF24", "#2DD4BF"];

export default function ProfileEditor() {
  const { user, refresh } = useAuth();
  const [emoji, setEmoji] = useState(user?.avatar_emoji || "🦁");
  const [color, setColor] = useState(user?.avatar_color || "#FF9D23");
  const [savingAvatar, setSavingAvatar] = useState(false);

  const [oldCode, setOldCode] = useState("");
  const [newCode, setNewCode] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [savingCode, setSavingCode] = useState(false);

  const saveAvatar = async () => {
    setSavingAvatar(true);
    try {
      await api.patch("/me/profile", { avatar_emoji: emoji, avatar_color: color });
      await refresh();
      toast.success("Avatar berhasil diganti! ✨");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSavingAvatar(false);
    }
  };

  const savePasscode = async () => {
    if (!/^\d{6}$/.test(newCode)) {
      toast.error("Passcode baru harus 6 digit angka");
      return;
    }
    if (newCode !== confirmCode) {
      toast.error("Konfirmasi passcode tidak sama");
      return;
    }
    setSavingCode(true);
    try {
      await api.post("/me/passcode", { old_passcode: oldCode, new_passcode: newCode });
      toast.success("Passcode berhasil diganti! 🔐");
      setOldCode("");
      setNewCode("");
      setConfirmCode("");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSavingCode(false);
    }
  };

  const codeInput = (value, setter, placeholder) => (
    <input
      type="password"
      inputMode="numeric"
      maxLength={6}
      value={value}
      onChange={(e) => setter(e.target.value.replace(/\D/g, "").slice(0, 6))}
      placeholder={placeholder}
      className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl font-mono text-lg tracking-[0.4em] text-center focus:border-[#FF9D23] focus:outline-none"
    />
  );

  return (
    <div className="space-y-6">
      {/* Avatar */}
      <div>
        <h3 className="font-fun font-bold text-lg text-slate-900 flex items-center gap-2 mb-1">
          <Palette className="w-5 h-5 text-purple-500" /> Ganti Avatar
        </h3>
        <p className="text-sm text-slate-500 mb-4">Pilih emoji dan warna favoritmu</p>

        <div className="flex items-center gap-4 mb-4">
          <motion.div
            key={emoji + color}
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl chunky-shadow"
            style={{ background: color }}
          >
            {emoji}
          </motion.div>
          <div className="text-sm text-slate-500">Pratinjau avatar kamu</div>
        </div>

        <div className="grid grid-cols-10 gap-1.5 mb-3">
          {EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => setEmoji(e)}
              className={`aspect-square rounded-xl text-xl flex items-center justify-center transition-all ${
                emoji === e ? "bg-orange-100 ring-2 ring-[#FF9D23] scale-110" : "bg-slate-50 hover:bg-slate-100"
              }`}
            >
              {e}
            </button>
          ))}
        </div>

        <div className="flex gap-2 mb-4">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-9 h-9 rounded-full transition-transform ${color === c ? "ring-4 ring-offset-2 ring-slate-300 scale-110" : ""}`}
              style={{ background: c }}
            >
              {color === c && <Check className="w-4 h-4 text-white mx-auto" strokeWidth={3} />}
            </button>
          ))}
        </div>

        <button
          onClick={saveAvatar}
          disabled={savingAvatar}
          className="press-btn bg-purple-500 hover:bg-purple-600 text-white font-fun font-semibold px-5 py-2.5 rounded-xl disabled:opacity-50"
        >
          {savingAvatar ? "Menyimpan…" : "Simpan Avatar"}
        </button>
      </div>

      <div className="border-t border-slate-100 pt-6">
        <h3 className="font-fun font-bold text-lg text-slate-900 flex items-center gap-2 mb-1">
          <KeyRound className="w-5 h-5 text-blue-500" /> Ganti Passcode
        </h3>
        <p className="text-sm text-slate-500 mb-4">Passcode dipakai untuk masuk ke aplikasi</p>

        <div className="space-y-3 max-w-xs">
          {codeInput(oldCode, setOldCode, "Passcode lama")}
          {codeInput(newCode, setNewCode, "Passcode baru")}
          {codeInput(confirmCode, setConfirmCode, "Ulangi passcode baru")}
          <button
            onClick={savePasscode}
            disabled={savingCode || oldCode.length !== 6 || newCode.length !== 6 || confirmCode.length !== 6}
            className="press-btn w-full bg-blue-500 hover:bg-blue-600 text-white font-fun font-semibold px-5 py-3 rounded-xl disabled:opacity-40"
          >
            {savingCode ? "Menyimpan…" : "Ganti Passcode"}
          </button>
        </div>
      </div>
    </div>
  );
}
