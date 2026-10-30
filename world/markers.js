import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const scaled = new Set();
const labels = new Set();
const _v = new THREE.Vector3();

export function keepVisible(obj, lengthM, minPx = 22, maxScale = 400, baseScale = 1) {
  obj.userData.keep = { lengthM, minPx, maxScale, baseScale };
  scaled.add(obj);
  return obj;
}

export function forget(obj) {
  scaled.delete(obj);
  obj.traverse((o) => { if (o.isCSS2DObject) { labels.delete(o); o.element.remove(); } });
}

let labelClick = () => {};
export function onLabelClick(fn) { labelClick = fn; }

export function makeLabel(text, { className = '', maxDistance = Infinity, offsetY = 0, onClick = null, priority = 1 } = {}) {
  const el = document.createElement('div');
  el.className = `map-label ${className}`;
  el.textContent = text;
  if (onClick) {
    el.classList.add('clickable');
    el.addEventListener('pointerdown', (e) => { e.stopPropagation(); onClick(); });
  }
  const label = new CSS2DObject(el);
  el.addEventListener('click', (e) => {
    let o = label.parent;
    while (o && !o.userData.info) o = o.parent;
    if (o && !onClick) { e.stopPropagation(); labelClick(o); }
  });
  label.position.y = offsetY;
  label.userData.maxDistance = maxDistance;
  label.userData.priority = priority;
  labels.add(label);
  return label;
}

export function setInfo(obj, title, body = '', action = null) {
  obj.userData.info = { title, body, action };
  obj.traverse((o) => { o.userData.pickTarget = obj; });
  return obj;
}

export function updateMarkers(camera, viewportHeight) {
  const k = viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
  for (const obj of scaled) {
    if (!obj.parent) continue;
    const { lengthM, minPx, maxScale, baseScale } = obj.userData.keep;
    obj.getWorldPosition(_v);
    const dist = _v.distanceTo(camera.position);
    const reach = (lengthM * baseScale * k) / minPx;
    const grow = dist > reach ? (dist / reach) ** 0.7 : 1;
    obj.scale.setScalar(Math.min(maxScale, baseScale * grow));
  }
  const width = viewportHeight * camera.aspect;
  const shown = [];
  for (const label of labels) {
    if (!label.parent) continue;
    label.visible = false;
    let on = true;
    for (let o = label.parent; o; o = o.parent) if (!o.visible) { on = false; break; }
    if (!on) continue;
    label.getWorldPosition(_v);
    const dist = _v.distanceTo(camera.position);
    if (dist >= label.userData.maxDistance) continue;
    _v.project(camera);
    if (_v.z < -1 || _v.z > 1 || Math.abs(_v.x) > 1.2 || Math.abs(_v.y) > 1.2) continue;
    shown.push({ label, dist: label.userData.placed ? dist * 0.7 : dist, x: ((_v.x + 1) / 2) * width, y: ((1 - _v.y) / 2) * viewportHeight - 12 });
  }
  shown.sort((a, b) => b.label.userData.priority - a.label.userData.priority || a.dist - b.dist);
  const placed = [];
  for (const s of shown) {
    const { w, h } = labelSize(s.label);
    const box = [s.x - w / 2 - LABEL_GAP, s.y - h / 2 - LABEL_GAP, s.x + w / 2 + LABEL_GAP, s.y + h / 2 + LABEL_GAP];
    s.label.userData.placed = !placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1]);
    if (!s.label.userData.placed) continue;
    placed.push(box);
    s.label.visible = true;
  }
}

const LABEL_GAP = 2;
function labelSize(label) {
  const el = label.element;
  const text = el.textContent;
  const c = label.userData.size;
  if (c && c.text.length === text.length && c.measured) return c;
  const w = el.offsetWidth;
  const size = w > 0
    ? { text, w, h: el.offsetHeight, measured: true }
    : { text, w: [...text].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2000 ? 16 : 8), 0), h: 18, measured: false };
  label.userData.size = size;
  return size;
}

const raycaster = new THREE.Raycaster();
export function pick(camera, ndc, roots) {
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(roots.filter((r) => r.visible), true);
  for (const h of hits) {
    let hidden = false;
    for (let p = h.object; p; p = p.parent) if (!p.visible) { hidden = true; break; }
    if (hidden) continue;
    let o = h.object;
    while (o && !o.userData.info) o = o.userData.pickTarget ?? o.parent;
    if (o?.userData.info) return o;
    if (h.object.userData.surface) return null;
  }
  return null;
}
