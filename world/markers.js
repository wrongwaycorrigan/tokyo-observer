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

export function makeLabel(text, { className = '', maxDistance = Infinity, offsetY = 0, onClick = null } = {}) {
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
  labels.add(label);
  return label;
}

export function setInfo(obj, title, body = '') {
  obj.userData.info = { title, body };
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
  for (const label of labels) {
    if (!label.parent) continue;
    let shown = true;
    for (let o = label.parent; o; o = o.parent) if (!o.visible) { shown = false; break; }
    if (!shown) { label.visible = false; continue; }
    label.getWorldPosition(_v);
    label.visible = _v.distanceTo(camera.position) < label.userData.maxDistance;
  }
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
