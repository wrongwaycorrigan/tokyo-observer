import * as THREE from 'three';
import { onSettingsChange, register, report, settings } from '../world/sources.js';
import { toLocal } from '../world/geo.js';
import { airlinerGeometry, createAirliner } from '../world/models.js';
import { airlineOf } from './liveries.js';
import { SHARED } from '../world/shading.js';
import { forget, keepVisible, makeLabel, setInfo } from '../world/markers.js';

const REFRESH_MS = 5_000;
const RELAY_URL = './adsb.json';
let relayMissing = false;
const STALE_MS = 30_000;
const MAX_EXTRAPOLATE_S = 45;
const MIN_BLEND_S = 2;
const MAX_BLEND_S = 10;
const LOW_ALT = new THREE.Color('#72f6ff');
const HIGH_ALT = new THREE.Color('#ff5ec8');
const WHITE = new THREE.Color(0xffffff);

const LIGHTS = [
  [-17, -0.1, 4, 'nav', '#ff2020'],
  [17, -0.1, 4, 'nav', '#20ff40'],
  [0, 1, 19.4, 'nav', '#ffffff'],
  [-17.4, -0.1, 4.3, 'strobe', '#ffffff'],
  [17.4, -0.1, 4.3, 'strobe', '#ffffff'],
  [0, 2.4, 2, 'beacon', '#ff3020'],
  [0, -2.3, 2, 'beacon', '#ff3020'],
];
const lightColors = LIGHTS.map((l) => new THREE.Color(l[4]));

const ROTORCRAFT = /^(A109|A119|A129|A139|A149|A169|A189|ALO2|ALO3|AS32|AS3B|AS50|AS55|AS65|B06|B06T|B105|B212|B230|B222|B407|B412|B427|B429|B430|B47G|B505|BK17|EC20|EC25|EC30|EC35|EC45|EC55|EC75|EH10|EXPL|H125|H130|H135|H145|H155|H160|H175|H47|H500|H53|H53S|H60|H64|K126|KMAX|MD52|MD60|MI8|MI17|NH90|PUMA|R22|R44|R66|S61|S64|S76|S92|SUCO|TIGR|UH1|UH1Y|V22|V280|AH1)$/;
const isRotorcraft = (ac) => ac.category === 'A7' || ROTORCRAFT.test(ac.t ?? '');

const LIGHT_VERTEX = /* glsl */ `
  uniform float uNight;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = length(mv.xyz);
    float reach = mix(6000.0, 40000.0, uNight);
    float fade = 1.0 - smoothstep(reach * 0.3, reach, d);
    float glow = fade * mix(0.45, 1.0, uNight);
    vColor = color * glow;
    gl_PointSize = glow > 0.05 ? mix(1.0, d < 3000.0 ? 4.0 : 3.0, fade) : 0.0;
    gl_Position = projectionMatrix * mv;
  }
`;

