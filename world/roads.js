import * as THREE from 'three';
import { INNER_HALF_M, edgeFade, toLocal } from './geo.js';
import { SHARED, nightLightsMaterial } from './shading.js';
import { register, report } from './sources.js';

const CARS = 6000;
const LAMP_SPACING_M = [140, 180, 240];
const ROAD_LIFT_M = [14, 6, 4];
const PAINT = [
  { width: 3, color: '#4a4a4e' },
  { width: 2.2, color: '#58585c' },
  { width: 1.5, color: '#66666a' },
];
const SPEED = [[140, 220], [90, 150], [60, 110]];
const DAY_CAR_COLORS = ['#ffffff', '#e8e4ec', '#ff6a8a', '#72c8ff', '#ffe27a', '#bcbcc4', '#2a2a34'].map((c) => new THREE.Color(c));
const HEAD = new THREE.Color('#fff6e0');
const TAIL = new THREE.Color('#ff3030');
const LAMP = new THREE.Color('#ffb860');

const CAR_VERTEX = /* glsl */ `
  uniform float uSize;
  uniform float uNight;
  uniform float uFogNear;
  uniform float uFogFar;
  attribute float aSeed;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vFog;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = length(mv.xyz);
    float day = 1.0 - smoothstep(0.2, 0.7, uNight);
    float share = mix(1.0, 0.4, smoothstep(2500.0, 25000.0, d));
    float fade = mix(1.0, step(aSeed, share) * mix(1.0, 0.75, smoothstep(2500.0, 25000.0, d)), day);
    float shrink = mix(1.0, 1.0 - smoothstep(1500.0, 6000.0, d), day);
    vColor = color;
    vAlpha = fade;
    vFog = smoothstep(uFogNear, uFogFar, d);
    gl_PointSize = fade > 0.02 ? max(2.0, uSize * shrink) : 0.0;
    gl_Position = projectionMatrix * mv;
  }
`;

const CAR_FRAGMENT = /* glsl */ `
  uniform vec3 uFogColor;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vFog;
  void main() {
    if (vAlpha < 0.02) discard;
    gl_FragColor = vec4(mix(vColor, uFogColor, vFog), vAlpha);
  }
`;

function pointMaterial(size) {
  return new THREE.ShaderMaterial({
    vertexShader: CAR_VERTEX,
    fragmentShader: CAR_FRAGMENT,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uSize: { value: size },
      uNight: SHARED.uNight,
      uFogColor: SHARED.uFogColor,
      uFogNear: SHARED.uFogNear,
      uFogFar: SHARED.uFogFar,
    },
  });
}

export class Roads {
  constructor(terrain, keepClear = () => false) {
    this.terrain = terrain;
    this.keepClear = keepClear;
    this.group = new THREE.Group();
    this.roads = [];
    this.cars = [];
  }

  async load() {
    register('roads', 'Roads', 'OpenStreetMap (bundled)');
    const res = await fetch('./data/roads.json');
    const data = await res.json();
    report('roads', true, 'bundled');
    const p = { x: 0, y: 0, z: 0 };
    for (const flat of data.roads) {
      const cls = flat[0];
      let pts = [];
      for (let i = 1; i <= flat.length; i += 2) {
        const end = i >= flat.length;
        if (!end) toLocal(flat[i], flat[i + 1], 0, p);
        if (end || Math.abs(p.x) > INNER_HALF_M || Math.abs(p.z) > INNER_HALF_M || this.keepClear(p.x, p.z)) {
          this._addRoad(cls, pts);
          pts = [];
          continue;
        }
        pts.push(new THREE.Vector3(p.x, Math.max(this.terrain.heightAt(p.x, p.z), 0) + ROAD_LIFT_M[cls], p.z));
      }
    }
    this._paint();
    this._lamps();
    this._traffic();
  }

  _addRoad(cls, pts) {
    if (pts.length < 2) return;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    if (cum[cum.length - 1] < 50) return;
    this.roads.push({ cls, pts, cum, length: cum[cum.length - 1] });
  }

