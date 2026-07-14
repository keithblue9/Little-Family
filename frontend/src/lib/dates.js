// Date helpers that operate in the *user's local timezone*.
//
// The classic bug we're avoiding: `new Date().toISOString().slice(0,10)`
// returns the UTC date, which for users east of UTC (e.g. GMT+7 Indonesia)
// can be the *previous* day for the first 7 hours after local midnight. That
// made tasks created "today" locally get stored under yesterday's key and
// vanish from the view. All date_key handling must go through these.

/** Local YYYY-MM-DD for a Date (defaults to now). */
export function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today's local date key. */
export function todayKey() {
  return localDateKey(new Date());
}

/** Shift a YYYY-MM-DD key by N days, staying in local time (no UTC round-trip). */
export function shiftDateKey(key, days) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d); // local midnight, no timezone conversion
  dt.setDate(dt.getDate() + days);
  return localDateKey(dt);
}

/** Human-friendly Indonesian label for a date key. */
export function humanDateKey(key) {
  if (key === todayKey()) return "Hari Ini";
  if (key === shiftDateKey(todayKey(), -1)) return "Kemarin";
  if (key === shiftDateKey(todayKey(), 1)) return "Besok";
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" });
}

/** Current local time as "HH:MM" (24h). */
export function localTimeHHMM(d = new Date()) {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** True if the given key is strictly before today (local). */
export function isPastDate(key) {
  return key < todayKey();
}

/** True if the given key is strictly after today (local). */
export function isFutureDate(key) {
  return key > todayKey();
}

/**
 * Nearest date_key matching a given weekday (0=Senin..6=Minggu, same
 * convention as the weekday picker elsewhere in the app). If today already
 * IS that weekday, returns today (most relevant instance) rather than
 * jumping a full week ahead.
 */
export function nextDateForWeekday(weekdayIndex) {
  const now = new Date();
  const todayWd = now.getDay() === 0 ? 6 : now.getDay() - 1; // JS getDay(): Sun=0 -> convert to Mon=0..Sun=6
  const delta = (weekdayIndex - todayWd + 7) % 7;
  return shiftDateKey(todayKey(), delta);
}
