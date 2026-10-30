import * as THREE from 'three';
import { INNER_HALF_M, edgeFade, toLonLat, toLocal } from './geo.js';
import { SHARED, gouraudMaterial, nightLightsMaterial } from './shading.js';
import { COVER } from './terrain.js';
import { createModel, createTower } from './models.js';
import { SKYSCRAPERS, LANDMARK_BEACONS, makeBeacons } from './skyscrapers.js';
import { keepVisible } from './markers.js';

const GRID_M = 170;
const CHUNK_M = 8_000;
const DRAW_DISTANCE_M = 30_000;

const DOWNTOWNS = [
  { lon: 139.7671, lat: 35.6812, peak: 190, radius: 1800 },
  { lon: 139.6917, lat: 35.6896, peak: 210, radius: 1500 },
  { lon: 139.7016, lat: 35.6580, peak: 150, radius: 1100 },
  { lon: 139.7600, lat: 35.6655, peak: 170, radius: 1200 },
  { lon: 139.7387, lat: 35.6605, peak: 160, radius: 1300 },
  { lon: 139.7392, lat: 35.6285, peak: 120, radius: 1200 },
  { lon: 139.6320, lat: 35.4570, peak: 150, radius: 1300 },
  { lon: 140.0400, lat: 35.6480, peak: 110, radius: 1300 },
  { lon: 139.7966, lat: 35.6282, peak: 70, radius: 1500 },
  { lon: 139.7120, lat: 35.7300, peak: 120, radius: 900 },
];

const COLORS = ['#ece4d8', '#d8d0c8', '#c8ccd4', '#f2e6d4', '#b8b0b8', '#e4dce8', '#d4c0b4', '#a8acb8', '#f0d8dc'].map((c) => new THREE.Color(c));
const LIGHT_COLORS = ['#ffae42', '#ffc870', '#ffe0a0', '#fff4e0', '#ffffff', '#ff9a50', '#ff5ec8', '#72f6ff'].map((c) => new THREE.Color(c));
const LIGHT_WEIGHTS = [0.24, 0.22, 0.18, 0.14, 0.08, 0.08, 0.03, 0.03];

const LANDMARKS = [
  { model: 'skytree', lon: 139.8107, lat: 35.7101, name: 'Tokyo Skytree', note: '634m broadcast tower, Sumida' },
  { model: 'tokyoTower', lon: 139.7454, lat: 35.6586, name: 'Tokyo Tower', note: '333m lattice tower, Minato' },
  { model: 'landmarkTower', lon: 139.6317, lat: 35.4546, name: 'Yokohama Landmark Tower', note: '296m, Minato Mirai' },
];

const SITES = [...LANDMARKS, ...SKYSCRAPERS].map((b) => toLocal(b.lon, b.lat, 0, {}));
const SITE_CLEAR_M = 130;
const nearSite = (x, z) => SITES.some((p) => Math.abs(p.x - x) < SITE_CLEAR_M && Math.abs(p.z - z) < SITE_CLEAR_M);

