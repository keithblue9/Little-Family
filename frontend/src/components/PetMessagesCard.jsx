import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { humanDateKey } from "@/lib/dates";

/** A short note the child's pet "says" on their screen — warmer than a notification. */
export default function PetMessagesCard({ kids = [] }) {
  const [rows, setRows] = useState(null);
  const [text, setText] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get("/pet-messages", { fresh: true }).then((r) => setRows(r.data)).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.post("/pet-messages", { text: text.trim(), child_id: to || null });
      toast.success("Terkirim — peliharaannya yang menyampaikan 💌");
      setText(""); await load();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };
  const del = async (m) => { try { await api.delete(`/pet-messages/${m.id}`); await load(); } catch (e) { toast.error(formatApiError(e)); } };
  const name = (id) => (id ? kids.find((k) => k.id === id)?.name || "?" : "Semua anak");
  const readBy = (m) => (m.read_by || []).map(name).join(", ");

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
      <div>
        <h3 className="font-parent font-bold text-slate-900">💌 Pesan lewat peliharaan</h3>
        <p className="text-xs text-slate-500">Tulis satu kalimat hangat. Peliharaan anak yang menyampaikannya di layar mereka.</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {[["", "Semua anak"], ...kids.map((k) => [k.id, k.name])].map(([id, l]) => (
          <button key={id || "all"} onClick={() => setTo(id)}
            className={`press-btn px-3 py-1.5 rounded-xl text-xs font-semibold border-2 ${to === id ? "border-pink-400 bg-pink-500 text-white" : "border-slate-200 bg-white text-slate-600"}`}>{l}</button>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={140} onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="mis. Abi bangga kamu rajin hari ini!" className="flex-1 min-w-0 px-3 py-2 rounded-xl border-2 border-slate-200 text-sm" />
        <button onClick={send} disabled={busy || !text.trim()}
          className="press-btn bg-pink-500 hover:bg-pink-600 text-white font-semibold px-4 py-2 rounded-xl text-sm disabled:opacity-50">Kirim</button>
      </div>
      <div className="text-[11px] text-slate-400 text-right">{text.length}/140</div>
      {rows && rows.length > 0 && (
        <div className="space-y-1.5">
          {rows.slice(0, 5).map((m) => (
            <div key={m.id} className="flex items-start gap-2 bg-slate-50 rounded-xl px-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-700 break-words">“{m.text}”</div>
                <div className="text-[11px] text-slate-400">
                  untuk {name(m.child_id)} · {humanDateKey((m.created_at || "").slice(0, 10))} ·{" "}
                  {(m.read_by || []).length ? `✅ dibaca ${readBy(m)}` : "belum dibaca"}
                </div>
              </div>
              <button onClick={() => del(m)} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50" aria-label="Hapus"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
