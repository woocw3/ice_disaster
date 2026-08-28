#!/usr/bin/env node
/**
 * 페루 빙하 모니터 — 수집기 겸 정적 서버 (Synology NAS 상시 구동용)
 *
 * 브라우저만 쓰면 API가 주는 최근 며칠 창(window)밖에 못 봅니다.
 * 이 프로세스를 NAS에 띄워 두면
 *   · 주기적으로 Open-Meteo/USGS 를 수집해 JSONL 로 이력을 쌓고
 *   · 대시보드가 /api/latest 를 통해 즉시(재호출 없이) 로드되며
 *   · 위험도가 임계값을 넘으면 웹훅으로 알립니다.
 *
 * 의존성 없음 — Node 20+ 의 내장 fetch/http 만 사용합니다.
 * 위험도 판정은 프론트엔드와 동일한 assets/js/risk.js 를 그대로 임포트합니다.
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITES } from '../assets/js/sites.js';
import { computeRisk } from '../assets/js/risk.js';
import { makeDemoBundle } from '../assets/js/demo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const CONF = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(ROOT, 'data')),
  pollMinutes: Number(process.env.POLL_MINUTES ?? 30),
  retentionDays: Number(process.env.RETENTION_DAYS ?? 730),
  alertWebhook: process.env.ALERT_WEBHOOK ?? '',
  alertThreshold: Number(process.env.ALERT_THRESHOLD ?? 50),
  // DEMO=1 이면 외부 API 대신 합성 데이터를 씁니다. 배포 직후 파이프라인
  // (수집 → 이력 적재 → API 제공 → 알림)이 도는지 확인할 때만 쓰세요.
  demo: process.env.DEMO === '1',
};

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
const USGS = 'https://earthquake.usgs.gov/fdsnws/event/1/query';
const HOURLY = 'temperature_2m,freezing_level_height,precipitation,rain,snowfall';
const DAILY = 'temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,rain_sum,snowfall_sum';

const log = (...a) => console.log(new Date().toISOString(), ...a);

/* ------------------------------------------------------------------ 수집 */
async function getJSON(url, timeout = 30000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.slice(0, 80)}`);
  return res.json();
}

async function fetchSite(site) {
  const p = new URLSearchParams({
    latitude: site.lat.toFixed(4), longitude: site.lon.toFixed(4),
    elevation: String(site.glacierElev),
    hourly: HOURLY, daily: DAILY,
    timezone: 'America/Lima', past_days: '14', forecast_days: '7',
  });
  return getJSON(`${OPEN_METEO}?${p}`);
}

async function fetchQuakes() {
  const start = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
  const p = new URLSearchParams({
    format: 'geojson', starttime: start, minmagnitude: '4',
    minlatitude: '-19', maxlatitude: '-2', minlongitude: '-82', maxlongitude: '-67',
    orderby: 'time', limit: '500',
  });
  const gj = await getJSON(`${USGS}?${p}`);
  return (gj.features ?? []).map((f) => ({
    id: f.id, mag: f.properties.mag, place: f.properties.place, time: f.properties.time,
    depthKm: f.geometry.coordinates[2], lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
  })).filter((q) => Number.isFinite(q.mag));
}

/** 지점 간 간격을 둬 공개 API 에 부담을 주지 않는다. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function collect() {
  if (CONF.demo) return collectDemo();
  log('수집 시작…');
  const sites = {};
  const failures = [];

  let quakes = [];
  try { quakes = await fetchQuakes(); }
  catch (e) { failures.push({ site: 'quakes', message: e.message }); }

  for (const s of SITES) {
    try {
      sites[s.id] = await fetchSite(s);
    } catch (e) {
      failures.push({ site: s.id, message: e.message });
      log(`  ! ${s.id}: ${e.message}`);
    }
    await sleep(400);
  }

  if (Object.keys(sites).length === 0) {
    log('전 지점 수집 실패 — 기존 latest.json 을 유지합니다.');
    return null;
  }

  const bundle = { fetchedAt: Date.now(), sites, quakes, failures };
  await fs.mkdir(CONF.dataDir, { recursive: true });
  await writeAtomic(path.join(CONF.dataDir, 'latest.json'), JSON.stringify(bundle));

  const snapshots = await appendHistory(bundle);
  log(`수집 완료 — ${Object.keys(sites).length}/${SITES.length} 지점, 지진 ${quakes.length}건, 실패 ${failures.length}건`);
  await maybeAlert(snapshots);
  return bundle;
}

async function collectDemo() {
  log('DEMO 모드 — 합성 데이터로 파이프라인만 검증합니다. 실제 관측값이 아닙니다.');
  const { wx, quakes } = makeDemoBundle();
  const bundle = { fetchedAt: Date.now(), sites: wx, quakes, failures: [], demo: true };
  await fs.mkdir(CONF.dataDir, { recursive: true });
  await writeAtomic(path.join(CONF.dataDir, 'latest.json'), JSON.stringify(bundle));
  const snapshots = await appendHistory(bundle);
  log(`DEMO 수집 완료 — ${Object.keys(wx).length}개 지점 이력 적재`);
  await maybeAlert(snapshots);
  return bundle;
}

/** 부분 기록으로 파일이 깨지지 않도록 임시 파일에 쓰고 rename */
async function writeAtomic(file, text) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, file);
}

async function appendHistory(bundle) {
  const dir = path.join(CONF.dataDir, 'history');
  await fs.mkdir(dir, { recursive: true });
  const out = [];
  for (const site of SITES) {
    const wx = bundle.sites[site.id];
    if (!wx) continue;
    const r = computeRisk(site, wx, bundle.quakes, bundle.fetchedAt);
    if (!r) continue;
    const point = {
      t: bundle.fetchedAt,
      score: r.score,
      melt: r.meltScore,
      pdd7: round(r.metrics.pdd7, 2),
      flAnom: round(r.metrics.flAnom, 0),
      flMean3: round(r.metrics.flMean3, 0),
      rain3: round(r.metrics.rainSum3, 1),
      rainFc3: round(r.metrics.rainFcSum3, 1),
      warmSpike: round(r.metrics.warmSpike, 2),
      seismic: round(r.metrics.seismic.index, 3),
    };
    await fs.appendFile(path.join(dir, `${site.id}.jsonl`), `${JSON.stringify(point)}\n`, 'utf8');
    out.push({ site, point, level: r.level });
  }
  return out;
}

const round = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);

/* ------------------------------------------------------------------ 알림 */
const lastAlert = new Map();
const ALERT_COOLDOWN = 6 * 3600e3;

async function maybeAlert(snapshots) {
  if (!CONF.alertWebhook) return;
  const now = Date.now();
  const hot = snapshots.filter(({ site, point }) =>
    site.type === 'lake' && point.score >= CONF.alertThreshold &&
    now - (lastAlert.get(site.id) ?? 0) > ALERT_COOLDOWN);
  if (!hot.length) return;

  const lines = hot.map(({ site, point, level }) =>
    `• ${site.name} — ${point.score}/100 (${level.label}) · 융해도일 ${point.pdd7} · 동결고도 말단 ${point.flAnom >= 0 ? '+' : ''}${point.flAnom} m · 강우 ${point.rain3}+${point.rainFc3} mm`);
  const text = [
    `🏔️ 페루 빙하호 위험도 ${CONF.alertThreshold} 이상 (${hot.length}개 지점)`,
    ...lines,
    '',
    '※ 공개 데이터 기반 스크리닝 지표이며 페루 당국의 공식 조기경보를 대체하지 않습니다.',
  ].join('\n');

  try {
    await fetch(CONF.alertWebhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Slack/Discord/ntfy 등 대부분이 text 또는 content 필드를 받는다
      body: JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(15000),
    });
    for (const { site } of hot) lastAlert.set(site.id, now);
    log(`알림 전송 — ${hot.length}개 지점`);
  } catch (e) {
    log(`알림 실패: ${e.message}`);
  }
}

/* ------------------------------------------------------------------ 이력 조회 */
async function readHistory(siteId, days) {
  const file = path.join(CONF.dataDir, 'history', `${siteId}.jsonl`);
  let text;
  try { text = await fs.readFile(file, 'utf8'); }
  catch { return { site: siteId, points: [] }; }
  const cutoff = Date.now() - days * 86400e3;
  const points = text.split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter((p) => p && p.t >= cutoff);
  return { site: siteId, days, points };
}

/* ------------------------------------------------------------------ 정적 서빙 */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png',
  '.md': 'text/markdown; charset=utf-8',
};

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const full = path.resolve(ROOT, rel);
  // 경로 탈출 차단
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return send(res, 403, 'Forbidden');
  try {
    const st = await fs.stat(full);
    if (st.isDirectory()) return serveStatic(req, res, path.posix.join(pathname, 'index.html'));
    res.writeHead(200, {
      'content-type': MIME[path.extname(full).toLowerCase()] ?? 'application/octet-stream',
      'content-length': st.size,
      'cache-control': 'no-cache',
    });
    fsSync.createReadStream(full).pipe(res);
  } catch { send(res, 404, 'Not Found'); }
}

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'content-type': type });
  res.end(body);
}
const sendJSON = (res, code, obj) => send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8');

/* ------------------------------------------------------------------ 서버 */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  try {
    if (url.pathname === '/api/latest') {
      const file = path.join(CONF.dataDir, 'latest.json');
      try {
        const text = await fs.readFile(file, 'utf8');
        return send(res, 200, text, 'application/json; charset=utf-8');
      } catch {
        return sendJSON(res, 503, { error: '아직 수집된 데이터가 없습니다. 첫 수집이 끝날 때까지 기다려 주세요.' });
      }
    }
    if (url.pathname === '/api/history') {
      const site = url.searchParams.get('site') ?? '';
      if (!SITES.some((s) => s.id === site)) return sendJSON(res, 400, { error: '알 수 없는 지점 id' });
      const days = Math.min(3650, Math.max(1, Number(url.searchParams.get('days') ?? 30)));
      return sendJSON(res, 200, await readHistory(site, days));
    }
    if (url.pathname === '/api/health') {
      let last = null;
      try { last = JSON.parse(await fs.readFile(path.join(CONF.dataDir, 'latest.json'), 'utf8')).fetchedAt; } catch { /* 아직 없음 */ }
      return sendJSON(res, 200, {
        ok: true, sites: SITES.length, lastCollectedAt: last,
        ageMinutes: last ? Math.round((Date.now() - last) / 60000) : null,
        pollMinutes: CONF.pollMinutes,
      });
    }
    if (url.pathname === '/api/collect' && req.method === 'POST') {
      collect().catch((e) => log('수동 수집 실패:', e.message));
      return sendJSON(res, 202, { started: true });
    }
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    log('요청 처리 오류:', e.message);
    sendJSON(res, 500, { error: e.message });
  }
});

server.listen(CONF.port, CONF.host, () => {
  log(`페루 빙하 모니터 수집기 · http://${CONF.host}:${CONF.port}`);
  log(`데이터 경로 ${CONF.dataDir} · 수집 주기 ${CONF.pollMinutes}분` +
      (CONF.alertWebhook ? ` · 알림 임계값 ${CONF.alertThreshold}` : ' · 알림 없음') +
      (CONF.demo ? ' · ⚠ DEMO 모드' : ''));
});

collect().catch((e) => log('초기 수집 실패:', e.message));
setInterval(() => collect().catch((e) => log('정기 수집 실패:', e.message)), CONF.pollMinutes * 60e3);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { log(`${sig} — 종료합니다.`); server.close(() => process.exit(0)); });
}
