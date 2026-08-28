/**
 * 해석 계층 — 원시 수치를 "읽으면 바로 이해되는 문장"으로 바꾼다.
 *
 * 대시보드의 숫자는 그 자체로는 의미가 잡히지 않습니다.
 * "+344 m" 가 좋은 건지 나쁜 건지, "10.2 °C·일" 이 큰 값인지 알 수 없기 때문에
 * 모든 지표에 (1) 무슨 뜻인지 (2) 지금 수준이 어느 정도인지 를 붙입니다.
 *
 * 판정 기준값은 risk.js 의 정규화 구간과 같은 근거를 씁니다.
 */

const nf = (v, d = 0) => (Number.isFinite(v) ? v.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const signed = (v, d = 0) => (Number.isFinite(v) ? `${v >= 0 ? '+' : '−'}${nf(Math.abs(v), d)}` : '—');

/** 세 구간으로 나눈 정성 등급 */
export const BANDS = {
  low: { label: '낮음', color: '#34d399' },
  mid: { label: '보통', color: '#fbbf24' },
  high: { label: '높음', color: '#fb923c' },
  severe: { label: '매우 높음', color: '#f43f5e' },
};

function bandOf(index) {
  if (index >= 0.75) return 'severe';
  if (index >= 0.45) return 'high';
  if (index >= 0.2) return 'mid';
  return 'low';
}

/** 등급이 실제로 무엇을 뜻하는지 — 점수 옆에 항상 함께 보여준다 */
export const LEVEL_MEANING = {
  low: '평시 범위입니다. 융해와 강수가 이 지점의 보통 수준에 머물러 있습니다.',
  moderate: '평시보다 높습니다. 빙하가 녹거나 비가 들어오는 조건이 올라와 있어 추이를 지켜볼 구간입니다.',
  high: '여러 요인이 동시에 올라가 있습니다. 현장 상태와 하류 상황을 함께 확인해 볼 수준입니다.',
  severe: '조건이 크게 악화됐습니다. 반드시 INAIGEM·SENAMHI 등 공식 기관의 발표를 함께 확인하세요.',
};

/**
 * 지표별 해석.
 * @returns [{key, title, value, unit, plain, band, index, detail}]
 */
export function explainMetrics(site, r) {
  const m = r.metrics;
  const isLake = site.type === 'lake';
  const out = [];

  /* --- 융해 --- */
  const meltIdx = Math.min(1, m.pdd7 / 21);
  out.push({
    key: 'melt',
    title: '빙하가 녹고 있나',
    value: Number.isFinite(m.meltHours7) ? `${m.meltHours7}시간` : '—',
    unit: '지난 7일 중',
    plain: Number.isFinite(m.meltPct7)
      ? (m.meltHours7 === 0
        ? '지난 7일 내내 빙하 말단이 영하였습니다. 녹지 않았습니다.'
        : `빙하 말단(해발 ${nf(site.glacierElev)} m)의 기온이 168시간 중 ${m.meltHours7}시간(${nf(m.meltPct7)}%) 영상이었습니다. 그동안 얼음이 녹아 물이 됐다는 뜻입니다.`)
      : '자료 없음',
    detail: `최고 ${nf(m.tMaxRecent, 1)} °C · 융해 도일 ${nf(m.pdd7, 1)} °C·일`,
    band: bandOf(meltIdx), index: meltIdx,
  });

  /* --- 0 °C 고도 --- */
  const flIdx = Math.min(1, Math.max(0, m.flAnom / 500));
  const above = m.flAnom >= 0;
  out.push({
    key: 'freezing',
    title: '눈이 아니라 비가 내리는 높이',
    value: Number.isFinite(m.flMean3) ? `${nf(m.flMean3)} m` : '—',
    unit: '0 °C 경계',
    plain: !Number.isFinite(m.flAnom) ? '자료 없음'
      : above
        ? `이 높이 아래로는 눈이 아니라 비가 내리고 얼음이 녹습니다. 지금 그 경계가 빙하 말단보다 ${nf(m.flAnom)} m 위에 있어, 말단부가 통째로 녹는 구간에 들어가 있습니다.`
        : `0 °C 경계가 빙하 말단보다 ${nf(Math.abs(m.flAnom))} m 아래에 있습니다. 말단까지 영하라 지금은 녹지 않고 눈이 쌓이는 조건입니다.`,
    detail: `빙하 말단 ${nf(site.glacierElev)} m 대비 ${signed(m.flAnom)} m`,
    band: bandOf(flIdx), index: flIdx,
  });

  /* --- 강우 --- */
  const rainTotal = m.rainSum3 + m.rainFcSum3;
  const rainIdx = Math.min(1, rainTotal / 70);
  out.push({
    key: 'rain',
    title: isLake ? '호수로 들어오는 비' : '비 유입',
    value: `${nf(rainTotal)} mm`,
    unit: '6일 합계',
    plain: rainTotal < 1
      ? '최근·예보 모두 비가 거의 없습니다.'
      : `지난 3일 ${nf(m.rainSum3)} mm가 내렸고 앞으로 3일 ${nf(m.rainFcSum3)} mm가 예보돼 있습니다.` +
        (isLake ? ' 비는 눈과 달리 곧바로 호수 수위를 올리고, 모레인(빙퇴석) 댐을 적셔 약하게 만듭니다.' : ' 비는 눈과 달리 빙하 표면의 융해를 가속합니다.'),
    detail: `과거 3일 ${nf(m.rainSum3)} + 예보 3일 ${nf(m.rainFcSum3)} mm`,
    band: bandOf(rainIdx), index: rainIdx,
  });

  /* --- 급격한 온난화 --- */
  const spikeIdx = Math.min(1, Math.max(0, m.warmSpike / 2.5));
  out.push({
    key: 'spike',
    title: '앞으로 더 따뜻해지나',
    value: `${signed(m.warmSpike, 1)} °C`,
    unit: '지난 주 대비',
    plain: m.warmSpike > 0.3
      ? `앞으로 3일이 지난 7일 평균보다 ${nf(m.warmSpike, 1)} °C 따뜻할 전망입니다. 융해가 지금보다 빨라집니다.`
      : m.warmSpike < -0.3
        ? `앞으로 3일이 지난 7일 평균보다 ${nf(Math.abs(m.warmSpike), 1)} °C 서늘할 전망입니다. 융해가 누그러집니다.`
        : '앞으로 3일 기온이 지난 주와 비슷합니다.',
    detail: `지난 7일 평균 ${nf(m.tMean7, 1)} °C`,
    band: bandOf(spikeIdx), index: spikeIdx,
  });

  /* --- 지진 --- */
  const q = m.seismic ?? { index: 0, count: 0, nearest: null };
  out.push({
    key: 'seismic',
    title: '무너뜨릴 충격이 있었나',
    value: q.nearest ? `M${q.nearest.mag.toFixed(1)}` : '없음',
    unit: q.nearest ? `${Math.round(q.nearest.distanceKm)} km 거리` : '반경 250 km',
    plain: q.nearest
      ? `최근 30일 반경 250 km 안에서 규모 ${q.nearest.mag.toFixed(1)} 지진이 ${Math.round(q.nearest.distanceKm)} km 떨어진 곳에서 있었습니다. 지진은 빙벽을 떨어뜨리거나 모레인 댐에 균열을 내 붕괴의 방아쇠가 됩니다.`
      : '최근 30일간 반경 250 km 안에 규모 4.0 이상 지진이 없었습니다.',
    detail: q.count ? `반경 내 M4.0+ ${q.count}회` : '해당 없음',
    band: bandOf(q.index), index: q.index,
  });

  return out;
}

/** 점수를 만든 가장 큰 이유 한두 개를 문장으로 */
export function explainScore(site, r) {
  if (site.type !== 'lake' || r.score == null) return null;
  const top = r.factors.slice().sort((a, b) => b.contrib - a.contrib).filter((f) => f.contrib > 0.02).slice(0, 2);
  const names = { melt: '빙하 융해', freezing: '0 °C 경계 상승', rain: '강우 유입', spike: '기온 상승', seismic: '지진 활동' };
  const reason = top.length
    ? top.map((f) => names[f.key] ?? f.label).join(' + ')
    : '뚜렷한 상승 요인 없음';
  return {
    reason,
    sentence: top.length
      ? `지금 점수를 끌어올린 건 주로 ${reason} 입니다.`
      : '현재 점수를 끌어올리는 뚜렷한 요인이 없습니다.',
    meaning: LEVEL_MEANING[r.level.id],
  };
}

/** 지점 목록 행에 한 줄로 붙일 요약 */
export function shortStatus(site, r) {
  const m = r.metrics;
  const bits = [];
  if (Number.isFinite(m.flAnom) && m.flAnom > 0) bits.push('녹는 중');
  else if (Number.isFinite(m.flAnom)) bits.push('영하 유지');
  if (m.rainFcSum3 > 15) bits.push('비 예보');
  if (m.warmSpike > 1) bits.push('기온 상승');
  if ((m.seismic?.index ?? 0) > 0.3) bits.push('인근 지진');
  return bits.join(' · ') || '평시';
}

/** 하류에 무엇이 있는지 — 위험의 "결과" 쪽을 사람 단위로 */
export function explainExposure(site) {
  const d = site.downstream;
  if (!d) return null;
  return `이 호수가 터지면 물길은 ${d.distanceKm} km 아래 ${d.city}(약 ${nf(d.pop)}명) 방향으로 흐릅니다. ` +
    `그 사이 고도가 ${nf(d.dropM)} m 떨어지기 때문에 물은 빠르게 가속되며 흙과 바위를 함께 쓸고 내려갑니다.`;
}

export { nf, signed };
