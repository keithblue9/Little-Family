// Completion sound effects, synthesized via Web Audio API (no audio files
// needed, works fully offline). Each theme has a distinct little melody so
// kids can pick the one they find most satisfying.

export const SOUND_THEMES = [
  { key: "ding", label: "Ding Klasik", emoji: "🔔" },
  { key: "fanfare", label: "Fanfare Ceria", emoji: "🎉" },
  { key: "chime", label: "Chime Lembut", emoji: "✨" },
  { key: "drum", label: "Drum Semangat", emoji: "🥁" },
];

function tone(ctx, freq, startTime, duration, type = "sine", peakGain = 0.3) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = freq;
  osc.type = type;
  gain.gain.setValueAtTime(peakGain, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

export function playSoundTheme(theme = "ding") {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    switch (theme) {
      case "fanfare":
        tone(ctx, 523.25, now, 0.15, "triangle");        // C5
        tone(ctx, 659.25, now + 0.12, 0.15, "triangle");  // E5
        tone(ctx, 783.99, now + 0.24, 0.35, "triangle");  // G5
        break;
      case "chime":
        tone(ctx, 1046.5, now, 0.4, "sine", 0.2);         // C6
        tone(ctx, 1318.5, now + 0.08, 0.4, "sine", 0.15); // E6
        break;
      case "drum":
        tone(ctx, 110, now, 0.12, "square", 0.35);
        tone(ctx, 110, now + 0.15, 0.12, "square", 0.35);
        tone(ctx, 220, now + 0.32, 0.2, "square", 0.3);
        break;
      case "ding":
      default:
        tone(ctx, 880, now, 0.5, "sine");
        break;
    }
    if (navigator.vibrate) navigator.vibrate(theme === "drum" ? [40, 20, 40, 20, 80] : [50, 30, 100]);
  } catch {
    // Audio not available in this environment — silently skip.
  }
}

/**
 * Countdown warning for a running mission ("3 minutes left!").
 *
 * Deliberately different in character from the celebration themes: a pair of
 * urgent-but-not-alarming beeps that rise in pitch, so a child instantly reads
 * it as "hurry up" rather than "well done". Urgency scales with how little
 * time is left — the final minute is higher and sharper than the first warning.
 */
export function playTimeWarning(minutesLeft = 1) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    const urgent = minutesLeft <= 1;
    const base = urgent ? 880 : 660;         // A5 for the last minute, E5 before
    const beeps = urgent ? 3 : 2;
    for (let i = 0; i < beeps; i++) {
      tone(ctx, base, now + i * 0.18, 0.12, "square", 0.22);
      tone(ctx, base * 1.5, now + i * 0.18 + 0.06, 0.1, "square", 0.14);
    }
  } catch {
    /* audio blocked (e.g. no user gesture yet) — the on-screen toast still shows */
  }
}
