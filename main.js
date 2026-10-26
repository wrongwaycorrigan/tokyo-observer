import './world/color.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { INNER_HALF_M, toLonLat } from './world/geo.js';
import { SHARED } from './world/shading.js';
import { PostPass } from './world/post.js';
import { COVER, Terrain } from './world/terrain.js';
import { createWater } from './world/water.js';
import { Sky } from './world/sky.js';
import { Stars } from './world/stars.js';
import { City } from './world/city.js';
import { Roads } from './world/roads.js';
import { Trees } from './world/trees.js';
import { Runways } from './world/runways.js';
import { Terminals } from './world/terminals.js';
import { Port } from './world/port.js';
import { loadPlateau } from './world/models.js';
import { startWarnings, warningsHtml } from './world/warnings.js';
import { crtEnabled, initCrt, setCrt } from './world/crt.js';
import { Weather, describe } from './world/weather.js';
import { Ambience } from './world/audio.js';
import { AirQuality } from './world/airquality.js';
import { Radar } from './world/radar.js';
import { Tide } from './world/tide.js';
import { updateRainShafts } from './world/rainshaft.js';
import { onSourcesChange, saveSettings, settings, sources, summary } from './world/sources.js';
import * as feeds from './layers/feeds.js';
import * as airports from './layers/airports.js';
import { onLabelClick, pick, updateMarkers } from './world/markers.js';
import * as traffic from './layers/traffic.js';
import * as ports from './layers/ports.js';
import * as radio from './layers/radio.js';
import * as radiosondes from './layers/radiosondes.js';
import * as quakes from './layers/quakes.js';
import * as iss from './layers/iss.js';
import { moonPhase } from './layers/moonBadge.js';
import { bootError, finishBoot, stage, startBoot } from './world/boot.js';

const START_POSITION = new THREE.Vector3(-9_000, 13_500, 40_000);
const IDLE_ROTATE_MS = 20_000;
const MAX_ALTITUDE_M = 60_000;
const TOUR_FIRST_MS = 120_000;
const TOUR_MIN_MS = 150_000;
const TOUR_MAX_MS = 240_000;
const TOUR_FADE_MS = 1_600;
const FRAME_MS = 1000 / 30;

const LAYERS = {
  air: { module: traffic, title: 'AIR TRAFFIC', on: true },
  sea: { module: ports, title: 'TOKYO BAY', on: true },
  sonde: { module: radiosondes, title: 'RADIOSONDES', on: true },
  radio: { module: radio, title: 'RADIO', on: false },
  quake: { module: quakes, title: 'EARTHQUAKES', on: false },
};

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const RAIN_AUDITION = params.has('rain') ? THREE.MathUtils.clamp(Number(params.get('rain')) || 0, 0, 1) : -1;


