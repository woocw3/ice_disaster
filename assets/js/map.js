/**
 * 실제 지도 — Leaflet + 위성 영상.
 *
 * 도식 지도로는 "빙하가 어디 있고 호수가 얼마나 큰지"가 보이지 않습니다.
 * 위성 영상을 기본 배경으로 두면 하얀 빙하와 청록색 빙하호가 그대로 눈에 보입니다.
 *
 * Leaflet 은 vendor/leaflet 에 담아 두어 CDN 없이 동작합니다.
 * 타일만 외부에서 받아오며, 타일이 막히면 배경 없이 마커만 표시됩니다.
 * (구글 지도는 API 키와 결제 등록이 필요해 키 없이 쓸 수 있는 소스를 씁니다.)
 */
import { RANGES } from './sites.js';

/**
 * 이 배율 이상에서만 마커 이름표를 표시한다.
 * 코르디예라 블랑카는 8곳이 반경 40 km 안에 몰려 있어(팔카코차·야카·툴파라후는 서로 1~5 km)
 * 산맥 단위로 보는 배율에서는 이름표가 어차피 겹친다. 그 구간에서는
 * 점 + 마우스오버 툴팁 + 오른쪽 목록으로 보고, 실제로 파고든 뒤에 이름표를 켠다.
 * 선택한 지점만은 배율과 무관하게 항상 이름표를 보여준다(CSS .pin.is-selected).
 */
const LABEL_ZOOM = 12;

const LAYERS = {
  satellite: {
    label: '위성',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri, Maxar, Earthstar Geographics',
    maxZoom: 17,
  },
  terrain: {
    label: '지형',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri, USGS, NOAA',
    maxZoom: 17,
  },
  street: {
    label: '일반',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 18,
  },
};

export const VIEWS = {
  peru: { label: '페루 전체', center: [-11.6, -75.2], zoom: 5 },
  blanca: { label: '코르디예라 블랑카', center: [-9.22, -77.45], zoom: 9 },
  vilcanota: { label: '비야노타 · 쿠스코', center: [-13.9, -70.93], zoom: 9 },
  south: { label: '중·남부', center: [-13.7, -73.5], zoom: 6 },
};

export class GlacierMap {
  constructor(host, { onSelect } = {}) {
    this.host = host;
    this.onSelect = onSelect ?? (() => {});
    this.map = null;
    this.markers = new Map();
    this.layer = null;
    this.layerId = 'satellite';
    this.results = [];
    this.selected = null;
  }

