// ── Modules ──────────────────────────────────
const http = require('http');
const fs = require('fs');
const path = require('path');

// ── Config (.env 로더 — 의존성 없이 직접 파싱) ──
function loadEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnv();

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
const OPENAI_MODEL = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();

// ── In-memory store: 세션별 대화 기록 ──────────
const sessions = new Map(); // sessionId -> [{ role, content }]
const MAX_TURNS = 20;       // 최근 20턴만 유지 (토큰 절약)

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
  });
  res.end(buf);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// 프로필(성격·말투·전문분야) → 시스템 프롬프트
function buildSystemPrompt(p = {}) {
  const name = p.name || '프로토';
  const role = p.role || '자동차 주변기기 제품개발 AI';
  const tone = p.tone || '직설적이고 담백하게, 결론부터';
  const field = p.field || '차량용 액세서리 기획·설계·양산';
  const extra = (p.extra || '').trim();

  return [
    `너는 "${name}", ${role}이다.`,
    `[전문분야] ${field}`,
    `[말투] ${tone}. 답변은 한국어로 한다.`,
    '[행동 규칙]',
    '- 아이디어를 물으면 "이건 이래서 안 팔린다"는 반대 근거를 최소 1개 같이 말한다.',
    '- 제품 얘기가 나오면 원가·금형·차종 호환성·인증 중 관련 있는 항목을 짚는다.',
    '- 모르는 수치는 지어내지 말고 "확인 필요"라고 명시한다.',
    '- 답변은 6줄 이내로 짧게. 표가 더 명확하면 표를 쓴다.',
    extra ? `[추가 지침] ${extra}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// ── Static ───────────────────────────────────
function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.join(__dirname, rel);

  // 디렉터리 탈출 차단
  if (!filePath.startsWith(__dirname)) {
    return sendJson(res, 403, { success: false, message: 'Forbidden' });
  }
  // 비밀값 노출 차단
  if (/(^|[\\/])\.env/.test(rel)) {
    return sendJson(res, 403, { success: false, message: 'Forbidden' });
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback
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

// ── Routes ───────────────────────────────────
async function handleChat(req, res) {
  if (!OPENAI_API_KEY) {
    return sendJson(res, 500, {
      success: false,
      message: '.env 에 OPENAI_API_KEY 가 없습니다. .env.example 을 참고해 만들어 주세요.',
    });
  }

  const body = await readBody(req);
  const message = (body.message || '').trim();
  const sessionId = body.sessionId || 'default';
  const profile = body.profile || {};

  if (!message) {
    return sendJson(res, 400, { success: false, message: 'message is required' });
  }

  const history = sessions.get(sessionId) || [];
  history.push({ role: 'user', content: message });

  const messages = [
    { role: 'system', content: buildSystemPrompt(profile) },
    ...history.slice(-MAX_TURNS * 2),
  ];

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: OPENAI_MODEL, messages, temperature: 0.7 }),
  });

  if (!r.ok) {
    const detail = await r.text();
    console.error('OpenAI error:', r.status, detail.slice(0, 300));
    history.pop(); // 실패한 턴은 기록에서 제거
    sessions.set(sessionId, history);
    return sendJson(res, r.status, {
      success: false,
      message: r.status === 401 ? 'API 키가 유효하지 않습니다.' : `OpenAI 오류 (${r.status})`,
    });
  }

  const data = await r.json();
  const reply = data.choices?.[0]?.message?.content?.trim() || '(빈 응답)';

  history.push({ role: 'assistant', content: reply });
  sessions.set(sessionId, history);

  sendJson(res, 200, {
    success: true,
    data: { reply, model: OPENAI_MODEL, turns: Math.floor(history.length / 2) },
  });
}

function handleReset(req, res) {
  const id = new URL(req.url, 'http://x').searchParams.get('sessionId') || 'default';
  sessions.delete(id);
  sendJson(res, 200, { success: true, data: { sessionId: id } });
}

// ── Server ───────────────────────────────────
const handler = async (req, res) => {
  try {
    const pathname = req.url.split('?')[0];

    if (pathname === '/api/chat' && req.method === 'POST') return await handleChat(req, res);
    if (pathname === '/api/reset' && req.method === 'POST') return handleReset(req, res);
    if (pathname === '/api/health') {
      return sendJson(res, 200, {
        success: true,
        data: { ok: true, model: OPENAI_MODEL, hasKey: Boolean(OPENAI_API_KEY) },
      });
    }
    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { success: false, message: 'Unknown endpoint' });
    }
    return serveStatic(req, res);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { success: false, message: '서버 오류가 발생했습니다.' });
  }
};

if (require.main === module) {
  http.createServer(handler).listen(PORT, () => {
    console.log(`My ChatGPT running on http://localhost:${PORT}`);
    console.log(`model: ${OPENAI_MODEL} | key: ${OPENAI_API_KEY ? 'loaded' : 'MISSING'}`);
  });
}
module.exports = handler;
