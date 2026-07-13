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

  // Money / ChikyBank
  "money.savings_goal": "Target Tabunganku",
  "money.three_chiky": "ChikyBank-ku",
  "chiky.save": "Tabungan",
  "chiky.spend": "Belanja",
  "chiky.share": "Sedekah",
};

// English translation set — same keys as DEFAULT_LABELS (Indonesian). Custom
// overrides from the label editor still apply on top of whichever language
// is active, so a parent's custom wording isn't lost when switching languages.
export const EN_LABELS = {
  "login.title": "My Lil Famz",
  "login.subtitle": "Fun tasks for the family",
  "login.parent_tab": "Parent",
  "login.kid_tab": "Kid",
  "login.passcode_prompt": "Enter passcode",
  "login.button": "Log In",

  "nav.overview": "Overview",
  "nav.monitor": "Daily Monitor",
  "nav.tasks": "Tasks",
  "nav.rewards": "Rewards",
  "nav.money": "Money & Points",
  "nav.consequences": "Consequences",
  "nav.leaderboard": "Leaderboard",
  "nav.analytics": "Analytics",
  "nav.weekly": "Weekly Report",
  "nav.settings": "Settings",

  "overview.greeting": "Hi",
  "overview.manage": "manage your family",
  "overview.stat_children": "Children",
  "overview.stat_tasks": "Active Tasks",
  "overview.stat_pending": "Awaiting Review",
  "overview.stat_points": "Total Points",

  "tasks.new_button": "New task",
  "tasks.template_button": "From Template",
  "tasks.active_section": "Active",
  "tasks.empty": "No active tasks.",

  "kid.tab_tasks": "Missions",
  "kid.tab_rewards": "Shop",
  "kid.tab_money": "Exchange",
  "kid.tab_champs": "Champs",
  "kid.tab_profile": "Profile",
  "kid.greeting": "Hi",
  "kid.points_label": "points",
  "kid.start_button": "Start",
  "kid.finish_button": "Done!",
  "kid.skip_button": "Skip",
  "kid.daily_goal": "Today's Point Goal",
  "kid.goal_reached": "Daily goal reached!",
  "kid.bonus_section": "Bonus Missions",
  "kid.done_section": "Completed",

  "money.savings_goal": "My Savings Goal",
  "money.three_chiky": "My ChikyBank",
  "chiky.save": "Savings",
  "chiky.spend": "Spending",
  "chiky.share": "Sharing",
};

// Context holds the merged label map (defaults + overrides + language).
export const LabelContext = createContext({ custom: {}, language: "id" });

export function useLabels() {
  const { custom, language } = useContext(LabelContext);
  const base = language === "en" ? EN_LABELS : DEFAULT_LABELS;
  // Returns a resolver: t("key") -> custom override (may be "" to hide) or the
  // active language's default.
  const t = (key) => {
    if (custom && Object.prototype.hasOwnProperty.call(custom, key)) {
      return custom[key]; // may be "" meaning hidden
    }
    return base[key] ?? key;
  };
  // Whether a label is hidden (explicitly blanked)
  const hidden = (key) => custom && custom[key] === "";
  return { t, hidden, custom, language };
}

// Label groups for the editor UI
export const LABEL_GROUPS = [
  { title: "Halaman Login", prefix: "login." },
  { title: "Menu Orang Tua", prefix: "nav." },
  { title: "Overview", prefix: "overview." },
  { title: "Tugas", prefix: "tasks." },
  { title: "Aplikasi Anak", prefix: "kid." },
  { title: "Uang & ChikyBank", prefix: "money.", extraPrefix: "chiky." },
];
