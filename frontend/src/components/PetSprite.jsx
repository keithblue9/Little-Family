/**
 * PetSprite — original, hand-built SVG creatures for the virtual pet.
 *
 * Every pet is drawn in one consistent "soft vinyl toy" style: rounded bodies,
 * simple bean eyes, blush cheeks, a friendly closed smile. That shared visual
 * grammar is what makes the 10 species read as one coherent collectible set
 * (rather than 10 clashing clip-arts), while each keeps a distinctive
 * silhouette + palette.
 *
 * Four growth stages per pet:
 *   0 Telur  — a species-tinted egg with speckles (same egg shape for all,
 *              so hatching feels like a reveal)
 *   1 Bayi   — small, big-headed, tiny body
 *   2 Remaja — mid-size, more defined features
 *   3 Dewasa — full-size with the species' signature accent (wings, tail, etc.)
 *
 * These are pure inline SVG (no external assets, no network) so they render
 * instantly and animate crisply. All coordinates live in a 100×100 viewBox;
 * the parent scales via width/height.
 */

// Per-pet palette + a couple of shape switches. Keeping the data tiny and the
// drawing logic shared means all 40 combinations stay visually consistent and
// there's only one code path to keep bug-free.
const PETS = {
  chicken:  { body: "#FFE08A", belly: "#FFF3C4", accent: "#FF9D23", dark: "#E07A1B", ear: "none",  tail: "feather", extra: "comb" },
  bird:     { body: "#8FD3FF", belly: "#D6F0FF", accent: "#4DB8FF", dark: "#2E90D6", ear: "none",  tail: "feather", extra: "beak" },
  rabbit:   { body: "#F5D9E8", belly: "#FFF0F7", accent: "#F08FBF", dark: "#D96BA3", ear: "long",  tail: "puff",    extra: "none" },
  cat:      { body: "#FFCF9E", belly: "#FFEAD6", accent: "#FF9D5C", dark: "#E0763A", ear: "point", tail: "curl",    extra: "whisker" },
  dragon:   { body: "#B8E986", belly: "#E4F7C9", accent: "#7 CB342", dark: "#5A9E2E", ear: "point", tail: "spike",   extra: "wing" },
  hedgehog: { body: "#C7A98E", belly: "#F0E2D2", accent: "#8B6A4E", dark: "#6E5238", ear: "round", tail: "none",    extra: "spikes" },
  squirrel: { body: "#E0A46E", belly: "#F7E0C4", accent: "#C77E43", dark: "#9E5F2E", ear: "round", tail: "bushy",   extra: "none" },
  panda:    { body: "#F2F2F2", belly: "#FFFFFF", accent: "#2E2E2E", dark: "#1A1A1A", ear: "round", tail: "puff",    extra: "pandaface" },
  fox:      { body: "#FF9D5C", belly: "#FFF0E0", accent: "#E0763A", dark: "#B85826", ear: "point", tail: "foxtail", extra: "none" },
  turtle:   { body: "#8FD3A8", belly: "#DFF5E7", accent: "#4CA46C", dark: "#2E7A4C", ear: "none",  tail: "none",    extra: "shell" },
  koala:    { body: "#B9C0C9", belly: "#E9EDF1", accent: "#4A4F57", dark: "#7C838D", ear: "biground", tail: "none", extra: "koalanose" },
  elephant: { body: "#AFC0D1", belly: "#DCE6F0", accent: "#F29CB1", dark: "#7C8FA3", ear: "flap", tail: "thin", extra: "trunk", noMouth: true },
  spider:   { body: "#7A5BC9", belly: "#C9B8F5", accent: "#E8506E", dark: "#4B3590", ear: "none", tail: "none", extra: "legs" },
  penguin:  { body: "#35415E", belly: "#FFFFFF", accent: "#FFA726", dark: "#1E2740", ear: "none", tail: "none", extra: "penguin" },
  frog:     { body: "#7ED36B", belly: "#E6F8BE", accent: "#E4572E", dark: "#4E9E3F", ear: "none", tail: "none", extra: "frog", wideMouth: true },
  monkey:   { body: "#B3794D", belly: "#F3D9B6", accent: "#8A5A36", dark: "#6E4526", ear: "monkey", tail: "curl", extra: "monkeyface" },
};

import { useEffect, useState } from "react";

