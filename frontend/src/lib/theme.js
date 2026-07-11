import { THEME_IDS, DEFAULT_PARENT_THEME } from "@/lib/themes";

const STORAGE_KEY = "mylilfamz.theme";

// Apply a theme by id. Sets <html data-theme="..."> which the CSS in index.css
// hooks into. Unknown ids fall back to the default so nothing ever breaks.
export function applyTheme(id) {
  const theme = THEME_IDS.includes(id) ? id : DEFAULT_PARENT_THEME;
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
  }
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage may be unavailable; ignore */
  }
  return theme;
}

export function getStoredTheme() {
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    return THEME_IDS.includes(t) ? t : null;
  } catch {
    return null;
  }
}

// Restore the last theme (used on app load so the choice sticks between visits).
export function restoreTheme(fallback = DEFAULT_PARENT_THEME) {
  return applyTheme(getStoredTheme() || fallback);
}
