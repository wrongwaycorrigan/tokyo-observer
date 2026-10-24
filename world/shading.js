import * as THREE from 'three';

export const SHARED = {
  uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() },
  uSunColor: { value: new THREE.Color(1, 0.9, 0.85) },
  uAmbient: { value: new THREE.Color(0.42, 0.38, 0.52) },
  uFogColor: { value: new THREE.Color(0.9, 0.7, 0.85) },
  uFogNear: { value: 8_000 },
  uFogFar: { value: 90_000 },
  uNight: { value: 0 },
  uTime: { value: 0 },
};

const VERTEX = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uAmbient;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec3 vLight;
  varying float vSpec;
  varying float vFog;
  varying vec3 vColor;
  varying vec2 vUv;
  #ifdef BUILDING
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
  #endif

  void main() {
    vec4 local = vec4(position, 1.0);
    vec3 nrm = normal;
    #ifdef USE_INSTANCING
      local = instanceMatrix * local;
      nrm = mat3(instanceMatrix) * nrm;
    #endif
    vec4 world = modelMatrix * local;
    vec3 n = normalize(mat3(modelMatrix) * nrm);

    float diffuse = max(dot(n, uSunDir), 0.0);
    vLight = uAmbient + uSunColor * diffuse;
    vec3 viewDir = normalize(cameraPosition - world.xyz);
    vSpec = SPECULAR * pow(max(dot(reflect(-uSunDir, n), viewDir), 0.0), 12.0) * uSunColor.g;

    vColor = vec3(1.0);
    #ifdef USE_COLOR
      vColor = color;
    #endif
    #ifdef USE_INSTANCING_COLOR
      vColor *= instanceColor;
    #endif
    vUv = uv;
    #ifdef BUILDING
      vWorldPos = world.xyz;
      vWorldNormal = n;
    #endif

    vec4 mv = viewMatrix * world;
    vFog = smoothstep(uFogNear, uFogFar, length(mv.xyz));
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uFogColor;
  uniform vec3 uTint;
  uniform float uNight;
  uniform float uOpacity;
  uniform vec3 uEmissive;
  uniform sampler2D map;
  varying vec3 vLight;
  varying float vSpec;
  varying float vFog;
  varying vec3 vColor;
  varying vec2 vUv;
  #ifdef BUILDING
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  #endif

  void main() {
    vec3 base = vColor * uTint;
    #ifdef USE_MAP
      base *= texture2D(map, vUv).rgb;
    #endif
    vec3 c = base * vLight + vSpec + uEmissive;

    #ifdef BUILDING
      if (abs(vWorldNormal.y) < 0.5) {
        float along = dot(vWorldPos.xz, vec2(-vWorldNormal.z, vWorldNormal.x));
        vec2 cell = vec2(along / 4.0, vWorldPos.y / 3.6);
        vec2 f = fract(cell);
        float pane = step(0.22, f.x) * step(f.x, 0.78) * step(0.3, f.y) * step(f.y, 0.8);
        float block = hash(floor(vWorldPos.xz / 83.0));
        float lit = step(0.5, hash(floor(cell) + block * 17.0));
        vec3 neon = block < 0.06 ? vec3(1.0, 0.4, 0.8) : block < 0.12 ? vec3(0.4, 0.95, 1.0) : block < 0.6 ? vec3(1.0, 0.82, 0.5) : vec3(1.0, 0.95, 0.85);
        c *= 1.0 - pane * 0.28 * (1.0 - uNight);
        c += pane * lit * uNight * neon;
      } else {
        c += uNight * 0.03 * vec3(0.5, 0.4, 0.6);
      }
    #endif

    gl_FragColor = vec4(mix(c, uFogColor, vFog), uOpacity);
  }
`;

export function gouraudMaterial({
  map = null,
  vertexColors = true,
  tint = 0xffffff,
  emissive = 0x000000,
  building = false,
  specular = 0.35,
  opacity = 1,
  side = THREE.FrontSide,
} = {}) {
  const defines = { SPECULAR: specular.toFixed(3) };
  if (map) defines.USE_MAP = '';
  if (building) defines.BUILDING = '';
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines,
    vertexColors,
    transparent: opacity < 1,
    side,
    uniforms: {
      ...SHARED,
      map: { value: map },
      uTint: { value: new THREE.Color(tint) },
      uEmissive: { value: new THREE.Color(emissive) },
      uOpacity: { value: opacity },
    },
  });
}

const LIGHTS_VERTEX = /* glsl */ `
  uniform float uSize;
  uniform float uNear;
  uniform float uFar;
  uniform float uKeep;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = length(mv.xyz);
    float t = smoothstep(uNear, uFar, d);
    float seed = fract(sin(dot(position.xz, vec2(12.9898, 78.233))) * 43758.5453);
    float keep = step(seed, mix(1.0, uKeep, t));
    float fog = smoothstep(uFogNear, uFogFar * 1.2, d);
    vAlpha = keep * mix(1.0, 0.5, t) * (1.0 - fog * 0.85);
    vColor = mix(color, vec3(1.0, 0.6, 0.28), t * 0.6);
    gl_PointSize = keep * max(1.0, uSize * (1.0 - t * 0.65));
    gl_Position = projectionMatrix * mv;
  }
`;

const LIGHTS_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float a = vAlpha * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * a, 1.0);
  }
`;

export function nightLightsMaterial({ size = 2.5, near = 4_000, far = 55_000, keep = 0.35 } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: LIGHTS_VERTEX,
    fragmentShader: LIGHTS_FRAGMENT,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uFogNear: SHARED.uFogNear,
      uFogFar: SHARED.uFogFar,
      uSize: { value: size },
      uNear: { value: near },
      uFar: { value: far },
      uKeep: { value: keep },
      uOpacity: { value: 0 },
    },
  });
}
