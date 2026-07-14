import { useEffect, useRef, useState } from "react";
import { Mic, Square, X, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

const MAX_VOICE_SECONDS = 20;

export default function EncourageModal({ task, onClose, onApproved }) {
  const [message, setMessage] = useState("");
  const [voiceUrl, setVoiceUrl] = useState(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [micSupported, setMicSupported] = useState(true);
  const [saving, setSaving] = useState(false);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    setMicSupported(!!(navigator.mediaDevices && window.MediaRecorder));
    return () => {
      clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onload = () => setVoiceUrl(reader.result);
        reader.readAsDataURL(blob);
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => {
        setRecordSeconds((s) => {
          if (s + 1 >= MAX_VOICE_SECONDS) {
            stopRecording();
            return MAX_VOICE_SECONDS;
          }
          return s + 1;
        });
      }, 1000);
    } catch {
      toast.error("Tidak bisa akses mikrofon — cek izin browser, atau pakai pesan teks saja.");
      setMicSupported(false);
    }
  };

  const stopRecording = () => {
    clearInterval(timerRef.current);
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const submit = async () => {
    setSaving(true);
    try {
      const { data } = await api.post(`/tasks/${task.id}/approve`, {
        encouragement_message: message.trim() || null,
        encouragement_voice_url: voiceUrl || null,
      });
      toast.success(`Disetujui dengan pesan semangat! +${task.points} poin 💌`);
      if (data.new_badges?.length) {
        data.new_badges.forEach((b) => toast.success(`Badge baru terbuka: ${b.name} 🏆`));
      }
      onApproved();
      onClose();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-3xl w-full max-w-md p-6 border border-slate-200 shadow-xl">
        <div className="flex justify-between items-center mb-1">
          <h3 className="font-parent font-bold text-lg text-slate-900">💌 Pesan Semangat</h3>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100"><X className="w-5 h-5 text-slate-500" /></button>
        </div>
        <p className="text-sm text-slate-500 mb-4">Setujui "{task.title}" dengan pesan singkat untuk {task.child_name || "anak"}.</p>

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, 300))}
          placeholder="Contoh: Kerja bagus nak, ayah bangga sama kamu!"
          rows={3}
          className="w-full px-3 py-2 border-2 border-slate-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none resize-none mb-3"
        />

        {micSupported && (
          <div className="mb-4">
            {!voiceUrl && !recording && (
              <button onClick={startRecording} className="press-btn inline-flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-4 py-2 rounded-xl text-sm">
                <Mic className="w-4 h-4" /> Rekam pesan suara (maks {MAX_VOICE_SECONDS}s)
              </button>
            )}
            {recording && (
              <button onClick={stopRecording} className="press-btn inline-flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white font-semibold px-4 py-2 rounded-xl text-sm animate-pulse">
                <Square className="w-4 h-4" /> Berhenti ({MAX_VOICE_SECONDS - recordSeconds}s)
              </button>
            )}
            {voiceUrl && !recording && (
              <div className="flex items-center gap-2">
                <audio controls src={voiceUrl} className="h-9 flex-1" />
                <button onClick={() => setVoiceUrl(null)} className="press-btn p-2 rounded-lg hover:bg-red-50 text-red-500" title="Hapus rekaman">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}

        <button
          onClick={submit}
          disabled={saving}
          className="w-full py-2.5 rounded-xl font-semibold bg-[#34D399] hover:bg-[#22c583] text-white disabled:opacity-60"
        >
          {saving ? "Menyimpan…" : "Setujui & Kirim Pesan"}
        </button>
      </div>
    </div>
  );
}
