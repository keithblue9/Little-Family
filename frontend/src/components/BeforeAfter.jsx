import { useState } from "react";

/**
 * Drag to compare a "before" and "after" photo of the same mission. With only
 * one of the two, it simply shows that picture.
 */
export default function BeforeAfter({ before, after, alt = "", className = "" }) {
  const [pos, setPos] = useState(50);
  if (!before && !after) return null;
  if (!before || !after) {
    return <img src={before || after} alt={alt} loading="lazy" className={`w-full rounded-xl object-cover ${className}`} />;
  }
  return (
    <div className={`relative w-full aspect-[4/3] rounded-xl overflow-hidden select-none bg-slate-100 ${className}`}>
      <img src={after} alt={`${alt} — sesudah`} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 overflow-hidden" style={{ width: `${pos}%` }}>
        <img src={before} alt={`${alt} — sebelum`} loading="lazy"
             className="absolute inset-0 h-full object-cover max-w-none" style={{ width: `${10000 / Math.max(pos, 1)}%` }} />
      </div>
      <div className="absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${pos}%` }} />
      <span className="absolute top-2 left-2 text-[10px] font-bold bg-black/50 text-white px-1.5 py-0.5 rounded">Sebelum</span>
      <span className="absolute top-2 right-2 text-[10px] font-bold bg-black/50 text-white px-1.5 py-0.5 rounded">Sesudah</span>
      <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))}
             aria-label="Geser untuk membandingkan" className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize" />
    </div>
  );
}