// Cheeks + eyes + mouth, shared by every species. `mood` picks the expression:
// neutral, happy, sleepy, wake (just woke up), angry, sad, hungry, love,
// surprised, eating, bored. Eyes live in ".ps-eyes" so the CSS blink can squash them.
const HEART = "M0 3 C-4 -1 -4 -5 0 -3 C4 -5 4 -1 0 3 Z";
function Face({ cx = 50, cy = 48, s = 1, dark = "#333", mood = "neutral", eyeY: eyeYOver, eyeDx: dxOver, wide = false, noMouth = false }) {
  const eyeDx = (dxOver ?? 9) * s;
  const eyeY = eyeYOver ?? cy - 2 * s;
  const eyeR = 3.1 * s * (mood === "surprised" ? 1.35 : 1);
  const L = cx - eyeDx;
  const R = cx + eyeDx;
  const sw = 1.6 * s;
  const stroke = { stroke: dark, strokeWidth: sw, fill: "none", strokeLinecap: "round" };
  const my = cy + 6 * s;               // mouth line
  const mw = (wide ? 8 : 4) * s;       // half-width of the mouth

  let eyes;
  if (mood === "happy" || mood === "eating") {
    eyes = [L, R].map((x) => <path key={x} d={`M ${x - 3.2 * s} ${eyeY + 1.2 * s} Q ${x} ${eyeY - 3.6 * s} ${x + 3.2 * s} ${eyeY + 1.2 * s}`} {...stroke} />);
  } else if (mood === "sleepy") {
    eyes = [L, R].map((x) => <path key={x} d={`M ${x - 3.2 * s} ${eyeY} Q ${x} ${eyeY + 3 * s} ${x + 3.2 * s} ${eyeY}`} {...stroke} />);
  } else if (mood === "love") {
    eyes = [L, R].map((x) => <path key={x} d={HEART} transform={`translate(${x} ${eyeY}) scale(${0.95 * s})`} fill="#E91E63" />);
  } else {
    const ry = mood === "wake" || mood === "bored" ? eyeR * 0.55 : eyeR;
    eyes = (
      <>
        {[L, R].map((x) => <ellipse key={x} cx={x} cy={eyeY + (ry < eyeR ? eyeR * 0.3 : 0)} rx={eyeR} ry={ry} fill={dark} />)}
        {ry === eyeR && [L, R].map((x) => <circle key={`h${x}`} cx={x + 1 * s} cy={eyeY - 1 * s} r={0.9 * s} fill="#fff" />)}
      </>
    );
  }

  let brows = null;
  if (mood === "angry") {
    brows = (<><path d={`M ${L - 4.5 * s} ${eyeY - 5.5 * s} L ${L + 3.5 * s} ${eyeY - 2.5 * s}`} {...stroke} strokeWidth={sw * 1.3} />
      <path d={`M ${R + 4.5 * s} ${eyeY - 5.5 * s} L ${R - 3.5 * s} ${eyeY - 2.5 * s}`} {...stroke} strokeWidth={sw * 1.3} /></>);
  } else if (mood === "sad") {
    brows = (<><path d={`M ${L - 4 * s} ${eyeY - 3 * s} L ${L + 3.5 * s} ${eyeY - 6 * s}`} {...stroke} />
      <path d={`M ${R + 4 * s} ${eyeY - 3 * s} L ${R - 3.5 * s} ${eyeY - 6 * s}`} {...stroke} /></>);
  }

  let mouth;
  if (noMouth) mouth = null;
  else if (mood === "happy") {
    mouth = (<g><path d={`M ${cx - mw * 1.2} ${my - 0.5 * s} Q ${cx} ${my + 9 * s} ${cx + mw * 1.2} ${my - 0.5 * s} Z`} fill="#8B2E2E" stroke={dark} strokeWidth={sw * 0.8} strokeLinejoin="round" />
      <ellipse cx={cx} cy={my + 4.2 * s} rx={2.4 * s} ry={1.5 * s} fill="#FF8FA3" /></g>);
  } else if (mood === "eating") {
    mouth = <ellipse className="ps-chew" cx={cx} cy={my + 2 * s} rx={3.2 * s} ry={2.4 * s} fill="#8B2E2E" stroke={dark} strokeWidth={sw * 0.7} />;
  } else if (mood === "wake") {
    mouth = (<g><ellipse cx={cx} cy={my + 3 * s} rx={4.2 * s} ry={5 * s} fill="#8B2E2E" stroke={dark} strokeWidth={sw * 0.8} />
      <ellipse cx={cx} cy={my + 6 * s} rx={2.6 * s} ry={1.8 * s} fill="#FF8FA3" /></g>);
  } else if (mood === "sleepy") {
    mouth = <ellipse cx={cx} cy={my + 2.5 * s} rx={1.7 * s} ry={2.1 * s} fill={dark} opacity="0.65" />;
  } else if (mood === "angry") {
    mouth = <path d={`M ${cx - mw} ${my + 4 * s} Q ${cx} ${my - 0.5 * s} ${cx + mw} ${my + 4 * s}`} {...stroke} />;
  } else if (mood === "sad") {
    mouth = <path d={`M ${cx - mw} ${my + 4 * s} Q ${cx} ${my + 0.5 * s} ${cx + mw} ${my + 4 * s}`} {...stroke} />;
  } else if (mood === "hungry") {
    mouth = <path d={`M ${cx - mw} ${my + 2 * s} q ${mw / 2} ${-3 * s} ${mw} 0 t ${mw} 0`} {...stroke} />;
  } else if (mood === "surprised") {
    mouth = <ellipse cx={cx} cy={my + 3 * s} rx={2.5 * s} ry={3.2 * s} fill="#8B2E2E" stroke={dark} strokeWidth={sw * 0.7} />;
  } else if (mood === "bored") {
    mouth = <path d={`M ${cx - mw} ${my + 3 * s} L ${cx + mw} ${my + 3 * s}`} {...stroke} />;
  } else {
    mouth = <path d={`M ${cx - mw} ${my} Q ${cx} ${my + 3.5 * s} ${cx + mw} ${my}`} {...stroke} />;
  }

  return (
    <g>
      <ellipse cx={cx - 14 * s} cy={cy + 5 * s} rx={4.2 * s} ry={2.8 * s} fill="#FF9BB3" opacity={mood === "happy" || mood === "love" ? 0.8 : 0.55} />
      <ellipse cx={cx + 14 * s} cy={cy + 5 * s} rx={4.2 * s} ry={2.8 * s} fill="#FF9BB3" opacity={mood === "happy" || mood === "love" ? 0.8 : 0.55} />
      <g className={mood === "neutral" || mood === "hungry" || mood === "surprised" || mood === "angry" || mood === "sad" ? "ps-eyes" : undefined}>{eyes}</g>
      {brows}
      {mouth}
      {mood === "angry" && (
        <g stroke="#E53935" strokeWidth={1.6 * s} strokeLinecap="round" className="ps-puff">
          <path d={`M ${cx + 17 * s} ${cy - 15 * s} l ${4 * s} ${-3 * s} M ${cx + 17 * s} ${cy - 18 * s} l ${4 * s} ${3 * s} M ${cx + 15 * s} ${cy - 16.5 * s} h ${-3 * s}`} />
        </g>
      )}
      {mood === "sad" && <path d={`M ${R + 1 * s} ${eyeY + 4.5 * s} q ${-1.6 * s} ${3.4 * s} 0 ${4.4 * s} q ${1.6 * s} ${-1 * s} 0 ${-4.4 * s} Z`} fill="#6EC6FF" />}
      {mood === "hungry" && <path d={`M ${cx + mw * 1.6} ${my + 3 * s} q ${-1.4 * s} ${3 * s} 0 ${4 * s} q ${1.4 * s} ${-1 * s} 0 ${-4 * s} Z`} fill="#8FD3FF" />}
    </g>
  );
}

