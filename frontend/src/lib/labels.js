import { createContext, useContext } from "react";

// All user-facing labels that parents can customize/hide. Keyed by a stable id.
// The value is the default Indonesian text. Parents can override or blank (hide).
export const DEFAULT_LABELS = {
  // Login
  "login.title": "My Lil Famz",
  "login.subtitle": "Tugas seru untuk keluarga",
  "login.parent_tab": "Orang Tua",
  "login.kid_tab": "Anak",
  "login.passcode_prompt": "Masukkan passcode",
  "login.button": "Masuk",

  // Parent nav
  "nav.overview": "Overview",
  "nav.monitor": "Monitor Harian",
  "nav.tasks": "Tugas",
  "nav.rewards": "Hadiah",
  "nav.money": "Uang & Poin",
  "nav.consequences": "Konsekuensi",
  "nav.leaderboard": "Papan Juara",
  "nav.analytics": "Analitik",
  "nav.weekly": "Laporan Mingguan",
  "nav.settings": "Pengaturan",

  // Parent overview
  "overview.greeting": "Hi",
  "overview.manage": "kelola keluargamu",
  "overview.stat_children": "Anak",
  "overview.stat_tasks": "Tugas Aktif",
  "overview.stat_pending": "Menunggu Cek",
  "overview.stat_points": "Total Poin",

  // Tasks
  "tasks.new_button": "Tugas baru",
  "tasks.template_button": "Dari Template",
  "tasks.active_section": "Aktif",
  "tasks.empty": "Tidak ada tugas aktif.",

  // Kid app
  "kid.tab_tasks": "Misi",
  "kid.tab_rewards": "Toko",
  "kid.tab_money": "Tukar",
  "kid.tab_champs": "Juara",
  "kid.tab_profile": "Profil",
  "kid.greeting": "Halo",
  "kid.points_label": "poin",
  "kid.start_button": "Mulai",
  "kid.finish_button": "Selesai!",
  "kid.skip_button": "Lewati",
  "kid.daily_goal": "Target Poin Hari Ini",
  "kid.goal_reached": "Target harian tercapai!",
  "kid.bonus_section": "Misi Bonus",
  "kid.done_section": "Sudah selesai",

  // Money / piggy
  "money.savings_goal": "Target Tabunganku",
  "money.three_piggy": "Tiga Celenganku",
  "piggy.save": "Tabungan",
  "piggy.spend": "Belanja",
  "piggy.share": "Sedekah",
};

// Context holds the merged label map (defaults + overrides).
export const LabelContext = createContext({ labels: {}, custom: {} });

export function useLabels() {
  const { custom } = useContext(LabelContext);
  // Returns a resolver: t("key") -> custom override (may be "" to hide) or default.
  const t = (key) => {
    if (custom && Object.prototype.hasOwnProperty.call(custom, key)) {
      return custom[key]; // may be "" meaning hidden
    }
    return DEFAULT_LABELS[key] ?? key;
  };
  // Whether a label is hidden (explicitly blanked)
  const hidden = (key) => custom && custom[key] === "";
  return { t, hidden, custom };
}

// Label groups for the editor UI
export const LABEL_GROUPS = [
  { title: "Halaman Login", prefix: "login." },
  { title: "Menu Orang Tua", prefix: "nav." },
  { title: "Overview", prefix: "overview." },
  { title: "Tugas", prefix: "tasks." },
  { title: "Aplikasi Anak", prefix: "kid." },
  { title: "Uang & Celengan", prefix: "money.", extraPrefix: "piggy." },
];
