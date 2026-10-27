import { CENTER } from './geo.js';

const DEG = Math.PI / 180;

export function moonPosition(date = new Date(), lat = CENTER.lat, lon = CENTER.lon) {
  const d = date.getTime() / 86_400_000 - 10957.5;
  const L = 218.316 + 13.176396 * d;
  const M = (134.963 + 13.064993 * d) * DEG;
  const F = (93.272 + 13.22935 * d) * DEG;
  const D = (297.85 + 12.190749 * d) * DEG;
  const lambda = (L + 6.289 * Math.sin(M) + 1.274 * Math.sin(2 * D - M) + 0.658 * Math.sin(2 * D)) * DEG;
  const beta = 5.128 * Math.sin(F) * DEG;
  const e = (23.439 - 0.00000036 * d) * DEG;
  const ra = Math.atan2(Math.sin(lambda) * Math.cos(e) - Math.tan(beta) * Math.sin(e), Math.cos(lambda));
  const dec = Math.asin(Math.sin(beta) * Math.cos(e) + Math.cos(beta) * Math.sin(e) * Math.sin(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const ha = ((gmst * 15 + lon) * DEG) - ra;
  const la = lat * DEG;
  const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(ha));

  const g = (357.529 + 0.98560028 * d) * DEG;
  const sunLambda = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const elongation = Math.acos(Math.cos(beta) * Math.cos(lambda - sunLambda));
  const illumination = (1 - Math.cos(elongation)) / 2;
  const waxing = Math.sin(lambda - sunLambda) > 0;

  return { elevation: el / DEG, azimuth: ((az / DEG) + 360) % 360, illumination, waxing };
}
