import * as THREE from 'three';
import { register, report } from './sources.js';
import { CENTER, OUTER_HALF_M } from './geo.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SHARED, gouraudMaterial } from './shading.js';
import { createRainShaft } from './rainshaft.js';

const URL = `https://api.open-meteo.com/v1/forecast?latitude=${CENTER.lat}&longitude=${CENTER.lon}`
  + '&current=temperature_2m,relative_humidity_2m,weather_code,cloud_cover,precipitation,rain,snowfall,'
  + 'wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,is_day&timezone=Asia%2FTokyo';
const REFRESH_MS = 15 * 60_000;

const MAX_CLUSTERS = 150;
const CLOUD_SPAN_M = 90_000;
const WIND_VISUAL_SPEEDUP = 6;
// Clouds are broad decks, not tiny sprites near the horizon.
const CLOUD_ALT_MIN = 22_000;
const CLOUD_ALT_MAX = 30_000;
const CLOUD_SIZE_MIN = 1_800;
const CLOUD_SIZE_MAX = 5_500;
const FOG_NEAR_MIN = 35_000;
const FOG_FAR_MAX = Math.min(OUTER_HALF_M, 220_000);
const RAIN_BOX_M = 700;
const RAIN_STREAKS = 2500;

export function describe(code) {
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorm';
  return 'Unknown';
}

export class Weather {
  constructor(sky) {
    this.sky = sky;
    this.group = new THREE.Group();
    this.state = null;
    this.fogNear = 18_000;
    this.fogFar = 180_000;
    this.listeners = [];
    this.cloudColor = new THREE.Color(1, 1, 1);
    this._buildClouds();
    this._buildPrecip();
    this._nextLightning = 0;
  }

  onChange(fn) { this.listeners.push(fn); }

  get windSpeedMs() { return (this.state?.wind_speed_10m ?? 10) / 3.6; }
  get precipitation() { return this.state?.precipitation ?? 0; }
  get isSnow() { const c = this.state?.weather_code ?? 0; return (c >= 71 && c <= 77) || c === 85 || c === 86; }
  get isThunder() { return (this.state?.weather_code ?? 0) >= 95; }

  windVector(out = new THREE.Vector2()) {
    if (!this.state) return out.set(1, 0);
    const dir = (this.state.wind_direction_10m ?? 180) * Math.PI / 180;
    return out.set(Math.sin(dir), -Math.cos(dir));
  }

