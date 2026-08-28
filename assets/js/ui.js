/** DOM 렌더링 컴포넌트 */
import { sparkline, lineChart, barChart, trendChart } from './charts.js';
import { LEVELS, nowIndex } from './risk.js';
import { NATIONAL_FACTS, RANGES } from './sites.js';

/** replaceChildren 는 null 을 "null" 텍스트로 바꿔버리므로 반드시 걸러서 넘긴다. */
export const mount = (host, ...nodes) => host.replaceChildren(...nodes.filter(Boolean));

export const h = (tag, attrs = {}, children = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, String(v));
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
};

const nf = (v, d = 0) => (Number.isFinite(v) ? v.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
export const timeKST = (t) => new Date(t).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
const timePeru = (t) => new Date(t).toLocaleString('ko-KR', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' });

/* ---------------- KPI ---------------- */
export function renderKPIs(host, results, quakes, bundle) {
  const lakes = results.filter((r) => r.site.type === 'lake' && r.score != null);
  const top = lakes.slice().sort((a, b) => b.score - a.score)[0];
  const flVals = results.map((r) => r.metrics.flMean3).filter(Number.isFinite);
  const flAvg = flVals.length ? flVals.reduce((a, b) => a + b, 0) / flVals.length : NaN;
  const pddTotal = results.reduce((s, r) => s + (Number.isFinite(r.metrics.pdd7) ? r.metrics.pdd7 : 0), 0);
  const pddAvg = results.length ? pddTotal / results.length : NaN;
  const melting = results.filter((r) => r.metrics.flAnom > 0).length;

  const tiles = [
    {
      label: '최고 위험 지점',
      value: top ? String(top.score) : '—',
      unit: top ? `/100 · ${top.level.label}` : '',
      sub: top ? top.site.name : '자료 없음',
      color: top?.level?.color,
    },
    {
      label: '평균 0 °C 고도',
      value: nf(flAvg, 0), unit: 'm',
      sub: `${melting}/${results.length}개 지점의 빙하 말단이 융해 고도 위`,
      color: '#7dd3fc',
    },
    {
      label: '7일 융해 도일 (평균)',
      value: nf(pddAvg, 1), unit: '°C·일',
      sub: '빙하 말단 고도 기준 양의 도일 적산',
      color: '#fbbf24',
    },
    {
      label: '최근 30일 지진 M4+',
      value: String(quakes.length), unit: '회',
      sub: quakes.length
        ? `최대 M${Math.max(...quakes.map((q) => q.mag)).toFixed(1)} · 페루 권역`
        : '기록 없음',
      color: '#c4b5fd',
    },
  ];

  host.replaceChildren(...tiles.map((t) => h('div', { class: 'kpi' }, [
    h('div', { class: 'kpi-label' }, [t.label]),
    h('div', { class: 'kpi-value', style: t.color ? `color:${t.color}` : null }, [
      t.value, t.unit ? h('span', { class: 'kpi-unit' }, [' ' + t.unit]) : null,
    ]),
    h('div', { class: 'kpi-sub' }, [t.sub]),
  ])));
}

/* ---------------- 지점 목록 ---------------- */
export function renderList(host, results, selectedId, onSelect) {
  const rows = results.map((r) => {
    const { site, metrics } = r;
    const isLake = site.type === 'lake';
    const color = isLake && r.level ? r.level.color : '#94a3b8';
    const hourly = r.wx?.hourly;
    const i0 = hourly?.time ? nowIndex(hourly.time) : 0;
    const spark = hourly
      ? sparkline(hourly.temperature_2m.slice(Math.max(0, i0 - 168), i0 + 1), { color, zero: 0 })
      : h('span');

    return h('button', {
      class: `row${selectedId === site.id ? ' is-selected' : ''}`,
      onclick: () => onSelect(site.id),
    }, [
      h('span', { class: 'row-bar', style: `background:${color}` }),
      h('span', { class: 'row-main' }, [
        h('span', { class: 'row-name' }, [site.name, !isLake ? h('span', { class: 'tag' }, ['빙하']) : null]),
        h('span', { class: 'row-meta' }, [
          `${site.range} · ${site.region}`,
          isLake && site.downstream ? ` · 하류 ${nf(site.downstream.pop)}명` : '',
        ]),
      ]),
      h('span', { class: 'row-spark' }, [spark]),
      h('span', { class: 'row-fl' }, [
        h('b', {}, [Number.isFinite(metrics.flAnom) ? `${metrics.flAnom > 0 ? '+' : ''}${nf(metrics.flAnom)}` : '—']),
        h('small', {}, ['m 노출']),
      ]),
      h('span', { class: 'row-score', style: `--c:${color}` }, [
        h('b', {}, [isLake ? String(r.score ?? '—') : String(r.meltScore ?? '—')]),
        h('small', {}, [isLake ? r.level?.label ?? '' : '융해']),
      ]),
    ]);
  });
  host.replaceChildren(...rows);
}

/* ---------------- 상세 ---------------- */
export function renderDetail(host, r, { quakes, onLoadTrend, trend, history }) {
  const { site, metrics, factors } = r;
  const isLake = site.type === 'lake';
  const color = isLake && r.level ? r.level.color : '#94a3b8';
  const H = r.wx?.hourly ?? { time: [] };
  const D = r.wx?.daily ?? { time: [] };
  const i0 = H.time.length ? nowIndex(H.time) : 0;

  const head = h('div', { class: 'detail-head' }, [
    h('div', {}, [
      h('h2', {}, [site.name, h('span', { class: 'detail-es' }, [site.nameEs])]),
      h('div', { class: 'detail-sub' }, [
        `${site.range} · ${site.region} · ${site.lat.toFixed(3)}°, ${site.lon.toFixed(3)}°`,
      ]),
    ]),
    isLake
      ? h('div', { class: 'detail-score', style: `--c:${color}` }, [
          h('b', {}, [String(r.score)]),
          h('span', {}, [r.level.label]),
        ])
      : h('div', { class: 'detail-score', style: '--c:#94a3b8' }, [
          h('b', {}, [String(r.meltScore)]), h('span', {}, ['융해 강도']),
        ]),
  ]);

  // 제원
  const specs = [
    site.lakeElev && ['호수 수면', `${nf(site.lakeElev)} m`],
    ['빙하 말단(기준)', `${nf(site.glacierElev)} m`],
    ['정상', `${nf(site.summitElev)} m · ${site.summitName}`],
    site.volumeMm3 && ['호수 용적', `약 ${nf(site.volumeMm3, 1)} 백만 m³`],
    site.damType && ['댐 형식', site.damType],
    site.downstream && ['하류 노출', `${site.downstream.city} · ${nf(site.downstream.pop)}명 · ${site.downstream.distanceKm} km · 낙차 ${nf(site.downstream.dropM)} m`],
  ].filter(Boolean);

  const specTable = h('div', { class: 'specs' }, specs.map(([k, v]) =>
    h('div', { class: 'spec' }, [h('dt', {}, [k]), h('dd', {}, [v])])));

  // 요인 분해
  const factorList = h('div', { class: 'factors' }, factors.map((f) => h('div', { class: 'factor', title: f.hint }, [
    h('div', { class: 'factor-top' }, [
      h('span', { class: 'factor-label' }, [f.label]),
      h('span', { class: 'factor-val' }, [f.display]),
    ]),
    h('div', { class: 'factor-track' }, [
      h('div', { class: 'factor-fill', style: `width:${(f.index * 100).toFixed(1)}%;background:${color}` }),
    ]),
    h('div', { class: 'factor-w' }, [`가중치 ${(f.weight * 100).toFixed(0)}% · 기여 ${(f.contrib * 100).toFixed(1)}p`]),
  ])));

  // 차트
  const from = Math.max(0, i0 - 14 * 24);
  const times = H.time.slice(from);
  const tempSeries = [{ values: H.temperature_2m.slice(from), color: '#fbbf24', label: '기온' }];
  const forecastBand = { from: i0 - from, to: times.length - 1, color: 'rgba(148,163,184,.10)' };
  const tempChart = times.length ? lineChart(times, tempSeries, {
    refLines: [{ value: 0, label: '0 °C 융해', color: '#38bdf8' }],
    bands: [forecastBand], yLabel: `°C @ ${nf(site.glacierElev)} m`, fill: true,
  }) : h('div', { class: 'empty' }, ['자료 없음']);

  const flChart = times.length ? lineChart(times, [
    { values: H.freezing_level_height.slice(from), color: '#38bdf8', label: '0 °C 고도' },
  ], {
    refLines: [
      { value: site.glacierElev, label: '빙하 말단', color: '#f43f5e' },
      site.lakeElev ? { value: site.lakeElev, label: '호수 수면', color: '#a78bfa' } : null,
    ].filter(Boolean),
    bands: [forecastBand], yLabel: '동결고도 (m)', h: 190,
  }) : h('div', { class: 'empty' }, ['자료 없음']);

  // Open-Meteo 의 snowfall 은 cm(적설 깊이)이므로 비(mm)와 더하려면 수상당량으로 환산한다.
  const snowWE = (D.snowfall_sum ?? []).map((v) => (Number.isFinite(v) ? v * 0.7 : 0));
  const precipChart = D.time?.length ? barChart(D.time, [
    { label: '비', values: D.rain_sum ?? [], color: '#38bdf8' },
    { label: '눈(수상당량)', values: snowWE, color: '#e2e8f0' },
  ], { yLabel: 'mm/일 (수상당량)' }) : h('div', { class: 'empty' }, ['자료 없음']);

  // 인근 지진
  const near = (quakes ?? [])
    .map((q) => ({ ...q, d: haversine(site.lat, site.lon, q.lat, q.lon) }))
    .filter((q) => q.d <= 250).sort((a, b) => b.time - a.time).slice(0, 5);

  const quakeBlock = near.length
    ? h('ul', { class: 'quakes' }, near.map((q) => h('li', {}, [
        h('b', { class: q.mag >= 5.5 ? 'hot' : '' }, [`M${q.mag.toFixed(1)}`]),
        h('span', {}, [`${Math.round(q.d)} km · 깊이 ${Math.round(q.depthKm)} km`]),
        h('small', {}, [timeKST(q.time)]),
      ])))
    : h('p', { class: 'muted' }, ['반경 250 km 이내 최근 30일 M4.0+ 지진 없음.']);

  const trendBlock = trend
    ? trendChart(trend, { yLabel: `연평균 기온 °C @ ${nf(site.glacierElev)} m` })
    : h('button', { class: 'btn ghost', onclick: onLoadTrend }, ['장기 기온 추세 불러오기 (ERA5 재분석, 1995~)']);

  const historyBlock = history?.length
    ? h('div', { class: 'card' }, [
        h('h3', {}, ['NAS 수집 이력 · 위험도 추이']),
        lineChart(history.map((p) => p.t), [{ values: history.map((p) => p.score), color }], {
          yLabel: '위험 점수', h: 160,
        }),
      ])
    : null;

  mount(host,
    head,
    h('div', { class: 'card' }, [h('h3', {}, ['지점 제원']), specTable,
      site.history ? h('p', { class: 'history' }, [site.history]) : null]),
    isLake ? h('div', { class: 'card' }, [
      h('h3', {}, ['위험 요인 분해']),
      h('p', { class: 'muted small' }, ['각 요인을 0~1로 정규화한 뒤 가중 합산하고, 지점별 정적 취약도를 곱해 0~100으로 환산합니다.']),
      factorList,
    ]) : h('div', { class: 'card' }, [h('h3', {}, ['융해 요인']), factorList]),
    h('div', { class: 'card' }, [h('h3', {}, ['기온 (14일 실측 + 7일 예보)']), tempChart]),
    h('div', { class: 'card' }, [h('h3', {}, ['0 °C 동결고도 vs 빙하 말단']), flChart]),
    h('div', { class: 'card' }, [
      h('h3', {}, ['일별 강수 — 비/눈 구분']),
      h('div', { class: 'legend' }, [
        h('span', { class: 'legend-item' }, [h('i', { style: 'background:#38bdf8' }), '비']),
        h('span', { class: 'legend-item' }, [h('i', { style: 'background:#e2e8f0' }), '눈(수상당량)']),
      ]),
      h('p', { class: 'muted small' }, ['눈은 빙하에 질량을 더하지만, 비는 융해를 가속하고 호수 수위를 직접 끌어올립니다. 적설은 수상당량(적설 1 cm ≈ 0.7 mm)으로 환산했습니다.']), precipChart]),
    h('div', { class: 'card' }, [h('h3', {}, ['인근 지진 (반경 250 km · 30일)']), quakeBlock]),
    h('div', { class: 'card' }, [h('h3', {}, ['장기 온난화 추세']), trendBlock]),
    historyBlock,
  );
}

function haversine(la1, lo1, la2, lo2) {
  const R = 6371, r = Math.PI / 180;
  const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/* ---------------- 보조 패널 ---------------- */
export function renderLegend(host) {
  host.replaceChildren(
    h('div', { class: 'legend' }, LEVELS.map((l) => h('span', { class: 'legend-item', title: l.desc }, [
      h('i', { style: `background:${l.color}` }), `${l.label} ${l.min}+`,
    ]))),
  );
}

export function renderFacts(host) {
  host.replaceChildren(...NATIONAL_FACTS.map((f) => h('div', { class: 'fact' }, [
    h('div', { class: 'fact-value' }, [f.value]),
    h('div', { class: 'fact-label' }, [f.label]),
    h('div', { class: 'fact-note' }, [f.note]),
  ])));
}

export function renderRangeFilter(host, active, onPick) {
  const opts = [['all', '전체'], ...Object.entries(RANGES).map(([k, v]) => [k, v.label])];
  host.replaceChildren(...opts.map(([k, label]) =>
    h('button', { class: `chip${active === k ? ' on' : ''}`, onclick: () => onPick(k) }, [label])));
}

export function renderStatus(host, bundle) {
  const map = {
    collector: ['live', 'NAS 수집기 · 이력 포함'],
    live: ['live', '실시간 API 연결됨'],
    demo: ['demo', '데모 데이터 — 실제 관측값 아님'],
  };
  const [cls, text] = map[bundle.source] ?? ['demo', '알 수 없음'];
  host.className = `status ${cls}`;
  mount(host,
    h('i'), h('span', {}, [text]),
    h('small', {}, [`갱신 ${timeKST(bundle.fetchedAt)} (현지 ${timePeru(bundle.fetchedAt)})`]),
    bundle.errors?.length ? h('small', { class: 'warn' }, [`${bundle.errors.length}개 지점 수신 실패`]) : null,
  );
}
