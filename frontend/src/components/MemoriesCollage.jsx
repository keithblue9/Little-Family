import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Camera } from "lucide-react";
import api from "@/lib/api";
import { qk } from "@/lib/queries";
import { todayKey } from "@/lib/dates";
import BeforeAfter from "@/components/BeforeAfter";

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus",
  "September", "Oktober", "November", "Desember"];

function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Kenangan Bulan Ini — every mission photo from the month as a collage.
 * Pass `viewToken` to read through a grandparent's view link (no sign-in).
 */
export default function MemoriesCollage({ childId = null, viewToken = null, title = "Kenangan Bulan Ini" }) {
  const [month, setMonth] = useState(todayKey().slice(0, 7));
  const [open, setOpen] = useState(null);
  const { data, isLoading } = useQuery({
    queryKey: [...qk.memories(childId, month), viewToken || "me"],
    queryFn: async () => {
      if (viewToken) {
        const res = await fetch(`/api/public/view/${viewToken}/memories?month=${month}`);
        if (!res.ok) throw new Error("memories");
        return res.json();
      }
      return (await api.get("/memories", { params: { month, child_id: childId || undefined } })).data;
    },
    staleTime: 5 * 60_000,
  });
  const [y, m] = month.split("-").map(Number);
  const photos = data?.photos || [];

  return (
    <div className="bg-white rounded-3xl p-5 border-2 border-slate-100 chunky-shadow">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="font-fun font-bold text-lg text-slate-900 flex items-center gap-2">
          <Camera className="w-5 h-5 text-pink-500" /> {title}
        </h3>
        <div className="flex items-center gap-1">
          <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Bulan sebelumnya"
                  className="press-btn p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-sm font-semibold text-slate-600 w-28 text-center">{MONTHS[m - 1]} {y}</span>
          <button onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Bulan berikutnya"
                  disabled={month >= todayKey().slice(0, 7)}
                  className="press-btn p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>
      {isLoading ? (
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton-block aspect-square rounded-xl" />)}
        </div>
      ) : photos.length === 0 ? (
        <div className="text-sm text-slate-500 text-center py-6">
          Belum ada foto misi bulan ini. Foto sebelum/sesudah dari misi akan muncul di sini. 📸
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p, i) => (
              <button key={p.id} onClick={() => setOpen(p)}
                      className={`relative rounded-xl overflow-hidden bg-slate-100 ${i % 7 === 0 ? "col-span-2 row-span-2" : ""}`}>
                <img src={p.after || p.before} alt={p.title} loading="lazy" className="w-full h-full object-cover aspect-square" />
                <span className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent text-white text-[10px] font-semibold px-1.5 py-1 text-left truncate">
                  {p.avatar_emoji} {p.title}
                </span>
              </button>
            ))}
          </div>
          <div className="text-xs text-slate-500 mt-3">
            {photos.length} foto{data?.badges_earned ? ` · ${data.badges_earned} badge diraih` : ""}
          </div>
        </>
      )}
      {open && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setOpen(null)}
             role="dialog" aria-modal="true" aria-label={open.title}>
          <div className="bg-white rounded-2xl p-3 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <BeforeAfter before={open.before} after={open.after} alt={open.title} />
            <div className="mt-2 text-sm font-semibold text-slate-800">{open.avatar_emoji} {open.child_name} · {open.title}</div>
            <div className="text-xs text-slate-500">{open.date_key}</div>
            <button onClick={() => setOpen(null)} className="press-btn mt-3 w-full py-2 rounded-xl bg-slate-100 font-semibold text-sm">Tutup</button>
          </div>
        </div>
      )}
    </div>
  );
}
