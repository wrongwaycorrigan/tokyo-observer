import * as THREE from 'three';
import { toLocal } from '../world/geo.js';
import { createModel, modelSize } from '../world/models.js';
import { onSettingsChange, register, report, settings } from '../world/sources.js';
import { forget, keepVisible, makeLabel, setInfo } from '../world/markers.js';

const AIS_WS_URL = 'wss://stream.aisstream.io/v0/stream';
const RECONNECT_DELAY_MS = 5000;
const STALE_MS = 10 * 60_000;
const PRUNE_INTERVAL_MS = 2 * 60_000;
const BBOX = { minLat: 35.15, maxLat: 35.75, minLon: 139.6, maxLon: 140.15 };

const MID_COUNTRY = {
  431: 'JP', 432: 'JP', 440: 'KR', 441: 'KR', 445: 'KP', 412: 'CN', 413: 'CN', 414: 'CN',
  477: 'HK', 453: 'MO', 416: 'TW', 548: 'PH', 574: 'VN', 567: 'TH', 533: 'MY', 525: 'ID', 419: 'IN',
  563: 'SG', 564: 'SG', 565: 'SG', 566: 'SG', 503: 'AU', 512: 'NZ', 273: 'RU',
  338: 'US', 366: 'US', 367: 'US', 368: 'US', 369: 'US', 316: 'CA',
  351: 'PA', 352: 'PA', 353: 'PA', 354: 'PA', 355: 'PA', 356: 'PA', 357: 'PA',
  636: 'LR', 637: 'LR', 538: 'MH', 308: 'BS', 309: 'BS', 311: 'BS',
  215: 'MT', 248: 'MT', 249: 'MT', 256: 'MT', 209: 'CY', 210: 'CY', 212: 'CY',
  232: 'GB', 233: 'GB', 234: 'GB', 235: 'GB', 226: 'FR', 227: 'FR', 228: 'FR', 211: 'DE', 218: 'DE',
  244: 'NL', 245: 'NL', 246: 'NL', 219: 'DK', 220: 'DK', 257: 'NO', 258: 'NO', 259: 'NO', 247: 'IT',
  237: 'GR', 239: 'GR', 240: 'GR', 241: 'GR',
};

function countryForMmsi(mmsi) {
  return MID_COUNTRY[Number(String(mmsi).slice(0, 3))] || null;
}

let regionNames = null;
function countryName(code) {
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(code) || code;
  } catch {
    return code;
  }
}

function modelForType(type) {
  if (type === 30) return 'fishingBoat';
  if (type === 36) return 'sailboat';
  if (type === 37) return 'speedboat';
  if (type === 52) return 'tug';
  if (type >= 60 && type <= 69) return 'liner';
  if (type >= 70 && type <= 79) return 'cargoShip';
  if (type >= 80 && type <= 89) return 'tanker';
  return 'genericShip';
}

let group = null;
let socket = null;
let reconnectTimer = null;
let pruneTimer = null;
let enabled = false;
const vessels = new Map();

function setModel(v) {
  const name = modelForType(v.shipType);
  if (v.modelName === name) return;
  if (v.mesh) v.obj.remove(v.mesh);
  v.mesh = createModel(name);
  v.modelName = name;
  v.obj.add(v.mesh);
  keepVisible(v.obj, modelSize(name), 44, 900, 2.5);
}

