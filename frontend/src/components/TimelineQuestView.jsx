import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Play, Check, Clock, Lock, Star, FastForward } from "lucide-react";

/**
 * Horizontal timeline view of a child's day.
 *
 * Each configured section (Pagi / Siang / Sore / Malam …) becomes its own
 * horizontally-scrollable track: a spine with a node per task and the task card
 * hanging below it. Cards alternate above/below the line so long titles never
 * collide with their neighbours.
 *
 * Two deliberate choices:
 *  • Bonus tasks sit inline on the same spine, ordered by their time, rather
 *    than in a separate list — the day reads as one continuous story.
 *  • A task with no due_time can't be placed on a clock, so those go into a
 *    trailing "Kapan Saja" track instead of being silently dropped.
 */

const hhmmToMin = (t) => {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

function segmentOf(task, segments) {
  // A task states its own section now. Older tasks (made before sections
  // existed) only carry a due_time, so fall back to whichever section covers
  // that time — nothing from the old data model gets orphaned.
  if (task.segment_id) {
    return segments.some((s) => s.id === task.segment_id) ? task.segment_id : "__anytime__";
  }
  const mins = hhmmToMin(task.due_time);
  if (mins === null) return "__anytime__";
  const hit = segments.find(
    (s) => mins >= hhmmToMin(s.start_time) && mins <= hhmmToMin(s.end_time)
  );
  return hit ? hit.id : "__anytime__";
}

const STATUS_STYLE = {
  approved: { ring: "border-emerald-400", dot: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-700", label: "Selesai" },
  completed: { ring: "border-sky-400", dot: "bg-sky-500", chip: "bg-sky-100 text-sky-700", label: "Menunggu cek" },
  skipped: { ring: "border-slate-300", dot: "bg-slate-400", chip: "bg-slate-100 text-slate-500", label: "Dilewati" },
  missed: { ring: "border-red-300", dot: "bg-red-400", chip: "bg-red-100 text-red-600", label: "Terlewat" },
  rejected: { ring: "border-amber-400", dot: "bg-amber-500", chip: "bg-amber-100 text-amber-700", label: "Perlu diulang" },
  pending: { ring: "border-slate-200", dot: "bg-slate-300", chip: "bg-slate-100 text-slate-500", label: "Belum" },
};

function TaskCard({ task, isActive, busy, canStart, canFinish, timeStuck, notYet, notYetLabel, onStart, onFinish, onSkip, onReportLate, below }) {
  const st = STATUS_STYLE[task.status] || STATUS_STYLE.pending;
  const done = ["approved", "completed", "skipped"].includes(task.status);

  return (
    <div className={`w-44 shrink-0 ${below ? "mt-3" : "mb-3"}`}>
      <div
        className={`rounded-2xl border-2 bg-white p-2.5 transition-shadow ${st.ring} ${
          isActive ? "shadow-lg ring-2 ring-indigo-200" : ""
        }`}
      >
        <div className="flex items-start gap-1.5">
          {task.is_bonus && <Star className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" fill="currentColor" />}
          <div className="font-fun font-bold text-[13px] leading-tight text-slate-800 line-clamp-2">
            {task.title}
          </div>
        </div>

        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-slate-500">
          {task.due_time ? <span>🕐 {task.due_time}</span> : null}
          {task.duration_minutes ? <span>⏱ {task.duration_minutes}m</span> : null}
        </div>

        <div className="flex flex-wrap items-center gap-1 mt-1.5">
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${st.chip}`}>{st.label}</span>
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600">
            +{task.points}
          </span>
          {task.late_ack && (
            <span
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                task.late_no_points ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
              }`}
              title={task.late_reason_label || ""}
            >
              {task.late_no_points ? "⚠️ tanpa poin" : "✅ dimaklumi"}
            </span>
          )}
        </div>

        {!done && (
          <div className="flex flex-wrap gap-1 mt-2">
            {canStart && (
              <button
                onClick={onStart}
                disabled={busy}
                className="press-btn flex-1 min-w-0 bg-indigo-600 hover:bg-indigo-700 text-white font-fun font-bold px-2 py-1 rounded-lg text-[10px] flex items-center justify-center gap-1 disabled:opacity-60"
              >
                <Play className="w-3 h-3" strokeWidth={3} /> Mulai
              </button>
            )}
            {canFinish && (
              <button
                onClick={onFinish}
                disabled={busy}
                className="press-btn flex-1 min-w-0 bg-emerald-500 hover:bg-emerald-600 text-white font-fun font-bold px-2 py-1 rounded-lg text-[10px] flex items-center justify-center gap-1 disabled:opacity-60"
              >
                <Check className="w-3 h-3" strokeWidth={3} /> Selesai
              </button>
            )}
            {timeStuck && !task.late_ack && onReportLate && (
              <button
                onClick={onReportLate}
                disabled={busy}
                className="press-btn flex-1 min-w-0 bg-amber-100 hover:bg-amber-200 text-amber-800 font-fun font-bold px-2 py-1 rounded-lg text-[10px] flex items-center justify-center gap-1 disabled:opacity-60"
              >
                <Clock className="w-3 h-3" strokeWidth={3} /> Terlambat
              </button>
            )}
            {timeStuck && task.late_ack && !canStart && !canFinish && (
              <span className="text-[9px] text-amber-600 flex items-center gap-1 px-1 py-1">
                <Clock className="w-3 h-3" /> Waktunya sudah digeser
              </span>
            )}
            {notYet && (
              <span className={`text-[9px] flex items-center gap-1 px-1 py-1 ${notYetLabel ? "text-sky-600" : "text-slate-400"}`}>
                {notYetLabel ? <Clock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                {notYetLabel || "Menunggu giliran"}
              </span>
            )}
            {!canStart && !canFinish && !timeStuck && !notYet && (
              <span className="text-[9px] text-slate-400 flex items-center gap-1 px-1 py-1">
                <Lock className="w-3 h-3" /> Menunggu giliran
              </span>
            )}
            {onSkip && (canStart || canFinish || timeStuck) && (
              <button
                onClick={onSkip}
                disabled={busy}
                className="press-btn bg-slate-100 hover:bg-slate-200 text-slate-500 font-fun font-semibold px-1.5 py-1 rounded-lg text-[9px] flex items-center gap-0.5 disabled:opacity-60"
                title="Lewati misi ini (pakai poin)"
              >
                <FastForward className="w-2.5 h-2.5" /> Lewati
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Track({ segment, tasks, helpers }) {
  const scroller = useRef(null);
  const activeRef = useRef(null);

  // Bring the task the kid should be doing into view when the track mounts.
  useEffect(() => {
    if (activeRef.current && scroller.current) {
      const el = activeRef.current;
      scroller.current.scrollTo({
        left: Math.max(0, el.offsetLeft - scroller.current.clientWidth / 2 + el.clientWidth / 2),
        behavior: "smooth",
      });
    }
  }, [tasks.length]);

  const doneCount = tasks.filter((t) => ["approved", "completed", "skipped"].includes(t.status)).length;

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-lg">{segment.emoji || "•"}</span>
        <span className="font-fun font-bold text-slate-800">{segment.label}</span>
        {segment.start_time && (
          <span className="text-[11px] text-slate-400">
            {segment.start_time}–{segment.end_time}
            {/* Make it obvious when this child has their own start time, so a
                sibling comparing screens isn't confused by different hours. */}
            {segment.is_personal && (
              <span className="ml-1 text-teal-600 font-semibold" title={`Jam umum ${segment.general_start_time}`}>
                · jammu
              </span>
            )}
          </span>
        )}
        <span className="ml-auto text-[11px] font-semibold text-slate-500">
          {doneCount}/{tasks.length}
        </span>
      </div>

      <div ref={scroller} className="overflow-x-auto pb-1 -mx-1 px-1">
        {/* Width hugs the cards so a short section doesn't leave a long empty
            stretch of spine trailing off to the right. */}
        <div className="relative inline-flex items-stretch w-max">
          <div className="absolute left-4 right-4 top-1/2 h-[3px] bg-slate-200 rounded-full" />
          <div className="relative flex items-center gap-3">
            {tasks.map((t, i) => {
              const st = STATUS_STYLE[t.status] || STATUS_STYLE.pending;
              const isActive = helpers.activeId === t.id;
              const below = i % 2 === 0;
              return (
                <div
                  key={t.id}
                  ref={isActive ? activeRef : null}
                  className="relative flex flex-col items-center"
                >
                  {!below && (
                    <TaskCard task={t} isActive={isActive} below={false} {...helpers.forTask(t)} />
                  )}
                  <motion.div
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: i * 0.04 }}
                    className={`w-4 h-4 rounded-full border-[3px] border-white shadow z-10 ${st.dot} ${
                      isActive ? "ring-4 ring-indigo-200" : ""
                    }`}
                  />
                  {below && (
                    <TaskCard task={t} isActive={isActive} below {...helpers.forTask(t)} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TimelineQuestView({ tasks, segments, activeId, helpers }) {
  const grouped = useMemo(() => {
    const segs = segments && segments.length ? segments : [];
    const buckets = new Map(segs.map((s) => [s.id, []]));
    buckets.set("__anytime__", []);
    for (const t of tasks) {
      const key = segmentOf(t, segs);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(t);
    }
    for (const list of buckets.values()) {
      // Bonus tasks are interleaved by time, not exiled to the end — the day
      // should read chronologically. Timeless ones trail their group.
      // Inside a section the sequence is the task's own order — the section
      // supplies the clock. Legacy tasks that still carry a time fall back to
      // it so mixed data stays sensible.
      list.sort((a, b) => {
        const ao = a.order || 0;
        const bo = b.order || 0;
        if (ao !== bo) return ao - bo;
        const am = hhmmToMin(a.due_time);
        const bm = hhmmToMin(b.due_time);
        if (am === null && bm === null) return 0;
        if (am === null) return 1;
        if (bm === null) return -1;
        return am - bm;
      });
    }
    const ordered = [...segs]
      .sort((a, b) => hhmmToMin(a.start_time) - hhmmToMin(b.start_time))
      .map((s) => ({ segment: s, list: buckets.get(s.id) || [] }));
    const anytime = buckets.get("__anytime__") || [];
    if (anytime.length) {
      ordered.push({
        segment: { id: "__anytime__", label: "Kapan Saja", emoji: "✨", start_time: "", end_time: "" },
        list: anytime,
      });
    }
    return ordered.filter((g) => g.list.length > 0);
  }, [tasks, segments]);

  if (grouped.length === 0) return null;

  return (
    <div className="space-y-3">
      {grouped.map(({ segment, list }) => (
        <Track key={segment.id} segment={segment} tasks={list} helpers={{ ...helpers, activeId }} />
      ))}
    </div>
  );
}
