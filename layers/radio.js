import * as THREE from 'three';
import { register, report } from '../world/sources.js';
import * as towers from './towers.js';
import * as wspr from './wspr.js';
import { OUTER_HALF_M, toLocal } from '../world/geo.js';
import { makeLabel, setInfo } from '../world/markers.js';

const STATIONS_URL = 'https://de1.api.radio-browser.info/json/stations/bycountry/Japan?hidebroken=true&order=clickcount&reverse=true&limit=60';
const NOW_CHARS = 52;
const LIST_CHARS = 40;
const VOL_STEPS = 10;
const SCAN_MS = 10_000;
const SPECTRUM_MS = 70;

let group = null;
let corsAudio = null;
let plainAudio = null;
let current = null;
let analyser = null;
let analysed = false;
let playToken = 0;
let all = [];
let local = [];
let band = 'ALL';
let index = 0;
let power = false;
let scanTimer = null;
let marquee = 0;
let volume = 0.7;
let muted = false;
let focusHandler = () => {};
const markers = new Map();
const el = {};

const stations = () => (band === 'ALL' ? all : local);

function clean(s) {
  return (s || '').normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();
}

function scroll(text, width) {
  if (text.length <= width) return text.padEnd(width);
  const loop = `${text}   `;
  const start = marquee % loop.length;
  return (loop + loop).slice(start, start + width);
}

function isPlaying() {
  return power && current && !current.paused;
}

function renderNow() {
  const s = stations()[index];
  el.state.textContent = power ? (isPlaying() ? '▶ 再生' : '■ 選局') : '■ 停止';
  el.state.classList.toggle('on', isPlaying());
  el.text.textContent = power && s ? scroll(clean(s.name).toUpperCase() || 'JP STATION', NOW_CHARS) : '';
  if (s) {
    const tags = clean(s.tags).split(',').slice(0, 2).join(' ').toUpperCase();
    el.meta.textContent = `P${String(index + 1).padStart(2, '0')}/${stations().length} ${band} ${clean(s.codec) || '---'} ${s.bitrate || '---'}K ${tags}`.slice(0, NOW_CHARS + 8);
  } else {
    el.meta.textContent = band === 'LOCAL' ? 'NO STATIONS LOCATED AROUND TOKYO' : 'SEARCHING...';
  }
  const v = muted ? 0 : Math.round(volume * VOL_STEPS);
  el.volbar.innerHTML = `${'█'.repeat(v)}<span class="empty">${'░'.repeat(VOL_STEPS - v)}</span>`;
  el.power.classList.toggle('lit', power);
  el.scan.classList.toggle('lit', !!scanTimer);
  el.mute.classList.toggle('lit', muted);
  el.band.textContent = band === 'ALL' ? '全国 ALL' : '関東 LOCAL';
  el.band.classList.toggle('lit', band === 'LOCAL');
  el.goto.disabled = !markers.has(s);
  el.goto.style.opacity = markers.has(s) ? 1 : 0.5;
  el.sim.textContent = isPlaying() ? (analysed ? 'LIVE' : 'SIM') : '';
}

function renderList() {
  el.list.innerHTML = '';
  stations().forEach((s, i) => {
    const li = document.createElement('li');
    const num = i < 10 ? `${(i + 1) % 10}` : ' ';
    li.textContent = ` ${num} ${clean(s.name)}`.slice(0, LIST_CHARS);
    li.title = clean(s.name);
    li.addEventListener('click', () => tune(i, true));
    el.list.appendChild(li);
  });
  highlight();
}

function highlight() {
  [...el.list.children].forEach((li, i) => {
    li.classList.toggle('sel', i === index);
    li.classList.toggle('playing', i === index && isPlaying());
  });
  el.list.children[index]?.scrollIntoView({ block: 'nearest' });
}

function render() {
  renderNow();
  highlight();
}