function upsertVessel(mmsi, updates) {
  let v = vessels.get(mmsi);
  if (!v) {
    v = { name: null };
    vessels.set(mmsi, v);
  }
  Object.assign(v, updates);
  v.lastUpdate = Date.now();
  if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon)) return;

  if (!v.obj) {
    v.obj = new THREE.Group();
    v.label = makeLabel('', { className: 'label-sea', maxDistance: 9_000, offsetY: 12 });
    v.obj.add(v.label);
    v.obj.position.copy(toLocal(v.lon, v.lat));
    group.add(v.obj);
  }
  setModel(v);

  const country = countryForMmsi(mmsi);
  v.fix = new THREE.Vector3().copy(toLocal(v.lon, v.lat));
  v.fixTime = performance.now();
  const cog = ((Number.isFinite(v.cog) ? v.cog : 0) * Math.PI) / 180;
  const speed = (Number.isFinite(v.sog) && v.sog < 60 ? v.sog : 0) * 0.5144;
  v.vel = new THREE.Vector3(Math.sin(cog) * speed, 0, -Math.cos(cog) * speed);
  v.obj.rotation.y = -cog;
  v.label.element.textContent = `${country ? `[${country}] ` : ''}${v.name || `MMSI ${mmsi}`}`;
  const sog = Number.isFinite(v.sog) ? `${v.sog.toFixed(1)} kn` : 'unknown';
  setInfo(v.obj, v.name || 'Unknown vessel', `MMSI ${mmsi}<br>Speed ${sog}${country ? `<br>Flag ${countryName(country)}` : ''}`);
}

function handleMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  const mmsi = msg.MetaData?.MMSI;
  if (mmsi == null) return;
  if (msg.MessageType === 'PositionReport') {
    const pr = msg.Message?.PositionReport;
    if (pr) upsertVessel(mmsi, { lat: pr.Latitude, lon: pr.Longitude, cog: pr.Cog, sog: pr.Sog });
  } else if (msg.MessageType === 'ShipStaticData') {
    const sd = msg.Message?.ShipStaticData;
    if (!sd) return;
    const updates = {};
    if (sd.Name) updates.name = sd.Name.trim();
    if (Number.isFinite(sd.Type)) updates.shipType = sd.Type;
    if (Object.keys(updates).length) upsertVessel(mmsi, updates);
  }
}

function prune() {
  const now = Date.now();
  for (const [mmsi, v] of vessels) {
    if (now - v.lastUpdate <= STALE_MS) continue;
    if (v.obj) {
      forget(v.obj);
      group.remove(v.obj);
    }
    vessels.delete(mmsi);
  }
}

function connect() {
  if (!settings.aisKey) {
    report('ais', null, 'no API key');
    return;
  }
  if (socket) return;
  socket = new WebSocket(AIS_WS_URL);
  socket.onopen = () => {
    report('ais', true);
    socket.send(JSON.stringify({
      APIKey: settings.aisKey,
      BoundingBoxes: [[[BBOX.minLat, BBOX.minLon], [BBOX.maxLat, BBOX.maxLon]]],
      FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
    }));
  };
  socket.onmessage = (e) => {
    if (typeof e.data === 'string') handleMessage(e.data);
    else e.data.text().then(handleMessage).catch(() => {});
  };
  socket.onerror = () => report('ais', false, 'socket error');
  socket.onclose = () => {
    socket = null;
    if (enabled) reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
  };
}

function disconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
}

export function init(ctx) {
  register('ais', 'Ships (AIS)', 'stream.aisstream.io');
  onSettingsChange(() => { disconnect(); if (enabled) connect(); });
  group = new THREE.Group();
  group.visible = false;
  ctx.scene.add(group);
  return group;
}

export function update(dt) {
  if (!group.visible) return;
  const now = performance.now();
  for (const v of vessels.values()) {
    if (!v.obj || !v.fix) continue;
    const ahead = Math.min(120, (now - v.fixTime) / 1000);
    const target = v.fix.clone().addScaledVector(v.vel, ahead);
    v.obj.position.lerp(target, Math.min(1, dt));
    v.obj.position.y = Math.sin(now / 900 + v.fix.x) * 0.4;
  }
}

export function setEnabled(on) {
  enabled = on;
  group.visible = on;
  if (on) {
    connect();
    pruneTimer ??= setInterval(prune, PRUNE_INTERVAL_MS);
  } else {
    disconnect();
    clearInterval(pruneTimer);
    pruneTimer = null;
  }
}

export function getCount() {
  return [...vessels.values()].filter((v) => v.obj).length;
}
