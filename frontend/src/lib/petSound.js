/**
 * Pet voices, made on the spot with the Web Audio API — no sound files to
 * download, and nothing is created until the first time a pet speaks.
 *
 * Each species has a small "voice" (a few notes); the expression bends it:
 * happy is higher and doubled, sleepy and just-woke are low and long (a yawn),
 * angry is rough and short, sad sinks. Browsers only allow sound after a tap,
 * so a pet speaks aloud only once the child has touched the screen.
 */
const KEY = "pet:sound";
let ctx = null;
let unlocked = false;

export const soundOn = () => { try { return localStorage.getItem(KEY) !== "off"; } catch { return true; } };
export const setSoundOn = (on) => { try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* ignore */ } };
export const soundReady = () => unlocked && soundOn();

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

// The first touch anywhere unlocks sound for the rest of the visit.
if (typeof window !== "undefined") {
  const unlock = () => { unlocked = true; window.removeEventListener("pointerdown", unlock, true); window.removeEventListener("keydown", unlock, true); };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
}

function note(c, { type = "sine", f0, f1 = f0, at = 0, dur = 0.2, gain = 0.14, vib = 0, lp = 0 }) {
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.04, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let node = osc;
  if (lp) { const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp; osc.connect(f); node = f; }
  node.connect(g).connect(c.destination);
  if (vib) {
    const lfo = c.createOscillator(); const lg = c.createGain();
    lfo.frequency.value = 7; lg.gain.value = vib; lfo.connect(lg).connect(osc.frequency);
    lfo.start(t0); lfo.stop(t0 + dur + 0.05);
  }
  osc.start(t0); osc.stop(t0 + dur + 0.05);
}

function hiss(c, { at = 0, dur = 0.25, gain = 0.1, freq = 4000, q = 0.8 }) {
  const t0 = c.currentTime + at;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain(); g.gain.setValueAtTime(gain, t0);
  src.connect(f).connect(g).connect(c.destination);
  src.start(t0);
}

