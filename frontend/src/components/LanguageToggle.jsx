import { useLanguage } from "@/contexts/LanguageContext";

export default function LanguageToggle({ className = "" }) {
  const { lang, toggleLanguage } = useLanguage();

  return (
    <button
      onClick={toggleLanguage}
      className={`press-btn inline-flex items-center gap-1.5 bg-white/80 backdrop-blur border-2 border-slate-200 text-slate-700 font-fun font-semibold px-3 py-1.5 rounded-xl text-sm ${className}`}
      title="Change language / Ganti bahasa"
    >
      <span>{lang === "en" ? "🇬🇧" : "🇮🇩"}</span>
      <span>{lang === "en" ? "EN" : "ID"}</span>
    </button>
  );
}
