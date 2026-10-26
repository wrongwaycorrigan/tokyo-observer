import { register, report } from './sources.js';

const OFFICES = { 130000: ['130010'], 140000: ['140010', '140020'], 120000: ['120010', '120020', '120030'] };
const REFRESH_MS = 10 * 60_000;
const NAMES = {
  '02': ['W', 'BLIZZARD'], '03': ['W', 'HEAVY RAIN'], '04': ['W', 'FLOOD'], '05': ['W', 'STORM'], '06': ['W', 'HEAVY SNOW'],
  '07': ['W', 'HIGH WAVES'], '08': ['W', 'STORM SURGE'], 10: ['A', 'HEAVY RAIN'], 12: ['A', 'HEAVY SNOW'], 13: ['A', 'SNOWSTORM'],
  14: ['A', 'THUNDER'], 15: ['A', 'GALE'], 16: ['A', 'HIGH WAVES'], 17: ['A', 'SNOWMELT'], 18: ['A', 'FLOOD'], 19: ['A', 'STORM SURGE'],
  20: ['A', 'DENSE FOG'], 21: ['A', 'DRY AIR'], 22: ['A', 'AVALANCHE'], 23: ['A', 'LOW TEMP'], 24: ['A', 'FROST'], 25: ['A', 'ICING'],
  26: ['A', 'SNOW ACCRETION'], 32: ['E', 'BLIZZARD'], 33: ['E', 'HEAVY RAIN'], 35: ['E', 'STORM'], 36: ['E', 'HEAVY SNOW'],
  37: ['E', 'HIGH WAVES'], 38: ['E', 'STORM SURGE'],
};
const ACTIVE = new Set(['発表', '継続']);

let active = [];

async function refresh() {
  try {
    const found = new Map();
    for (const [office, areas] of Object.entries(OFFICES)) {
      const res = await fetch(`https://www.jma.go.jp/bosai/warning/data/warning/${office}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      for (const area of data.areaTypes?.[0]?.areas ?? []) {
        if (!areas.includes(area.code)) continue;
        for (const w of area.warnings ?? []) {
          const name = NAMES[w.code] ?? NAMES[Number(w.code)];
          if (name && ACTIVE.has(w.status)) found.set(`${name[0]}${name[1]}`, name);
        }
      }
    }
    const rank = { E: 0, W: 1, A: 2 };
    active = [...found.values()].sort((a, b) => rank[a[0]] - rank[b[0]]);
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
  const level = (k) => (k === 'E' ? 'wx-emergency' : k === 'W' ? 'wx-warning' : 'wx-advisory');
  const label = (k) => (k === 'E' ? 'EMERGENCY' : k === 'W' ? 'WARNING' : 'ADVISORY');
  return active.map(([k, n]) => `<span class="${level(k)}">${label(k)} ${n}</span>`).join('<br>');
}
