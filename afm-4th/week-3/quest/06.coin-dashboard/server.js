// ── Modules ──────────────────────────────────
const http = require('http');
const fs = require('fs');
const path = require('path');

// ── Config ───────────────────────────────────
const PORT = process.env.PORT || 3002;
const CG = 'https://api.coingecko.com/api/v3';

// CoinGecko 무료 티어는 분당 호출 제한이 있어 짧게 캐싱한다
const CACHE_MS = 20 * 1000;
const cache = new Map(); // key -> { at, data }

// ── Helpers ──────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}

async function cachedFetch(key, url) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return { data: hit.data, cached: true };

  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) {
    // 레이트리밋이면 만료된 캐시라도 돌려준다
    if (hit) return { data: hit.data, cached: true, stale: true };
    throw Object.assign(new Error(`CoinGecko ${r.status}`), { status: r.status });
  }
  const data = await r.json();
  cache.set(key, { at: Date.now(), data });
  return { data, cached: false };
}

// ── Routes ───────────────────────────────────
// 시세: /api/prices?ids=bitcoin,ethereum&vs=krw
async function handlePrices(req, res) {
  const q = new URL(req.url, 'http://x').searchParams;
  const ids = (q.get('ids') || 'bitcoin,ethereum,ripple,solana')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z0-9-]{1,60}$/.test(s))
    .slice(0, 30);
  const vs = /^[a-z]{3,5}$/.test(q.get('vs') || '') ? q.get('vs') : 'krw';

  if (!ids.length) return sendJson(res, 400, { success: false, message: 'ids가 비어 있습니다.' });

  const url =
    `${CG}/simple/price?ids=${ids.join(',')}&vs_currencies=${vs}` +
    '&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true&include_last_updated_at=true';

  const { data, cached, stale } = await cachedFetch(`p:${vs}:${ids.join(',')}`, url);
  sendJson(res, 200, { success: true, data, meta: { vs, cached: Boolean(cached), stale: Boolean(stale), at: Date.now() } });
}

// 코인 메타(이름·심볼·아이콘): /api/coins?ids=...
async function handleCoins(req, res) {
  const q = new URL(req.url, 'http://x').searchParams;
  const ids = (q.get('ids') || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z0-9-]{1,60}$/.test(s))
    .slice(0, 30);
  if (!ids.length) return sendJson(res, 400, { success: false, message: 'ids가 비어 있습니다.' });

  const url = `${CG}/coins/markets?vs_currency=krw&ids=${ids.join(',')}&sparkline=false`;
  const { data } = await cachedFetch(`m:${ids.join(',')}`, url);
  const slim = (data || []).map((c) => ({
    id: c.id, symbol: c.symbol, name: c.name, image: c.image, rank: c.market_cap_rank,
  }));
  sendJson(res, 200, { success: true, data: slim });
}

// 검색: /api/search?q=doge
async function handleSearch(req, res) {
  const q = new URL(req.url, 'http://x').searchParams.get('q') || '';
  const term = q.trim().slice(0, 40);
  if (!term) return sendJson(res, 400, { success: false, message: '검색어를 입력해 주세요.' });

  const { data } = await cachedFetch(`s:${term.toLowerCase()}`, `${CG}/search?query=${encodeURIComponent(term)}`);
  const coins = (data.coins || []).slice(0, 10).map((c) => ({
    id: c.id, symbol: c.symbol, name: c.name, image: c.thumb, rank: c.market_cap_rank,
  }));
  sendJson(res, 200, { success: true, data: coins });
}

// ── Static ───────────────────────────────────
function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.join(__dirname, rel);

  if (!filePath.startsWith(__dirname)) return sendJson(res, 403, { success: false, message: 'Forbidden' });

  fs.readFile(filePath, (err, data) => {
    if (err) {
      return fs.readFile(path.join(__dirname, 'index.html'), (e2, html) => {
        if (e2) return sendJson(res, 404, { success: false, message: 'Not found' });
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(html);
      });
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ── Server ───────────────────────────────────
const handler = async (req, res) => {
  try {
    const pathname = req.url.split('?')[0];

    if (pathname === '/api/prices') return await handlePrices(req, res);
    if (pathname === '/api/coins') return await handleCoins(req, res);
    if (pathname === '/api/search') return await handleSearch(req, res);
    if (pathname === '/api/health') return sendJson(res, 200, { success: true, data: { ok: true, source: 'coingecko' } });
    if (pathname.startsWith('/api/')) return sendJson(res, 404, { success: false, message: 'Unknown endpoint' });

    return serveStatic(req, res);
  } catch (err) {
    console.error(err.message);
    const rate = err.status === 429;
    sendJson(res, err.status || 500, {
      success: false,
      message: rate ? 'CoinGecko 호출 제한에 걸렸습니다. 잠시 후 다시 시도하세요.' : '시세를 가져오지 못했습니다.',
    });
  }
};

if (require.main === module) {
  http.createServer(handler).listen(PORT, () => {
    console.log(`Coin Dashboard running on http://localhost:${PORT}`);
  });
}
module.exports = handler;
