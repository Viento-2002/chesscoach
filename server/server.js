'use strict';
// ChessCoach API: a small public cache of chess.com games and engine analysis, one JSON file per
// username. No accounts and no passwords: everything stored here is already public on chess.com
// (or is analysis of those public games). No dependencies besides the vendored chess.js.
//
//   GET    /api/profile/:name?months=2&since=<seq>   sync from chess.com if stale, return what is new
//   POST   /api/analysis/:name                       store engine analysis for one stored game
//   DELETE /api/profile/:name                        remove a cached profile
//   GET    /api/health
//
// Env: PORT (3011), HOST (127.0.0.1), DATA_DIR (./data), STATIC_DIR (serve the site too; for local testing)
const http = require('http'), fs = require('fs'), path = require('path');
const { Chess } = require('./chess.js');

const PORT = +process.env.PORT || 3011, HOST = process.env.HOST || '127.0.0.1';
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data'), STATIC = process.env.STATIC_DIR || '';
const UA = 'ChessCoach/1.0 (+https://chess.vrhconsultancy.nl)';
const MAX_GAMES = 1500;        // per user, newest kept
const MAX_USERS = 2000;        // bounds disk use
const SYNC_EVERY = 2 * 60e3;   // never ask chess.com about the same user more than every 2 minutes
const MAX_MONTHS = 12;
const MAX_BODY = 200 * 1024;
const NAME_RE = /^[a-z0-9_-]{2,40}$/;

fs.mkdirSync(path.join(DATA, 'users'), { recursive: true });
const userFile = n => path.join(DATA, 'users', n + '.json');
const countUsers = () => fs.readdirSync(path.join(DATA, 'users')).filter(f => f.endsWith('.json')).length;
let userCount = countUsers();

/* ---------- storage (in-memory LRU in front of one file per user) ---------- */
const cache = new Map();
function load(name) {
  if (cache.has(name)) { const d = cache.get(name); cache.delete(name); cache.set(name, d); return d; }
  let d;
  try { d = JSON.parse(fs.readFileSync(userFile(name), 'utf8')); }
  catch (e) { d = { name, synced: [], games: {}, an: {}, seq: 0, lastSync: 0 }; }
  cache.set(name, d);
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  return d;
}
function persist(d) {
  const f = userFile(d.name), existed = fs.existsSync(f);
  fs.writeFileSync(f + '.tmp', JSON.stringify(d));
  fs.renameSync(f + '.tmp', f);                      // atomic: a crash never leaves half a file
  if (!existed) userCount++;
}

/* ---------- chess.com ---------- */
async function cj(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
  if (r.status === 404) { const e = new Error('chess.com user not found'); e.code = 404; throw e; }
  if (!r.ok) throw new Error('chess.com answered HTTP ' + r.status);
  const t = await r.text();
  try { return JSON.parse(t); } catch (e) { throw new Error('chess.com sent a non-JSON answer'); }
}
const slim = r => ({
  url: r.url, pgn: r.pgn, time_class: r.time_class, end_time: r.end_time, rules: r.rules,
  white: { username: r.white.username, rating: r.white.rating, result: r.white.result },
  black: { username: r.black.username, rating: r.black.rating, result: r.black.result }
});
const syncing = new Map();
function sync(name, months) {
  if (!syncing.has(name)) syncing.set(name, doSync(name, months).finally(() => syncing.delete(name)));
  return syncing.get(name);
}
async function doSync(name, months) {
  const d = load(name);
  if (Date.now() - d.lastSync < SYNC_EVERY && d.months >= months) return;
  const all = (await cj(`https://api.chess.com/pub/player/${encodeURIComponent(name)}/games/archives`)).archives || [];
  const latest = all[all.length - 1];
  let failed = 0;
  for (const url of all.slice(-months).reverse()) {
    if (d.synced.includes(url) && url !== latest) continue; // a finished month never changes
    let data; try { data = await cj(url); } catch (e) { failed++; continue; }
    for (const raw of data.games || []) {
      if (raw.rules !== 'chess' || !raw.pgn || !raw.url || !raw.white || !raw.black || d.games[raw.url]) continue;
      d.games[raw.url] = { ...slim(raw), seq: ++d.seq };
    }
    if (url !== latest && !d.synced.includes(url)) d.synced.push(url);
  }
  const urls = Object.keys(d.games);
  if (urls.length > MAX_GAMES) {                      // keep the newest; forget analysis of the rest
    urls.sort((a, b) => d.games[b].end_time - d.games[a].end_time);
    for (const u of urls.slice(MAX_GAMES)) { delete d.games[u]; delete d.an[u]; }
  }
  d.lastSync = Date.now(); d.months = failed ? 0 : months;
  if (Object.keys(d.games).length) persist(d);
}

/* ---------- analysis validation ---------- */
const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
function validAnalysis(game, p) {
  if (!Array.isArray(p)) return 'p must be an array';
  const c = new Chess();
  if (!c.load_pgn(game.pgn)) return 'game unreadable';
  const moves = c.history();
  const r = new Chess(), fens = [r.fen()];
  for (const m of moves) { r.move(m); fens.push(r.fen()); }
  if (p.length !== fens.length) return 'wrong number of positions';
  for (let k = 0; k < p.length; k++) {
    const e = p[k];
    if (!e || typeof e !== 'object') return 'bad entry';
    const okCp = Number.isInteger(e.c) && Math.abs(e.c) <= 10000 && e.m == null;
    const okMate = e.c == null && Number.isInteger(e.m) && Math.abs(e.m) <= 300;
    if (!okCp && !okMate) return 'bad evaluation';
    if (e.b != null) {
      if (typeof e.b !== 'string' || !UCI_RE.test(e.b)) return 'bad move';
      if (!new Chess(fens[k]).move({ from: e.b.slice(0, 2), to: e.b.slice(2, 4), promotion: e.b[4] })) return 'illegal best move';
    }
  }
  return null;
}

