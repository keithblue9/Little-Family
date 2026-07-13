import { useState } from "react";
import { Type, RotateCcw, Save, EyeOff, Eye } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { DEFAULT_LABELS, LABEL_GROUPS, useLabels } from "@/lib/labels";

export default function LabelEditor() {
  const { custom } = useLabels();
  const [draft, setDraft] = useState({ ...custom });
  const [saving, setSaving] = useState(false);
  const [openGroup, setOpenGroup] = useState(null);

  const setLabel = (key, value) => setDraft((d) => ({ ...d, [key]: value }));

  const resetLabel = (key) => {
    setDraft((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
  };

  const hideLabel = (key) => setDraft((d) => ({ ...d, [key]: "" }));

  const keysFor = (group) => {
    const prefixes = [group.prefix, group.extraPrefix].filter(Boolean);
    return Object.keys(DEFAULT_LABELS).filter((k) => prefixes.some((p) => k.startsWith(p)));
  };

  const save = async () => {
    setSaving(true);
    try {
      // Send only changed keys; null clears an override back to default.
      const payload = {};
      const allKeys = new Set([...Object.keys(draft), ...Object.keys(custom)]);
      for (const k of allKeys) {
        if (draft[k] === undefined && custom[k] !== undefined) {
          payload[k] = null; // cleared
        } else if (draft[k] !== custom[k]) {
          payload[k] = draft[k];
        }
      }
      if (Object.keys(payload).length === 0) {
        toast.info("Tidak ada perubahan");
        setSaving(false);
        return;
      }
      await api.post("/config", { custom_labels: payload });
      toast.success("Teks diperbarui!");
      window.dispatchEvent(new Event("labels-updated"));
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-fun font-bold text-lg text-slate-900 flex items-center gap-2">
          <Type className="w-5 h-5 text-indigo-500" /> Ubah Teks Aplikasi
        </h3>
        <p className="text-sm text-slate-500 mt-1">
          Ubah atau sembunyikan teks apa pun — dari halaman login sampai menu, di aplikasi orang tua & anak.
        </p>
      </div>

      {LABEL_GROUPS.map((group) => {
        const keys = keysFor(group);
        const isOpen = openGroup === group.title;
        return (
          <div key={group.title} className="border-2 border-slate-100 rounded-xl overflow-hidden">
            <button
              onClick={() => setOpenGroup(isOpen ? null : group.title)}
              className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors"
            >
              <span className="font-semibold text-slate-800 text-sm">{group.title}</span>
              <span className="text-slate-400 text-sm">{isOpen ? "−" : "+"} {keys.length} teks</span>
            </button>
            {isOpen && (
              <div className="p-3 space-y-2">
                {keys.map((key) => {
                  const isCustom = draft[key] !== undefined;
                  const isHidden = draft[key] === "";
                  const value = isCustom ? draft[key] : DEFAULT_LABELS[key];
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <input
                          value={value}
                          onChange={(e) => setLabel(key, e.target.value)}
                          placeholder={DEFAULT_LABELS[key]}
                          className={`w-full px-3 py-1.5 border-2 rounded-lg text-sm focus:outline-none ${
                            isHidden ? "border-red-200 bg-red-50 text-red-400 line-through" : isCustom ? "border-indigo-300 focus:border-indigo-500" : "border-slate-200 focus:border-slate-400"
                          }`}
                        />
                        <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                          Default: {DEFAULT_LABELS[key]}
                        </div>
                      </div>
                      <button onClick={() => (isHidden ? setLabel(key, DEFAULT_LABELS[key]) : hideLabel(key))}
                        title={isHidden ? "Tampilkan" : "Sembunyikan"}
                        className={`p-1.5 rounded-lg ${isHidden ? "text-green-500 hover:bg-green-50" : "text-slate-400 hover:bg-slate-100"}`}>
                        {isHidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                      </button>
                      {isCustom && (
                        <button onClick={() => resetLabel(key)} title="Kembalikan ke default" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100">
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <button
        onClick={save}
        disabled={saving}
        className="w-full py-3 rounded-xl font-fun font-semibold flex items-center justify-center gap-2 bg-indigo-500 text-white hover:bg-indigo-600 active:scale-95 disabled:opacity-60 transition-all"
      >
        <Save className="w-5 h-5" /> {saving ? "Menyimpan…" : "Simpan Perubahan Teks"}
      </button>
    </div>
  );
}
