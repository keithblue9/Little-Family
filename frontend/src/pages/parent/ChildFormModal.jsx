import { useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { ALL_MBTI, PERSONALITY_PROFILES } from "@/lib/personality";
import { AVATAR_COLORS, AVATAR_EMOJIS, Modal, btnGhost, btnPrimary, inputClass, labelClass } from "@/pages/parent/shared";

export function ChildFormModal({ open, onClose, onSaved }) {
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [color, setColor] = useState(AVATAR_COLORS[0]);
  const [emoji, setEmoji] = useState(AVATAR_EMOJIS[0]);
  const [mbti, setMbti] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => { setName(""); setAge(""); setColor(AVATAR_COLORS[0]); setEmoji(AVATAR_EMOJIS[0]); setMbti(""); };

  const submit = async () => {
    if (!name.trim()) return toast.error("Nama wajib diisi");
    setSaving(true);
    try {
      await api.post("/children", {
        name: name.trim(),
        age: age ? parseInt(age) : null,
        avatar_color: color,
        avatar_emoji: emoji,
        mbti: mbti || null,
      });
      toast.success(`${name} ditambahkan!`);
      reset();
      onSaved();
      onClose();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Tambah anak">
      <div className="space-y-4">
        <div>
          <label className={labelClass}>Nama</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Adskhan" data-testid="child-name-input" />
        </div>
        <div>
          <label className={labelClass}>Umur (opsional)</label>
          <input type="number" min="1" max="25" value={age} onChange={(e) => setAge(e.target.value)} className={inputClass} data-testid="child-age-input" />
        </div>
        <div>
          <label className={labelClass}>Tipe Kepribadian (MBTI, opsional)</label>
          <select value={mbti} onChange={(e) => setMbti(e.target.value)} className={inputClass}>
            <option value="">— Pilih tipe —</option>
            {ALL_MBTI.map((t) => (
              <option key={t} value={t}>
                {t}{PERSONALITY_PROFILES[t] ? ` · ${PERSONALITY_PROFILES[t].nickname}` : ""}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-400 mt-1">
            Membantu aplikasi menyarankan gaya tugas & pesan motivasi yang cocok untuk anak.
          </p>
        </div>
        <div>
          <label className={labelClass}>Warna avatar</label>
          <div className="flex gap-2 flex-wrap">
            {AVATAR_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-10 h-10 rounded-full border-2 transition-transform ${color === c ? "border-slate-900 scale-110" : "border-transparent"}`}
                style={{ background: c }}
                data-testid={`avatar-color-${c}`}
              />
            ))}
          </div>
        </div>
        <div>
          <label className={labelClass}>Avatar</label>
          <div className="flex gap-2 flex-wrap">
            {AVATAR_EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => setEmoji(e)}
                className={`w-10 h-10 rounded-xl border-2 text-xl transition-colors ${emoji === e ? "border-[#6366F1] bg-[#EEF2FF]" : "border-slate-200"}`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className={btnGhost}>Batal</button>
          <button onClick={submit} disabled={saving} className={btnPrimary} data-testid="child-submit-btn">
            {saving ? "Menyimpan…" : "Tambah anak"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
