import { useEffect, useState } from "react";

// Floating "Install app" button. On Chrome/Android/desktop it uses the native
// beforeinstallprompt event. On iOS Safari (no such event) it shows a short
// "Add to Home Screen" hint instead. Hides itself once the app is installed.
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [installed, setInstalled] = useState(false);

  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.navigator.standalone === true);

  const isIos =
    typeof navigator !== "undefined" &&
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !/crios|fxios/i.test(navigator.userAgent);

  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault();
      setDeferred(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || isStandalone) return null;
  // Nothing to show unless we can prompt (Android/desktop) or we're on iOS.
  if (!deferred && !isIos) return null;

  const handleClick = async () => {
    if (deferred) {
      deferred.prompt();
      try {
        await deferred.userChoice;
      } catch {
        /* ignore */
      }
      setDeferred(null);
      return;
    }
    if (isIos) setShowIosHint((v) => !v);
  };

  const btnStyle = {
    position: "fixed",
    right: "16px",
    bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
    zIndex: 60,
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "12px 16px",
    borderRadius: "999px",
    border: "none",
    cursor: "pointer",
    fontFamily: '"Baloo 2", "Fredoka", "Nunito", sans-serif',
    fontWeight: 700,
    fontSize: "15px",
    color: "#fff",
    background: "linear-gradient(135deg, #7c5cff, #ff6fa5)",
    boxShadow: "0 10px 26px rgba(124,92,255,0.45)",
  };

  const hintStyle = {
    position: "fixed",
    right: "16px",
    bottom: "calc(74px + env(safe-area-inset-bottom, 0px))",
    zIndex: 60,
    maxWidth: "260px",
    padding: "14px 16px",
    borderRadius: "16px",
    background: "#1b1030",
    color: "#fff",
    fontFamily: '"Nunito", sans-serif',
    fontSize: "14px",
    lineHeight: 1.4,
    boxShadow: "0 14px 34px rgba(0,0,0,0.35)",
  };

  return (
    <>
      {showIosHint && isIos && (
        <div style={hintStyle} role="dialog" aria-label="Cara install">
          Ketuk tombol <strong>Bagikan</strong> di Safari, lalu pilih{" "}
          <strong>Tambahkan ke Layar Utama</strong> untuk memasang My Lil Famz.
        </div>
      )}
      <button
        type="button"
        style={btnStyle}
        onClick={handleClick}
        aria-label="Install My Lil Famz"
        data-testid="pwa-install-button"
      >
        <span aria-hidden="true">⬇️</span>
        Install App
      </button>
    </>
  );
}
