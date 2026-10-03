import { useEffect, useState } from "react";

/**
 * Shown while a screen's code or first data is on its way. The shape mirrors
 * the real layout (header, a few cards) so the page doesn't jump when content
 * lands. If the wait runs long — a server waking from sleep — a friendly note
 * explains it instead of leaving a silent spinner.
 */
export default function PageSkeleton({ rows = 3, compact = false }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 2500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className={`${compact ? "" : "min-h-screen kid-shell"} px-4 py-6 md:px-8 font-parent`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <div className="skeleton-block w-12 h-12 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <div className="skeleton-block h-4 w-1/3 rounded-lg" />
            <div className="skeleton-block h-3 w-1/2 rounded-lg" />
          </div>
        </div>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="bg-white/70 rounded-2xl p-4 space-y-3 border border-white">
            <div className="skeleton-block h-4 w-2/5 rounded-lg" />
            <div className="skeleton-block h-3 w-full rounded-lg" />
            <div className="skeleton-block h-3 w-4/5 rounded-lg" />
          </div>
        ))}
        {slow && (
          <div className="text-center text-sm text-slate-500 pt-2 animate-fade-in">
            <div className="text-3xl mb-1 pet-wake">😴</div>
            Servernya baru bangun tidur, sebentar ya…
          </div>
        )}
        <span className="sr-only">Memuat…</span>
      </div>
    </div>
  );
}
