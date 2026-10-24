import * as THREE from 'three';
import { toLocal } from './geo.js';
import { makeLabel, setInfo } from './markers.js';
import { register, report } from './sources.js';

const URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const REFRESH_MS = 30 * 60_000;
const POINTS = [
  { name: 'Tokyo', lat: 35.6812, lon: 139.7671 },
  { name: 'Yokohama', lat: 35.4437, lon: 139.6380 },
  { name: 'Kawasaki', lat: 35.5308, lon: 139.7030 },
  { name: 'Chiba', lat: 35.6074, lon: 140.1065 },
  { name: 'Saitama', lat: 35.8617, lon: 139.6455 },
  { name: 'Kisarazu', lat: 35.3760, lon: 139.9168 },
];

function band(aqi) {
  if (aqi <= 50) return ['GOOD', 'aqi-good'];
  if (aqi <= 100) return ['MODERATE', 'aqi-moderate'];
  if (aqi <= 150) return ['SENSITIVE', 'aqi-sensitive'];
  return ['UNHEALTHY', 'aqi-bad'];
}

export class AirQuality {
  constructor(terrain) {
    this.group = new THREE.Group();
    this.readings = [];
    this.labels = POINTS.map((p) => {
      const pos = toLocal(p.lon, p.lat);
      const obj = new THREE.Object3D();
      obj.position.set(pos.x, Math.max(terrain.heightAt(pos.x, pos.z), 0) + 700, pos.z);
      const label = makeLabel(`AQI ${p.name.toUpperCase()}`, { className: 'label-aqi', maxDistance: 120_000 });
      obj.add(label);
      setInfo(obj, `${p.name} air quality`, 'Waiting for Open-Meteo...');
      this.group.add(obj);
      return { point: p, obj, label };
    });
  }

  get worstPm25() {
    return Math.max(0, ...this.readings.map((r) => r.pm25 ?? 0));
  }

  summary() {
    const tokyo = this.readings.find((r) => r.name === 'Tokyo');
    return tokyo ? `AQI ${tokyo.aqi}  PM2.5 ${tokyo.pm25?.toFixed(0) ?? '--'}` : 'AQI --';
  }

  async refresh() {
    try {
      const params = new URLSearchParams({
        latitude: POINTS.map((p) => p.lat).join(','),
        longitude: POINTS.map((p) => p.lon).join(','),
        current: 'us_aqi,pm2_5,ozone,nitrogen_dioxide',
      });
      const res = await fetch(`${URL}?${params}`);
      if (!res.ok) { report('airquality', false, `HTTP ${res.status}`); return; }
      const data = await res.json();
      const list = Array.isArray(data) ? data : [data];
      this.readings = list.map((d, i) => ({
        name: POINTS[i].name,
        aqi: Math.round(d.current?.us_aqi ?? 0),
        pm25: d.current?.pm2_5,
        o3: d.current?.ozone,
        no2: d.current?.nitrogen_dioxide,
      }));
      this.readings.forEach((r, i) => {
        const [word, cls] = band(r.aqi);
        const l = this.labels[i];
        l.label.element.textContent = `AQI ${r.aqi} ${r.name.toUpperCase()}`;
        l.label.element.className = `map-label ${cls}`;
        setInfo(l.obj, `${r.name} air quality`, `US AQI ${r.aqi} (${word})<br>PM2.5 ${r.pm25?.toFixed(1)} &micro;g/m&sup3;<br>Ozone ${r.o3?.toFixed(0)} &micro;g/m&sup3;<br>NO&#8322; ${r.no2?.toFixed(0)} &micro;g/m&sup3;<br>Via Open-Meteo`);
      });
      report('airquality', true);
    } catch (e) {
      report('airquality', false, e.message);
    }
  }

  start() {
    register('airquality', 'Air quality', 'air-quality-api.open-meteo.com');
    this.refresh();
    setInterval(() => this.refresh(), REFRESH_MS);
  }
}
