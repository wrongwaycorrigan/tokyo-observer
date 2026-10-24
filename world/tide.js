import { CENTER } from './geo.js';
import { register, report } from './sources.js';

const URL = `https://marine-api.open-meteo.com/v1/marine?latitude=${CENTER.lat}&longitude=${CENTER.lon}&hourly=sea_level_height_msl&past_days=0&forecast_days=2&timezone=GMT`;
const REFRESH_MS = 60 * 60_000;

export class Tide {
  constructor() {
    this.times = [];
    this.levels = [];
  }

  async refresh() {
    try {
      const res = await fetch(URL);
      if (!res.ok) { report('tide', false, `HTTP ${res.status}`); return; }
      const data = await res.json();
      this.times = (data.hourly?.time ?? []).map((t) => Date.parse(`${t}Z`));
      this.levels = data.hourly?.sea_level_height_msl ?? [];
      report('tide', true, `${this.level().toFixed(2)} m`);
    } catch (e) {
      report('tide', false, e.message);
    }
  }

  level(now = Date.now()) {
    const t = this.times;
    if (t.length < 2) return 0;
    for (let i = 0; i < t.length - 1; i++) {
      if (now >= t[i] && now <= t[i + 1]) {
        const a = this.levels[i] ?? 0;
        const b = this.levels[i + 1] ?? a;
        return a + (b - a) * ((now - t[i]) / (t[i + 1] - t[i]));
      }
    }
    return this.levels.at(-1) ?? 0;
  }

  trend(now = Date.now()) {
    return this.level(now + 30 * 60_000) - this.level(now);
  }

  start() {
    register('tide', 'Tide level', 'marine-api.open-meteo.com');
    this.refresh();
    setInterval(() => this.refresh(), REFRESH_MS);
  }
}
