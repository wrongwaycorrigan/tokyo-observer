import * as THREE from 'three';
import { register, report } from '../world/sources.js';
import { CENTER, OUTER_HALF_M, distanceM, toLocal } from '../world/geo.js';
import { forget, makeLabel, setInfo } from '../world/markers.js';

const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson';
const REFRESH_MS = 60_000;
const LIST_RADIUS_M = 400_000;

let group = null;
let timer = null;
let recent = [];
const rings = [];

function jst(ms) {
  const d = new Date(ms);
  const day = (x) => x.toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
  const time = d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });
  if (day(d) === day(new Date())) return time;
  const [, m, dd] = day(d).split('-');
  return `${m}/${dd} ${time}`;
}

const ringGeometry = new THREE.RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2);

async function refresh() {
  try {
    const res = await fetch(USGS_URL);
    if (!res.ok) { report('usgs', false, `HTTP ${res.status}`); return; }
    report('usgs', true);
    const features = (await res.json()).features ?? [];
    const near = features
      .map((f) => {
        const [lon, lat, depth] = f.geometry.coordinates;
        return { lon, lat, depth, mag: f.properties.mag, place: f.properties.place, time: f.properties.time, url: f.properties.url, dist: distanceM(CENTER.lon, CENTER.lat, lon, lat) };
      })
      .filter((q) => q.mag != null && q.dist < LIST_RADIUS_M)
      .sort((a, b) => b.time - a.time);
    recent = near;

    for (const r of rings) {
      forget(r.obj);
      group.remove(r.obj);
    }
    rings.length = 0;
    for (const q of near) {
      const p = toLocal(q.lon, q.lat);
      if (Math.abs(p.x) > OUTER_HALF_M || Math.abs(p.z) > OUTER_HALF_M) continue;
      const obj = new THREE.Group();
      obj.position.set(p.x, 30, p.z);
      const color = q.depth < 30 ? 0xff5ec8 : q.depth < 100 ? 0xffb48c : 0xb98af0;
      const ringMeshes = [0, 1, 2].map((k) => {
        const m = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
        m.userData.phase = k / 3;
        obj.add(m);
        return m;
      });
      obj.add(makeLabel(`M${q.mag.toFixed(1)} ${jst(q.time)}`, { className: 'label-quake', maxDistance: 400_000 }));
      setInfo(obj, `M${q.mag.toFixed(1)} earthquake`, `${q.place ?? ''}<br>Depth ${q.depth.toFixed(0)} km<br>${new Date(q.time).toLocaleString('en-GB', { timeZone: 'Asia/Tokyo' })} JST<br><a href="${q.url}" target="_blank" rel="noopener noreferrer">USGS event page</a>`);
      group.add(obj);
      rings.push({ obj, ringMeshes, radius: 1500 * 2 ** q.mag / 8, born: q.time });
      q.obj = obj;
    }
  } catch (e) {
    report('usgs', false, e.message);
    console.warn('[Quakes] USGS fetch failed:', e.message);
  }
}

export function init(ctx) {
  register('usgs', 'Earthquakes', 'earthquake.usgs.gov');
  group = new THREE.Group();
  group.visible = false;
  ctx.scene.add(group);
  return group;
}

export function update(dt, camera, time) {
  if (!group.visible) return;
  for (const r of rings) {
    for (const m of r.ringMeshes) {
      const t = (time * 0.25 + m.userData.phase) % 1;
      m.scale.setScalar(r.radius * (0.15 + t));
      m.material.opacity = 0.9 * (1 - t);
    }
  }
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
  return recent.length;
}

function shortPlace(place) {
  const name = (place ?? 'Unknown').split(' of ').pop().replace(/,\s*Japan$/i, '');
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

export function getRecent(limit = 5) {
  return recent.slice(0, limit).map((q) => ({
    place: shortPlace(q.place),
    mag: `M${q.mag.toFixed(1)}`,
    time: jst(q.time),
    obj: q.obj ?? null,
  }));
}