function Egg({ p }) {
  return (
    <g>
      <ellipse cx="50" cy="86" rx="20" ry="6" fill="#000" opacity="0.08" />
      <path
        d="M50 18 C64 18 74 42 74 60 C74 78 63 90 50 90 C37 90 26 78 26 60 C26 42 36 18 50 18 Z"
        fill={p.belly}
        stroke={p.accent}
        strokeWidth="2.5"
      />
      {/* speckles in species color */}
      <circle cx="42" cy="46" r="3.4" fill={p.accent} opacity="0.55" />
      <circle cx="58" cy="56" r="4.2" fill={p.accent} opacity="0.45" />
      <circle cx="47" cy="66" r="2.8" fill={p.accent} opacity="0.5" />
      <circle cx="60" cy="40" r="2.2" fill={p.accent} opacity="0.4" />
      {/* subtle shine */}
      <ellipse cx="43" cy="34" rx="5" ry="8" fill="#fff" opacity="0.4" transform="rotate(-20 43 34)" />
    </g>
  );
}

// Ears rendered behind the head so the head circle overlaps their base.
function Ears({ p, cx, cy, s }) {
  if (p.ear === "long") {
    // rabbit
    return (
      <g>
        <ellipse cx={cx - 9 * s} cy={cy - 26 * s} rx={4.5 * s} ry={15 * s} fill={p.body} stroke={p.dark} strokeWidth="1.2" transform={`rotate(-12 ${cx - 9 * s} ${cy - 26 * s})`} />
        <ellipse cx={cx + 9 * s} cy={cy - 26 * s} rx={4.5 * s} ry={15 * s} fill={p.body} stroke={p.dark} strokeWidth="1.2" transform={`rotate(12 ${cx + 9 * s} ${cy - 26 * s})`} />
        <ellipse cx={cx - 9 * s} cy={cy - 26 * s} rx={2 * s} ry={10 * s} fill={p.accent} opacity="0.5" transform={`rotate(-12 ${cx - 9 * s} ${cy - 26 * s})`} />
        <ellipse cx={cx + 9 * s} cy={cy - 26 * s} rx={2 * s} ry={10 * s} fill={p.accent} opacity="0.5" transform={`rotate(12 ${cx + 9 * s} ${cy - 26 * s})`} />
      </g>
    );
  }
  if (p.ear === "point") {
    return (
      <g>
        <path d={`M ${cx - 15 * s} ${cy - 8 * s} L ${cx - 20 * s} ${cy - 24 * s} L ${cx - 6 * s} ${cy - 15 * s} Z`} fill={p.body} stroke={p.dark} strokeWidth="1.2" strokeLinejoin="round" />
        <path d={`M ${cx + 15 * s} ${cy - 8 * s} L ${cx + 20 * s} ${cy - 24 * s} L ${cx + 6 * s} ${cy - 15 * s} Z`} fill={p.body} stroke={p.dark} strokeWidth="1.2" strokeLinejoin="round" />
        <path d={`M ${cx - 14 * s} ${cy - 11 * s} L ${cx - 17 * s} ${cy - 20 * s} L ${cx - 9 * s} ${cy - 15 * s} Z`} fill={p.accent} opacity="0.5" />
        <path d={`M ${cx + 14 * s} ${cy - 11 * s} L ${cx + 17 * s} ${cy - 20 * s} L ${cx + 9 * s} ${cy - 15 * s} Z`} fill={p.accent} opacity="0.5" />
      </g>
    );
  }
  if (p.ear === "biground") {   // koala: big fluffy ears
    return (
      <g>
        <circle cx={cx - 17 * s} cy={cy - 12 * s} r={9.5 * s} fill={p.body} stroke={p.dark} strokeWidth="1.2" />
        <circle cx={cx + 17 * s} cy={cy - 12 * s} r={9.5 * s} fill={p.body} stroke={p.dark} strokeWidth="1.2" />
        <circle cx={cx - 17 * s} cy={cy - 12 * s} r={5.6 * s} fill="#F4C7D0" opacity="0.9" />
        <circle cx={cx + 17 * s} cy={cy - 12 * s} r={5.6 * s} fill="#F4C7D0" opacity="0.9" />
      </g>
    );
  }
  if (p.ear === "flap") {   // elephant: big floppy ears
    return (
      <g>
        <ellipse cx={cx - 23 * s} cy={cy + 1 * s} rx={11 * s} ry={14 * s} fill={p.body} stroke={p.dark} strokeWidth="1.2" />
        <ellipse cx={cx + 23 * s} cy={cy + 1 * s} rx={11 * s} ry={14 * s} fill={p.body} stroke={p.dark} strokeWidth="1.2" />
        <ellipse cx={cx - 23 * s} cy={cy + 2 * s} rx={6.5 * s} ry={9 * s} fill={p.accent} opacity="0.45" />
        <ellipse cx={cx + 23 * s} cy={cy + 2 * s} rx={6.5 * s} ry={9 * s} fill={p.accent} opacity="0.45" />
      </g>
    );
  }
  if (p.ear === "monkey") {
    return (
      <g>
        <circle cx={cx - 24 * s} cy={cy + 1 * s} r={7.5 * s} fill={p.body} stroke={p.dark} strokeWidth="1.2" />
        <circle cx={cx + 24 * s} cy={cy + 1 * s} r={7.5 * s} fill={p.body} stroke={p.dark} strokeWidth="1.2" />
        <circle cx={cx - 24 * s} cy={cy + 1 * s} r={4.4 * s} fill={p.belly} />
        <circle cx={cx + 24 * s} cy={cy + 1 * s} r={4.4 * s} fill={p.belly} />
      </g>
    );
  }
  if (p.ear === "round") {
    return (
      <g>
        <circle cx={cx - 13 * s} cy={cy - 16 * s} r={6 * s} fill={p.body} stroke={p.dark} strokeWidth="1.2" />
        <circle cx={cx + 13 * s} cy={cy - 16 * s} r={6 * s} fill={p.body} stroke={p.dark} strokeWidth="1.2" />
        {p.extra === "pandaface" && (
          <>
            <circle cx={cx - 13 * s} cy={cy - 16 * s} r={6 * s} fill={p.accent} />
            <circle cx={cx + 13 * s} cy={cy - 16 * s} r={6 * s} fill={p.accent} />
          </>
        )}
      </g>
    );
  }
  return null;
}