  _buildClouds() {
    this.shafts = [];
    this.clusters = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    this.cloudMaterial = new THREE.ShaderMaterial({
      uniforms: { uTint: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: `varying vec3 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uTint; varying vec3 vUv; uniform float uTime;
        const mat2 m=mat2(1.6,1.2,-1.2,1.6);
        float n(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<5;i++){v+=a*n(p);p=m*p;a*=0.5;}return v;}
        void main(){vec2 uv=vUv*4.0;float h=fbm(uv+uTime*0.01);h=pow(h,3.0);gl_FragColor=vec4(h*uTint,h);}
      `,
      transparent: true,
      opacity: 0.75,
      fog: false,
      side: THREE.DoubleSide,
    });

    for (let i = 0; i < MAX_CLUSTERS; i++) {
      const c = new THREE.Mesh(geo, this.cloudMaterial);
      const r = CLOUD_SIZE_MIN + Math.random() * (CLOUD_SIZE_MAX - CLOUD_SIZE_MIN);
      // Make some broad cloud sheets and some smaller billows within the deck.
      const shape = 0.65 + Math.random() * 0.8;
      c.scale.set(r * shape, r * (0.55 + Math.random() * 0.6), 1);
      c.position.set(
        (Math.random() - 0.5) * CLOUD_SPAN_M * 2,
        CLOUD_ALT_MIN + Math.random() * (CLOUD_ALT_MAX - CLOUD_ALT_MIN),
        (Math.random() - 0.5) * CLOUD_SPAN_M * 2
      );
      c.rotation.x = -Math.PI / 2;
      c.rotation.z = Math.random() * Math.PI;
      c.userData.windDrift = 0.7 + Math.random() * 0.8;
      this.group.add(c);
      this.clusters.push(c);
    }
  }

  _buildPrecip() {
    const pos = new Float32Array(RAIN_STREAKS * 12);
    for (let i = 0, c = 0; i < RAIN_STREAKS; i++) {
      const x = Math.random() * RAIN_BOX_M - RAIN_BOX_M / 2;
      const y = Math.random() * RAIN_BOX_M;
      const z = Math.random() * RAIN_BOX_M - RAIN_BOX_M / 2;
      pos.set([x, y, z, x, y - 9, z, x, y + RAIN_BOX_M, z, x, y + RAIN_BOX_M - 9, z], i * 12);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xaab4c4, transparent: true, opacity: 0.55 }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.snow = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 3, sizeAttenuation: false }));
    this.snow.frustumCulled = false;
    this.snow.visible = false;
    this.group.add(this.rain, this.snow);
    this._fall = 0;
  }

  async refresh() {
    try {
      const res = await fetch(URL);
      if (!res.ok) { report('weather', false, `HTTP ${res.status}`); return; }
      report('weather', true);
      this.state = (await res.json()).current;
      this._apply();
      for (const fn of this.listeners) fn(this.state);
    } catch (e) {
      report('weather', false, e.message);
      console.warn('[Weather] fetch failed:', e);
    }
  }

  start() {
    register('weather', 'Weather', 'api.open-meteo.com');
    this.refresh();
    setInterval(() => this.refresh(), REFRESH_MS);
  }

  _apply() {
    const s = this.state;
    const cover = (s.cloud_cover ?? 0) / 100;
    const wet = s.precipitation > 0 || (s.weather_code >= 51 && s.weather_code <= 99);
    const shown = Math.round(cover * MAX_CLUSTERS);
    this.clusters.forEach((c, i) => { c.visible = i < shown; });

    this.sky.overcast = Math.min(1, Math.max(0, (cover - 0.45) / 0.55) * 0.8 + (wet ? 0.25 : 0));
    for (const shaft of this.shafts) shaft.visible = wet && shaft.userData.raining;

    // Open-Meteo visibility is in metres. Keep a useful local view distance,
    // while allowing storms/overcast to reduce the horizon gradually.
    const vis = s.visibility ?? 40_000;
    const weatherPenalty = wet ? 0.78 : (cover > 85 ? 0.88 : 1);
    this.fogNear = THREE.MathUtils.clamp(vis * 0.12, 12_000, 45_000);
    this.fogFar = THREE.MathUtils.clamp(
      vis * 5.0 * weatherPenalty,
      FOG_NEAR_MIN,
      FOG_FAR_MAX
    );
  }

  update(camera, dt, onThunder) {
    if (!this.state) return;
    const wind = this.windVector();
    const daylight = 1 - SHARED.uNight.value;
    this.cloudColor.setScalar(0.35 + 0.65 * daylight).multiplyScalar(1 - this.sky.overcast * 0.35);
    this.cloudMaterial.uniforms.uTint.value.copy(this.cloudColor);

    for (const c of this.clusters) {
      if (!c.visible) continue;
      const drift = c.userData.windDrift ?? 1;
      c.position.x += wind.x * dt * WIND_VISUAL_SPEEDUP * drift;
      c.position.z += wind.y * dt * WIND_VISUAL_SPEEDUP * drift;
      if (c.position.x > CLOUD_SPAN_M) c.position.x -= 2 * CLOUD_SPAN_M;
      if (c.position.x < -CLOUD_SPAN_M) c.position.x += 2 * CLOUD_SPAN_M;
      if (c.position.z > CLOUD_SPAN_M) c.position.z -= 2 * CLOUD_SPAN_M;
      if (c.position.z < -CLOUD_SPAN_M) c.position.z += 2 * CLOUD_SPAN_M;
    }

    const precip = this.precipitation;
    const isRaining = precip > 0.1 || (this.state.rain ?? 0) > 0;
    const isSnowing = this.isSnow && this.state.snowfall > 0.1;

    this.rain.visible = isRaining;
    this.snow.visible = isSnowing;

    if (isRaining || isSnowing) {
      this._fall += dt * WIND_VISUAL_SPEEDUP * (isSnowing ? 2 : 8);
      const boxSize = RAIN_BOX_M;
      const shiftX = wind.x * dt * WIND_VISUAL_SPEEDUP * 10;
      const shiftZ = wind.y * dt * WIND_VISUAL_SPEEDUP * 10;
      if (this.rain.visible) {
        this.rain.position.x = boxSize / 2 + shiftX;
        this.rain.position.z = -boxSize / 2 + shiftZ;
        const posAttr = this.rain.geometry.getAttribute('position');
        for (let i = 1; i < posAttr.count; i++) {
          const y0 = posAttr.getY(i);
          if (y0 > RAIN_BOX_M) {
            posAttr.setY(i, y0 - RAIN_BOX_M * 2);
          }
        }
        posAttr.needsUpdate = true;
      }
    } else {
      this._fall = 0;
    }

    // Lightning
    if (this.isThunder) {
      if (Date.now() > this._nextLightning) {
        const interval = 2000 + Math.random() * 8000;
        this._nextLightning = Date.now() + interval;
        if (Math.random() < 0.3) onThunder();
      }
    }
  }

  dispose() {
    this.cloudMaterial.dispose();
    this.rain.material.dispose();
    this.snow.material.dispose();
  }
}
