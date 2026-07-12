// HomeRoutines-inspired routine templates: one tap creates a whole ordered
// quest chain. Times are sensible Indonesian-household defaults the parent
// can edit per-task afterwards.

export const ROUTINE_TEMPLATES = [
  {
    key: "pagi",
    label: "Rutinitas Pagi",
    emoji: "🌅",
    desc: "Bangun sampai siap beraktivitas",
    tasks: [
      { title: "Bangun pagi & rapikan tempat tidur", points: 10, duration_minutes: 10, due_time: "06:00", task_style: "routine" },
      { title: "Sikat gigi & cuci muka", points: 5, duration_minutes: 5, due_time: "06:15", task_style: "routine" },
      { title: "Mandi pagi", points: 10, duration_minutes: 15, due_time: "06:45", task_style: "routine" },
      { title: "Sarapan", points: 5, duration_minutes: 20, due_time: "07:15", task_style: "routine" },
    ],
  },
  {
    key: "sore",
    label: "Rutinitas Sore",
    emoji: "🌇",
    desc: "Pulang aktivitas sampai makan malam",
    tasks: [
      { title: "Rapikan tas & seragam", points: 5, duration_minutes: 10, due_time: "16:00", task_style: "routine" },
      { title: "Mandi sore", points: 10, duration_minutes: 15, due_time: "17:00", task_style: "routine" },
      { title: "Bantu siapkan makan malam", points: 10, duration_minutes: 20, due_time: "18:30", task_style: "helper" },
    ],
  },
  {
    key: "malam",
    label: "Rutinitas Malam",
    emoji: "🌙",
    desc: "Beres-beres sampai tidur",
    tasks: [
      { title: "Rapikan mainan & meja belajar", points: 10, duration_minutes: 15, due_time: "19:30", task_style: "routine" },
      { title: "Siapkan perlengkapan besok", points: 5, duration_minutes: 10, due_time: "20:00", task_style: "routine" },
      { title: "Sikat gigi sebelum tidur", points: 5, duration_minutes: 5, due_time: "20:30", task_style: "routine" },
    ],
  },
  {
    key: "belajar",
    label: "Waktu Belajar",
    emoji: "📚",
    desc: "PR, membaca, dan mengaji",
    tasks: [
      { title: "Kerjakan PR / tugas sekolah", points: 15, duration_minutes: 45, task_style: "learning" },
      { title: "Membaca buku 15 menit", points: 10, duration_minutes: 15, task_style: "learning" },
      { title: "Mengaji / hafalan", points: 15, duration_minutes: 20, task_style: "learning" },
    ],
  },
  {
    key: "kebersihan",
    label: "Beres-Beres Rumah",
    emoji: "🧹",
    desc: "Bantu kebersihan rumah bersama",
    tasks: [
      { title: "Sapu kamar sendiri", points: 10, duration_minutes: 15, task_style: "helper" },
      { title: "Bantu cuci piring", points: 10, duration_minutes: 15, task_style: "helper" },
      { title: "Buang sampah", points: 5, duration_minutes: 5, task_style: "helper" },
    ],
  },
];
