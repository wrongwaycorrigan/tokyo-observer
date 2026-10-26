import * as THREE from 'three';
import { INNER_HALF_M, toLocal } from './geo.js';
import { gouraudMaterial } from './shading.js';
import { createModel } from './models.js';
import { makeBeacons } from './skyscrapers.js';
import { register, report } from './sources.js';

const WAREHOUSE_COLORS = ['#c8ccd4', '#d8d0c8', '#a8b4c8', '#c0b4a8', '#b8c4c0', '#d0c8d8'].map((c) => new THREE.Color(c));
const FERRY_COLOR = new THREE.Color('#e8e0f4');
const SHORE_PROBE_M = 350;
const CLEAR_MARGIN_M = 25;
const GRID_M = 500;
const CRANE_SPACING_M = 110;
const CRANE_SETBACK_M = 14;
const TERMINALS = [
  { name: 'Oi Container Terminal', lat: 35.5900, lon: 139.7730, cranes: 8 },
  { name: 'Aomi Container Terminal', lat: 35.6145, lon: 139.7705, cranes: 5 },
  { name: 'Shinagawa Container Terminal', lat: 35.6175, lon: 139.7560, cranes: 3 },
  { name: 'Honmoku Pier', lat: 35.4275, lon: 139.6755, cranes: 6 },
  { name: 'Minami-Honmoku Pier', lat: 35.3980, lon: 139.6785, cranes: 6 },
  { name: 'Daikoku Pier', lat: 35.4640, lon: 139.6930, cranes: 5 },
  { name: 'Kawasaki Container Terminal', lat: 35.4840, lon: 139.7580, cranes: 3 },
  { name: 'Chiba Central Port', lat: 35.5900, lon: 140.0950, cranes: 3 },
];

export class Port {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.cranes = [];
    this.grid = new Map();
    this.count = 0;
  }

  covers(x, z) {
    const cell = this.grid.get(`${Math.floor(x / GRID_M)},${Math.floor(z / GRID_M)}`);
    if (!cell) return false;
    for (const r of cell) {
      const dx = x - r.x;
      const dz = z - r.z;
      if (Math.abs(dx * r.c + dz * r.s) < r.hw && Math.abs(-dx * r.s + dz * r.c) < r.hd) return true;
    }
    return false;
  }

  _clear(x, z, w, d, rot) {
    const r = { x, z, c: Math.cos(rot), s: Math.sin(rot), hw: w / 2 + CLEAR_MARGIN_M, hd: d / 2 + CLEAR_MARGIN_M };
    const reach = Math.hypot(r.hw, r.hd);
    for (let gx = Math.floor((x - reach) / GRID_M); gx <= Math.floor((x + reach) / GRID_M); gx++) {
      for (let gz = Math.floor((z - reach) / GRID_M); gz <= Math.floor((z + reach) / GRID_M); gz++) {
        const key = `${gx},${gz}`;
        if (!this.grid.has(key)) this.grid.set(key, []);
        this.grid.get(key).push(r);
      }
    }
  }

  _waterfront(x, z) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (this.terrain.heightAt(x + Math.cos(a) * SHORE_PROBE_M, z + Math.sin(a) * SHORE_PROBE_M) < 0) return true;
    }
    return false;
  }

  async load() {
    register('port', 'Port buildings', 'OpenStreetMap (bundled)');
    try {
      const { buildings } = await (await fetch('./data/port_buildings.json')).json();
      const keep = [];
      const p = { x: 0, y: 0, z: 0 };
      for (const [lon, lat, w, d, rot, h, ferry] of buildings) {
        toLocal(lon, lat, 0, p);
        if (Math.abs(p.x) > INNER_HALF_M || Math.abs(p.z) > INNER_HALF_M) continue;
        if (!ferry && !this._waterfront(p.x, p.z)) continue;
        keep.push({ x: p.x, z: p.z, w, d, rot: THREE.MathUtils.degToRad(rot), h, ferry });
      }
      const mesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
        gouraudMaterial({ vertexColors: false, specular: 0.15 }),
        keep.length,
      );
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      keep.forEach((b, i) => {
        const ground = Math.max(this.terrain.heightAt(b.x, b.z), 0);
        m.compose(new THREE.Vector3(b.x, ground - 1, b.z), q.setFromAxisAngle(up, b.rot), new THREE.Vector3(b.w, b.h + 1, b.d));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, b.ferry ? FERRY_COLOR : WAREHOUSE_COLORS[i % WAREHOUSE_COLORS.length]);
        this._clear(b.x, b.z, b.w, b.d, -b.rot);
      });
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      this.count = keep.length;
      this._placeCranes();
      report('port', true, `${this.count} buildings, ${this.cranes.length} cranes`);
    } catch (e) {
      report('port', false, e.message);
    }
  }

  _coastNear(x, z, radius, step) {
    let best = null;
    let bestD = Infinity;
    for (let dz = -radius; dz <= radius; dz += step) {
      for (let dx = -radius; dx <= radius; dx += step) {
        const dd = dx * dx + dz * dz;
        if (dd >= bestD || this.terrain.heightAt(x + dx, z + dz) <= 0.5) continue;
        for (const [ox, oz] of [[30, 0], [-30, 0], [0, 30], [0, -30]]) {
          if (this.terrain.heightAt(x + dx + ox, z + dz + oz) < 0) {
            bestD = dd;
            best = new THREE.Vector2(x + dx, z + dz);
            break;
          }
        }
      }
    }
    return best;
  }

  _seaward(x, z, probe) {
    const n = new THREE.Vector2();
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      if (this.terrain.heightAt(x + dx * probe, z + dz * probe) < 0) n.add(new THREE.Vector2(dx, dz));
    }
    return n.lengthSq() > 0 ? n.normalize() : null;
  }

  _placeCranes() {
    TERMINALS.forEach((t, ti) => {
      const p = toLocal(t.lon, t.lat);
      const start = this._coastNear(p.x, p.z, 2500, 50);
      if (!start) return;
      const n0 = this._seaward(start.x, start.y, 200);
      if (!n0) return;
      const tangent = new THREE.Vector2(-n0.y, n0.x);
      const placed = [];
      for (let k = 0; k < t.cranes * 2 && placed.length < t.cranes; k++) {
        const s = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * CRANE_SPACING_M;
        const spot = this._coastNear(start.x + tangent.x * s, start.y + tangent.y * s, 300, 20);
        if (!spot || placed.some((q) => q.distanceTo(spot) < CRANE_SPACING_M * 0.7)) continue;
        const n = this._seaward(spot.x, spot.y, 70);
        if (!n) continue;
        placed.push(spot);
        const x = spot.x - n.x * CRANE_SETBACK_M;
        const z = spot.y - n.y * CRANE_SETBACK_M;
        const crane = createModel('gantryCrane');
        crane.position.set(x, Math.max(this.terrain.heightAt(x, z), 0), z);
        crane.rotation.y = Math.atan2(-n.x, -n.y);
        crane.add(makeBeacons([[0, 73, 2], [0, 52, -55]], ti * 31 + k + 7));
        crane.userData.info = { title: t.name, body: 'Ship-to-shore container gantry crane.' };
        this._clear(x, z, 40, 40, 0);
        this.group.add(crane);
        this.cranes.push(crane);
      }
    });
  }
}
