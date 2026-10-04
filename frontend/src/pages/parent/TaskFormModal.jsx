import { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { TASK_STYLES } from "@/lib/personality";
import { todayKey, humanDateKey } from "@/lib/dates";
import { filterTaskIdeas } from "@/lib/taskIdeaBank";
import { Modal, btnGhost, btnPrimary, inputClass, labelClass } from "@/pages/parent/shared";

export function TaskFormModal({ open, onClose, kids, defaultChildId, onSaved, editTask }) {
  const isDuplicate = editTask && editTask._isDuplicate;
  const isEdit = !!editTask && !isDuplicate;
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [points, setPoints] = useState(10);
  const [penalty, setPenalty] = useState(0);
  const [dateKey, setDateKey] = useState(todayKey());
  const [segmentId, setSegmentId] = useState("");
  const [segments, setSegments] = useState([]);
  const [isBonus, setIsBonus] = useState(false);
  const [photoRequired, setPhotoRequired] = useState(false);
  const [isCoop, setIsCoop] = useState(false);
  const [togetherBonusEnabled, setTogetherBonusEnabled] = useState(false);
  const [togetherBonusPoints, setTogetherBonusPoints] = useState(10);
  const [order, setOrder] = useState("");
  const [taskStyle, setTaskStyle] = useState("");
  const [showIdeaBank, setShowIdeaBank] = useState(false);
  const [ideaStyleFilter, setIdeaStyleFilter] = useState("all");
  // Selected kid ids: [] means "everyone" (broadcast). Edit mode is always the task's own child.
  const [selectedKidIds, setSelectedKidIds] = useState(
    defaultChildId ? [defaultChildId] : []
  );
  const [saving, setSaving] = useState(false);

  // Sections carry the clock now, so the form offers "which part of the day"
  // instead of a per-task time.
  useEffect(() => {
    if (!open) return;
    api.get("/config")
      .then(({ data }) => setSegments(data.day_segments || []))
      .catch(() => setSegments([]));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (editTask && !isDuplicate) {
      setSelectedKidIds([editTask.child_id]);
      setTitle(editTask.title || "");
      setDesc(editTask.description || "");
      setPoints(editTask.points ?? 10);
      setPenalty(editTask.penalty_points ?? 0);
      setDateKey(editTask.date_key || todayKey());
      setSegmentId(editTask.segment_id || "");
      setIsBonus(!!editTask.is_bonus);
      setPhotoRequired(!!editTask.photo_required);
      setIsCoop(!!editTask.is_coop);
      setTogetherBonusEnabled(!!editTask.together_bonus_enabled);
      setTogetherBonusPoints(editTask.together_bonus_points || 10);
      setOrder(editTask.order ? String(editTask.order) : "");
      setTaskStyle(editTask.task_style || "");
    } else if (isDuplicate) {
      // Pre-fill from source task but as NEW — allow changing kid/schedule
      setSelectedKidIds(defaultChildId ? [defaultChildId] : []);
      setTitle(editTask.title || "");
      setDesc(editTask.description || "");
      setPoints(editTask.points ?? 10);
      setPenalty(editTask.penalty_points ?? 0);
      setDateKey(todayKey());
      setSegmentId(editTask.segment_id || "");
      setIsBonus(!!editTask.is_bonus);
      setPhotoRequired(!!editTask.photo_required);
      setIsCoop(false);
      setTogetherBonusEnabled(!!editTask.together_bonus_enabled);
      setTogetherBonusPoints(editTask.together_bonus_points || 10);
      setOrder(""); // fresh order
      setTaskStyle(editTask.task_style || "");
    } else {
      setSelectedKidIds(defaultChildId ? [defaultChildId] : []);
      setTitle(""); setDesc(""); setPoints(10); setPenalty(0);
      setDateKey(todayKey());
      setSegmentId("");
      setIsBonus(false); setPhotoRequired(false); setIsCoop(false);
      setTogetherBonusEnabled(false); setTogetherBonusPoints(10);
      setOrder(""); setTaskStyle("");
    }
  }, [open, defaultChildId, editTask, isDuplicate]);

  const toggleKid = (id) => {
    setSelectedKidIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const isBroadcast = selectedKidIds.length === 0;
  const isSingle = selectedKidIds.length === 1;

  const submit = async () => {
    if (!title.trim()) return toast.error("Judul tugas wajib diisi");
    if (!isEdit && isCoop && selectedKidIds.length < 2) {
      return toast.error("Misi bersama butuh minimal 2 anak dipilih (bukan Semua/1 anak)");
    }
    if (togetherBonusEnabled && (!togetherBonusPoints || Number(togetherBonusPoints) < 1)) {
      return toast.error("Tentukan poin bonus untuk opsi 'dilakukan bersama'");
    }
    setSaving(true);
    try {
      const body = {
        title: title.trim(),
        description: desc,
        points: Number(points) || 0,
        penalty_points: Number(penalty) || 0,
        date_key: dateKey || null,
        segment_id: segmentId || null,
        is_bonus: isCoop ? true : isBonus,
        photo_required: photoRequired,
        coop: !isEdit && isCoop,
        together_bonus_enabled: togetherBonusEnabled,
        together_bonus_points: togetherBonusEnabled ? Number(togetherBonusPoints) : null,
        order: order ? Number(order) : null,
        task_style: taskStyle || null,
      };
      if (isEdit) {
        await api.patch(`/tasks/${editTask.id}`, body);
        toast.success("Tugas diperbarui");
      } else if (isCoop) {
        await api.post("/tasks", { ...body, target_children: selectedKidIds });
        toast.success(`Misi bersama dibuat untuk ${selectedKidIds.length} anak 🤝`);
      } else {
        // Broadcast: send empty target_children (or all kid ids). Backend treats empty as "all".
        if (isBroadcast) {
          await api.post("/tasks", { ...body, target_children: [] });
          toast.success(`Tugas dibuat untuk semua anak (${kids.length})`);
        } else if (isSingle) {
          await api.post("/tasks", { ...body, child_id: selectedKidIds[0] });
          toast.success("Tugas dibuat");
        } else {
          await api.post("/tasks", { ...body, target_children: selectedKidIds });
          toast.success(`Tugas dibuat untuk ${selectedKidIds.length} anak`);
        }
      }
      onSaved();
      onClose();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "Edit tugas" : isDuplicate ? "Duplikat tugas" : "Tugas baru"}>
      <div className="space-y-4">
        {!isEdit && (
          <div>
            <button
              type="button"
              onClick={() => setShowIdeaBank((v) => !v)}
              className="press-btn inline-flex items-center gap-1.5 text-xs font-bold text-amber-600 bg-amber-50 hover:bg-amber-100 px-3 py-1.5 rounded-full"
            >
              💡 {showIdeaBank ? "Sembunyikan Ide Misi" : "Cari Ide Misi"}
            </button>
            {showIdeaBank && (
              <div className="mt-2 bg-slate-50 rounded-xl p-3 border border-slate-200">
                <div className="flex gap-1.5 flex-wrap mb-2">
                  {[{ key: "all", label: "Semua" }, ...Object.entries(TASK_STYLES).map(([key, s]) => ({ key, label: `${s.emoji} ${s.label}` }))].map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setIdeaStyleFilter(opt.key)}
                      className={`px-2 py-1 rounded-full text-[11px] font-semibold ${ideaStyleFilter === opt.key ? "bg-indigo-500 text-white" : "bg-white text-slate-500 border border-slate-200"}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {filterTaskIdeas({
                    age: kids.find((k) => k.id === selectedKidIds[0])?.age,
                    style: ideaStyleFilter,
                  }).map((idea, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        setTitle(idea.title);
                        setPoints(idea.points);
                        setTaskStyle(idea.style);
                        setShowIdeaBank(false);
                        toast.success(`"${idea.title}" dipakai — sesuaikan detail lain kalau perlu`);
                      }}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-white text-sm text-slate-700 flex items-center gap-2"
                    >
                      <span>{idea.emoji}</span> {idea.title}
                      <span className="ml-auto text-xs text-amber-600 font-bold">+{idea.points}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <div>
          <label className={labelClass}>Tugas</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} placeholder="Rapikan tempat tidur" data-testid="task-title-input" />
        </div>
        <div>
          <label className={labelClass}>Deskripsi (opsional)</label>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} className={inputClass} rows={2} />
        </div>
        {/* Kid selection */}
        <div>
          <label className={labelClass}>Untuk anak</label>
          {isEdit ? (
            <div className="text-sm text-slate-500 bg-slate-50 rounded-xl px-3 py-2 border border-slate-200">
              {kids.find((k) => k.id === selectedKidIds[0])?.name || "—"}
              <span className="text-xs text-slate-400 ml-2">(tidak bisa diubah saat edit)</span>
            </div>
          ) : (
            <div className="space-y-2">
              {!isCoop && (
                <button
                  type="button"
                  onClick={() => setSelectedKidIds([])}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition-colors ${
                    isBroadcast ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${
                    isBroadcast ? "bg-indigo-500 border-indigo-500" : "border-slate-300"
                  }`}>
                    {isBroadcast && <span className="text-white text-xs">✓</span>}
                  </div>
                  <span className="font-semibold text-slate-800">🌟 Semua anak (broadcast)</span>
                  <span className="text-xs text-slate-500 ml-auto">1 tugas untuk tiap anak</span>
                </button>
              )}
              <div className="grid grid-cols-2 gap-2">
                {kids.map((c) => {
                  const checked = selectedKidIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleKid(c.id)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition-colors ${
                        checked ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${
                        checked ? "bg-indigo-500 border-indigo-500" : "border-slate-300"
                      }`}>
                        {checked && <span className="text-white text-xs">✓</span>}
                      </div>
                      <div className="w-6 h-6 rounded-lg flex items-center justify-center text-sm" style={{ background: c.avatar_color }}>
                        {c.avatar_emoji}
                      </div>
                      <span className="font-semibold text-slate-800 text-sm truncate">{c.name}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-slate-400">
                {isCoop
                  ? selectedKidIds.length < 2
                    ? "Pilih minimal 2 anak untuk misi bersama."
                    : `Misi bersama untuk ${selectedKidIds.length} anak — poin dibagi otomatis saat disetujui.`
                  : isBroadcast
                  ? `Akan dibuat 1 tugas untuk masing-masing dari ${kids.length} anak.`
                  : selectedKidIds.length === 0
                  ? "Pilih setidaknya satu anak, atau pilih 'Semua anak'."
                  : `Akan dibuat untuk ${selectedKidIds.length} anak.`}
              </p>
            </div>
          )}
        </div>

        {/* A mission made here is for one date. Anything that repeats every
            week belongs in the weekly routine instead. */}
        <div>
          <label className={labelClass}>📅 Tanggal</label>
          {isEdit ? (
            <div className="px-4 py-2.5 rounded-xl bg-slate-50 border-2 border-slate-100">
              <div className="text-sm font-semibold text-slate-700">{humanDateKey(dateKey)}</div>
              <p className="text-xs text-slate-500 mt-0.5">
                Untuk memindahkannya, hapus lalu buat ulang di hari yang kamu mau.
              </p>
            </div>
          ) : (
            <div>
              <input type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} className={inputClass} />
              <p className="text-xs text-slate-400 mt-1.5">
                Tugas sekali jalan di tanggal ini. Untuk tugas yang berulang tiap minggu, pakai Rutinitas Mingguan.
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelClass}>Poin</label>
            <input type="number" min="0" value={points} onChange={(e) => setPoints(e.target.value)} className={inputClass} data-testid="task-points-input" />
          </div>
          <div>
            <label className={labelClass}>Penalti</label>
            <input type="number" min="0" value={penalty} onChange={(e) => setPenalty(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Urutan (opsional)</label>
            <input type="number" min="1" value={order} onChange={(e) => setOrder(e.target.value)} className={inputClass} placeholder="Auto" />
          </div>
        </div>

        {/* Bonus toggle */}
        <button
          type="button"
          onClick={() => setIsBonus(!isBonus)}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-colors ${
            isBonus ? "border-amber-400 bg-amber-50" : "border-slate-200 hover:bg-slate-50"
          }`}
        >
          <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${
            isBonus ? "bg-amber-500 border-amber-500" : "border-slate-300"
          }`}>
            {isBonus && <span className="text-white text-xs">✓</span>}
          </div>
          <div className="flex-1 text-left">
            <div className="font-semibold text-slate-800 text-sm">✨ Tugas Bonus</div>
            <div className="text-xs text-slate-500">Tidak wajib, tidak menghalangi urutan misi. Poinnya jadi ekstra.</div>
          </div>
        </button>

        {/* Photo verification toggle */}
        <button
          type="button"
          onClick={() => setPhotoRequired(!photoRequired)}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-colors ${
            photoRequired ? "border-purple-400 bg-purple-50" : "border-slate-200 hover:bg-slate-50"
          }`}
        >
          <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${
            photoRequired ? "bg-purple-500 border-purple-500" : "border-slate-300"
          }`}>
            {photoRequired && <span className="text-white text-xs">✓</span>}
          </div>
          <div className="flex-1 text-left">
            <div className="font-semibold text-slate-800 text-sm">📷 Butuh Foto Bukti</div>
            <div className="text-xs text-slate-500">Anak harus lampirkan foto sebelum bisa menandai selesai.</div>
          </div>
        </button>

        {/* Co-op quest toggle — only offered when creating (not editing), since
            an existing task's coop-ness can't be changed after the fact. */}
        {!isEdit && !togetherBonusEnabled && (
          <button
            type="button"
            onClick={() => setIsCoop(!isCoop)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-colors ${
              isCoop ? "border-teal-400 bg-teal-50" : "border-slate-200 hover:bg-slate-50"
            }`}
          >
            <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${
              isCoop ? "bg-teal-500 border-teal-500" : "border-slate-300"
            }`}>
              {isCoop && <span className="text-white text-xs">✓</span>}
            </div>
            <div className="flex-1 text-left">
              <div className="font-semibold text-slate-800 text-sm">🤝 Misi Bersama (Co-op)</div>
              <div className="text-xs text-slate-500">
                SATU tugas dipakai berdua — siapa saja bisa menandai selesai, poin dibagi otomatis. Pilih minimal 2 anak di atas.
              </div>
            </div>
          </button>
        )}
        {isEdit && editTask?.is_coop && (
          <div className="text-xs text-teal-600 bg-teal-50 border border-teal-200 rounded-xl px-3 py-2">
            🤝 Ini misi bersama — poin akan dibagi ke semua peserta saat disetujui.
          </div>
        )}

        {/* "Bonus dilakukan bersama" — simpler alternative to co-op: task stays
            individual (one copy per kid via broadcast), but the kid answers a
            yes/no question on completion and gets an extra bonus if yes. Can
            be toggled anytime (create or edit), unlike co-op. */}
        {!isCoop && (
          <div>
            <button
              type="button"
              onClick={() => setTogetherBonusEnabled(!togetherBonusEnabled)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-colors ${
                togetherBonusEnabled ? "border-pink-400 bg-pink-50" : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${
                togetherBonusEnabled ? "bg-pink-500 border-pink-500" : "border-slate-300"
              }`}>
                {togetherBonusEnabled && <span className="text-white text-xs">✓</span>}
              </div>
              <div className="flex-1 text-left">
                <div className="font-semibold text-slate-800 text-sm">🎁 Bonus Jika Dilakukan Bersama</div>
                <div className="text-xs text-slate-500">
                  Tugas tetap individu (mis. Sholat Subuh) — tapi kalau dilakukan bareng saudara, anak dapat poin bonus ekstra. Anak akan ditanya "dilakukan bersama?" saat menandai selesai.
                </div>
              </div>
            </button>
            {togetherBonusEnabled && (
              <div className="mt-2 pl-8">
                <label className={labelClass}>Poin bonus jika bersama</label>
                <input
                  type="number" min="1" max="1000" value={togetherBonusPoints}
                  onChange={(e) => setTogetherBonusPoints(e.target.value.replace(/\D/g, ""))}
                  className={`${inputClass} max-w-[140px]`}
                />
              </div>
            )}
          </div>
        )}

        {/* Missions no longer carry their own timing — a section's start and
            end are the only clock. All that's left to choose is which section. */}
        <div className="grid grid-cols-1 gap-3 bg-slate-50 rounded-xl p-3 border border-slate-100">
          <div>
            <label className={labelClass}>🕒 Bagian hari</label>
            <select
              value={segmentId}
              onChange={(e) => setSegmentId(e.target.value)}
              className={inputClass}
            >
              <option value="">Kapan saja (tanpa bagian)</option>
              {segments.map((sg) => (
                <option key={sg.id} value={sg.id}>
                  {sg.emoji ? `${sg.emoji} ` : ""}{sg.label} ({sg.start_time}–{sg.end_time})
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-400 mt-1">
              Jam diambil dari bagiannya — tugas cukup diatur urutannya di dalam bagian itu.
              Rentang di atas adalah jam umum keluarga; kalau seorang anak punya jam mulai
              sendiri (diatur di Pengaturan → Jam Mulai per Anak), jam itulah yang berlaku untuknya.
            </p>
          </div>
        </div>

        <div>
          <label className={labelClass}>Gaya tugas (opsional)</label>
          <select value={taskStyle} onChange={(e) => setTaskStyle(e.target.value)} className={inputClass}>
            <option value="">— Otomatis sesuai kepribadian anak —</option>
            {Object.entries(TASK_STYLES).map(([key, s]) => (
              <option key={key} value={key}>{s.emoji} {s.label} — {s.desc}</option>
            ))}
          </select>
          <p className="text-xs text-slate-400 mt-1">
            Kalau dikosongkan, gaya dipilih otomatis dari tipe kepribadian anak (mis. INTJ-T → Tantangan, ENFJ-T → Membantu).
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className={btnGhost}>Batal</button>
          <button onClick={submit} disabled={saving} className={btnPrimary} data-testid="task-submit-btn">
            {saving ? "Menyimpan…" : isEdit ? "Simpan perubahan" : "Buat tugas"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
