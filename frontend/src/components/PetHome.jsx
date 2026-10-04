import { useState } from "react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import PetSprite from "@/components/PetSprite";

const WALLS = {
  wall_sky: "linear-gradient(#bfe6ff,#e8f6ff)", wall_night: "linear-gradient(#1e2a5a,#3b4a8a)",
  wall_forest: "linear-gradient(#b8e0a8,#dff2c8)", wall_space: "linear-gradient(#150d33,#3a1d6e)",
  wall_candy: "linear-gradient(#ffd1e8,#ffeaf5)",
};
const FLOORS = {
  floor_grass: "#8fc987", floor_wood: "#c89b6a", floor_sand: "#ecd9a3", floor_snow: "#eef4fb",
};
const MAX_ITEMS = 5;

/** The pet's room: a scene from what the child owns, and a small shop. */
export default function PetHome({ child, state, onChanged }) {
  const [tab, setTab] = useState("item");
  const [busy, setBusy] = useState(false);
  const { home, catalog, coins } = state;
  const by = (k) => catalog.find((c) => c.key === k);
  const act = async (fn, msg) => {
    setBusy(true);
    try { await fn(); if (msg) toast.success(msg); onChanged?.(); }
    catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };
  const base = `/children/${child.id}`;
  const buy = (it) => act(() => api.post(`${base}/pet-home/buy`, { item: it.key }), `${it.name} dibeli ${it.emoji}`);
  const place = (it) => {
    if (it.slot === "item") {
      const on = home.items.includes(it.key);
      if (!on && home.items.length >= MAX_ITEMS) { toast.error(`Maksimal ${MAX_ITEMS} barang di rumah — lepas satu dulu ya`); return; }
      act(() => api.post(`${base}/pet-home/set`, { items: on ? home.items.filter((k) => k !== it.key) : [...home.items, it.key] }));
    } else {
      act(() => api.post(`${base}/pet-home/set`, { [it.slot]: it.key }));
    }
  };
  const night = state.phase.key === "night";
  const shop = catalog.filter((c) => c.slot === tab);
  return (
    <div className="space-y-3">
      <div className="relative h-44 rounded-2xl overflow-hidden border-2 border-white shadow-inner"
           style={{ background: WALLS[home.wall] || WALLS.wall_sky, filter: night && home.wall !== "wall_night" && home.wall !== "wall_space" ? "brightness(.75)" : undefined }}>
        <div className="absolute inset-x-0 bottom-0 h-14" style={{ background: FLOORS[home.floor] || FLOORS.floor_grass }} />
        <div className="absolute inset-x-0 bottom-10 flex items-end justify-around px-3">
          {home.items.map((k) => <span key={k} className="text-4xl drop-shadow">{by(k)?.emoji}</span>)}
        </div>
        <div className="absolute left-1/2 -translate-x-1/2 bottom-3">
          <PetSprite petType={state.pet_type} stageIndex={state.stage_index} size={64} />
        </div>
        {night && <div className="absolute top-2 right-3 text-xl">🌙</div>}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-amber-700">🪙 {coins} koin</span>
        <div className="ml-auto flex gap-1">
          {[["item", "Barang"], ["wall", "Dinding"], ["floor", "Lantai"]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`press-btn px-3 py-1 rounded-lg text-xs font-bold border-2 ${tab === k ? "bg-indigo-500 border-indigo-500 text-white" : "bg-white border-slate-200 text-slate-600"}`}>{l}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {shop.map((it) => {
          const owned = home.owned.includes(it.key);
          const active = it.slot === "item" ? home.items.includes(it.key) : home[it.slot] === it.key;
          return (
            <button key={it.key} disabled={busy || (!owned && coins < it.price)}
              onClick={() => (owned ? place(it) : buy(it))}
              className={`press-btn rounded-xl border-2 p-2 text-center disabled:opacity-50 ${active ? "border-emerald-400 bg-emerald-50" : "border-slate-100 bg-white"}`}>
              <div className="text-2xl">{it.emoji}</div>
              <div className="text-[10px] font-bold text-slate-700 leading-tight">{it.name}</div>
              <div className={`text-[10px] font-semibold ${owned ? "text-emerald-600" : "text-amber-600"}`}>
                {owned ? (active ? "Terpasang ✓" : "Pasang") : `🪙 ${it.price}`}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
