import * as THREE from 'three';
import { toLocal } from '../world/geo.js';
import { createModel } from '../world/models.js';
import { keepVisible, makeLabel, setInfo } from '../world/markers.js';
import { SHARED } from '../world/shading.js';

const SITES = [
  { name: 'Kannonzaki Lighthouse', label: 'KANNONZAKI', lon: 139.74523, lat: 35.25614, light: 'Fl W 15s 20M', colours: ['#fff4d6'], period: 15, tower: 19, keeper: true,
    note: "Japan's first Western-style lighthouse, built 1869, at the Uraga Channel entrance to Tokyo Bay." },
  { name: 'Jogashima Lighthouse', label: 'JOGASHIMA', lon: 139.61113, lat: 35.13508, light: 'Fl W 15s 16M', colours: ['#fff4d6'], period: 15, tower: 12,
    note: 'On Jogashima island off the tip of the Miura Peninsula, first lit in 1870.' },
  { name: 'Tsurugizaki Lighthouse', label: 'TSURUGIZAKI', lon: 139.67712, lat: 35.14131, light: 'Al.Fl G W 30s 17M', colours: ['#fff4d6', '#72f6a0'], period: 30, tower: 17,
    note: 'Cape Tsurugi on the Miura Peninsula, marking the west side of the Uraga Channel approach.' },
  { name: 'Sunosaki Lighthouse', label: 'SUNOSAKI', lon: 139.75751, lat: 34.97531, light: 'Al.Fl R W 30s 18M', colours: ['#fff4d6', '#ff4a3a'], period: 30, tower: 15,
    note: 'Southwest corner of the Boso Peninsula, facing Tsurugizaki across the mouth of Tokyo Bay.' },
  { name: 'Nojimazaki Lighthouse', label: 'NOJIMAZAKI', lon: 139.88839, lat: 34.90173, light: 'Fl W 15s 17M', colours: ['#fff4d6'], period: 15, tower: 29,
    note: 'At the southern tip of the Boso Peninsula, one of the eight lighthouses built under the 1866 treaty.' },
  { name: 'Katsuura Lighthouse', label: 'KATSUURA', lon: 140.31911, lat: 35.13798, light: 'Fl W 20s 22M', colours: ['#fff4d6'], period: 20, tower: 21,
    note: 'On the Pacific coast of the Boso Peninsula above Katsuura harbour.' },
  { name: 'Enoshima Sea Candle', label: 'ENOSHIMA', lon: 139.47847, lat: 35.29975, light: 'Fl W 10s 23M', colours: ['#fff4d6'], period: 10, tower: 60,
    note: 'Observation tower and working lighthouse on Enoshima island, Shonan coast.' },
];
const BEAM_LENGTH = 2600;
const BEAM_RADIUS = 85;
const BEAM_RANGE_M = 15_000;
const MODEL_HEIGHT_M = 20;

const BEAM_VERTEX = /* glsl */ `
  varying float vAlong;
  varying float vEdge;
  void main() {
    vAlong = uv.y;
    vEdge = abs(uv.x - 0.5) * 2.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BEAM_FRAGMENT = /* glsl */ `
  uniform float uIntensity;
  uniform vec3 uColour;
  varying float vAlong;
  varying float vEdge;
  void main() {
    float a = uIntensity * pow(vAlong, 1.6) * (1.0 - vEdge * vEdge * 0.6);
    gl_FragColor = vec4(uColour * a, 1.0);
  }
