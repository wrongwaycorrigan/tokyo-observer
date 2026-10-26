import * as THREE from 'three';
import { register, report } from '../world/sources.js';
import { CENTER, toLocal } from '../world/geo.js';
import { createModel } from '../world/models.js';
import { forget, keepVisible, makeLabel, setInfo } from '../world/markers.js';

const SONDEHUB = 'https://api.v2.sondehub.org/sondes';
const REFRESH_MS = 60_000;
const SEARCH_RADIUS_M = 250_000;

let group = null;
let timer = null;
let count = 0;

function pressureColor(hpa) {
  if (hpa >= 950) return 0xffe27a;
  if (hpa >= 850) return 0xffb48c;
  return 0xffc6e6;
}

function formatAltitude(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}KM` : `${Math.round(m)}M`;
}

async function refresh() {
  try {
    const params = new URLSearchParams({
      last: '86400', lat: CENTER.lat, lon: CENTER.lon, distance: SEARCH_RADIUS_M, format: 'json',
    });
    const res = await fetch(`${SONDEHUB}?${params}`);
    if (!res.ok) { report('sondehub', false, `HTTP ${res.status}`); return; }
    report('sondehub', true);
    const sondes = Object.values(await res.json()).filter((s) => s.snr != null && s.snr > 0);
    for (const child of [...group.children]) {
      forget(child);
      group.remove(child);
    }
    for (const s of sondes) {
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
      const alt = s.alt ?? 0;
      const hpa = s.pressure || 1013.25;
      const obj = new THREE.Group();
      obj.position.copy(toLocal(s.lon, s.lat, alt));
      obj.add(createModel('balloon', { tint: pressureColor(hpa) }));
      obj.add(makeLabel(`${s.serial} ${formatAltitude(alt)}`, { className: 'label-sonde', maxDistance: 120_000, offsetY: 40 }));
      keepVisible(obj, 40, 48, 1200, 3);
      setInfo(obj, `Radiosonde ${s.serial}`, `Altitude ${formatAltitude(alt)}<br>Pressure ${hpa.toFixed(1)} hPa${Number.isFinite(s.temp) ? `<br>Temp ${s.temp.toFixed(1)}&deg;C` : ''}<br>Via SondeHub`);
      group.add(obj);
    }
    count = group.children.length;
  } catch (e) {
    report('sondehub', false, e.message);
    console.warn('[Radiosondes] fetch failed:', e.message);
  }
}

export function init(ctx) {
  register('sondehub', 'Radiosondes', 'api.v2.sondehub.org');
  group = new THREE.Group();
  group.visible = false;
  ctx.scene.add(group);
  return group;
}

export function update(dt, camera, time) {
  for (const obj of group.children) obj.rotation.y = time * 0.2;
}

export function setEnabled(on) {
  group.visible = on;
  if (on) {
    refresh();
    timer ??= setInterval(refresh, REFRESH_MS);
  } else {
    clearInterval(timer);
    timer = null;
  }
}

export function getCount() {
  return count;
}
