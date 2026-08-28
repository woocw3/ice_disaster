/**
 * 데모 데이터 생성기
 *
 * 실시간 API에 전혀 닿지 못했을 때만 쓰입니다. 화면 상단에 경고 배너가 뜨고
 * 모든 수치에 "데모" 표시가 붙습니다. 실제 관측값이 아니라 형태만 같은
 * 합성 시계열이므로 판단 근거로 쓰면 안 됩니다.
 */
import { SITES } from './sites.js';

/** 시드 기반 난수 — 새로고침해도 같은 값이 나오도록 */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const hash = (str) => [...str].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function makeSeries(site) {
  const rand = rng(hash(site.id));
  const past = 14 * 24, fwd = 7 * 24, n = past + fwd;
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const start = now.getTime() - past * 3600e3;

  const time = [], temperature_2m = [], freezing_level_height = [],
    precipitation = [], rain = [], snowfall = [];

  // 열대 안데스의 습윤 기온감률(약 5.5 °C/km, 해수면 27.5 °C)을 쓰면
  // 0 °C 고도가 실제와 비슷한 4,900~5,100 m 부근에 놓인다.
  const LAPSE = 0.0055;
  const base = 27.5 - site.glacierElev * LAPSE;
  const wetness = 0.35 + rand() * 0.5;      // 지점별 강수 성향
  const drift = (rand() - 0.35) * 2.5;      // 기간 중 완만한 온난/한랭 추세

  for (let i = 0; i < n; i++) {
    const t = start + i * 3600e3;
    const d = new Date(t);
    const hour = d.getUTCHours() - 5;                     // 페루 표준시 UTC-5
    const diurnal = 3.2 * Math.sin(((hour - 9) / 24) * 2 * Math.PI);
    const synoptic = 1.8 * Math.sin(i / 46 + rand() * 0.02);
    const noise = (rand() - 0.5) * 1.1;
    const temp = base + diurnal + synoptic + noise + (drift * i) / n;

    // 자유대기 0 °C 고도는 일교차보다 종관 규모 흐름을 따르므로
    // 일주기 성분을 뺀 기온으로 환산한다 (기준고도 + 기온/감률).
    const tSynoptic = base + synoptic + (drift * i) / n;
    const fl = site.glacierElev + tSynoptic / LAPSE + (rand() - 0.5) * 120;

    const stormy = Math.max(0, Math.sin(i / 37 + hash(site.id) % 7) - 0.45);
    const p = stormy > 0 ? stormy * wetness * 9 * rand() : (rand() < 0.06 ? rand() * 0.8 : 0);
    const isSnow = temp < 0.5;

    time.push(new Date(t).toISOString().slice(0, 16));
    temperature_2m.push(+temp.toFixed(1));
    freezing_level_height.push(Math.round(fl));
    precipitation.push(+p.toFixed(1));
    rain.push(+(isSnow ? 0 : p).toFixed(1));
    // Open-Meteo 와 동일하게 snowfall 은 cm 단위 (강수 1 mm ≈ 눈 0.7 cm)
    snowfall.push(+(isSnow ? p * 0.7 : 0).toFixed(2));
  }

  // 일별 집계
  const dayKeys = [...new Set(time.map((t) => t.slice(0, 10)))];
  const daily = {
    time: dayKeys,
    temperature_2m_max: [], temperature_2m_min: [], temperature_2m_mean: [],
    precipitation_sum: [], rain_sum: [], snowfall_sum: [],
  };
  for (const day of dayKeys) {
    const idx = time.map((t, i) => (t.startsWith(day) ? i : -1)).filter((i) => i >= 0);
    const temps = idx.map((i) => temperature_2m[i]);
    daily.temperature_2m_max.push(+Math.max(...temps).toFixed(1));
    daily.temperature_2m_min.push(+Math.min(...temps).toFixed(1));
    daily.temperature_2m_mean.push(+(temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1));
    daily.precipitation_sum.push(+idx.reduce((s, i) => s + precipitation[i], 0).toFixed(1));
    daily.rain_sum.push(+idx.reduce((s, i) => s + rain[i], 0).toFixed(1));
    daily.snowfall_sum.push(+idx.reduce((s, i) => s + snowfall[i], 0).toFixed(1));
  }

  return {
    latitude: site.lat, longitude: site.lon, elevation: site.glacierElev,
    timezone: 'America/Lima',
    hourly: { time, temperature_2m, freezing_level_height, precipitation, rain, snowfall },
    daily,
    _demo: true,
  };
}

function makeQuakes() {
  const rand = rng(20260828);
  const out = [];
  for (let i = 0; i < 9; i++) {
    out.push({
      id: `demo-${i}`,
      mag: +(4 + rand() * 2.1).toFixed(1),
      place: '데모 · 페루 근해/내륙',
      time: Date.now() - rand() * 30 * 86400e3,
      depthKm: Math.round(20 + rand() * 100),
      lat: -16 + rand() * 8,
      lon: -78 + rand() * 6,
    });
  }
  return out;
}

export function makeDemoBundle() {
  const wx = {};
  for (const s of SITES) wx[s.id] = makeSeries(s);
  return { wx, quakes: makeQuakes() };
}