const LIGHT_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  void main() {
    if (max(vColor.r, max(vColor.g, vColor.b)) < 0.02) discard;
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

let lightMaterial = null;

function makeLights() {
  lightMaterial ??= new THREE.ShaderMaterial({
    vertexShader: LIGHT_VERTEX,
    fragmentShader: LIGHT_FRAGMENT,
    uniforms: { uNight: SHARED.uNight },
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(LIGHTS.flatMap((l) => l.slice(0, 3)), 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(LIGHTS.length * 3), 3));
  return new THREE.Points(g, lightMaterial);
}

let group = null;
let timer = null;
const aircraft = new Map();

function upsert(ac) {
  const altFt = typeof ac.alt_baro === 'number' ? ac.alt_baro : 0;
  const fix = new THREE.Vector3().copy(toLocal(ac.lon, ac.lat, Math.max(altFt * 0.3048, 40)));
  const speed = (ac.gs ?? 0) * 0.5144;
  const track = ((ac.track ?? 0) * Math.PI) / 180;
  const climb = ((ac.baro_rate ?? 0) * 0.3048) / 60;
  const callsign = (ac.flight || ac.hex || '').trim();
  const tint = LOW_ALT.clone().lerp(HIGH_ALT, Math.min(1, altFt / 30_000));

  const age = Number.isFinite(ac.seen_pos) ? ac.seen_pos : 0;
  const now = performance.now();
  const vel = new THREE.Vector3(Math.sin(track) * speed, climb, -Math.cos(track) * speed);
  const predicted = fix.clone().addScaledVector(vel, Math.min(age, MAX_EXTRAPOLATE_S));

  let a = aircraft.get(ac.hex);
  if (a && a.fix && a.fix.equals(fix)) {
    a.lastUpdate = Date.now();
    return;
  }
  if (!a) {
    const obj = new THREE.Group();
    const livery = airlineOf(callsign);
    const mesh = createAirliner(livery, { tint: livery ? 0xffffff : tint.getHex() });
    obj.add(mesh);
    const label = makeLabel(callsign, { className: 'label-air', maxDistance: 40_000, offsetY: 22 });
    obj.add(label);
    const lights = makeLights();
    mesh.add(lights);
    keepVisible(obj, 40, 56, 800, 3);
    obj.position.copy(predicted);
    group.add(obj);
    a = { obj, mesh, label, lights, livery, phase: Math.random() * 1.3, offset: new THREE.Vector3(), blendStart: now, blendDur: 1 };
    aircraft.set(ac.hex, a);
  } else {
    a.offset.subVectors(a.obj.position, predicted);
    a.blendStart = now;
    a.blendDur = THREE.MathUtils.clamp(a.offset.length() / (0.5 * Math.max(speed, 20)), MIN_BLEND_S, MAX_BLEND_S);
  }
  a.fix = fix;
  a.fixTime = now - age * 1000;
  a.vel = vel;
  a.obj.rotation.set(0, -track, 0);
  a.mesh.rotation.x = Math.atan2(climb, Math.max(speed, 1)) * 0.6;
  if (!a.livery) {
    a.livery = airlineOf(callsign);
    if (a.livery) a.mesh.geometry = airlinerGeometry(a.livery);
  }
  a.mesh.material.uniforms.uTint.value.copy(a.livery ? WHITE : tint);
  a.label.element.textContent = `${callsign} ${Math.round(altFt / 100).toString().padStart(3, '0')}`;
  setInfo(a.obj, callsign || 'Unknown', `${a.livery ? `${a.livery.name}<br>` : ''}${ac.t ? `${ac.t}<br>` : ''}Altitude ${Math.round(altFt)} ft<br>Speed ${Math.round(ac.gs ?? 0)} kt<br>Track ${Math.round(ac.track ?? 0)}&deg;`);
  a.lastUpdate = Date.now();
}

function prune() {
  const now = Date.now();
  for (const [hex, a] of aircraft) {
    if (now - a.lastUpdate <= STALE_MS) continue;
    forget(a.obj);
    group.remove(a.obj);
    aircraft.delete(hex);
  }
}

async function refresh() {
  try {
    const relay = !settings.adsbUrl;
    if (relay && relayMissing) return;
    const res = await fetch(relay ? RELAY_URL : settings.adsbUrl, { cache: 'no-store' });
    if (!res.ok) {
      if (relay) {
        relayMissing = res.status === 404;
        report('adsb', null, 'no receiver URL (or run tools/serve.py)');
      } else {
        report('adsb', false, `HTTP ${res.status}`);
      }
      return;
    }
    report('adsb', true, relay ? 'adsb.lol via local relay' : '');
    const data = await res.json();
    for (const ac of data.aircraft ?? data.ac ?? []) {
      if (Number.isFinite(ac.lat) && Number.isFinite(ac.lon) && ac.hex && !isRotorcraft(ac)) upsert(ac);
    }
    prune();
  } catch (e) {
    report('adsb', false, e.message);
    console.warn('[Traffic] receiver unreachable (CORS, mixed content, or offline):', e.message);
  }
}

export function init(ctx) {
  register('adsb', 'Aircraft (ADS-B)', 'tar1090 / readsb aircraft.json');
  onSettingsChange(() => { relayMissing = false; if (group.visible) refresh(); });
  group = new THREE.Group();
  group.visible = false;
  ctx.scene.add(group);
  return group;
}

export function update() {
  if (!group.visible) return;
  const now = performance.now();
  for (const a of aircraft.values()) {
    const ahead = Math.min(MAX_EXTRAPOLATE_S, (now - a.fixTime) / 1000);
    const blend = 1 - THREE.MathUtils.smoothstep((now - a.blendStart) / 1000, 0, a.blendDur);
    a.obj.position.copy(a.fix).addScaledVector(a.vel, ahead).addScaledVector(a.offset, blend);
    const t = now / 1000 + a.phase;
    const strobe = t % 1.3 < 0.05 || (t % 1.3 > 0.16 && t % 1.3 < 0.21);
    const beacon = (t * 0.9) % 1 < 0.12;
    const col = a.lights.geometry.attributes.color.array;
    LIGHTS.forEach((l, k) => {
      const on = l[3] === 'nav' || (l[3] === 'strobe' && strobe) || (l[3] === 'beacon' && beacon);
      const c = lightColors[k];
      col[k * 3] = on ? c.r : 0;
      col[k * 3 + 1] = on ? c.g : 0;
      col[k * 3 + 2] = on ? c.b : 0;
    });
    a.lights.geometry.attributes.color.needsUpdate = true;
  }
}

export function setEnabled(on) {
  group.visible = on;
  if (on) {
    refresh();
    timer ??= setInterval(refresh, REFRESH_MS);
  } else {
    clearInterval(timer);
    timer = null;
  }
}

const _p = new THREE.Vector3();
export function pickNear(camera, ndc, maxPx, width, height) {
  if (!group.visible) return null;
  let best = null;
  let bestD = maxPx;
  for (const a of aircraft.values()) {
    _p.copy(a.obj.position).project(camera);
    if (_p.z < -1 || _p.z > 1) continue;
    const d = Math.hypot(((_p.x - ndc.x) * width) / 2, ((_p.y - ndc.y) * height) / 2);
    if (d < bestD) { bestD = d; best = a.obj; }
  }
  return best;
}

export function getCount() {
  return aircraft.size;
}
