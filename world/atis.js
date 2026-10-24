const PHONETIC = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL', 'INDIA', 'JULIETT', 'KILO', 'LIMA', 'MIKE',
  'NOVEMBER', 'OSCAR', 'PAPA', 'QUEBEC', 'ROMEO', 'SIERRA', 'TANGO', 'UNIFORM', 'VICTOR', 'WHISKEY', 'XRAY', 'YANKEE', 'ZULU'];
const COVER = { FEW: 'FEW', SCT: 'SCATTERED', BKN: 'BROKEN', OVC: 'OVERCAST', VV: 'VERTICAL VISIBILITY' };
const WX = {
  RA: 'RAIN', DZ: 'DRIZZLE', SN: 'SNOW', TS: 'THUNDERSTORM', SH: 'SHOWERS', FG: 'FOG', BR: 'MIST', HZ: 'HAZE', GR: 'HAIL', FU: 'SMOKE',
};

export function parseMetar(raw) {
  const tokens = raw.trim().split(/\s+/);
  const m = { raw, clouds: [], weather: [] };
  for (const t of tokens) {
    let x;
    if ((x = t.match(/^(\d{2})(\d{2})(\d{2})Z$/))) m.time = `${x[2]}${x[3]}Z`;
    else if ((x = t.match(/^(\d{3}|VRB)(\d{2,3})(G(\d{2,3}))?(KT|MPS)$/))) {
      m.windDir = x[1] === 'VRB' ? null : Number(x[1]);
      m.windSpeed = Number(x[2]);
      m.gust = x[4] ? Number(x[4]) : null;
      m.windUnit = x[5] === 'MPS' ? 'M/S' : 'KNOTS';
    } else if ((x = t.match(/^(\d{3})V(\d{3})$/))) m.variable = [x[1], x[2]];
    else if (t === 'CAVOK') { m.visibility = '10 KM OR MORE'; m.cavok = true; }
    else if (/^\d{4}$/.test(t) && m.visibility === undefined) m.visibility = t === '9999' ? '10 KM OR MORE' : `${Number(t)} M`;
    else if ((x = t.match(/^(\d+)SM$/))) m.visibility = `${x[1]} MILES`;
    else if ((x = t.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3})/))) m.clouds.push(`${COVER[x[1]]} ${Number(x[2]) * 100}`);
    else if ((x = t.match(/^(M?\d{2})\/(M?\d{2})$/))) {
      m.temp = Number(x[1].replace('M', '-'));
      m.dew = Number(x[2].replace('M', '-'));
    } else if ((x = t.match(/^Q(\d{4})$/))) m.qnh = `QNH ${x[1]}`;
    else if ((x = t.match(/^A(\d{4})$/))) m.qnh = `ALTIMETER ${x[1].slice(0, 2)}.${x[1].slice(2)}`;
    else if (t === 'RMK') break;
    else if ((x = t.match(/^([+-]?)(VC)?(SH|TS)?(RA|DZ|SN|FG|BR|HZ|GR|FU)$/))) {
      const intensity = x[1] === '+' ? 'HEAVY ' : x[1] === '-' ? 'LIGHT ' : '';
      const kind = x[3] === 'SH' ? `${WX[x[4]]} SHOWERS` : x[3] === 'TS' ? `THUNDERSTORM WITH ${WX[x[4]]}` : WX[x[4]];
      m.weather.push(`${intensity}${x[2] ? 'NEARBY ' : ''}${kind}`);
    }
  }
  return m;
}

function runwayHeading(end) {
  return (Number(end.match(/^\d+/)?.[0]) || 0) * 10;
}

function angleDiff(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

export function runwaysInUse(ends, metar) {
  if (!ends.length) return [];
  if (metar.windDir == null || metar.windSpeed < 3) return [ends[0]];
  const best = Math.min(...ends.map((e) => angleDiff(runwayHeading(e), metar.windDir)));
  return ends.filter((e) => angleDiff(runwayHeading(e), metar.windDir) <= best + 25);
}

export function atisText(name, metar, ends) {
  const hour = Number(metar.time?.slice(0, 2) ?? 0);
  const letter = PHONETIC[hour % PHONETIC.length];
  const pad = (n) => String(n).padStart(3, '0');
  const wind = metar.windSpeed === 0
    ? 'WIND CALM'
    : `WIND ${metar.windDir == null ? 'VARIABLE' : pad(metar.windDir)} AT ${metar.windSpeed}${metar.gust ? ` GUSTING ${metar.gust}` : ''} ${metar.windUnit ?? 'KNOTS'}${metar.variable ? `, VARIABLE BETWEEN ${metar.variable[0]} AND ${metar.variable[1]}` : ''}`;
  const parts = [
    `${name.toUpperCase()} INFORMATION ${letter}, ${metar.time ?? ''}`,
    ends.length ? `RUNWAY IN USE ${runwaysInUse(ends, metar).join(', ')}` : null,
    wind,
    metar.visibility ? `VISIBILITY ${metar.visibility}` : null,
    metar.weather.length ? metar.weather.join(', ') : null,
    metar.cavok ? 'CLOUD AND VISIBILITY OK' : metar.clouds.length ? metar.clouds.join(', ') : 'NO SIGNIFICANT CLOUD',
    Number.isFinite(metar.temp) ? `TEMPERATURE ${metar.temp}, DEW POINT ${metar.dew}` : null,
    metar.qnh ?? null,
    `ADVISE ON INITIAL CONTACT YOU HAVE INFORMATION ${letter}`,
  ];
  return parts.filter(Boolean).join('. ') + '.';
}
