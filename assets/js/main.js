/** 앱 부트스트랩 · 상태 관리 */
import { SITES } from './sites.js';
import { computeRisk } from './risk.js';
import { loadBundle, fetchArchive, fetchHistory } from './api.js';
import { GlacierMap, VIEWS, LAYERS } from './map.js';
import * as UI from './ui.js';
import { initGlobalView } from './globalview.js';

const REFRESH_MS = 10 * 60e3;

const state = {
  bundle: null,
  results: [],
  selected: null,
  range: 'all',
  sort: 'risk',
  trend: new Map(),
  history: new Map(),
  autoRefresh: true,
  timer: null,
};

const $ = (id) => document.getElementById(id);

const gmap = new GlacierMap($('map'), { onSelect: select });

/** 상단 탭 — 전 지구 뷰는 처음 열 때 한 번만 초기화한다(자료 수집이 무겁다). */
let globalReady = false;
function showView(which) {
  const isPeru = which === 'peru';
  $('peruView').hidden = !isPeru;
  $('globalView').hidden = isPeru;
  $('tabPeru').classList.toggle('on', isPeru);
  $('tabGlobal').classList.toggle('on', !isPeru);
  $('tabPeru').setAttribute('aria-selected', String(isPeru));
  $('tabGlobal').setAttribute('aria-selected', String(!isPeru));
  document.body.classList.toggle('view-peru', isPeru);
  if (isPeru) gmap.invalidate();
  else if (!globalReady) { globalReady = true; initGlobalView($('globalView')); }
  try { location.hash = isPeru ? '#peru' : '#global'; } catch { /* noop */ }
}

async function boot() {
  $('tabPeru').addEventListener('click', () => showView('peru'));
  $('tabGlobal').addEventListener('click', () => showView('global'));

  UI.renderLegend($('legend'));
  UI.renderFacts($('facts'));
  UI.renderRangeFilter($('rangeFilter'), state.range, (k) => { state.range = k; paint(); });

  $('viewTabs').replaceChildren(...Object.entries(VIEWS).map(([k, v]) =>
    UI.h('button', {
      class: `chip${k === 'peru' ? ' on' : ''}`, 'data-view': k,
      onclick: (e) => {
        [...$('viewTabs').children].forEach((c) => c.classList.remove('on'));
        e.currentTarget.classList.add('on');
        gmap.setView(k);
      },
    }, [v.label])));

  $('layerTabs').replaceChildren(...Object.entries(LAYERS).map(([k, v]) =>
    UI.h('button', {
      class: `chip${k === 'satellite' ? ' on' : ''}`,
      onclick: (e) => {
        [...$('layerTabs').children].forEach((c) => c.classList.remove('on'));
        e.currentTarget.classList.add('on');
        gmap.setLayer(k);
      },
    }, [v.label])));

  $('refreshBtn').addEventListener('click', () => refresh(true));
  $('autoToggle').addEventListener('change', (e) => {
    state.autoRefresh = e.target.checked;
    scheduleRefresh();
  });
  $('sortSel').addEventListener('change', (e) => { state.sort = e.target.value; paint(); });
  $('closeDetail').addEventListener('click', () => select(null));

  await refresh();
  showView(location.hash === '#peru' ? 'peru' : 'global');
}

async function refresh(manual = false) {
  document.body.classList.add('loading');
  if (manual) { try { sessionStorage.clear(); } catch { /* noop */ } }
  try {
    state.bundle = await loadBundle();
    compute();
    paint();
  } catch (err) {
    $('status').className = 'status demo';
    $('status').textContent = `데이터를 불러오지 못했습니다: ${err.message}`;
  } finally {
    document.body.classList.remove('loading');
    scheduleRefresh();
  }
}

function scheduleRefresh() {
  clearTimeout(state.timer);
  if (state.autoRefresh) state.timer = setTimeout(() => refresh(), REFRESH_MS);
}

function compute() {
  const { wx, quakes } = state.bundle;
  state.results = SITES
    .map((site) => {
      const w = wx[site.id];
      if (!w) return null;
      const r = computeRisk(site, w, quakes);
      if (!r) return null;
      r.wx = w;
      return r;
    })
    .filter(Boolean);
}

function visible() {
  let list = state.results;
  if (state.range !== 'all') list = list.filter((r) => r.site.rangeId === state.range);
  const key = {
    risk: (r) => -(r.site.type === 'lake' ? r.score ?? -1 : -1),
    melt: (r) => -(r.metrics.pdd7 ?? 0),
    pop: (r) => -(r.site.downstream?.pop ?? 0),
    name: (r) => r.site.name,
  }[state.sort];
  return list.slice().sort((a, b) => {
    const ka = key(a), kb = key(b);
    return typeof ka === 'string' ? ka.localeCompare(kb, 'ko') : ka - kb;
  });
}

function paint() {
  const list = visible();
  UI.renderStatus($('status'), state.bundle);
  $('demoBanner').hidden = state.bundle.source !== 'demo';
  UI.renderKPIs($('kpis'), state.results, state.bundle.quakes ?? []);
  UI.renderList($('siteList'), list, state.selected, select);
  gmap.setData(state.results, state.selected);
  UI.renderRangeFilter($('rangeFilter'), state.range, (k) => { state.range = k; paint(); });

  const alerts = state.results.filter((r) => r.site.type === 'lake' && (r.score ?? 0) >= 50)
    .sort((a, b) => b.score - a.score);
  $('alertBar').hidden = alerts.length === 0;
  if (alerts.length) {
    $('alertBar').replaceChildren(
      UI.h('b', {}, [`${alerts.length}곳 경계 이상`]),
      UI.h('span', {}, [alerts.map((a) => `${a.site.name}(${a.score})`).join(' · ')]),
    );
  }

  if (state.selected) {
    const r = state.results.find((x) => x.site.id === state.selected);
    if (r) {
      $('detail').hidden = false;
      UI.renderDetail($('detailBody'), r, {
        quakes: state.bundle.quakes ?? [],
        trend: state.trend.get(r.site.id),
        history: state.history.get(r.site.id),
        onLoadTrend: () => loadTrend(r.site),
      });
    }
  } else {
    $('detail').hidden = true;
  }
}

async function select(id) {
  state.selected = state.selected === id ? null : id;
  paint();
  if (state.selected) {
    gmap.focusSite(state.selected);
    $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (state.bundle.hasHistory && !state.history.has(state.selected)) {
      try {
        const hist = await fetchHistory(state.selected, 60);
        state.history.set(state.selected, hist.points ?? []);
        paint();
      } catch { /* 이력 없으면 무시 */ }
    }
  }
}

async function loadTrend(site) {
  const body = $('detailBody');
  body.querySelector('.btn.ghost')?.setAttribute('disabled', 'true');
  try {
    const pts = await fetchArchive(site);
    state.trend.set(site.id, pts);
  } catch (err) {
    state.trend.set(site.id, null);
    alert(`장기 추세를 불러오지 못했습니다: ${err.message}`);
  }
  paint();
}

boot();