  init() {
    if (this.map || !window.L) return;
    const L = window.L;
    this.map = L.map(this.host, {
      center: VIEWS.peru.center, zoom: VIEWS.peru.zoom,
      minZoom: 5, maxZoom: 17, zoomSnap: 0.5,
      zoomControl: true, attributionControl: true,
      // 페이지를 스크롤할 때 커서가 지도 위에 있으면 지도가 확대·축소돼
      // 엉뚱한 곳으로 가 버린다. Ctrl(⌘) + 휠일 때만 확대되게 한다.
      scrollWheelZoom: false,
    });
    this.host.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.map.setZoom(this.map.getZoom() - Math.sign(e.deltaY) * 0.5);
      }
    }, { passive: false });
    // 최소 확대에서 화면이 제한 범위보다 넓으면 지도가 계속 튕기므로,
    // zoom 5 화면(약 경도 35°)보다 넉넉한 범위를 잡는다.
    this.map.setMaxBounds([[-60, -100], [12, -50]]);
    this.map.on('drag', () => this.map.panInsideBounds(this.map.options.maxBounds, { animate: false }));

    // 헤매다 돌아올 수 있는 초기화 버튼
    const Home = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: () => {
        const el = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
        const a = L.DomUtil.create('a', '', el);
        a.href = '#'; a.title = '페루 전체 보기로 되돌리기'; a.textContent = '⌂';
        L.DomEvent.on(a, 'click', (e) => {
          L.DomEvent.stop(e);
          this.map.flyTo(VIEWS.peru.center, VIEWS.peru.zoom, { duration: 0.6 });
        });
        return el;
      },
    });
    this.map.addControl(new Home());
    this.setLayer(this.layerId);
    // 축척 막대가 있으면 "23 km 아래" 같은 거리 감각이 잡힌다
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(this.map);

    // 축소 상태에서는 이름표가 서로 겹쳐 읽을 수 없다.
    // 충분히 확대했을 때만 켜고, 그 전에는 점 + 마우스오버 툴팁으로 본다.
    const syncLabels = () => {
      this.host.classList.toggle('show-labels', this.map.getZoom() >= LABEL_ZOOM);
    };
    this.map.on('zoomend', syncLabels);
    syncLabels();
  }

  /** 숨겨진 상태에서 초기화되면 Leaflet 이 크기를 0 으로 잡는다. 탭이 보일 때 다시 계산. */
  invalidate() {
    if (this.map) setTimeout(() => this.map.invalidateSize(), 60);
  }

  setLayer(id) {
    if (!this.map || !LAYERS[id]) return;
    const L = window.L;
    if (this.layer) this.map.removeLayer(this.layer);
    const cfg = LAYERS[id];
    this.layerId = id;
    this.layer = L.tileLayer(cfg.url, { attribution: cfg.attribution, maxZoom: cfg.maxZoom }).addTo(this.map);
  }

  setView(v) {
    if (!this.map || !VIEWS[v]) return;
    this.map.flyTo(VIEWS[v].center, VIEWS[v].zoom, { duration: 0.7 });
  }

  focusSite(id) {
    const r = this.results.find((x) => x.site.id === id);
    if (r && this.map) this.map.flyTo([r.site.lat, r.site.lon], Math.max(this.map.getZoom(), 12), { duration: 0.8 });
  }

  setData(results, selected) {
    this.init();
    if (!this.map) return;
    this.results = results;
    this.selected = selected;
    const L = window.L;

    for (const r of results) {
      const { site } = r;
      const isLake = site.type === 'lake';
      const color = isLake && r.level ? r.level.color : '#cbd5e1';
      const score = isLake ? (r.score ?? 0) : (r.meltScore ?? 0);
      const isSel = selected === site.id;

      const html = `
        <span class="pin-halo" style="--c:${color};--s:${(score / 100).toFixed(2)}"></span>
        <span class="pin-dot ${isLake ? '' : 'is-glacier'}" style="--c:${color}"></span>
        <span class="pin-label">${site.name}<b style="color:${color}">${isLake ? (r.score ?? '—') : `융해 ${r.meltScore ?? '—'}`}</b></span>`;

      const icon = L.divIcon({
        className: `pin${isSel ? ' is-selected' : ''}${score >= 50 && isLake ? ' is-hot' : ''}`,
        html, iconSize: [16, 16], iconAnchor: [8, 8],
      });

      let mk = this.markers.get(site.id);
      if (mk) {
        mk.setIcon(icon);
      } else {
        mk = L.marker([site.lat, site.lon], { icon, title: site.name, riseOnHover: true })
          .addTo(this.map)
          .on('click', () => this.onSelect(site.id));
        this.markers.set(site.id, mk);
      }
      mk.bindTooltip(tooltipHTML(r), { direction: 'top', offset: [0, -12], opacity: 0.98, className: 'pin-tip' });
    }
  }
}

function tooltipHTML(r) {
  const { site, metrics } = r;
  const isLake = site.type === 'lake';
  const anom = Number.isFinite(metrics.flAnom) ? Math.round(metrics.flAnom) : null;
  return `
    <b>${site.name}</b>
    <small>${site.range} · ${site.region}</small>
    <div class="tip-row"><span>${isLake ? '위험도' : '융해 강도'}</span>
      <b style="color:${isLake && r.level ? r.level.color : '#cbd5e1'}">${isLake ? `${r.score} / 100 · ${r.level.label}` : `${r.meltScore} / 100`}</b></div>
    <div class="tip-row"><span>지난 7일 녹은 시간</span><b>${metrics.meltHours7 ?? '—'}시간</b></div>
    <div class="tip-row"><span>0 °C 경계</span><b>${anom === null ? '—' : `빙하 말단 ${anom >= 0 ? '+' : '−'}${Math.abs(anom)} m`}</b></div>
    ${isLake && site.downstream ? `<div class="tip-row"><span>하류</span><b>${site.downstream.city} ${site.downstream.pop.toLocaleString('ko-KR')}명</b></div>` : ''}
    <em>클릭하면 상세 분석</em>`;
}

export { LAYERS, RANGES };