function Tail({ p, cx, cy, s }) {
  switch (p.tail) {
    case "bushy": // squirrel — big curling tail
      return <path d={`M ${cx + 14 * s} ${cy + 14 * s} q ${22 * s} ${2 * s} ${18 * s} ${-20 * s} q ${-3 * s} ${-14 * s} ${-14 * s} ${-8 * s} q ${10 * s} ${4 * s} ${6 * s} ${16 * s} q ${-3 * s} ${9 * s} ${-10 * s} ${12 * s} Z`} fill={p.body} stroke={p.dark} strokeWidth="1.2" strokeLinejoin="round" />;
    case "foxtail":
      return <path d={`M ${cx + 13 * s} ${cy + 16 * s} q ${20 * s} ${6 * s} ${16 * s} ${-14 * s} l ${-2 * s} ${8 * s} q ${-8 * s} ${8 * s} ${-14 * s} ${6 * s} Z`} fill={p.body} stroke={p.dark} strokeWidth="1.2" strokeLinejoin="round" />;
    case "curl": // cat
      return <path d={`M ${cx + 13 * s} ${cy + 16 * s} q ${16 * s} ${0} ${14 * s} ${-12 * s}`} stroke={p.dark} strokeWidth={4 * s} fill="none" strokeLinecap="round" />;
    case "spike": // dragon
      return <path d={`M ${cx + 12 * s} ${cy + 16 * s} q ${18 * s} ${4 * s} ${20 * s} ${-10 * s} l ${-5 * s} ${1 * s} l ${2 * s} ${-6 * s} l ${-6 * s} ${3 * s} q ${-6 * s} ${8 * s} ${-11 * s} ${6 * s} Z`} fill={p.accent} stroke={p.dark} strokeWidth="1.2" strokeLinejoin="round" />;
    case "thin": // elephant
      return <path d={`M ${cx + 14 * s} ${cy + 18 * s} q ${8 * s} ${2 * s} ${8 * s} ${-6 * s}`} stroke={p.dark} strokeWidth={2.4 * s} fill="none" strokeLinecap="round" />;
    case "puff":
      return <circle cx={cx + 15 * s} cy={cy + 14 * s} r={5 * s} fill={p.belly} stroke={p.dark} strokeWidth="1" />;
    case "feather":
      return (
        <g>
          <path d={`M ${cx + 12 * s} ${cy + 12 * s} q ${14 * s} ${-2 * s} ${16 * s} ${-14 * s}`} stroke={p.accent} strokeWidth={4 * s} fill="none" strokeLinecap="round" />
          <path d={`M ${cx + 12 * s} ${cy + 15 * s} q ${16 * s} ${2 * s} ${18 * s} ${-8 * s}`} stroke={p.dark} strokeWidth={3 * s} fill="none" strokeLinecap="round" opacity="0.7" />
        </g>
      );
    default:
      return null;
  }
}

