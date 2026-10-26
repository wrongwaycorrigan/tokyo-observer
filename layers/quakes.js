import * as THREE from 'three';
import { register, report } from '../world/sources.js';
import { CENTER, INNER_HALF_M, OUTER_HALF_M, distanceM, toLocal } from '../world/geo.js';
import { forget, makeLabel, setInfo } from '../world/markers.js';

const JMA_URL = 'https://www.jma.go.jp/bosai/quake/data/list.json';
const JMA_PAGE = 'https://www.jma.go.jp/bosai/map.html?lang=en#contents=earthquake_map';
const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson';
const SHINDO = { 1: '1', 2: '2', 3: '3', 4: '4', '5-': '5弱', '5+': '5強', '6-': '6弱', '6+': '6強', 7: '7' };
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

async function fromJma() {
  const res = await fetch(JMA_URL);
  if (!res.ok) throw new Error(`JMA HTTP ${res.status}`);
  const latest = new Map();
  for (const r of await res.json()) {
    const m = /^([+-][\d.]+)([+-][\d.]+)([+-]\d+)?/.exec(r.cod ?? '');
    if (!m || !r.mag || Number.isNaN(Number(r.mag))) continue;
    if (latest.has(r.eid) && latest.get(r.eid).ctt > r.ctt) continue;
    latest.set(r.eid, r);
  }
  return [...latest.values()].map((r) => {
    const m = /^([+-][\d.]+)([+-][\d.]+)([+-]\d+)?/.exec(r.cod);
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    return {
      lon, lat,
      depth: m[3] ? Math.abs(Number(m[3])) / 1000 : 10,
      mag: Number(r.mag),
      shindo: SHINDO[r.maxi] ?? null,
      place: r.en_anm || r.anm,
      time: Date.parse(r.at),
      url: JMA_PAGE,
      source: 'JMA',
      dist: distanceM(CENTER.lon, CENTER.lat, lon, lat),
    };
  });
}

async function fromUsgs() {
  const res = await fetch(USGS_URL);
  if (!res.ok) throw new Error(`USGS HTTP ${res.status}`);
  return ((await res.json()).features ?? []).map((f) => {
    const [lon, lat, depth] = f.geometry.coordinates;
    return { lon, lat, depth, mag: f.properties.mag, shindo: null, place: f.properties.place, time: f.properties.time, url: f.properties.url, source: 'USGS', dist: distanceM(CENTER.lon, CENTER.lat, lon, lat) };
  });
}

async function refresh() {
  try {
    let all;
    try {
      all = await fromJma();
      report('usgs', true, 'JMA');
    } catch (e) {
      console.warn('[Quakes] JMA unavailable, using USGS:', e.message);
      all = await fromUsgs();
      report('usgs', true, 'USGS fallback');
    }
    const near = all
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
      obj.add(makeLabel(`M${q.mag.toFixed(1)}${q.shindo ? ` 震度${q.shindo}` : ''} ${jst(q.time)}`, { className: 'label-quake', maxDistance: 400_000 }));
      setInfo(obj, `M${q.mag.toFixed(1)} earthquake`, `${q.place ?? ''}<br>${q.shindo ? `Max intensity shindo ${q.shindo}<br>` : ''}Depth ${q.depth.toFixed(0)} km<br>${new Date(q.time).toLocaleString('en-GB', { timeZone: 'Asia/Tokyo' })} JST<br><a href="${q.url}" target="_blank" rel="noopener noreferrer">${q.source} information</a>`);
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
  register('usgs', 'Earthquakes', 'www.jma.go.jp (USGS fallback)');
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

const DIRECTIONS = [['Northeastern', 'NE'], ['Northwestern', 'NW'], ['Southeastern', 'SE'], ['Southwestern', 'SW'], ['Northern', 'N'], ['Southern', 'S'], ['Eastern', 'E'], ['Western', 'W'], ['Central', 'C']];

function shortPlace(place) {
  let name = place ?? 'Unknown';
  if (/^off the coast of /i.test(name)) name = `Off ${name.replace(/^off the coast of /i, '')}`;
  else name = name.split(' of ').pop();
  for (const [long, short] of DIRECTIONS) name = name.replace(new RegExp(`\\b${long}\\b`, 'g'), short);
  name = name.replace(/\s*Prefecture\b/gi, '').replace(/,\s*Japan$/i, '').replace(/,/g, '');
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function bearing(q) {
  const dx = (q.lon - CENTER.lon) * Math.cos((CENTER.lat * Math.PI) / 180);
  const dy = q.lat - CENTER.lat;
  const deg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8];
}

export function getRecent(limit = 5) {
  return recent.slice(0, limit).map((q) => {
    const p = toLocal(q.lon, q.lat);
    const inside = Math.abs(p.x) <= INNER_HALF_M && Math.abs(p.z) <= INNER_HALF_M;
    return {
      place: shortPlace(q.place),
      mag: `M${q.mag.toFixed(1)}`,
      shindo: q.shindo,
      time: jst(q.time),
      obj: inside ? q.obj ?? null : null,
      away: `${Math.round(q.dist / 1000)}KM ${bearing(q)}`,
    };
  });
}
