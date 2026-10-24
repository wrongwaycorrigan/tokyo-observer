import * as THREE from 'three';
import { register, report } from '../world/sources.js';
import { toLocal } from '../world/geo.js';
import { gouraudMaterial } from '../world/shading.js';
import { forget, keepVisible, makeLabel, setInfo } from '../world/markers.js';

const WSPR_LIVE_URL = 'https://db1.wspr.live/';
const REFRESH_MS = 3 * 60_000;
const BBOX = { minLat: 34.3, maxLat: 36.7, minLon: 138.3, maxLon: 141.3 };

const SNR_RAMP = [
  [-30, new THREE.Color('#3b2c86')],
  [-22, new THREE.Color('#b98af0')],
  [-14, new THREE.Color('#72f6ff')],
  [-6, new THREE.Color('#ff5ec8')],
  [2, new THREE.Color('#ffe27a')],
];

function snrColor(snr) {
  if (!Number.isFinite(snr) || snr <= SNR_RAMP[0][0]) return SNR_RAMP[0][1].clone();
  for (let i = 1; i < SNR_RAMP.length; i++) {
    const [s1, c1] = SNR_RAMP[i];
    const [s0, c0] = SNR_RAMP[i - 1];
    if (snr <= s1) return c0.clone().lerp(c1, (snr - s0) / (s1 - s0));
  }
  return SNR_RAMP[SNR_RAMP.length - 1][1].clone();
}

function query() {
  return `
    SELECT tx_sign, tx_lat, tx_lon, rx_sign, band, snr, time
    FROM wspr.rx
    WHERE time > now() - INTERVAL 6 HOUR
      AND tx_lat BETWEEN ${BBOX.minLat} AND ${BBOX.maxLat}
      AND tx_lon BETWEEN ${BBOX.minLon} AND ${BBOX.maxLon}
    ORDER BY time DESC
    LIMIT 2000
    FORMAT JSON
  `.trim();
}

let group = null;
let timer = null;
let terrain = null;
const pillar = new THREE.CylinderGeometry(3, 3, 1, 6).translate(0, 0.5, 0);
const orb = new THREE.SphereGeometry(14, 10, 8);

async function refresh() {
  try {
    const res = await fetch(`${WSPR_LIVE_URL}?query=${encodeURIComponent(query())}`);
    if (!res.ok) { report('wspr', false, `HTTP ${res.status}`); return; }
    report('wspr', true);
    const rows = (await res.json()).data ?? [];
    const beacons = new Map();
    for (const r of rows) {
      if (!Number.isFinite(r.tx_lat) || !Number.isFinite(r.tx_lon)) continue;
      const b = beacons.get(r.tx_sign) ?? { sign: r.tx_sign, lat: r.tx_lat, lon: r.tx_lon, best: -99, heardBy: new Set(), bands: new Set() };
      b.best = Math.max(b.best, r.snr);
      b.heardBy.add(r.rx_sign);
      b.bands.add(r.band);
      beacons.set(r.tx_sign, b);
    }
    for (const child of [...group.children]) {
      forget(child);
      group.remove(child);
    }
    for (const b of beacons.values()) {
      const color = snrColor(b.best);
      const material = gouraudMaterial({ vertexColors: false, tint: color.getHex(), emissive: color.clone().multiplyScalar(0.35).getHex() });
      const p = toLocal(b.lon, b.lat);
      const obj = new THREE.Group();
      obj.position.set(p.x, terrain.heightAt(p.x, p.z), p.z);
      const stick = new THREE.Mesh(pillar, material);
      stick.scale.y = 120;
      const top = new THREE.Mesh(orb, material);
      top.position.y = 120;
      obj.add(stick, top);
      obj.add(makeLabel(`WSPR ${b.sign} ${b.best}dB`, { className: 'label-wspr', maxDistance: 130_000, offsetY: 150 }));
      keepVisible(obj, 140, 40, 80, 1.5);
      setInfo(obj, `WSPR beacon ${b.sign}`, `Best SNR ${b.best} dB<br>Heard by ${b.heardBy.size} station${b.heardBy.size === 1 ? '' : 's'} in the last 6 hours<br>Bands: ${[...b.bands].join(', ')}`);
      group.add(obj);
    }
  } catch (e) {
    report('wspr', false, e.message);
    console.warn('[WSPR] fetch failed:', e.message);
  }
}

export function init(ctx) {
  register('wspr', 'WSPR beacons', 'wspr.live');
  terrain = ctx.terrain;
  group = new THREE.Group();
  group.visible = false;
  ctx.scene.add(group);
  return group;
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
  return group ? group.children.length : 0;
}