async function main() {
  startBoot();
  await document.fonts.load('16px DotGothic16').catch(() => {});

  initCrt();
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  $('viewport').appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  labels.domElement.className = 'label-layer';
  $('viewport').appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffffff, 1, 2);
  const camera = new THREE.PerspectiveCamera(50, 1, 5, 1_200_000);
  camera.position.copy(START_POSITION);
  const post = new PostPass(renderer);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 600;
  controls.maxDistance = 90_000;
  controls.maxPolarAngle = 1.5;
  controls.screenSpacePanning = false;
  controls.autoRotateSpeed = 0.25;
  let lastInteraction = performance.now();
  controls.addEventListener('start', () => { lastInteraction = performance.now(); controls.autoRotate = false; });

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    labels.setSize(w, h);
    post.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  const sky = new Sky();
  sky.timeOffsetH = Number(params.get('hours')) || 0;
  scene.add(sky.mesh);
  const stars = new Stars(sky);
  scene.add(stars.points);
  const water = createWater();
  scene.add(water);

  let ready = false;
  const clock = new THREE.Clock();
  let lastFrame = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (now - lastFrame < FRAME_MS - 1) return;
    lastFrame = now - ((now - lastFrame) % FRAME_MS);
    const dt = Math.min(clock.getDelta(), 0.1);
    const time = clock.elapsedTime;
    SHARED.uTime.value = time;
    sky.update(camera, dt);
    stars.update(camera);
    scene.fog.color.copy(SHARED.uFogColor.value);
    scene.fog.near = SHARED.uFogNear.value;
    scene.fog.far = SHARED.uFogFar.value;
    if (ready) tick(dt, time);
    controls.update();
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -INNER_HALF_M, INNER_HALF_M);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -INNER_HALF_M, INNER_HALF_M);
    camera.position.y = Math.min(camera.position.y, MAX_ALTITUDE_M);
    post.render(scene, camera);
    labels.render(scene, camera);
  }
  requestAnimationFrame(frame);

  stage('terrain');
  const terrain = new Terrain();
  await terrain.load();
  water.userData.setShore(terrain.shoreTexture());
  scene.add(terrain.group);
  stage('runways');
  const runways = new Runways(terrain);
  await runways.load();
  scene.add(runways.group);
  const terminals = new Terminals(terrain);
  await terminals.load();
  scene.add(terminals.group);
  const port = new Port(terrain);
  await port.load();
  scene.add(port.group);
  const clearOf = (x, z) => runways.covers(x, z) || port.covers(x, z);
  await loadPlateau();
  stage('city');
  await new Promise((r) => setTimeout(r, 200));
  const city = new City(terrain, clearOf);
  city.build();
  scene.add(city.group);
  stage('trees');
  await new Promise((r) => setTimeout(r, 200));
  const trees = new Trees(terrain, clearOf);
  trees.build();
  scene.add(trees.group);
  stage('roads');
  const roads = new Roads(terrain, (x, z) => runways.covers(x, z));
  await roads.load().catch((e) => console.warn('[Roads] failed to load:', e.message));
  scene.add(roads.group);

  const weather = new Weather(sky);
  scene.add(weather.group);
  const ambience = new Ambience();
  const ctx = { scene, terrain, camera };
  const pickRoots = [...city.landmarks, ...port.cranes];
  for (const layer of Object.values(LAYERS)) {
    layer.group = layer.module.init(ctx);
    pickRoots.push(layer.group);
  }
  pickRoots.push(iss.init(ctx));

  pickRoots.push(ports.alwaysOn(), ports.ships());
  pickRoots.push(feeds.init(ctx));
  pickRoots.push(airports.init(ctx));
  const airQuality = new AirQuality(terrain);
  scene.add(airQuality.group);
  pickRoots.push(airQuality.group);
  airQuality.start();
  const radar = new Radar();
  scene.add(radar.group);
  radar.start();
  const tide = new Tide();
  tide.start();
  weather.onChange(updatePanels);
  weather.start();
  startWarnings();

  function setLayer(key, on) {
    const layer = LAYERS[key];
    layer.on = on;
    layer.module.setEnabled(on);
    $(`menu-${key}`).classList.toggle('active', on);
    $(`panel-${key}`).classList.toggle('hidden', !on);
    updatePanels();
  }
  for (const key of Object.keys(LAYERS)) {
    $(`menu-${key}`).addEventListener('click', () => setLayer(key, !LAYERS[key].on));
    setLayer(key, LAYERS[key].on);
  }
  const WX_KEY = 'tokyo-observer-weather-panel';
  let wxOn = true;
  try { wxOn = localStorage.getItem(WX_KEY) !== 'off'; } catch {}
  function setWeatherPanel(on) {
    wxOn = on;
    try { localStorage.setItem(WX_KEY, on ? 'on' : 'off'); } catch {}
    $('panel-wx').classList.toggle('hidden', !on);
    $('menu-wx').classList.toggle('active', on);
  }
  $('menu-wx').addEventListener('click', () => setWeatherPanel(!wxOn));
  setWeatherPanel(wxOn);
  const SOUND_KEY = 'tokyo-observer-sound';
  let soundWanted = true;
  try { soundWanted = localStorage.getItem(SOUND_KEY) !== 'off'; } catch {}
  const soundPlaying = () => ambience.running && ambience.ctx?.state === 'running';
  function renderSound() {
    const btn = $('sound-toggle');
    const waiting = soundWanted && !soundPlaying();
    btn.textContent = soundWanted ? '\u266A AMBIENCE ON' : '\u266A AMBIENCE OFF';
    btn.classList.toggle('off', !soundWanted);
    btn.classList.toggle('waiting', waiting);
    btn.title = waiting ? 'Ambient sea and sky sounds' : soundWanted ? 'Turn sound off (M)' : 'Turn sound on (M)';
  }
  function setSound(on) {
    soundWanted = on;
    try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch {}
    if (on) ambience.start();
    else ambience.stop();
    renderSound();
  }
  function toggleSound() {
    if (soundWanted && !soundPlaying()) ambience.start();
    else setSound(!soundWanted);
    renderSound();
  }
  const wakeSound = (e) => {
    if (e.target.closest?.('#sound-toggle')) return;
    if (soundWanted && !soundPlaying()) ambience.start();
    renderSound();
  };
  window.addEventListener('pointerdown', wakeSound);
  window.addEventListener('keydown', wakeSound);
  $('sound-toggle').addEventListener('click', toggleSound);
  if (soundWanted) ambience.start();
  ambience.ctx?.addEventListener('statechange', renderSound);
  renderSound();

  const escapeHtml = (v) => String(v ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  function feedRow(feed = {}) {
    const row = document.createElement('div');
    row.className = 'feed-row';
    row.innerHTML = `<input class="f-name" placeholder="NAME" spellcheck="false"><input class="f-url" type="url" placeholder="https://..." spellcheck="false"><input class="f-sec" type="number" min="15" placeholder="SEC"><button class="dosbtn f-del" title="Remove feed">X</button>`;
    row.querySelector('.f-name').value = feed.name ?? '';
    row.querySelector('.f-url').value = feed.url ?? '';
    row.querySelector('.f-sec').value = feed.refresh ?? 60;
    row.querySelector('.f-del').addEventListener('click', () => {
      row.remove();
      if (!$('src-feeds').children.length) feedRow();
    });
    $('src-feeds').appendChild(row);
    return row;
  }
  function renderSourceTable() {
    const label = { ok: 'OK', err: 'ERR', wait: '...', off: 'OFF' };
    $('sources-table').innerHTML = sources().map((src) => `<tr><td class="st-${src.state}">&#9679; ${label[src.state]}</td><td>${escapeHtml(src.name.toUpperCase())}</td><td class="host">${escapeHtml(src.url)}</td><td class="detail">${escapeHtml(src.detail)}</td></tr>`).join('');
  }
  function openSources() {
    $('crt-toggle').checked = crtEnabled();
    $('crt-state').textContent = crtEnabled() ? 'ON' : 'OFF';
    $('src-adsb').value = settings.adsbUrl ?? '';
    $('src-ais').value = settings.aisKey ?? '';
    $('src-feeds').innerHTML = '';
    for (const f of settings.feeds ?? []) feedRow(f);
    feedRow();
    $('src-note').textContent = 'Stored in this browser only.';
    renderSourceTable();
    $('sources').classList.remove('hidden');
  }
  function closeSources() {
    $('sources').classList.add('hidden');
  }
  function readSources() {
    const feedsList = [...$('src-feeds').querySelectorAll('.feed-row')].map((row) => ({
      name: row.querySelector('.f-name').value.trim() || 'FEED',
      url: row.querySelector('.f-url').value.trim(),
      refresh: Number(row.querySelector('.f-sec').value) || 60,
    })).filter((f) => /^https?:\/\//i.test(f.url));
    return { adsbUrl: $('src-adsb').value.trim(), aisKey: $('src-ais').value.trim(), feeds: feedsList };
  }
  function applySources() {
    saveSettings(readSources(), { persist: false });
    $('src-note').textContent = 'Applied for this session. Save to keep.';
    renderSourceTable();
  }
  function saveSources() {
    saveSettings(readSources());
    closeSources();
  }
  function updateIndicator() {
    const { ok, err, total } = summary();
    const dot = $('connect-dot');
    dot.className = err === 0 && ok > 0 ? 'ok' : ok === 0 && total > 0 ? 'bad' : 'warn';
    $('menu-connect').title = `Settings and data sources (L): ${ok} of ${total} working`;
    if (!$('sources').classList.contains('hidden')) renderSourceTable();
  }
  onSourcesChange(updateIndicator);
  updateIndicator();
  $('menu-connect').addEventListener('click', () => ($('sources').classList.contains('hidden') ? openSources() : closeSources()));
  $('sources-close').addEventListener('click', closeSources);
  $('crt-toggle').addEventListener('change', (e) => {
    setCrt(e.target.checked);
    $('crt-state').textContent = e.target.checked ? 'ON' : 'OFF';
  });
  $('radio-close').addEventListener('click', () => setLayer('radio', false));
  $('src-cancel').addEventListener('click', closeSources);
  $('src-save').addEventListener('click', saveSources);
  $('src-apply').addEventListener('click', applySources);
  $('src-add').addEventListener('click', () => feedRow());

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (!$('sources').classList.contains('hidden')) {
      if (e.key === 'Escape') closeSources();
      else if (e.key.toLowerCase() === 'a') feedRow().querySelector('.f-name').focus();
      else if (e.key.toLowerCase() === 'p') applySources();
      else if (e.key.toLowerCase() === 's') saveSources();
      return;
    }
    const map = { a: 'menu-air', s: 'menu-sea', o: 'menu-sonde', b: 'menu-radio', q: 'menu-quake', w: 'menu-wx', h: 'menu-home', l: 'menu-connect', m: 'sound-toggle' };
    const id = map[e.key.toLowerCase()];
    if (id) $(id).click();
    if (e.key === 'Escape') $('info').classList.add('hidden');
  });

  function showInfo(obj) {
    if (!obj) {
      $('info').classList.add('hidden');
      return;
    }
    $('info-title').textContent = obj.userData.info.title;
    $('info-body').innerHTML = obj.userData.info.body;
    $('info').classList.remove('hidden');
  }
  let focusObj = null;
  const focusPoint = new THREE.Vector3();
  let zoomTo = null;
  let homing = false;
  const HOME = { target: new THREE.Vector3(0, 0, 0), distance: START_POSITION.length() };

  function setFocus(obj) {
    if (!obj) return;
    focusObj = obj;
    homing = false;
    lastInteraction = performance.now();
    controls.autoRotate = false;
    const d = camera.position.distanceTo(controls.target);
    zoomTo = d > 14_000 ? 8_000 : null;
    if (obj.userData.info) showInfo(obj);
  }

  function goHome() {
    focusObj = null;
    homing = true;
    focusPoint.copy(HOME.target);
    zoomTo = HOME.distance;
    showInfo(null);
  }

  let tourNext = performance.now() + TOUR_FIRST_MS;
  let tourCuts = 0;
  let tourLast = null;
  let cutting = false;
  const _tp = new THREE.Vector3();

  function tourCandidates() {
    const out = [];
    const consider = (o, weight) => {
      if (!o.visible || !o.userData.info || o === tourLast) return;
      o.getWorldPosition(_tp);
      if (Math.abs(_tp.x) > INNER_HALF_M || Math.abs(_tp.z) > INNER_HALF_M) return;
      out.push({ o, weight });
    };
    for (const root of pickRoots) {
      if (!root.visible) continue;
      consider(root, 1);
      root.traverse((c) => {
        if (c === root || c.isCSS2DObject) return;
        consider(c, root === LAYERS.air.group || root === ports.ships() ? 3 : 1);
      });
    }
    return out;
  }

  function placeCamera(target, distance) {
    const heading = Math.random() * Math.PI * 2;
    const pitch = THREE.MathUtils.degToRad(14 + Math.random() * 18);
    controls.target.copy(target);
    camera.position.set(
      target.x + Math.sin(heading) * Math.cos(pitch) * distance,
      target.y + Math.sin(pitch) * distance,
      target.z + Math.cos(heading) * Math.cos(pitch) * distance,
    );
    focusPoint.copy(target);
    controls.update();
  }

  function tourCut() {
    const pool = tourCandidates();
    const home = tourCuts % 4 === 3 || !pool.length;
    let pick = null;
    if (!home) {
      let r = Math.random() * pool.reduce((n, p) => n + p.weight, 0);
      for (const p of pool) {
        r -= p.weight;
        if (r <= 0) { pick = p.o; break; }
      }
      pick ??= pool[pool.length - 1].o;
    }
    cutting = true;
    $('cut').classList.add('dark');
    setTimeout(() => {
      zoomTo = null;
      homing = false;
      if (pick) {
        focusObj = pick;
        tourLast = pick;
        pick.getWorldPosition(_tp);
        _tp.y = Math.max(0, _tp.y);
        placeCamera(_tp, 2_500 + Math.random() * 4_000);
      } else {
        focusObj = null;
        tourLast = null;
        controls.target.copy(HOME.target);
        camera.position.copy(START_POSITION);
        focusPoint.copy(HOME.target);
        controls.update();
      }
      tourCuts++;
      $('cut').classList.remove('dark');
      cutting = false;
    }, TOUR_FADE_MS);
  }

  function tourTick(now) {
    if (now - lastInteraction < IDLE_ROTATE_MS) {
      tourNext = Math.max(tourNext, now + TOUR_FIRST_MS);
      return;
    }
    if (cutting || now < tourNext || !$('sources').classList.contains('hidden')) return;
    tourNext = now + TOUR_MIN_MS + Math.random() * (TOUR_MAX_MS - TOUR_MIN_MS);
    tourCut();
  }

  onLabelClick(setFocus);
  radio.onFocus(setFocus);
  $('menu-home').addEventListener('click', goHome);
  $('info-close').addEventListener('click', () => showInfo(null));
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    downAt = [e.clientX, e.clientY];
    if (e.button === 2 || e.shiftKey || e.ctrlKey || e.metaKey) {
      focusObj = null;
      zoomTo = null;
      homing = false;
    }
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
    const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    const hit = pick(camera, ndc, pickRoots.filter((r) => r.visible));
    if (hit) setFocus(hit); else showInfo(null);
  });
  renderer.domElement.addEventListener('wheel', () => { zoomTo = null; }, { passive: true });

  const _offset = new THREE.Vector3();
  const _step = new THREE.Vector3();
  let audioTimer = 0;
  function sampleSurface() {
    const t = controls.target;
    const r = Math.max(400, camera.position.distanceTo(t) * 0.25);
    let waterN = 0; let cityN = 0; let n = 0;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const x = t.x + i * r; const z = t.z + j * r;
        const { lon, lat } = toLonLat(x, z);
        const c = terrain.heightAt(x, z) <= 0 ? COVER.WATER : terrain.coverAt(lon, lat);
        if (c === COVER.WATER || c === COVER.NONE) waterN++;
        else if (c === COVER.BUILT) cityN++;
        n++;
      }
    }
    return { water: waterN / n, city: cityN / n };
  }

  function tick(dt, time) {
    if (performance.now() - lastInteraction > IDLE_ROTATE_MS) controls.autoRotate = true;
    tourTick(performance.now());
    if (focusObj) {
      focusObj.getWorldPosition(focusPoint);
      focusPoint.y = Math.max(0, focusPoint.y);
      if (!focusObj.parent || Math.abs(focusPoint.x) > INNER_HALF_M || Math.abs(focusPoint.z) > INNER_HALF_M) goHome();
    } else if (!homing) {
      focusPoint.copy(controls.target);
    } else if (focusPoint.distanceTo(controls.target) < 5) {
      homing = false;
    }
    _step.subVectors(focusPoint, controls.target).multiplyScalar(Math.min(1, dt * 3));
    controls.target.add(_step);
    camera.position.add(_step);
    controls.target.x = THREE.MathUtils.clamp(controls.target.x, -INNER_HALF_M, INNER_HALF_M);
    controls.target.z = THREE.MathUtils.clamp(controls.target.z, -INNER_HALF_M, INNER_HALF_M);
    if (zoomTo) {
      _offset.subVectors(camera.position, controls.target);
      const d = _offset.length();
      const next = THREE.MathUtils.lerp(d, zoomTo, Math.min(1, dt * 2));
      camera.position.copy(controls.target).addScaledVector(_offset.normalize(), next);
      if (Math.abs(next - zoomTo) < 50) zoomTo = null;
    }
    const ground = terrain.heightAt(camera.position.x, camera.position.z);
    if (camera.position.y < ground + 80) camera.position.y = ground + 80;
    const above = camera.position.y - Math.max(ground, 0);
    camera.near = THREE.MathUtils.clamp(above * 0.2, 2, 400);
    camera.updateProjectionMatrix();

    city.update(camera);
    trees.update(camera);
    roads.update(dt);
    runways.update();
    weather.update(camera, dt);
    radar.update(camera);
    updateRainShafts(camera, time);
    SHARED.uFogNear.value = weather.fogNear;
    SHARED.uFogFar.value = weather.fogFar;
    water.position.y = tide.level() * 2;
    water.material.uniforms.uWind.value = weather.windSpeedMs;
    traffic.update(dt);
    ports.update(dt, camera, time);
    radiosondes.update(dt, camera, time);
    quakes.update(dt, camera, time);
    radio.update(time);
    airports.update(time);
    updateMarkers(camera, window.innerHeight);

    audioTimer -= dt;
    if (audioTimer <= 0) {
      audioTimer = 0.25;
      const s = sampleSurface();
      const bayNear = 1 - THREE.MathUtils.smoothstep(Math.hypot(controls.target.x, controls.target.z), 4_000, 45_000);
      const height = 1 - 0.7 * THREE.MathUtils.smoothstep(above, 1_500, 60_000);
      const raining = weather.rain.visible ? THREE.MathUtils.clamp(0.35 + weather.precipitation / 4, 0, 1) : 0;
      const rainSound = RAIN_AUDITION >= 0 ? RAIN_AUDITION : raining * (1 - THREE.MathUtils.smoothstep(above, 1_500, 3_000));
      ambience.update({ proximity: THREE.MathUtils.clamp((0.6 * s.water + 0.4 * bayNear) * height, 0, 1), altitude: above, rain: rainSound });
      updateStatus(above);
      hideLabelsUnderWindows();
    }
  }

  function hideLabelsUnderWindows() {
    const rects = [...document.querySelectorAll('.window:not(.hidden)')].map((w) => w.getBoundingClientRect());
    for (const el of document.querySelectorAll('.map-label')) {
      if (el.style.display === 'none') continue;
      const r = el.getBoundingClientRect();
      const covered = rects.some((w) => r.right > w.left - 4 && r.left < w.right + 12 && r.bottom > w.top - 4 && r.top < w.bottom + 12);
      el.style.visibility = covered ? 'hidden' : '';
    }
  }

  function updateStatus(altitude) {
    const now = sky.now();
    const jst = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });
    const el = sky.sun.elevation;
    const phase = el > 6 ? 'DAY' : el > -6 ? (sky.sun.azimuth < 180 ? 'DAWN' : 'DUSK') : 'NIGHT';
    const heading = ((Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z) * 180) / Math.PI + 180 + 360) % 360;
    const w = weather.state;
    const wx = w ? `${Math.round(w.temperature_2m)}°C ${describe(w.weather_code).toUpperCase()}` : 'WX ---';
    const moon = moonPhase();
    const issText = iss.status.distanceKm == null ? 'ISS ---' : iss.status.visible ? `ISS OVERHEAD ${Math.round(iss.status.elevation)}°` : `ISS ${Math.round(iss.status.distanceKm).toLocaleString('en-US')}KM`;
    $('status-text').textContent = ` ${jst} JST │ ${phase} │ ${wx} │ ALT ${Math.round(altitude).toLocaleString('en-US')}M │ HDG ${String(Math.round(heading)).padStart(3, '0')} │ MOON ${moon.illuminationPct}% │ ${issText}${focusObj?.userData.info ? ` │ FOLLOW ${focusObj.userData.info.title.toUpperCase()}` : ''}`;
  }

  function updatePanels() {
    for (const [key, layer] of Object.entries(LAYERS)) {
      const c = $(`count-${key}`);
      if (c) c.textContent = layer.module.getCount();
    }
    $('ais-status').textContent = settings.aisKey ? 'AIS CONNECTED' : 'AIS DISCONNECTED';
    const lvl = tide.level();
    $('tide-status').textContent = `TIDE ${lvl >= 0 ? '+' : ''}${lvl.toFixed(2)}M ${tide.trend() >= 0 ? 'RISING' : 'FALLING'}`;
    $('wx-extra').innerHTML = `${airQuality.summary()}<br>RADAR ${radar.count ? `${radar.count} RAIN CELLS` : 'NO RAIN'}<br>${warningsHtml()}`;
    const list = $('quake-list');
    const items = quakes.getRecent(5);
    list.innerHTML = '';
    if (!items.length) list.innerHTML = '<li>NO NEARBY QUAKES</li>';
    for (const q of items) {
      const li = document.createElement('li');
      li.textContent = `${q.place.slice(0, 13).padEnd(13)} ${q.mag}${q.shindo ? ` 震${q.shindo}` : ''} ${q.time}`;
      if (q.obj) {
        li.className = 'quake-go';
        li.title = 'Fly to this earthquake';
        li.addEventListener('click', () => setFocus(q.obj));
      } else {
        const away = document.createElement('span');
        away.className = 'quake-away';
        away.textContent = `
  ${q.away} OF THE BAY`;
        li.appendChild(away);
        li.title = 'Beyond the camera boundary';
      }
      list.appendChild(li);
    }
    const w = weather.state;
    if (w) {
      $('wx-body').innerHTML = [
        `${describe(w.weather_code).toUpperCase()}`,
        `TEMP ${w.temperature_2m.toFixed(1)}°C  RH ${w.relative_humidity_2m}%`,
        `CLOUD ${w.cloud_cover}%  VIS ${(w.visibility / 1000).toFixed(0)}KM`,
        `WIND ${Math.round(w.wind_speed_10m)}KM/H FROM ${Math.round(w.wind_direction_10m)}°`,
        `PRECIP ${w.precipitation.toFixed(1)}MM`,
      ].join('<br>');
    }
  }
  setInterval(updatePanels, 2000);

  await finishBoot();
  $('loading').classList.add('done');
  ready = true;
}

main().catch((e) => {
  console.error(e);
  bootError(e.message);
});