function applyVolume() {
  for (const a of [corsAudio, plainAudio]) {
    a.volume = volume;
    a.muted = muted;
  }
}

function ensureAnalyser() {
  if (analyser) return;
  try {
    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(corsAudio);
    source.connect(ctx.destination);
    const split = ctx.createChannelSplitter(2);
    source.connect(split);
    const make = (rightSign) => {
      const sum = ctx.createGain();
      const l = ctx.createGain();
      const r = ctx.createGain();
      l.gain.value = 0.5;
      r.gain.value = 0.5 * rightSign;
      split.connect(l, 0);
      split.connect(r, 1);
      l.connect(sum);
      r.connect(sum);
      const a = ctx.createAnalyser();
      a.fftSize = 4096;
      a.smoothingTimeConstant = 0.7;
      sum.connect(a);
      return a;
    };
    analyser = { ctx, mid: make(1), side: make(-1) };
  } catch (e) {
    analyser = null;
    console.warn('[Radio] analyser unavailable:', e.message);
  }
}

function stopAudio() {
  for (const a of [corsAudio, plainAudio]) {
    a.onerror = null;
    a.pause();
    a.removeAttribute('src');
    a.load();
  }
}

function play() {
  const s = stations()[index];
  if (!power || !s) return;
  const token = ++playToken;
  stopAudio();
  ensureAnalyser();
  analyser?.ctx.resume();
  analysed = !!analyser;
  current = analyser ? corsAudio : plainAudio;
  const fallback = () => {
    if (token !== playToken || current === plainAudio) return;
    analysed = false;
    corsAudio.onerror = null;
    corsAudio.removeAttribute('src');
    current = plainAudio;
    plainAudio.src = s.url_resolved;
    plainAudio.play().catch((e) => console.warn('[Radio] playback failed:', e.message));
    render();
  };
  current.onerror = fallback;
  current.src = s.url_resolved;
  current.play().catch(fallback);
}

function tune(i, turnOn = false) {
  const list = stations();
  if (!list.length) return render();
  index = (i + list.length) % list.length;
  marquee = 0;
  if (turnOn && !power) power = true;
  play();
  render();
}

function setPower(on) {
  power = on;
  if (on) {
    play();
  } else {
    playToken++;
    stopAudio();
    setScan(false);
  }
  render();
}

function setScan(on) {
  clearInterval(scanTimer);
  scanTimer = on ? setInterval(() => tune(index + 1), SCAN_MS) : null;
  render();
}

function setVolume(v) {
  volume = THREE.MathUtils.clamp(v, 0, 1);
  muted = false;
  applyVolume();
  render();
}

const DOT = 3;
const MIN_HZ = 20;
const MAX_HZ = 20_000;
const MIN_DB = -95;
const MAX_DB = -15;
const COL_MID = '#f3d572';
const COL_PEAK = '#ff5ec8';
const COL_SIDE = '#5bab99';
const COL_AXIS = '#306b61';
const COL_GRID = '#164440';
let midData = null;
let sideData = null;
let cols = 0;
let rows = 0;
let midLevels = null;
let sideLevels = null;
let peakLevels = null;

function sizeSpectrum() {
  cols = Math.floor(el.spectrum.width / DOT) - 1;
  rows = Math.floor(el.spectrum.height / DOT) - 1;
  midLevels = new Float32Array(cols);
  sideLevels = new Float32Array(cols);
  peakLevels = new Float32Array(cols);
}

function sampleColumns(data, out, sampleRate) {
  const binHz = sampleRate / 2 / data.length;
  for (let c = 0; c < cols; c++) {
    const hz = MIN_HZ * (MAX_HZ / MIN_HZ) ** (c / (cols - 1));
    const f = Math.min(data.length - 1.001, hz / binHz);
    const k = Math.floor(f);
    const a = Math.max(data[k], -200);
    const db = a + (Math.max(data[k + 1], -200) - a) * (f - k);
    out[c] = THREE.MathUtils.clamp((db - MIN_DB) / (MAX_DB - MIN_DB), 0, 1);
  }
}

