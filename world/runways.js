import * as THREE from 'three';
import { OUTER_HALF_M, toLocal } from './geo.js';
import { SHARED, gouraudMaterial } from './shading.js';
import { register, report } from './sources.js';

const WIDTH_SCALE = 1.4;
const CLEAR_SIDE_M = 150;
const CLEAR_END_M = 300;
const THRESHOLD_M = 160;
const EDGE_LIGHT_SPACING_M = 60;
const ASPHALT = '#3a3a40';
const CONCRETE = '#6a6a70';
const PAINT = '#f0e6d5';
const RUNWAY_FONT = "'Open Runway Numbers', monospace";
const fontReady = new FontFace('Open Runway Numbers', "url('./fonts/OpenRunwayNumbers.woff2')")
  .load().then((f) => document.fonts.add(f)).catch(() => {});

function bodyTexture(surface) {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = surface.startsWith('CON') ? CONCRETE : ASPHALT;
  ctx.fillRect(0, 0, 32, 128);
  ctx.fillStyle = PAINT;
  ctx.fillRect(1, 0, 1, 128);
  ctx.fillRect(30, 0, 1, 128);
  ctx.fillRect(15, 10, 2, 54);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  return t;
}

function thresholdTexture(label, surface) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = surface.startsWith('CON') ? CONCRETE : ASPHALT;
  ctx.fillRect(0, 0, 64, 128);
  ctx.fillStyle = PAINT;
  ctx.fillRect(2, 0, 2, 128);
  ctx.fillRect(60, 0, 2, 128);
  for (let i = 0; i < 8; i++) {
    const x = 7 + i * 6.5 + (i >= 4 ? 4 : 0);
    ctx.fillRect(Math.round(x), 76, 4, 46);
  }
  const [, digits = label, letter = ''] = /^(\d+)([LCR]?)$/.exec(label) ?? [];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `30px ${RUNWAY_FONT}`;
  ctx.fillText(digits, 32, letter ? 22 : 40);
  if (letter) ctx.fillText(letter, 32, 56);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

function quad(a, b, perp, halfWidth, y, vRepeat) {
  const pts = [
    a.clone().addScaledVector(perp, -halfWidth), a.clone().addScaledVector(perp, halfWidth),
    b.clone().addScaledVector(perp, halfWidth), b.clone().addScaledVector(perp, -halfWidth),
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap((p) => [p.x, y, p.z]), 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, vRepeat, 0, vRepeat], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

function overlayMaterial(map, offset) {
  const m = gouraudMaterial({ map, vertexColors: false, specular: 0.05 });
  m.polygonOffset = true;
  m.polygonOffsetFactor = offset;
  m.polygonOffsetUnits = offset;
  return m;
}

export class Runways {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.count = 0;
    this.zones = [];
  }

  covers(x, z) {
    for (const k of this.zones) {
      const dx = x - k.cx;
      const dz = z - k.cz;
      if (Math.abs(dx * k.ux + dz * k.uz) < k.halfLength && Math.abs(dx * k.uz - dz * k.ux) < k.halfWidth) return true;
    }
    return false;
  }

  async load() {
    register('runways', 'Runways', 'OurAirports (bundled)');
    try {
      const [res] = await Promise.all([fetch('./data/runways.json'), fontReady]);
      const data = await res.json();
      const lamps = { edge: [], green: [], red: [] };
      for (const r of data.runways) this._add(r, lamps);
      for (const [kind, color, size] of [['edge', 0xfff4e2, 2], ['green', 0x7ddfc5, 3], ['red', 0xff5ec8, 3]]) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(lamps[kind], 3));
        const pts = new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, transparent: true, depthWrite: false, opacity: 0 }));
        pts.userData.lamps = true;
        this.group.add(pts);
      }
      report('runways', true, `${this.count} runways`);
    } catch (e) {
      report('runways', false, e.message);
    }
  }

  _add(r, lamps) {
    const [lat1, lon1, lat2, lon2] = r.ends;
    const a = new THREE.Vector3().copy(toLocal(lon1, lat1));
    const b = new THREE.Vector3().copy(toLocal(lon2, lat2));
    if (Math.abs(a.x) > OUTER_HALF_M || Math.abs(a.z) > OUTER_HALF_M) return;
    const dir = b.clone().sub(a);
    const length = dir.length();
    dir.normalize();
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    const half = (r.width * WIDTH_SCALE) / 2;
    let y = 0;
    for (let t = 0; t <= 1; t += 0.1) {
      const p = a.clone().lerp(b, t);
      y = Math.max(y, this.terrain.heightAt(p.x, p.z));
    }
    y += 1.5;

    const body = new THREE.Mesh(quad(a, b, perp, half, y, length / (half * 8)), overlayMaterial(bodyTexture(r.surface), -2));
    this.group.add(body);
    const [leIdent, heIdent] = r.ident.split('/');
    for (const [start, toward, label] of [[a, dir, leIdent], [b, dir.clone().negate(), heIdent]]) {
      const end = start.clone().addScaledVector(toward, Math.min(THRESHOLD_M, length / 4));
      const sidePerp = new THREE.Vector3(-toward.z, 0, toward.x);
      const mesh = new THREE.Mesh(quad(start, end, sidePerp, half, y, 1), overlayMaterial(thresholdTexture(label, r.surface), -4));
      this.group.add(mesh);
      for (let k = -2; k <= 2; k++) {
        const p = start.clone().addScaledVector(sidePerp, (k * half) / 2);
        lamps.green.push(p.x, y + 1, p.z);
        const q = start.clone().addScaledVector(toward, -6).addScaledVector(sidePerp, (k * half) / 2);
        lamps.red.push(q.x, y + 1, q.z);
      }
    }
    for (let s = 0; s <= length; s += EDGE_LIGHT_SPACING_M) {
      const p = a.clone().addScaledVector(dir, s);
      for (const side of [-1, 1]) {
        const q = p.clone().addScaledVector(perp, side * (half + 2));
        lamps.edge.push(q.x, y + 1, q.z);
      }
    }
    this.zones.push({
      cx: (a.x + b.x) / 2, cz: (a.z + b.z) / 2, ux: dir.x, uz: dir.z,
      halfLength: length / 2 + CLEAR_END_M, halfWidth: half + CLEAR_SIDE_M,
    });
    this.count++;
  }

  update() {
    const k = THREE.MathUtils.smoothstep(SHARED.uNight.value, 0.2, 0.7);
    for (const child of this.group.children) {
      if (child.userData.lamps) child.material.opacity = k;
    }
  }
}
