// A subtle color overlay layered on top of each theme's quest-map background,
// shifting through the day so the app feels alive and in sync with real time
// — without overriding each personality theme's own base color/identity.

export function timeOfDayOverlay(hour = new Date().getHours()) {
  if (hour >= 5 && hour < 8) {
    // Early morning: soft pink/gold sunrise
    return "linear-gradient(180deg, rgba(255,214,170,0.35) 0%, rgba(255,241,230,0.05) 60%)";
  }
  if (hour >= 8 && hour < 11) {
    // Morning: bright, airy
    return "linear-gradient(180deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.02) 70%)";
  }
  if (hour >= 11 && hour < 15) {
    // Midday: clear, slightly cool-bright
    return "linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(200,230,255,0.05) 100%)";
  }
  if (hour >= 15 && hour < 18) {
    // Afternoon: warm gold
    return "linear-gradient(180deg, rgba(255,196,120,0.2) 0%, rgba(255,150,90,0.08) 100%)";
  }
  if (hour >= 18 && hour < 20) {
    // Sunset: orange-to-purple
    return "linear-gradient(180deg, rgba(255,140,90,0.3) 0%, rgba(140,90,180,0.25) 100%)";
  }
  // Night: deep blue with a hint of starlight
  return "linear-gradient(180deg, rgba(20,25,60,0.45) 0%, rgba(10,12,35,0.55) 100%)";
}

export function isNightTime(hour = new Date().getHours()) {
  return hour >= 19 || hour < 5;
}