function hash(x, y, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function downtownBoost(lon, lat) {
  let best = 0;
  for (const d of DOWNTOWNS) {
    const dx = (lon - d.lon) * 90_000;
    const dy = (lat - d.lat) * 111_000;
    const k = d.peak * Math.exp(-Math.hypot(dx, dy) / d.radius);
    if (k > best) best = k;
  }
  return best;
}

export class City {
  constructor(terrain, keepClear = () => false) {
    this.terrain = terrain;
    this.keepClear = keepClear;
    this.group = new THREE.Group();
    this.chunks = [];
    this.landmarks = [];
  }

  build() {
    const material = gouraudMaterial({ vertexColors: false, building: true, specular: 0.08 });
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const steps = Math.floor((2 * INNER_HALF_M) / GRID_M);
    const buckets = new Map();
    const lightPos = [];
    const lightCol = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();

    for (let j = 0; j < steps; j++) {
      for (let i = 0; i < steps; i++) {
        const r = hash(i, j);
        if (r < 0.18) continue;
        const x = -INNER_HALF_M + (i + 0.5 + (hash(i, j, 1) - 0.5) * 0.4) * GRID_M;
        const z = -INNER_HALF_M + (j + 0.5 + (hash(i, j, 2) - 0.5) * 0.4) * GRID_M;
        if (hash(i, j, 9) > edgeFade(x, z)) continue;
        const { lon, lat } = toLonLat(x, z);
        if (this.terrain.coverAt(lon, lat) !== COVER.BUILT) continue;
        const ground = this.terrain.heightAt(x, z);
        if (ground < 0.5 || this.keepClear(x, z) || nearSite(x, z)) continue;

        const boost = downtownBoost(lon, lat);
        const tall = boost > 25;
        const h = tall
          ? 32 + hash(i, j, 3) * boost * 0.9
          : 11 + hash(i, j, 3) ** 2 * 42;
        const w = tall ? 28 + hash(i, j, 4) * 30 : 40 + hash(i, j, 4) * 70;
        const d = tall ? 28 + hash(i, j, 5) * 30 : 35 + hash(i, j, 5) * 60;

        p.set(x, ground, z);
        s.set(w, h, d);
        m.compose(p, q, s);
        const key = `${Math.floor((x + INNER_HALF_M) / CHUNK_M)},${Math.floor((z + INNER_HALF_M) / CHUNK_M)}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push([m.clone(), COLORS[Math.floor(hash(i, j, 6) * COLORS.length)]]);
        const lamps = 1 + Math.floor(hash(i, j, 7) * (tall ? 2.6 : 1.5));
        for (let n = 0; n < lamps; n++) {
          const a = hash(i, j, 10 + n);
          lightPos.push(x + (hash(i, j, 20 + n) - 0.5) * GRID_M, ground + 4 + (tall ? a * h : 0), z + (hash(i, j, 30 + n) - 0.5) * GRID_M);
          let pickc = a;
          let ci = 0;
          while (ci < LIGHT_WEIGHTS.length - 1 && pickc > LIGHT_WEIGHTS[ci]) { pickc -= LIGHT_WEIGHTS[ci]; ci++; }
          lightCol.push(LIGHT_COLORS[ci].r, LIGHT_COLORS[ci].g, LIGHT_COLORS[ci].b);
        }
      }
    }

    for (const [key, items] of buckets) {
      const mesh = new THREE.InstancedMesh(box, material, items.length);
      items.forEach(([matrix, color], k) => {
        mesh.setMatrixAt(k, matrix);
        mesh.setColorAt(k, color);
      });
      mesh.computeBoundingSphere();
      const [cx, cz] = key.split(',').map(Number);
      mesh.userData.center = new THREE.Vector3(
        -INNER_HALF_M + (cx + 0.5) * CHUNK_M, 0, -INNER_HALF_M + (cz + 0.5) * CHUNK_M,
      );
      this.chunks.push(mesh);
      this.group.add(mesh);
    }
    this.buildingCount = [...buckets.values()].reduce((n, b) => n + b.length, 0);
    SKYSCRAPERS.forEach((t, n) => {
      const { x, z } = toLocal(t.lon, t.lat, 0, {});
      const ground = this.terrain.heightAt(x, z);
      const rot = THREE.MathUtils.degToRad(t.rot);
      for (let k = 0; k < Math.round(t.h / 6); k++) {
        const along = (hash(n, k, 41) - 0.5) * 0.9;
        const side = hash(n, k, 42) < 0.5 ? -0.5 : 0.5;
        const [u, v] = hash(n, k, 43) < 0.5 ? [along * t.w, side * t.d] : [side * t.w, along * t.d];
        const y = ground + 15 + hash(n, k, 44) * (t.h * 0.85 - 15);
        lightPos.push(x + u * Math.cos(rot) + v * Math.sin(rot), y, z - u * Math.sin(rot) + v * Math.cos(rot));
        const c = LIGHT_COLORS[2 + Math.floor(hash(n, k, 45) * 3)];
        lightCol.push(c.r, c.g, c.b);
      }
    });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lightPos, 3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(lightCol, 3));
    this.lightMaterial = nightLightsMaterial({ size: 2.5, near: 3_000, far: 55_000, keep: 0.3 });
    this.lights = new THREE.Points(lg, this.lightMaterial);
    this.group.add(this.lights);

    for (const l of LANDMARKS) {
      const mesh = l.model === 'tokyoTower' ? createModel(l.model, { tint: 0xffffff }) : createModel(l.model);
      if (l.model === 'tokyoTower') this.floodlit = mesh.material;
      const pos = toLocal(l.lon, l.lat);
      mesh.position.set(pos.x, this.terrain.heightAt(pos.x, pos.z), pos.z);
      mesh.userData.info = { title: l.name, body: l.note };
      keepVisible(mesh, 300, 110, 5, 1.4);
      mesh.add(makeBeacons(LANDMARK_BEACONS[l.model], this.landmarks.length + 1));
      this.landmarks.push(mesh);
      this.group.add(mesh);
    }

    for (const t of SKYSCRAPERS) {
      const { mesh, beacons } = createTower(t);
      const pos = toLocal(t.lon, t.lat);
      mesh.position.set(pos.x, this.terrain.heightAt(pos.x, pos.z), pos.z);
      mesh.rotation.y = THREE.MathUtils.degToRad(t.rot);
      mesh.userData.info = { title: t.name, body: t.note };
      mesh.add(makeBeacons(beacons, this.landmarks.length + 1));
      this.landmarks.push(mesh);
      this.group.add(mesh);
    }
  }

  update(camera) {
    const reach = DRAW_DISTANCE_M + camera.position.y * 0.3;
    for (const chunk of this.chunks) {
      chunk.visible = chunk.userData.center.distanceTo(camera.position) < reach;
    }
    this.lightMaterial.uniforms.uOpacity.value = THREE.MathUtils.smoothstep(SHARED.uNight.value, 0.25, 0.75);
    if (this.floodlit) {
      const lit = THREE.MathUtils.smoothstep(SHARED.uNight.value, 0.2, 0.8);
      this.floodlit.uniforms.uSelfLit.value = 0.7 * lit;
    }
  }
}
