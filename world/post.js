import * as THREE from 'three';

const RAMPS = [
  ['#07051a', '#3b2c86'],
  ['#1a0838', '#b98af0'],
  ['#2e0030', '#ff5ec8'],
  ['#4a0f2c', '#ffc6e6'],
  ['#3e1418', '#ffb48c'],
  ['#4a1c00', '#ffe27a'],
  ['#00222e', '#72f6ff'],
  ['#052a2a', '#86ecd0'],
  ['#0c2418', '#bff2ae'],
  ['#08183e', '#aad8ff'],
  ['#1a1628', '#e8e0f4'],
  ['#221e1a', '#fff4e2'],
  ['#000000', '#ffffff'],
  ['#2a0206', '#ff3a2a'],
  ['#0e1220', '#a4aec4'],
  ['#020a24', '#3a6ad8'],
];

const LUT_SIZE = 32;
const MAX_WIDTH = 800;
const MAX_HEIGHT = 600;
const PC98_FIXED = ['#000000', '#ffffff', '#ffbb55', '#ff55aa'];
const PC98_SEED = ['#221144', '#443377', '#6655aa', '#9977dd', '#cc88cc', '#ffaacc', '#ffddaa', '#66ccdd', '#336699', '#224455', '#558866', '#aaaaaa'];
const PC98_SAMPLE = [80, 60];
const PC98_EVERY_MS = 1500;
const DITHER = { 256: 0.09, pc98: 0.16 };
const STORAGE_KEY = 'tokyo-observer-palette';

function buildPalette() {
  const colors = [];
  for (const [dark, light] of RAMPS) {
    const a = new THREE.Color(dark);
    const b = new THREE.Color(light);
    for (let i = 0; i < 16; i++) colors.push(a.clone().lerp(b, i / 15));
  }
  return colors;
}

