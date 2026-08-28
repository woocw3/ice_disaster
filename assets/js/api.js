/**
 * 데이터 수집 계층
 *
 * 우선순위
 *   1) 같은 오리진에 NAS 수집기가 있으면 /api/latest 사용 (이력까지 함께 제공)
 *   2) 없으면 브라우저가 Open-Meteo · USGS 를 직접 호출
 *   3) 둘 다 실패하면 데모 데이터로 내려가되 화면에 명시적으로 표시
 */
import { SITES } from './sites.js';
import { makeDemoBundle } from './demo.js';

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const USGS = 'https://earthquake.usgs.gov/fdsnws/event/1/query';

const HOURLY = ['temperature_2m', 'freezing_level_height', 'precipitation', 'rain', 'snowfall'];
const DAILY = ['temperature_2m_max', 'temperature_2m_min', 'temperature_2m_mean',
  'precipitation_sum', 'rain_sum', 'snowfall_sum'];

const TTL = { forecast: 15 * 60e3, quakes: 30 * 60e3, archive: 24 * 3600e3 };

/* ---------- 캐시 ---------- */
function cacheGet(key, ttl) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    return Date.now() - t < ttl ? v : null;
  } catch { return null; }
}
function cacheSet(key, v) {
  try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch { /* 용량 초과 무시 */ }
}

async function getJSON(url, { timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

/* ---------- Open-Meteo ---------- */
export function forecastURL(site) {
  const p = new URLSearchParams({
    latitude: site.lat.toFixed(4),
    longitude: site.lon.toFixed(4),
    elevation: String(site.glacierElev),   // 빙하 말단 고도로 기온을 내려 맞춘다
    hourly: HOURLY.join(','),
    daily: DAILY.join(','),
    timezone: 'America/Lima',
    past_days: '14',
    forecast_days: '7',
  });
  return `${OPEN_METEO}?${p}`;
}

export async function fetchForecast(site) {
  const key = `wx:${site.id}`;
  const hit = cacheGet(key, TTL.forecast);
  if (hit) return hit;
  const data = await getJSON(forecastURL(site));
  cacheSet(key, data);
  return data;
}

/** 연평균 기온 추세용 재분석 자료 (ERA5, 약 5일 지연) */
export async function fetchArchive(site, fromYear = 1995) {
  const key = `ar:${site.id}:${fromYear}`;
  const hit = cacheGet(key, TTL.archive);
  if (hit) return hit;
  const end = new Date(Date.now() - 6 * 86400e3).toISOString().slice(0, 10);
  const p = new URLSearchParams({
    latitude: site.lat.toFixed(4),
    longitude: site.lon.toFixed(4),
    elevation: String(site.glacierElev),
    start_date: `${fromYear}-01-01`,
    end_date: end,
    daily: 'temperature_2m_mean',
    timezone: 'America/Lima',
  });
  const data = await getJSON(`${ARCHIVE}?${p}`, { timeout: 45000 });
  const yearly = yearlyMeans(data);
  cacheSet(key, yearly);
  return yearly;
}

function yearlyMeans(archive) {
  const time = archive?.daily?.time ?? [];
  const vals = archive?.daily?.temperature_2m_mean ?? [];
  const acc = new Map();
  for (let i = 0; i < time.length; i++) {
    const v = vals[i];
    if (!Number.isFinite(v)) continue;
    const y = Number(time[i].slice(0, 4));
    const a = acc.get(y) ?? { sum: 0, n: 0 };
    a.sum += v; a.n++; acc.set(y, a);
  }
  return [...acc.entries()]
    .filter(([, a]) => a.n > 300)             // 결측 많은 해는 버림
    .map(([year, a]) => ({ year, mean: a.sum / a.n }))
    .sort((a, b) => a.year - b.year);
}

/* ---------- USGS 지진 ---------- */
export async function fetchQuakes() {
  const hit = cacheGet('quakes', TTL.quakes);
  if (hit) return hit;
  const start = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
  const p = new URLSearchParams({
    format: 'geojson', starttime: start, minmagnitude: '4',
    minlatitude: '-19', maxlatitude: '-2', minlongitude: '-82', maxlongitude: '-67',
    orderby: 'time', limit: '500',
  });
  const gj = await getJSON(`${USGS}?${p}`);
  const list = (gj.features ?? []).map((f) => ({
    id: f.id,
    mag: f.properties.mag,
    place: f.properties.place,
    time: f.properties.time,
    depthKm: f.geometry.coordinates[2],
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  })).filter((q) => Number.isFinite(q.mag));
  cacheSet('quakes', list);
  return list;
}

/* ---------- NAS 수집기 ---------- */
export async function fetchFromCollector() {
  const data = await getJSON('./api/latest', { timeout: 8000 });
  if (!data?.sites) throw new Error('형식이 올바르지 않음');
  return data;
}

export async function fetchHistory(siteId, days = 30) {
  return getJSON(`./api/history?site=${encodeURIComponent(siteId)}&days=${days}`, { timeout: 15000 });
}

/* ---------- 오케스트레이션 ---------- */
/**
 * 전체 지점의 원시 데이터를 모은다.
 * @returns {{source:'collector'|'live'|'demo', quakes:Array, wx:Object, errors:Array, fetchedAt:number}}
 */
export async function loadBundle({ preferCollector = true } = {}) {
  if (preferCollector) {
    try {
      const c = await fetchFromCollector();
      return {
        // 수집기가 DEMO 모드로 돌고 있으면 그 사실을 그대로 화면에 전달한다
        source: c.demo ? 'demo' : 'collector',
        quakes: c.quakes ?? [], wx: c.sites,
        errors: c.failures ?? [],
        fetchedAt: c.fetchedAt ?? Date.now(),
        hasHistory: !c.demo,
      };
    } catch { /* 수집기 없음 — 직접 호출로 진행 */ }
  }

  const [quakeRes, ...wxRes] = await Promise.allSettled([
    fetchQuakes(),
    ...SITES.map((s) => fetchForecast(s)),
  ]);

  const wx = {};
  const errors = [];
  SITES.forEach((s, i) => {
    const r = wxRes[i];
    if (r.status === 'fulfilled') wx[s.id] = r.value;
    else errors.push({ site: s.id, message: String(r.reason?.message ?? r.reason) });
  });

  const quakes = quakeRes.status === 'fulfilled' ? quakeRes.value : [];
  if (quakeRes.status === 'rejected') errors.push({ site: 'quakes', message: String(quakeRes.reason?.message ?? quakeRes.reason) });

  if (Object.keys(wx).length === 0) {
    const demo = makeDemoBundle();
    return { ...demo, source: 'demo', errors, fetchedAt: Date.now(), hasHistory: false };
  }
  return { source: 'live', quakes, wx, errors, fetchedAt: Date.now(), hasHistory: false };
}
