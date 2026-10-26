import * as THREE from 'three';
import { CENTER } from './geo.js';
import { SHARED } from './shading.js';

const DEG = Math.PI / 180;

export function sunPosition(date = new Date(), lat = CENTER.lat, lon = CENTER.lon) {
  const d = date.getTime() / 86_400_000 - 10957.5;
  const g = (357.529 + 0.98560028 * d) * DEG;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const e = (23.439 - 0.00000036 * d) * DEG;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const ha = ((gmst * 15 + lon) * DEG) - ra;
  const la = lat * DEG;
  const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(ha));
  return { elevation: el / DEG, azimuth: ((az / DEG) + 360) % 360 };
}

const VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSunPos;
  uniform float uNight;
  uniform float uOvercast;
  varying vec3 vDir;

  void main() {
    vec3 d = normalize(vDir);
    float h = max(d.y, 0.0);
    vec3 c = mix(uHorizon, uZenith, pow(h, 0.5));
    c += vec3(0.25, 0.05, 0.2) * pow(1.0 - h, 8.0) * (1.0 - uOvercast) * (0.3 + 0.7 * uNight);
    if (d.y < 0.0) c = uHorizon * 0.8;

    vec3 s = normalize(uSunPos);
    vec3 right = normalize(cross(s, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, s);
    vec3 rel = d - s * dot(d, s);
    float r = 0.075;
    vec2 p = vec2(dot(rel, right), dot(rel, up)) / r;
    float disc = step(length(p), 1.0) * step(0.0, dot(d, s));
    float gap = p.y < 0.15 ? step(fract((p.y + 1.0) * 4.5), 0.25 + (0.15 - p.y) * 0.35) : 0.0;
    vec3 sunCol = mix(vec3(1.0, 0.25, 0.65), vec3(1.0, 0.92, 0.35), clamp(p.y * 0.5 + 0.5, 0.0, 1.0));
    float vis = disc * (1.0 - gap) * (1.0 - uOvercast * 0.85) * step(-0.02, d.y);
    c = mix(c, sunCol, vis);
    float glow = pow(max(dot(d, s), 0.0), 30.0) * 0.35 * (1.0 - uOvercast);
    c += vec3(1.0, 0.45, 0.7) * glow;

    gl_FragColor = vec4(c, 1.0);
  }
`;

const KEYS = [
  [-18, '#0a0420', '#2a0f4a', '#4a3a9a', '#2c2050'],
  [-6, '#16083c', '#7a2a8a', '#6a4aaa', '#3c2c60'],
  [0, '#3a1a7a', '#ff4a9a', '#ff7aa0', '#7a5088'],
  [8, '#4a3aa8', '#ffa07a', '#e8a474', '#5e4c70'],
  [25, '#5a8ae0', '#ffc0e0', '#ddd0c4', '#565878'],
  [90, '#4a90f0', '#f0d0f4', '#ece6de', '#62668a'],
];
const KEY_COLORS = KEYS.map(([e, ...cs]) => [e, ...cs.map((c) => new THREE.Color(c))]);
const OVERCAST_SKY = new THREE.Color('#a89cb8');

function lerpKeys(elev, idx, out) {
  if (elev <= KEY_COLORS[0][0]) return out.copy(KEY_COLORS[0][idx]);
  for (let i = 1; i < KEY_COLORS.length; i++) {
    if (elev <= KEY_COLORS[i][0]) {
      const [e0] = KEY_COLORS[i - 1];
      const [e1] = KEY_COLORS[i];
      return out.copy(KEY_COLORS[i - 1][idx]).lerp(KEY_COLORS[i][idx], (elev - e0) / (e1 - e0));
    }
  }
  return out.copy(KEY_COLORS[KEY_COLORS.length - 1][idx]);
}

export class Sky {
  constructor() {
    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunPos: { value: new THREE.Vector3(0, 1, 0) },
      uNight: SHARED.uNight,
      uOvercast: { value: 0 },
    };
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(500_000, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -2;
    this.overcast = 0;
    this.flash = 0;
    this.timeOffsetH = 0;
    this.sun = sunPosition();
    this._tmp = new THREE.Color();
  }

  now() {
    return new Date(Date.now() + this.timeOffsetH * 3_600_000);
  }

  update(camera, dt) {
    this.mesh.position.copy(camera.position);
    this.sun = sunPosition(this.now());
    const { elevation, azimuth } = this.sun;
    const oc = this.overcast;

    const sel = elevation * DEG; const saz = azimuth * DEG;
    this.uniforms.uSunPos.value.set(Math.sin(saz) * Math.cos(sel), Math.sin(sel), -Math.cos(saz) * Math.cos(sel));

    lerpKeys(elevation, 1, this.uniforms.uZenith.value);
    lerpKeys(elevation, 2, this.uniforms.uHorizon.value);
    const daylight = THREE.MathUtils.smoothstep(elevation, -8, 10);
    this._tmp.copy(OVERCAST_SKY).multiplyScalar(0.25 + 0.75 * daylight);
    this.uniforms.uZenith.value.lerp(this._tmp, oc * 0.8);
    this.uniforms.uHorizon.value.lerp(this._tmp, oc * 0.65);
    this.uniforms.uOvercast.value = oc;

    const lightEl = elevation > -2 ? Math.max(elevation, 3) : 35;
    const lightAz = elevation > -2 ? azimuth : 200;
    const el = lightEl * DEG; const az = lightAz * DEG;
    SHARED.uSunDir.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();

    lerpKeys(elevation, 3, SHARED.uSunColor.value).multiplyScalar(1 - oc * 0.55);
    lerpKeys(elevation, 4, SHARED.uAmbient.value).lerp(this._tmp.set(0.44, 0.42, 0.52).multiplyScalar(0.3 + 0.7 * daylight), oc * 0.5);

    this.flash = Math.max(0, this.flash - dt * 6);
    if (this.flash > 0) {
      SHARED.uAmbient.value.addScalar(this.flash * 0.8);
      this.uniforms.uZenith.value.addScalar(this.flash * 0.6);
      this.uniforms.uHorizon.value.addScalar(this.flash * 0.6);
    }

    SHARED.uNight.value = 1 - daylight;
    SHARED.uFogColor.value.copy(this.uniforms.uHorizon.value).lerp(this.uniforms.uZenith.value, 0.4 * daylight);
  }
}
