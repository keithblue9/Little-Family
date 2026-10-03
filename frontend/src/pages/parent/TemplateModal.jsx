import { lazy, useCallback, useEffect, useState } from "react";
import { Settings } from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { todayKey } from "@/lib/dates";
import { Modal, btnGhost, btnPrimary, inputClass, labelClass } from "@/pages/parent/shared";

const TemplateManagerModal = lazy(() => import("@/components/TemplateManagerModal"));

export function TemplateModal({ open, onClose, kids, onSaved }) {
  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [selectedKidIds, setSelectedKidIds] = useState([]); // [] = semua anak
  const [dateKey, setDateKey] = useState(todayKey());
  const [saving, setSaving] = useState(false);
  const [showManager, setShowManager] = useState(false);

  const loadTemplates = useCallback(() => {
    setLoadingTemplates(true);
    api.get("/routine-templates")
      .then(({ data }) => setTemplates(data))
      .catch((e) => toast.error(formatApiError(e)))
      .finally(() => setLoadingTemplates(false));
  }, []);

  useEffect(() => {
    if (open) {
      setSelectedTemplate(null);
      setSelectedKidIds([]);
      setDateKey(todayKey());
      loadTemplates();
    }
  }, [open, loadTemplates]);

  const toggleKid = (id) => {
    setSelectedKidIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const isBroadcast = selectedKidIds.length === 0;

  const apply = async () => {
    if (!selectedTemplate) return toast.error("Pilih template dulu");
    setSaving(true);
    try {
      // Create each template task in order via the existing endpoint. Sequential
      // so per-child quest order stays deterministic.
      for (const t of selectedTemplate.tasks) {
        const body = {
          title: t.title,
          description: "",
          points: t.points,
          penalty_points: 0,
          date_key: dateKey,
          due_time: t.due_time || null,
          duration_minutes: t.duration_minutes || null,
          is_bonus: false,
          recurrence: "none",
          order: null,
          task_style: t.task_style || null,
        };
        if (isBroadcast) {
          await api.post("/tasks", { ...body, target_children: [] });
        } else if (selectedKidIds.length === 1) {
          await api.post("/tasks", { ...body, child_id: selectedKidIds[0] });
        } else {
          await api.post("/tasks", { ...body, target_children: selectedKidIds });
        }
      }
      const target = isBroadcast ? `semua anak (${kids.length})` : `${selectedKidIds.length} anak`;
      toast.success(`${selectedTemplate.label} dibuat untuk ${target} — ${selectedTemplate.tasks.length} misi 🎉`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Buat dari Template Rutinitas">
      <div className="space-y-4">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowManager(true)}
            className="press-btn inline-flex items-center gap-1 text-xs font-bold text-indigo-500 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 rounded-full"
          >
            <Settings className="w-3.5 h-3.5" /> Kelola Template
          </button>
        </div>

        {loadingTemplates ? (
          <div className="text-center text-slate-400 text-sm py-6">Memuat template…</div>
        ) : templates.length === 0 ? (
          <div className="text-center text-slate-400 text-sm py-6">Belum ada template. Klik "Kelola Template" untuk buat satu.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {templates.map((tpl) => {
              const active = selectedTemplate?.id === tpl.id;
              return (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => setSelectedTemplate(tpl)}
                  className={`text-left rounded-2xl border-2 p-3 transition-colors ${
                    active ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <div className="font-semibold text-slate-900 text-sm">
                    {tpl.emoji} {tpl.label}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">{tpl.desc}</div>
                  <div className="text-xs text-indigo-500 font-semibold mt-1">
                    {tpl.tasks.length} misi · {tpl.tasks.reduce((s, t) => s + t.points, 0)} poin total
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {selectedTemplate && (
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
            <div className="text-xs font-bold text-slate-500 uppercase mb-2">Isi template</div>
            <div className="space-y-1">
              {selectedTemplate.tasks.map((t, i) => (
                <div key={i} className="text-sm text-slate-700 flex items-center gap-2 flex-wrap">
                  <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                  <span className="flex-1 min-w-0 truncate">{t.title}</span>
                  <span className="text-xs text-slate-400 shrink-0">
                    +{t.points}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className={labelClass}>Untuk anak</label>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setSelectedKidIds([])}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition-colors ${
                isBroadcast ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${
                isBroadcast ? "bg-indigo-500 border-indigo-500" : "border-slate-300"
              }`}>
                {isBroadcast && <span className="text-white text-xs">✓</span>}
              </div>
              <span className="font-semibold text-slate-800 text-sm">🌟 Semua anak</span>
            </button>
            <div className="grid grid-cols-2 gap-2">
              {kids.map((c) => {
                const checked = selectedKidIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleKid(c.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition-colors ${
                      checked ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${
                      checked ? "bg-indigo-500 border-indigo-500" : "border-slate-300"
                    }`}>
                      {checked && <span className="text-white text-xs">✓</span>}
                    </div>
                    <div className="w-6 h-6 rounded-lg flex items-center justify-center text-sm" style={{ background: c.avatar_color }}>
                      {c.avatar_emoji}
                    </div>
                    <span className="font-semibold text-slate-800 text-sm truncate">{c.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div>
          <label className={labelClass}>📅 Tanggal misi</label>
          <input type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} className={inputClass} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className={btnGhost}>Batal</button>
          <button onClick={apply} disabled={saving || !selectedTemplate} className={btnPrimary}>
            {saving ? "Membuat…" : "Buat Misi"}
          </button>
        </div>
      </div>

      {showManager && (
        <TemplateManagerModal
          templates={templates}
          onClose={() => setShowManager(false)}
          onChanged={loadTemplates}
        />
      )}
    </Modal>
  );
}
