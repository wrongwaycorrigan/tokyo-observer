import * as THREE from 'three';
import {
  INNER_HALF_M, OUTER_HALF_M, bboxForHalfSize, lonLatToTilePx, tileRange, toLonLat,
} from './geo.js';
import { gouraudMaterial } from './shading.js';
import { register, report } from './sources.js';

const DEM_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const COVER_URL = (z, x, y) => `https://mapproxy.terrascope.be/mapproxy/wmts/esa-worldcover-map-10m-2021-v2_map/webmercator/${z}/${x}/${y}.png`;

const VERTICAL_EXAGGERATION = 1.4;
const LAND_MIN_M = 1.5;
const SEA_FLOOR_MIN_M = -4;
const SEA_FLOOR_DEEPEST_M = -40;
const SPIKE_LOWLAND_M = 80;
const SPIKE_JUMP_M = 60;
const SHORE_RANGE_M = 30;

export const COVER = {
  TREE: 10, SHRUB: 20, GRASS: 30, CROP: 40, BUILT: 50, BARE: 60, SNOW: 70, WATER: 80, WETLAND: 90, MANGROVE: 95, MOSS: 100, NONE: 0,
};

const LEGEND = [
  [0, 100, 0, COVER.TREE], [255, 187, 34, COVER.SHRUB], [255, 255, 76, COVER.GRASS],
  [240, 150, 255, COVER.CROP], [250, 0, 0, COVER.BUILT], [180, 180, 180, COVER.BARE],
  [240, 240, 240, COVER.SNOW], [0, 100, 200, COVER.WATER], [0, 150, 160, COVER.WETLAND],
  [0, 207, 117, COVER.MANGROVE], [250, 230, 160, COVER.MOSS],
];

const GROUND = {
  [COVER.TREE]: ['#1f6a6a', '#2a7e74'],
  [COVER.SHRUB]: ['#4f8a78', '#5f9a82'],
  [COVER.GRASS]: ['#6cc0a0', '#7fd0aa'],
  [COVER.CROP]: ['#e0b884', '#ecc898'],
  [COVER.BUILT]: ['#a29aac', '#b2aabb'],
  [COVER.BARE]: ['#d8b0a8', '#e4c0b4'],
  [COVER.SNOW]: ['#f4ecfa', '#fcf6ff'],
  [COVER.WATER]: ['#2a4a9a', '#3050a8'],
  [COVER.WETLAND]: ['#3a8a8a', '#46989a'],
  [COVER.MANGROVE]: ['#257a70', '#2f8a7a'],
  [COVER.MOSS]: ['#b8b090', '#c8c0a0'],
  [COVER.NONE]: ['#2a4a9a', '#3050a8'],
};
const ROOF_SPECKS = [[226, 214, 200], [176, 118, 104], [204, 208, 214], [150, 144, 156]];

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const GROUND_RGB = Object.fromEntries(Object.entries(GROUND).map(([k, v]) => [k, v.map(hexRgb)]));

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function loadMosaic(urlFn, bbox, z) {
  const r = tileRange(bbox, z);
  const cols = r.x1 - r.x0 + 1;
  const rows = r.y1 - r.y0 + 1;
  const canvas = document.createElement('canvas');
  canvas.width = cols * 256;
  canvas.height = rows * 256;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const jobs = [];
  for (let ty = r.y0; ty <= r.y1; ty++) {
    for (let tx = r.x0; tx <= r.x1; tx++) {
      jobs.push(loadImage(urlFn(z, tx, ty)).then((img) => {
        if (img) ctx.drawImage(img, (tx - r.x0) * 256, (ty - r.y0) * 256);
      }));
    }
  }
  await Promise.all(jobs);
  return {
    data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
    w: canvas.width, h: canvas.height, ox: r.x0 * 256, oy: r.y0 * 256, z,
  };
}

function mosaicPx(m, lon, lat) {
  const p = lonLatToTilePx(lon, lat, m.z);
  return { x: p.x - m.ox, y: p.y - m.oy };
}

function decodeElevation(d, i) {
  return d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768;
}

