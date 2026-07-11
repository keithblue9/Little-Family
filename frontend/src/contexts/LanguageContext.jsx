import { createContext, useContext, useState, useCallback } from "react";

const STRINGS = {
  en: {
    appName: "My Lil Famz",
    welcomeBack: "Welcome back",
    whoIsThis: "Who's this?",
    tapYourProfile: "Tap your profile to sign in",
    enterPasscode: "Enter your 6-digit passcode",
    passcode: "Passcode",
    signIn: "Sign in",
    unlock: "Unlock",
    cancel: "Cancel",
    incorrectPasscode: "Incorrect passcode",
    parent: "Parent",
    child: "Kid",
    switchProfile: "Switch profile",
    logout: "Log out",
    defaultPasscodeWarning: "This profile still uses the default passcode. Please change it in Settings.",
    changePasscode: "Change passcode",
    whosPlaying: "Who's playing?",
    tapYourName: "Tap your name to see your quests!",
    overview: "Overview",
    tasks: "Tasks",
    rewards: "Rewards",
    consequences: "Consequences",
    activity: "Activity",
    leaderboard: "Leaderboard",
    analytics: "Analytics",
    settings: "Settings",
    language: "Language",
  },
  id: {
    appName: "My Lil Famz",
    welcomeBack: "Selamat datang kembali",
    whoIsThis: "Siapa ini?",
    tapYourProfile: "Ketuk profilmu untuk masuk",
    enterPasscode: "Masukkan passcode 6 digit",
    passcode: "Passcode",
    signIn: "Masuk",
    unlock: "Buka",
    cancel: "Batal",
    incorrectPasscode: "Passcode salah",
    parent: "Orang Tua",
    child: "Anak",
    switchProfile: "Ganti profil",
    logout: "Keluar",
    defaultPasscodeWarning: "Profil ini masih pakai passcode bawaan. Segera ganti di Pengaturan.",
    changePasscode: "Ganti passcode",
    whosPlaying: "Siapa yang main?",
    tapYourName: "Ketuk namamu untuk lihat tugas!",
    overview: "Ringkasan",
    tasks: "Tugas",
    rewards: "Hadiah",
    consequences: "Konsekuensi",
    activity: "Aktivitas",
    leaderboard: "Peringkat",
    analytics: "Statistik",
    settings: "Pengaturan",
    language: "Bahasa",
  },
};

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem("mlf_lang") || "id");

  const setLanguage = useCallback((next) => {
    setLang(next);
    localStorage.setItem("mlf_lang", next);
  }, []);

  const toggleLanguage = useCallback(() => {
    setLang((prev) => {
      const next = prev === "en" ? "id" : "en";
      localStorage.setItem("mlf_lang", next);
      return next;
    });
  }, []);

  const t = useCallback(
    (key) => STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key,
    [lang]
  );

  return (
    <LanguageContext.Provider value={{ lang, setLanguage, toggleLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => useContext(LanguageContext);
