import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Send, X } from "lucide-react";
import { toast } from "sonner";
import { formatApiError } from "@/lib/api";
import { sendOrQueue } from "@/lib/offlineQueue";

export const countWords = (text) => (String(text || "").toLowerCase().match(/[0-9a-zà-ÿ]+/g) || []).length;

/**
 * Where a child writes what they did or learned for a "tulis ringkasan"
 * mission. Writing it is what ticks the mission. Children who can't type
 * comfortably yet can speak instead (the phone turns it into text).
 *
 * Whether any of it was pasted, and how long writing took, travel along as
 * hints for the parent — never as a reason to refuse.
 */
export default function SummaryBox({ activity, onSaved, onCancel, big = false }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const pasted = useRef(false);
  const startedAt = useRef(null);
  const recog = useRef(null);
  const need = activity.summary_min_words || 15;
  const words = countWords(text);

  const SpeechRec = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => () => { try { recog.current?.stop(); } catch { /* ignore */ } }, []);

  const touch = () => { if (!startedAt.current) startedAt.current = Date.now(); };

  const toggleMic = () => {
    if (!SpeechRec) return;
    if (listening) { try { recog.current?.stop(); } catch { /* ignore */ } return; }
    const r = new SpeechRec();
    r.lang = "id-ID";
    r.interimResults = false;
    r.continuous = true;
    r.onresult = (e) => {
      touch();
      const said = Array.from(e.results).slice(e.resultIndex).map((x) => x[0].transcript).join(" ");
      setText((t) => (t ? `${t.trim()} ${said.trim()}` : said.trim()));
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recog.current = r;
    try { r.start(); setListening(true); } catch { setListening(false); }
  };

  const submit = async () => {
    if (words < need) { toast(`Tulis minimal ${need} kata ya (baru ${words}) ✍️`); return; }
    setBusy(true);
    try {
      const body = {
        text: text.trim(), pasted: pasted.current,
        typing_seconds: startedAt.current ? Math.round((Date.now() - startedAt.current) / 1000) : null,
      };
      const r = await sendOrQueue(`/tasks/${activity.id}/summary`, body, `summary:${activity.id}`);
      if (r?.queued) toast("Tersimpan di HP — dikirim saat internet kembali 📶", { duration: 3000 });
      else toast.success("Ringkasan tersimpan ✨");
      onSaved?.(text.trim());
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rounded-2xl border-2 border-indigo-200 bg-indigo-50/60 ${big ? "p-4" : "p-3"} space-y-2`}>
      <div className={`font-fun font-bold text-indigo-900 ${big ? "text-xl" : "text-sm"}`}>
        📝 {activity.summary_prompt || "Tulis apa yang sudah kamu kerjakan atau pelajari"}
      </div>
      {activity.summary_review === "redo" && activity.summary_note && (
        <div className="text-xs text-amber-800 bg-amber-50 rounded-xl px-3 py-2">💬 {activity.summary_note}</div>
      )}
      <textarea
        value={text}
        onChange={(e) => { touch(); setText(e.target.value); }}
        onPaste={() => { pasted.current = true; }}
        rows={big ? 5 : 4}
        maxLength={5000}
        placeholder="Pakai kalimatmu sendiri…"
        className={`w-full rounded-xl border-2 border-indigo-100 bg-white px-3 py-2 focus:border-indigo-400 focus:outline-none ${big ? "text-lg" : "text-sm"}`}
      />
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-xs font-semibold ${words >= need ? "text-emerald-600" : "text-slate-500"}`}>
          {words}/{need} kata
        </span>
        {SpeechRec && (
          <button type="button" onClick={toggleMic}
            className={`press-btn inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold border-2 ${
              listening ? "border-red-300 bg-red-50 text-red-600" : "border-slate-200 bg-white text-slate-600"}`}>
            {listening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
            {listening ? "Berhenti" : "Bicara"}
          </button>
        )}
        <div className="ml-auto flex gap-2">
          {onCancel && (
            <button type="button" onClick={onCancel} className="press-btn p-2 rounded-xl text-slate-400 hover:bg-white" aria-label="Tutup">
              <X className="w-4 h-4" />
            </button>
          )}
          <button type="button" onClick={submit} disabled={busy}
            className={`press-btn inline-flex items-center gap-1.5 rounded-xl font-fun font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 ${
              big ? "px-5 py-3 text-lg" : "px-3 py-2 text-sm"}`}>
            <Send className="w-4 h-4" /> {busy ? "Menyimpan…" : "Kirim"}
          </button>
        </div>
      </div>
    </div>
  );
}
