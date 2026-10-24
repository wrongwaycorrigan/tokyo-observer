import * as THREE from 'three';
import { toLocal } from '../world/geo.js';
import { createModel } from '../world/models.js';
import { keepVisible, makeLabel, setInfo } from '../world/markers.js';
import { SHARED } from '../world/shading.js';

const SITES = [
  { name: 'Tokyo Skytree', lat: 35.7100, lon: 139.8107, height: 634, landmark: true, kind: 'TV / FM', note: 'Main digital TV transmitter for the Kanto region (NHK and the Tokyo key stations) and Tokyo FM stations.' },
  { name: 'Tokyo Tower', lat: 35.6586, lon: 139.7454, height: 333, landmark: true, kind: 'FM', note: "Tokyo's analogue-era TV tower, still carrying FM radio broadcasts." },
  { name: 'Yokohama Landmark Tower', lat: 35.4546, lon: 139.6317, height: 296, landmark: true, kind: 'FM', note: 'FM Yokohama transmitter site on the rooftop of Yokohama’s tallest building.' },
  { name: 'Skytower West Tokyo', lat: 35.7351, lon: 139.5230, height: 195, kind: 'FM / TV', note: 'FM Nishi-Tokyo and TV relay tower in Nishitokyo.' },
  { name: 'TV Kanagawa Transmitter', lat: 35.5245, lon: 139.6640, height: 150, kind: 'TV', note: 'Transmitter for tvk, Kanagawa’s independent TV station.' },
  { name: 'NHK Radio 1 Shobu', lat: 36.0692, lon: 139.6276, height: 245, kind: 'AM 594 kHz', note: 'NHK Radio 1 medium-wave mast at the Shobu-Kuki transmitting station, Saitama.' },
  { name: 'NHK Radio 2 Shobu', lat: 36.0724, lon: 139.6237, height: 215, kind: 'AM 693 kHz', note: 'NHK Radio 2 medium-wave mast at the Shobu-Kuki transmitting station, Saitama.' },
  { name: 'TBS Radio Toda', lat: 35.8052, lon: 139.6583, height: 150, kind: 'AM 954 kHz', note: 'TBS Radio medium-wave transmitter in Toda, Saitama.' },
  { name: 'Bunka Hoso Kawaguchi', lat: 35.8255, lon: 139.7550, height: 150, kind: 'AM 1134 kHz', note: 'Nippon Cultural Broadcasting (JOQR) medium-wave transmitter in Kawaguchi, Saitama.' },
  { name: 'NACK5 Tokigawa', lat: 35.9587, lon: 139.2101, height: 40, kind: 'FM 79.5 MHz', note: 'NACK5 FM transmitter on the hills of Tokigawa, Saitama.' },
  { name: 'Radio Nippon Odawara', lat: 35.3012, lon: 139.1568, height: 50, kind: 'AM relay', note: 'RF Radio Nippon medium-wave relay transmitter in Odawara.' },
];

let root = null;
let lights = null;
let lightMaterial = null;

export function init(ctx) {
  root = new THREE.Group();
  const lampPos = [];
  for (const s of SITES) {
    const p = toLocal(s.lon, s.lat);
    const ground = Math.max(ctx.terrain.heightAt(p.x, p.z), 0);
    const obj = new THREE.Group();
    obj.position.set(p.x, ground, p.z);
    if (!s.landmark) {
      const mast = createModel('mast');
      mast.scale.y = s.height / 100;
      obj.add(mast);
      keepVisible(obj, s.height, 40, 6, 1.2);
    }
    obj.add(makeLabel(`▲ ${s.name.toUpperCase()} ${s.kind}`, { className: 'label-tower', maxDistance: 110_000, offsetY: s.height * (s.landmark ? 1.45 : 1.25) }));
    setInfo(obj, s.name, `${s.kind}<br>${s.note}<br>Height ${s.height} m`);
    root.add(obj);
    const top = s.landmark ? s.height * 1.4 : s.height * 1.2;
    lampPos.push(p.x, ground + top, p.z, p.x, ground + top * 0.55, p.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(lampPos, 3));
  lightMaterial = new THREE.PointsMaterial({ color: 0xff3020, size: 5, sizeAttenuation: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  lights = new THREE.Points(g, lightMaterial);
  root.add(lights);
}

export function update(time) {
  const night = SHARED.uNight.value;
  lightMaterial.opacity = (time % 1.6 < 0.8 ? 1 : 0.15) * (0.25 + 0.75 * night);
}

export function group() {
  return root;
}

export function getCount() {
  return SITES.length;
}
