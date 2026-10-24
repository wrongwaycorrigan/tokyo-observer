import * as THREE from 'three';
import { SHARED } from './shading.js';

const TEX_W = 64;
const TEX_H = 128;
const STREAKS = 26;
const CYCLE_SPEED = 1.6;

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying float vDist;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D map;
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uC0;
  uniform vec3 uC1;
  uniform vec3 uC2;
  uniform vec3 uC3;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec2 vUv;
  varying float vDist;

  void main() {
    vec4 t = texture2D(map, vUv * vec2(10.0, 3.0));
    if (t.g < 0.5) discard;
    float slot = floor(fract(t.r - uTime) * 4.0);
    vec3 c = slot < 1.0 ? uC0 : slot < 2.0 ? uC1 : slot < 3.0 ? uC2 : uC3;
    float fade = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.9, 1.0, vUv.y));
    float a = uOpacity * fade * (slot < 1.0 ? 1.0 : slot < 2.0 ? 0.7 : 0.4);
    float fog = smoothstep(uFogNear, uFogFar, vDist);
    gl_FragColor = vec4(mix(c, uFogColor, fog), a * (1.0 - fog * 0.7));
  }
`;

function streakTexture() {
  const data = new Uint8Array(TEX_W * TEX_H * 4);
  for (let s = 0; s < STREAKS; s++) {
    const x0 = Math.random() * TEX_W;
    const offset = Math.random();
    const top = Math.floor(Math.random() * TEX_H * 0.3);
    for (let y = top; y < TEX_H; y++) {
      const x = Math.floor(x0 - (y / TEX_H) * 6 + TEX_W) % TEX_W;
      const i = ((TEX_H - 1 - y) * TEX_W + x) * 4;
      data[i] = Math.floor(((y / 24 + offset) % 1) * 255);
      data[i + 1] = 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, TEX_W, TEX_H, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

const texture = streakTexture();
const shafts = new Set();
const material = new THREE.ShaderMaterial({
  vertexShader: VERTEX,
  fragmentShader: FRAGMENT,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  uniforms: {
    map: { value: texture },
    uTime: { value: 0 },
    uOpacity: { value: 0.7 },
    uC0: { value: new THREE.Color('#e8e0f4') },
    uC1: { value: new THREE.Color('#aad8ff') },
    uC2: { value: new THREE.Color('#727a8d') },
    uC3: { value: new THREE.Color('#404657') },
    uFogColor: SHARED.uFogColor,
    uFogNear: SHARED.uFogNear,
    uFogFar: SHARED.uFogFar,
  },
});

const plane = new THREE.PlaneGeometry(1, 1).translate(0, -0.5, 0);

export function createRainShaft(width, height) {
  const mesh = new THREE.Mesh(plane, material);
  mesh.scale.set(width, height, 1);
  mesh.renderOrder = 1;
  shafts.add(mesh);
  return mesh;
}

export function removeRainShaft(mesh) {
  shafts.delete(mesh);
}

export function setRainOpacity(v) {
  material.uniforms.uOpacity.value = v;
}

const _p = new THREE.Vector3();
export function updateRainShafts(camera, time) {
  material.uniforms.uTime.value = time * CYCLE_SPEED;
  for (const m of shafts) {
    if (!m.visible || !m.parent?.visible) continue;
    m.getWorldPosition(_p);
    m.rotation.y = Math.atan2(camera.position.x - _p.x, camera.position.z - _p.z) - (m.parent?.rotation.y ?? 0);
  }
}
