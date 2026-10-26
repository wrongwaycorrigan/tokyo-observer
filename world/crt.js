const STORAGE_KEY = 'tokyo-observer-crt';
const PHOSPHOR = [[255, 120, 120], [120, 255, 120], [120, 140, 255]];
const GAP = [70, 70, 80];
const ROWS = 4;

let overlay = null;
let enabled = true;

function paint() {
  const k = Math.max(1, Math.round(window.devicePixelRatio || 1));
  const w = 6;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = ROWS;
  const ctx = c.getContext('2d');
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < w; x++) {
      const triad = Math.floor(x / 3);
      const gapRow = triad === 0 ? ROWS - 1 : 1;
      const [r, g, b] = y === gapRow ? GAP : PHOSPHOR[x % 3];
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const dpr = window.devicePixelRatio || 1;
  overlay.style.backgroundImage = `url(${c.toDataURL()})`;
  overlay.style.backgroundSize = `${(w * k) / dpr}px ${(ROWS * k) / dpr}px`;
}

function apply() {
  overlay.hidden = !enabled;
  document.documentElement.classList.toggle('crt', enabled);
}

export function initCrt() {
  try { enabled = localStorage.getItem(STORAGE_KEY) !== 'off'; } catch {}
  overlay = document.createElement('div');
  overlay.id = 'crt';
  overlay.setAttribute('aria-hidden', 'true');
  document.body.appendChild(overlay);
  paint();
  apply();
  let lastDpr = window.devicePixelRatio;
  window.addEventListener('resize', () => {
    if (window.devicePixelRatio !== lastDpr) {
      lastDpr = window.devicePixelRatio;
      paint();
    }
  });
}

export function crtEnabled() {
  return enabled;
}

export function setCrt(on) {
  enabled = on;
  try { localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off'); } catch {}
  apply();
}
