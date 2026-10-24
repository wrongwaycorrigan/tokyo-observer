const SYNODIC_MONTH_DAYS = 29.530588861;
const KNOWN_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14, 0);
const PHASE_NAMES = ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous', 'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];

export function moonPhase(nowMs = Date.now()) {
  let phase = (((nowMs - KNOWN_NEW_MOON_MS) / 86_400_000) % SYNODIC_MONTH_DAYS) / SYNODIC_MONTH_DAYS;
  if (phase < 0) phase += 1;
  const illuminationPct = Math.round(((1 - Math.cos(2 * Math.PI * phase)) / 2) * 100);
  return { name: PHASE_NAMES[Math.floor((phase + 0.0625) / 0.125) % 8], illuminationPct };
}
