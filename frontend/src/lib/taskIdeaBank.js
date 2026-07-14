// A curated bank of ready-made mission ideas so a parent doesn't have to
// think one up from scratch every time. Filterable by the child's age and
// task_style (which already maps to each MBTI type's best_styles in
// personality.js), so suggestions actually fit who they're for.

export const TASK_IDEA_BANK = [
  // --- routine ---
  { title: "Rapikan tempat tidur", points: 5, ageMin: 4, ageMax: 12, style: "routine", emoji: "🛏️" },
  { title: "Sikat gigi pagi & malam", points: 5, ageMin: 3, ageMax: 10, style: "routine", emoji: "🦷" },
  { title: "Ganti baju sendiri", points: 5, ageMin: 3, ageMax: 7, style: "routine", emoji: "👕" },
  { title: "Rapikan mainan setelah main", points: 5, ageMin: 3, ageMax: 8, style: "routine", emoji: "🧸" },
  { title: "Siapkan tas sekolah untuk besok", points: 10, ageMin: 6, ageMax: 14, style: "routine", emoji: "🎒" },
  { title: "Cuci tangan sebelum makan", points: 3, ageMin: 3, ageMax: 8, style: "routine", emoji: "🧼" },
  { title: "Minum air putih 8 gelas", points: 5, ageMin: 5, ageMax: 15, style: "routine", emoji: "💧" },
  { title: "Tidur tepat waktu", points: 10, ageMin: 4, ageMax: 15, style: "routine", emoji: "😴" },

  // --- helper ---
  { title: "Bantu siapkan meja makan", points: 10, ageMin: 5, ageMax: 12, style: "helper", emoji: "🍽️" },
  { title: "Bantu cuci piring", points: 15, ageMin: 8, ageMax: 15, style: "helper", emoji: "🧽" },
  { title: "Bantu jemur/lipat cucian", points: 10, ageMin: 6, ageMax: 13, style: "helper", emoji: "👚" },
  { title: "Bantu adik/kakak PR", points: 15, ageMin: 9, ageMax: 15, style: "helper", emoji: "📝" },
  { title: "Beri makan hewan peliharaan keluarga", points: 10, ageMin: 5, ageMax: 14, style: "helper", emoji: "🐾" },
  { title: "Siram tanaman", points: 5, ageMin: 4, ageMax: 12, style: "helper", emoji: "🪴" },
  { title: "Bantu bawa belanjaan", points: 10, ageMin: 6, ageMax: 14, style: "helper", emoji: "🛒" },
  { title: "Ajari adik satu hal baru", points: 15, ageMin: 8, ageMax: 15, style: "helper", emoji: "👨‍🏫" },

  // --- learning ---
  { title: "Baca buku 15 menit", points: 15, ageMin: 5, ageMax: 15, style: "learning", emoji: "📖" },
  { title: "Latihan soal matematika", points: 15, ageMin: 6, ageMax: 15, style: "learning", emoji: "🔢" },
  { title: "Belajar kosakata baru (5 kata)", points: 10, ageMin: 6, ageMax: 14, style: "learning", emoji: "🔤" },
  { title: "Nonton video edukasi 20 menit", points: 10, ageMin: 5, ageMax: 13, style: "learning", emoji: "🎬" },
  { title: "Tulis jurnal harian singkat", points: 10, ageMin: 7, ageMax: 15, style: "learning", emoji: "✍️" },
  { title: "Pelajari 1 fakta unik hari ini", points: 5, ageMin: 5, ageMax: 12, style: "learning", emoji: "💡" },

  // --- creative ---
  { title: "Gambar atau lukis bebas", points: 10, ageMin: 4, ageMax: 12, style: "creative", emoji: "🎨" },
  { title: "Buat sesuatu dari kertas origami", points: 10, ageMin: 5, ageMax: 12, style: "creative", emoji: "📄" },
  { title: "Bangun sesuatu dari lego/balok", points: 10, ageMin: 4, ageMax: 10, style: "creative", emoji: "🧱" },
  { title: "Tulis cerita pendek", points: 15, ageMin: 7, ageMax: 15, style: "creative", emoji: "📝" },
  { title: "Latihan main alat musik 15 menit", points: 15, ageMin: 6, ageMax: 15, style: "creative", emoji: "🎹" },
  { title: "Buat prakarya dari barang bekas", points: 15, ageMin: 6, ageMax: 13, style: "creative", emoji: "♻️" },

  // --- social ---
  { title: "Main board game bersama keluarga", points: 10, ageMin: 5, ageMax: 15, style: "social", emoji: "🎲" },
  { title: "Video call kakek/nenek", points: 10, ageMin: 4, ageMax: 15, style: "social", emoji: "📞" },
  { title: "Ajak adik/kakak main bersama", points: 10, ageMin: 4, ageMax: 13, style: "social", emoji: "🤗" },
  { title: "Cerita tentang hari ini ke Abi/Ummi", points: 5, ageMin: 3, ageMax: 12, style: "social", emoji: "💬" },
  { title: "Bantu teman yang kesulitan", points: 15, ageMin: 6, ageMax: 15, style: "social", emoji: "🤝" },

  // --- challenge ---
  { title: "Selesaikan puzzle/teka-teki", points: 15, ageMin: 5, ageMax: 14, style: "challenge", emoji: "🧩" },
  { title: "Olahraga/lari 20 menit", points: 15, ageMin: 6, ageMax: 15, style: "challenge", emoji: "🏃" },
  { title: "Coba 1 hal baru yang menantang", points: 20, ageMin: 6, ageMax: 15, style: "challenge", emoji: "🎯" },
  { title: "Selesaikan misi tanpa diingatkan", points: 20, ageMin: 7, ageMax: 15, style: "challenge", emoji: "⚡" },
  { title: "Susun rencana kegiatan besok sendiri", points: 15, ageMin: 8, ageMax: 15, style: "challenge", emoji: "📋" },
];

export function filterTaskIdeas({ age, style }) {
  return TASK_IDEA_BANK.filter((idea) => {
    const ageOk = !age || (age >= idea.ageMin && age <= idea.ageMax);
    const styleOk = !style || style === "all" || idea.style === style;
    return ageOk && styleOk;
  });
}
