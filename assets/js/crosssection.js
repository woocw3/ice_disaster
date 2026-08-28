/**
 * 단면도 — 이 대시보드에서 가장 중요한 그림.
 *
 * "0 °C 고도가 빙하 말단보다 +344 m" 같은 문장은 숫자만으로는 와닿지 않습니다.
 * 산·빙하·0 °C 경계·호수·하류 마을을 한 장에 같은 고도 축으로 그려 두면
 * 지금 어디까지 녹고 있는지가 설명 없이 보입니다.
 */
import { el } from './charts.js';

const nf = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('ko-KR') : '—');

// 산등성이 윤곽 — x는 0~1 비율, y는 고도를 만들어 내는 계수
// (정상 → 빙하 → 말단 → 급사면 → 호수 → 모레인 댐 → 하류 계곡)
const PROFILE = [
  { x: 0.00, at: 'summit' },
  { x: 0.09, at: 'summit', d: -60 },
  { x: 0.20, at: 'mid' },
  { x: 0.34, at: 'terminus', d: 120 },
  { x: 0.42, at: 'terminus' },
  { x: 0.50, at: 'lake', d: 90 },
  { x: 0.55, at: 'lake' },
  { x: 0.76, at: 'lake' },
  { x: 0.80, at: 'lake', d: 55 },   // 모레인 댐 마루
  { x: 0.86, at: 'lake', d: -200 },
  { x: 1.00, at: 'lake', d: -560 },
];

