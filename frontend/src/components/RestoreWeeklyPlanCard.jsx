import { useState } from "react";
import { LifeBuoy, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

/**
 * One-click restore of the family's original weekly routine.
 *
 * This mirrors the plan that was designed for Adskhan & Syila (weekday school
 * routine + lighter weekend), so a schedule that was wiped can be rebuilt
 * without re-typing ~30 rows by hand. Existing slots are skipped server-side,
 * so pressing it twice can't duplicate the calendar.
 */

const WEEKDAYS = [0, 1, 2, 3, 4]; // Mon–Fri
const SAT = [5];
const SUN = [6];
const WEEKEND = [5, 6];

// [title, due_time, duration, points, style, weekdays, togetherBonus]
const ADSKHAN_WEEKDAY = [
  ["Bangun pagi", "05:00", 10, 5, "routine", WEEKDAYS, 0],
  ["Sholat Subuh", "05:15", 15, 10, "routine", WEEKDAYS, 5],
  ["Rapikan tempat tidur", "05:35", 10, 5, "routine", WEEKDAYS, 0],
  ["Mandi pagi", "06:00", 15, 10, "routine", WEEKDAYS, 0],
  ["Sarapan & siapkan tas sekolah", "06:30", 20, 10, "routine", WEEKDAYS, 0],
  ["Ganti baju sepulang sekolah", "15:30", 10, 5, "routine", WEEKDAYS, 0],
  ["Kerjakan PR / tugas sekolah", "16:00", 45, 20, "learning", WEEKDAYS, 0],
  ["Mandi sore", "17:45", 15, 10, "routine", WEEKDAYS, 0],
  ["Sholat Maghrib", "18:15", 15, 10, "routine", WEEKDAYS, 5],
  ["Makan malam bersama keluarga", "18:45", 20, 5, "routine", WEEKDAYS, 0],
  ["Membaca buku 20 menit", "19:15", 20, 10, "learning", WEEKDAYS, 0],
  ["Siapkan perlengkapan sekolah besok", "19:45", 10, 5, "routine", WEEKDAYS, 0],
  ["Sikat gigi sebelum tidur", "20:15", 5, 5, "routine", WEEKDAYS, 0],
];

const SYILA_WEEKDAY = [
  ["Bangun pagi", "05:00", 10, 5, "routine", WEEKDAYS, 0],
  ["Sholat Subuh", "05:15", 15, 10, "routine", WEEKDAYS, 5],
  ["Rapikan tempat tidur", "05:35", 10, 5, "routine", WEEKDAYS, 0],
  ["Mandi pagi", "06:00", 15, 10, "routine", WEEKDAYS, 0],
  ["Sarapan pagi", "06:30", 20, 10, "routine", WEEKDAYS, 0],
  ["Ganti baju sepulang sekolah", "15:30", 10, 5, "routine", WEEKDAYS, 0],
  ["Kerjakan PR sekolah", "16:00", 30, 15, "learning", WEEKDAYS, 0],
  ["Bantu Ummi siapkan camilan/makan malam", "16:30", 20, 10, "helper", WEEKDAYS, 0],
  ["Mandi sore", "17:45", 15, 10, "routine", WEEKDAYS, 0],
  ["Sholat Maghrib", "18:15", 15, 10, "routine", WEEKDAYS, 5],
  ["Makan malam bersama keluarga", "18:45", 20, 5, "routine", WEEKDAYS, 0],
  ["Cerita hari ini ke Abi/Ummi", "19:15", 15, 10, "social", WEEKDAYS, 0],
  ["Siapkan perlengkapan sekolah besok", "19:45", 10, 5, "routine", WEEKDAYS, 0],
  ["Sikat gigi sebelum tidur", "20:15", 5, 5, "routine", WEEKDAYS, 0],
];

// Weekend routine — identical for both kids
const WEEKEND_PLAN = [
  ["Bangun pagi", "06:30", 10, 5, "routine", WEEKEND, 0],
  ["Sholat Subuh", "06:45", 15, 10, "routine", WEEKEND, 5],
  ["Rapikan tempat tidur", "07:05", 10, 5, "routine", WEEKEND, 0],
  ["Mandi pagi", "07:30", 15, 10, "routine", WEEKEND, 0],
  ["Sarapan bersama keluarga", "08:00", 20, 5, "routine", WEEKEND, 0],
  ["Beres-beres kamar mingguan", "10:00", 30, 15, "helper", SAT, 0],
  ["Mandi sore", "17:30", 15, 10, "routine", WEEKEND, 0],
  ["Sholat Maghrib", "18:00", 15, 10, "routine", WEEKEND, 5],
  ["Makan malam bersama keluarga", "18:30", 20, 5, "routine", WEEKEND, 0],
  ["Family time (nonton/main board game bareng)", "19:00", 45, 10, "social", SUN, 0],
  ["Siapkan baju & tas untuk Senin", "20:00", 10, 5, "routine", SUN, 0],
  ["Sikat gigi sebelum tidur", "20:15", 5, 5, "routine", WEEKEND, 0],
];

const BONUS = {
  Adskhan: ["Main strategi/puzzle/catur 20 menit", 10, "challenge"],
  Syila: ["Main/gambar bareng kakak 20 menit", 10, "social"],
};

function row(def, childId) {
  const [title, due_time, duration_minutes, points, task_style, weekdays, together] = def;
  const t = {
    title, due_time, duration_minutes, points, task_style, weekdays,
    target_children: [childId],
    recurrence: "weekly",
  };
  if (together > 0) {
    t.together_bonus_enabled = true;
    t.together_bonus_points = together;
  }
  return t;
}

export default function RestoreWeeklyPlanCard({ onChanged }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const totalRows =
    ADSKHAN_WEEKDAY.length + SYILA_WEEKDAY.length + WEEKEND_PLAN.length * 2 + 2;

  const restore = async () => {
    if (!window.confirm(
      `Pulihkan jadwal mingguan (${totalRows} baris jadwal) untuk Adskhan & Syila?\n\n` +
      "Jadwal yang slotnya sudah ada akan dilewati, jadi tidak akan dobel."
    )) return;
    setBusy(true);
    try {
      const { data: kids } = await api.get("/children");
      const find = (n) => kids.find((k) => k.name.toLowerCase() === n.toLowerCase());
      const ads = find("Adskhan");
      const syi = find("Syila");
      if (!ads || !syi) {
        toast.error("Tidak menemukan anak bernama Adskhan / Syila");
        setBusy(false);
        return;
      }

      const tasks = [
        ...ADSKHAN_WEEKDAY.map((d) => row(d, ads.id)),
        ...SYILA_WEEKDAY.map((d) => row(d, syi.id)),
        ...WEEKEND_PLAN.map((d) => row(d, ads.id)),
        ...WEEKEND_PLAN.map((d) => row(d, syi.id)),
      ];
      // Bonus missions (optional, not part of the required sequence)
      [[ads, "Adskhan"], [syi, "Syila"]].forEach(([kid, name]) => {
        const [title, points, task_style] = BONUS[name];
        tasks.push({
          title, points, task_style, duration_minutes: 20,
          target_children: [kid.id], weekdays: WEEKDAYS,
          recurrence: "weekly", is_bonus: true,
        });
      });

      const { data } = await api.post("/tasks/bulk-import", { tasks, skip_existing: true });
      const msg = `${data.created} misi dibuat, ${data.skipped} dilewati (sudah ada)`;
      if (data.errors?.length) {
        toast.warning(`${msg} · ${data.errors.length} gagal`);
        console.warn("Bulk import errors:", data.errors);
      } else {
        toast.success(`Jadwal mingguan dipulihkan — ${msg}`);
      }
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h3 className="font-parent font-bold text-lg text-slate-900 mb-1 flex items-center gap-2">
        <LifeBuoy className="w-5 h-5 text-emerald-600" /> Pulihkan Jadwal Mingguan
      </h3>
      <p className="text-sm text-slate-500 mb-3">
        Membuat ulang rutinitas mingguan Adskhan & Syila (Senin–Jumat sekolah + akhir pekan yang lebih santai)
        sesuai rancangan awal, lengkap dengan jam, durasi, poin, dan bonus berjamaah. Slot yang sudah ada
        dilewati otomatis, jadi aman diklik berulang.
      </p>

      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-slate-500 inline-flex items-center gap-1 mb-3 hover:text-slate-700"
      >
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {open ? "Sembunyikan rincian" : "Lihat rincian yang akan dibuat"}
      </button>

      {open && (
        <div className="mb-3 max-h-64 overflow-y-auto bg-slate-50 rounded-2xl p-3 text-xs text-slate-600 space-y-2">
          <div>
            <div className="font-bold text-slate-700 mb-1">Adskhan — Senin s/d Jumat</div>
            {ADSKHAN_WEEKDAY.map((d) => (
              <div key={`a-${d[0]}-${d[1]}`}>{d[1]} · {d[0]} ({d[3]} poin{d[6] ? `, +${d[6]} berjamaah` : ""})</div>
            ))}
          </div>
          <div>
            <div className="font-bold text-slate-700 mb-1">Syila — Senin s/d Jumat</div>
            {SYILA_WEEKDAY.map((d) => (
              <div key={`s-${d[0]}-${d[1]}`}>{d[1]} · {d[0]} ({d[3]} poin{d[6] ? `, +${d[6]} berjamaah` : ""})</div>
            ))}
          </div>
          <div>
            <div className="font-bold text-slate-700 mb-1">Akhir pekan — keduanya</div>
            {WEEKEND_PLAN.map((d) => (
              <div key={`w-${d[0]}-${d[1]}`}>
                {d[1]} · {d[0]} ({d[3]} poin)
                {d[5] === SAT ? " — Sabtu saja" : d[5] === SUN ? " — Minggu saja" : ""}
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={restore}
        disabled={busy}
        className="press-btn inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-4 py-2 rounded-xl text-sm disabled:opacity-60"
      >
        <LifeBuoy className="w-4 h-4" /> {busy ? "Memulihkan…" : "Pulihkan Sekarang"}
      </button>
    </div>
  );
}
