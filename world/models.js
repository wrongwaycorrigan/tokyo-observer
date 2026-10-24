import * as THREE from 'three';
import { gouraudMaterial } from './shading.js';

const SEGMENTS = 10;

class Mesh {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.idx = [];
  }

  vertex(p, n, c) {
    this.pos.push(p[0], p[1], -p[2]);
    this.nrm.push(n[0], n[1], -n[2]);
    this.col.push(c[0], c[1], c[2]);
    return this.pos.length / 3 - 1;
  }

  tri(a, b, c) {
    this.idx.push(a, b, c);
  }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => scale(a, 1 / (Math.hypot(...a) || 1));

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255].map((v) => v / 255);
}

function block(m, corners, color) {
  const c = rgb(color);
  const center = scale(corners.reduce(add, [0, 0, 0]), 1 / 8);
  const faces = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
  for (const f of faces) {
    const p = f.map((i) => corners[i]);
    let n = norm(cross(sub(p[1], p[0]), sub(p[2], p[0])));
    if (Math.hypot(...n) === 0) n = norm(cross(sub(p[2], p[0]), sub(p[3], p[0])));
    const faceCenter = scale(p.reduce(add, [0, 0, 0]), 0.25);
    if (dot(n, sub(faceCenter, center)) < 0) n = scale(n, -1);
    const v = p.map((q) => m.vertex(q, n, c));
    m.tri(v[0], v[1], v[2]);
    m.tri(v[0], v[2], v[3]);
  }
}

function box(m, [x, y, z], [w, h, d], color) {
  const [a, b, c] = [w / 2, h / 2, d / 2];
  block(m, [
    [x - a, y - b, z - c], [x + a, y - b, z - c], [x + a, y - b, z + c], [x - a, y - b, z + c],
    [x - a, y + b, z - c], [x + a, y + b, z - c], [x + a, y + b, z + c], [x - a, y + b, z + c],
  ], color);
}

function taperBox(m, [x, y, z], [w, h, d], topScale, color) {
  const [a, b, c] = [w / 2, h / 2, d / 2];
  const [ta, tc] = [a * topScale, c * topScale];
  block(m, [
    [x - a, y - b, z - c], [x + a, y - b, z - c], [x + a, y - b, z + c], [x - a, y - b, z + c],
    [x - ta, y + b, z - tc], [x + ta, y + b, z - tc], [x + ta, y + b, z + tc], [x - ta, y + b, z + tc],
  ], color);
}

function loft(m, rings, color, { axis = 'z', caps = true, bottomFlat = false, segments = SEGMENTS } = {}) {
  const c = rgb(color);
  const place = (r, ang) => {
    let a = Math.cos(ang) * r.w;
    let b = Math.sin(ang) * r.h;
    if (bottomFlat && b < 0) b *= 0.35;
    return axis === 'z'
      ? [(r.x ?? 0) + a, (r.y ?? 0) + b, r.t]
      : [(r.x ?? 0) + a, r.t, (r.y ?? 0) + b];
  };

  const pts = rings.map((r) => Array.from({ length: segments }, (_, i) => place(r, (i / segments) * Math.PI * 2)));
  const nrm = pts.map((ring) => ring.map(() => [0, 0, 0]));
  const center = scale(pts.flat().reduce(add, [0, 0, 0]), 1 / (pts.length * segments));
  for (let r = 0; r < pts.length - 1; r++) {
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      const n = cross(sub(pts[r + 1][i], pts[r][i]), sub(pts[r][j], pts[r][i]));
      for (const [rr, ii] of [[r, i], [r, j], [r + 1, i], [r + 1, j]]) nrm[rr][ii] = add(nrm[rr][ii], n);
    }
  }

  let outward = 0;
  pts.forEach((ring, r) => ring.forEach((p, i) => { outward += dot(nrm[r][i], sub(p, center)); }));
  const flip = outward < 0 ? -1 : 1;

  const ids = pts.map((ring, r) => ring.map((p, i) => m.vertex(p, scale(norm(nrm[r][i]), flip), c)));
  for (let r = 0; r < pts.length - 1; r++) {
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      m.tri(ids[r][i], ids[r + 1][i], ids[r + 1][j]);
      m.tri(ids[r][i], ids[r + 1][j], ids[r][j]);
    }
  }

  if (!caps) return;
  for (const [r, dir] of [[0, -1], [pts.length - 1, 1]]) {
    const ring = pts[r];
    const mid = scale(ring.reduce(add, [0, 0, 0]), 1 / segments);
    const n = axis === 'z' ? [0, 0, dir] : [0, dir, 0];
    const centerId = m.vertex(mid, n, c);
    const rim = ring.map((p) => m.vertex(p, n, c));
    for (let i = 0; i < segments; i++) m.tri(centerId, rim[i], rim[(i + 1) % segments]);
  }
}

