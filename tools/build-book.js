'use strict';
// Builds book.json: every position that occurs in a known opening line (lichess chess-openings,
// CC0 / public domain), so the review can tell "theory" moves from the rest.
//   node tools/build-book.js            (downloads the five .tsv files, writes ./book.json)
const fs = require('fs'), path = require('path');
const { Chess } = require('../server/chess.js');

// Same hash as the page uses (index.html: posHash). Keeps book.json small.
const posKey = fen => fen.split(' ').slice(0, 4).join(' ');
const posHash = fen => { let h = 5381; const s = posKey(fen); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

(async () => {
  const lines = [];
  for (const f of 'abcde') {
    const r = await fetch(`https://raw.githubusercontent.com/lichess-org/chess-openings/master/${f}.tsv`);
    if (!r.ok) throw new Error(f + '.tsv: HTTP ' + r.status);
    (await r.text()).split('\n').slice(1).forEach(l => { const [eco, name, pgn] = l.split('\t'); if (name && pgn) lines.push({ eco, name, pgn }); });
  }
  lines.sort((a, b) => a.pgn.length - b.pgn.length); // shorter (more general) lines name their positions first
  const norm = t => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
// label, normalised key, how it matches a line name ("start" = name begins with it, "has" = name contains it).
// The drills offer these, each with its main variations; the page matches your own games with the same keys.
const POPULAR = [
  ['London System', 'london system', 'has'], ['Italian Game', 'italian game', 'start'], ['Sicilian Defense', 'sicilian defense', 'start'],
  ['French Defense', 'french defense', 'start'], ['Caro-Kann Defense', 'carokann', 'start'], ['Ruy Lopez', 'ruy lopez', 'start'],
  ["Queen's Gambit", 'queens gambit', 'start'], ["King's Indian Defense", 'kings indian', 'has'], ['English Opening', 'english opening', 'start'],
  ['Scandinavian Defense', 'scandinavian defense', 'start'], ['Slav Defense', 'slav defense', 'has'], ['Nimzo-Indian Defense', 'nimzoindian', 'has'],
  ['Dutch Defense', 'dutch defense', 'start'], ['Pirc Defense', 'pirc defense', 'has'], ['Alekhine Defense', 'alekhine', 'start'],
  ['Vienna Game', 'vienna game', 'start'], ['Scotch Game', 'scotch game', 'start'], ["King's Gambit", 'kings gambit', 'start'],
  ['Catalan Opening', 'catalan', 'has'], ['Grünfeld Defense', 'grunfeld', 'has'], ['Réti Opening', 'reti opening', 'has'],
  ['Philidor Defense', 'philidor', 'has'], ['Russian Game (Petrov)', 'russian game', 'start'], ['Four Knights Game', 'four knights', 'has'],
  ["Bishop's Opening", 'bishops opening', 'start'], ['Benoni Defense', 'benoni', 'has'], ['Colle System', 'colle system', 'has'],
  ['Trompowsky Attack', 'trompowsky', 'has'], ['Jobava London', 'jobava', 'has'], ['Stonewall Attack', 'stonewall', 'has'],
  ["Queen's Pawn Game", 'queens pawn game', 'start'], ['Modern Defense', 'modern defense', 'start'], ['Danish Gambit', 'danish gambit', 'has'],
  ['Evans Gambit', 'evans gambit', 'has'], ['Budapest Gambit', 'budapest', 'has'], ['Bird Opening', 'bird opening', 'start'], ['Polish Opening', 'polish opening', 'start']
];
const matches = (name, key, mode) => { const n = norm(name); return mode === 'start' ? n.startsWith(key) : n.includes(key); };
const names = [], nameIdx = new Map(), pos = new Set(), ends = {}, fam = {}, famVar = {};
  const idxOf = n => { if (!nameIdx.has(n)) { nameIdx.set(n, names.length); names.push(n); } return nameIdx.get(n); };
  let bad = 0;
  for (const { eco, name, pgn } of lines) {
    const c = new Chess();
    if (!c.load_pgn(pgn)) { bad++; continue; }
    const moves = c.history(), r = new Chess();
    const label = `${eco} ${name}`;
    // which popular openings (and which variation of them) this line belongs to: used by the opening drills
    const segs = name.split(': '), hits = [];
    for (const [lab, key, mode] of POPULAR) {
      if (!matches(name, key, mode)) continue;
      const idx = segs.findIndex(sg => matches(sg, key, mode)), v = idx >= 0 && segs[idx + 1] ? segs[idx + 1] : null;
      if (!fam[lab]) { fam[lab] = new Set(); famVar[lab] = {}; }
      hits.push(fam[lab]);
      if (v) { (famVar[lab][v] = famVar[lab][v] || new Set()); hits.push(famVar[lab][v]); }
    }
    moves.forEach((m, i) => {
      r.move(m);
      const h = posHash(r.fen());
      pos.add(h);                                          // every position on a known line is "theory"
      hits.forEach(set => set.add(h));
      if (i === moves.length - 1 && !(h in ends)) ends[h] = idxOf(label); // only line ends carry a name (shortest line wins)
    });
  }
  const f = {}, fv = {};
  const k = {};
  for (const [lab, key, mode] of POPULAR) {
    if (!fam[lab] || fam[lab].size < 4) continue;
    f[lab] = [...fam[lab]].join(' '); k[lab] = [key, mode];
    for (const [v, set] of Object.entries(famVar[lab])) if (set.size >= 25) (fv[lab] = fv[lab] || {})[v] = [...set].join(' ');
  }
  const out = { v: 3, source: 'lichess-org/chess-openings (CC0)', n: names, p: [...pos].join(' '), e: ends, f, fv, k };
  fs.writeFileSync(path.join(__dirname, '..', 'book.json'), JSON.stringify(out));
  console.log(`${lines.length} lines (${bad} unreadable), ${pos.size} positions, ${Object.keys(ends).length} named positions, ${names.length} names, ${Object.keys(f).length} drillable openings`);
})();
