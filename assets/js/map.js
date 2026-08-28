/**
 * 타일 서버 없이 그리는 SVG 지도.
 * 외부 요청이 없으므로 오프라인·사내망에서도 그대로 렌더링된다.
 * 좌표는 등장방형(위경도 선형) 투영이며, 위도별 경도 축소만 보정한다.
 */
import { el } from './charts.js';
import { RANGES } from './sites.js';

// 페루 국경·해안선 윤곽 (표시용 단순화 — 측량·경계 확정 용도가 아닙니다)
const PERU = [
  // 태평양 연안 (북 → 남)
  [-80.30, -3.38], [-80.90, -3.60], [-81.05, -4.20], [-81.32, -4.65], [-81.16, -5.20],
  [-80.90, -5.65], [-80.65, -5.95], [-79.95, -6.70], [-79.55, -7.10], [-78.95, -7.85],
  [-78.65, -8.35], [-78.35, -8.90], [-78.10, -9.30], [-77.65, -10.00], [-77.25, -10.70],
  [-77.15, -11.55], [-77.03, -12.05], [-76.30, -13.30], [-75.95, -14.05], [-75.20, -14.65],
  [-74.30, -15.75], [-73.30, -16.20], [-72.40, -16.75], [-71.55, -17.20], [-70.85, -17.65],
  [-70.40, -18.35],
  // 칠레 · 볼리비아 국경 (남 → 북동)
  [-69.85, -18.10], [-69.50, -17.50], [-69.20, -16.70], [-69.05, -16.20], [-69.40, -15.65],
  [-69.60, -15.20], [-69.20, -14.60], [-68.95, -14.20], [-69.05, -13.70], [-68.75, -12.85],
  [-69.40, -12.20], [-69.95, -11.00], [-70.55, -11.00], [-70.65, -10.50], [-71.25, -9.95],
  // 브라질 국경
  [-72.20, -9.90], [-72.95, -9.50], [-73.20, -9.40], [-72.80, -9.00], [-73.55, -8.40],
  [-73.75, -7.80], [-74.05, -7.35], [-73.70, -6.90], [-73.15, -6.45], [-72.90, -5.15],
  // 콜롬비아 국경 (레티시아 사다리꼴 포함)
  [-71.75, -4.55], [-70.95, -4.35], [-70.10, -2.70], [-70.75, -2.55], [-71.85, -2.30],
  [-73.15, -1.80], [-74.30, -0.95], [-75.25, -0.15], [-75.60, -0.15], [-76.10, -0.45],
  // 에콰도르 국경 (동 → 서, 남쪽으로 파인 구간 포함)
  [-77.00, -0.90], [-77.70, -1.05], [-78.35, -2.90], [-78.90, -4.55], [-79.60, -4.45],
  [-80.15, -4.00], [-80.50, -3.55],
];

const CORDILLERA = [
  [[-80.0, -5.5], [-78.6, -7.0], [-77.6, -9.2], [-76.5, -11.5], [-75.3, -13.2], [-73.5, -14.5], [-71.9, -15.6], [-70.4, -17.0]],
  [[-78.3, -6.0], [-77.2, -8.2], [-76.0, -10.5], [-74.5, -12.6], [-72.5, -13.6], [-70.9, -14.4], [-69.6, -16.0]],
];

export const VIEWS = {
  peru:      { label: '페루 전체',     bounds: [-81.8, -18.8, -68.3, 0.4] },
  blanca:    { label: '코르디예라 블랑카', bounds: [-77.95, -9.85, -77.05, -8.65] },
  vilcanota: { label: '비야노타 · 쿠스코',  bounds: [-71.60, -14.35, -70.35, -13.55] },
  south:     { label: '중·남부',       bounds: [-76.20, -16.10, -70.00, -11.40] },
};

export class GlacierMap {
  constructor(host, { onSelect } = {}) {
    this.host = host;
    this.onSelect = onSelect ?? (() => {});
    this.view = 'peru';
    this.results = [];
    this.selected = null;
  }

  setView(v) { if (VIEWS[v]) { this.view = v; this.render(); } }
  setData(results, selected) { this.results = results; this.selected = selected; this.render(); }