function sphere(m, [x, y, z], radius, color, stretchY = 1) {
  const rings = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI;
    const r = Math.max(Math.cos(a) * radius, 0.001);
    rings.push({ t: y + Math.sin(a) * radius * stretchY, w: r, h: r, x, y: z });
  }
  loft(m, rings, color, { axis: 'y', caps: false });
}

function cylinderUp(m, [x, y, z], radius, height, color, topRadius = radius) {
  loft(m, [{ t: y, w: radius, h: radius, x, y: z }, { t: y + height, w: topRadius, h: topRadius, x, y: z }], color, { axis: 'y', segments: 8 });
}

function hull(m, len, w, h, color, { bowRake = 0.22, deckColor } = {}) {
  const half = len / 2;
  loft(m, [
    { t: -half, w: w * 0.85, h, y: h * 0.25 },
    { t: -half * 0.6, w, h, y: h * 0.25 },
    { t: half * 0.45, w, h, y: h * 0.25 },
    { t: half * (1 - bowRake), w: w * 0.6, h: h * 1.05, y: h * 0.32 },
    { t: half, w: w * 0.08, h: h * 1.1, y: h * 0.4 },
  ], color, { bottomFlat: true });
  if (deckColor) box(m, [0, h * 1.2, -half * 0.05], [w * 1.7, h * 0.12, len * 0.82], deckColor);
}

const WINDOW = '#1b2a44';