  _paint() {
    const tex = this.terrain.inner.texture;
    const canvas = tex.image;
    const ctx = canvas.getContext('2d');
    const k = canvas.width / (2 * INNER_HALF_M);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const cls of [2, 1, 0]) {
      ctx.strokeStyle = PAINT[cls].color;
      ctx.lineWidth = PAINT[cls].width;
      ctx.beginPath();
      for (const r of this.roads) {
        if (r.cls !== cls) continue;
        r.pts.forEach((q, i) => {
          const x = (q.x + INNER_HALF_M) * k;
          const y = (q.z + INNER_HALF_M) * k;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
      }
      ctx.stroke();
    }
    tex.needsUpdate = true;
  }

  _lamps() {
    const pos = [];
    const col = [];
    const v = new THREE.Vector3();
    for (const r of this.roads) {
      const step = LAMP_SPACING_M[r.cls];
      for (let s = step / 2; s < r.length; s += step) {
        this._at(r, s, v);
        if (Math.random() > edgeFade(v.x, v.z)) continue;
        pos.push(v.x, v.y + 3, v.z);
        col.push(LAMP.r, LAMP.g, LAMP.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.lampMaterial = nightLightsMaterial({ size: 2, near: 2_000, far: 45_000, keep: 0.45 });
    this.lamps = new THREE.Points(g, this.lampMaterial);
    this.group.add(this.lamps);
  }

  _traffic() {
    const weights = this.roads.map((r) => r.length * [3, 1.6, 1][r.cls]);
    const total = weights.reduce((a, b) => a + b, 0);
    const pick = () => {
      let t = Math.random() * total;
      for (let i = 0; i < weights.length; i++) {
        t -= weights[i];
        if (t <= 0) return i;
      }
      return weights.length - 1;
    };
    for (let i = 0; i < CARS; i++) {
      const ri = pick();
      const r = this.roads[ri];
      const [lo, hi] = SPEED[r.cls];
      this.cars.push({
        road: ri,
        s: Math.random() * r.length,
        speed: lo + Math.random() * (hi - lo),
        dir: Math.random() < 0.5 ? 1 : -1,
        day: DAY_CAR_COLORS[Math.floor(Math.random() * DAY_CAR_COLORS.length)],
        seg: 0,
      });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CARS * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(CARS * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(Float32Array.from({ length: CARS }, () => Math.random()), 1));
    this.carMaterial = pointMaterial(3);
    this.traffic = new THREE.Points(g, this.carMaterial);
    this.traffic.frustumCulled = false;
    this.group.add(this.traffic);
    this._v = new THREE.Vector3();
    this._d = new THREE.Vector3();
  }

  _at(r, s, out, car) {
    let i = car ? car.seg : 0;
    while (i < r.cum.length - 2 && r.cum[i + 1] < s) i++;
    while (i > 0 && r.cum[i] > s) i--;
    if (car) car.seg = i;
    const t = (s - r.cum[i]) / Math.max(1e-6, r.cum[i + 1] - r.cum[i]);
    return out.lerpVectors(r.pts[i], r.pts[i + 1], t);
  }

  update(dt) {
    if (!this.traffic) return;
    const night = SHARED.uNight.value;
    this.lampMaterial.uniforms.uOpacity.value = THREE.MathUtils.smoothstep(night, 0.3, 0.8);
    const pos = this.traffic.geometry.attributes.position.array;
    const col = this.traffic.geometry.attributes.color.array;
    const v = this._v;
    const d = this._d;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      const r = this.roads[c.road];
      c.s += c.speed * c.dir * dt;
      if (c.s > r.length) c.s -= r.length;
      if (c.s < 0) c.s += r.length;
      this._at(r, c.s, v, c);
      d.subVectors(r.pts[c.seg + 1], r.pts[c.seg]).normalize();
      const side = c.dir * 9;
      pos[i * 3] = v.x - d.z * side;
      pos[i * 3 + 1] = v.y + 1;
      pos[i * 3 + 2] = v.z + d.x * side;
      const lit = c.dir > 0 ? HEAD : TAIL;
      col[i * 3] = THREE.MathUtils.lerp(c.day.r, lit.r, night);
      col[i * 3 + 1] = THREE.MathUtils.lerp(c.day.g, lit.g, night);
      col[i * 3 + 2] = THREE.MathUtils.lerp(c.day.b, lit.b, night);
    }
    this.traffic.geometry.attributes.position.needsUpdate = true;
    this.traffic.geometry.attributes.color.needsUpdate = true;
  }
}
