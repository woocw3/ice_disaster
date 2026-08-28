/** 의존성 없는 SVG 차트 유틸 — 라이브러리를 쓰지 않아 오프라인·CSP 환경에서도 그린다. */

const NS = 'http://www.w3.org/2000/svg';
export const el = (name, attrs = {}, children = []) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v));
  for (const c of [].concat(children)) if (c != null) n.append(c);
  return n;
};

const extent = (a) => {
  const v = a.filter(Number.isFinite);
  return v.length ? [Math.min(...v), Math.max(...v)] : [0, 1];
};

/** 리스트 행에 들어가는 소형 스파크라인 */
export function sparkline(values, { w = 120, h = 28, color = '#7dd3fc', zero = null } = {}) {
  const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: 'spark', 'aria-hidden': 'true' });
  const vals = values.filter(Number.isFinite);
  if (vals.length < 2) return svg;
  let [lo, hi] = extent(values);
  if (zero != null) { lo = Math.min(lo, zero); hi = Math.max(hi, zero); }
  if (hi - lo < 1e-6) hi = lo + 1;
  const x = (i) => (i / (values.length - 1)) * w;
  const y = (v) => h - ((v - lo) / (hi - lo)) * (h - 2) - 1;

  const d = values.map((v, i) => (Number.isFinite(v) ? `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}` : '')).join(' ');
  if (zero != null && zero >= lo && zero <= hi) {
    svg.append(el('line', { x1: 0, x2: w, y1: y(zero), y2: y(zero), class: 'spark-zero' }));
  }
  svg.append(el('path', { d, fill: 'none', stroke: color, 'stroke-width': 1.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  return svg;
}

/**
 * 시간축 선형 차트. series: [{values, color, label, dashed}]
 * bands: [{from,to,color}] — 예보 구간 음영 등
 */
export function lineChart(times, series, {
  w = 640, h = 200, pad = { t: 24, r: 12, b: 26, l: 44 },
  yLabel = '', refLines = [], bands = [], fill = false,
} = {}) {
  const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img' });
  // 기준선 라벨은 플롯 바깥 오른쪽 여백에 두어 데이터와 겹치지 않게 한다.
  const padR = refLines.length ? Math.max(pad.r, 56) : pad.r;
  const iw = w - pad.l - padR, ih = h - pad.t - pad.b;
  const all = series.flatMap((s) => s.values).concat(refLines.map((r) => r.value));
  let [lo, hi] = extent(all);
  const span = hi - lo || 1;
  lo -= span * 0.12; hi += span * 0.12;
  const x = (i) => pad.l + (i / Math.max(1, times.length - 1)) * iw;
  const y = (v) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;

  for (const b of bands) {
    svg.append(el('rect', { x: x(b.from), y: pad.t, width: Math.max(0, x(b.to) - x(b.from)), height: ih, fill: b.color ?? 'rgba(148,163,184,.09)' }));
  }

  // y축 눈금 4개
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    svg.append(el('line', { x1: pad.l, x2: w - padR, y1: y(v), y2: y(v), class: 'grid' }));
    svg.append(el('text', { x: pad.l - 6, y: y(v) + 3.5, class: 'axis', 'text-anchor': 'end' }, [String(Math.round(v))]));
  }
  for (const r of refLines) {
    svg.append(el('line', { x1: pad.l, x2: w - padR, y1: y(r.value), y2: y(r.value), class: 'refline', stroke: r.color ?? '#f472b6' }));
    svg.append(el('text', {
      x: w - padR + 4, y: y(r.value) + 3, class: 'axis reflabel',
      'text-anchor': 'start', fill: r.color ?? '#f472b6',
    }, [r.label ?? '']));
  }

  for (const s of series) {
    const d = s.values.map((v, i) => (Number.isFinite(v) ? `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}` : '')).join(' ');
    if (fill && s.fill !== false) {
      svg.append(el('path', {
        d: `${d} L${x(s.values.length - 1)} ${y(lo)} L${x(0)} ${y(lo)} Z`,
        fill: s.color, opacity: 0.10, stroke: 'none',
      }));
    }
    svg.append(el('path', {
      d, fill: 'none', stroke: s.color, 'stroke-width': s.width ?? 1.8,
      'stroke-dasharray': s.dashed ? '4 3' : null, 'stroke-linejoin': 'round',
    }));
  }

  // x축 라벨 (양끝 + 중앙)
  const ticks = [0, Math.floor(times.length / 2), times.length - 1];
  for (const i of ticks) {
    if (!times[i]) continue;
    svg.append(el('text', {
      x: Math.min(w - padR, Math.max(pad.l, x(i))), y: h - 8, class: 'axis',
      'text-anchor': i === 0 ? 'start' : i === times.length - 1 ? 'end' : 'middle',
    }, [fmtTick(times[i])]));
  }
  if (yLabel) svg.append(el('text', { x: 2, y: 10, class: 'axis ylabel' }, [yLabel]));
  return svg;
}

function fmtTick(t) {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 일별 강수 막대 (비/눈 구분) */
export function barChart(labels, groups, { w = 640, h = 170, pad = { t: 24, r: 12, b: 26, l: 44 }, yLabel = '' } = {}) {
  const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img' });
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const totals = labels.map((_, i) => groups.reduce((s, g) => s + (g.values[i] || 0), 0));
  const hi = Math.max(1, ...totals) * 1.15;
  const bw = (iw / labels.length) * 0.66;
  const y = (v) => pad.t + ih - (v / hi) * ih;

  for (let i = 0; i <= 3; i++) {
    const v = (hi * i) / 3;
    svg.append(el('line', { x1: pad.l, x2: w - pad.r, y1: y(v), y2: y(v), class: 'grid' }));
    svg.append(el('text', { x: pad.l - 6, y: y(v) + 3.5, class: 'axis', 'text-anchor': 'end' }, [v.toFixed(0)]));
  }
  labels.forEach((lab, i) => {
    const cx = pad.l + (i + 0.5) * (iw / labels.length);
    let acc = 0;
    for (const g of groups) {
      const v = g.values[i] || 0;
      if (v <= 0) { continue; }
      svg.append(el('rect', {
        x: cx - bw / 2, y: y(acc + v), width: bw, height: Math.max(0.5, y(acc) - y(acc + v)),
        fill: g.color, rx: 1.5,
      }, [el('title', {}, [`${lab} · ${g.label} ${v.toFixed(1)} mm`])]));
      acc += v;
    }
    if (i % Math.ceil(labels.length / 7) === 0) {
      svg.append(el('text', { x: cx, y: h - 8, class: 'axis', 'text-anchor': 'middle' }, [fmtTick(lab)]));
    }
  });
  if (yLabel) svg.append(el('text', { x: 2, y: 10, class: 'axis ylabel' }, [yLabel]));
  return svg;
}

/** 연도별 값 + 선형 추세선 */
export function trendChart(points, { w = 640, h = 190, pad = { t: 24, r: 12, b: 26, l: 44 }, color = '#f97316', yLabel = '' } = {}) {
  const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img' });
  if (points.length < 3) return svg;
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const ys = points.map((p) => p.mean);
  let [lo, hi] = extent(ys);
  const span = hi - lo || 1; lo -= span * 0.2; hi += span * 0.2;
  const x0 = points[0].year, x1 = points[points.length - 1].year;
  const X = (yr) => pad.l + ((yr - x0) / Math.max(1, x1 - x0)) * iw;
  const Y = (v) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;

  for (let i = 0; i <= 3; i++) {
    const v = lo + ((hi - lo) * i) / 3;
    svg.append(el('line', { x1: pad.l, x2: w - pad.r, y1: Y(v), y2: Y(v), class: 'grid' }));
    svg.append(el('text', { x: pad.l - 6, y: Y(v) + 3.5, class: 'axis', 'text-anchor': 'end' }, [v.toFixed(1)]));
  }
  svg.append(el('path', {
    d: points.map((p, i) => `${i ? 'L' : 'M'}${X(p.year).toFixed(1)} ${Y(p.mean).toFixed(1)}`).join(' '),
    fill: 'none', stroke: color, 'stroke-width': 1.6, opacity: 0.85,
  }));
  points.forEach((p) => svg.append(el('circle', { cx: X(p.year), cy: Y(p.mean), r: 2, fill: color, opacity: 0.7 },
    [el('title', {}, [`${p.year}년 · ${p.mean.toFixed(2)} °C`])])));

  const { slope, intercept } = linreg(points.map((p) => p.year), ys);
  svg.append(el('line', {
    x1: X(x0), y1: Y(intercept + slope * x0), x2: X(x1), y2: Y(intercept + slope * x1),
    stroke: '#f43f5e', 'stroke-width': 2, 'stroke-dasharray': '5 4',
  }));
  svg.append(el('text', { x: w - pad.r, y: 10, class: 'axis', 'text-anchor': 'end', fill: '#f43f5e' },
    [`추세 ${slope >= 0 ? '+' : ''}${(slope * 10).toFixed(2)} °C / 10년`]));

  [x0, x1].forEach((yr, i) => svg.append(el('text', {
    x: X(yr), y: h - 8, class: 'axis', 'text-anchor': i ? 'end' : 'start',
  }, [String(yr)])));
  if (yLabel) svg.append(el('text', { x: 2, y: 10, class: 'axis ylabel' }, [yLabel]));
  return svg;
}

export function linreg(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const slope = den === 0 ? 0 : num / den;
  return { slope, intercept: my - slope * mx };
}
