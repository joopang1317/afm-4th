// ── Modules ──────────────────────────────────
const http = require('http');
const fs = require('fs');
const path = require('path');

// ── .env 로더 (의존성 없이 직접 파싱) ──────────
function loadEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnv();

const PORT = process.env.PORT || 3001;
const PROVIDER = (process.env.IMAGE_PROVIDER || 'openai').trim().toLowerCase();
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
const OPENAI_IMAGE_MODEL = (process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1').trim();
const FAL_KEY = (process.env.FAL_KEY || '').trim();
const FAL_MODEL = (process.env.FAL_MODEL || 'fal-ai/flux/dev').trim();
const FAL_STEPS = Number(process.env.FAL_STEPS || 28);
const FAL_I2I_MODEL = (process.env.FAL_I2I_MODEL || 'fal-ai/flux/dev/image-to-image').trim();
const FAL_STRENGTH = Number(process.env.FAL_STRENGTH || 0.65);

const OUT_DIR = path.join(__dirname, 'outputs');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ── 스타일 프리셋: 3D 렌더 · 도시적 · 차가움 ────
const STYLES = {
  studio_black: {
    label: '스튜디오 블랙',
    desc: '무광 검정 배경 · 림라이트 · 반사 바닥',
    suffix:
      'professional 3D product render, matte black seamless studio background, dramatic rim lighting, ' +
      'glossy reflective floor, sharp specular highlights, dark moody cold tone, ' +
      'octane render, ultra detailed, commercial product photography, centered composition',
  },
  concrete: {
    label: '콘크리트 브루탈',
    desc: '노출 콘크리트 · 하드 섀도우 · 회색',
    suffix:
      'professional 3D product render on raw concrete slab, brutalist minimal set, ' +
      'hard directional light casting sharp shadows, cold grey palette, industrial urban mood, ' +
      'octane render, ultra detailed, commercial product photography',
  },
  chrome_ice: {
    label: '크롬 & 아이스',
    desc: '메탈 크롬 · 시안 조명 · 냉각 유리',
    suffix:
      'professional 3D product render, polished chrome and frosted glass, ' +
      'cyan and steel blue cold lighting, icy reflections, futuristic tech aesthetic, ' +
      'dark background, octane render, ultra detailed, commercial product photography',
  },
  blueprint: {
    label: '블루프린트 렌더',
    desc: '다크 네이비 · 와이어프레임 · 설계 도면',
    suffix:
      'technical 3D product render, deep navy background with subtle grid, ' +
      'wireframe accent lines and exploded-view hints, CAD blueprint aesthetic, ' +
      'cool cyan highlights, engineering presentation style, ultra detailed',
  },
};

// ── In-memory: 생성 기록 ──────────────────────
const gallery = []; // { id, prompt, style, files:[], at }
let nextId = 1;

// ── Helpers ──────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
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
      if (raw.length > 3e7) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// 한글 프롬프트는 이미지 모델이 이해하지 못하므로 영문으로 옮긴다
const trCache = new Map();
async function toEnglish(text) {
  if (!text || !/[가-힣]/.test(text)) return text;
  if (trCache.has(text)) return trCache.get(text);
  if (!OPENAI_API_KEY) return text;
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        messages: [
          { role: 'system', content: 'Translate the Korean product description into a concise English image-generation prompt. Keep concrete visual nouns and materials. Output only the English phrase.' },
          { role: 'user', content: text },
        ],
      }),
    });
    if (!r.ok) return text;
    const j = await r.json();
    const out = j.choices?.[0]?.message?.content?.trim() || text;
    trCache.set(text, out);
    console.log(`  translated: "${text}" -> "${out}"`);
    return out;
  } catch {
    return text;
  }
}

function buildPrompt(subject, styleKey, custom) {
  const s = STYLES[styleKey];
  const suffix = styleKey === 'custom' ? (custom || '').trim() : (s ? s.suffix : '');
  return [subject.trim(), suffix].filter(Boolean).join(', ');
}