const BUILDERS = {
  airliner(m) {

    loft(m, [
      { t: -19, w: 0.3, h: 0.5, y: 1.2 },
      { t: -15, w: 1.4, h: 1.6, y: 0.4 },
      { t: -8, w: 2.0, h: 2.1 },
      { t: 12, w: 2.0, h: 2.1 },
      { t: 16, w: 1.6, h: 1.7, y: -0.2 },
      { t: 18.6, w: 0.6, h: 0.7, y: -0.5 },
      { t: 19.2, w: 0.1, h: 0.1, y: -0.6 },
    ], '#f2f2ee');
    box(m, [0, 0.5, 2], [4.15, 0.6, 22], '#2a4b8d');
    box(m, [0, 0.7, 16.2], [2.6, 0.5, 1.4], WINDOW);

    for (const s of [-1, 1]) {
      block(m, [
        [0, -1.0, -2], [0, -1.0, 4], [s * 17, -0.2, -5], [s * 17, -0.2, -3],
        [0, -0.5, -2], [0, -0.5, 4], [s * 17, 0.0, -5], [s * 17, 0.0, -3],
      ].map((p, i) => (i % 4 < 2 ? [s * 1.6, p[1], p[2]] : p)), '#c9ccd2');
      block(m, [
        [s * 1, 1.0, -18], [s * 1, 1.0, -14], [s * 7, 1.2, -19], [s * 7, 1.2, -17.5],
        [s * 1, 1.3, -18], [s * 1, 1.3, -14], [s * 7, 1.4, -19], [s * 7, 1.4, -17.5],
      ], '#c9ccd2');
      loft(m, [
        { t: -1, w: 1.0, h: 1.0, x: s * 6.5, y: -1.9 },
        { t: 2.5, w: 1.2, h: 1.2, x: s * 6.5, y: -1.9 },
        { t: 3, w: 1.0, h: 1.0, x: s * 6.5, y: -1.9 },
      ], '#8c919b', { segments: 8 });
    }
    block(m, [
      [-0.25, 1.5, -18], [0.25, 1.5, -18], [0.25, 1.5, -12], [-0.25, 1.5, -12],
      [-0.2, 7.5, -20], [0.2, 7.5, -20], [0.2, 7.5, -17], [-0.2, 7.5, -17],
    ], '#2a4b8d');
  },

  cargoShip(m) {
    hull(m, 190, 15, 9, '#8c2a22', { deckColor: '#5a5d63' });

    const colors = ['#c43b2e', '#2f6fb3', '#e0a12d', '#3f8f4a', '#d8d8d0', '#7a4aa0'];
    let k = 0;
    for (let z = -55; z <= 70; z += 14) {
      for (let x = -9; x <= 9; x += 6) {
        const tiers = 2 + ((k * 7) % 3);
        box(m, [x, 10.5 + tiers * 1.4, z], [5.6, tiers * 2.8, 12.5], colors[k % colors.length]);
        k++;
      }
    }
    taperBox(m, [0, 17, -78], [26, 16, 14], 0.9, '#efefe8');
    box(m, [0, 23.5, -73.5], [27, 2, 3], WINDOW);
    taperBox(m, [0, 27, -84], [5, 8, 6], 0.8, '#c43b2e');
  },

  tanker(m) {
    hull(m, 180, 16, 9, '#2b2f36', { deckColor: '#7e3a2e' });
    for (let z = -50; z <= 70; z += 20) cylinderUp(m, [0, 10.5, z], 3, 1.6, '#9da2a8');
    box(m, [0, 11.2, 10], [1.5, 1.2, 130], '#c8b24a');
    taperBox(m, [0, 18, -74], [26, 16, 14], 0.9, '#efefe8');
    box(m, [0, 24.5, -69.5], [27, 2, 3], WINDOW);
    taperBox(m, [0, 28, -80], [5, 8, 6], 0.8, '#2b2f36');
  },

  liner(m) {
    hull(m, 120, 11, 6, '#f2f2ee', { deckColor: '#b9a27a' });
    for (let d = 0; d < 4; d++) {
      const len = 88 - d * 14;
      taperBox(m, [0, 9 + d * 3.2, -6 + d * 2], [19 - d * 1.5, 3, len], 0.98, '#f2f2ee');
      box(m, [0, 9.4 + d * 3.2, -6 + d * 2], [19.2 - d * 1.5, 0.9, len - 2], WINDOW);
    }
    taperBox(m, [0, 25, -14], [5, 7, 9], 0.8, '#1f5fa8');
    box(m, [0, 28.8, -14], [5, 1.2, 8], '#c43b2e');
  },

  genericShip(m) {
    hull(m, 70, 7, 5, '#5f6670', { deckColor: '#4a4e55' });
    taperBox(m, [0, 9.5, -20], [11, 6, 12], 0.85, '#e6e6de');
    box(m, [0, 11.8, -15], [11.5, 1.2, 2], WINDOW);
    cylinderUp(m, [0, 12.5, -25], 1.4, 5, '#c43b2e', 1.2);
  },

  fishingBoat(m) {
    hull(m, 16, 2.6, 1.6, '#2c62a8', { deckColor: '#d6d0bf' });
    taperBox(m, [0, 3.4, 1.5], [3.4, 2.2, 4], 0.85, '#f2f2ee');
    box(m, [0, 4.0, 3.4], [3.5, 0.7, 0.2], WINDOW);
    cylinderUp(m, [0, 2, -3], 0.12, 6, '#d6d0bf');
    box(m, [0, 6.5, -3], [3.5, 0.15, 0.15], '#d6d0bf');
  },

  sailboat(m) {
    hull(m, 11, 1.8, 1.0, '#f2f2ee', { deckColor: '#b48a52' });
    taperBox(m, [0, 1.8, -0.5], [1.8, 0.8, 3], 0.8, '#f2f2ee');
    cylinderUp(m, [0, 1.3, 1.2], 0.08, 13, '#c9ccd2');

    block(m, [
      [-0.03, 2.2, 1.1], [0.03, 2.2, 1.1], [0.03, 2.2, -3.8], [-0.03, 2.2, -3.8],
      [-0.03, 14, 1.1], [0.03, 14, 1.1], [0.03, 14, 1.0], [-0.03, 14, 1.0],
    ], '#f7f4ea');
    block(m, [
      [-0.03, 2.0, 1.4], [0.03, 2.0, 1.4], [0.03, 2.0, 5.2], [-0.03, 2.0, 5.2],
      [-0.03, 12.5, 1.3], [0.03, 12.5, 1.3], [0.03, 12.5, 1.4], [-0.03, 12.5, 1.4],
    ], '#e8c14a');
  },

  speedboat(m) {
    hull(m, 8, 1.3, 0.7, '#c43b2e', { bowRake: 0.4, deckColor: '#f2f2ee' });
    block(m, [
      [-1.1, 1.0, 0.4], [1.1, 1.0, 0.4], [1.1, 1.0, 1.0], [-1.1, 1.0, 1.0],
      [-1.0, 1.7, 0.1], [1.0, 1.7, 0.1], [1.0, 1.7, 0.2], [-1.0, 1.7, 0.2],
    ], WINDOW);
    box(m, [0, 1.1, -3.6], [0.8, 0.9, 0.7], '#2b2f36');
  },

  tug(m) {
    hull(m, 30, 5, 2.6, '#1f2328', { bowRake: 0.3, deckColor: '#c43b2e' });
    taperBox(m, [0, 5.2, 2], [7, 3.4, 9], 0.9, '#f2f2ee');
    taperBox(m, [0, 8.2, 3], [5.5, 2.4, 5], 0.9, '#f2f2ee');
    box(m, [0, 8.6, 5.6], [5.6, 1, 0.3], WINDOW);
    cylinderUp(m, [0, 6.5, -2.5], 0.7, 5, '#e0a12d', 0.6);
    for (const s of [-1, 1]) {
      for (let z = -9; z <= 9; z += 6) box(m, [s * 5.1, 2.4, z], [0.5, 1.1, 1.1], '#151515');
    }
  },

  houseboat(m) {
    hull(m, 14, 3, 1.1, '#f2f2ee', { bowRake: 0.15, deckColor: '#b48a52' });
    taperBox(m, [0, 3.0, -0.5], [5, 2.6, 9], 1, '#f2f2ee');
    box(m, [0, 3.2, -0.5], [5.1, 0.8, 8], WINDOW);

    block(m, [
      [-2.9, 4.3, -5.4], [2.9, 4.3, -5.4], [2.9, 4.3, 4.4], [-2.9, 4.3, 4.4],
      [-0.1, 5.8, -5.4], [0.1, 5.8, -5.4], [0.1, 5.8, 4.4], [-0.1, 5.8, 4.4],
    ], '#c43b2e');
  },

  iss(m) {

    box(m, [0, 0, 0], [108, 3, 3], '#c9ccd2');
    loft(m, [{ t: -26, w: 2.2, h: 2.2 }, { t: 24, w: 2.2, h: 2.2 }], '#e6e6de', { segments: 8 });
    loft(m, [{ t: -8, w: 2.2, h: 2.2, x: 7 }, { t: 6, w: 2.2, h: 2.2, x: 7 }], '#e6e6de', { segments: 8 });
    loft(m, [{ t: -8, w: 2.2, h: 2.2, x: -7 }, { t: 6, w: 2.2, h: 2.2, x: -7 }], '#e6e6de', { segments: 8 });
    for (const x of [-48, -36, 36, 48]) {
      for (const s of [-1, 1]) box(m, [x, 0, s * 19], [11, 0.3, 33], '#23408a');
      box(m, [x, 0.25, 0], [11.4, 0.3, 4], '#c9a23a');
    }
    for (const x of [-20, 20]) box(m, [x, 6, 0], [4, 10, 0.3], '#e6e6de');
  },

  balloon(m) {
    sphere(m, [0, 30, 0], 6, '#f4f1e6', 1.15);
    loft(m, [{ t: 22.5, w: 0.8, h: 0.8 }, { t: 23.6, w: 0.3, h: 0.3 }], '#f4f1e6', { axis: 'y', segments: 6 });
    box(m, [0, 12, 0], [0.08, 21, 0.08], '#9da2a8');
    box(m, [0, 1, 0], [0.9, 1.4, 0.6], '#e6e6de');
  },

  skytree(m) {

    loft(m, [
      { t: 0, w: 34, h: 34 }, { t: 120, w: 20, h: 20 }, { t: 330, w: 12, h: 12 },
      { t: 340, w: 19, h: 19 }, { t: 365, w: 19, h: 19 }, { t: 372, w: 11, h: 11 },
      { t: 440, w: 9, h: 9 }, { t: 445, w: 13, h: 13 }, { t: 460, w: 13, h: 13 },
      { t: 466, w: 7, h: 7 }, { t: 497, w: 5, h: 5 },
    ], '#dfe6ee', { axis: 'y', segments: 9 });
    box(m, [0, 352, 0], [39, 9, 39], '#6d8fb8');
    box(m, [0, 452, 0], [27, 6, 27], '#6d8fb8');
    cylinderUp(m, [0, 497, 0], 3.5, 137, '#c8ced6', 1.2);
  },

  tokyoTower(m) {

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const legs = [[0, 46, 40, '#e8501c'], [46, 92, 27, '#f2f2ee'], [92, 120, 17, '#e8501c']];
        for (const [y0, y1, r0] of legs) {
          const r1 = y1 === 120 ? 13 : legs.find((l) => l[0] === y1)[2];
          const t0 = 6 - y0 * 0.02;
          const t1 = 6 - y1 * 0.02;
          block(m, [
            [sx * r0 - t0, y0, sz * r0 - t0], [sx * r0 + t0, y0, sz * r0 - t0], [sx * r0 + t0, y0, sz * r0 + t0], [sx * r0 - t0, y0, sz * r0 + t0],
            [sx * r1 - t1, y1, sz * r1 - t1], [sx * r1 + t1, y1, sz * r1 - t1], [sx * r1 + t1, y1, sz * r1 + t1], [sx * r1 - t1, y1, sz * r1 + t1],
          ], legs.find((l) => l[0] === y0)[3]);
        }
      }
    }
    box(m, [0, 46, 0], [70, 3, 70], '#e8501c');
    const bands = [[120, 175, 15, 10, '#f2f2ee'], [175, 225, 10, 6.5, '#e8501c'], [225, 255, 6.5, 4, '#f2f2ee'], [255, 333, 2.5, 0.6, '#e8501c']];
    for (const [y0, y1, w0, w1, c] of bands) {
      block(m, [
        [-w0, y0, -w0], [w0, y0, -w0], [w0, y0, w0], [-w0, y0, w0],
        [-w1, y1, -w1], [w1, y1, -w1], [w1, y1, w1], [-w1, y1, w1],
      ], c);
    }
    box(m, [0, 150, 0], [34, 12, 34], '#4a6a92');
    box(m, [0, 250, 0], [14, 6, 14], '#4a6a92');
    box(m, [0, 8, 0], [110, 16, 80], '#d8d2c4');
  },

  landmarkTower(m) {

    taperBox(m, [0, 60, 0], [70, 120, 70], 0.9, '#cfc6b6');
    taperBox(m, [0, 190, 0], [62, 140, 62], 0.82, '#d9d1c2');
    taperBox(m, [0, 280, 0], [50, 40, 50], 0.6, '#cfc6b6');
    box(m, [0, 8, 50], [160, 16, 80], '#bfb6a6');
  },

  controlTower(m) {
    taperBox(m, [0, 18, 0], [9, 36, 9], 0.75, '#e6e2d8');
    block(m, [
      [-6, 36, -6], [6, 36, -6], [6, 36, 6], [-6, 36, 6],
      [-8, 44, -8], [8, 44, -8], [8, 44, 8], [-8, 44, 8],
    ], '#4a7a92');
    box(m, [0, 45, 0], [17, 2, 17], '#e6e2d8');
    cylinderUp(m, [0, 46, 0], 0.3, 6, '#c9ccd2');
    box(m, [14, 4, 0], [20, 8, 14], '#d8d2c4');
  },

  mast(m) {
    const bands = 7;
    for (let k = 0; k < bands; k++) {
      const y0 = (k / bands) * 100;
      const y1 = ((k + 1) / bands) * 100;
      const w0 = 5 - y0 * 0.03;
      const w1 = 5 - y1 * 0.03;
      block(m, [
        [-w0, y0, -w0], [w0, y0, -w0], [w0, y0, w0], [-w0, y0, w0],
        [-w1, y1, -w1], [w1, y1, -w1], [w1, y1, w1], [-w1, y1, w1],
      ], k % 2 ? '#f2f2ee' : '#e8501c');
    }
    box(m, [0, 100.5, 0], [3, 1, 3], '#c9ccd2');
    box(m, [0, 3, 0], [16, 6, 12], '#d8d2c4');
  },

  tideGauge(m) {
    for (const x of [-3, 3]) for (const z of [-2, 4]) box(m, [x, -1, z], [0.5, 5, 0.5], '#5a5048');
    box(m, [0, 1.6, 1], [8, 0.4, 8], '#8a7a66');
    box(m, [0, 3.4, -0.5], [4.4, 3.2, 3.6], '#f2f2ee');
    block(m, [
      [-2.5, 5, -2.5], [2.5, 5, -2.5], [2.5, 5, 1.5], [-2.5, 5, 1.5],
      [-2.5, 5.9, -0.5], [2.5, 5.9, -0.5], [2.5, 5.9, -0.5], [-2.5, 5.9, -0.5],
    ], '#2c62a8');
    box(m, [0, 3.6, 1.35], [1.6, 0.9, 0.1], WINDOW);
    for (let k = 0; k < 8; k++) box(m, [3.2, -2 + k * 1.1, 4.4], [0.35, 1.1, 0.35], k % 2 ? '#f2f2ee' : '#c43b2e');
    cylinderUp(m, [-1.4, 5.5, -0.5], 0.08, 4.5, '#c9ccd2');
    box(m, [1.2, 6.4, -1], [1.8, 0.1, 1.2], '#23408a');
  },

  keeperHouse(m) {
    box(m, [0, 2, 0], [9, 4, 6], '#f2f2ee');
    block(m, [
      [-4.9, 4, -3.4], [4.9, 4, -3.4], [4.9, 4, 3.4], [-4.9, 4, 3.4],
      [-4.9, 6.4, -0.1], [4.9, 6.4, -0.1], [4.9, 6.4, 0.1], [-4.9, 6.4, 0.1],
    ], '#3a5a9a');
    box(m, [0, 1.6, 3.05], [1.2, 2.4, 0.1], '#8a5a3a');
    for (const x of [-3, 3]) box(m, [x, 2.4, 3.05], [1.3, 1.2, 0.1], WINDOW);
  },

  lighthouse(m) {

    loft(m, [{ t: 0, w: 4, h: 4 }, { t: 15, w: 2.8, h: 2.8 }], '#f2f2ee', { axis: 'y', segments: 8 });
    box(m, [0, 15.5, 0], [6.5, 1, 6.5], '#2b2f36');
    cylinderUp(m, [0, 16, 0], 1.6, 2.4, '#fff4c0');
    loft(m, [{ t: 18.4, w: 2, h: 2 }, { t: 20, w: 0.2, h: 0.2 }], '#c43b2e', { axis: 'y', segments: 8 });
  },
};

