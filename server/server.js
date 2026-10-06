'use strict';
// ChessCoach API: a small public cache of chess.com games plus Stockfish analysis done on this server,
// one JSON file per username. No accounts and no passwords: everything stored here is already public on
// chess.com, or is engine analysis of those public games. Nobody can upload analysis: only this server's
// own Stockfish writes it. No dependencies besides the vendored chess.js and the bundled engine.
//
//   GET    /api/profile/:name?months=2&since=<seq>   sync from chess.com if stale; return what is new + analysis progress
//   DELETE /api/profile/:name                        remove a cached profile
//   GET    /api/health
//
// Env: PORT (3011), HOST (127.0.0.1), DATA_DIR (./data), STATIC_DIR (also serve the site; local testing),
//      ENGINE_DIR (folder with stockfish-18-lite-single.js + .wasm), DEPTH (16), ANALYSE_LATEST (100)
const http = require('http'), fs = require('fs'), path = require('path');
const { spawn } = require('child_process');
const { Chess } = require('./chess.js');

const PORT = +process.env.PORT || 3011, HOST = process.env.HOST || '127.0.0.1';
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data'), STATIC = process.env.STATIC_DIR || '';
const ENGINE_DIR = process.env.ENGINE_DIR || [path.join(__dirname, 'engine'), path.join(__dirname, '..', 'engine')].find(d => fs.existsSync(path.join(d, 'stockfish-18-lite-single.js'))) || path.join(__dirname, 'engine');
const DEPTH = +process.env.DEPTH || 16;
const ANALYSE_LATEST = +process.env.ANALYSE_LATEST || 100; // newest games per user analysed automatically
const QUEUE_MAX = 1500;                                     // total waiting jobs across all users
const UA = 'ChessCoach/1.0 (+https://chess.vrhconsultancy.nl)';
const MAX_GAMES = 1500, MAX_USERS = 2000, SYNC_EVERY = 2 * 60e3, MAX_MONTHS = 12;
const NAME_RE = /^[a-z0-9_-]{2,40}$/;

fs.mkdirSync(path.join(DATA, 'users'), { recursive: true });
const userFile = n => path.join(DATA, 'users', n + '.json');
let userCount = fs.readdirSync(path.join(DATA, 'users')).filter(f => f.endsWith('.json')).length;

/* ---------- storage (in-memory LRU in front of one file per user) ---------- */
const cache = new Map();
const busy = name => queues.has(name) || (current && current.name === name) || syncing.has(name); // never evict these
function load(name) {
  if (cache.has(name)) { const d = cache.get(name); cache.delete(name); cache.set(name, d); return d; }
  let d;
  try { d = JSON.parse(fs.readFileSync(userFile(name), 'utf8')); }
  catch (e) { d = { name, synced: [], games: {}, an: {}, seq: 0, lastSync: 0 }; }
  cache.set(name, d);
  if (cache.size > 40) for (const k of cache.keys()) { if (!busy(k)) { cache.delete(k); break; } }
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
function sync(name, months, force) {
  if (!syncing.has(name)) syncing.set(name, doSync(name, months, force).finally(() => syncing.delete(name)));
  return syncing.get(name);
}
async function doSync(name, months, force) {
  const d = load(name);
  if (!force && Date.now() - d.lastSync < SYNC_EVERY && d.months >= months) return;
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

/* ---------- Stockfish (the same Stockfish 18 build the page uses, run under Node) ---------- */
class Engine {
  constructor() { this.proc = null; this.buf = ''; this.handler = null; }
  async start() {
    this.proc = spawn(process.execPath, [path.join(ENGINE_DIR, 'stockfish-18-lite-single.js')], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.buf = '';
    this.proc.stdout.on('data', d => {
      this.buf += d; let i;
      while ((i = this.buf.indexOf('\n')) >= 0) { const l = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1); if (this.handler) this.handler(l); }
    });
    this.proc.on('exit', () => { this.proc = null; if (this.handler) this.handler('__exit__'); });
    this.proc.stdin.on('error', () => {});
    await this.until(() => this.send('uci'), l => l === 'uciok');
    this.send('setoption name Threads value 1'); this.send('setoption name Hash value 32'); this.send('setoption name MultiPV value 2');
    await this.until(() => this.send('isready'), l => l === 'readyok');
  }
  send(s) { if (this.proc) this.proc.stdin.write(s + '\n'); }
  until(go, test, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.handler = null; reject(new Error('engine timeout')); }, timeoutMs);
      this.handler = l => {
        if (l === '__exit__') { clearTimeout(t); this.handler = null; return reject(new Error('engine exited')); }
        if (test(l)) { clearTimeout(t); this.handler = null; resolve(l); }
      };
      go();
    });
  }
  stop() { if (this.proc) { this.proc.kill(); this.proc = null; } }
}
const engine = new Engine();
async function evalFen(fen) {
  const c = new Chess(fen), side = fen.split(' ')[1];
  if (c.in_checkmate()) return { c: side === 'w' ? -10000 : 10000, m: null, b: null };
  if (c.game_over()) return { c: 0, m: null, b: null };
  const lines = {};
  const last = await engine.until(() => { engine.send('position fen ' + fen); engine.send('go depth ' + DEPTH); }, l => {
    if (l.startsWith('info') && l.includes(' score ') && !/bound/.test(l)) {
      const m = l.match(/score (cp|mate) (-?\d+)/), pv = l.match(/ pv (.+)$/), mp = l.match(/ multipv (\d+)/);
      if (m) lines[mp ? +mp[1] : 1] = { t: m[1], v: +m[2], pv: pv ? pv[1].trim().split(' ').slice(0, 6).join(' ') : '' };
    }
    return l.startsWith('bestmove');
  }, 60000);
  const sg = side === 'w' ? 1 : -1, l1 = lines[1] || { t: 'cp', v: 0 }, l2 = lines[2];
  const e = l1.t === 'mate' ? { c: null, m: l1.v * sg, b: last.split(' ')[1] } : { c: l1.v * sg, m: null, b: last.split(' ')[1] };
  if (l1.pv) e.v = l1.pv;
  if (l2) { if (l2.t === 'mate') { e.c2 = null; e.m2 = l2.v * sg; } else { e.c2 = l2.v * sg; e.m2 = null; } }
  return e;
}
async function analyseGame(game) {
  const c = new Chess();
  if (!c.load_pgn(game.pgn)) throw new Error('game unreadable');
  const r = new Chess(), fens = [r.fen()];
  for (const m of c.history()) { r.move(m); fens.push(r.fen()); }
  if (!engine.proc) await engine.start();
  engine.send('ucinewgame');
  const p = [];
  for (const f of fens) p.push(await evalFen(f));
  return p;
}