function buildLut(palette) {
  const n = LUT_SIZE;
  const data = new Uint8Array(n * n * n * 4);
  const pr = palette.map((c) => [c.r, c.g, c.b]);
  for (let b = 0; b < n; b++) {
    for (let g = 0; g < n; g++) {
      for (let r = 0; r < n; r++) {
        const R = r / (n - 1); const G = g / (n - 1); const B = b / (n - 1);
        let best = 0; let bestD = Infinity;
        for (let k = 0; k < pr.length; k++) {
          const [pr0, pg0, pb0] = pr[k];
          const rm = (R + pr0) / 2;
          const d = (2 + rm) * (R - pr0) ** 2 + 4 * (G - pg0) ** 2 + (3 - rm) * (B - pb0) ** 2;
          if (d < bestD) { bestD = d; best = k; }
        }
        const i = (g * n * n + b * n + r) * 4;
        const [x, y, z] = pr[best];
        data[i] = x * 255; data[i + 1] = y * 255; data[i + 2] = z * 255; data[i + 3] = 255;
      }
    }
  }
  const tex = new THREE.DataTexture(data, n * n, n, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

function quantize4(c) {
  return new THREE.Color(Math.round(c.r * 15) / 15, Math.round(c.g * 15) / 15, Math.round(c.b * 15) / 15);
}

function refine(centers, pixels) {
  const n = centers.length;
  for (let pass = 0; pass < 4; pass++) {
    const sum = new Float32Array(n * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i] / 255; const g = pixels[i + 1] / 255; const b = pixels[i + 2] / 255;
      let best = 0; let bestD = Infinity;
      for (let k = 0; k < n; k++) {
        const c = centers[k];
        const d = 2 * (r - c.r) ** 2 + 4 * (g - c.g) ** 2 + 3 * (b - c.b) ** 2;
        if (d < bestD) { bestD = d; best = k; }
      }
      sum[best * 4] += r; sum[best * 4 + 1] += g; sum[best * 4 + 2] += b; sum[best * 4 + 3]++;
    }
    for (let k = 0; k < n; k++) {
      const w = sum[k * 4 + 3];
      if (w > 0) centers[k].setRGB(sum[k * 4] / w, sum[k * 4 + 1] / w, sum[k * 4 + 2] / w);
    }
  }
  return centers;
}

const FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tLut;
  uniform vec2 uResolution;
  uniform float uPalette;
  uniform float uDither;
  varying vec2 vUv;

  float bayer(vec2 p) {
    int i = int(mod(p.x, 4.0)) + int(mod(p.y, 4.0)) * 4;
    float m[16];
    m[0] = 0.0;  m[1] = 8.0;  m[2] = 2.0;  m[3] = 10.0;
    m[4] = 12.0; m[5] = 4.0;  m[6] = 14.0; m[7] = 6.0;
    m[8] = 3.0;  m[9] = 11.0; m[10] = 1.0; m[11] = 9.0;
    m[12] = 15.0; m[13] = 7.0; m[14] = 13.0; m[15] = 5.0;
    for (int k = 0; k < 16; k++) if (k == i) return m[k] / 16.0 - 0.5;
    return 0.0;
  }

  vec3 lut(vec3 c) {
    float n = ${LUT_SIZE.toFixed(1)};
    vec3 q = floor(clamp(c, 0.0, 1.0) * (n - 1.0) + 0.5);
    vec2 uv = vec2((q.r + q.b * n + 0.5) / (n * n), (q.g + 0.5) / n);
    return texture2D(tLut, uv).rgb;
  }

  void main() {
    vec2 uv = vUv;
    vec3 src = texture2D(tDiffuse, uv).rgb;
    vec2 px = uv * uResolution;
    vec3 c = src;
    if (uPalette > 0.5) c = lut(src + bayer(floor(px)) * uDither);

    gl_FragColor = vec4(c, 1.0);
  }
`;

export class PostPass {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.uniforms = {
      tDiffuse: { value: this.target.texture },
      tLut: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uPalette: { value: 1 },
      uDither: { value: DITHER[256] },
    };
    this.lut256 = buildLut(buildPalette());
    this.pc98 = PC98_SEED.map((c) => new THREE.Color(c));
    this.pc98Lut = null;
    this.pc98At = 0;
    this.sample = new THREE.WebGLRenderTarget(...PC98_SAMPLE, { depthBuffer: false });
    this.pixels = new Uint8Array(PC98_SAMPLE[0] * PC98_SAMPLE[1] * 4);
    const copy = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: this.uniforms.tDiffuse },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb, 1.0); }',
      depthTest: false,
      depthWrite: false,
    });
    const copyQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copy);
    copyQuad.frustumCulled = false;
    this.copyScene = new THREE.Scene();
    this.copyScene.add(copyQuad);
    let mode = '256';
    try { mode = localStorage.getItem(STORAGE_KEY) === 'pc98' ? 'pc98' : '256'; } catch {}
    this.setMode(mode);
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h) {
    const scale = Math.min(1, MAX_WIDTH / w, MAX_HEIGHT / h);
    const width = Math.round(w * scale);
    const lines = Math.round(h * scale);
    this.target.setSize(width, lines);
    this.uniforms.uResolution.value.set(width, lines);
  }

  get mode() {
    return this._mode;
  }

  setMode(mode) {
    this._mode = mode;
    try { localStorage.setItem(STORAGE_KEY, mode); } catch {}
    this.uniforms.uDither.value = DITHER[mode];
    this.pc98At = 0;
    if (mode === '256') this.uniforms.tLut.value = this.lut256;
  }

  _updatePc98() {
    this.renderer.setRenderTarget(this.sample);
    this.renderer.render(this.copyScene, this.camera);
    this.renderer.readRenderTargetPixels(this.sample, 0, 0, ...PC98_SAMPLE, this.pixels);
    refine(this.pc98, this.pixels);
    const palette = [...PC98_FIXED.map((c) => new THREE.Color(c)), ...this.pc98.map(quantize4)];
    const lut = buildLut(palette);
    this.pc98Lut?.dispose();
    this.pc98Lut = lut;
    this.uniforms.tLut.value = lut;
  }

  render(scene, camera) {
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    const now = performance.now();
    if (this._mode === 'pc98' && now - this.pc98At > PC98_EVERY_MS) {
      this.pc98At = now;
      this._updatePc98();
    }
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }
}