function Creature({ petKey, stage, mood }) {
  const p = PETS[petKey] || PETS.chicken;
  // Fix a typo-safe accent (guard against stray spaces in data)
  const accent = (p.accent || "#999").replace(/\s+/g, "");
  const pp = { ...p, accent };

  // Stage-based proportions: babies are small & big-headed, adults full & balanced.
  const geo = {
    1: { headR: 20, cx: 50, cy: 46, bodyRx: 14, bodyRy: 12, bodyCy: 66, fs: 0.8 },
    2: { headR: 23, cx: 50, cy: 44, bodyRx: 18, bodyRy: 15, bodyCy: 68, fs: 0.92 },
    3: { headR: 25, cx: 50, cy: 43, bodyRx: 22, bodyRy: 18, bodyCy: 70, fs: 1.05 },
  }[stage] || { headR: 23, cx: 50, cy: 44, bodyRx: 18, bodyRy: 15, bodyCy: 68, fs: 0.92 };

  const { headR, cx, cy, bodyRx, bodyRy, bodyCy, fs } = geo;

  return (
    <g>
      {/* ground shadow */}
      <ellipse cx="50" cy="90" rx={bodyRx + 4} ry="5" fill="#000" opacity="0.08" />

      {/* dragon wings sit behind the body — gentle flap */}
      {pp.extra === "wing" && stage === 3 && (
        <g opacity="0.95" className="ps-wing">
          <path d={`M ${cx - bodyRx} ${bodyCy - 4} q ${-16} ${-10} ${-20} ${4} q ${8} ${-2} ${18} ${6} Z`} fill={pp.belly} stroke={pp.dark} strokeWidth="1.2" strokeLinejoin="round" />
          <path d={`M ${cx + bodyRx} ${bodyCy - 4} q ${16} ${-10} ${20} ${4} q ${-8} ${-2} ${-18} ${6} Z`} fill={pp.belly} stroke={pp.dark} strokeWidth="1.2" strokeLinejoin="round" />
        </g>
      )}

      {/* spider legs: four curved legs a side, behind the body */}
      {pp.extra === "legs" && (
        <g stroke={pp.dark} strokeWidth={2.6 * fs} strokeLinecap="round" fill="none" className="ps-tail">
          {[-1, 1].flatMap((d) => [0, 1, 2, 3].map((k) => (
            <path key={`${d}${k}`} d={`M ${cx + d * bodyRx * 0.7} ${bodyCy - 4 + k * 4} q ${d * (14 + k * 2) * fs} ${-10 + k * 3} ${d * (22 + k * 1.5) * fs} ${4 + k * 5}`} />
          )))}
        </g>
      )}
      {/* penguin flippers */}
      {pp.extra === "penguin" && (
        <g fill={pp.body} stroke={pp.dark} strokeWidth="1.2">
          <ellipse cx={cx - bodyRx - 2} cy={bodyCy - 1} rx={4.5 * fs} ry={10 * fs} transform={`rotate(14 ${cx - bodyRx - 2} ${bodyCy - 1})`} />
          <ellipse cx={cx + bodyRx + 2} cy={bodyCy - 1} rx={4.5 * fs} ry={10 * fs} transform={`rotate(-14 ${cx + bodyRx + 2} ${bodyCy - 1})`} />
          <ellipse cx={cx - 7 * fs} cy={bodyCy + bodyRy - 1} rx={6 * fs} ry={2.6 * fs} fill={pp.accent} stroke={pp.dark} />
          <ellipse cx={cx + 7 * fs} cy={bodyCy + bodyRy - 1} rx={6 * fs} ry={2.6 * fs} fill={pp.accent} stroke={pp.dark} />
        </g>
      )}

      {/* tail (behind body) — soft wag */}
      <g className="ps-tail">
        <Tail p={pp} cx={cx} cy={bodyCy - 6} s={fs} />
      </g>

      {/* ears (behind head) — occasional twitch */}
      <g className="ps-ears">
        <Ears p={pp} cx={cx} cy={cy} s={fs} />
      </g>

      {/* body — breathes (subtle squash from the feet) */}
      <g className="ps-breath">
        {pp.extra !== "shell" && (
          <ellipse cx={cx} cy={bodyCy} rx={bodyRx} ry={bodyRy} fill={pp.body} stroke={pp.dark} strokeWidth="1.4" />
        )}
        {/* turtle shell as body */}
        {pp.extra === "shell" && (
          <g>
            <ellipse cx={cx} cy={bodyCy} rx={bodyRx + 3} ry={bodyRy} fill={pp.accent} stroke={pp.dark} strokeWidth="1.4" />
            <path d={`M ${cx - bodyRx} ${bodyCy} h ${bodyRx * 2}`} stroke={pp.dark} strokeWidth="1" opacity="0.5" />
            <path d={`M ${cx} ${bodyCy - bodyRy} v ${bodyRy * 2}`} stroke={pp.dark} strokeWidth="1" opacity="0.5" />
            <ellipse cx={cx} cy={bodyCy} rx={bodyRx - 4} ry={bodyRy - 4} fill="none" stroke={pp.dark} strokeWidth="1" opacity="0.4" />
          </g>
        )}
        {/* belly patch */}
        {pp.extra !== "shell" && (
          <ellipse cx={cx} cy={bodyCy + 2} rx={bodyRx * 0.55} ry={bodyRy * 0.65} fill={pp.belly} opacity="0.85" />
        )}
        {/* body underside shade — a hint of volume */}
        <ellipse cx={cx} cy={bodyCy + bodyRy * 0.55} rx={bodyRx * 0.8} ry={bodyRy * 0.4} fill="#000" opacity="0.06" />
      </g>

      {/* head */}
      <circle cx={cx} cy={cy} r={headR} fill={pp.body} stroke={pp.dark} strokeWidth="1.4" />
      {/* soft top-left highlight — makes the head read as a rounded volume */}
      <ellipse cx={cx - headR * 0.35} cy={cy - headR * 0.42} rx={headR * 0.42} ry={headR * 0.28} fill="#fff" opacity="0.28" transform={`rotate(-22 ${cx - headR * 0.35} ${cy - headR * 0.42})`} />

      {/* panda eye patches */}
      {pp.extra === "pandaface" && (
        <g>
          <ellipse cx={cx - 9 * fs} cy={cy - 1 * fs} rx={5 * fs} ry={6 * fs} fill={pp.accent} transform={`rotate(-18 ${cx - 9 * fs} ${cy - 1 * fs})`} />
          <ellipse cx={cx + 9 * fs} cy={cy - 1 * fs} rx={5 * fs} ry={6 * fs} fill={pp.accent} transform={`rotate(18 ${cx + 9 * fs} ${cy - 1 * fs})`} />
        </g>
      )}

      {/* chicken comb + beak */}
      {pp.extra === "comb" && (
        <g>
          <circle cx={cx - 4} cy={cy - headR + 2} r={3} fill={pp.accent} />
          <circle cx={cx + 1} cy={cy - headR - 1} r={3.5} fill={pp.accent} />
          <circle cx={cx + 5} cy={cy - headR + 2} r={3} fill={pp.accent} />
          <path d={`M ${cx - 3} ${cy + 5 * fs} l ${3} ${3} l ${3} ${-3} Z`} fill={pp.accent} stroke={pp.dark} strokeWidth="0.8" />
        </g>
      )}
      {/* bird beak */}
      {pp.extra === "beak" && (
        <path d={`M ${cx - 3} ${cy + 4 * fs} l ${3} ${3.5} l ${3} ${-3.5} Z`} fill={pp.accent} stroke={pp.dark} strokeWidth="0.8" />
      )}

      {/* face — panda draws its own dark eyes inside the patches, so offset */}
      {/* face patches that sit under the features */}
      {pp.extra === "penguin" && <ellipse cx={cx} cy={cy + 4 * fs} rx={headR * 0.62} ry={headR * 0.55} fill={pp.belly} />}
      {pp.extra === "monkeyface" && (
        <g fill={pp.belly}>
          <ellipse cx={cx - 6 * fs} cy={cy + 3 * fs} rx={9 * fs} ry={8 * fs} />
          <ellipse cx={cx + 6 * fs} cy={cy + 3 * fs} rx={9 * fs} ry={8 * fs} />
          <ellipse cx={cx} cy={cy + 8 * fs} rx={11 * fs} ry={8.5 * fs} />
        </g>
      )}
      {/* frog: eyes bulge from the top of the head */}
      {pp.extra === "frog" && (
        <g stroke={pp.dark} strokeWidth="1.2">
          <circle cx={cx - 11 * fs} cy={cy - headR + 3 * fs} r={7.5 * fs} fill={pp.body} />
          <circle cx={cx + 11 * fs} cy={cy - headR + 3 * fs} r={7.5 * fs} fill={pp.body} />
          <circle cx={cx - 11 * fs} cy={cy - headR + 3 * fs} r={5 * fs} fill="#fff" stroke="none" />
          <circle cx={cx + 11 * fs} cy={cy - headR + 3 * fs} r={5 * fs} fill="#fff" stroke="none" />
        </g>
      )}
      <Face cx={cx} cy={cy + 2} s={fs} dark={pp.extra === "pandaface" ? "#1A1A1A" : "#3A2E28"} mood={mood}
            eyeY={pp.extra === "frog" ? cy - headR + 3 * fs : undefined} eyeDx={pp.extra === "frog" ? 11 : undefined}
            wide={!!pp.wideMouth} noMouth={!!pp.noMouth} />
      {/* koala nose */}
      {pp.extra === "koalanose" && <ellipse cx={cx} cy={cy + 4 * fs} rx={5.2 * fs} ry={3.8 * fs} fill="#3B3F46" />}
      {/* elephant trunk */}
      {pp.extra === "trunk" && (
        <g fill="none" strokeLinecap="round">
          <path d={`M ${cx} ${cy + 3 * fs} Q ${cx} ${cy + 17 * fs} ${cx + 7 * fs} ${cy + 18 * fs}`} stroke={pp.dark} strokeWidth={10.5 * fs} />
          <path d={`M ${cx} ${cy + 3 * fs} Q ${cx} ${cy + 17 * fs} ${cx + 7 * fs} ${cy + 18 * fs}`} stroke={pp.body} strokeWidth={8.2 * fs} />
        </g>
      )}
      {/* penguin beak */}
      {pp.extra === "penguin" && <path d={`M ${cx - 4 * fs} ${cy + 4 * fs} L ${cx} ${cy + 9 * fs} L ${cx + 4 * fs} ${cy + 4 * fs} Z`} fill={pp.accent} stroke={pp.dark} strokeWidth="0.8" strokeLinejoin="round" />}
      {/* spider: two more little eyes */}
      {pp.extra === "legs" && (
        <g fill="#3A2E28">
          <circle cx={cx - 4 * fs} cy={cy - 9 * fs} r={1.8 * fs} />
          <circle cx={cx + 4 * fs} cy={cy - 9 * fs} r={1.8 * fs} />
        </g>
      )}

      {/* cat whiskers */}
      {pp.extra === "whisker" && (
        <g stroke={pp.dark} strokeWidth="0.9" opacity="0.6" strokeLinecap="round">
          <line x1={cx - 10 * fs} y1={cy + 5 * fs} x2={cx - 20 * fs} y2={cy + 3 * fs} />
          <line x1={cx - 10 * fs} y1={cy + 7 * fs} x2={cx - 20 * fs} y2={cy + 8 * fs} />
          <line x1={cx + 10 * fs} y1={cy + 5 * fs} x2={cx + 20 * fs} y2={cy + 3 * fs} />
          <line x1={cx + 10 * fs} y1={cy + 7 * fs} x2={cx + 20 * fs} y2={cy + 8 * fs} />
        </g>
      )}

      {/* hedgehog spikes crown */}
      {pp.extra === "spikes" && (
        <g fill={pp.dark}>
          {Array.from({ length: 7 }).map((_, i) => {
            const a = -0.9 + i * 0.3;
            const bx = cx + Math.cos(a - Math.PI / 2) * headR;
            const by = cy + Math.sin(a - Math.PI / 2) * headR;
            const tx = cx + Math.cos(a - Math.PI / 2) * (headR + 7);
            const ty = cy + Math.sin(a - Math.PI / 2) * (headR + 7);
            return <path key={i} d={`M ${bx - 2.5} ${by} L ${tx} ${ty} L ${bx + 2.5} ${by} Z`} />;
          })}
        </g>
      )}
    </g>
  );
}

