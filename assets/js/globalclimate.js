/**
 * 전 지구 빙하 지역의 연대별 기후 변화 계산
 *
 * Open-Meteo Archive API(ERA5 재분석, 1950~현재)에서 지역별 대표 지점의
 * 일평균 기온을 받아 연·연대 단위로 집계합니다.
 *
 * ⚠ 여기서 계산하는 것은 "융해 조건"이지 빙하 질량 변화가 아닙니다.
 *    실제 얼마나 녹았는지(질량 수지)는 위성 고도 측정과 현장 관측이 필요하며,
 *    그 수치는 regions.js 의 MASS_LOSS_FACTS 에 공표된 연구값으로 따로 둡니다.
 *    다만 양의 도일(PDD)은 빙하 융해량과 잘 대응하는 표준 대리 지표입니다.
 */
import { RGI_REGIONS } from './regions.js';

const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const START_YEAR = 1950;
export const BASELINE = [1951, 1980];   // NASA GISTEMP 와 같은 기준기간

const CACHE_KEY = 'glacier-climate-v1';
const CACHE_TTL = 30 * 86400e3;   // 연대 통계는 매일 바뀌지 않는다

/* ---------- 캐시 (파생값만 저장 — 원자료는 수 MB라 담지 않는다) ---------- */
function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const { t, v } = JSON.parse(raw);
    return Date.now() - t < CACHE_TTL ? v : {};
  } catch { return {}; }
}
function saveCache(obj) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), v: obj })); } catch { /* 용량 초과 무시 */ }
}

/* ---------- 집계 ---------- */
/**
 * 일평균 기온 시계열 → 연도별 지표
 *  mean      연평균 기온 (°C)
 *  pdd       양의 도일 합 (°C·일) — 융해 에너지 대리 지표
 *  meltDays  0 °C 를 넘은 날 수
 */
export function yearlyStats(times, temps) {
  const acc = new Map();
  for (let i = 0; i < times.length; i++) {
    const v = temps[i];
    if (!Number.isFinite(v)) continue;
    const y = Number(times[i].slice(0, 4));
    let a = acc.get(y);
    if (!a) { a = { sum: 0, n: 0, pdd: 0, meltDays: 0 }; acc.set(y, a); }
    a.sum += v; a.n++;
    if (v > 0) { a.pdd += v; a.meltDays++; }
  }
  return [...acc.entries()]
    .filter(([, a]) => a.n > 330)              // 결측이 많은 해는 버린다
    .map(([year, a]) => ({ year, mean: a.sum / a.n, pdd: a.pdd, meltDays: a.meltDays }))
    .sort((a, b) => a.year - b.year);
}

/** 연도별 → 연대별 평균 */
export function byDecade(years) {
  const acc = new Map();
  for (const y of years) {
    const d = Math.floor(y.year / 10) * 10;
    let a = acc.get(d);
    if (!a) { a = { mean: 0, pdd: 0, meltDays: 0, n: 0 }; acc.set(d, a); }
    a.mean += y.mean; a.pdd += y.pdd; a.meltDays += y.meltDays; a.n++;
  }
  return [...acc.entries()]
    .map(([decade, a]) => ({
      decade, years: a.n,
      mean: a.mean / a.n, pdd: a.pdd / a.n, meltDays: a.meltDays / a.n,
    }))
    .sort((a, b) => a.decade - b.decade);
}

function baselineMean(years) {
  const b = years.filter((y) => y.year >= BASELINE[0] && y.year <= BASELINE[1]);
  if (!b.length) return null;
  return {
    mean: b.reduce((s, y) => s + y.mean, 0) / b.length,
    pdd: b.reduce((s, y) => s + y.pdd, 0) / b.length,
    meltDays: b.reduce((s, y) => s + y.meltDays, 0) / b.length,
  };
}