function simulate(time) {
  const beat = 0.75 + 0.25 * Math.max(0, Math.sin(time * 7.6)) ** 6;
  for (let c = 0; c < cols; c++) {
    const x = c / (cols - 1);
    const shape = 0.78 - 0.5 * x ** 1.6 + 0.06 * Math.sin(x * 23 + time * 1.3) + 0.04 * Math.sin(x * 61 - time * 2.1);
    const mid = shape * beat * (0.92 + 0.08 * Math.random());
    midLevels[c] += (mid - midLevels[c]) * 0.45;
    const side = Math.max(0, shape - 0.22 + 0.1 * x) * (0.8 + 0.2 * Math.random());
    sideLevels[c] += (side - sideLevels[c]) * 0.35;
  }
}

function plotDot(ctx, c, r, color) {
  ctx.fillStyle = color;
  ctx.fillRect((c + 1) * DOT, (rows - 1 - r) * DOT, DOT - 1, DOT - 1);
}

function updateSpectrum(time) {
  if (!cols) sizeSpectrum();
  const playing = isPlaying();
  if (playing && analysed && analyser) {
    midData ??= new Float32Array(analyser.mid.frequencyBinCount);
    sideData ??= new Float32Array(analyser.side.frequencyBinCount);
    analyser.mid.getFloatFrequencyData(midData);
    analyser.side.getFloatFrequencyData(sideData);
    sampleColumns(midData, midLevels, analyser.ctx.sampleRate);
    sampleColumns(sideData, sideLevels, analyser.ctx.sampleRate);
  } else if (playing) {
    simulate(time);
  } else {
    for (let c = 0; c < cols; c++) { midLevels[c] *= 0.7; sideLevels[c] *= 0.7; }
  }
  const scale = muted ? 0 : 0.45 + 0.55 * volume;
  const ctx = el.spectrum.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, el.spectrum.width, el.spectrum.height);
  for (let r = 0; r < rows; r++) plotDot(ctx, -1, r, COL_AXIS);
  for (let c = -1; c < cols; c++) plotDot(ctx, c, 0, COL_AXIS);
  for (const g of [1 / 3, 2 / 3]) {
    const gc = Math.round(g * (cols - 1));
    for (let r = 2; r < rows; r += 3) plotDot(ctx, gc, r, COL_GRID);
  }
  let prev = -1;
  for (let c = 0; c < cols; c++) {
    const side = Math.round(sideLevels[c] * scale * (rows - 2));
    for (let r = 1; r <= side; r++) if ((r + c) % 2 === 0 || r === side) plotDot(ctx, c, r, COL_SIDE);
    const peakTarget = midLevels[c] * scale;
    peakLevels[c] = Math.max(peakLevels[c] - 0.012, peakTarget);
    const pk = Math.round(peakLevels[c] * (rows - 2)) + 1;
    if (pk > 2) plotDot(ctx, c, pk, COL_PEAK);
    const y = Math.round(peakTarget * (rows - 2)) + 1;
    if (y > 1) {
      const from = prev > 1 ? Math.min(prev, y) : y;
      const to = prev > 1 ? Math.max(prev, y) : y;
      for (let r = from; r <= to; r++) if (r === y || (r !== prev)) plotDot(ctx, c, r, COL_MID);
    }
    prev = y;
  }
}

function volumeFromClick(e) {
  const r = el.volbar.getBoundingClientRect();
  setVolume(Math.round(((e.clientX - r.left) / r.width) * VOL_STEPS) / VOL_STEPS);
}

