import { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { Modal, btnGhost, btnPrimary, inputClass, labelClass } from "@/pages/parent/shared";

export function ConsequenceFormModal({ open, onClose, onSaved, editConsequence }) {
  const isEdit = !!editConsequence;
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [deduct, setDeduct] = useState(10);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (isEdit) {
      setName(editConsequence.name || "");
      setDesc(editConsequence.description || "");
      setDeduct(editConsequence.points_deducted ?? 0);
    } else {
      setName(""); setDesc(""); setDeduct(10);
    }
  }, [open, isEdit, editConsequence]);

  const submit = async () => {
    if (!name.trim()) return toast.error("Nama konsekuensi wajib diisi");
    setSaving(true);
    try {
      const body = { name: name.trim(), description: desc, points_deducted: Number(deduct) || 0 };
      if (isEdit) {
        await api.patch(`/consequences/${editConsequence.id}`, body);
        toast.success("Konsekuensi diperbarui");
      } else {
        await api.post("/consequences", body);
        toast.success("Konsekuensi ditambahkan");
      }
      onSaved(); onClose();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "Edit konsekuensi" : "Konsekuensi baru"}>
      <div className="space-y-4">
        <div>
          <label className={labelClass}>Konsekuensi</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Kurangi waktu main" data-testid="cons-name-input" />
        </div>
        <div>
          <label className={labelClass}>Deskripsi</label>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} className={inputClass} rows={2} placeholder="Tidak nonton TV malam ini" />
        </div>
        <div>
          <label className={labelClass}>Poin dikurangi</label>
          <input type="number" min="0" value={deduct} onChange={(e) => setDeduct(e.target.value)} className={inputClass} data-testid="cons-deduct-input" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className={btnGhost}>Batal</button>
          <button onClick={submit} disabled={saving} className={btnPrimary} data-testid="cons-submit-btn">
            {saving ? "Menyimpan…" : (isEdit ? "Simpan perubahan" : "Tambah")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function ApplyConsequenceModal({ open, onClose, consequences, kids, preselect, selectedChildId, onSaved }) {
  const [consId, setConsId] = useState("");
  const [childId, setChildId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setConsId(preselect?.consequence?.id || "");
      setChildId(preselect?.task?.child_id || selectedChildId || (kids[0] && kids[0].id) || "");
      setNotes("");
    }
  }, [open, preselect, kids, selectedChildId]);

  const submit = async () => {
    if (!consId || !childId) return toast.error("Pick child and consequence");
    setSaving(true);
    try {
      await api.post("/consequences/apply", { consequence_id: consId, child_id: childId, notes, task_id: preselect?.task?.id || null });
      toast.success("Consequence applied");
      onSaved(); onClose();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Apply consequence">
      <div className="space-y-4">
        <div>
          <label className={labelClass}>Child</label>
          <select value={childId} onChange={(e) => setChildId(e.target.value)} className={inputClass}>
            <option value="">— Select —</option>
            {kids.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>Consequence</label>
          <select value={consId} onChange={(e) => setConsId(e.target.value)} className={inputClass}>
            <option value="">— Select —</option>
            {consequences.map((c) => <option key={c.id} value={c.id}>{c.name} {c.points_deducted ? `(−${c.points_deducted})` : ""}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>Notes (optional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} rows={2} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={submit} disabled={saving} className={btnPrimary} data-testid="apply-cons-submit-btn">
            {saving ? "Saving…" : "Apply"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