const _geometries = new Map();
let _sharedMaterial = null;

function toGeometry(m) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(m.nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(m.col, 3));
  g.setIndex(m.idx);
  g.computeBoundingSphere();
  return g;
}

export function modelGeometry(name) {
  if (!_geometries.has(name)) {
    const m = new Mesh();
    BUILDERS[name](m);
    _geometries.set(name, toGeometry(m));
  }
  return _geometries.get(name);
}

function darker(hex, k) {
  return `#${rgb(hex).map((v) => Math.round(v * k * 255).toString(16).padStart(2, '0')).join('')}`;
}

export function createTower({ w, d, h, color, style = 'slab', spire = 0 }) {
  const m = new Mesh();
  const crown = darker(color, 0.78);
  const roofs = [];
  const corners = (x, y, z, hw, hd) => roofs.push([x - hw, y, z - hd], [x + hw, y, z + hd], [x + hw, y, z - hd], [x - hw, y, z + hd]);
  if (style === 'twin') {
    const tw = w * 0.32;
    box(m, [0, h * 0.33, 0], [w, h * 0.66, d], color);
    for (const x of [-w * 0.3, w * 0.3]) {
      box(m, [x, h * 0.83, 0], [tw, h * 0.34, d * 0.8], color);
      box(m, [x, h * 0.98, 0], [tw * 0.8, h * 0.04, d * 0.6], crown);
      roofs.push([x, h, -d * 0.3], [x, h, d * 0.3]);
    }
  } else if (style === 'stepped') {
    taperBox(m, [0, h * 0.3, 0], [w, h * 0.6, d], 0.96, color);
    taperBox(m, [0, h * 0.72, 0], [w * 0.78, h * 0.24, d * 0.78], 0.94, color);
    taperBox(m, [0, h * 0.92, 0], [w * 0.56, h * 0.16, d * 0.56], 0.6, crown);
    corners(0, h, 0, w * 0.17, d * 0.17);
  } else {
    const taper = style === 'tapered' ? 0.62 : 0.94;
    taperBox(m, [0, h * 0.46, 0], [w, h * 0.92, d], taper, color);
    taperBox(m, [0, h * 0.96, 0], [w * taper * 0.86, h * 0.08, d * taper * 0.86], 0.9, crown);
    corners(0, h, 0, w * taper * 0.38, d * taper * 0.38);
  }
  if (spire) {
    cylinderUp(m, [0, h, 0], Math.min(w, d) * 0.06, spire, '#c8ced6', 0.3);
    roofs.push([0, h + spire, 0]);
  }
  box(m, [0, 6, 0], [w * 1.5, 12, d * 1.4], darker(color, 0.9));
  _sharedMaterial ??= gouraudMaterial({ side: THREE.DoubleSide });
  return { mesh: new THREE.Mesh(toGeometry(m), _sharedMaterial), beacons: roofs };
}

export function createModel(name, { tint } = {}) {
  _sharedMaterial ??= gouraudMaterial({ side: THREE.DoubleSide });
  const material = tint === undefined ? _sharedMaterial : gouraudMaterial({ tint, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(modelGeometry(name), material);
  mesh.userData.modelName = name;
  return mesh;
}

export function modelSize(name) {
  return modelGeometry(name).boundingSphere.radius * 2;
}

export const MODEL_NAMES = Object.keys(BUILDERS);
