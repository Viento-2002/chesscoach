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
  const names = [], nameIdx = new Map(), pos = new Set(), ends = {};
  const idxOf = n => { if (!nameIdx.has(n)) { nameIdx.set(n, names.length); names.push(n); } return nameIdx.get(n); };
  let bad = 0;
  for (const { eco, name, pgn } of lines) {
    const c = new Chess();
    if (!c.load_pgn(pgn)) { bad++; continue; }
    const moves = c.history(), r = new Chess();
    const label = `${eco} ${name}`;
    moves.forEach((m, i) => {
      r.move(m);
      const h = posHash(r.fen());
      pos.add(h);                                          // every position on a known line is "theory"
      if (i === moves.length - 1 && !(h in ends)) ends[h] = idxOf(label); // only line ends carry a name (shortest line wins)
    });
  }
  const out = { v: 2, source: 'lichess-org/chess-openings (CC0)', n: names, p: [...pos].join(' '), e: ends };
  fs.writeFileSync(path.join(__dirname, '..', 'book.json'), JSON.stringify(out));
  console.log(`${lines.length} lines (${bad} unreadable), ${pos.size} positions, ${Object.keys(ends).length} named positions, ${names.length} names`);
})();
