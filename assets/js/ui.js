/** DOM 렌더링 컴포넌트 — 숫자보다 "그 숫자가 뜻하는 것"을 먼저 보여준다. */
import { sparkline, lineChart, barChart, trendChart } from './charts.js';
import { LEVELS, nowIndex } from './risk.js';
import { NATIONAL_FACTS, RANGES } from './sites.js';
import { crossSection } from './crosssection.js';
import { explainMetrics, explainScore, shortStatus, explainExposure, BANDS, nf } from './interpret.js';

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

export const timeKST = (t) => new Date(t).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
const timePeru = (t) => new Date(t).toLocaleString('ko-KR', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' });

/* ---------------- KPI ---------------- */
export function renderKPIs(host, results, quakes) {
  const lakes = results.filter((r) => r.site.type === 'lake' && r.score != null);
  const top = lakes.slice().sort((a, b) => b.score - a.score)[0];
  const melting = results.filter((r) => r.metrics.flAnom > 0);
  const hrs = results.map((r) => r.metrics.meltHours7).filter(Number.isFinite);
  const avgHrs = hrs.length ? hrs.reduce((a, b) => a + b, 0) / hrs.length : NaN;
  const maxMag = quakes.length ? Math.max(...quakes.map((q) => q.mag)) : null;

  const tiles = [
    {
      label: '가장 위험한 빙하호',
      value: top ? String(top.score) : '—',
      unit: top ? `/ 100` : '',
      sub: top ? `${top.site.name} — ${top.level.label}` : '자료 없음',
      color: top?.level?.color,
    },
    {
      label: '지금 녹고 있는 지점',
      value: `${melting.length}`,
      unit: `/ ${results.length}곳`,
      sub: '빙하 말단이 0 °C 경계보다 아래에 있음',
      color: melting.length > results.length / 2 ? '#fb923c' : '#7dd3fc',
    },
    {
      label: '지난 7일 녹은 시간',
      value: nf(avgHrs), unit: '시간',
      sub: `168시간 중 평균 ${nf((avgHrs / 168) * 100)}% 가 영상 기온`,
      color: '#fbbf24',
    },
    {
      label: '최근 30일 지진',
      value: String(quakes.length), unit: '회',
      sub: maxMag ? `최대 규모 ${maxMag.toFixed(1)} · 붕괴 방아쇠 요인` : '규모 4.0 이상 없음',
      color: '#c4b5fd',
    },
  ];

  mount(host, ...tiles.map((t) => h('div', { class: 'kpi' }, [
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
    const H = r.wx?.hourly;
    const i0 = H?.time ? nowIndex(H.time) : 0;
    const spark = H ? sparkline(H.temperature_2m.slice(Math.max(0, i0 - 168), i0 + 1), { color, zero: 0 }) : h('span');

    return h('button', {
      class: `row${selectedId === site.id ? ' is-selected' : ''}`,
      onclick: () => onSelect(site.id),
    }, [
      h('span', { class: 'row-bar', style: `background:${color}` }),
      h('span', { class: 'row-main' }, [
        h('span', { class: 'row-name' }, [site.name, !isLake ? h('span', { class: 'tag' }, ['빙하']) : null]),
        h('span', { class: 'row-meta' }, [shortStatus(site, r),
          isLake && site.downstream ? ` · 하류 ${nf(site.downstream.pop)}명` : '']),
      ]),
      h('span', { class: 'row-spark' }, [spark]),
      h('span', { class: 'row-melt' }, [
        h('b', {}, [Number.isFinite(metrics.meltHours7) ? `${metrics.meltHours7}h` : '—']),
        h('small', {}, ['녹은 시간']),
      ]),
      h('span', { class: 'row-score', style: `--c:${color}` }, [
        h('b', {}, [isLake ? String(r.score ?? '—') : String(r.meltScore ?? '—')]),
        h('small', {}, [isLake ? r.level?.label ?? '' : '융해']),
      ]),
    ]);
  });
  mount(host, ...rows);
}

/* ---------------- 상세 ---------------- */
export function renderDetail(host, r, { quakes, onLoadTrend, trend, history }) {
  const { site, metrics } = r;
  const isLake = site.type === 'lake';
  const color = isLake && r.level ? r.level.color : '#94a3b8';
  const H = r.wx?.hourly ?? { time: [] };
  const D = r.wx?.daily ?? { time: [] };
  const i0 = H.time.length ? nowIndex(H.time) : 0;
  const verdict = explainScore(site, r);
  const explained = explainMetrics(site, r);

  const head = h('div', { class: 'detail-head' }, [
    h('div', {}, [
      h('h2', {}, [site.name, h('span', { class: 'detail-es' }, [site.nameEs])]),
      h('div', { class: 'detail-sub' }, [`${site.range} · ${site.region} · ${site.summitName} 아래`]),
    ]),
    h('div', { class: 'detail-score', style: `--c:${color}` }, [
      h('b', {}, [String(isLake ? r.score : r.meltScore)]),
      h('span', {}, [isLake ? `${r.level.label} · 100점 만점` : '융해 강도']),
    ]),
  ]);

  const verdictBox = verdict ? h('div', { class: 'verdict', style: `--c:${color}` }, [
    h('p', { class: 'verdict-main' }, [verdict.meaning]),
    h('p', { class: 'verdict-sub' }, [verdict.sentence]),
  ]) : null;

  /* 단면도 — 이 화면의 핵심 그림 */
  const xsec = h('div', { class: 'card card-hero' }, [
    h('h3', {}, ['한눈에 보기 — 지금 어디까지 녹고 있나']),
    h('p', { class: 'muted small' }, [
      '산 정상부터 빙하 말단, 호수, 하류 마을까지를 같은 높이 축으로 그린 단면도입니다. ',
      '주황색 띠가 지금 녹고 있는 구간입니다.',
    ]),
    crossSection(site, metrics),
  ]);

  /* 지표별 해석 카드 */
  const cards = h('div', { class: 'explain' }, explained.map((e) => {
    const band = BANDS[e.band];
    return h('div', { class: 'ex' }, [
      h('div', { class: 'ex-top' }, [
        h('span', { class: 'ex-title' }, [e.title]),
        h('span', { class: 'ex-band', style: `--c:${band.color}` }, [band.label]),
      ]),
      h('div', { class: 'ex-value', style: `color:${band.color}` }, [
        e.value, h('small', {}, [e.unit]),
      ]),
      h('div', { class: 'ex-track' }, [
        h('div', { class: 'ex-fill', style: `width:${(e.index * 100).toFixed(1)}%;background:${band.color}` }),
      ]),
      h('p', { class: 'ex-plain' }, [e.plain]),
      h('div', { class: 'ex-detail' }, [e.detail]),
    ]);
  }));

  /* 하류 노출 */
  const exposure = explainExposure(site);
  const specs = [
    site.lakeElev && ['호수 수면 높이', `${nf(site.lakeElev)} m`],
    ['빙하 말단 높이', `${nf(site.glacierElev)} m`],
    ['정상 높이', `${nf(site.summitElev)} m`],
    site.volumeMm3 && ['호수에 담긴 물', `약 ${nf(site.volumeMm3)}백만 m³`],
    site.damType && ['호수를 막고 있는 것', site.damType],
  ].filter(Boolean);

  const exposureCard = h('div', { class: 'card' }, [
    h('h3', {}, [isLake ? '터지면 어디로 흐르나' : '지점 제원']),
    exposure ? h('p', { class: 'exposure' }, [exposure]) : null,
    h('div', { class: 'specs' }, specs.map(([k, v]) =>
      h('div', { class: 'spec' }, [h('dt', {}, [k]), h('dd', {}, [v])]))),
    site.history ? h('p', { class: 'history' }, ['과거 기록 — ', site.history]) : null,
  ]);

  /* 그래프 (접어둠) */
  const from = Math.max(0, i0 - 14 * 24);
  const times = H.time.slice(from);
  const band = { from: i0 - from, to: times.length - 1 };
  const snowWE = (D.snowfall_sum ?? []).map((v) => (Number.isFinite(v) ? v * 0.7 : 0));

  const charts = h('details', { class: 'card fold' }, [
    h('summary', {}, ['자세한 그래프 — 기온 · 0 °C 경계 · 강수']),
    h('div', { class: 'fold-body' }, [
      h('h4', {}, ['기온 (지난 14일 + 앞으로 7일 예보)']),
      h('p', { class: 'muted small' }, ['가로 파란 선이 0 °C입니다. 선 위로 올라간 시간만큼 빙하가 녹습니다. 오른쪽 음영이 예보 구간입니다.']),
      times.length ? lineChart(times, [{ values: H.temperature_2m.slice(from), color: '#fbbf24' }], {
        refLines: [{ value: 0, label: '0 °C 융해', color: '#38bdf8' }], bands: [band],
        yLabel: `°C · 해발 ${nf(site.glacierElev)} m`, fill: true,
      }) : h('div', { class: 'empty' }, ['자료 없음']),

      h('h4', {}, ['0 °C 경계 높이 vs 빙하 말단']),
      h('p', { class: 'muted small' }, ['파란 선(0 °C 경계)이 빨간 선(빙하 말단)보다 위에 있는 동안 말단부가 녹습니다.']),
      times.length ? lineChart(times, [{ values: H.freezing_level_height.slice(from), color: '#38bdf8' }], {
        refLines: [
          { value: site.glacierElev, label: '빙하 말단', color: '#f43f5e' },
          site.lakeElev ? { value: site.lakeElev, label: '호수 수면', color: '#a78bfa' } : null,
        ].filter(Boolean),
        bands: [band], yLabel: '높이 (m)', h: 190,
      }) : h('div', { class: 'empty' }, ['자료 없음']),

      h('h4', {}, ['일별 강수 — 비와 눈']),
      h('p', { class: 'muted small' }, ['눈은 빙하에 쌓여 오히려 도움이 되지만, 비는 융해를 가속하고 호수 수위를 직접 올립니다.']),
      h('div', { class: 'legend' }, [
        h('span', { class: 'legend-item' }, [h('i', { style: 'background:#38bdf8' }), '비']),
        h('span', { class: 'legend-item' }, [h('i', { style: 'background:#e2e8f0' }), '눈 (수상당량)']),
      ]),
      D.time?.length ? barChart(D.time, [
        { label: '비', values: D.rain_sum ?? [], color: '#38bdf8' },
        { label: '눈', values: snowWE, color: '#e2e8f0' },
      ], { yLabel: 'mm/일' }) : h('div', { class: 'empty' }, ['자료 없음']),
    ]),
  ]);

  /* 지진 */
  const near = (quakes ?? [])
    .map((q) => ({ ...q, d: haversine(site.lat, site.lon, q.lat, q.lon) }))
    .filter((q) => q.d <= 250).sort((a, b) => b.time - a.time).slice(0, 5);
  const quakeCard = near.length ? h('details', { class: 'card fold' }, [
    h('summary', {}, [`인근 지진 ${near.length}건 (반경 250 km · 최근 30일)`]),
    h('ul', { class: 'quakes fold-body' }, near.map((q) => h('li', {}, [
      h('b', { class: q.mag >= 5.5 ? 'hot' : '' }, [`M${q.mag.toFixed(1)}`]),
      h('span', {}, [`${Math.round(q.d)} km 거리 · 깊이 ${Math.round(q.depthKm)} km`]),
      h('small', {}, [timeKST(q.time)]),
    ]))),
  ]) : null;

  /* 장기 추세 */
  const trendCard = h('details', { class: 'card fold' }, [
    h('summary', {}, ['장기 온난화 추세 (1995년~)']),
    h('div', { class: 'fold-body' }, [
      h('p', { class: 'muted small' }, ['이 지점 상공의 연평균 기온입니다. 붉은 점선이 우상향할수록 빙하가 장기적으로 줄어드는 조건입니다.']),
      trend ? trendChart(trend, { yLabel: `연평균 °C · 해발 ${nf(site.glacierElev)} m` })
        : h('button', { class: 'btn ghost', onclick: onLoadTrend }, ['불러오기 (ERA5 재분석)']),
    ]),
  ]);

  const historyCard = history?.length ? h('div', { class: 'card' }, [
    h('h3', {}, ['NAS 수집 이력 — 위험도 추이']),
    lineChart(history.map((p) => p.t), [{ values: history.map((p) => p.score), color }], { yLabel: '위험 점수', h: 160 }),
  ]) : null;

  mount(host, head, verdictBox, xsec,
    h('div', { class: 'card' }, [
      h('h3', {}, ['지금 상태 — 항목별로']),
      h('p', { class: 'muted small' }, ['막대는 각 항목이 얼마나 올라와 있는지를 0~100%로 나타냅니다.']),
      cards,
    ]),
    exposureCard, charts, quakeCard, trendCard, historyCard);
}

function haversine(la1, lo1, la2, lo2) {
  const R = 6371, r = Math.PI / 180;
  const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/* ---------------- 보조 패널 ---------------- */
export function renderLegend(host) {
  mount(host, h('div', { class: 'legend' }, LEVELS.map((l) => h('span', { class: 'legend-item', title: l.desc }, [
    h('i', { style: `background:${l.color}` }), `${l.label} ${l.min}점~`,
  ]))));
}

export function renderFacts(host) {
  mount(host, ...NATIONAL_FACTS.map((f) => h('div', { class: 'fact' }, [
    h('div', { class: 'fact-value' }, [f.value]),
    h('div', { class: 'fact-label' }, [f.label]),
    h('div', { class: 'fact-note' }, [f.note]),
  ])));
}

export function renderRangeFilter(host, active, onPick) {
  const opts = [['all', '전체'], ...Object.entries(RANGES).map(([k, v]) => [k, v.label])];
  mount(host, ...opts.map(([k, label]) =>
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
    h('small', {}, [`갱신 ${timeKST(bundle.fetchedAt)} · 현지 ${timePeru(bundle.fetchedAt)}`]),
    bundle.errors?.length ? h('small', { class: 'warn' }, [`${bundle.errors.length}곳 수신 실패`]) : null,
  );
}
