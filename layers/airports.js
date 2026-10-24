import * as THREE from 'three';
import { toLocal } from '../world/geo.js';
import { createModel } from '../world/models.js';
import { keepVisible, makeLabel, setInfo } from '../world/markers.js';
import { SHARED } from '../world/shading.js';
import { atisText, parseMetar } from '../world/atis.js';
import { register, report } from '../world/sources.js';

const METAR_URL = 'https://metar.vatsim.net/';
const METAR_REFRESH_MS = 10 * 60_000;

const AIRPORTS = [
  { icao: 'RJTT', name: 'Tokyo Haneda', lat: 35.5523, lon: 139.7798, note: "Tokyo International Airport, one of the world's busiest. Four runways on reclaimed land in the bay." },
  { icao: 'RJAA', name: 'Narita', lat: 35.7647, lon: 140.3864, note: 'Narita International Airport, the main long-haul gateway for Tokyo.' },
  { icao: 'RJTF', name: 'Chofu', lat: 35.6717, lon: 139.5281, note: 'Chofu Airport, commuter flights to the Izu Islands.' },
  { icao: 'RJTI', name: 'Tokyo Heliport', lat: 35.6366, lon: 139.8391, note: 'Tokyo Heliport in Shin-Kiba, Koto ward.' },
  { icao: 'RJTY', name: 'Yokota', lat: 35.7485, lon: 139.3485, note: 'Yokota Air Base, US Forces Japan headquarters.' },
  { icao: 'RJTA', name: 'Atsugi', lat: 35.4546, lon: 139.4500, note: 'Naval Air Facility Atsugi, shared by the US Navy and JMSDF.' },
  { icao: 'RJTJ', name: 'Iruma', lat: 35.8419, lon: 139.4106, note: 'JASDF Iruma Air Base, Saitama.' },
  { icao: 'RJTC', name: 'Tachikawa', lat: 35.7108, lon: 139.4031, note: 'JGSDF Tachikawa Airfield.' },
  { icao: 'RJTK', name: 'Kisarazu', lat: 35.3983, lon: 139.9100, note: 'JGSDF Kisarazu Air Field, across the bay in Chiba.' },
  { icao: 'RJTL', name: 'Shimofusa', lat: 35.7984, lon: 140.0114, note: 'JMSDF Shimofusa Air Base, Chiba.' },
];

let root = null;
const beacons = [];
const nodes = new Map();
const runwayEnds = new Map();

const escape = (v) => String(v).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

async function loadRunwayEnds() {
  try {
    const data = await (await fetch('./data/runways.json')).json();
    for (const r of data.runways) {
      const list = runwayEnds.get(r.airport) ?? [];
      list.push(...r.ident.split('/'));
      runwayEnds.set(r.airport, list);
    }
  } catch {
    runwayEnds.clear();
  }
}

async function refreshAtis() {
  try {
    const res = await fetch(METAR_URL + AIRPORTS.map((a) => a.icao).join(','));
    if (!res.ok) { report('metar', false, `HTTP ${res.status}`); return; }
    const lines = (await res.text()).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let n = 0;
    for (const line of lines) {
      const icao = line.slice(0, 4);
      const node = nodes.get(icao);
      if (!node) continue;
      const metar = parseMetar(line);
      const text = atisText(node.airport.name, metar, runwayEnds.get(icao) ?? []);
      setInfo(node.obj, `${icao} ${node.airport.name}`, `${node.airport.note}<br><br><span class="atis">ATIS: ${escape(text)}</span><br><br><span class="metar">METAR ${escape(line)}</span>`);
      n++;
    }
    report('metar', true, `${n} airports reporting`);
  } catch (e) {
    report('metar', false, e.message);
  }
}

function beaconPoints() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 54, 0], 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute([0, 0, 0], 3));
  return new THREE.Points(g, new THREE.PointsMaterial({
    size: 7, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
}

export function init(ctx) {
  root = new THREE.Group();
  for (const a of AIRPORTS) {
    const p = toLocal(a.lon, a.lat);
    const obj = new THREE.Group();
    obj.position.set(p.x, Math.max(ctx.terrain.heightAt(p.x, p.z), 1), p.z);
    obj.add(createModel('controlTower'));
    const beacon = beaconPoints();
    obj.add(beacon);
    obj.add(makeLabel(`✈ ${a.icao} ${a.name.toUpperCase()}`, { className: 'label-airport', maxDistance: 140_000, offsetY: 66 }));
    keepVisible(obj, 50, 34, 30, 2);
    setInfo(obj, `${a.icao} ${a.name}`, `${a.note}<br><br><span class="metar">No METAR from this field.</span>`);
    root.add(obj);
    beacons.push({ beacon, phase: Math.random() * 4 });
    nodes.set(a.icao, { obj, airport: a });
  }
  ctx.scene.add(root);
  register('metar', 'Airport METAR / ATIS', 'metar.vatsim.net');
  loadRunwayEnds().then(refreshAtis);
  setInterval(refreshAtis, METAR_REFRESH_MS);
  return root;
}

export function update(time) {
  const night = SHARED.uNight.value;
  for (const b of beacons) {
    const t = (time + b.phase) % 2;
    const flash = t % 1 < 0.18;
    const green = t < 1;
    const col = b.beacon.geometry.attributes.color.array;
    const k = flash ? 0.35 + 0.65 * night : 0;
    col[0] = green ? 0.2 * k : k;
    col[1] = k;
    col[2] = green ? 0.4 * k : k;
    b.beacon.geometry.attributes.color.needsUpdate = true;
  }
}

export function getCount() {
  return AIRPORTS.length;
}
