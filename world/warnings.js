import { register, report } from './sources.js';

const OFFICES = { 130000: ['130010'], 140000: ['140010', '140020'], 120000: ['120010', '120020', '120030'] };
const REFRESH_MS = 10 * 60_000;
const STALE_MS = 14 * 86_400_000;
const NAMES = {
  33: ['E', 'HEAVY RAIN'], 43: ['D', 'HEAVY RAIN'], '03': ['W', 'HEAVY RAIN'], 10: ['A', 'HEAVY RAIN'],
  39: ['E', 'LANDSLIDE'], 49: ['D', 'LANDSLIDE'], '09': ['W', 'LANDSLIDE'], 29: ['A', 'LANDSLIDE'],
  38: ['E', 'STORM SURGE'], 48: ['D', 'STORM SURGE'], '08': ['W', 'STORM SURGE'], 19: ['A', 'STORM SURGE'],
  35: ['E', 'STORM'], '05': ['W', 'STORM'], 15: ['A', 'GALE'],
  32: ['E', 'BLIZZARD'], '02': ['W', 'BLIZZARD'], 13: ['A', 'SNOWSTORM'],
  36: ['E', 'HEAVY SNOW'], '06': ['W', 'HEAVY SNOW'], 12: ['A', 'HEAVY SNOW'],
  37: ['E', 'HIGH WAVES'], '07': ['W', 'HIGH WAVES'], 16: ['A', 'HIGH WAVES'],
  14: ['A', 'THUNDER'], 17: ['A', 'SNOWMELT'], 20: ['A', 'DENSE FOG'], 21: ['A', 'DRY AIR'], 22: ['A', 'AVALANCHE'],
  23: ['A', 'LOW TEMP'], 24: ['A', 'FROST'], 25: ['A', 'ICING'], 26: ['A', 'SNOW ACCRETION'],
};
const ACTIVE = new Set(['発表', '継続']);
const RANK = { E: 0, D: 1, W: 2, A: 3 };

let active = [];

async function refresh() {
  try {
    const found = new Map();
    let newest = 0;
    for (const [office, areas] of Object.entries(OFFICES)) {
      const res = await fetch(`https://www.jma.go.jp/bosai/warning/data/r8/${office}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reports = await res.json();
      for (const r of Array.isArray(reports) ? reports : []) {
        newest = Math.max(newest, Date.parse(r.reportDatetime) || 0);
        for (const area of r.warning?.class10Items ?? []) {
          if (!areas.includes(area.areaCode)) continue;
          for (const k of area.kinds ?? []) {
            const name = NAMES[k.code];
            if (name && ACTIVE.has(k.status)) found.set(`${name[0]}${name[1]}`, name);
          }
        }
      }
    }
    if (Date.now() - newest > STALE_MS) {
      active = [];
      report('jma-warnings', false, 'feed stale');
      return;
    }
    active = [...found.values()].sort((a, b) => RANK[a[0]] - RANK[b[0]]);
    report('jma-warnings', true, active.length ? `${active.length} active` : 'none');
  } catch (e) {
    report('jma-warnings', false, e.message);
  }
}

export function startWarnings() {
  register('jma-warnings', 'Weather warnings', 'www.jma.go.jp');
  refresh();
  setInterval(refresh, REFRESH_MS);
}

export function warningsHtml() {
  if (!active.length) return 'NO WARNINGS';
  const level = (k) => (k === 'E' ? 'wx-emergency' : k === 'A' ? 'wx-advisory' : 'wx-warning');
  const label = (k) => ({ E: 'EMERGENCY', D: 'DANGER', W: 'WARNING', A: 'ADVISORY' })[k];
  return active.map(([k, n]) => `<span class="${level(k)}">${label(k)} ${n}</span>`).join('<br>');
}
