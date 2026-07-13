import { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { KeyRound, Palette, Check, Map } from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { QUEST_THEME_LIST } from "@/lib/questThemes";
import { SOUND_THEMES, playSoundTheme } from "@/lib/sounds";

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

  const [savingTheme, setSavingTheme] = useState(false);
  const [savingSound, setSavingSound] = useState(false);

  const saveSoundTheme = async (key) => {
    playSoundTheme(key); // instant preview
    setSavingSound(true);
    try {
      await api.patch("/me/profile", { sound_theme: key });
      await refresh();
      toast.success("Suara misi diganti! 🔊");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSavingSound(false);
    }
  };

  const saveQuestTheme = async (key) => {
    setSavingTheme(true);
    try {
      await api.patch("/me/profile", { quest_theme: key });
      await refresh();
      toast.success("Tema petualangan diganti! Buka tab Misi ya ✨");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSavingTheme(false);
    }
  };

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

      {user?.role === "child" && (
        <div className="border-t border-slate-100 pt-6">
          <h3 className="font-fun font-bold text-lg text-slate-900 flex items-center gap-2 mb-1">
            <Map className="w-5 h-5 text-amber-500" /> Tema Petualangan
          </h3>
          <p className="text-sm text-slate-500 mb-4">Pilih gaya visual untuk peta misimu.</p>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {QUEST_THEME_LIST.map((t) => {
              const active = (user?.quest_theme || "") === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => saveQuestTheme(t.key)}
                  disabled={savingTheme}
                  className={`press-btn rounded-2xl p-3 text-left border-2 transition-all ${
                    active ? "ring-2 ring-offset-2 ring-slate-900 scale-[1.02]" : ""
                  }`}
                  style={{ background: t.colors.bg, color: t.colors.text, borderColor: active ? t.colors.accent : "transparent" }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-3xl">{t.emoji}</span>
                    <div className="font-fun font-bold text-sm truncate">{t.label}</div>
                  </div>
                  <div className="text-[10px] opacity-80 mt-1 line-clamp-2" style={{ color: t.colors.textDim }}>
                    {t.tagline}
                  </div>
                  {active && (
                    <div className="mt-1 inline-flex items-center gap-1 text-xs font-bold" style={{ color: t.colors.accent }}>
                      <Check className="w-3 h-3" /> Aktif
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {user?.role === "child" && (
        <div className="border-t border-slate-100 pt-6">
          <h3 className="font-fun font-bold text-lg text-slate-900 flex items-center gap-2 mb-1">
            🔊 Suara Misi Selesai
          </h3>
          <p className="text-sm text-slate-500 mb-4">Pilih bunyi yang muncul saat kamu selesaikan misi. Klik untuk dengar.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {SOUND_THEMES.map((s) => {
              const active = (user?.sound_theme || "ding") === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => saveSoundTheme(s.key)}
                  disabled={savingSound}
                  className={`press-btn rounded-2xl p-3 text-center border-2 transition-all ${
                    active ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <div className="text-2xl mb-1">{s.emoji}</div>
                  <div className="font-fun font-bold text-xs text-slate-800">{s.label}</div>
                  {active && <div className="text-[10px] font-bold text-indigo-500 mt-1">✓ Aktif</div>}
                </button>
              );
            })}
          </div>
        </div>
      )}

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