/* ---------- analysis queue: newest games first, fair between users, one engine, low priority ---------- */
const queues = new Map();   // name -> [game urls] still to analyse
const order = [];           // round-robin order of names
let current = null, running = false, queued = 0;
function enqueue(name) {
  const d = load(name);
  const q = queues.get(name) || [];
  const urls = Object.values(d.games).sort((a, b) => b.end_time - a.end_time).slice(0, ANALYSE_LATEST).map(g => g.url);
  for (const u of urls) {
    if (d.an[u] || q.includes(u) || (current && current.url === u)) continue;
    if (queued >= QUEUE_MAX) break;
    q.push(u); queued++;
  }
  if (q.length) { queues.set(name, q); if (!order.includes(name)) order.push(name); kick(); }
}
async function kick() {
  if (running) return;
  running = true;
  try {
    while (order.length) {
      const name = order.shift(), q = queues.get(name);
      if (!q || !q.length) { queues.delete(name); continue; }
      const url = q.shift(); queued--;
      if (q.length) order.push(name); else queues.delete(name);
      const d = load(name), g = d.games[url];
      if (!g || d.an[url]) continue;
      current = { name, url };
      try {
        const p = await analyseGame(g);
        if (cache.get(name) !== d) continue;           // profile was deleted while the engine was working: drop the result
        d.an[url] = { depth: DEPTH, p, seq: ++d.seq };
        persist(d);
      } catch (e) {
        console.error(new Date().toISOString(), 'analysis failed', name, url, e.message);
        engine.stop();                                 // restart the engine for the next job
        await new Promise(r => setTimeout(r, 2000));
      }
      current = null;
    }
  } finally { running = false; current = null; }
}
// How far the server is with this user's newest games (what the page shows as a progress line).
function progress(d) {
  const urls = Object.values(d.games).sort((a, b) => b.end_time - a.end_time).slice(0, ANALYSE_LATEST).map(g => g.url);
  const done = urls.filter(u => d.an[u]).length;
  return { target: urls.length, done, pending: urls.length - done };
}