/** 지역 하나의 요약 — 화면과 캐시에 쓰이는 최종 형태 */
export function summarize(region, years) {
  const decades = byDecade(years);
  const base = baselineMean(years);
  const recent = decades[decades.length - 1];
  const first = decades[0];

  const warming = base ? recent.mean - base.mean : null;
  // 융해 도일 증가율. 기준기간 PDD 가 0 에 가까우면(항상 영하) 비율이 무의미해진다.
  const pddRatio = base && base.pdd > 3 ? recent.pdd / base.pdd : null;

  return {
    id: region.id,
    decades: decades.map((d) => ({
      decade: d.decade, years: d.years,
      mean: round(d.mean, 2), pdd: round(d.pdd, 1), meltDays: round(d.meltDays, 1),
      anomaly: base ? round(d.mean - base.mean, 2) : null,
    })),
    years: years.map((y) => ({ year: y.year, mean: round(y.mean, 2), pdd: round(y.pdd, 1), meltDays: y.meltDays })),
    baseline: base ? { mean: round(base.mean, 2), pdd: round(base.pdd, 1), meltDays: round(base.meltDays, 1) } : null,
    warming: round(warming, 2),
    pddRatio: round(pddRatio, 2),
    pddDelta: base ? round(recent.pdd - base.pdd, 1) : null,
    meltDaysDelta: base ? round(recent.meltDays - base.meltDays, 1) : null,
    firstDecade: first?.decade, lastDecade: recent?.decade,
  };
}

const round = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);

/* ---------- 수집 ---------- */
export function archiveURL(region) {
  const end = new Date(Date.now() - 6 * 86400e3).toISOString().slice(0, 10);
  const p = new URLSearchParams({
    latitude: region.lat.toFixed(3), longitude: region.lon.toFixed(3),
    elevation: String(region.elev),
    start_date: `${START_YEAR}-01-01`, end_date: end,
    daily: 'temperature_2m_mean', timezone: 'UTC',
  });
  return `${ARCHIVE}?${p}`;
}

async function fetchRegion(region) {
  const res = await fetch(archiveURL(region), { signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const years = yearlyStats(j?.daily?.time ?? [], j?.daily?.temperature_2m_mean ?? []);
  if (years.length < 20) throw new Error('자료가 부족합니다');
  return summarize(region, years);
}

/** 동시 요청 수를 제한해 공개 API 에 부담을 주지 않는다 */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); } catch (e) { out[idx] = { error: String(e.message ?? e), id: items[idx].id }; }
    }
  }));
  return out;
}

/**
 * 전 지역 요약을 가져온다.
 * 1) NAS 수집기가 있으면 /api/climate 로 한 번에 (원자료 수 MB 를 브라우저가 받지 않아도 됨)
 * 2) 없으면 브라우저가 직접 — 캐시에 있는 지역은 건너뛴다
 * @param onProgress (done, total, regionName)
 */
export async function loadGlobalClimate({ onProgress } = {}) {
  try {
    const res = await fetch('./api/climate', { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const j = await res.json();
      if (j?.regions?.length) return { source: j.demo ? 'demo' : 'collector', regions: j.regions, fetchedAt: j.fetchedAt };
    }
  } catch { /* 수집기 없음 — 직접 수집 */ }

  const cache = loadCache();
  const missing = RGI_REGIONS.filter((r) => !cache[r.id]);
  let done = RGI_REGIONS.length - missing.length;
  onProgress?.(done, RGI_REGIONS.length, null);

  if (missing.length) {
    const got = await pool(missing, 3, async (r) => {
      const s = await fetchRegion(r);
      done++; onProgress?.(done, RGI_REGIONS.length, r.name);
      return s;
    });
    for (const s of got) if (s && !s.error) cache[s.id] = s;
    saveCache(cache);
  }

  const regions = RGI_REGIONS.map((r) => cache[r.id]).filter(Boolean);
  return { source: 'live', regions, fetchedAt: Date.now() };
}

export function clearClimateCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* noop */ }
}
