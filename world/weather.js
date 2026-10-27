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

const MAX_CLUSTERS = 90;
const CLOUD_SPAN_M = 90_000;
const WIND_VISUAL_SPEEDUP = 6;
const CLOUD_ALT_MIN = 20_000;
const CLOUD_ALT_MAX = 26_000;
const CLOUD_SIZE_MIN = 6_000;
const CLOUD_SIZE_MAX = 15_000;
const CLOUD_ALPHA = 0.85;
const FOG_FAR_CLEAR = Math.min(OUTER_HALF_M, 220_000);
const FOG_FAR_MURK = 130_000;
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
      uniforms: { uTint: { value: new THREE.Color(1, 1, 1) }, uTime: SHARED.uTime, uAlpha: { value: CLOUD_ALPHA }, uSide: { value: 0 } },
      vertexShader: `varying vec2 vUv; varying vec3 vWorld; varying float vSeed;
        void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.0); vWorld=w.xyz; vSeed=fract(modelMatrix[3].x*0.00013+modelMatrix[3].z*0.00017); gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `uniform vec3 uTint; uniform float uTime; uniform float uAlpha; uniform float uSide; varying vec2 vUv; varying vec3 vWorld; varying float vSeed;
        float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
        float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<4;i++){v+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=0.5;}return v;}
        void main(){
          vec2 c=vUv-0.5;
          float r=length(c)*2.0;
          float body=fbm(vUv*3.0+vSeed*40.0+uTime*0.004);
          float a=smoothstep(0.24,0.56,body*(1.2-r*r));
          vec3 toFrag=vWorld-cameraPosition;
          float grazing=abs(normalize(toFrag).y);
          float view=uSide>0.5?1.0-smoothstep(0.12,0.4,grazing):smoothstep(0.04,0.22,grazing);
          float cam=smoothstep(800.0,5000.0,length(toFrag));
          a*=uAlpha*cam*view;
          if(a<0.02) discard;
          gl_FragColor=vec4(uTint*(0.82+0.18*body),a);
        }
      `,
      transparent: true,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });

    this.sideMaterial = this.cloudMaterial.clone();
    this.sideMaterial.uniforms.uTint = this.cloudMaterial.uniforms.uTint;
    this.sideMaterial.uniforms.uAlpha = this.cloudMaterial.uniforms.uAlpha;
    this.sideMaterial.uniforms.uTime = SHARED.uTime;
    this.sideMaterial.uniforms.uSide = { value: 1 };

    for (let i = 0; i < MAX_CLUSTERS; i++) {
      const c = new THREE.Mesh(geo, this.cloudMaterial);
      const r = CLOUD_SIZE_MIN + Math.random() * (CLOUD_SIZE_MAX - CLOUD_SIZE_MIN);
      // Make some broad cloud sheets and some smaller billows within the deck.
      const shape = 0.65 + Math.random() * 0.8;
      c.scale.set(r * shape, r * (0.55 + Math.random() * 0.6), 1);
      c.renderOrder = 3;
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
      const side = new THREE.Mesh(geo, this.sideMaterial);
      side.scale.set(r * shape * 0.9, r * 0.22, 1);
      side.renderOrder = 3;
      side.visible = false;
      this.group.add(side);
      c.userData.side = side;
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

    const vis = THREE.MathUtils.clamp((s.visibility ?? 40_000) / 30_000, 0, 1);
    this.fogFar = THREE.MathUtils.lerp(FOG_FAR_MURK, FOG_FAR_CLEAR, vis) * (wet ? 0.9 : 1);
    this.fogNear = this.fogFar * 0.25;
    this.cloudMaterial.uniforms.uAlpha.value = CLOUD_ALPHA * (0.6 + 0.4 * cover);
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
    for (const c of this.clusters) {
      const side = c.userData.side;
      side.visible = c.visible;
      if (!c.visible) continue;
      side.position.copy(c.position);
      side.rotation.y = Math.atan2(camera.position.x - c.position.x, camera.position.z - c.position.z);
    }

    const precip = this.precipitation;
    const isRaining = precip > 0.1 || (this.state.rain ?? 0) > 0;
    const isSnowing = this.isSnow && this.state.snowfall > 0.1;

    const low = camera.position.y < 3_000;
    this.rain.visible = isRaining && low;
    this.snow.visible = isSnowing && low;

    if (this.rain.visible || this.snow.visible) {
      this._fall = (this._fall + dt * (isSnowing ? 6 : 220)) % RAIN_BOX_M;
      for (const o of [this.rain, this.snow]) {
        o.position.set(camera.position.x, camera.position.y - RAIN_BOX_M - this._fall, camera.position.z);
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