function saveB64(b64, ext = 'png') {
  const name = `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
  fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(b64, 'base64'));
  return `/outputs/${name}`;
}

// ── Providers ────────────────────────────────
async function genOpenAI(prompt, { size, n, quality }) {
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OPENAI_IMAGE_MODEL, prompt, size, n, quality }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw Object.assign(new Error(`OpenAI ${r.status}: ${t.slice(0, 200)}`), { status: r.status });
  }
  const data = await r.json();
  return data.data.map((d) => saveB64(d.b64_json));
}

async function editOpenAI(prompt, imageDataUrl, { size, n, quality }) {
  const m = imageDataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!m) throw new Error('참조 이미지 형식이 올바르지 않습니다.');
  const [, mime, b64] = m;
  const ext = (mime.split('/')[1] || 'png').replace('jpeg', 'jpg');

  const form = new FormData();
  form.append('model', OPENAI_IMAGE_MODEL);
  form.append('prompt', prompt);
  form.append('size', size);
  form.append('n', String(n));
  form.append('quality', quality);
  form.append('image', new Blob([Buffer.from(b64, 'base64')], { type: mime }), `ref.${ext}`);

  const r = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  if (!r.ok) {
    const t = await r.text();
    throw Object.assign(new Error(`OpenAI ${r.status}: ${t.slice(0, 200)}`), { status: r.status });
  }
  const data = await r.json();
  return data.data.map((d) => saveB64(d.b64_json));
}

async function saveFalImages(images) {
  const out = [];
  for (const img of images || []) {
    const bin = Buffer.from(await (await fetch(img.url)).arrayBuffer());
    const ext = (img.content_type || 'image/png').includes('jpeg') ? 'jpg' : 'png';
    const name = `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
    fs.writeFileSync(path.join(OUT_DIR, name), bin);
    out.push(`/outputs/${name}`);
  }
  return out;
}

async function editFal(prompt, imageDataUrl, { n, strength }) {
  const r = await fetch(`https://fal.run/${FAL_I2I_MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      image_url: imageDataUrl,
      strength: strength || FAL_STRENGTH,
      num_images: n,
      num_inference_steps: 28,
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw Object.assign(new Error(`fal.ai ${r.status}: ${t.slice(0, 200)}`), { status: r.status });
  }
  const data = await r.json();
  return saveFalImages(data.images);
}

async function genFal(prompt, { size, n }) {
  const map = { '1024x1024': 'square_hd', '1536x1024': 'landscape_4_3', '1024x1536': 'portrait_4_3' };
  const r = await fetch(`https://fal.run/${FAL_MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      image_size: map[size] || 'square_hd',
      num_images: n,
      num_inference_steps: FAL_STEPS,
      enable_safety_checker: false,
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw Object.assign(new Error(`fal.ai ${r.status}: ${t.slice(0, 200)}`), { status: r.status });
  }
  const data = await r.json();
  // fal은 URL을 주므로 받아서 로컬에 저장 (갤러리 일관성 유지)
  return saveFalImages(data.images);
}

// ── Routes ───────────────────────────────────
async function handleGenerate(req, res) {
  const body = await readBody(req);
  const subject = (body.subject || '').trim();
  const styleKey = body.style || 'studio_black';
  const custom = body.customStyle || '';
  const size = ['1024x1024', '1536x1024', '1024x1536'].includes(body.size) ? body.size : '1024x1024';
  const n = Math.min(Math.max(parseInt(body.n, 10) || 1, 1), 4);
  const quality = ['low', 'medium', 'high'].includes(body.quality) ? body.quality : 'medium';
  const refImage = typeof body.image === 'string' && body.image.startsWith('data:image/') ? body.image : null;
  const strength = Math.min(Math.max(Number(body.strength) || FAL_STRENGTH, 0.2), 0.9);

  if (!subject) return sendJson(res, 400, { success: false, message: '제품 설명을 입력해 주세요.' });

  const hasKey = PROVIDER === 'fal' ? Boolean(FAL_KEY) : Boolean(OPENAI_API_KEY);
  if (!hasKey) {
    return sendJson(res, 500, { success: false, message: `.env 에 ${PROVIDER} 키가 없습니다.` });
  }

  const subjectEn = await toEnglish(subject);
  const customEn = await toEnglish(custom);

  const prompt = refImage
    ? buildPrompt(
        'the exact same product with identical shape, proportions and details, ' +
        'only the background, lighting and finish are restyled' +
        (subjectEn ? ' — ' + subjectEn : ''),
        styleKey, customEn)
    : buildPrompt(subjectEn, styleKey, customEn);

  try {
    let files;
    if (refImage) {
      files = PROVIDER === 'fal'
        ? await editFal(prompt, refImage, { n, strength })
        : await editOpenAI(prompt, refImage, { size, n, quality });
    } else {
      files = PROVIDER === 'fal'
        ? await genFal(prompt, { size, n })
        : await genOpenAI(prompt, { size, n, quality });
    }

    const entry = { id: nextId++, subject, style: styleKey, prompt, files, mode: refImage ? 'edit' : 'create', strength: refImage ? strength : null, at: new Date().toISOString() };
    gallery.unshift(entry);
    sendJson(res, 200, { success: true, data: entry });
  } catch (err) {
    console.error(err.message);
    const locked = /TOP_UP|locked/i.test(err.message);
    sendJson(res, err.status || 500, {
      success: false,
      message: locked
        ? 'fal.ai 계정이 잠겨 있습니다(크레딧 충전 필요). .env 의 IMAGE_PROVIDER 를 openai 로 바꾸세요.'
        : err.message,
    });
  }
}