// species → the notes of its call, scaled by pitch (p) and length (l)
const VOICES = {
  cat: (c, p, l) => note(c, { type: "triangle", f0: 520 * p, f1: 400 * p, dur: 0.5 * l, vib: 14, lp: 2400 }) || note(c, { type: "triangle", f0: 400 * p, f1: 820 * p, dur: 0.18 * l, gain: 0.1 }),
  chicken: (c, p, l) => [0, 0.16, 0.32].forEach((a) => note(c, { type: "square", f0: 560 * p, f1: 380 * p, at: a * l, dur: 0.11 * l, gain: 0.07, lp: 1800 })),
  bird: (c, p, l) => [0, 0.11, 0.22].forEach((a, i) => note(c, { f0: (1800 + i * 300) * p, f1: (2700 + i * 200) * p, at: a * l, dur: 0.09 * l, gain: 0.09 })),
  rabbit: (c, p, l) => note(c, { f0: 900 * p, f1: 1250 * p, dur: 0.12 * l, gain: 0.1 }),
  dragon: (c, p, l) => { note(c, { type: "sawtooth", f0: 170 * p, f1: 80 * p, dur: 0.7 * l, vib: 12, lp: 900, gain: 0.16 }); hiss(c, { dur: 0.5 * l, freq: 600, gain: 0.05 }); },
  hedgehog: (c, p, l) => [0, 0.14, 0.28].forEach((a) => hiss(c, { at: a * l, dur: 0.1 * l, freq: 2200 * p, gain: 0.07, q: 1.2 })),
  squirrel: (c, p, l) => Array.from({ length: 6 }, (_, i) => note(c, { type: "square", f0: 1500 * p, f1: 1150 * p, at: i * 0.07 * l, dur: 0.04 * l, gain: 0.05, lp: 3000 })),
  panda: (c, p, l) => note(c, { f0: 330 * p, f1: 270 * p, dur: 0.5 * l, vib: 9, gain: 0.13 }),
  fox: (c, p, l) => [0, 0.2].forEach((a) => note(c, { type: "triangle", f0: 800 * p, f1: 1500 * p, at: a * l, dur: 0.16 * l, gain: 0.11 })),
  turtle: (c, p, l) => note(c, { f0: 250 * p, f1: 330 * p, dur: 0.4 * l, gain: 0.1, vib: 5 }),
  koala: (c, p, l) => [0, 0.28].forEach((a) => note(c, { type: "sawtooth", f0: 150 * p, f1: 105 * p, at: a * l, dur: 0.24 * l, vib: 16, lp: 700, gain: 0.15 })),
  elephant: (c, p, l) => note(c, { type: "sawtooth", f0: 360 * p, f1: 640 * p, dur: 0.75 * l, vib: 18, lp: 1800, gain: 0.13 }) || note(c, { type: "sawtooth", f0: 640 * p, f1: 420 * p, at: 0.7 * l, dur: 0.25 * l, lp: 1500, gain: 0.1 }),
  spider: (c, p, l) => { Array.from({ length: 5 }, (_, i) => hiss(c, { at: i * 0.045 * l, dur: 0.02, freq: 3500, gain: 0.08, q: 3 })); note(c, { f0: 2300 * p, f1: 3000 * p, at: 0.26 * l, dur: 0.07, gain: 0.05 }); },
  penguin: (c, p, l) => [0, 0.2].forEach((a) => note(c, { type: "square", f0: 410 * p, f1: 520 * p, at: a * l, dur: 0.16 * l, gain: 0.07, lp: 1500 })),
  frog: (c, p, l) => [0, 0.17].forEach((a) => note(c, { type: "square", f0: 190 * p, f1: 250 * p, at: a * l, dur: 0.13 * l, gain: 0.09, lp: 900, vib: 40 })),
  monkey: (c, p, l) => [0, 0.17, 0.34].forEach((a, i) => note(c, { f0: (480 + i * 60) * p, f1: (700 + i * 40) * p, at: a * l, dur: 0.14 * l, gain: 0.11, vib: 10 })),
};

// How each expression bends the species' call: pitch, length, repeats, extras.
const MOODS = {
  neutral: { p: 1, l: 1 },
  happy: { p: 1.18, l: 0.8, twice: true },
  love: { p: 1.15, l: 0.9 },
  eating: { p: 1.1, l: 0.7, twice: true },
  surprised: { p: 1.35, l: 0.5 },
  sleepy: { p: 0.7, l: 1.9, quiet: true, yawn: true },
  bored: { p: 0.8, l: 1.5, quiet: true },
  wake: { p: 0.85, l: 1.4, yawn: true },
  angry: { p: 0.75, l: 0.75, rough: true },
  sad: { p: 0.82, l: 1.5, sink: true },
  hungry: { p: 0.95, l: 1.2 },
};

/** Make `petType` say something in the voice of `mood`. Does nothing if sound is off or not yet allowed. */
export function playPetSound(petType, mood = "neutral") {
  if (!soundReady()) return;
  const c = audio();
  if (!c) return;
  const m = MOODS[mood] || MOODS.neutral;
  const voice = VOICES[petType] || VOICES.cat;
  try {
    if (m.yawn) { note(c, { type: "sine", f0: 520, f1: 210, dur: 0.9, gain: m.quiet ? 0.05 : 0.08, lp: 900 }); }
    const start = m.yawn ? 0.7 : 0;
    const play = (at) => setTimeout(() => voice(c, m.p, m.l), at * 1000);
    if (m.rough) hiss(c, { dur: 0.3, freq: 1400, gain: 0.08 });
    play(start);
    if (m.twice) play(start + 0.45 * m.l);
    if (m.sink) note(c, { f0: 400, f1: 180, at: start + 0.1, dur: 0.6, gain: 0.05, lp: 700 });
  } catch { /* sound is a nicety — never break the screen over it */ }
}
