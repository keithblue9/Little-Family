/**
 * Theme-only fonts, fetched the first time a theme that needs them is shown.
 * Most families never pick these themes, so they shouldn't pay for them.
 */
const THEME_FONTS = {
  candy: "Baloo+2:wght@500;600;700;800",
  mermaid: "Baloo+2:wght@500;600;700;800",
  galaxy: "Baloo+2:wght@500;600;700;800",
  cyber: "Orbitron:wght@500;700;900",
};
const loaded = new Set();

function ensureFont(spec) {
  if (!spec || loaded.has(spec)) return;
  loaded.add(spec);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${spec}&display=swap`;
  document.head.appendChild(link);
}

export function watchThemeFonts() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const apply = () => ensureFont(THEME_FONTS[root.getAttribute("data-theme")]);
  apply();
  try {
    new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  } catch { /* very old browser: themes still work with fallback fonts */ }
}
