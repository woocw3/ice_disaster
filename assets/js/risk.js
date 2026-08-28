/**
 * 빙하 융해 · GLOF 위험도 산정 모델
 *
 * 브라우저 대시보드와 NAS 수집기가 함께 쓰는 유일한 판정 로직입니다.
 * 순수 함수만 두고 fetch/DOM에는 의존하지 않습니다.
 *
 * ⚠ 이 점수는 공개 기상·지진 데이터로 만든 스크리닝 지표이며
 *    INAIGEM·SENAMHI·INDECI의 공식 조기경보를 대체하지 않습니다.
 */

export const LEVELS = [
  { id: 'low',      label: '관심', min: 0,  color: '#34d399', desc: '평시 범위' },
  { id: 'moderate', label: '주의', min: 25, color: '#fbbf24', desc: '융해·강수 조건이 평시보다 높음' },
  { id: 'high',     label: '경계', min: 50, color: '#fb923c', desc: '복수 요인이 동시에 상승' },
  { id: 'severe',   label: '심각', min: 75, color: '#f43f5e', desc: '현장 확인 및 하류 전파 검토 필요' },
];

export function levelOf(score) {
  let out = LEVELS[0];
  for (const l of LEVELS) if (score >= l.min) out = l;
  return out;
}

const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);