/* ---------- keeping profiles up to date: every minute, for everyone who used the site recently ---------- */
// "seen" = when a username was last looked up. Users seen in the last 7 days are re-checked against chess.com
// every minute (newest 100 users), and every new game goes straight into the analysis queue.
const SEEN_FILE = path.join(DATA, 'seen.json'), ACTIVE_DAYS = 7, MAX_TRACKED = 100, CHECK_EVERY = +process.env.CHECK_EVERY || 60e3;
let seen = {}; try { seen = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')); } catch (e) { /* first run */ }
let seenDirty = false;
const touch = name => { seen[name] = Date.now(); seenDirty = true; };
const flushSeen = () => { if (!seenDirty) return; seenDirty = false; try { fs.writeFileSync(SEEN_FILE + '.tmp', JSON.stringify(seen)); fs.renameSync(SEEN_FILE + '.tmp', SEEN_FILE); } catch (e) { seenDirty = true; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function trackLoop() {
  for (;;) {
    await sleep(CHECK_EVERY);
    try {
      flushSeen();
      const now = Date.now();
      const names = Object.entries(seen).filter(([n, t]) => now - t < ACTIVE_DAYS * 864e5 && fs.existsSync(userFile(n)))
        .sort((a, b) => b[1] - a[1]).slice(0, MAX_TRACKED).map(x => x[0]);
      for (const n of names) {
        try { await sync(n, load(n).months || 1, true); enqueue(n); }
        catch (e) { /* chess.com hiccup: try again next minute */ }
        await sleep(400);                              // be polite to chess.com
      }
    } catch (e) { console.error(new Date().toISOString(), 'track loop', e); }
  }
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
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(obj));
};
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
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x'), ip = clientIp(req);
  const m = url.pathname.match(/^\/api\/profile\/([^/]+)$/);
  if (url.pathname === '/api/health') return send(res, 200, { ok: true, users: userCount, queued, analysing: current ? current.name : null, depth: DEPTH });
  if (!m) {
    if (STATIC && !url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
    return send(res, 404, { error: 'not found' });
  }
  let name; try { name = decodeURIComponent(m[1]).trim().toLowerCase(); } catch (e) { return send(res, 400, { error: 'bad name' }); }
  if (!NAME_RE.test(name)) return send(res, 400, { error: 'invalid chess.com username' });

  if (req.method === 'GET') {
    if (limited(ip, 'profile', 60, 60e3)) return send(res, 429, { error: 'too many requests, try again in a minute' });
    const months = Math.max(1, Math.min(MAX_MONTHS, parseInt(url.searchParams.get('months')) || 2));
    const since = Math.max(0, parseInt(url.searchParams.get('since')) || 0);
    if (!fs.existsSync(userFile(name))) {
      if (userCount >= MAX_USERS) return send(res, 503, { error: 'the server cache is full' });
      if (limited(ip, 'newuser', 8, 10 * 60e3)) return send(res, 429, { error: 'too many new users from your address, try later' });
    }
    const force = url.searchParams.get('refresh') === '1' && !limited(ip, 'refresh', 6, 60e3); // the page's reload button
    const d = load(name); let warn = null;
    try { await sync(name, months, force); }
    catch (e) {
      if (!Object.keys(d.games).length) { cache.delete(name); return send(res, e.code === 404 ? 404 : 502, { error: e.message }); }
      warn = e.message;
    }
    touch(name);                                       // from now on the server keeps this user up to date by itself
    enqueue(name);                                     // Stockfish works through this user's newest games in the background
    const games = [], analyses = {};
    for (const g of Object.values(d.games)) if (g.seq > since) { const { seq, ...rest } = g; games.push(rest); }
    for (const [u, a] of Object.entries(d.an)) if (a.seq > since) analyses[u] = { depth: a.depth, p: a.p };
    return send(res, 200, { name, seq: d.seq, total: Object.keys(d.games).length, games, analyses, progress: progress(d), checked: d.lastSync, warn });
  }

  if (req.method === 'DELETE') {
    if (limited(ip, 'delete', 10, 3600e3)) return send(res, 429, { error: 'too many requests' });
    const q = queues.get(name); if (q) { queued -= q.length; queues.delete(name); const i = order.indexOf(name); if (i >= 0) order.splice(i, 1); }
    cache.delete(name); delete seen[name]; seenDirty = true;   // also stops the automatic re-checking
    try { fs.unlinkSync(userFile(name)); userCount = Math.max(0, userCount - 1); } catch (e) { /* nothing stored */ }
    return send(res, 200, { deleted: true });
  }
  return send(res, 405, { error: 'method not allowed' });
}

http.createServer((req, res) => {
  handle(req, res).catch(e => { console.error(new Date().toISOString(), req.method, req.url, e); if (!res.headersSent) send(res, 500, { error: 'server error' }); else res.end(); });
}).listen(PORT, HOST, () => {
  console.log(`ChessCoach API on http://${HOST}:${PORT} (data: ${DATA}, users: ${userCount}, engine depth ${DEPTH}, re-checking active users every ${CHECK_EVERY / 1000}s)`);
  if (!process.env.NO_TRACKING) trackLoop();
  for (const [n, t] of Object.entries(seen)) if (Date.now() - t < ACTIVE_DAYS * 864e5 && fs.existsSync(userFile(n))) enqueue(n); // resume unfinished analysis after a restart
});
const shutdown = () => { flushSeen(); engine.stop(); process.exit(0); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
