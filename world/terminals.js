import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { INNER_HALF_M, toLocal } from './geo.js';
import { gouraudMaterial } from './shading.js';
import { register, report } from './sources.js';

export class Terminals {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.count = 0;
  }

  async load() {
    register('terminals', 'Airport terminals', 'OpenStreetMap (bundled)');
    try {
      const { terminals } = await (await fetch('./data/terminals.json')).json();
      const parts = [];
      const p = { x: 0, y: 0, z: 0 };
      for (const t of terminals) {
        const pts = t.ring.map(([lon, lat]) => {
          toLocal(lon, lat, 0, p);
          return new THREE.Vector2(p.x, -p.z);
        });
        const cx = pts.reduce((s, v) => s + v.x, 0) / pts.length;
        const cz = -pts.reduce((s, v) => s + v.y, 0) / pts.length;
        if (Math.abs(cx) > INNER_HALF_M || Math.abs(cz) > INNER_HALF_M) continue;
        const ground = Math.max(this.terrain.heightAt(cx, cz), 0);
        const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: t.height, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, ground - 1, 0);
        parts.push(geo.toNonIndexed());
        this.count++;
      }
      if (parts.length) {
        const merged = mergeGeometries(parts.map((g) => {
          g.deleteAttribute('uv');
          return g;
        }));
        const mesh = new THREE.Mesh(merged, gouraudMaterial({ vertexColors: false, building: true, tint: 0xc4c8d2, specular: 0.25 }));
        this.group.add(mesh);
      }
      report('terminals', true, `${this.count} terminals`);
    } catch (e) {
      report('terminals', false, e.message);
    }
  }
}
