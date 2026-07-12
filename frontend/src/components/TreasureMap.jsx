import { motion } from "framer-motion";
import { CheckCircle2, Lock, FastForward, Star } from "lucide-react";
import { QUEST_THEMES } from "@/lib/questThemes";
import { styleMeta } from "@/lib/personality";

/**
 * Renders the child's active + upcoming quests as an illustrated treasure-hunt
 * path. All quests appear as stepping-stones along a zigzagging path; the first
 * open one glows and is interactive, the rest are visibly locked, and completed
 * ones behind get themed "done" markers.
 *
 * Props:
 *   theme:   theme key from QUEST_THEMES
 *   quests:  ordered open quests (pending/rejected) — first is the active one
 *   done:    approved+skipped quests to render as breadcrumbs behind
 *   onComplete(task)  — kid taps the active node
 *   onSkip(task)      — kid buys their way past
 *   skipCost:  points cost of a skip (for the button label)
 */
export default function TreasureMap({ theme, quests, done = [], onComplete, onSkip, skipCost = 20 }) {
  const t = QUEST_THEMES[theme] || QUEST_THEMES.ocean;
  const c = t.colors;

  const nodes = [
    ...done.slice(-3).map((q) => ({ q, state: "done" })),
    ...quests.map((q, idx) => ({ q, state: idx === 0 ? "active" : "locked" })),
  ];

  if (nodes.length === 0) {
    return (
      <div
        className="relative rounded-3xl overflow-hidden p-8 text-center chunky-shadow-lg"
        style={{ background: c.bg, color: c.text, minHeight: 220 }}
      >
        <div className="text-5xl mb-3">{t.goalIcon}</div>
        <div className="font-fun font-bold text-xl">Semua misi beres!</div>
        <div className="opacity-80 text-sm">{t.tagline}</div>
      </div>
    );
  }

  return (
    <div
      className="relative rounded-3xl overflow-hidden p-4 md:p-6 chunky-shadow-lg"
      style={{ background: c.bg, color: c.text }}
    >
      {/* Decorative background emojis */}
      {t.decorEmojis.map((e, i) => (
        <motion.div
          key={i}
          className="absolute select-none pointer-events-none opacity-30"
          style={{
            top: `${(i * 23 + 8) % 90}%`,
            left: `${(i * 37 + 12) % 90}%`,
            fontSize: 20 + (i % 3) * 8,
          }}
          animate={{ y: [0, -8, 0], rotate: [0, 8, 0] }}
          transition={{ duration: 4 + i, repeat: Infinity, ease: "easeInOut", delay: i * 0.4 }}
        >
          {e}
        </motion.div>
      ))}

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between mb-4">
        <div>
          <div className="font-fun font-bold text-lg flex items-center gap-2" style={{ color: c.text }}>
            <span className="text-2xl">{t.emoji}</span> {t.label}
          </div>
          <div className="text-xs opacity-80" style={{ color: c.textDim }}>
            {t.tagline}
          </div>
        </div>
        <div className="text-4xl md:text-5xl">{t.goalIcon}</div>
      </div>

      {/* The path */}
      <div className="relative z-10">
        <div className="space-y-3">
          {nodes.map((n, idx) => {
            const zig = idx % 2 === 0;
            return (
              <div key={n.q.id} className="flex items-center gap-3">
                {/* Zig-zag alignment: even rows push left, odd rows push right */}
                <div
                  className="hidden md:block"
                  style={{ width: zig ? 0 : "40%", transition: "width 0.3s" }}
                />

                <QuestNode
                  q={n.q}
                  state={n.state}
                  theme={t}
                  onComplete={onComplete}
                  onSkip={onSkip}
                  skipCost={skipCost}
                  isFirstOpen={n.state === "active"}
                />

                <div
                  className="hidden md:block"
                  style={{ width: zig ? "40%" : 0, transition: "width 0.3s" }}
                />
              </div>
            );
          })}
        </div>

        {/* Goal marker at the end */}
        <div className="flex justify-center mt-4">
          <motion.div
            animate={{ scale: [1, 1.08, 1] }}
            transition={{ duration: 2.5, repeat: Infinity }}
            className="text-5xl md:text-6xl select-none"
            title="Tujuan akhir"
          >
            {t.goalIcon}
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function QuestNode({ q, state, theme, onComplete, onSkip, skipCost, isFirstOpen }) {
  const c = theme.colors;
  const done = state === "done";
  const active = state === "active";

  const bg = done ? c.nodeDone : active ? c.node : c.nodeLocked;
  const icon = done ? theme.doneIcon : active ? theme.activeIcon : theme.lockedIcon;
  const style = q.task_style ? styleMeta(q.task_style) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex-1 min-w-0 rounded-2xl p-3 flex items-center gap-3 relative ${
        active ? "ring-4" : ""
      }`}
      style={{
        background: done ? "rgba(255,255,255,0.85)" : active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.55)",
        borderColor: bg,
        borderWidth: 2,
        borderStyle: "solid",
        boxShadow: active ? `0 0 0 6px ${bg}33` : "none",
        color: "#1E293B",
      }}
    >
      {/* Node icon */}
      <motion.div
        animate={active ? { scale: [1, 1.06, 1], rotate: [0, 4, -4, 0] } : {}}
        transition={active ? { duration: 2, repeat: Infinity } : {}}
        className="w-14 h-14 md:w-16 md:h-16 rounded-full flex items-center justify-center text-2xl md:text-3xl shrink-0"
        style={{
          background: bg,
          color: "white",
          boxShadow: active ? `0 4px 16px ${bg}80` : "0 2px 6px rgba(0,0,0,0.15)",
        }}
      >
        {done ? (
          <CheckCircle2 className="w-8 h-8 text-white" strokeWidth={2.5} />
        ) : active ? (
          <span>{icon}</span>
        ) : (
          <Lock className="w-6 h-6 text-white" strokeWidth={2.5} />
        )}
      </motion.div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className={`font-fun font-bold ${done ? "line-through text-slate-500" : "text-slate-900"} truncate`}>
          {q.title}
        </div>
        {q.description && active && (
          <div className="text-xs text-slate-600 truncate">{q.description}</div>
        )}
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <span className="inline-flex items-center gap-0.5 text-xs font-bold text-amber-600">
            <Star className="w-3 h-3 fill-amber-500 text-amber-500" /> +{q.points}
          </span>
          {style && active && (
            <span
              className="text-xs font-bold px-1.5 py-0.5 rounded-full text-white"
              style={{ background: style.color }}
            >
              {style.emoji} {style.label}
            </span>
          )}
          {active && q.due_time && (
            <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
              🕒 {q.due_time}
            </span>
          )}
          {active && q.duration_minutes && (
            <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">
              ⏱️ {q.duration_minutes}m
            </span>
          )}
          {q.status === "rejected" && active && (
            <span className="text-xs font-bold text-red-500">↺ coba lagi</span>
          )}
        </div>
      </div>

      {/* Actions (only for the active first-open quest) */}
      {isFirstOpen && (
        <div className="flex flex-col gap-1.5 shrink-0">
          <button
            onClick={() => onComplete(q)}
            className="press-btn chunky-shadow bg-[#34D399] hover:bg-[#2bbf88] text-white font-fun font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1"
          >
            <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={2.5} /> Selesai!
          </button>
          <button
            onClick={() => onSkip(q)}
            className="press-btn bg-slate-100 hover:bg-slate-200 text-slate-600 font-fun font-semibold px-3 py-1 rounded-xl text-xs flex items-center gap-1"
            title={`Bayar ${skipCost} poin`}
          >
            <FastForward className="w-3 h-3" /> Lewati ({skipCost})
          </button>
        </div>
      )}
    </motion.div>
  );
}
