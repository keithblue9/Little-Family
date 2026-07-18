import { useEffect, useState } from "react";
import { PawPrint } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { PET_CATALOG, petAppearanceByFeed } from "@/lib/pets";
import PetSprite from "@/components/PetSprite";

/**
 * Pet management surface for the KID's Profile tab:
 *  - No pet yet   → the 10-animal picker (first choice, no approval needed)
 *  - Has a pet    → shows it + an "Ajukan Ganti Peliharaan" button that files a
 *                   request a parent must approve (pets are a lasting
 *                   responsibility, so swapping isn't self-serve)
 *  - Pet has died → picker unlocks directly (no request needed)
 *  - Request open → shows a pending banner + a way to withdraw it
 */
export default function PetManagerCard({ child, onChanged, petStageNames, petFeedThresholds }) {
  const [requests, setRequests] = useState([]);
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState("");
  const [showReason, setShowReason] = useState(false);

  const loadRequests = async () => {
    try {
      const { data } = await api.get("/pet-reset-requests");
      setRequests(data);
    } catch { /* non-fatal */ }
  };
  useEffect(() => { loadRequests(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pendingRequest = requests.find((r) => r.status === "pending");
  const hasPet = !!child.pet_type;
  const isDead = !!child.pet_is_dead;

  const choosePet = async (petKey) => {
    setSaving(true);
    try {
      await api.patch("/me/profile", { pet_type: petKey });
      toast.success("Peliharaanmu siap! 🎉");
      onChanged?.();
      loadRequests();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const submitRequest = async () => {
    setSaving(true);
    try {
      await api.post("/me/request-pet-reset", { reason });
      toast.success("Permintaan terkirim! Menunggu persetujuan orang tua 🐾");
      setReason("");
      setShowReason(false);
      loadRequests();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const withdrawRequest = async () => {
    if (!pendingRequest) return;
    setSaving(true);
    try {
      await api.delete(`/pet-reset-requests/${pendingRequest.id}`);
      toast("Permintaan dibatalkan");
      loadRequests();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const Picker = ({ title, subtitle }) => (
    <div>
      <h3 className="font-fun font-bold text-slate-900 mb-1 flex items-center gap-2">
        <PawPrint className="w-5 h-5 text-amber-500" /> {title}
      </h3>
      <p className="text-xs text-slate-500 mb-3">{subtitle}</p>
      <div className="grid grid-cols-5 gap-2">
        {PET_CATALOG.map((p) => (
          <button
            key={p.key}
            onClick={() => choosePet(p.key)}
            disabled={saving}
            className="press-btn flex flex-col items-center gap-1 p-2 rounded-2xl bg-slate-50 hover:bg-indigo-50 border-2 border-slate-100 hover:border-indigo-300 disabled:opacity-50"
          >
            <PetSprite petType={p.key} stageIndex={3} size={40} />
            <span className="text-[10px] font-bold text-slate-600">{p.name}</span>
          </button>
        ))}
      </div>
    </div>
  );

  // 1) No pet, or pet died → show picker (no approval needed)
  if (!hasPet || isDead) {
    return (
      <Picker
        title={isDead ? "Pilih Peliharaan Baru! 🐾" : "Pilih Peliharaanmu! 🐾"}
        subtitle={
          isDead
            ? "Peliharaanmu yang lama sudah pergi. Yuk pilih yang baru dan rawat baik-baik!"
            : "Sekali pilih, dia jadi tanggung jawabmu. Beri makan terus supaya tumbuh besar!"
        }
      />
    );
  }

  // 2) Has a living pet → show it + request-swap flow
  const appearance = petAppearanceByFeed(child.pet_type, child.pet_feed_count || 0, petFeedThresholds, petStageNames);

  return (
    <div>
      <h3 className="font-fun font-bold text-slate-900 mb-3 flex items-center gap-2">
        <PawPrint className="w-5 h-5 text-amber-500" /> Peliharaanku
      </h3>

      <div className="flex items-center gap-3 mb-4">
        <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center shrink-0">
          <PetSprite petType={child.pet_type} stageIndex={appearance.stageIndex} size={52} />
        </div>
        <div>
          <div className="font-fun font-bold text-slate-800">{appearance.stageName} {appearance.petName}</div>
          <div className="text-xs text-slate-500">
            Sudah diberi makan {child.pet_feed_count || 0}× ·{" "}
            {appearance.isAdult ? "sudah dewasa 🌟" : `${appearance.feedsNeeded}× lagi naik tahap`}
          </div>
        </div>
      </div>

      {pendingRequest ? (
        <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-3">
          <div className="text-sm font-semibold text-amber-800 mb-1">⏳ Menunggu persetujuan orang tua</div>
          <p className="text-xs text-amber-700 mb-2">
            Permintaan ganti peliharaanmu sudah terkirim. Sabar ya, tunggu orang tua menyetujui.
          </p>
          <button onClick={withdrawRequest} disabled={saving} className="text-xs font-semibold text-amber-800 underline">
            Batalkan permintaan
          </button>
        </div>
      ) : showReason ? (
        <div className="bg-slate-50 rounded-2xl p-3">
          <label className="text-xs font-bold text-slate-600 mb-1 block">Kenapa mau ganti? (opsional)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 200))}
            rows={2}
            placeholder="Ceritakan ke orang tua…"
            className="w-full px-3 py-2 rounded-xl border-2 border-slate-200 text-sm mb-2"
          />
          <div className="flex gap-2">
            <button onClick={submitRequest} disabled={saving} className="press-btn bg-indigo-500 hover:bg-indigo-600 text-white font-fun font-bold px-3 py-1.5 rounded-xl text-xs">
              Kirim Permintaan
            </button>
            <button onClick={() => { setShowReason(false); setReason(""); }} className="text-xs text-slate-500 underline">
              Batal
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button
            onClick={() => setShowReason(true)}
            className="press-btn inline-flex items-center gap-1.5 bg-white border-2 border-slate-200 hover:bg-slate-50 text-slate-600 font-fun font-bold px-3 py-1.5 rounded-xl text-xs"
          >
            🔄 Ajukan Ganti Peliharaan
          </button>
          <p className="text-[10px] text-slate-400 mt-1.5">
            Ganti peliharaan perlu disetujui orang tua dulu — supaya kamu belajar merawat sampai besar.
          </p>
        </div>
      )}
    </div>
  );
}