async function loadStations() {
  try {
    const res = await fetch(STATIONS_URL);
    if (!res.ok) { report('radio', false, `HTTP ${res.status}`); return; }
    report('radio', true);
    all = (await res.json()).filter((s) => s.url_resolved);
    for (const s of all) {
      if (!Number.isFinite(s.geo_lat) || !Number.isFinite(s.geo_long)) continue;
      const p = toLocal(s.geo_long, s.geo_lat);
      if (Math.abs(p.x) > OUTER_HALF_M || Math.abs(p.z) > OUTER_HALF_M) continue;
      local.push(s);
      const obj = new THREE.Object3D();
      obj.position.set(p.x, 400, p.z);
      obj.add(makeLabel(`♪ ${clean(s.name).toUpperCase().slice(0, 18)}`, {
        className: 'label-radio',
        maxDistance: 90_000,
        onClick: () => {
          band = 'ALL';
          renderList();
          tune(all.indexOf(s), true);
          focusHandler(obj);
        },
      }));
      setInfo(obj, s.name, `${s.tags || ''}<br>${s.codec || ''} ${s.bitrate ? `${s.bitrate} kbps` : ''}`);
      markers.set(s, obj);
      group.add(obj);
    }
    renderList();
    render();
  } catch (e) {
    report('radio', false, e.message);
    console.warn('[Radio] station fetch failed:', e.message);
  }
}

export function onFocus(fn) {
  focusHandler = fn;
}

export function init(ctx) {
  register('radio', 'Radio stations', 'radio-browser.info');
  group = new THREE.Group();
  group.visible = false;
  ctx.scene.add(group);

  corsAudio = new Audio();
  corsAudio.crossOrigin = 'anonymous';
  plainAudio = new Audio();
  for (const a of [corsAudio, plainAudio]) {
    a.addEventListener('playing', render);
    a.addEventListener('pause', render);
  }
  applyVolume();

  for (const id of ['state', 'text', 'meta', 'list', 'volbar', 'power', 'scan', 'band', 'mute', 'goto', 'spectrum', 'sim']) el[id] = document.getElementById(`radio-${id}`);
  const on = (id, fn) => document.getElementById(`radio-${id}`).addEventListener('click', fn);
  on('power', () => setPower(!power));
  on('prev', () => tune(index - 1));
  on('next', () => tune(index + 1));
  on('scan', () => { if (!power) setPower(true); setScan(!scanTimer); });
  on('band', () => { band = band === 'ALL' ? 'LOCAL' : 'ALL'; index = 0; renderList(); tune(0); });
  on('mute', () => { muted = !muted; applyVolume(); render(); });
  on('voldown', () => setVolume(volume - 1 / VOL_STEPS));
  on('volup', () => setVolume(volume + 1 / VOL_STEPS));
  on('goto', () => { const m = markers.get(stations()[index]); if (m) focusHandler(m); });
  el.volbar.addEventListener('click', volumeFromClick);

  window.addEventListener('keydown', (e) => {
    if (!group.visible || e.target.tagName === 'INPUT') return;
    if (/^[0-9]$/.test(e.key)) tune((Number(e.key) + 9) % 10, true);
    else if (e.key === 'p' || e.key === 'P') setPower(!power);
    else if (e.key === 'n' || e.key === 'N') { if (!power) setPower(true); setScan(!scanTimer); }
    else if (e.key === ',' || e.key === '<') tune(index - 1);
    else if (e.key === '.' || e.key === '>') tune(index + 1);
  });
  setInterval(() => { if (power) { marquee++; renderNow(); } }, 350);
  setInterval(() => { if (group.visible) updateSpectrum(performance.now() / 1000); }, SPECTRUM_MS);

  loadStations();
  wspr.init(ctx);
  towers.init(ctx);
  group.add(towers.group());
  render();
  updateSpectrum(0);
  return group;
}

export function setEnabled(on) {
  group.visible = on;
  wspr.setEnabled(on);
}

export function getCount() {
  return all.length + wspr.getCount() + towers.getCount();
}

export function update(time) {
  towers.update(time);
}
