import * as THREE from 'three';
import { SHARED } from './shading.js';

const VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uAmbient;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uTime;
  uniform float uWind;
  uniform sampler2D uShore;
  uniform vec4 uShoreInfo;
  varying vec3 vWorld;

  float ground(vec2 xz) {
    vec2 g = (xz + uShoreInfo.x) / (2.0 * uShoreInfo.x) * uShoreInfo.y;
    vec2 uv = (g + 0.5) / (uShoreInfo.y + 1.0);
    return (texture2D(uShore, uv).r * 2.0 - 1.0) * uShoreInfo.z;
  }

  float surf(vec2 p, float t, float dist) {
    if (uShoreInfo.w < 0.5 || abs(p.x) > uShoreInfo.x || abs(p.y) > uShoreInfo.x) return 0.0;
    float near = 1.0 - smoothstep(2500.0, 7000.0, dist);
    if (near <= 0.0) return 0.0;
    float cell = 2.0 * uShoreInfo.x / uShoreInfo.y;
    float h = ground(p);
    float depth = vWorld.y - h;
    if (depth <= 0.0) return 0.0;
    vec2 grad = vec2(ground(p + vec2(cell, 0.0)) - ground(p - vec2(cell, 0.0)), ground(p + vec2(0.0, cell)) - ground(p - vec2(0.0, cell))) / (2.0 * cell);
    float d = depth / max(length(grad), 0.004);
    float band = 1.0 - smoothstep(25.0, 120.0, d);
    if (band <= 0.0) return 0.0;
    float breakup = 0.5 + 0.5 * sin(p.x * 0.09 + p.y * 0.05 + t * 0.6) * sin(p.x * 0.037 - p.y * 0.081 - t * 0.4);
    float crest = pow(fract(d / 38.0 + t * 0.11), 7.0) * smoothstep(0.35, 0.8, breakup);
    float wash = (1.0 - smoothstep(0.0, 16.0, d)) * (0.55 + 0.45 * sin(t * 0.9 + p.x * 0.02 + p.y * 0.015));
    float wind = 0.45 + 0.55 * clamp(uWind / 9.0, 0.0, 1.0);
    return clamp(band * (crest * 0.9 + wash * 0.5) * near * wind, 0.0, 1.0);
  }

  void main() {
    vec2 p = vWorld.xz;
    float t = uTime;
    float amp = 0.04 + uWind * 0.006;
    vec3 n = normalize(vec3(
      amp * (sin(p.x * 0.011 + t * 0.9) + 0.6 * sin(p.x * 0.031 + p.y * 0.017 + t * 1.7)),
      1.0,
      amp * (sin(p.y * 0.013 - t * 0.8) + 0.6 * sin(p.y * 0.029 - p.x * 0.021 + t * 1.3))));

    vec3 view = normalize(cameraPosition - vWorld);
    float diffuse = max(dot(n, uSunDir), 0.0);
    vec3 deep = vec3(0.16, 0.3, 0.72) * (uAmbient + uSunColor * diffuse * 0.5);
    float fresnel = pow(1.0 - max(dot(view, n), 0.0), 4.0);
    vec3 c = mix(deep, uFogColor * vec3(1.0, 0.75, 1.0), fresnel * 0.4);
    float glint = pow(max(dot(reflect(-uSunDir, n), view), 0.0), 160.0);
    c += uSunColor * glint * 0.9;

    float dist = length(cameraPosition - vWorld);
    float foam = surf(p, t, dist);
    c = mix(c, vec3(0.92, 0.94, 1.0) * (uAmbient * 1.4 + uSunColor * 0.5), foam * 0.75);

    float fog = smoothstep(uFogNear, uFogFar, dist);
    gl_FragColor = vec4(mix(c, uFogColor, fog), 1.0);
  }
`;

export function createWater() {
  const geometry = new THREE.PlaneGeometry(900_000, 900_000, 1, 1).rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { ...SHARED, uWind: { value: 4 }, uShore: { value: null }, uShoreInfo: { value: new THREE.Vector4(1, 1, 1, 0) } },
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.surface = true;
  mesh.renderOrder = -1;
  mesh.userData.setShore = ({ texture, half, grid, range }) => {
    material.uniforms.uShore.value = texture;
    material.uniforms.uShoreInfo.value.set(half, grid, range, 1);
  };
  return mesh;
}