export function crossSection(site, metrics, { w = 720, h = 360 } = {}) {
  const isLake = site.type === 'lake';
  const lakeElev = site.lakeElev ?? site.glacierElev - 350;
  const fl = metrics?.flMean3;

  const pad = { t: 26, r: 14, b: 30, l: 58 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;

  const top = site.summitElev + 200;
  const bottom = lakeElev - 720;   // 호수 아래 계곡과 하류 주석이 들어갈 여유
  const Y = (m) => pad.t + ih - ((m - bottom) / (top - bottom)) * ih;
  const X = (t) => pad.l + t * iw;

  const anchors = { summit: site.summitElev, mid: (site.summitElev + site.glacierElev) / 2, terminus: site.glacierElev, lake: lakeElev };
  const pts = PROFILE.map((p) => ({ x: X(p.x), y: Y(anchors[p.at] + (p.d ?? 0)) }));

  const svg = el('svg', {
    viewBox: `0 0 ${w} ${h}`, class: 'xsec', role: 'img',
    'aria-label': `${site.name} 단면도 — 빙하 말단과 0 °C 경계의 높이 관계`,
  });

  const defs = el('defs');
  defs.append(
    grad('xsRock', '#243244', '#131c2a'),
    grad('xsIce', '#eaf6ff', '#a9d6ef'),
    grad('xsMelt', 'rgba(251,146,60,.42)', 'rgba(251,146,60,.06)'),
  );
  svg.append(defs);

  // 하늘 배경 + 고도 눈금
  svg.append(el('rect', { x: pad.l, y: pad.t, width: iw, height: ih, class: 'xs-sky', rx: 6 }));
  const step = niceStep(top - bottom);
  for (let m = Math.ceil(bottom / step) * step; m < top; m += step) {
    svg.append(el('line', { x1: pad.l, x2: w - pad.r, y1: Y(m), y2: Y(m), class: 'xs-grid' }));
    svg.append(el('text', { x: pad.l - 7, y: Y(m) + 3.5, class: 'xs-axis', 'text-anchor': 'end' }, [`${nf(m)}`]));
  }
  svg.append(el('text', { x: 4, y: pad.t - 10, class: 'xs-axis xs-unit' }, ['해발 (m)']));

  /* --- 녹고 있는 구간: 빙하 말단 ~ 0 °C 경계 --- */
  // 띠는 빙하가 실제로 덮인 가로 구간에만 그린다. 전체 폭에 칠하면
  // 빙하가 없는 계곡까지 녹는 것처럼 보여 오해를 준다.
  const meltTop = Math.min(fl ?? site.glacierElev, site.summitElev);
  const iceRight = X(0.46);
  if (Number.isFinite(fl) && fl > site.glacierElev) {
    const yTop = Y(meltTop), yBot = Y(site.glacierElev);
    svg.append(el('rect', {
      x: pad.l, y: yTop, width: iceRight - pad.l, height: Math.max(1, yBot - yTop),
      fill: 'url(#xsMelt)',
    }));
    // 띠가 얇으면 글자가 안 들어가므로 오른쪽 여백으로 빼서 지시선을 긋는다
    const thin = yBot - yTop < 26;
    const ly = thin ? yTop - 10 : (yTop + yBot) / 2 + 4;
    if (thin) {
      svg.append(el('line', { x1: iceRight - 30, y1: (yTop + yBot) / 2, x2: iceRight + 8, y2: ly + 3, class: 'xs-lead' }));
    }
    svg.append(el('text', {
      x: thin ? iceRight + 12 : (pad.l + iceRight) / 2, y: ly,
      class: 'xs-melt-label', 'text-anchor': thin ? 'start' : 'middle',
    }, [`녹고 있는 구간 ${nf(fl - site.glacierElev)} m`]));
  }

  /* --- 산체 --- */
  const rock = `M${pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L')} L${w - pad.r} ${pad.t + ih} L${pad.l} ${pad.t + ih} Z`;
  svg.append(el('path', { d: rock, fill: 'url(#xsRock)', stroke: '#3b5675', 'stroke-width': 1 }));

  /* --- 빙하 (정상 ~ 말단) --- */
  const ice = pts.filter((_, i) => PROFILE[i].x <= 0.42);
  const iceTop = ice.map((p) => `${p.x.toFixed(1)} ${(p.y - 13).toFixed(1)}`);
  const iceBottom = ice.slice().reverse().map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
  svg.append(el('path', {
    d: `M${iceTop.join(' L')} L${iceBottom.join(' L')} Z`,
    fill: 'url(#xsIce)', stroke: '#cfe9fa', 'stroke-width': 0.8, opacity: 0.95,
  }));
  svg.append(el('text', { x: X(0.035), y: Y(site.summitElev) - 10, class: 'xs-label' },
    [`정상 ${nf(site.summitElev)} m`]));
  svg.append(el('text', { x: X(0.17), y: Y(anchors.mid) - 22, class: 'xs-ice-label' }, ['빙하']));

  /* --- 0 °C 경계선 --- */
  if (Number.isFinite(fl) && fl < top && fl > bottom) {
    svg.append(el('line', { x1: pad.l, x2: w - pad.r, y1: Y(fl), y2: Y(fl), class: 'xs-fl' }));
    // 융해 구간 라벨이 오른쪽에 붙으므로 이쪽은 왼쪽에 둔다
    svg.append(el('text', { x: pad.l + 8, y: Y(fl) - 8, class: 'xs-fl-label' },
      [`0 °C 경계 ${nf(fl)} m — 위는 눈, 아래는 비`]));
  }

  /* --- 빙하 말단 표시 --- */
  svg.append(el('line', { x1: X(0.42), x2: X(0.42), y1: Y(site.glacierElev) - 16, y2: Y(site.glacierElev) + 4, class: 'xs-tick' }));
  svg.append(el('text', { x: X(0.43), y: Y(site.glacierElev) + 16, class: 'xs-label' }, [`빙하 말단 ${nf(site.glacierElev)} m`]));

  /* --- 호수 --- */
  if (isLake) {
    const lx1 = X(0.545), lx2 = X(0.765), ly = Y(lakeElev);
    svg.append(el('path', {
      d: `M${lx1} ${ly} L${lx2} ${ly} L${lx2 - 12} ${ly + 26} L${lx1 + 12} ${ly + 26} Z`,
      class: 'xs-water',
    }));
    svg.append(el('text', { x: (lx1 + lx2) / 2, y: ly - 9, class: 'xs-label', 'text-anchor': 'middle' },
      [`빙하호 ${nf(lakeElev)} m`]));
    // 댐 라벨은 마루 위로 충분히 띄우고 지시선을 그어 호수 라벨과 분리한다
    const damX = X(0.80), damY = Y(lakeElev + 55);
    svg.append(el('line', { x1: damX, y1: damY - 4, x2: damX + 14, y2: damY - 26, class: 'xs-lead' }));
    svg.append(el('text', { x: damX + 17, y: damY - 27, class: 'xs-label xs-dam' }, ['모레인 댐']));
  }

  /* --- 하류 --- */
  if (isLake && site.downstream) {
    const dx = w - pad.r - 4, dy = pad.t + ih - 6;
    const marker = el('marker', {
      id: 'xsArrow', viewBox: '0 0 8 8', refX: 6, refY: 4,
      markerWidth: 5, markerHeight: 5, orient: 'auto',
    }, [el('path', { d: 'M0 0 L8 4 L0 8 Z', fill: '#f87171' })]);
    defs.append(marker);
    // 물은 아래로 흐른다 — 댐 마루에서 시작해 계곡을 따라 내려가는 곡선
    svg.append(el('path', {
      d: `M${X(0.83)} ${Y(lakeElev + 10)} Q ${X(0.90)} ${Y(lakeElev - 160)} ${X(0.955)} ${Y(lakeElev - 380)}`,
      class: 'xs-flow', 'marker-end': 'url(#xsArrow)',
    }));
    svg.append(el('text', { x: dx, y: dy - 16, class: 'xs-town', 'text-anchor': 'end' },
      [`▼ ${site.downstream.city}`]));
    svg.append(el('text', { x: dx, y: dy - 2, class: 'xs-label', 'text-anchor': 'end' },
      [`${site.downstream.distanceKm} km 아래 · ${site.downstream.pop.toLocaleString('ko-KR')}명 · 낙차 ${nf(site.downstream.dropM)} m`]));
  }

  return svg;
}

function grad(id, c1, c2) {
  return el('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 }, [
    el('stop', { offset: '0%', 'stop-color': c1 }),
    el('stop', { offset: '100%', 'stop-color': c2 }),
  ]);
}

function niceStep(span) {
  const raw = span / 5;
  for (const s of [100, 200, 250, 500, 1000, 2000]) if (raw <= s) return s;
  return 2000;
}
