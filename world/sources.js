const STORAGE_KEY = 'tokyo-observer-sources';

const DEFAULTS = {
  adsbUrl: 'http://192.168.1.14/tar1090/data/aircraft.json',
  aisKey: '',
  feeds: [],
};

function load() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    saved = {};
  }
  return {
    ...DEFAULTS,
    aisKey: window.AISSTREAM_API_KEY && window.AISSTREAM_API_KEY !== 'token' ? window.AISSTREAM_API_KEY : '',
    ...saved,
  };
}

export const settings = load();

const status = new Map();
const listeners = new Set();

export function onSourcesChange(fn) {
  listeners.add(fn);
}

function emit() {
  for (const fn of listeners) fn();
}

export function saveSettings(next, { persist = true } = {}) {
  Object.assign(settings, next);
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      console.warn('[Sources] could not save settings in this browser');
    }
  }
  for (const fn of settingsListeners) fn(settings);
  emit();
}

const settingsListeners = new Set();
export function onSettingsChange(fn) {
  settingsListeners.add(fn);
}

export function register(id, name, url, { optional = false } = {}) {
  if (!status.has(id)) status.set(id, { id, name, url, state: 'off', detail: 'idle', time: 0, optional });
  emit();
}

export function report(id, ok, detail = '') {
  const s = status.get(id);
  if (!s) return;
  s.state = ok === null ? 'off' : ok ? 'ok' : 'err';
  s.detail = detail;
  s.time = Date.now();
  emit();
}

export function unregister(id) {
  status.delete(id);
  emit();
}

export function sources() {
  return [...status.values()];
}

export function summary() {
  const live = sources().filter((s) => s.state !== 'off');
  const ok = live.filter((s) => s.state === 'ok').length;
  const err = live.filter((s) => s.state === 'err').length;
  return { ok, err, total: live.length };
}