function sampleElevation(m, px, py) {
  const x = Math.max(0, Math.min(m.w - 1.001, px - 0.5));
  const y = Math.max(0, Math.min(m.h - 1.001, py - 0.5));
  const x0 = Math.floor(x); const y0 = Math.floor(y);
  const fx = x - x0; const fy = y - y0;
  const at = (xx, yy) => decodeElevation(m.data, (yy * m.w + xx) * 4);
  const a = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const b = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return a * (1 - fy) + b * fy;
}

const _classCache = new Map();
function classifyRgb(r, g, b, a) {
  if (a < 128) return COVER.NONE;
  const key = (r << 16) | (g << 8) | b;
  let c = _classCache.get(key);
  if (c !== undefined) return c;
  let best = Infinity;
  for (const [lr, lg, lb, cls] of LEGEND) {
    const d = (r - lr) ** 2 + (g - lg) ** 2 + (b - lb) ** 2;
    if (d < best) { best = d; c = cls; }
  }
  _classCache.set(key, c);
  return c;
}

function sampleCover(m, px, py) {
  const x = Math.max(0, Math.min(m.w - 1, Math.floor(px)));
  const y = Math.max(0, Math.min(m.h - 1, Math.floor(py)));
  const i = (y * m.w + x) * 4;
  return classifyRgb(m.data[i], m.data[i + 1], m.data[i + 2], m.data[i + 3]);
}

class Region {
  constructor({ half, grid, texSize, demZoom, coverZoom, hole = 0, yOffset = 0 }) {
    Object.assign(this, { half, grid, texSize, demZoom, coverZoom, hole, yOffset });
  }

  async load() {
    const bbox = bboxForHalfSize(this.half);
    [this.dem, this.cover] = await Promise.all([
      loadMosaic(DEM_URL, bbox, this.demZoom),
      loadMosaic(COVER_URL, bbox, this.coverZoom),
    ]);
    this.buildHeights();
    this.texture = this.buildTexture();
    this.mesh = new THREE.Mesh(this.buildGeometry(), gouraudMaterial({
      map: this.texture, vertexColors: false, specular: 0,
    }));
    this.mesh.position.y = this.yOffset;
    this.mesh.userData.surface = true;
  }

  coverAt(lon, lat) {
    const p = mosaicPx(this.cover, lon, lat);
    return sampleCover(this.cover, p.x, p.y);
  }