async function handleDelete(req, res) {
  const body = await readBody(req);
  const file = typeof body.file === 'string' ? body.file : '';
  const m = file.match(/^\/outputs\/([A-Za-z0-9._-]+)$/);
  if (!m) return sendJson(res, 400, { success: false, message: '잘못된 파일 경로입니다.' });

  const abs = path.join(OUT_DIR, m[1]);
  if (!abs.startsWith(OUT_DIR)) return sendJson(res, 403, { success: false, message: 'Forbidden' });
  try { if (fs.existsSync(abs)) fs.unlinkSync(abs); } catch (e) { console.error(e.message); }

  for (let i = gallery.length - 1; i >= 0; i--) {
    gallery[i].files = gallery[i].files.filter((f) => f !== file);
    if (!gallery[i].files.length) gallery.splice(i, 1);
  }
  sendJson(res, 200, { success: true, data: { deleted: file } });
}

async function handleClear(_req, res) {
  let count = 0;
  for (const entry of gallery) {
    for (const f of entry.files) {
      const abs = path.join(OUT_DIR, path.basename(f));
      try { if (fs.existsSync(abs)) { fs.unlinkSync(abs); count++; } } catch (e) { console.error(e.message); }
    }
  }
  gallery.length = 0;
  sendJson(res, 200, { success: true, data: { cleared: count } });
}

// ── Static ───────────────────────────────────
function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.join(__dirname, rel);

  if (!filePath.startsWith(__dirname)) return sendJson(res, 403, { success: false, message: 'Forbidden' });
  if (/(^|[\\/])\.env/.test(rel)) return sendJson(res, 403, { success: false, message: 'Forbidden' });

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

    if (pathname === '/api/generate' && req.method === 'POST') return await handleGenerate(req, res);
    if (pathname === '/api/delete' && req.method === 'POST') return await handleDelete(req, res);
    if (pathname === '/api/clear' && req.method === 'POST') return await handleClear(req, res);
    if (pathname === '/api/styles') return sendJson(res, 200, { success: true, data: STYLES });
    if (pathname === '/api/gallery') return sendJson(res, 200, { success: true, data: gallery });
    if (pathname === '/api/health') {
      return sendJson(res, 200, {
        success: true,
        data: {
          provider: PROVIDER,
          model: PROVIDER === 'fal' ? FAL_MODEL : OPENAI_IMAGE_MODEL,
          editModel: PROVIDER === 'fal' ? FAL_I2I_MODEL : OPENAI_IMAGE_MODEL,
          hasKey: PROVIDER === 'fal' ? Boolean(FAL_KEY) : Boolean(OPENAI_API_KEY),
        },
      });
    }
    if (pathname.startsWith('/api/')) return sendJson(res, 404, { success: false, message: 'Unknown endpoint' });

    return serveStatic(req, res);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { success: false, message: '서버 오류가 발생했습니다.' });
  }
};

if (require.main === module) {
  http.createServer(handler).listen(PORT, () => {
    console.log(`My Midjourney running on http://localhost:${PORT}`);
    console.log(`provider: ${PROVIDER} | model: ${PROVIDER === 'fal' ? FAL_MODEL : OPENAI_IMAGE_MODEL}`);
  });
}
module.exports = handler;