// CSS that makes the creatures feel alive. All transforms use
// transform-box: fill-box so each group animates around ITS OWN center —
// supported on iOS Safari 11+ (the family's iPad) and all modern browsers.
const LIVE_CSS = `
  .ps-live * { transform-box: fill-box; }
  .ps-eyes { animation: psBlink 4.2s infinite; transform-origin: center; }
  .ps-breath { animation: psBreath 2.6s ease-in-out infinite; transform-origin: center bottom; }
  .ps-tail { animation: psWag 2.2s ease-in-out infinite; transform-origin: left center; }
  .ps-ears { animation: psTwitch 5.6s ease-in-out infinite; transform-origin: center bottom; }
  .ps-wing { animation: psFlap 1.8s ease-in-out infinite; transform-origin: center; }
  .ps-egg { animation: psEggRock 2.8s ease-in-out infinite; transform-origin: center bottom; transform-box: fill-box; }
  .ps-root { transform-origin: 50px 90px; }
  .ps-act-hop { animation: psHop 0.9s ease-in-out; }
  .ps-act-tilt { animation: psTilt 1.1s ease-in-out; }
  .ps-act-wiggle { animation: psWiggle 0.8s ease-in-out; }
  .ps-act-shake { animation: psShake 0.5s ease-in-out 2; }
  .ps-act-stretch { animation: psStretch 1.6s ease-in-out; }
  .ps-act-bounce { animation: psBounce 0.6s ease-in-out 2; }
  .ps-chew { animation: psChew 0.35s ease-in-out infinite; transform-origin: center; }
  .ps-puff { animation: psPuff 0.7s ease-in-out infinite; transform-origin: center; }
  .ps-mood-sleepy .ps-breath { animation-duration: 4.4s; }
  .ps-mood-sleepy .ps-eyes, .ps-mood-angry .ps-eyes { animation: none; }
  @keyframes psShake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-3px) rotate(-3deg); } 75% { transform: translateX(3px) rotate(3deg); } }
  @keyframes psStretch { 0%, 100% { transform: scale(1, 1); } 40% { transform: scale(0.94, 1.12); } 70% { transform: scale(1.06, 0.95); } }
  @keyframes psBounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-9px); } }
  @keyframes psChew { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(0.4); } }
  @keyframes psPuff { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.6; transform: scale(1.25); } }
  @keyframes psBlink { 0%, 92%, 100% { transform: scaleY(1); } 95% { transform: scaleY(0.08); } }
  @keyframes psBreath { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(1.045) scaleX(1.015); } }
  @keyframes psWag { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(9deg); } }
  @keyframes psTwitch { 0%, 86%, 100% { transform: rotate(0deg); } 90% { transform: rotate(-5deg); } 94% { transform: rotate(4deg); } }
  @keyframes psFlap { 0%, 100% { transform: scaleX(1); } 50% { transform: scaleX(1.12); } }
  @keyframes psEggRock { 0%, 100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
  @keyframes psHop { 0%, 100% { transform: translateY(0); } 30% { transform: translateY(-7px) scaleY(1.04); } 55% { transform: translateY(0) scaleY(0.94) scaleX(1.05); } 70% { transform: translateY(-3px); } }
  @keyframes psTilt { 0%, 100% { transform: rotate(0deg); } 40% { transform: rotate(7deg); } 75% { transform: rotate(-4deg); } }
  @keyframes psWiggle { 0%, 100% { transform: rotate(0deg); } 20% { transform: rotate(-6deg); } 45% { transform: rotate(6deg); } 70% { transform: rotate(-3deg); } }
`;

