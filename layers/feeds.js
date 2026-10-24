import * as THREE from 'three';
import { OUTER_HALF_M, toLocal } from '../world/geo.js';
import { gouraudMaterial } from '../world/shading.js';
import { forget, keepVisible, makeLabel, setInfo } from '../world/markers.js';
import { onSettingsChange, register, report, settings, unregister } from '../world/sources.js';

const DEFAULT_REFRESH_S = 60;
const COLORS = [0x6ae8f1, 0xf3d572, 0xf158be, 0x7ddfc5, 0xf2a984, 0xb98af0];

let root = null;
let terrain = null;
const active = new Map();
const pin = new THREE.OctahedronGeometry(30, 0).translate(0, 160, 0);
const stem = new THREE.CylinderGeometry(2.5, 2.5, 130, 5).translate(0, 65, 0);

const escape = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

function pickNumber(obj, keys) {
  for (const k of keys) {
    const v = Number(obj?.[k]);
    if (Number.isFinite(v)) return v;
  }
  return NaN;
}

function points(data) {
  if (data?.type === 'FeatureCollection' || data?.type === 'Feature') {
    const features = data.type === 'Feature' ? [data] : data.features ?? [];
    return features
      .filter((f) => f.geometry?.type === 'Point')
      .map((f) => ({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], props: f.properties ?? {} }));
  }
  const list = Array.isArray(data) ? data : Object.values(data ?? {}).find(Array.isArray) ?? [];
  return list.map((o) => ({
    lat: pickNumber(o, ['lat', 'latitude', 'Latitude', 'y']),
    lon: pickNumber(o, ['lon', 'lng', 'long', 'longitude', 'Longitude', 'x']),
    props: o,
  }));
}

function title(props, fallback) {
  return props.name ?? props.title ?? props.label ?? props.id ?? fallback;
}

async function refresh(feed) {
  const id = `feed:${feed.url}`;
  try {
    const res = await fetch(feed.url);
    if (!res.ok) { report(id, false, `HTTP ${res.status}`); return; }
    const pts = points(await res.json()).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    const entry = active.get(feed.url);
    if (!entry) return;
    for (const child of [...entry.group.children]) {
      forget(child);
      entry.group.remove(child);
    }
    let shown = 0;
    for (const p of pts.slice(0, 500)) {
      const pos = toLocal(p.lon, p.lat);
      if (Math.abs(pos.x) > OUTER_HALF_M || Math.abs(pos.z) > OUTER_HALF_M) continue;
      const obj = new THREE.Group();
      obj.position.set(pos.x, Math.max(terrain.heightAt(pos.x, pos.z), 0), pos.z);
      obj.add(new THREE.Mesh(stem, entry.material), new THREE.Mesh(pin, entry.material));
      const name = String(title(p.props, feed.name)).slice(0, 28);
      obj.add(makeLabel(`◆ ${name.toUpperCase()}`, { className: 'label-feed', maxDistance: 80_000, offsetY: 210 }));
      keepVisible(obj, 200, 30, 40, 1);
      const rows = Object.entries(p.props).filter(([, v]) => typeof v !== 'object').slice(0, 8).map(([k, v]) => `${escape(k)}: ${escape(v)}`).join('<br>');
      setInfo(obj, `${feed.name}: ${name}`, rows || escape(feed.url));
      entry.group.add(obj);
      shown++;
    }
    report(id, true, `${shown} of ${pts.length} points in view`);
  } catch (e) {
    report(id, false, e.message);
  }
}

function sync() {
  const wanted = new Map((settings.feeds ?? []).filter((f) => f.url).map((f) => [f.url, f]));
  for (const [url, entry] of active) {
    if (wanted.has(url)) continue;
    clearInterval(entry.timer);
    for (const child of [...entry.group.children]) forget(child);
    root.remove(entry.group);
    unregister(`feed:${url}`);
    active.delete(url);
  }
  let i = active.size;
  for (const [url, feed] of wanted) {
    if (active.has(url)) continue;
    const group = new THREE.Group();
    root.add(group);
    const color = COLORS[i++ % COLORS.length];
    const material = gouraudMaterial({ vertexColors: false, tint: color, emissive: new THREE.Color(color).multiplyScalar(0.3).getHex() });
    const seconds = Math.max(15, Number(feed.refresh) || DEFAULT_REFRESH_S);
    const entry = { group, material, timer: setInterval(() => refresh(feed), seconds * 1000) };
    active.set(url, entry);
    register(`feed:${url}`, feed.name || 'Custom feed', url, { optional: true });
    refresh(feed);
  }
}

export function init(ctx) {
  terrain = ctx.terrain;
  root = new THREE.Group();
  ctx.scene.add(root);
  sync();
  onSettingsChange(sync);
  return root;
}

export function getCount() {
  let n = 0;
  for (const e of active.values()) n += e.group.children.length;
  return n;
}
