import { useEffect, useState } from "react";
import { ImagePlus } from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import { fileToDownscaledDataUrl } from "@/lib/imageUpload";
import { toast } from "sonner";
import { Modal, btnGhost, btnPrimary, inputClass, labelClass } from "@/pages/parent/shared";

export function RewardFormModal({ open, onClose, onSaved, editReward }) {
  const isEdit = !!editReward;
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [cost, setCost] = useState(50);
  const [image, setImage] = useState("");
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (isEdit) {
      setName(editReward.name || "");
      setDesc(editReward.description || "");
      setCost(editReward.cost_points ?? 50);
      setImage(editReward.image || "");
    } else {
      setName(""); setDesc(""); setCost(50); setImage("");
    }
  }, [open, isEdit, editReward]);

  const pickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setProcessing(true);
    try {
      const dataUrl = await fileToDownscaledDataUrl(file, { maxDim: 640, quality: 0.8 });
      setImage(dataUrl);
    } catch (err) {
      toast.error(err.message || "Gagal memproses gambar");
    } finally {
      setProcessing(false);
    }
  };

  const submit = async () => {
    if (!name.trim()) return toast.error("Nama hadiah wajib diisi");
    if (!cost || Number(cost) < 1) return toast.error("Harga minimal 1 poin");
    setSaving(true);
    try {
      // image: send even when "" so an edit can clear it.
      const body = { name: name.trim(), description: desc, cost_points: Number(cost) || 1, image };
      if (isEdit) {
        await api.patch(`/rewards/${editReward.id}`, body);
        toast.success("Hadiah diperbarui");
      } else {
        await api.post("/rewards", body);
        toast.success("Hadiah ditambahkan");
      }
      onSaved(); onClose();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "Edit hadiah" : "Hadiah baru"}>
      <div className="space-y-4">
        <div>
          <label className={labelClass}>Nama hadiah</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Nonton 30 menit" data-testid="reward-name-input" />
        </div>
        <div>
          <label className={labelClass}>Deskripsi (opsional)</label>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} className={inputClass} rows={2} />
        </div>

        {/* Reward image — makes the shop far more enticing for kids */}
        <div>
          <label className={labelClass}>Gambar hadiah (opsional)</label>
          {image ? (
            <div className="relative inline-block">
              <img src={image} alt="Pratinjau hadiah" className="w-32 h-32 object-cover rounded-2xl border-2 border-slate-200" />
              <button
                type="button"
                onClick={() => setImage("")}
                className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm"
                title="Hapus gambar"
              >
                ×
              </button>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center w-32 h-32 rounded-2xl border-2 border-dashed border-slate-300 hover:border-indigo-400 hover:bg-indigo-50 cursor-pointer transition-colors">
              {processing ? (
                <span className="text-xs text-slate-500">Memproses…</span>
              ) : (
                <>
                  <ImagePlus className="w-7 h-7 text-slate-400 mb-1" strokeWidth={2} />
                  <span className="text-xs text-slate-500">Upload gambar</span>
                </>
              )}
              <input type="file" accept="image/*" onChange={pickImage} className="hidden" disabled={processing} />
            </label>
          )}
          <p className="text-xs text-slate-400 mt-1">Gambar otomatis diperkecil agar ringan.</p>
        </div>

        <div>
          <label className={labelClass}>Harga (poin) — diambil dari Tabungan anak</label>
          <input type="number" min="1" value={cost} onChange={(e) => setCost(e.target.value)} className={inputClass} data-testid="reward-cost-input" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className={btnGhost}>Batal</button>
          <button onClick={submit} disabled={saving || processing} className={btnPrimary} data-testid="reward-submit-btn">
            {saving ? "Menyimpan…" : (isEdit ? "Simpan perubahan" : "Tambah hadiah")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
