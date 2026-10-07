# ChessCoach

A free, browser-only chess game reviewer for your [chess.com](https://www.chess.com) games.
Enter your username, load your games, and let Stockfish show you what went wrong.

- **Game review (Stockfish 18)**: every move labelled like chess.com's Game Review: Brilliant, Great, Best, Excellent, Good, Theory (opening book), Inaccuracy, Miss, Mistake, Blunder. Accuracy %, eval graph, a summary table per player, the engine's best line, hung pieces / missed captures / missed mates, and where you left opening theory (with the theory moves).
- **"Why was this bad?"**: for every inaccuracy, miss, mistake and blunder (yours and your opponent's) the review names the reasons in plain words: piece left hanging, threat ignored, fork, bad trade, missed capture or mate, early queen, weakened king, a less active piece, a winning advantage thrown away.
- **Weekly progress**: this week against the same days last week (games, win rate, rating change, accuracy, serious mistakes per 100 moves), highlights, your top mistake types with a tip, training activity and streak, a focus list, an 8-week trend, and a copyable summary.
- **Rating goal**: pick a time control and a target rating; progress bar, rating history with the target line, pace and ETA, and a personal plan of what to work on.
- **Tactics by theme**: the tactics you missed in your own games, recognised (checkmate, forks, pins and skewers, discovered attacks, free material, defence, promotion, safety) and grouped, so you can train one pattern at a time; each solved puzzle explains why the move works.
- **Endgame drills**: play basic endgames against Stockfish with fresh random positions every time (KQ, KR and two-rook mates, king and pawn vs king as attacker or defender, the Lucena and Philidor positions). Stockfish judges each move, explains what a spoiled win or draw cost, and lets you take it back.
- **Opening drills**: learn real opening theory move by move (London System, Italian Game, Sicilian, French, Caro-Kann, Queen's Gambit and about 30 more, with variations) with spaced repetition.
- **Analytics**: results by colour, time control, opponent strength, time of day and weekday; how you win and lose; streaks and tilt; time management from the clocks; accuracy trends; mistake patterns by move number and piece; conversion and resilience.
- **Openings explorer**: click through the lines you actually play, with your win/draw/loss score.
- **Insights**: your weakest phase of the game, recurring opening mistakes, openings that cost you the most.
- **Train your mistakes**: puzzles built from your own blunders, with spaced repetition (a position you solve returns after 1, 3, 7, 21, 60 days; one you miss returns soon).
- **Saved in your browser**: enter your username once; games, analysis and training progress are kept locally (IndexedDB), and only new games are fetched next time.
- **Add your own games**: paste or upload any PGN (chess.com, lichess, over the board).
- **Mobile friendly**: tap-to-move puzzles and a layout that fits phones.
- Games come from the public chess.com API (no login or key needed).

Everything runs in the browser: Stockfish 18 (WebAssembly) analyses locally, and results are cached in your browser. Nothing is sent anywhere except the public chess.com API requests.

## Run it

It is a static site, so any web server works:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000/>. To deploy, upload `index.html` and the `engine/` folder to any static host.

## Licence

GPL-3.0, see [LICENSE](LICENSE). The `engine/` folder contains [Stockfish.js](https://github.com/nmrugg/stockfish.js) (Stockfish 18, GPLv3) by Chess.com, LLC and the Stockfish developers. Piece images are loaded from the [lichess](https://github.com/lichess-org/lila) cburnett set; chess logic uses [chess.js](https://github.com/jhlywa/chess.js).

## Server (optional)

`server/server.js` is a small dependency-free Node service:

- keeps a **public cache** of each chess.com username's games (one JSON file per user, no accounts, no passwords),
- **re-checks chess.com every minute** for everyone who used the site in the last 7 days,
- runs **Stockfish 18** itself (the same engine build the page uses, under Node, depth 16, one engine, low priority)
  over each user's newest 100 games and every new game, round-robin between users,
- hands the finished analysis to the page, which polls for it, so nothing has to be pressed.

Nobody can upload analysis: only the server's own Stockfish writes it. Without the server the page falls back to
asking chess.com directly and analysing in the browser. See `deploy/` for a hardened systemd unit (nice, CPU and
memory limited) and the nginx snippet. Only public data is stored; imported PGNs and training progress stay in the
visitor's browser.

Opening theory comes from [lichess chess-openings](https://github.com/lichess-org/chess-openings) (CC0); regenerate
`book.json` with `node tools/build-book.js`.
