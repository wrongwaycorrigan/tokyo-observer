import * as THREE from 'three';
import { OUTER_HALF_M, bboxForHalfSize, lonLatToTilePx, tileRange, toLonLat } from './geo.js';
import { gouraudMaterial } from './shading.js';
import { register, report } from './sources.js';
import { createRainShaft, removeRainShaft } from './rainshaft.js';

const INDEX_URL = 'https://api.rainviewer.com/public/weather-maps.json';
const ZOOM = 7;
const REFRESH_MS = 10 * 60_000;
const CELL_M = 6_000;
const MAX_CELLS = 120;
const RADAR_HALF_M = 110_000;
const CELL_BASE_M = 4_000;
const CELL_OPACITY = 0.32;

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export class Radar {
  constructor() {
    this.group = new THREE.Group();
    this.cloudMaterial = gouraudMaterial({ vertexColors: false, specular: 0, opacity: CELL_OPACITY, tint: 0x6e7487, side: THREE.DoubleSide });
    this.cloudMaterial.depthWrite = false;
    this.box = new THREE.BoxGeometry(1, 1, 1);
    this.cells = [];
    this.time = null;
  }

  async refresh() {
    try {
      const res = await fetch(INDEX_URL);
      if (!res.ok) { report('radar', false, `HTTP ${res.status}`); return; }
      const index = await res.json();
      const frame = index.radar?.past?.at(-1);
      if (!frame) { report('radar', false, 'no radar frame'); return; }
      const bbox = bboxForHalfSize(RADAR_HALF_M);
      const r = tileRange(bbox, ZOOM);
      const canvas = document.createElement('canvas');
      canvas.width = (r.x1 - r.x0 + 1) * 256;
      canvas.height = (r.y1 - r.y0 + 1) * 256;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const jobs = [];
      for (let y = r.y0; y <= r.y1; y++) {
        for (let x = r.x0; x <= r.x1; x++) {
          jobs.push(loadImage(`${index.host}${frame.path}/256/${ZOOM}/${x}/${y}/2/1_0.png`).then((img) => {
            if (img) ctx.drawImage(img, (x - r.x0) * 256, (y - r.y0) * 256);
          }));
        }
      }
      await Promise.all(jobs);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const found = [];
      for (let z = -RADAR_HALF_M; z <= RADAR_HALF_M; z += CELL_M) {
        for (let x = -RADAR_HALF_M; x <= RADAR_HALF_M; x += CELL_M) {
          const { lon, lat } = toLonLat(x, z);
          const p = lonLatToTilePx(lon, lat, ZOOM);
          const px = Math.floor(p.x - r.x0 * 256);
          const py = Math.floor(p.y - r.y0 * 256);
          if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
          const a = data[(py * canvas.width + px) * 4 + 3];
          if (a > 40) found.push({ x, z, strength: a / 255 });
        }
      }
      found.sort((a, b) => b.strength - a.strength);
      this._build(found.slice(0, MAX_CELLS));
      this.time = new Date(frame.time * 1000);
      report('radar', true, found.length ? `${found.length} rain cells` : 'no rain');
    } catch (e) {
      report('radar', false, e.message);
    }
  }

  _build(cells) {
    for (const c of this.cells) {
      c.traverse((o) => removeRainShaft(o));
      this.group.remove(c);
    }
    this.cells = [];
    for (const c of cells) {
      if (Math.abs(c.x) > OUTER_HALF_M || Math.abs(c.z) > OUTER_HALF_M) continue;
      const g = new THREE.Group();
      g.position.set(c.x, 0, c.z);
      const base = CELL_BASE_M;
      const cloud = new THREE.Mesh(this.box, this.cloudMaterial);
      cloud.scale.set(CELL_M * 0.9, 400 + c.strength * 700, CELL_M * 0.9);
      cloud.position.y = base + cloud.scale.y / 2;
      cloud.renderOrder = 2;
      const shaft = createRainShaft(CELL_M * 0.7, base);
      shaft.position.y = base;
      g.add(cloud, shaft);
      g.userData.strength = c.strength;
      this.group.add(g);
      this.cells.push(g);
    }
  }

  update(camera) {
    const y = camera.position.y;
    const level = THREE.MathUtils.smoothstep(Math.abs(y - (CELL_BASE_M + 500)), 300, 1800);
    const above = 1 - 0.7 * THREE.MathUtils.smoothstep(y, CELL_BASE_M + 1200, CELL_BASE_M + 6000);
    this.cloudMaterial.uniforms.uOpacity.value = CELL_OPACITY * Math.min(level, above);
  }

  get count() {
    return this.cells.length;
  }

  rainAt(x, z) {
    let best = 0;
    for (const c of this.cells) {
      if (Math.abs(c.position.x - x) < CELL_M && Math.abs(c.position.z - z) < CELL_M) best = Math.max(best, c.userData.strength);
    }
    return best;
  }

  start() {
    register('radar', 'Rain radar', 'api.rainviewer.com');
    this.refresh();
    setInterval(() => this.refresh(), REFRESH_MS);
  }
}