  project(bounds) {
    const [w, s, e, n] = bounds;
    const midLat = (s + n) / 2;
    const kx = Math.cos((midLat * Math.PI) / 180);
    const spanX = (e - w) * kx, spanY = n - s;
    const W = 100 * (spanX / Math.max(spanX, spanY));
    const H = 100 * (spanY / Math.max(spanX, spanY));
    return {
      W, H,
      x: (lon) => ((lon - w) * kx / spanX) * W,
      y: (lat) => ((n - lat) / spanY) * H,
    };
  }

  render() {
    const bounds = VIEWS[this.view].bounds;
    const p = this.project(bounds);
    const svg = el('svg', {
      viewBox: `-3 -3 ${p.W + 6} ${p.H + 6}`, class: 'map', role: 'img',
      'aria-label': '페루 빙하호 위험도 지도',
    });

    const path = (pts, close) =>
      pts.map(([lo, la], i) => `${i ? 'L' : 'M'}${p.x(lo).toFixed(2)} ${p.y(la).toFixed(2)}`).join(' ') + (close ? ' Z' : '');

    svg.append(el('path', { d: path(PERU, true), class: 'map-land' }));
    for (const ridge of CORDILLERA) svg.append(el('path', { d: path(ridge, false), class: 'map-ridge' }));

    // 산맥 라벨 (전체 보기에서만)
    if (this.view === 'peru') {
      const groups = new Map();
      for (const r of this.results) {
        const g = groups.get(r.site.rangeId) ?? [];
        g.push(r); groups.set(r.site.rangeId, g);
      }
      for (const [rangeId, list] of groups) {
        const lon = list.reduce((s, r) => s + r.site.lon, 0) / list.length;
        const lat = list.reduce((s, r) => s + r.site.lat, 0) / list.length;
        // 마커 후광과 겹치지 않도록 왼쪽으로 충분히 띄우고 연결선을 그린다
        const lx = p.x(lon) - 5.5, ly = p.y(lat) - 0.6;
        svg.append(el('line', {
          x1: lx + 0.7, y1: ly - 0.7, x2: p.x(lon) - 2.6, y2: p.y(lat) - 0.9, class: 'map-leader',
        }));
        svg.append(el('text', {
          x: lx, y: ly, class: 'map-range-label', 'text-anchor': 'end',
        }, [RANGES[rangeId]?.label ?? rangeId]));
      }
    }

    for (const r of this.results) {
      const { site } = r;
      const cx = p.x(site.lon), cy = p.y(site.lat);
      if (cx < -4 || cx > p.W + 4 || cy < -4 || cy > p.H + 4) continue;

      const isLake = site.type === 'lake';
      const color = isLake && r.level ? r.level.color : '#94a3b8';
      const score = isLake ? (r.score ?? 0) : (r.meltScore ?? 0);
      const rad = this.view === 'peru' ? 1.5 : 1.9;
      const isSel = this.selected === site.id;

      const g = el('g', { class: `marker${isSel ? ' is-selected' : ''}`, tabindex: '0', role: 'button' });
      // 위험도가 높을수록 후광이 커진다
      g.append(el('circle', { cx, cy, r: rad + 1.4 + (score / 100) * 3.4, fill: color, opacity: 0.16 }));
      if (score >= 50 && isLake) g.append(el('circle', { cx, cy, r: rad + 1.2, fill: 'none', stroke: color, 'stroke-width': 0.35, class: 'pulse' }));
      g.append(el(isLake ? 'circle' : 'rect', isLake
        ? { cx, cy, r: rad, fill: color, stroke: '#0b1220', 'stroke-width': 0.35 }
        : { x: cx - rad, y: cy - rad, width: rad * 2, height: rad * 2, fill: 'none', stroke: color, 'stroke-width': 0.5, transform: `rotate(45 ${cx} ${cy})` }));
      g.append(el('title', {}, [`${site.name} · ${isLake ? `위험도 ${r.score ?? '—'}` : `융해 ${r.meltScore ?? '—'}`}`]));

      if (this.view !== 'peru') {
        g.append(el('text', { x: cx + rad + 1.2, y: cy + 1.1, class: 'map-label' }, [site.name]));
      }

      const pick = () => this.onSelect(site.id);
      g.addEventListener('click', pick);
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      svg.append(g);
    }

    this.host.replaceChildren(svg);
  }
}
