import * as THREE from 'three';
import { register, report } from '../world/sources.js';
import { CENTER, distanceM } from '../world/geo.js';
import { createModel } from '../world/models.js';
import { keepVisible, makeLabel, setInfo } from '../world/markers.js';

const ISS_URL = 'https://api.wheretheiss.at/v1/satellites/25544';
const POLL_MS = 5_000;
const SKY_DISTANCE_M = 160_000;
const R = 6371;
const DEG = Math.PI / 180;

let obj = null;
let label = null;
export const status = { visible: false, elevation: -90, distanceKm: null, altitudeKm: null };

function ecef(lat, lon, altKm) {
  const r = R + altKm;
  return new THREE.Vector3(
    r * Math.cos(lat * DEG) * Math.cos(lon * DEG),
    r * Math.cos(lat * DEG) * Math.sin(lon * DEG),
    r * Math.sin(lat * DEG),
  );
}

function lookAngles(issLat, issLon, altKm) {
  const o = ecef(CENTER.lat, CENTER.lon, 0);
  const d = ecef(issLat, issLon, altKm).sub(o);
  const la = CENTER.lat * DEG; const lo = CENTER.lon * DEG;
  const east = -Math.sin(lo) * d.x + Math.cos(lo) * d.y;
  const north = -Math.sin(la) * Math.cos(lo) * d.x - Math.sin(la) * Math.sin(lo) * d.y + Math.cos(la) * d.z;
  const up = Math.cos(la) * Math.cos(lo) * d.x + Math.cos(la) * Math.sin(lo) * d.y + Math.sin(la) * d.z;
  const range = d.length();
  return { east: east / range, north: north / range, up: up / range, elevation: Math.asin(up / range) / DEG };
}

async function refresh() {
  try {
    const res = await fetch(ISS_URL);
    if (!res.ok) { report('iss', false, `HTTP ${res.status}`); return; }
    report('iss', true);
    const s = await res.json();
    const look = lookAngles(s.latitude, s.longitude, s.altitude);
    status.elevation = look.elevation;
    status.altitudeKm = s.altitude;
    status.distanceKm = distanceM(CENTER.lon, CENTER.lat, s.longitude, s.latitude) / 1000;
    status.visible = look.elevation > 0;
    obj.visible = status.visible;
    if (status.visible) {
      obj.position.set(look.east * SKY_DISTANCE_M, look.up * SKY_DISTANCE_M, -look.north * SKY_DISTANCE_M);
      obj.lookAt(0, 0, 0);
      label.element.textContent = `ISS ${Math.round(s.altitude)}KM ${s.velocity ? `${(s.velocity / 3600).toFixed(2)}KM/S` : ''}`;
    }
  } catch (e) {
    report('iss', false, e.message);
    console.warn('[ISS] position fetch failed:', e.message);
  }
}

export function init(ctx) {
  register('iss', 'ISS position', 'api.wheretheiss.at');
  obj = new THREE.Group();
  const mesh = createModel('iss', { tint: 0xffffff });
  mesh.material.uniforms.uFogNear = { value: 1e9 };
  mesh.material.uniforms.uFogFar = { value: 2e9 };
  obj.add(mesh);
  label = makeLabel('ISS', { className: 'label-iss', offsetY: 0 });
  obj.add(label);
  keepVisible(obj, 108, 70, 600);
  setInfo(obj, 'International Space Station', 'Shown when it is above the Tokyo horizon, in its real direction from the bay. Live position via wheretheiss.at.');
  obj.visible = false;
  ctx.scene.add(obj);
  refresh();
  setInterval(refresh, POLL_MS);
  return obj;
}
