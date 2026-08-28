/**
 * 전 지구 빙하 변화 화면
 *
 * 19개 RGI 지역의 대표 지점에서 ERA5 재분석 기온(1950~현재)을 받아
 * 연대별 기온 상승과 융해 조건 변화를 보여줍니다.
 */
import { RGI_REGIONS, TOTAL_GLACIER_AREA, MASS_LOSS_FACTS } from './regions.js';
import { loadGlobalClimate, BASELINE, clearClimateCache } from './globalclimate.js';
import { heatmap, divergingScale, lineChart, barChart, linreg, el } from './charts.js';
import { h, mount } from './ui.js';

const nf = (v, d = 0) => (Number.isFinite(v) ? v.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const signed = (v, d = 1) => (Number.isFinite(v) ? `${v >= 0 ? '+' : '−'}${nf(Math.abs(v), d)}` : '—');

const state = { data: null, selected: null, metric: 'anomaly', map: null, markers: new Map() };

const METRICS = {
  anomaly: {
    label: '기온 상승', unit: '°C',
    desc: `${BASELINE[0]}~${BASELINE[1]} 평균 대비 각 연대의 기온 차이`,
    get: (d) => d.anomaly, scale: divergingScale(0, 3), fmt: (v) => (v >= 0 ? '+' : '') + v.toFixed(1),
  },
  pdd: {
    label: '융해 도일', unit: '°C·일',
    desc: '한 해 동안 0 °C를 넘은 기온을 모두 더한 값. 빙하가 녹는 데 쓰인 에너지의 대리 지표',
    get: (d) => d.pdd, scale: divergingScale(400, 900), fmt: (v) => Math.round(v),
  },
  meltDays: {
    label: '영상 일수', unit: '일',
    desc: '한 해 중 하루 평균 기온이 0 °C를 넘은 날의 수',
    get: (d) => d.meltDays, scale: divergingScale(150, 200), fmt: (v) => Math.round(v),
  },
};

export async function initGlobalView(host) {
  mount(host, h('div', { class: 'loading-box' }, [
    h('div', { class: 'spinner' }),
    h('p', { id: 'gProgress' }, ['전 세계 19개 빙하 지역의 1950년 이후 기온 자료를 받는 중…']),
    h('p', { class: 'muted small' }, ['한 지역당 70여 년치 일별 자료라 처음 열 때는 시간이 걸립니다. 계산 결과는 저장해 두므로 다음부터는 즉시 열립니다.']),
  ]));

  try {
    state.data = await loadGlobalClimate({
      onProgress: (done, total, name) => {
        const p = document.getElementById('gProgress');
        if (p) p.textContent = `${done} / ${total} 지역 완료${name ? ` — ${name}` : ''}`;
      },
    });
  } catch (err) {
    mount(host, h('div', { class: 'empty' }, [`자료를 불러오지 못했습니다: ${err.message}`]));
    return;
  }
  render(host);
}

function regionOf(id) { return RGI_REGIONS.find((r) => r.id === id); }
function summaryOf(id) { return state.data.regions.find((r) => r.id === id); }

function render(host) {
  const regions = state.data.regions;
  if (!regions.length) {
    mount(host, h('div', { class: 'empty' }, ['불러온 지역이 없습니다.']));
    return;
  }

  const warmings = regions.map((r) => r.warming).filter(Number.isFinite);
  const avgWarming = warmings.reduce((a, b) => a + b, 0) / warmings.length;
  const ratios = regions.map((r) => r.pddRatio).filter(Number.isFinite).sort((a, b) => a - b);
  const medRatio = ratios.length ? ratios[Math.floor(ratios.length / 2)] : null;
  const hottest = regions.slice().sort((a, b) => (b.warming ?? -99) - (a.warming ?? -99))[0];
  const lastDecade = Math.max(...regions.map((r) => r.lastDecade ?? 0));

  const tiles = [
    { label: '전 지구 빙하 면적', value: nf(TOTAL_GLACIER_AREA), unit: 'km²',
      sub: 'RGI 6.0 인벤토리 · 빙상 제외 (정적 참고치)', color: '#7dd3fc' },
    { label: `19개 지역 평균 기온 상승`, value: signed(avgWarming, 2), unit: '°C',
      sub: `${BASELINE[0]}~${BASELINE[1]} 평균 대비 ${lastDecade}년대`, color: '#fb923c' },
    { label: '융해 도일 변화 (중앙값)', value: medRatio ? `${nf(medRatio, 2)}` : '—', unit: '배',
      sub: medRatio ? `기준기간 대비 ${lastDecade}년대에 ${((medRatio - 1) * 100).toFixed(0)}% 증가` : '자료 부족',
      color: '#f43f5e' },
    { label: '가장 빠르게 더워진 지역', value: signed(hottest?.warming, 2), unit: '°C',
      sub: regionOf(hottest?.id)?.name ?? '—', color: '#fca5a5' },
  ];

  mount(host,
    state.data.source === 'demo' ? h('div', { class: 'banner' }, [
      h('b', {}, ['데모 데이터입니다. ']),
      '수집기가 DEMO 모드로 돌고 있어 합성 기후 자료를 보여주고 있습니다. 실제 관측·재분석 값이 아닙니다.',
    ]) : null,
    h('section', { class: 'kpis' }, tiles.map((t) => h('div', { class: 'kpi' }, [
      h('div', { class: 'kpi-label' }, [t.label]),
      h('div', { class: 'kpi-value', style: `color:${t.color}` }, [t.value, h('span', { class: 'kpi-unit' }, [' ' + t.unit])]),
      h('div', { class: 'kpi-sub' }, [t.sub]),
    ]))),

    h('section', { class: 'panel' }, [
      h('div', { class: 'panel-head' }, [
        h('h2', {}, ['지역 × 연대 — 어디가 얼마나 변했나']),
        h('div', { class: 'chips chips-sm' }, Object.entries(METRICS).map(([k, m]) =>
          h('button', {
            class: `chip${state.metric === k ? ' on' : ''}`,
            onclick: () => { state.metric = k; render(host); },
          }, [m.label]))),
      ]),
      h('p', { class: 'muted small' }, [METRICS[state.metric].desc, ' · 행을 누르면 그 지역의 상세가 열립니다.']),
      h('div', { class: 'heat-wrap' }, [buildHeatmap(host)]),
      heatLegend(),
    ]),

    h('section', { class: 'panel' }, [
      h('div', { class: 'panel-head' }, [h('h2', {}, [`지역별 기온 상승 순위 (${lastDecade}년대)`])]),
      h('p', { class: 'muted small' }, ['막대 길이는 기준기간 대비 상승폭, 괄호 안은 그 지역의 빙하 면적입니다. 북극권이 특히 빠르게 더워지고 있습니다.']),
      ranking(host, regions),
    ]),

    state.selected ? regionDetail(host) : h('section', { class: 'panel' }, [
      h('p', { class: 'muted small' }, ['위 표나 순위에서 지역을 고르면 연도별 추이와 연대별 변화를 볼 수 있습니다.']),
    ]),

    h('section', { class: 'panel' }, [
      h('div', { class: 'panel-head' }, [h('h2', {}, ['실제 얼마나 녹았나 — 공표된 관측값'])]),
      h('p', { class: 'muted small' }, [
        '위 수치는 기온에서 계산한 ',
        h('b', {}, ['융해 조건']),
        '이지 빙하가 실제로 잃은 얼음의 양이 아닙니다. 질량 변화는 위성 고도 측정과 현장 관측으로만 알 수 있고, 아래는 그 연구 결과입니다.',
      ]),
      h('div', { class: 'facts' }, MASS_LOSS_FACTS.map((f) => h('div', { class: 'fact' }, [
        h('div', { class: 'fact-value' }, [f.value, h('small', {}, [' ' + f.unit])]),
        h('div', { class: 'fact-label' }, [f.label]),
        h('div', { class: 'fact-note' }, [f.note]),
      ]))),
    ]),

    h('section', { class: 'panel methodology' }, [
      h('div', { class: 'panel-head' }, [h('h2', {}, ['이 숫자가 어떻게 나왔나'])]),
      h('div', { class: 'method-grid' }, [
        h('div', {}, [
          h('h3', {}, ['계산 방법']),
          h('ul', {}, [
            h('li', {}, ['19개 RGI 지역마다 대표 빙하 지점을 하나씩 정하고, 그 좌표·고도에서 ', h('b', {}, ['ERA5 재분석 일평균 기온(1950~현재)']), '을 받습니다.']),
            h('li', {}, ['연도별로 평균 기온, 양의 도일(0 °C를 넘은 기온의 합), 영상 일수를 집계한 뒤 연대별로 평균을 냅니다.']),
            h('li', {}, [`기준기간은 ${BASELINE[0]}~${BASELINE[1]}년이며, 기온 상승은 이 기준 대비 값입니다.`]),
          ]),
        ]),
        h('div', {}, [
          h('h3', { class: 'warn-h' }, ['한계']),
          h('ul', {}, [
            h('li', {}, ['지역당 ', h('b', {}, ['한 지점']), '으로 대표합니다. 알래스카나 남극처럼 넓은 지역의 내부 편차는 담기지 못합니다.']),
            h('li', {}, ['융해 도일은 표준적인 대리 지표지만 ', h('b', {}, ['질량 수지가 아닙니다.']), ' 강설량, 부채(debris) 피복, 빙하 역학은 반영되지 않습니다.']),
            h('li', {}, ['카라코람처럼 일부 지역은 기온이 올라도 강설 증가로 빙하가 유지되는 사례가 보고돼 있습니다.']),
            h('li', {}, ['ERA5 는 재분석 모델 산출물이라 고산지대에서는 실측과 차이가 있을 수 있습니다.']),
          ]),
        ]),
      ]),
      h('p', { class: 'muted small' }, [
        `자료 출처: Open-Meteo Archive API (ERA5) · RGI 6.0 · ${state.data.source === 'collector' ? 'NAS 수집기 경유' : '브라우저 직접 수집'}`,
        h('button', { class: 'btn ghost', style: 'margin-left:.6rem', onclick: () => { clearClimateCache(); initGlobalView(host); } }, ['다시 계산']),
      ]),
    ]),
  );
}

function buildHeatmap(host) {
  const m = METRICS[state.metric];
  const decades = [...new Set(state.data.regions.flatMap((r) => r.decades.map((d) => d.decade)))].sort((a, b) => a - b);
  const rows = state.data.regions
    .slice()
    .sort((a, b) => (b.warming ?? -99) - (a.warming ?? -99))
    .map((r) => ({ id: r.id, label: regionOf(r.id)?.name ?? r.id }));
  const cols = decades.map((d) => ({ id: d, label: `${String(d).slice(2)}s` }));

  const cells = [];
  for (const r of state.data.regions) {
    const name = regionOf(r.id)?.name ?? r.id;
    for (const d of r.decades) {
      const v = m.get(d);
      cells.push({
        row: r.id, col: d.decade, value: v,
        tip: `${name} · ${d.decade}년대\n${m.label}: ${Number.isFinite(v) ? m.fmt(v) : '—'} ${m.unit}\n(${d.years}개 연도 평균)`,
      });
    }
  }
  return heatmap(rows, cols, cells, {
    scale: m.scale, format: m.fmt,
    onClick: (r) => { state.selected = r.id; render(host); },
  });
}

function heatLegend() {
  const m = METRICS[state.metric];
  const steps = 7;
  const lo = state.metric === 'anomaly' ? -1 : (state.metric === 'pdd' ? 100 : 60);
  const hi = state.metric === 'anomaly' ? 3 : (state.metric === 'pdd' ? 1300 : 340);
  const swatches = Array.from({ length: steps }, (_, i) => {
    const v = lo + ((hi - lo) * i) / (steps - 1);
    return h('span', { class: 'heat-key' }, [
      h('i', { style: `background:${m.scale(v)}` }),
      h('small', {}, [m.fmt(v)]),
    ]);
  });
  return h('div', { class: 'heat-legend' }, [
    h('span', { class: 'muted small' }, [`${m.label} (${m.unit})`]),
    ...swatches,
  ]);
}

function ranking(host, regions) {
  const sorted = regions.slice().sort((a, b) => (b.warming ?? -99) - (a.warming ?? -99));
  const max = Math.max(...sorted.map((r) => Math.abs(r.warming ?? 0)), 1);
  return h('div', { class: 'rank' }, sorted.map((r) => {
    const reg = regionOf(r.id);
    const w = r.warming ?? 0;
    return h('button', {
      class: `rank-row${state.selected === r.id ? ' is-selected' : ''}`,
      onclick: () => { state.selected = r.id; render(host); },
    }, [
      h('span', { class: 'rank-name' }, [reg?.name ?? r.id, h('small', {}, [` ${nf(reg?.area)} km²`])]),
      h('span', { class: 'rank-track' }, [
        h('span', { class: 'rank-fill', style: `width:${(Math.abs(w) / max * 100).toFixed(1)}%;background:${divergingScale(0, 3)(w)}` }),
      ]),
      h('b', { class: 'rank-val' }, [signed(w, 2), ' °C']),
    ]);
  }));
}

function regionDetail(host) {
  const s = summaryOf(state.selected);
  const reg = regionOf(state.selected);
  if (!s || !reg) return null;

  const years = s.years;
  const { slope } = linreg(years.map((y) => y.year), years.map((y) => y.mean));
  const first = s.decades[0], last = s.decades[s.decades.length - 1];

  const lines = [
    `${reg.name}의 대표 지점(${reg.ref}, 해발 ${nf(reg.elev)} m)에서 ` +
    `${last.decade}년대 연평균 기온은 ${nf(last.mean, 2)} °C 로, ` +
    `${BASELINE[0]}~${BASELINE[1]} 평균보다 ${signed(s.warming, 2)} °C 높습니다.`,
    s.pddRatio
      ? `얼음을 녹이는 열(양의 도일)은 기준기간의 ${nf(s.pddRatio, 2)}배로 늘었고, ` +
        `한 해 중 영상인 날은 ${signed(s.meltDaysDelta, 0)}일 달라졌습니다.`
      : `이 지역은 기준기간에도 연중 대부분 영하여서 융해 도일 비율은 계산하지 않았습니다. ` +
        `${last.decade}년대 융해 도일은 ${nf(last.pdd, 0)} °C·일입니다.`,
  ];

  return h('section', { class: 'panel' }, [
    h('div', { class: 'panel-head' }, [
      h('h2', {}, [`${reg.name} — 연도별 · 연대별 변화`]),
      h('button', { class: 'btn ghost', onclick: () => { state.selected = null; render(host); } }, ['닫기']),
    ]),
    h('div', { class: 'verdict', style: `--c:${divergingScale(0, 3)(s.warming ?? 0)}` },
      lines.map((t) => h('p', { class: 'verdict-main' }, [t]))),

    h('div', { class: 'card' }, [
      h('h3', {}, ['연평균 기온 (1950~)']),
      lineChart(years.map((y) => `${y.year}-07-01`), [{ values: years.map((y) => y.mean), color: '#fb923c' }], {
        yLabel: `°C · 해발 ${nf(reg.elev)} m`, h: 200, fill: true,
        refLines: s.baseline ? [{ value: s.baseline.mean, label: `${BASELINE[0]}~${BASELINE[1]} 평균`, color: '#38bdf8' }] : [],
      }),
      h('p', { class: 'muted small' }, [`선형 추세 ${signed(slope * 10, 2)} °C / 10년`]),
    ]),

    h('div', { class: 'card' }, [
      h('h3', {}, ['연대별 융해 도일 — 얼음을 녹인 열의 양']),
      barChart(s.decades.map((d) => `${d.decade}-01-01`),
        [{ label: '융해 도일', values: s.decades.map((d) => d.pdd), color: '#f43f5e' }],
        { yLabel: '°C·일 / 년', h: 190 }),
      h('div', { class: 'decade-table' }, [
        h('div', { class: 'dt-head' }, ['연대', '연평균 기온', '기준 대비', '융해 도일', '영상 일수']),
        ...s.decades.map((d) => h('div', { class: 'dt-row' }, [
          h('span', {}, [`${d.decade}년대`]),
          h('span', {}, [`${nf(d.mean, 2)} °C`]),
          h('span', { style: `color:${divergingScale(0, 3)(d.anomaly ?? 0)}` }, [signed(d.anomaly, 2), ' °C']),
          h('span', {}, [nf(d.pdd, 0)]),
          h('span', {}, [`${nf(d.meltDays, 0)}일`]),
        ])),
      ]),
    ]),
  ]);
}
