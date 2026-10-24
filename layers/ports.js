import * as THREE from 'three';
import { register, report } from '../world/sources.js';
import * as ais from './ais.js';
import { Lighthouse } from './lighthouse.js';
import { toLocal } from '../world/geo.js';
import { createModel } from '../world/models.js';
import { keepVisible, makeLabel, setInfo } from '../world/markers.js';

const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
const MARINE_REFRESH_MS = 20 * 60_000;
const TEMP_MIN_C = 10;
const TEMP_MAX_C = 28;
const COLD = new THREE.Color('#72f6ff');
const WARM = new THREE.Color('#ff5ec8');

const PORTS = [
  { name: 'Oi Container Terminal', port: 'Port of Tokyo', lat: 35.610, lon: 139.771, description: "One of the Port of Tokyo's largest container terminals." },
  { name: 'Shinagawa Pier', port: 'Port of Tokyo', lat: 35.609, lon: 139.751, description: 'The oldest container terminal in Japan, opened in 1967.' },
  { name: 'Tokyo Intl Cruise Terminal', port: 'Port of Tokyo', lat: 35.637, lon: 139.793, description: 'Opened 2020 at Ariake.' },
  { name: 'Honmoku Pier', port: 'Port of Yokohama', lat: 35.427, lon: 139.677, description: "Yokohama's core port facility, 24 berths." },
  { name: 'Osanbashi Pier', port: 'Port of Yokohama', lat: 35.451, lon: 139.649, description: "Yokohama's passenger and cruise terminal." },
  { name: 'Daikoku Pier', port: 'Port of Yokohama', lat: 35.456, lon: 139.674, description: 'Known for fresh produce imports, notably bananas.' },
  { name: 'Kawasaki Port', port: 'Port of Kawasaki', lat: 35.520, lon: 139.760, description: 'Industrial port on the Keihin industrial belt.' },
  { name: 'Chiba Port', port: 'Port of Chiba', lat: 35.605, lon: 140.106, description: "One of Japan's largest ports by cargo tonnage." },
];

const TIDE_STATIONS = [
  { name: 'Tokyo', lat: 35.648617, lon: 139.77 },
  { name: 'Yokohama', lat: 35.466667, lon: 139.633333 },
  { name: 'Yokohamashinko', lat: 35.454167, lon: 139.644167 },
  { name: 'Kawasaki', lat: 35.5, lon: 139.766667 },
  { name: 'Chiba', lat: 35.56805, lon: 140.04555 },
];

let group = null;
let lighthouse = null;
let shipRoot = null;
let marineTimer = null;
const tides = [];
let staticCount = 0;

function snapToCoast(terrain, x, z) {
  let best = null;
  let bestD = Infinity;
  for (let dz = -3000; dz <= 3000; dz += 60) {
    for (let dx = -3000; dx <= 3000; dx += 60) {
      const d = dx * dx + dz * dz;
      if (d >= bestD) continue;
      const px = x + dx;
      const pz = z + dz;
      if (terrain.heightAt(px, pz) <= 0.5) continue;
      for (const [ox, oz] of [[90, 0], [-90, 0], [0, 90], [0, -90]]) {
        if (terrain.heightAt(px + ox, pz + oz) < 0) {
          bestD = d;
          best = { x: px + ox * 0.45, z: pz + oz * 0.45, facing: Math.atan2(ox, oz) };
          break;
        }
      }
    }
  }
  return best ?? { x, z, facing: 0 };
}

function tempColor(t) {
  if (!Number.isFinite(t)) return new THREE.Color(1, 1, 1);
  return COLD.clone().lerp(WARM, THREE.MathUtils.clamp((t - TEMP_MIN_C) / (TEMP_MAX_C - TEMP_MIN_C), 0, 1)).lerp(new THREE.Color(1, 1, 1), 0.45);
}

async function refreshStation(t) {
  try {
    const params = new URLSearchParams({
      latitude: t.station.lat,
      longitude: t.station.lon,
      current: 'wave_height,wave_period,sea_surface_temperature',
      timezone: 'auto',
    });
    const res = await fetch(`${MARINE_URL}?${params}`);
    if (!res.ok) { report('marine', false, `HTTP ${res.status}`); return; }
    report('marine', true);
    const c = (await res.json()).current;
    if (!c) return;
    const temp = c.sea_surface_temperature;
    const wave = c.wave_height;
    t.mesh.material.uniforms.uTint.value.copy(tempColor(temp));
    t.label.element.textContent = `${t.station.name.toUpperCase()} ${Number.isFinite(temp) ? `${temp.toFixed(1)}°C` : ''}`;
    setInfo(t.obj, `${t.station.name} tide station`, `Sea temp ${Number.isFinite(temp) ? `${temp.toFixed(1)}&deg;C` : 'unknown'}<br>Wave height ${Number.isFinite(wave) ? `${wave.toFixed(1)} m` : 'unknown'}<br>Conditions via Open-Meteo Marine`);
  } catch (e) {
    report('marine', false, e.message);
    console.warn('[Ports] marine fetch failed:', e.message);
  }
}

export function init(ctx) {
  register('marine', 'Sea conditions', 'marine-api.open-meteo.com');
  group = new THREE.Group();
  group.visible = false;
  ctx.scene.add(group);

  for (const p of PORTS) {
    const pos = toLocal(p.lon, p.lat);
    const obj = new THREE.Object3D();
    obj.position.set(pos.x, ctx.terrain.heightAt(pos.x, pos.z) + 5, pos.z);
    obj.add(makeLabel(`■ ${p.name.toUpperCase()}`, { className: 'label-port', maxDistance: 22_000 }));
    setInfo(obj, p.name, `${p.port}<br>${p.description}`);
    group.add(obj);
  }

  for (const station of TIDE_STATIONS) {
    const pos = toLocal(station.lon, station.lat);
    const coast = snapToCoast(ctx.terrain, pos.x, pos.z);
    const obj = new THREE.Group();
    obj.position.set(coast.x, 0, coast.z);
    obj.rotation.y = coast.facing;
    const mesh = createModel('tideGauge', { tint: 0xffffff });
    obj.add(mesh);
    const label = makeLabel(station.name.toUpperCase(), { className: 'label-sea', maxDistance: 30_000, offsetY: 12 });
    obj.add(label);
    keepVisible(obj, 10, 34, 300, 3);
    setInfo(obj, `${station.name} tide station`, 'Waiting for conditions...');
    group.add(obj);
    tides.push({ station, obj, mesh, label });
  }

  lighthouse = new Lighthouse(ctx);
  ctx.scene.add(lighthouse.group);

  staticCount = PORTS.length + TIDE_STATIONS.length;
  shipRoot = ais.init(ctx);
  return group;
}

export function update(dt, camera, time) {
  lighthouse.update(camera, time);
  if (!group.visible) return;
  ais.update(dt);
}

export function setEnabled(on) {
  group.visible = on;
  if (on) {
    for (const t of tides) refreshStation(t);
    marineTimer ??= setInterval(() => tides.forEach(refreshStation), MARINE_REFRESH_MS);
  } else {
    clearInterval(marineTimer);
    marineTimer = null;
  }
  ais.setEnabled(on);
}

export function ships() {
  return shipRoot;
}

export function alwaysOn() {
  return lighthouse.group;
}

export function getCount() {
  return staticCount + ais.getCount();
}
