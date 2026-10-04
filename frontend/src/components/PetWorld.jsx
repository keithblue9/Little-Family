import { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { humanDateKey } from "@/lib/dates";
import PetSprite from "@/components/PetSprite";
import PetHome from "@/components/PetHome";
import PetGames from "@/components/PetGames";

/**
 * Everything around the pet besides feeding it: what it says, what it needs,
 * its path, a play date with a sibling's pet, its room, games and journal.
 * `state` comes from GET /children/{id}/pet; `reload` refreshes it.
 */
export default function PetWorld({ child, state, reload, onChanged }) {
  const [tab, setTab] = useState(null);
  const [journal, setJournal] = useState(null);
  const [busy, setBusy] = useState(false);
  const base = `/children/${child.id}`;
  const run = async (fn, msg) => {
    setBusy(true);
    try { await fn(); if (msg) toast.success(msg); await reload(); onChanged?.(); }
    catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  if (!state?.has_pet || state.dead) return null;
  const cost = state.care_cost;
  const open = async (k) => {
    const next = tab === k ? null : k;
    setTab(next);
    if (next === "journal") {
      try { const { data } = await api.get(`${base}/pet-journal`, { fresh: true }); setJournal(data); } catch { setJournal([]); }
    }
  };
  const tabBtn = (k, label) => (
    <button key={k} onClick={() => open(k)}
      className={`press-btn flex-1 py-2 rounded-xl text-xs font-fun font-bold border-2 ${tab === k ? "bg-indigo-500 border-indigo-500 text-white" : "bg-white border-slate-100 text-slate-600"}`}>
      {label}
    </button>
  );

  return (
    <div className="mt-3 space-y-3">
      {state.message && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl bg-pink-50 border-2 border-pink-200 p-3 flex items-start gap-2">
          <span className="text-2xl">💌</span>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-bold text-pink-700">Pesan dari {state.message.from || "orang tua"} lewat peliharaanmu</div>
            <div className="font-fun text-slate-800 break-words">“{state.message.text}”</div>
          </div>
          <button disabled={busy} onClick={() => run(() => api.post(`/pet-messages/${state.message.id}/read`), "Pesannya disimpan di jurnal 💛")}
            className="press-btn shrink-0 px-3 py-1.5 rounded-xl bg-pink-500 text-white text-xs font-bold">Terima 💛</button>
        </motion.div>
      )}

      {state.path_available && (
        <div className="rounded-2xl bg-violet-50 border-2 border-violet-200 p-3 space-y-2">
          <div className="font-fun font-bold text-violet-900">🌟 Peliharaanmu sudah remaja! Dia mau tumbuh jadi apa?</div>
          <div className="grid grid-cols-3 gap-2">
            {state.paths.map((p) => (
              <button key={p.key} disabled={busy} onClick={() => run(() => api.post(`${base}/pet-path`, { path: p.key }), `Dia tumbuh jadi ${p.label} ${p.icon}`)}
                className="press-btn rounded-xl bg-white border-2 border-violet-100 py-2 text-center">
                <div className="text-2xl">{p.icon}</div>
                <div className="text-xs font-bold text-slate-800">{p.label}</div>
              </button>
            ))}
          </div>
          <div className="text-[11px] text-violet-700">Pemberani sering membawa koin, Pintar membawa pakan, Penyayang membawa tiket main.</div>
        </div>
      )}

      <div className="rounded-2xl bg-white border-2 border-slate-100 p-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Need icon="🍖" label="Pakan" n={state.feed_balance} />
          <Need icon="💧" label="Air" n={state.water_balance} action="Beri minum" disabled={busy || state.water_balance < cost}
                onClick={() => run(() => api.post(`${base}/pet-care`, { kind: "water" }), "Glek glek… segar! 💧")} cost={cost} />
          <Need icon="🎾" label="Mainan" n={state.play_balance} action="Main" disabled={busy || state.play_balance < cost}
                onClick={() => run(() => api.post(`${base}/pet-care`, { kind: "play" }), "Seru! +1 koin 🪙")} cost={cost} />
        </div>
        <div className="text-[11px] text-slate-500 mt-2 text-center">
          Tiap bagian hari memberi pakan, air, atau mainan — lihat tandanya di judul bagian. 🎟️ {state.tickets} tiket · 🪙 {state.coins} koin
        </div>
      </div>

      {state.playdate && (
        <PlaydateCard child={child} pd={state.playdate} state={state} busy={busy}
          onClaim={() => run(() => api.post(`${base}/pet-playdate`), "Main bareng seru! +3 koin 🎪")} />
      )}

      <div className="flex gap-2">
        {tabBtn("home", "🏠 Rumah")}
        {tabBtn("games", "🎮 Main")}
        {tabBtn("journal", "📖 Jurnal")}
      </div>
      {tab === "home" && <PetHome child={child} state={state} onChanged={() => { reload(); onChanged?.(); }} />}
      {tab === "games" && <PetGames child={child} state={state} onDone={reload} />}
      {tab === "journal" && (
        <div className="rounded-2xl bg-white border-2 border-slate-100 p-3 space-y-1.5 max-h-72 overflow-y-auto">
          {journal === null ? <div className="text-sm text-slate-400">Memuat…</div>
            : journal.length === 0 ? <div className="text-sm text-slate-400">Belum ada cerita. Rawat peliharaanmu dan ceritanya muncul di sini ✨</div>
              : journal.map((j) => (
                <div key={j.id} className="flex gap-2 text-sm">
                  <span>{j.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-700 break-words">{j.text}</div>
                    <div className="text-[10px] text-slate-400">{humanDateKey(j.date_key)}</div>
                  </div>
                </div>
              ))}
        </div>
      )}
    </div>
  );
}

function Need({ icon, label, n, action, onClick, disabled, cost }) {
  return (
    <div className="rounded-xl bg-slate-50 py-2">
      <div className="text-2xl">{icon}</div>
      <div className="text-[11px] font-bold text-slate-600">{label}: {n}</div>
      {action && (
        <button onClick={onClick} disabled={disabled} title={`${cost} ${label.toLowerCase()}`}
          className="press-btn mt-1 px-2.5 py-1 rounded-lg bg-indigo-500 text-white text-[11px] font-bold disabled:bg-slate-200 disabled:text-slate-400">
          {action} ({cost})
        </button>
      )}
    </div>
  );
}

function PlaydateCard({ pd, state, busy, onClaim }) {
  return (
    <div className="rounded-2xl bg-sky-50 border-2 border-sky-200 p-3">
      <div className="flex items-end justify-center gap-1">
        <PetSprite petType={state.pet_type} stageIndex={state.stage_index} size={44} />
        <span className="text-base pb-3">💞</span>
        <PetSprite petType={pd.mate_pet} stageIndex={pd.mate_stage} size={44} />
      </div>
      <div className="text-center text-xs font-semibold text-sky-900 mt-1">
        Kamu dan {pd.mate_name} sama-sama sudah menyelesaikan bagian hari ini!
      </div>
      <button onClick={onClaim} disabled={busy || pd.claimed}
        className="press-btn mt-2 w-full py-2 rounded-xl bg-sky-500 text-white font-fun font-bold text-sm disabled:bg-slate-200 disabled:text-slate-500">
        {pd.claimed ? "Sudah main bareng hari ini 🎪" : "Main bareng! (+3 koin)"}
      </button>
    </div>
  );
}
