/**
 * Keep a section's "locked → ready" and late-start flags moving with the
 * device clock, even when the server can't be reached to refresh them (the
 * child is offline, or the next refresh simply hasn't come yet). The server
 * still has the final say when the action reaches it (a late finish, which
 * exam periods can excuse, is left entirely to the server).
 */
function jakartaNow() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { dateKey: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

const toMin = (hhmm) => {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

export function withLiveClock(data, dateKey) {
  if (!data?.segments) return data;
  let now;
  try { now = jakartaNow(); } catch { return data; }
  if (now.dateKey !== dateKey) return data;
  const grace = Math.max(0, Number(data.grace_minutes) || 0);
  let changed = false;
  const segments = data.segments.map((s) => {
    const start = toMin(s.start_time);
    if (start == null) return s;
    let next = s;
    if (s.status === "locked" && now.minutes >= start) next = { ...next, status: "ready" };
    if ((next.status === "ready" || next.status === "locked") && !next.late_start && now.minutes > start + grace) {
      next = { ...next, late_start: true };
    }
    if (next !== s) changed = true;
    return next;
  });
  return changed ? { ...data, segments } : data;
}
