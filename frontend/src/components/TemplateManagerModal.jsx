import { useState } from "react";
import { Plus, Trash2, Settings, X } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

const EMPTY_TASK = { title: "", points: 10, duration_minutes: "", due_time: "", task_style: "" };

export default function TemplateManagerModal({ templates, onClose, onChanged }) {
  const [editing, setEditing] = useState(null); // template being edited, or {} for new
  const [saving, setSaving] = useState(false);

  const startNew = () => setEditing({ label: "", emoji: "📋", desc: "", tasks: [{ ...EMPTY_TASK }] });
  const startEdit = (tpl) => setEditing({ ...tpl, tasks: tpl.tasks.map((t) => ({ ...t })) });

  const del = async (tpl) => {
    if (!window.confirm(`Hapus template "${tpl.label}"?`)) return;
    try {
      await api.delete(`/routine-templates/${tpl.id}`);
      toast.success("Template dihapus");
      onChanged();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const save = async () => {
    if (!editing.label.trim()) return toast.error("Beri nama template");
    const cleanTasks = editing.tasks
      .filter((t) => t.title.trim())
      .map((t) => ({
        title: t.title.trim(),
        points: Number(t.points) || 0,
        duration_minutes: t.duration_minutes ? Number(t.duration_minutes) : null,
        due_time: t.due_time || null,
        task_style: t.task_style || null,
      }));
    if (cleanTasks.length === 0) return toast.error("Tambahkan minimal 1 misi ke template");
    setSaving(true);
    try {
      const body = { label: editing.label.trim(), emoji: editing.emoji || "📋", desc: editing.desc || "", tasks: cleanTasks };
      if (editing.id) {
        await api.patch(`/routine-templates/${editing.id}`, body);
        toast.success("Template diperbarui");
      } else {
        await api.post("/routine-templates", body);
        toast.success("Template dibuat");
      }
      setEditing(null);
      onChanged();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const updateTask = (idx, field, value) => {
    setEditing((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t, i) => (i === idx ? { ...t, [field]: value } : t)),
    }));
  };
  const addTaskRow = () => setEditing((prev) => ({ ...prev, tasks: [...prev.tasks, { ...EMPTY_TASK }] }));
  const removeTaskRow = (idx) => setEditing((prev) => ({ ...prev, tasks: prev.tasks.filter((_, i) => i !== idx) }));

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-3xl w-full max-w-lg max-h-[85vh] flex flex-col border border-slate-200 shadow-xl">
        <div className="flex justify-between items-center px-6 pt-6 pb-4 shrink-0">
          <h3 className="font-parent font-bold text-lg text-slate-900 flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-500" /> Kelola Template Rutinitas
          </h3>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100"><X className="w-5 h-5 text-slate-500" /></button>
        </div>

        <div className="px-6 pb-6 overflow-y-auto">
          {!editing ? (
            <>
              <button
                onClick={startNew}
                className="press-btn w-full inline-flex items-center justify-center gap-1.5 bg-indigo-500 hover:bg-indigo-600 text-white font-semibold py-2.5 rounded-xl text-sm mb-3"
              >
                <Plus className="w-4 h-4" /> Template Baru
              </button>
              <div className="space-y-2">
                {templates.map((tpl) => (
                  <div key={tpl.id} className="flex items-center gap-2 border border-slate-200 rounded-xl p-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-slate-800">{tpl.emoji} {tpl.label}</div>
                      <div className="text-xs text-slate-400">{tpl.tasks.length} misi</div>
                    </div>
                    <button onClick={() => startEdit(tpl)} className="press-btn p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" title="Edit">
                      <Settings className="w-4 h-4" />
                    </button>
                    <button onClick={() => del(tpl)} className="press-btn p-1.5 rounded-lg hover:bg-red-50 text-red-500" title="Hapus">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  value={editing.emoji}
                  onChange={(e) => setEditing((p) => ({ ...p, emoji: e.target.value.slice(0, 4) }))}
                  className="w-16 px-2 py-2 border-2 border-slate-200 rounded-xl text-center text-lg"
                />
                <input
                  value={editing.label}
                  onChange={(e) => setEditing((p) => ({ ...p, label: e.target.value.slice(0, 60) }))}
                  placeholder="Nama template, mis. Rutinitas Pagi"
                  className="flex-1 px-3 py-2 border-2 border-slate-200 rounded-xl text-sm"
                />
              </div>
              <input
                value={editing.desc}
                onChange={(e) => setEditing((p) => ({ ...p, desc: e.target.value.slice(0, 150) }))}
                placeholder="Deskripsi singkat (opsional)"
                className="w-full px-3 py-2 border-2 border-slate-200 rounded-xl text-sm"
              />

              <div className="text-xs font-bold text-slate-500 uppercase pt-2">Daftar Misi</div>
              <div className="space-y-2">
                {editing.tasks.map((t, i) => (
                  <div key={i} className="border border-slate-100 rounded-xl p-2.5 space-y-1.5 bg-slate-50">
                    <div className="flex gap-1.5">
                      <input
                        value={t.title}
                        onChange={(e) => updateTask(i, "title", e.target.value)}
                        placeholder={`Misi ${i + 1}`}
                        className="flex-1 px-2 py-1.5 border-2 border-slate-200 rounded-lg text-sm"
                      />
                      <button onClick={() => removeTaskRow(i)} className="press-btn p-1.5 rounded-lg hover:bg-red-50 text-red-400 shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <input
                        type="number" min="0" value={t.points}
                        onChange={(e) => updateTask(i, "points", e.target.value.replace(/\D/g, ""))}
                        placeholder="Poin"
                        className="px-2 py-1.5 border-2 border-slate-200 rounded-lg text-xs"
                      />
                      <input
                        type="number" min="1" value={t.duration_minutes}
                        onChange={(e) => updateTask(i, "duration_minutes", e.target.value.replace(/\D/g, ""))}
                        placeholder="Durasi (mnt)"
                        className="px-2 py-1.5 border-2 border-slate-200 rounded-lg text-xs"
                      />
                      <input
                        type="time" value={t.due_time || ""}
                        onChange={(e) => updateTask(i, "due_time", e.target.value)}
                        className="px-2 py-1.5 border-2 border-slate-200 rounded-lg text-xs"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={addTaskRow}
                className="press-btn w-full inline-flex items-center justify-center gap-1 text-xs font-bold text-indigo-500 bg-indigo-50 hover:bg-indigo-100 py-2 rounded-lg"
              >
                <Plus className="w-3.5 h-3.5" /> Tambah Misi
              </button>

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-500 hover:bg-slate-100">
                  Batal
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="px-4 py-2 rounded-xl text-sm font-semibold bg-indigo-500 hover:bg-indigo-600 text-white disabled:opacity-60"
                >
                  {saving ? "Menyimpan…" : "Simpan"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
