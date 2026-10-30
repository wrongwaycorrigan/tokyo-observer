const MASK_KEY = 'tokyo-observer-crt-mask';
const SLOT_PHOSPHOR = [[255, 120, 120], [120, 255, 120], [120, 140, 255]];
const SLOT_GAP = [70, 70, 80];
const SLOT_ROWS = 4;
const GRILLE_PHOSPHOR = [[255, 110, 110], [110, 255, 110], [110, 130, 255]];
const DAMPER = 'rgb(120,120,128)';

let overlay = null;
let mask = 'slot';

function tile(w, h, colorAt) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = colorAt(x, y);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c.toDataURL();
}

function paint() {
  const k = Math.max(1, Math.round(window.devicePixelRatio || 1));
  const dpr = window.devicePixelRatio || 1;
  if (mask === 'slot') {
    const url = tile(6, SLOT_ROWS, (x, y) => {
      const gapRow = Math.floor(x / 3) === 0 ? SLOT_ROWS - 1 : 1;
      return y === gapRow ? SLOT_GAP : SLOT_PHOSPHOR[x % 3];
    });
    overlay.style.backgroundImage = `url(${url})`;
    overlay.style.backgroundSize = `${(6 * k) / dpr}px ${(SLOT_ROWS * k) / dpr}px`;
    overlay.style.backgroundRepeat = 'repeat';
    shareTile(url, overlay.style.backgroundSize);
    return;
  }
  const url = tile(GRILLE_PHOSPHOR.length, 1, (x) => GRILLE_PHOSPHOR[x]);
  const wire = (at) => `linear-gradient(to bottom, transparent ${at}%, ${DAMPER} ${at}%, ${DAMPER} calc(${at}% + ${1 / dpr}px), transparent calc(${at}% + ${1 / dpr}px))`;
  overlay.style.backgroundImage = `${wire(33.3)}, ${wire(66.7)}, url(${url})`;
  overlay.style.backgroundSize = `100% 100%, 100% 100%, ${(GRILLE_PHOSPHOR.length * k) / dpr}px ${k / dpr}px`;
  overlay.style.backgroundRepeat = 'no-repeat, no-repeat, repeat';
  shareTile(url, `${(GRILLE_PHOSPHOR.length * k) / dpr}px ${k / dpr}px`);
}

function shareTile(url, size) {
  document.documentElement.style.setProperty('--crt-tile', `url(${url})`);
  document.documentElement.style.setProperty('--crt-tile-size', size);
}

export function initCrt() {
  try { mask = localStorage.getItem(MASK_KEY) === 'trinitron' ? 'trinitron' : 'slot'; } catch {}
  overlay = document.createElement('div');
  overlay.id = 'crt';
  overlay.setAttribute('aria-hidden', 'true');
  document.body.appendChild(overlay);
  document.documentElement.classList.add('crt');
  paint();
  let lastDpr = window.devicePixelRatio;
  window.addEventListener('resize', () => {
    if (window.devicePixelRatio !== lastDpr) {
      lastDpr = window.devicePixelRatio;
      paint();
    }
  });
}

export function crtMask() {
  return mask;
}

export function setCrtMask(next) {
  mask = next;
  try { localStorage.setItem(MASK_KEY, next); } catch {}
  paint();
}
