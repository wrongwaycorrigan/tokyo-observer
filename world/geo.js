export const CENTER = { lon: 139.82, lat: 35.5 };

export const INNER_HALF_M = 70_000;
export const EDGE_FEATHER_M = 10_000;

export function edgeFade(x, z) {
  const t = Math.min(1, Math.max(0, (INNER_HALF_M - Math.max(Math.abs(x), Math.abs(z))) / EDGE_FEATHER_M));
  return t * t * (3 - 2 * t);
}

export const OUTER_HALF_M = 220_000;

const R = 6378137;
const DEG = Math.PI / 180;
const COS0 = Math.cos(CENTER.lat * DEG);

export function toLocal(lon, lat, alt = 0, out = { x: 0, y: 0, z: 0 }) {
  out.x = (lon - CENTER.lon) * DEG * R * COS0;
  out.y = alt;
  out.z = -(lat - CENTER.lat) * DEG * R;
  return out;
}

export function toLonLat(x, z) {
  return {
    lon: CENTER.lon + x / (DEG * R * COS0),
    lat: CENTER.lat - z / (DEG * R),
  };
}

export function bboxForHalfSize(half) {
  const a = toLonLat(-half, half);
  const b = toLonLat(half, -half);
  return { minLon: a.lon, minLat: a.lat, maxLon: b.lon, maxLat: b.lat };
}

export const INNER_BBOX = bboxForHalfSize(INNER_HALF_M);

export function insideInner(lon, lat) {
  return lon >= INNER_BBOX.minLon && lon <= INNER_BBOX.maxLon
    && lat >= INNER_BBOX.minLat && lat <= INNER_BBOX.maxLat;
}

export function lonLatToTilePx(lon, lat, z) {
  const n = 2 ** z * 256;
  const s = Math.sin(lat * DEG);
  return {
    x: ((lon + 180) / 360) * n,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n,
  };
}

export function tileRange(bbox, z) {
  const a = lonLatToTilePx(bbox.minLon, bbox.maxLat, z);
  const b = lonLatToTilePx(bbox.maxLon, bbox.minLat, z);
  return {
    x0: Math.floor(a.x / 256), y0: Math.floor(a.y / 256),
    x1: Math.floor(b.x / 256), y1: Math.floor(b.y / 256),
  };
}

export function distanceM(lon1, lat1, lon2, lat2) {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