// The animation CSS is added to the page once (not once per sprite).
function ensureStyle() {
  if (typeof document === "undefined" || document.getElementById("ps-live-css")) return;
  const el = document.createElement("style");
  el.id = "ps-live-css";
  el.textContent = LIVE_CSS;
  document.head.appendChild(el);
}

const MICRO_ACTIONS = ["ps-act-hop", "ps-act-tilt", "ps-act-wiggle"];

/**
 * @param {string} petType  one of the 10 pet keys
 * @param {number} stageIndex  0=egg,1=baby,2=teen,3=adult
 * @param {number} size  px width/height (default 64)
 * @param {boolean} animated  living idle animations (breath/blink/wag + random
 *   hop/tilt/wiggle). On by default; pass false for static contexts (pickers).
 */
export default function PetSprite({ petType, stageIndex = 1, size = 64, animated = true, mood = "neutral", action = "" }) {
  const p = PETS[petType] ? PETS[petType] : PETS.chicken;
  const clean = { ...p, accent: (p.accent || "#999").replace(/\s+/g, "") };

  // Every few seconds the pet does a small random action — a hop, a head
  // tilt, a happy wiggle — which is what sells "it's alive" far more than any
  // constant loop. Interval is randomized (4.5–9s) so siblings' pets don't
  // move in eerie unison.
  const [micro, setAction] = useState("");
  if (animated) ensureStyle();
  useEffect(() => {
    if (!animated || stageIndex === 0) return undefined;
    let actionTimer = null;
    let clearTimer = null;
    let cancelled = false;
    const schedule = () => {
      if (cancelled) return;
      actionTimer = setTimeout(() => {
        setAction(MICRO_ACTIONS[Math.floor(Math.random() * MICRO_ACTIONS.length)]);
        clearTimer = setTimeout(() => { setAction(""); schedule(); }, 1200);
      }, 4500 + Math.random() * 4500);
    };
    schedule();
    return () => { cancelled = true; clearTimeout(actionTimer); clearTimeout(clearTimer); };
  }, [animated, stageIndex, petType]);

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={`${petType} stage ${stageIndex}`}>
      {stageIndex === 0 ? (
        <g className={animated ? "ps-egg" : undefined}>
          <Egg p={clean} />
        </g>
      ) : (
        <g className={animated ? `ps-live ps-root ps-mood-${mood} ${action ? `ps-act-${action}` : micro}` : undefined}>
          <Creature petKey={petType} stage={stageIndex} mood={mood} />
        </g>
      )}
    </svg>
  );
}
