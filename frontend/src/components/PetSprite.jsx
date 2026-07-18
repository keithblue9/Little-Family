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
};

// small helper: cheeks + eyes + smile shared across all non-egg stages.
// `s` scales feature spacing/size for the growth stage.
function Face({ cx = 50, cy = 48, s = 1, dark = "#333" }) {
  const eyeDx = 9 * s;
  const eyeY = cy - 2 * s;
  const eyeR = 3.1 * s;
  return (
    <g>
      {/* blush cheeks */}
      <ellipse cx={cx - 14 * s} cy={cy + 5 * s} rx={4.2 * s} ry={2.8 * s} fill="#FF9BB3" opacity="0.55" />
      <ellipse cx={cx + 14 * s} cy={cy + 5 * s} rx={4.2 * s} ry={2.8 * s} fill="#FF9BB3" opacity="0.55" />
      {/* eyes */}
      <circle cx={cx - eyeDx} cy={eyeY} r={eyeR} fill={dark} />
      <circle cx={cx + eyeDx} cy={eyeY} r={eyeR} fill={dark} />
      {/* eye sparkle */}
      <circle cx={cx - eyeDx + 1 * s} cy={eyeY - 1 * s} r={0.9 * s} fill="#fff" />
      <circle cx={cx + eyeDx + 1 * s} cy={eyeY - 1 * s} r={0.9 * s} fill="#fff" />
      {/* smile */}
      <path d={`M ${cx - 4 * s} ${cy + 6 * s} Q ${cx} ${cy + 9.5 * s} ${cx + 4 * s} ${cy + 6 * s}`} stroke={dark} strokeWidth={1.5 * s} fill="none" strokeLinecap="round" />
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

function Creature({ petKey, stage }) {
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

      {/* dragon wings sit behind the body */}
      {pp.extra === "wing" && stage === 3 && (
        <g opacity="0.95">
          <path d={`M ${cx - bodyRx} ${bodyCy - 4} q ${-16} ${-10} ${-20} ${4} q ${8} ${-2} ${18} ${6} Z`} fill={pp.belly} stroke={pp.dark} strokeWidth="1.2" strokeLinejoin="round" />
          <path d={`M ${cx + bodyRx} ${bodyCy - 4} q ${16} ${-10} ${20} ${4} q ${-8} ${-2} ${-18} ${6} Z`} fill={pp.belly} stroke={pp.dark} strokeWidth="1.2" strokeLinejoin="round" />
        </g>
      )}

      {/* tail (behind body) */}
      <Tail p={pp} cx={cx} cy={bodyCy - 6} s={fs} />

      {/* ears (behind head) */}
      <Ears p={pp} cx={cx} cy={cy} s={fs} />

      {/* body */}
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

      {/* head */}
      <circle cx={cx} cy={cy} r={headR} fill={pp.body} stroke={pp.dark} strokeWidth="1.4" />

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
      <Face cx={cx} cy={cy + 2} s={fs} dark={pp.extra === "pandaface" ? "#1A1A1A" : "#3A2E28"} />

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

/**
 * @param {string} petType  one of the 10 pet keys
 * @param {number} stageIndex  0=egg,1=baby,2=teen,3=adult
 * @param {number} size  px width/height (default 64)
 */
export default function PetSprite({ petType, stageIndex = 1, size = 64 }) {
  const p = PETS[petType] ? PETS[petType] : PETS.chicken;
  const clean = { ...p, accent: (p.accent || "#999").replace(/\s+/g, "") };
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={`${petType} stage ${stageIndex}`}>
      {stageIndex === 0 ? <Egg p={clean} /> : <Creature petKey={petType} stage={stageIndex} />}
    </svg>
  );
}
