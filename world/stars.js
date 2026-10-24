import * as THREE from 'three';
import { CENTER } from './geo.js';
import { SHARED } from './shading.js';

const DEG = Math.PI / 180;
const RADIUS = 450_000;
const J2000_MS = Date.UTC(2000, 0, 1, 12);
const BV_STOPS = [
  [-0.3, [0.62, 0.74, 1.0]],
  [0.0, [0.8, 0.88, 1.0]],
  [0.4, [1.0, 1.0, 0.96]],
  [0.8, [1.0, 0.92, 0.76]],
  [1.2, [1.0, 0.78, 0.55]],
  [1.8, [1.0, 0.6, 0.4]],
];

const VERTEX = /* glsl */ `
  attribute float aMag;
  attribute vec3 aColor;
  uniform float uNight;
  uniform float uOvercast;
  varying vec3 vColor;
  varying float vSize;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec3 dir = normalize(wp.xyz - cameraPosition);
    float fade = uNight * (1.0 - uOvercast) * smoothstep(0.0, 0.12, dir.y) * (1.0 - smoothstep(4.0, 5.5, aMag + uOvercast * 3.0));
    float bright = clamp(1.3 - aMag * 0.2, 0.25, 1.5);
    vColor = aColor * bright * fade;
    vSize = aMag < 0.6 ? 3.0 : aMag < 2.2 ? 2.0 : 1.0;
    gl_PointSize = fade > 0.02 ? vSize : 0.0;
    gl_Position = (projectionMatrix * viewMatrix * wp).xyww;
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vSize;
  void main() {
    if (vSize > 2.5) {
      vec2 q = abs(gl_PointCoord - 0.5);
      if (q.x > 0.2 && q.y > 0.2) discard;
    }
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

function bvColor(bv) {
  if (bv <= BV_STOPS[0][0]) return BV_STOPS[0][1];
  for (let i = 1; i < BV_STOPS.length; i++) {
    const [b1, c1] = BV_STOPS[i];
    if (bv <= b1) {
      const [b0, c0] = BV_STOPS[i - 1];
      const t = (bv - b0) / (b1 - b0);
      return c0.map((v, k) => v + (c1[k] - v) * t);
    }
  }
  return BV_STOPS[BV_STOPS.length - 1][1];
}

function precess(ra, dec, years) {
  const r = ra * DEG;
  const d = Math.min(Math.abs(dec), 89.9) * Math.sign(dec) * DEG;
  return [
    ra + (years * (46.1 + 20.04 * Math.sin(r) * Math.tan(d))) / 3600,
    dec + (years * 20.04 * Math.cos(r)) / 3600,
  ];
}

export class Stars {
  constructor(sky, lat = CENTER.lat, lon = CENTER.lon) {
    this.sky = sky;
    this.lon = lon;
    this.uniforms = { uNight: SHARED.uNight, uOvercast: sky.uniforms.uOvercast };
    this.points = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.points.frustumCulled = false;
    this.points.matrixAutoUpdate = false;
    this.points.renderOrder = -1;
    this.points.visible = false;
    const la = lat * DEG;
    this.basis = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, Math.cos(la), Math.sin(la)),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, Math.sin(la), -Math.cos(la)),
    );
    this._spin = new THREE.Matrix4();
    this._scale = new THREE.Matrix4().makeScale(RADIUS, RADIUS, RADIUS);
    this.load();
  }

  async load() {
    try {
      const { stars } = await (await fetch('./data/stars.json')).json();
      const years = (this.sky.now().getTime() - J2000_MS) / (365.25 * 86_400_000);
      const pos = new Float32Array(stars.length * 3);
      const col = new Float32Array(stars.length * 3);
      const mag = new Float32Array(stars.length);
      stars.forEach(([ra0, dec0, m, bv], i) => {
        const [ra, dec] = precess(ra0, dec0, years);
        const r = ra * DEG; const d = dec * DEG;
        pos.set([Math.cos(d) * Math.cos(r), Math.cos(d) * Math.sin(r), Math.sin(d)], i * 3);
        col.set(bvColor(bv), i * 3);
        mag[i] = m;
      });
      const g = this.points.geometry;
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
      this.points.visible = true;
    } catch (err) {
      console.warn('[Stars] catalogue unavailable', err);
    }
  }

  update(camera) {
    if (!this.points.visible) return;
    const d = this.sky.now().getTime() / 86_400_000 - 10957.5;
    const lst = ((18.697374558 + 24.06570982441908 * d) * 15 + this.lon) * DEG;
    this._spin.makeRotationZ(-lst);
    this.points.matrix.makeTranslation(camera.position.x, camera.position.y, camera.position.z)
      .multiply(this.basis).multiply(this._spin).multiply(this._scale);
    this.points.matrixWorld.copy(this.points.matrix);
  }
}
