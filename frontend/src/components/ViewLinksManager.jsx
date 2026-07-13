import { useCallback, useEffect, useState } from "react";
import { Users, Plus, Trash2, Copy, Check, Eye, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

export default function ViewLinksManager() {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("Kakek & Nenek");
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [freshLink, setFreshLink] = useState(null); // { id, token } — show the URL once right after creation

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/view-links");
      setLinks(data);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!label.trim()) return toast.error("Beri nama link ini, mis. 'Kakek & Nenek'");
    setCreating(true);
    try {
      const { data } = await api.post("/view-links", { label: label.trim() });
      toast.success("Link berhasil dibuat!");
      setFreshLink({ id: data.id, token: data.token });
      setLabel("Kakek & Nenek");
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (link) => {
    if (!window.confirm(`Cabut link "${link.label}"? Yang sudah punya link ini tidak akan bisa lihat lagi.`)) return;
    try {
      await api.delete(`/view-links/${link.id}`);
      toast.success("Link dicabut");
      if (freshLink?.id === link.id) setFreshLink(null);
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const openLink = async (link) => {
    try {
      const { data } = await api.get(`/view-links/${link.id}/token`);
      window.open(`${window.location.origin}/view/${data.token}`, "_blank");
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const copyExistingUrl = async (link) => {
    try {
      const { data } = await api.get(`/view-links/${link.id}/token`);
      await navigator.clipboard.writeText(`${window.location.origin}/view/${data.token}`);
      setCopiedId(link.id);
      toast.success("Link disalin!");
      setTimeout(() => setCopiedId(null), 2000);
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-fun font-bold text-lg text-slate-900 flex items-center gap-2">
          <Users className="w-5 h-5 text-indigo-500" /> Link untuk Kakek & Nenek
        </h3>
        <p className="text-sm text-slate-500 mt-1">
          Bagikan link ini ke keluarga besar — mereka bisa lihat progress anak-anak tanpa perlu login,
          dan tidak bisa mengubah apa pun.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value.slice(0, 60))}
          placeholder="Nama link, mis. Kakek & Nenek"
          className="flex-1 px-3 py-2 border-2 border-slate-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none"
        />
        <button
          onClick={create}
          disabled={creating}
          className="press-btn inline-flex items-center gap-1.5 bg-indigo-500 hover:bg-indigo-600 text-white font-semibold px-4 py-2 rounded-xl text-sm disabled:opacity-60"
        >
          <Plus className="w-4 h-4" /> {creating ? "Membuat…" : "Buat Link"}
        </button>
      </div>

      {freshLink && (
        <div className="bg-indigo-50 border-2 border-indigo-200 rounded-xl p-3">
          <div className="text-xs font-semibold text-indigo-700 mb-1">Link baru siap dibagikan:</div>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={`${window.location.origin}/view/${freshLink.token}`}
              className="flex-1 px-2 py-1.5 bg-white border border-indigo-200 rounded-lg text-xs font-mono text-slate-700"
              onClick={(e) => e.target.select()}
            />
            <button onClick={() => copyExistingUrl(freshLink)} className="press-btn p-2 rounded-lg bg-indigo-500 text-white hover:bg-indigo-600">
              {copiedId === freshLink.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center text-slate-400 py-4 text-sm">Memuat…</div>
      ) : links.length === 0 ? (
        <div className="text-center text-slate-400 py-4 text-sm">Belum ada link dibuat.</div>
      ) : (
        <div className="space-y-2">
          {links.map((link) => (
            <div key={link.id} className={`flex items-center gap-3 p-3 rounded-xl border-2 ${link.revoked ? "border-slate-100 bg-slate-50 opacity-60" : "border-slate-100"}`}>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-slate-800 flex items-center gap-2">
                  {link.label}
                  {link.revoked && <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-500">Dicabut</span>}
                </div>
                <div className="text-xs text-slate-400 flex items-center gap-1">
                  <Eye className="w-3 h-3" /> Dilihat {link.view_count || 0}x
                  {link.last_viewed_at && ` · terakhir ${new Date(link.last_viewed_at).toLocaleDateString("id-ID")}`}
                </div>
              </div>
              {!link.revoked && (
                <>
                  <button
                    onClick={() => copyExistingUrl(link)}
                    className="press-btn p-2 rounded-lg text-slate-400 hover:bg-slate-100"
                    title="Salin link"
                  >
                    {copiedId === link.id ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => openLink(link)}
                    className="press-btn p-2 rounded-lg text-slate-400 hover:bg-slate-100"
                    title="Buka pratinjau"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </button>
                  <button onClick={() => revoke(link)} className="press-btn p-2 rounded-lg text-red-400 hover:bg-red-50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
