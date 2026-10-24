import * as THREE from 'three';
import { INNER_HALF_M, toLonLat } from './geo.js';
import { gouraudMaterial } from './shading.js';
import { COVER } from './terrain.js';

const GRID_M = 95;
const CHUNK_M = 6_000;
const DRAW_DISTANCE_M = 16_000;
const VARIANTS = 3;
const LUMP = 0.09;

const SEASONS = {
  spring: ['#ffb7d5', '#ff9fc8', '#ffd0e4', '#3f8f50', '#5aa65a', '#2f7a4a'],
  summer: ['#2f7a4a', '#3f8f50', '#5aa65a', '#2a6a60', '#4a9a6a'],
  autumn: ['#2f4a32', '#2f4a32', '#3a5638', '#3a5638', '#4a5a34', '#5e6236', '#6e6a3a', '#a8862e', '#b89a3a', '#8a4a26', '#80402c', '#6e4e2e'],
  winter: ['#2a5a3a', '#3a6a48', '#6a5a46', '#7a6a52', '#8a7a62'],
};

function season() {
  const m = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo', month: 'numeric' }));
  if (m >= 3 && m <= 4) return 'spring';
  if (m >= 5 && m <= 9) return 'summer';
  if (m >= 10 && m <= 11) return 'autumn';
  return 'winter';
}

function hash(x, y, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function crownGeometry(variant) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position;
  const nrm = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i).normalize();
    nrm.set([v.x, v.y, v.z], i * 3);
    const k = Math.round(v.x * 1000) * 7 + Math.round(v.y * 1000) * 13 + Math.round(v.z * 1000) * 29;
    const bump = variant === 0 ? 0 : (hash(k, variant, 9) - 0.5) * 2 * LUMP;
    pos.setXYZ(i, v.x * (1 + bump), v.y * (1 + bump), v.z * (1 + bump));
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.scale(1, 0.85, 1);
  g.translate(0, 0.85, 0);
  return g;
}

export class Trees {
  constructor(terrain, keepClear = () => false) {
    this.terrain = terrain;
    this.keepClear = keepClear;
    this.group = new THREE.Group();
    this.chunks = [];
    this.season = season();
  }

  build() {
    const palette = SEASONS[this.season].map((c) => new THREE.Color(c));
    const material = gouraudMaterial({ vertexColors: false, specular: 0.05 });
    const geometries = Array.from({ length: VARIANTS }, (_, v) => crownGeometry(v));
    const e = new THREE.Euler();
    const tint = new THREE.Color();
    const steps = Math.floor((2 * INNER_HALF_M) / GRID_M);
    const buckets = new Map();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let j = 0; j < steps; j++) {
      for (let i = 0; i < steps; i++) {
        const x = -INNER_HALF_M + (i + 0.5 + (hash(i, j, 1) - 0.5) * 0.9) * GRID_M;
        const z = -INNER_HALF_M + (j + 0.5 + (hash(i, j, 2) - 0.5) * 0.9) * GRID_M;
        const { lon, lat } = toLonLat(x, z);
        const c = this.terrain.coverAt(lon, lat);
        const density = c === COVER.TREE ? 0.9 : c === COVER.MANGROVE ? 0.7 : c === COVER.SHRUB ? 0.35 : c === COVER.GRASS || c === COVER.CROP ? 0.04 : c === COVER.BUILT ? 0.025 : 0;
        if (hash(i, j, 3) > density) continue;
        const ground = this.terrain.heightAt(x, z);
        if (ground < 0.5 || this.keepClear(x, z)) continue;
        const r = 16 + hash(i, j, 4) * 16;
        p.set(x, ground - 2, z);
        s.set(r * (0.9 + hash(i, j, 7) * 0.2), r * (0.9 + hash(i, j, 5) * 0.5), r * (0.9 + hash(i, j, 8) * 0.2));
        e.set((hash(i, j, 10) - 0.5) * 0.12, hash(i, j, 11) * Math.PI * 2, (hash(i, j, 12) - 0.5) * 0.12);
        m.compose(p, q.setFromEuler(e), s);
        const variant = Math.floor(hash(i, j, 13) * VARIANTS);
        const key = `${Math.floor((x + INNER_HALF_M) / CHUNK_M)},${Math.floor((z + INNER_HALF_M) / CHUNK_M)},${variant}`;
        if (!buckets.has(key)) buckets.set(key, []);
        tint.copy(palette[Math.floor(hash(i, j, 6) * palette.length)]).multiplyScalar(0.9 + hash(i, j, 14) * 0.2);
        buckets.get(key).push([m.clone(), tint.clone()]);
      }
    }
    for (const [key, items] of buckets) {
      const [cx, cz, variant] = key.split(',').map(Number);
      const mesh = new THREE.InstancedMesh(geometries[variant], material, items.length);
      items.forEach(([matrix, color], k) => {
        mesh.setMatrixAt(k, matrix);
        mesh.setColorAt(k, color);
      });
      mesh.computeBoundingSphere();
      mesh.userData.center = new THREE.Vector3(-INNER_HALF_M + (cx + 0.5) * CHUNK_M, 0, -INNER_HALF_M + (cz + 0.5) * CHUNK_M);
      this.chunks.push(mesh);
      this.group.add(mesh);
    }
    this.count = [...buckets.values()].reduce((n, b) => n + b.length, 0);
  }

  update(camera) {
    const reach = DRAW_DISTANCE_M + camera.position.y * 0.4;
    for (const c of this.chunks) c.visible = c.userData.center.distanceTo(camera.position) < reach;
  }
}