  buildHeights() {
    const n = this.grid + 1;
    this.heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -this.half + (2 * this.half * i) / this.grid;
        const z = -this.half + (2 * this.half * j) / this.grid;
        const { lon, lat } = toLonLat(x, z);
        const p = mosaicPx(this.dem, lon, lat);
        let e = sampleElevation(this.dem, p.x, p.y);
        const c = this.coverAt(lon, lat);
        if (c === COVER.WATER || c === COVER.NONE) {
          if (e < 3) e = THREE.MathUtils.clamp(e, SEA_FLOOR_DEEPEST_M, SEA_FLOOR_MIN_M);
        } else {
          e = Math.max(e, LAND_MIN_M);
        }
        this.heights[j * n + i] = e * VERTICAL_EXAGGERATION;
      }
    }
    this.despike();
  }

  despike() {
    const n = this.grid + 1;
    const src = this.heights.slice();
    const ring = [];
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) {
        ring.length = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) if (di || dj) ring.push(src[(j + dj) * n + i + di]);
        }
        ring.sort((x, y) => x - y);
        const median = (ring[3] + ring[4]) / 2;
        const h = src[j * n + i];
        if (median < SPIKE_LOWLAND_M && Math.abs(h - median) > SPIKE_JUMP_M) this.heights[j * n + i] = median;
      }
    }
  }

  heightAt(x, z) {
    const n = this.grid + 1;
    const gx = ((x + this.half) / (2 * this.half)) * this.grid;
    const gz = ((z + this.half) / (2 * this.half)) * this.grid;
    if (gx < 0 || gz < 0 || gx > this.grid || gz > this.grid) return null;
    const i = Math.min(this.grid - 1, Math.floor(gx));
    const j = Math.min(this.grid - 1, Math.floor(gz));
    const fx = gx - i; const fz = gz - j;
    const h = (a, b) => this.heights[b * n + a];
    const top = h(i, j) * (1 - fx) + h(i + 1, j) * fx;
    const bot = h(i, j + 1) * (1 - fx) + h(i + 1, j + 1) * fx;
    return top * (1 - fz) + bot * fz + this.yOffset;
  }

  buildGeometry() {
    const n = this.grid + 1;
    const pos = new Float32Array(n * n * 3);
    const uv = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        pos[k * 3] = -this.half + (2 * this.half * i) / this.grid;
        pos[k * 3 + 1] = this.heights[k];
        pos[k * 3 + 2] = -this.half + (2 * this.half * j) / this.grid;
        uv[k * 2] = i / this.grid;
        uv[k * 2 + 1] = 1 - j / this.grid;
      }
    }
    const idx = [];
    const cell = (2 * this.half) / this.grid;
    for (let j = 0; j < this.grid; j++) {
      for (let i = 0; i < this.grid; i++) {
        if (this.hole) {
          const cx = -this.half + (i + 0.5) * cell;
          const cz = -this.half + (j + 0.5) * cell;
          if (Math.abs(cx) < this.hole - cell && Math.abs(cz) < this.hole - cell) continue;
        }
        const a = j * n + i;
        idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  buildTexture() {
    const size = this.texSize;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    const d = img.data;
    const meters = (2 * this.half) / size;

    const colPx = new Float32Array(size);
    const rowPx = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      const x = -this.half + (i + 0.5) * meters;
      colPx[i] = mosaicPx(this.cover, toLonLat(x, 0).lon, 0).x;
      const z = -this.half + (i + 0.5) * meters;
      rowPx[i] = mosaicPx(this.cover, toLonLat(0, z).lon, toLonLat(0, z).lat).y;
    }

    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const c = sampleCover(this.cover, colPx[i], rowPx[j]);
        const tones = GROUND_RGB[c] || GROUND_RGB[COVER.NONE];
        const hv = hash(i, j);
        let rgb = hash(i >> 2, j >> 2) > 0.5 ? tones[0] : tones[1];
        if (c === COVER.BUILT && hv > 0.78) rgb = ROOF_SPECKS[Math.floor(hv * 97) % ROOF_SPECKS.length];
        const jitter = (hv - 0.5) * 14;
        const k = (j * size + i) * 4;
        d[k] = rgb[0] + jitter;
        d[k + 1] = rgb[1] + jitter;
        d[k + 2] = rgb[2] + jitter;
        d[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = 4;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }
}

export class Terrain {
  constructor() {
    this.inner = new Region({ half: INNER_HALF_M, grid: 512, texSize: 2048, demZoom: 11, coverZoom: 11 });
    this.outer = new Region({
      half: OUTER_HALF_M, grid: 220, texSize: 1024, demZoom: 8, coverZoom: 8, hole: INNER_HALF_M, yOffset: -3,
    });
    this.group = new THREE.Group();
  }

  async load(onProgress = () => {}) {
    onProgress('Loading elevation and land cover...');
    register('terrain', 'Elevation + land cover', 'AWS Terrain Tiles, ESA WorldCover');
    await Promise.all([this.inner.load(), this.outer.load()]);
    report('terrain', true);
    this.group.add(this.inner.mesh, this.outer.mesh);
  }

  heightAt(x, z) {
    return this.inner.heightAt(x, z) ?? this.outer.heightAt(x, z) ?? 0;
  }

  shoreTexture() {
    const n = this.inner.grid + 1;
    const data = new Uint8Array(n * n);
    for (let k = 0; k < n * n; k++) data[k] = Math.round(THREE.MathUtils.clamp((this.inner.heights[k] + SHORE_RANGE_M) / (2 * SHORE_RANGE_M), 0, 1) * 255);
    const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return { texture: tex, half: this.inner.half, grid: this.inner.grid, range: SHORE_RANGE_M };
  }

  coverAt(lon, lat) {
    return this.inner.coverAt(lon, lat);
  }
}