`;

let glowMap = null;
function glowTexture() {
  if (glowMap) return glowMap;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d').createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  const ctx = c.getContext('2d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glowMap = new THREE.CanvasTexture(c);
  glowMap.colorSpace = THREE.NoColorSpace;
  return glowMap;
}

const cone = new THREE.ConeGeometry(BEAM_RADIUS, BEAM_LENGTH, 20, 1, true);
cone.translate(0, -BEAM_LENGTH / 2, 0);
cone.rotateX(Math.PI / 2);

class Light {
  constructor(ctx, site) {
    this.site = site;
    const p = toLocal(site.lon, site.lat);
    this.base = new THREE.Vector3(p.x, Math.max(ctx.terrain.heightAt(p.x, p.z), 2), p.z);
    this.lampHeight = site.tower * 0.9;

    this.model = new THREE.Group();
    this.model.position.copy(this.base);
    const tower = createModel('lighthouse');
    tower.scale.setScalar(site.tower / MODEL_HEIGHT_M);
    this.model.add(tower);
    if (site.keeper) {
      const house = createModel('keeperHouse');
      house.position.set(9, 0, 6);
      this.model.add(house);
    }
    keepVisible(this.model, 30, 24, 6, 2);

    this.lamp = new THREE.Group();
    this.arms = site.colours.map((hex, i) => {
      const colour = new THREE.Color(hex);
      const material = new THREE.ShaderMaterial({
        vertexShader: BEAM_VERTEX,
        fragmentShader: BEAM_FRAGMENT,
        uniforms: { uIntensity: { value: 0 }, uColour: { value: colour } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const beam = new THREE.Mesh(cone, material);
      beam.rotation.order = 'YXZ';
      beam.rotation.y = -(i / site.colours.length) * Math.PI * 2;
      beam.rotation.x = 0.02;
      this.lamp.add(beam);
      return { beam, material, colour, offset: (i / site.colours.length) * Math.PI * 2 };
    });

    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, sizeAttenuation: false,
    }));
    this.lamp.add(this.glow);
    this.lamp.add(makeLabel(site.label, { className: 'label-sea', maxDistance: 30_000, offsetY: 0 }));
    setInfo(this.model, site.name, `${site.note}<br>Light: ${site.light}`);
    this.lamp.userData.info = this.model.userData.info;

    this.group = new THREE.Group();
    this.group.add(this.model, this.lamp);
    this._dir = new THREE.Vector3();
    this._toCam = new THREE.Vector3();
  }

  update(camera, time, night) {
    const scale = this.model.scale.x;
    this.lamp.position.set(this.base.x, this.base.y + this.lampHeight * scale, this.base.z);
    const angle = (time / this.site.period) * Math.PI * 2;
    this.lamp.rotation.y = -angle;

    const dist = this.lamp.position.distanceTo(camera.position);
    const near = 1 - THREE.MathUtils.smoothstep(dist, BEAM_RANGE_M * 0.6, BEAM_RANGE_M);
    this._toCam.subVectors(camera.position, this.lamp.position).setY(0).normalize();
    let flash = 0;
    let flashColour = this.arms[0].colour;
    for (const arm of this.arms) {
      arm.material.uniforms.uIntensity.value = 0.32 * night * near;
      arm.beam.visible = night > 0.12 && near > 0.02;
      arm.beam.scale.setScalar(Math.max(1, scale * 0.25));
      const a = angle + arm.offset;
      this._dir.set(Math.sin(a), 0, -Math.cos(a));
      const f = Math.pow(Math.max(0, this._dir.dot(this._toCam)), 60);
      if (f > flash) {
        flash = f;
        flashColour = arm.colour;
      }
    }
    const size = 0.008 + 0.05 * flash * (0.4 + 0.6 * night);
    this.glow.scale.set(size, size, 1);
    this.glow.material.color.copy(flashColour);
    this.glow.material.opacity = (0.25 + 0.75 * flash) * (0.5 + 0.5 * night);
  }
}

export class Lighthouse {
  constructor(ctx) {
    this.lights = SITES.map((s) => new Light(ctx, s));
    this.group = new THREE.Group();
    for (const l of this.lights) this.group.add(l.group);
  }

  update(camera, time) {
    const night = SHARED.uNight.value;
    for (const l of this.lights) l.update(camera, time, night);
  }
}
