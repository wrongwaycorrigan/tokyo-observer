import * as THREE from 'three';
import { toLocal } from '../world/geo.js';
import { createModel } from '../world/models.js';
import { keepVisible, makeLabel, setInfo } from '../world/markers.js';
import { SHARED } from '../world/shading.js';

const SITE = { name: 'Kannonzaki Lighthouse', lon: 139.74522, lat: 35.25615, period: 15, lampHeight: 17.2 };
const BEAM_LENGTH = 2600;
const BEAM_RADIUS = 85;

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
  varying float vAlong;
  varying float vEdge;
  void main() {
    float a = uIntensity * pow(vAlong, 1.6) * (1.0 - vEdge * vEdge * 0.6);
    gl_FragColor = vec4(vec3(1.0, 0.96, 0.82) * a, 1.0);
  }
`;

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d').createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,240,1)');
  g.addColorStop(0.25, 'rgba(255,240,200,0.8)');
  g.addColorStop(1, 'rgba(255,200,240,0)');
  const ctx = c.getContext('2d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export class Lighthouse {
  constructor(ctx) {
    const p = toLocal(SITE.lon, SITE.lat);
    this.base = new THREE.Vector3(p.x, Math.max(ctx.terrain.heightAt(p.x, p.z), 2), p.z);

    this.model = new THREE.Group();
    this.model.position.copy(this.base);
    this.model.add(createModel('lighthouse'));
    const house = createModel('keeperHouse');
    house.position.set(9, 0, 6);
    this.model.add(house);
    keepVisible(this.model, 30, 24, 6, 2);

    this.lamp = new THREE.Group();
    this.beamMaterial = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERTEX,
      fragmentShader: BEAM_FRAGMENT,
      uniforms: { uIntensity: { value: 0.5 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const cone = new THREE.ConeGeometry(BEAM_RADIUS, BEAM_LENGTH, 20, 1, true);
    cone.translate(0, -BEAM_LENGTH / 2, 0);
    cone.rotateX(Math.PI / 2);
    this.beam = new THREE.Mesh(cone, this.beamMaterial);
    this.beam.rotation.x = 0.02;
    this.lamp.add(this.beam);

    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, sizeAttenuation: false,
    }));
    this.lamp.add(this.glow);
    this.lamp.add(makeLabel('KANNONZAKI', { className: 'label-sea', maxDistance: 40_000, offsetY: 0 }));
    setInfo(this.model, SITE.name, "Japan's first Western-style lighthouse, built 1869, at the Uraga Channel entrance to Tokyo Bay.<br>Light: Fl W 15s 20M (one white flash every 15 seconds, 20 nautical mile range)");
    this.lamp.userData.info = this.model.userData.info;

    this.group = new THREE.Group();
    this.group.add(this.model, this.lamp);
    this._dir = new THREE.Vector3();
    this._toCam = new THREE.Vector3();
  }

  update(camera, time) {
    const scale = this.model.scale.x;
    this.lamp.position.set(this.base.x, this.base.y + SITE.lampHeight * scale, this.base.z);
    const angle = (time / SITE.period) * Math.PI * 2;
    this.lamp.rotation.y = -angle;

    const night = SHARED.uNight.value;
    this.beamMaterial.uniforms.uIntensity.value = 0.38 * night;
    this.beam.visible = night > 0.12;
    this.beam.scale.setScalar(Math.max(1, scale * 0.25));

    this._dir.set(Math.sin(angle), 0, -Math.cos(angle));
    this._toCam.subVectors(camera.position, this.lamp.position).setY(0).normalize();
    const flash = Math.pow(Math.max(0, this._dir.dot(this._toCam)), 60);
    const size = 0.012 + 0.07 * flash * (0.4 + 0.6 * night);
    this.glow.scale.set(size, size, 1);
    this.glow.material.opacity = 0.35 + 0.65 * flash;
  }
}