/** 시계열에서 유효한 숫자만 뽑되, 기준 시각 대비 [fromH, toH) 시간 범위로 자름 */
function sliceHourly(times, values, nowIdx, fromH, toH) {
  const out = [];
  for (let i = nowIdx + fromH; i < nowIdx + toH; i++) {
    if (i < 0 || i >= values.length) continue;
    const v = values[i];
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

/** 예보 배열에서 "지금"에 해당하는 인덱스 */
export function nowIndex(times, now = Date.now()) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < times.length; i++) {
    const d = Math.abs(new Date(times[i]).getTime() - now);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * 원시 기상 데이터에서 물리 지표를 뽑아낸다.
 * wx 는 Open-Meteo forecast 응답 형태 (hourly + daily).
 */
export function deriveMetrics(site, wx) {
  const H = wx?.hourly;
  if (!H?.time?.length) return null;
  const i0 = nowIndex(H.time);

  const t7 = sliceHourly(H.time, H.temperature_2m, i0, -168, 0);
  const t3f = sliceHourly(H.time, H.temperature_2m, i0, 0, 72);
  const fl3 = sliceHourly(H.time, H.freezing_level_height, i0, -72, 0);
  const flNow = Number.isFinite(H.freezing_level_height?.[i0])
    ? H.freezing_level_height[i0] : NaN;
  const rain3 = sliceHourly(H.time, H.rain ?? H.precipitation, i0, -72, 0);
  const rainF3 = sliceHourly(H.time, H.rain ?? H.precipitation, i0, 0, 72);
  const snow7 = sliceHourly(H.time, H.snowfall, i0, -168, 0);

  // 양의 도일(PDD): 빙하 말단 고도에서 0 °C를 넘은 시간을 적산해 융해 에너지의 대리 지표로 쓴다.
  const pdd7 = t7.reduce((s, v) => s + Math.max(0, v), 0) / 24;
  const pddFc3 = t3f.reduce((s, v) => s + Math.max(0, v), 0) / 24;

  const flMean3 = mean(fl3);
  // 0 °C 고도가 빙하 말단보다 얼마나 위에 있는가 = 융해면 노출 폭
  const flAnom = Number.isFinite(flMean3) ? flMean3 - site.glacierElev : NaN;

  const rainSum3 = rain3.reduce((s, v) => s + v, 0);
  const rainFcSum3 = rainF3.reduce((s, v) => s + v, 0);
  const snowSum7 = snow7.reduce((s, v) => s + v, 0); // cm (Open-Meteo snowfall 단위)

  // 급온난화: 향후 3일 평균기온이 지난 7일 평균보다 얼마나 높은가
  const warmSpike = mean(t3f) - mean(t7);

  return {
    tNow: H.temperature_2m?.[i0] ?? NaN,
    tMean7: mean(t7),
    pdd7, pddFc3,
    flNow, flMean3, flAnom,
    rainSum3, rainFcSum3, snowSum7,   // 강우 mm, 강설 cm
    warmSpike,
    updatedAt: H.time[i0],
  };
}

/** 반경 내 지진 활동을 0~1 지수로 압축 */
export function seismicIndex(site, quakes, now = Date.now()) {
  if (!Array.isArray(quakes) || !quakes.length) return { index: 0, nearest: null, count: 0 };
  const R = 250; // km
  let best = 0, nearest = null, count = 0;
  for (const q of quakes) {
    const d = haversineKm(site.lat, site.lon, q.lat, q.lon);
    if (d > R) continue;
    count++;
    const ageDays = (now - q.time) / 86400000;
    const magTerm = clamp01((q.mag - 4) / 2.5);          // M4 → 0, M6.5 → 1
    const distTerm = clamp01(1 - d / R);
    const ageTerm = clamp01(1 - ageDays / 30) * 0.7 + 0.3; // 오래될수록 감쇠하되 완전히 0은 아님
    const s = magTerm * distTerm * ageTerm;
    if (s > best) { best = s; nearest = { ...q, distanceKm: d }; }
  }
  return { index: clamp01(best), nearest, count };
}

export function haversineKm(la1, lo1, la2, lo2) {
  const R = 6371, r = Math.PI / 180;
  const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const a = Math.sin(dLa / 2) ** 2 +
    Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * 요인별 가중 합산 → 0~100 위험 점수
 * 정적 취약도(baseHazard)는 0.5~1.0 배율로 반영해, 조건이 같아도
 * 하류 노출이 큰 호수의 점수가 더 높게 나오도록 한다.
 */
export const FACTORS = [
  {
    key: 'melt', label: '빙하 융해', weight: 0.30, unit: '°C·일',
    hint: '빙하 말단 고도의 지난 7일 양의 도일(PDD). 융해수 유입량의 대리 지표.',
    value: (m) => m.pdd7, index: (m) => clamp01(m.pdd7 / 21),
    fmt: (m) => `${m.pdd7.toFixed(1)} °C·일 / 7일`,
  },
  {
    key: 'freezing', label: '0 °C 고도', weight: 0.20, unit: 'm',
    hint: '동결고도가 빙하 말단보다 높을수록 융해면이 넓게 노출된다.',
    value: (m) => m.flAnom, index: (m) => clamp01(m.flAnom / 500),
    fmt: (m) => Number.isFinite(m.flMean3)
      ? `${Math.round(m.flMean3)} m (말단 ${m.flAnom >= 0 ? '+' : ''}${Math.round(m.flAnom)} m)`
      : '자료 없음',
  },
  {
    key: 'rain', label: '강우 유입', weight: 0.25, unit: 'mm',
    hint: '최근 3일 + 향후 3일 강우. 호수 수위를 올리고 모레인 댐을 약화시킨다.',
    value: (m) => m.rainSum3 + m.rainFcSum3, index: (m) => clamp01((m.rainSum3 + m.rainFcSum3) / 70),
    fmt: (m) => `과거 ${m.rainSum3.toFixed(0)} + 예보 ${m.rainFcSum3.toFixed(0)} mm`,
  },
  {
    key: 'spike', label: '급격한 온난화', weight: 0.10, unit: '°C',
    hint: '향후 3일 평균기온에서 지난 7일 평균을 뺀 값. 급증 시 융해가 가속된다.',
    value: (m) => m.warmSpike, index: (m) => clamp01(m.warmSpike / 2.5),
    fmt: (m) => `${m.warmSpike >= 0 ? '+' : ''}${m.warmSpike.toFixed(1)} °C`,
  },
  {
    key: 'seismic', label: '지진 활동', weight: 0.15, unit: '',
    hint: '반경 250 km · 최근 30일 지진. 빙벽 붕락과 모레인 댐 붕괴의 방아쇠가 된다.',
    value: (m) => m.seismic?.index ?? 0, index: (m) => m.seismic?.index ?? 0,
    fmt: (m) => m.seismic?.nearest
      ? `M${m.seismic.nearest.mag.toFixed(1)} · ${Math.round(m.seismic.nearest.distanceKm)} km`
      : '유의 지진 없음',
  },
];

export function computeRisk(site, wx, quakes, now = Date.now()) {
  const m = deriveMetrics(site, wx);
  if (!m) return null;
  m.seismic = seismicIndex(site, quakes, now);

  const factors = FACTORS.map((f) => {
    const idx = clamp01(f.index(m));
    return {
      key: f.key, label: f.label, hint: f.hint,
      index: idx, weight: f.weight, contrib: idx * f.weight,
      display: f.fmt(m),
    };
  });

  const dynamic = factors.reduce((s, f) => s + f.contrib, 0);

  // 빙하 지점은 GLOF 대상이 아니므로 융해 강도만 보고한다.
  if (site.type !== 'lake') {
    return { site, metrics: m, factors, dynamic, score: null, level: null, meltScore: Math.round(clamp01(m.pdd7 / 21) * 100) };
  }

  const vulnerability = 0.5 + 0.5 * site.baseHazard;
  const score = Math.round(Math.min(100, dynamic * vulnerability * 100));
  return { site, metrics: m, factors, dynamic, score, level: levelOf(score), meltScore: Math.round(clamp01(m.pdd7 / 21) * 100) };
}
