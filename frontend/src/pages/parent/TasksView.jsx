import { lazy, useEffect, useMemo, useRef, useState } from "react";
import { ShieldAlert, Settings, Plus, Trash2, CheckCircle2, XCircle, AlertTriangle, Star, Users, ChevronLeft, ChevronRight, Undo2, Copy, GripVertical } from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { TEST_IDS } from "@/constants/testIds/app";
import { todayKey, humanDateKey, shiftDateKey, nextDateForWeekday } from "@/lib/dates";
import { btnPrimary, fmtClock } from "@/pages/parent/shared";

const MonthHeatmap = lazy(() => import("@/components/MonthHeatmap"));
const EncourageModal = lazy(() => import("@/components/EncourageModal"));

export function TasksView({ kids, tasks, selectedChildId, onAddTask, onEditTask, onDuplicate, onRefresh, onApplyConsequence, onAddChild, onEnsureDate, taskWindow }) {
  // Drag-and-drop reordering of the active list. We keep a local copy while
  // dragging so the row follows the cursor instantly, then persist the whole
  // visible slice in one call. If the save fails we reload from the server
  // rather than leaving the screen showing an order that isn't real.
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [localOrder, setLocalOrder] = useState(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const toggleSelected = (id) =>
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const bulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(
      `Hapus ${selectedIds.length} tugas terpilih?\n\nTindakan ini permanen.`
    )) return;
    setBulkDeleting(true);
    try {
      const { data } = await api.post("/tasks/bulk-delete", { task_ids: selectedIds });
      toast.success(`${data.deleted} tugas dihapus`);
      setSelectedIds([]);
      onRefresh();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBulkDeleting(false);
    }
  };

  // Reordering uses POINTER events, not HTML5 drag-and-drop: the latter simply
  // never fires on touch screens, so on an iPad the list looked draggable but
  // wasn't. Pointer events cover mouse, pen and touch with one code path.
  // Dragging is bound to an explicit grip handle so ordinary scrolling and
  // button taps inside a row keep working normally.
  const dragState = useRef(null);

  const commitOrder = async (list) => {
    const original = grouped.pending.map((x) => x.id).join(",");
    if (list.map((x) => x.id).join(",") === original) { setLocalOrder(null); return; }
    setSavingOrder(true);
    try {
      await api.post("/tasks/reorder", { task_ids: list.map((x) => x.id) });
      toast.success("Urutan disimpan");
      setLocalOrder(null);
      onRefresh();
    } catch (e) {
      toast.error(formatApiError(e));
      setLocalOrder(null); // fall back to the server's truth
      onRefresh();
    } finally { setSavingOrder(false); }
  };

  const beginDrag = (e, task) => {
    if (savingOrder) return;
    e.preventDefault();
    e.stopPropagation();
    const startList = localOrder || grouped.pending;
    dragState.current = { id: task.id, list: [...startList] };
    setDragId(task.id);
    setLocalOrder([...startList]);

    const move = (ev) => {
      const st = dragState.current;
      if (!st) return;
      const point = ev.touches ? ev.touches[0] : ev;
      const el = document.elementFromPoint(point.clientX, point.clientY);
      const row = el && el.closest("[data-task-row]");
      if (!row) return;
      const overTaskId = row.getAttribute("data-task-row");
      if (!overTaskId || overTaskId === st.id) return;
      setOverId(overTaskId);
      const list = [...st.list];
      const from = list.findIndex((x) => x.id === st.id);
      const to = list.findIndex((x) => x.id === overTaskId);
      if (from === -1 || to === -1 || from === to) return;
      list.splice(to, 0, list.splice(from, 1)[0]);
      st.list = list;
      setLocalOrder(list);
    };

    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      const st = dragState.current;
      dragState.current = null;
      setDragId(null);
      setOverId(null);
      if (st) commitOrder(st.list);
    };

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
  // When viewing "Semua" (selectedChildId === null), collapse broadcast siblings
  // (same broadcast_id) into a single representative row that lists all the kids
  // it was assigned to — e.g. "Adskhan & Syila". Editing/duplicating still targets
  // the representative task; deleting removes the whole group. When a specific
  // child is selected, tasks show individually so per-child edits are possible.
  const kidName = (id) => kids.find((k) => k.id === id)?.name || "?";

  // Recurring/weekday-scheduled tasks can easily produce many upcoming AND
  // overdue pending occurrences at once. Give the parent real day-by-day
  // navigation (Kemarin / Hari Ini / Besok / tanggal custom) instead of one
  // fuzzy "today-ish" bucket, so what's on screen always matches one specific
  // day — mirroring the same mental model as the kid's own calendar view.
  const [dateFilter, setDateFilterState] = useState(() => {
    const stored = sessionStorage.getItem("tasksDateFilter");
    // Guard against a stale value from the previous filter format (which only
    // ever stored the literal strings "today" or "all", not a real date) —
    // anything that isn't "all" or a proper YYYY-MM-DD falls back to today.
    if (stored === "all") return "all";
    // Only restore a stored date if it's today or in the future. A stored PAST
    // date (e.g. yesterday, saved before local midnight rolled over) would
    // otherwise silently show an old day's tasks — the #1 "why are today's
    // done tasks under yesterday?" confusion. Past dates snap back to today.
    if (stored && /^\d{4}-\d{2}-\d{2}$/.test(stored) && stored >= todayKey()) return stored;
    return todayKey();
  });
  const [showCalendar, setShowCalendar] = useState(false);
  const [encourageTask, setEncourageTask] = useState(null);
  const setDateFilter = (v) => {
    setDateFilterState(v);
    try { sessionStorage.setItem("tasksDateFilter", v); } catch { /* storage unavailable — non-fatal */ }
  };
  const isDateMode = dateFilter !== "all"; // dateFilter is either "all" or a YYYY-MM-DD string
  // Days are built lazily on the server: make sure the one on screen exists.
  useEffect(() => {
    if (isDateMode && onEnsureDate) onEnsureDate(dateFilter);
  }, [dateFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const displayTasks = useMemo(() => {
    if (selectedChildId) return tasks; // specific child → individual tasks
    const groups = new Map();
    const singles = [];
    for (const t of tasks) {
      if (t.broadcast_id) {
        const key = `${t.broadcast_id}::${t.date_key}::${t.title}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(t);
      } else {
        singles.push(t);
      }
    }
    const collapsed = [];
    for (const [, siblings] of groups) {
      // representative = first sibling, annotated with the group's kid names + ids
      const rep = { ...siblings[0], _groupKidIds: siblings.map((s) => s.child_id), _groupTaskIds: siblings.map((s) => s.id) };
      collapsed.push(rep);
    }
    return [...singles, ...collapsed];
  }, [tasks, selectedChildId, kids]); // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = useMemo(() => {
    const byOrder = (a, b) => (a.order || 0) - (b.order || 0);
    // In date mode, EVERY section (pending, awaiting, done, missed) must be
    // scoped to the selected day. Previously only `pending` was filtered, so
    // e.g. today's completed/awaiting tasks leaked into the "Kemarin" view.
    // Undated tasks (no date_key) always show — there's no day to exclude them by.
    const inSelectedDay = (t) => !isDateMode || !t.date_key || t.date_key === dateFilter;

    let pendingBase = displayTasks.filter((t) => t.status === "pending" || t.status === "rejected");
    const otherDatesCount = isDateMode
      ? pendingBase.filter((t) => t.date_key && t.date_key !== dateFilter).length
      : 0;
    pendingBase = pendingBase.filter(inSelectedDay);

    const pending = pendingBase.sort(byOrder);
    const awaiting = displayTasks.filter((t) => t.status === "completed" && inSelectedDay(t)).sort(byOrder);
    const done = displayTasks.filter((t) => (t.status === "approved" || t.status === "skipped") && inSelectedDay(t)).sort(byOrder);
    const missed = displayTasks.filter((t) => t.status === "missed" && inSelectedDay(t));
    // Sum of a group's own points — a broadcast row collapsed to one
    // representative still only has one `points` value (same for every kid
    // it was sent to), so a plain sum doesn't double-count per sibling.
    const sumPoints = (list) => list.reduce((sum, t) => sum + (Number(t.points) || 0), 0);
    return {
      pending, awaiting, done, missed, otherDatesCount,
      pendingPoints: sumPoints(pending),
      awaitingPoints: sumPoints(awaiting),
      donePoints: sumPoints(done),
    };
  }, [displayTasks, dateFilter, isDateMode]);

  const act = async (fn) => {
    try {
      await fn();
      onRefresh();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const approve = (t) => act(async () => {
    const { data } = await api.post(`/tasks/${t.id}/approve`);
    toast.success(`Disetujui! +${t.points} poin`);
    if (data.new_badges?.length) {
      data.new_badges.forEach((b) => toast.success(`Badge baru terbuka: ${b.name} 🏆`));
    }
  });
  const reject = (t) => act(async () => { await api.post(`/tasks/${t.id}/reject`); toast.info("Dikembalikan ke anak"); });
  const miss = (t) => act(async () => { await api.post(`/tasks/${t.id}/miss`); toast(`Ditandai terlewat${t.penalty_points ? ` · -${t.penalty_points} poin` : ""}`); });
  const undoMiss = (t) => {
    if (!window.confirm(`Batalkan status "Terlewat" untuk "${t.title}"? Penalti akan dikembalikan dan misi aktif lagi.`)) return;
    act(async () => {
      await api.post(`/tasks/${t.id}/undo-miss`);
      toast.success("Status terlewat dibatalkan, penalti dikembalikan");
    });
  };
  const del = (t) => {
    const isGroup = t._groupTaskIds && t._groupTaskIds.length > 1;
    const msg = isGroup
      ? `Hapus tugas "${t.title}" untuk ${t._groupKidIds.map(kidName).join(" & ")}?`
      : `Hapus tugas "${t.title}"?`;
    if (!window.confirm(msg)) return;
    act(async () => {
      if (isGroup) {
        await Promise.all(t._groupTaskIds.map((id) => api.delete(`/tasks/${id}`)));
      } else {
        await api.delete(`/tasks/${t.id}`);
      }
      toast.success("Tugas dihapus");
    });
  };

  // Display name for a task row: group kids ("Adskhan & Syila") or single kid.
  const rowName = (t) =>
    t._groupKidIds && t._groupKidIds.length > 1
      ? t._groupKidIds.map(kidName).join(" & ")
      : kidName(t.child_id);

  const editBtn = (t) => (
    <>
      <button onClick={() => onEditTask(t)} className="press-btn p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" title="Edit tugas">
        <Settings className="w-4 h-4" strokeWidth={2.5} />
      </button>
      <button onClick={() => onDuplicate(t)} className="press-btn p-1.5 rounded-lg hover:bg-indigo-50 text-indigo-500" title="Duplikat tugas ke hari/anak lain">
        <Copy className="w-4 h-4" strokeWidth={2.5} />
      </button>
    </>
  );

  if (kids.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-10 text-center border border-slate-200">
        <Users className="w-10 h-10 text-slate-300 mx-auto mb-3" strokeWidth={2.5} />
        <div className="font-parent font-bold text-lg text-slate-900">Tambah anak dulu</div>
        <div className="text-sm text-slate-500 mb-4">Tugas harus diberikan ke seorang anak.</div>
        <button onClick={onAddChild} className={btnPrimary} data-testid={TEST_IDS.parent.addChildBtn}>
          <Plus className="w-4 h-4" strokeWidth={2.5} /> Tambah anak
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between gap-2 flex-wrap">
        <button
          onClick={() => setShowCalendar((v) => !v)}
          className="press-btn inline-flex items-center gap-1.5 bg-white border-2 border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold px-4 py-2 rounded-xl text-sm"
        >
          📅 {showCalendar ? "Sembunyikan Kalender" : "Lihat Kalender"}
        </button>
        <div className="flex gap-2 flex-wrap">
          <button onClick={onAddTask} data-testid={TEST_IDS.parent.addTaskBtn} className={btnPrimary}>
            <Plus className="w-4 h-4" strokeWidth={2.5} /> Tugas baru
          </button>
        </div>
      </div>

      {showCalendar && (
        <div className={`grid grid-cols-1 ${selectedChildId ? "" : "md:grid-cols-2"} gap-4`}>
          {(selectedChildId ? kids.filter((k) => k.id === selectedChildId) : kids).map((k) => (
            <MonthHeatmap key={k.id} childId={k.id} childName={k.name} />
          ))}
        </div>
      )}

      {grouped.awaiting.length > 0 && (
        <Section title="⏳ Menunggu persetujuan" count={grouped.awaiting.length} pointsTotal={grouped.awaitingPoints}>
          {grouped.awaiting.map((t) => (
            <TaskRow key={t.id} task={t} childName={rowName(t)}>
              <button onClick={() => approve(t)} data-testid={`${TEST_IDS.parent.approveTaskBtn}-${t.id}`} className="press-btn inline-flex items-center gap-1 bg-[#34D399] hover:bg-[#22c583] text-white font-semibold px-3 py-1.5 rounded-lg text-sm">
                <CheckCircle2 className="w-4 h-4" strokeWidth={2.5} /> Setujui
              </button>
              <button onClick={() => setEncourageTask({ ...t, child_name: rowName(t) })} className="press-btn p-1.5 rounded-lg hover:bg-pink-50 text-pink-500" title="Setujui dengan pesan semangat">
                💌
              </button>
              <button onClick={() => reject(t)} data-testid={`${TEST_IDS.parent.rejectTaskBtn}-${t.id}`} className="press-btn p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" title="Tolak, kembalikan ke anak">
                <XCircle className="w-4 h-4" strokeWidth={2.5} />
              </button>
            </TaskRow>
          ))}
        </Section>
      )}

      {encourageTask && (
        <EncourageModal task={encourageTask} onClose={() => setEncourageTask(null)} onApproved={onRefresh} />
      )}

      <Section title="📋 Aktif" count={grouped.pending.length} pointsTotal={grouped.pendingPoints}>
        <div className="flex items-center gap-2 mb-3 -mt-1 flex-wrap">
          {isDateMode && (
            <button
              onClick={() => setDateFilter(shiftDateKey(dateFilter, -1))}
              className="press-btn p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500"
              title="Hari sebelumnya"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setDateFilter(shiftDateKey(todayKey(), -1))}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${dateFilter === shiftDateKey(todayKey(), -1) ? "bg-indigo-500 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
          >
            Kemarin
          </button>
          <button
            onClick={() => setDateFilter(todayKey())}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${dateFilter === todayKey() ? "bg-indigo-500 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
          >
            Hari Ini
          </button>
          <button
            onClick={() => setDateFilter(shiftDateKey(todayKey(), 1))}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${dateFilter === shiftDateKey(todayKey(), 1) ? "bg-indigo-500 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
          >
            Besok
          </button>
          {isDateMode && (
            <button
              onClick={() => setDateFilter(shiftDateKey(dateFilter, 1))}
              className="press-btn p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500"
              title="Hari berikutnya"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
          <input
            type="date"
            value={isDateMode ? dateFilter : ""}
            onChange={(e) => e.target.value && setDateFilter(e.target.value)}
            className="px-2 py-1 rounded-lg text-xs font-semibold border border-slate-200 text-slate-600"
            title="Pilih tanggal custom"
          />
          <select
            value=""
            onChange={(e) => { if (e.target.value !== "") setDateFilter(nextDateForWeekday(Number(e.target.value))); }}
            className="px-2 py-1 rounded-lg text-xs font-semibold border border-slate-200 text-slate-600 bg-white"
            title="Lompat ke hari tertentu (minggu ini/depan)"
          >
            <option value="">📆 Pilih Hari…</option>
            {["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"].map((label, i) => (
              <option key={i} value={i}>{label}</option>
            ))}
          </select>
          <button
            onClick={() => setDateFilter("all")}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${dateFilter === "all" ? "bg-indigo-500 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
          >
            Semua Tanggal
          </button>
          {!isDateMode && taskWindow && (
            <span className="text-xs text-slate-400" title="Riwayat lebih lama: pilih tanggalnya di kalender">
              {humanDateKey(taskWindow.start)} – {humanDateKey(taskWindow.end)}
            </span>
          )}
          {isDateMode && (
            <span className="text-xs text-slate-500 font-semibold">{humanDateKey(dateFilter)}</span>
          )}
          {isDateMode && grouped.otherDatesCount > 0 && (
            <span className="text-xs text-slate-400">
              {grouped.otherDatesCount} misi di tanggal lain disembunyikan
            </span>
          )}
        </div>
        {grouped.pending.length === 0 ? (
          <div className="text-sm text-slate-400 py-3">
            {isDateMode ? `Tidak ada tugas aktif untuk ${humanDateKey(dateFilter)}.` : "Tidak ada tugas aktif."}
          </div>
        ) : (<>
        <div className="text-[11px] text-slate-400 px-1 pb-1 flex items-center gap-1">
          ⠿ Tahan ikon titik-titik lalu geser untuk mengubah urutan misi{savingOrder ? " · menyimpan…" : ""}
        </div>
        <div className="flex flex-wrap items-center gap-2 px-1 pb-2">
          <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-semibold text-slate-600">
            <input
              type="checkbox"
              className="w-4 h-4 accent-indigo-600"
              checked={selectedIds.length > 0 && selectedIds.length === (localOrder || grouped.pending).length}
              // Indeterminate is the honest state for a partial selection —
              // without it a half-ticked list looks fully unselected.
              ref={(el) => { if (el) el.indeterminate = selectedIds.length > 0 && selectedIds.length < (localOrder || grouped.pending).length; }}
              onChange={(e) =>
                setSelectedIds(e.target.checked ? (localOrder || grouped.pending).map((x) => x.id) : [])
              }
            />
            Pilih semua
          </label>
          {selectedIds.length > 0 && (
            <>
              <span className="text-xs text-slate-500">{selectedIds.length} dipilih</span>
              <button
                onClick={bulkDelete}
                disabled={bulkDeleting}
                className="press-btn inline-flex items-center gap-1 bg-red-500 hover:bg-red-600 text-white font-semibold px-3 py-1.5 rounded-lg text-xs disabled:opacity-60"
              >
                <Trash2 className="w-3.5 h-3.5" strokeWidth={2.5} />
                {bulkDeleting ? "Menghapus…" : `Hapus ${selectedIds.length} tugas`}
              </button>
              <button
                onClick={() => setSelectedIds([])}
                className="press-btn text-xs text-slate-500 underline px-1"
              >
                Batal pilih
              </button>
            </>
          )}
        </div>
        {(localOrder || grouped.pending).map((t) => (
          <div
            key={t.id}
            data-task-row={t.id}
            className={`rounded-2xl transition-all ${dragId === t.id ? "opacity-50 scale-[0.99]" : ""} ${
              overId === t.id && dragId !== t.id ? "ring-2 ring-indigo-300" : ""
            } ${savingOrder ? "pointer-events-none" : ""}`}
          >
          <TaskRow task={t} childName={rowName(t)} currentDateFilter={dateFilter}>
            <input
              type="checkbox"
              checked={selectedIds.includes(t.id)}
              onChange={() => toggleSelected(t.id)}
              onClick={(e) => e.stopPropagation()}
              className="w-4 h-4 accent-indigo-600 mr-0.5"
              title="Pilih untuk dihapus massal"
            />
            <button
              onPointerDown={(e) => beginDrag(e, t)}
              className="press-btn p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 cursor-grab active:cursor-grabbing select-none"
              style={{ touchAction: "none" }}
              title="Tahan dan geser untuk mengubah urutan"
              aria-label="Ubah urutan"
            >
              <GripVertical className="w-4 h-4" strokeWidth={2.5} />
            </button>
            {editBtn(t)}
            <button onClick={() => miss(t)} data-testid={`${TEST_IDS.parent.missTaskBtn}-${t.id}`} className="press-btn p-1.5 rounded-lg hover:bg-red-50 text-red-500" title="Tandai terlewat">
              <AlertTriangle className="w-4 h-4" strokeWidth={2.5} />
            </button>
            <button onClick={() => onApplyConsequence(t)} className="press-btn p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" title="Terapkan konsekuensi">
              <ShieldAlert className="w-4 h-4" strokeWidth={2.5} />
            </button>
            <button onClick={() => del(t)} data-testid={`${TEST_IDS.parent.deleteTaskBtn}-${t.id}`} className="press-btn p-1.5 rounded-lg hover:bg-red-50 text-red-500" title="Hapus tugas">
              <Trash2 className="w-4 h-4" strokeWidth={2.5} />
            </button>
          </TaskRow>
          </div>
        ))}
        </>)}
      </Section>

      {/* "Selesai" section intentionally removed from the Tugas menu — completed
          tasks (with start/finish times + duration) live in Monitor Harian to
          avoid showing the same list in two places. */}

      {grouped.missed.length > 0 && (
        <Section title="❌ Terlewat" count={grouped.missed.length}>
          {grouped.missed.slice(0, 10).map((t) => (
            <TaskRow key={t.id} task={t} childName={rowName(t)} dim>
              {editBtn(t)}
              <span className="text-sm text-red-500">−{t.penalty_points || 0} poin</span>
              <button
                onClick={() => undoMiss(t)}
                title="Batalkan status terlewat (penalti dikembalikan, misi aktif lagi)"
                className="press-btn inline-flex items-center gap-1 bg-white border border-amber-200 text-amber-600 font-semibold px-2.5 py-1 rounded-lg text-xs"
              >
                <Undo2 className="w-3.5 h-3.5" /> Batalkan
              </button>
            </TaskRow>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, count, pointsTotal, children }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <h4 className="font-parent font-bold text-slate-900">{title}</h4>
        <div className="flex items-center gap-2">
          {typeof pointsTotal === "number" && pointsTotal !== 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600 bg-amber-50 rounded-full px-2 py-0.5">
              <Star className="w-3 h-3" strokeWidth={2.5} /> {pointsTotal} poin
            </span>
          )}
          {typeof count === "number" && <span className="text-sm text-slate-400">{count}</span>}
        </div>
      </div>
      <div className="divide-y divide-slate-100">{children}</div>
    </div>
  );
}

function TaskRow({ task, childName, children, dim = false, currentDateFilter = null }) {
  // When the parent is already looking at one specific day, repeating that
  // same date on every single row is just noise — only show the date chip
  // when it's NOT the day currently being viewed (i.e. useful information),
  // or always in "Semua Tanggal" mode where every row could be a different day.
  const showDateChip = task.date_key && (currentDateFilter === "all" || task.date_key !== currentDateFilter);
  const isOverdue = task.date_key && task.date_key < todayKey();

  const Chip = ({ children: c, tone = "slate", title }) => (
    <span
      title={title}
      className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
        tone === "red" ? "bg-red-50 text-red-600" :
        tone === "green" ? "bg-green-50 text-green-600" :
        tone === "indigo" ? "bg-indigo-50 text-indigo-600" :
        tone === "amber" ? "bg-amber-50 text-amber-600" :
        "bg-slate-100 text-slate-500"
      }`}
    >
      {c}
    </span>
  );

  return (
    <div className={`p-3.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 ${dim ? "opacity-60" : ""}`} data-testid={`${TEST_IDS.parent.taskItem}-${task.id}`}>
      {task.order != null && (
        <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-600 font-bold text-xs flex items-center justify-center shrink-0" title="Urutan misi">
          {task.order}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="font-parent font-semibold text-slate-900 truncate flex items-center gap-1.5">
          {task.title}
          {task._groupKidIds && task._groupKidIds.length > 1 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600 shrink-0" title="Tugas bersama — klik tab anak untuk edit khusus">
              👥
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap mt-1">
          <span className="text-xs text-slate-400">{childName}</span>
          <Chip tone="green">+{task.points}</Chip>
          {task.penalty_points > 0 && <Chip tone="red" title={`Penalti jika terlewat: ${task.penalty_points}`}>−{task.penalty_points}</Chip>}
          {showDateChip && (
            <Chip tone={isOverdue ? "red" : task.date_key === todayKey() ? "green" : "slate"}>
              📅 {humanDateKey(task.date_key)}
            </Chip>
          )}
          {task.duration_minutes && <Chip title="Perkiraan durasi (info saja)">⏱️ {task.duration_minutes}m</Chip>}
          {task.status === "skipped" && <Chip tone="amber">dilewati</Chip>}
        </div>
        {/* When the child ticked it — the section's finish time is the only
            deadline, so this is the one timestamp worth showing. */}
        {task.checked_at && (
          <div className="flex items-center gap-2 flex-wrap mt-1 text-[11px] text-slate-400">
            <span title="Waktu anak mencentang">✔️ Dicentang {fmtClock(task.checked_at)}</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap shrink-0">{children}</div>
    </div>
  );
}
