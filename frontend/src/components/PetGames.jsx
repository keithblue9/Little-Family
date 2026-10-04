import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

const GAMES = [
  { key: "catch", name: "Tangkap", emoji: "🍎", hint: "Ketuk makanan yang jatuh, hindari 💣!" },
  { key: "memory", name: "Memori", emoji: "🃏", hint: "Cari pasangan kartu yang sama." },
  { key: "guess", name: "Tebak", emoji: "🥤", hint: "Ke mana bolanya bersembunyi?" },
];

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * Three tiny games a child unlocks with tiket main (one per finished
 * section). Each reports a 0–100 score; the server turns it into koin and
 * keeps the daily limit, so this stays a treat rather than an escape.
 */
export default function PetGames({ child, state, onDone }) {
  const [playing, setPlaying] = useState(null);
  const [result, setResult] = useState(null);
  const blocked = state.tickets < 1 ? "Tiket main habis — selesaikan satu bagian untuk dapat tiket 🎟️"
    : state.games_left < 1 ? "Main hari ini sudah cukup — lanjut besok ya 🌙" : null;

  const finish = async (game, score) => {
    try {
      const { data } = await api.post(`/children/${child.id}/pet-game`, { game, score: clamp(Math.round(score), 0, 100) });
      setResult({ game, score: Math.round(score), coins: data.coins });
      onDone?.();
    } catch (e) {
      toast.error(formatApiError(e));
    }
    setPlaying(null);
  };

  if (playing) {
    const Game = { catch: CatchGame, memory: MemoryGame, guess: GuessGame }[playing];
    return <Game onFinish={(score) => finish(playing, score)} onCancel={() => setPlaying(null)} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-sm">
        <span className="font-semibold text-slate-700">🎟️ Tiket: {state.tickets}</span>
        <span className="text-slate-500">· sisa main hari ini: {state.games_left}</span>
      </div>
      {result && (
        <div className="rounded-2xl bg-amber-50 border-2 border-amber-200 px-4 py-3 text-sm text-amber-900">
          Skor <b>{result.score}</b> → <b>+{result.coins} koin 🪙</b> {result.score >= 80 ? "— hebat sekali! 🏆" : ""}
        </div>
      )}
      {blocked && <div className="rounded-xl bg-slate-50 text-slate-600 text-sm px-3 py-2">{blocked}</div>}
      <div className="grid grid-cols-3 gap-2">
        {GAMES.map((g) => (
          <button key={g.key} disabled={!!blocked} onClick={() => { setResult(null); setPlaying(g.key); }}
            className="press-btn rounded-2xl border-2 border-slate-100 bg-white p-3 text-center disabled:opacity-50">
            <div className="text-3xl">{g.emoji}</div>
            <div className="font-fun font-bold text-sm text-slate-800">{g.name}</div>
            <div className="text-[10px] text-slate-500 leading-tight mt-0.5">{g.hint}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Frame({ title, right, children, onCancel }) {
  return (
    <div className="rounded-2xl border-2 border-indigo-100 bg-white p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="font-fun font-bold text-slate-800">{title}</span>
        <span className="ml-auto text-sm font-semibold text-indigo-600">{right}</span>
        <button onClick={onCancel} className="text-xs text-slate-400 underline">Berhenti</button>
      </div>
      {children}
    </div>
  );
}

// ---- Tangkap: tap what falls, avoid the bombs (15 seconds) -----------------
const FOODS = ["🍎", "🍌", "🍓", "🥕", "🍇"];
function CatchGame({ onFinish, onCancel }) {
  const [items, setItems] = useState([]);
  const [caught, setCaught] = useState(0);
  const [left, setLeft] = useState(15);
  const score = useRef(0);
  const idRef = useRef(0);
  const done = useRef(false);

  useEffect(() => {
    const spawn = setInterval(() => {
      const id = ++idRef.current;
      setItems((a) => [...a.slice(-12), { id, x: 6 + Math.random() * 78, emoji: Math.random() < 0.22 ? "💣" : FOODS[id % FOODS.length] }]);
    }, 650);
    const tick = setInterval(() => setLeft((t) => t - 1), 1000);
    return () => { clearInterval(spawn); clearInterval(tick); };
  }, []);
  useEffect(() => {
    if (left <= 0 && !done.current) { done.current = true; onFinish(clamp(score.current * 8, 0, 100)); }
  }, [left]); // eslint-disable-line react-hooks/exhaustive-deps

  const hit = (it) => {
    setItems((a) => a.filter((x) => x.id !== it.id));
    score.current = Math.max(0, score.current + (it.emoji === "💣" ? -2 : 1));
    setCaught(score.current);
    if (navigator.vibrate) navigator.vibrate(it.emoji === "💣" ? [30, 30] : 10);
  };

  return (
    <Frame title="🍎 Tangkap!" right={`${caught} poin · ${Math.max(0, left)} dtk`} onCancel={onCancel}>
      <div className="relative h-56 rounded-xl overflow-hidden bg-gradient-to-b from-sky-100 to-emerald-100 touch-none">
        <AnimatePresence>
          {items.map((it) => (
            <motion.button key={it.id} initial={{ top: -30, opacity: 1 }} animate={{ top: 230 }} exit={{ opacity: 0, scale: 1.5 }}
              transition={{ duration: 2.6, ease: "linear" }} onAnimationComplete={() => setItems((a) => a.filter((x) => x.id !== it.id))}
              onPointerDown={() => hit(it)} className="absolute text-3xl select-none" style={{ left: `${it.x}%` }}
              aria-label={it.emoji === "💣" ? "Bom" : "Makanan"}>
              {it.emoji}
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    </Frame>
  );
}

// ---- Memori: 8 cards, find the 4 pairs -------------------------------------
function MemoryGame({ onFinish, onCancel }) {
  const deck = useMemo(() => {
    const faces = ["🐶", "🐱", "🐰", "🦊"];
    return [...faces, ...faces].map((f, i) => ({ i, f, r: Math.random() })).sort((a, b) => a.r - b.r);
  }, []);
  const [open, setOpen] = useState([]);
  const [matched, setMatched] = useState([]);
  const [moves, setMoves] = useState(0);
  const lock = useRef(false);

  const flip = (card) => {
    if (lock.current || open.includes(card.i) || matched.includes(card.i)) return;
    const next = [...open, card.i];
    setOpen(next);
    if (next.length === 2) {
      setMoves((m) => m + 1);
      lock.current = true;
      const [a, b] = next.map((i) => deck.find((c) => c.i === i));
      setTimeout(() => {
        if (a.f === b.f) {
          const all = [...matched, a.i, b.i];
          setMatched(all);
          if (all.length === deck.length) onFinish(clamp(100 - Math.max(0, moves + 1 - 5) * 12, 25, 100));
        }
        setOpen([]);
        lock.current = false;
      }, 700);
    }
  };

  return (
    <Frame title="🃏 Memori" right={`${moves} langkah`} onCancel={onCancel}>
      <div className="grid grid-cols-4 gap-2">
        {deck.map((c) => {
          const shown = open.includes(c.i) || matched.includes(c.i);
          return (
            <button key={c.i} onClick={() => flip(c)}
              className={`press-btn h-16 rounded-xl text-3xl flex items-center justify-center border-2 ${
                matched.includes(c.i) ? "bg-emerald-50 border-emerald-200" : shown ? "bg-white border-indigo-300" : "bg-indigo-500 border-indigo-600 text-white"}`}>
              {shown ? c.f : "?"}
            </button>
          );
        })}
      </div>
    </Frame>
  );
}

// ---- Tebak: where is the ball? (3 rounds, the cups shuffle) -----------------
function GuessGame({ onFinish, onCancel }) {
  const [round, setRound] = useState(1);
  const [order, setOrder] = useState([0, 1, 2]);   // which cup sits in each slot
  const [ball, setBall] = useState(() => Math.floor(Math.random() * 3));
  const [phase, setPhase] = useState("show");      // show → shuffle → pick → reveal
  const [right, setRight] = useState(0);
  const [picked, setPicked] = useState(null);
  const timers = useRef([]);
  const later = (fn, ms) => { timers.current.push(setTimeout(fn, ms)); };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    if (phase === "show") {
      later(() => {
        setPhase("shuffle");
        for (let s = 1; s <= 6; s += 1) {
          later(() => setOrder((o) => { const a = [...o]; const i = Math.floor(Math.random() * 3); const j = (i + 1 + Math.floor(Math.random() * 2)) % 3; [a[i], a[j]] = [a[j], a[i]]; return a; }), s * 380);
        }
        later(() => setPhase("pick"), 7 * 380);
      }, 1300);
    }
  }, [phase, round]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (cup) => {
    if (phase !== "pick") return;
    setPicked(cup);
    setPhase("reveal");
    const ok = cup === ball;
    const total = right + (ok ? 1 : 0);
    if (ok) setRight(total);
    later(() => {
      if (round >= 3) { onFinish((total / 3) * 100); return; }
      setRound((r) => r + 1); setBall(Math.floor(Math.random() * 3)); setOrder([0, 1, 2]); setPicked(null); setPhase("show");
    }, 1300);
  };

  const lifted = (cup) => phase === "show" ? cup === ball : phase === "reveal" ? cup === ball || cup === picked : false;
  return (
    <Frame title="🥤 Tebak bolanya" right={`Ronde ${round}/3 · benar ${right}`} onCancel={onCancel}>
      <div className="text-xs text-slate-500 text-center">
        {{ show: "Lihat dulu bolanya…", shuffle: "Ikuti terus…", pick: "Ketuk gelas yang ada bolanya!", reveal: picked === ball ? "Benar! 🎉" : "Hampir! 😅" }[phase]}
      </div>
      <div className="relative h-24">
        {[0, 1, 2].map((cup) => (
          <motion.button key={cup} layout animate={{ left: `${order.indexOf(cup) * 33 + 5}%` }} transition={{ duration: 0.3 }}
            onClick={() => pick(cup)} className="absolute top-0 w-[26%] text-center select-none">
            <motion.div animate={{ y: lifted(cup) ? -16 : 0 }} className="text-5xl">🥤</motion.div>
            {lifted(cup) && cup === ball && <div className="text-2xl -mt-2">⚽</div>}
          </motion.button>
        ))}
      </div>
    </Frame>
  );
}