/* ---------- rate limiting (per client address) ---------- */
const buckets = new Map();
function limited(ip, key, max, windowMs) {
  const k = ip + '|' + key, now = Date.now();
  const b = (buckets.get(k) || []).filter(t => now - t < windowMs);
  if (b.length >= max) { buckets.set(k, b); return true; }
  b.push(now); buckets.set(k, b); return false;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (!v.length || now - v[v.length - 1] > 3600e3) buckets.delete(k); }, 600e3).unref();

/* ---------- http ---------- */
const send = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
};
const readBody = req => new Promise((resolve, reject) => {
  let n = 0; const chunks = [];
  req.on('data', c => { n += c.length; if (n > MAX_BODY) { reject(Object.assign(new Error('too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});
const clientIp = req => {
  const ra = req.socket.remoteAddress || '';
  const xf = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1') && xf ? xf : ra;
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json' };
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname); if (rel.endsWith('/')) rel += 'index.html';
  const f = path.join(STATIC, path.normalize(rel));
  if (!f.startsWith(path.resolve(STATIC)) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x'), ip = clientIp(req);
  const m = url.pathname.match(/^\/api\/(profile|analysis)\/([^/]+)$/);
  if (url.pathname === '/api/health') return send(res, 200, { ok: true, users: userCount });
  if (!m) {
    if (STATIC && !url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
    return send(res, 404, { error: 'not found' });
  }
  let name; try { name = decodeURIComponent(m[2]).trim().toLowerCase(); } catch (e) { return send(res, 400, { error: 'bad name' }); }
  if (!NAME_RE.test(name)) return send(res, 400, { error: 'invalid chess.com username' });

  if (m[1] === 'profile' && req.method === 'GET') {
    if (limited(ip, 'profile', 40, 60e3)) return send(res, 429, { error: 'too many requests, try again in a minute' });
    const months = Math.max(1, Math.min(MAX_MONTHS, parseInt(url.searchParams.get('months')) || 2));
    const since = Math.max(0, parseInt(url.searchParams.get('since')) || 0);
    const known = fs.existsSync(userFile(name));
    if (!known) {
      if (userCount >= MAX_USERS) return send(res, 503, { error: 'the server cache is full' });
      if (limited(ip, 'newuser', 8, 10 * 60e3)) return send(res, 429, { error: 'too many new users from your address, try later' });
    }
    const d = load(name); let warn = null;
    try { await sync(name, months); }
    catch (e) {
      if (!Object.keys(d.games).length) { cache.delete(name); return send(res, e.code === 404 ? 404 : 502, { error: e.message }); }
      warn = e.message;
    }
    const games = [], analyses = {}, anIndex = {};
    for (const [u, g] of Object.entries(d.games)) if (g.seq > since) { const { seq, ...rest } = g; games.push(rest); }
    for (const [u, a] of Object.entries(d.an)) { anIndex[u] = a.depth; if (a.seq > since) analyses[u] = { depth: a.depth, p: a.p }; }
    return send(res, 200, { name, seq: d.seq, total: Object.keys(d.games).length, games, analyses, anIndex, warn });
  }

  if (m[1] === 'analysis' && req.method === 'POST') {
    if (limited(ip, 'analysis', 300, 60e3)) return send(res, 429, { error: 'too many requests' });
    if (!fs.existsSync(userFile(name))) return send(res, 404, { error: 'unknown profile' });
    let body; try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, e.code === 413 ? 413 : 400, { error: 'bad body' }); }
    const d = load(name), g = d.games[body && body.url];
    if (!g) return send(res, 404, { error: 'game not stored for this user' });
    const depth = body.depth;
    if (!Number.isInteger(depth) || depth < 8 || depth > 30) return send(res, 400, { error: 'bad depth' });
    if (d.an[g.url] && d.an[g.url].depth >= depth) return send(res, 200, { accepted: false, reason: 'already have equal or deeper analysis' });
    const bad = validAnalysis(g, body.p);
    if (bad) return send(res, 400, { error: 'rejected: ' + bad });
    d.an[g.url] = { depth, p: body.p.map(e => ({ c: e.c == null ? null : e.c, m: e.m == null ? null : e.m, b: e.b || null })), seq: ++d.seq };
    persist(d);
    return send(res, 200, { accepted: true });
  }

  if (m[1] === 'profile' && req.method === 'DELETE') {
    if (limited(ip, 'delete', 10, 3600e3)) return send(res, 429, { error: 'too many requests' });
    cache.delete(name);
    try { fs.unlinkSync(userFile(name)); userCount = Math.max(0, userCount - 1); } catch (e) { /* nothing stored */ }
    return send(res, 200, { deleted: true });
  }
  return send(res, 405, { error: 'method not allowed' });
}

http.createServer((req, res) => {
  handle(req, res).catch(e => { console.error(new Date().toISOString(), req.method, req.url, e); if (!res.headersSent) send(res, 500, { error: 'server error' }); else res.end(); });
}).listen(PORT, HOST, () => console.log(`ChessCoach API on http://${HOST}:${PORT} (data: ${DATA}, users: ${userCount})`));
