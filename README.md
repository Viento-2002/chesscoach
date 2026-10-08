# ChessCoach

A free chess game reviewer for your [chess.com](https://www.chess.com) **and [lichess](https://lichess.org)** games.
Pick the site, enter your username, load your games, and let Stockfish show you what went wrong.

- **Game review (Stockfish 18)**: every move labelled like chess.com's Game Review: Brilliant, Great, Best, Excellent, Good, Theory (opening book), Inaccuracy, Miss, Mistake, Blunder. Accuracy % (a harmonic plus volatility-weighted mean, like chess.com and lichess, so a game with many slips scores clearly lower than a plain average), an estimated game rating per player (the rating that the game's accuracy corresponds to), eval graph, a summary table per player, the engine's best line, hung pieces / missed captures / missed mates, and where you left opening theory (with the theory moves).
- **"Why was this bad?"**: for every inaccuracy, miss, mistake and blunder (yours and your opponent's) the review names the reasons in plain words: piece left hanging, threat ignored, fork, bad trade, missed capture or mate, early queen, weakened king, a less active piece, a winning advantage thrown away.
- **Sharing**: share a review as a link (opens that exact game read-only for anyone, with a proper title and accuracy when pasted into WhatsApp or Discord) or as an image card (board at the move you are on, accuracy, move labels, eval graph) through the phone's share sheet; the weekly summary can be shared too. A shared link points at a game stored on the server: `/s/<profile>/<game id>/<move>`.
- **lichess support**: choose lichess next to the username; the server fetches your standard-variant games (with clock times) from lichess' public API and everything else works the same, including the rating goal, analytics, training and reminders. If the ChessCoach server cannot be reached the page fetches the games from lichess itself.
- **Weekly progress**: this week against the same days last week (games, win rate, rating change, accuracy, serious mistakes per 100 moves), highlights, your top mistake types with a tip, training activity and streak, a focus list, an 8-week trend, and a copyable summary.
- **Rating goal**: pick a time control and a target rating; progress bar, rating history with the target line, pace and ETA, and a personal plan of what to work on.
- **Tactics by theme**: the tactics you missed in your own games, recognised (checkmate, forks, pins and skewers, discovered attacks, free material, defence, promotion, safety) and grouped, so you can train one pattern at a time; each solved puzzle explains why the move works.
- **Daily reminder + streak**: one gentle push notification a day at a time you choose, only if you have not trained yet, with your streak and the puzzles waiting. Optionally it also tells you when the server has finished analysing your games (after a batch of 3 or more by default, after every new game, or never; tapping it opens that review). Works as an installed home-screen app (needed on iPhone), on Android and on desktop browsers. The server sends it with Web Push and is told only your last training day, streak and puzzles due.
- **Endgame drills**: play basic endgames against Stockfish with fresh random positions every time (KQ, KR, bishop and knight and two-rook mates, queen vs a pawn on the 7th, king and pawn vs king as attacker or defender, the Lucena and Philidor positions). Stockfish judges each move, explains what a spoiled win or draw cost, and lets you take it back.
- **Analysis board**: from any position in a review, move the pieces yourself and see Stockfish's three best lines (tap one to play it), with a deeper-search button.
- **Vision trainer**: 30-second rounds to find named squares on an empty board and to tell light squares from dark ones; counts towards your streak.
- **Scout an opponent**: type a chess.com username and see which openings they play with each colour and how well they score, from their last two months (read straight from chess.com, nothing is stored).
- **Works offline**: the page, engine, opening book and your saved games and reviews are kept on the device, so reviews and training work without a connection.
- **Settings**: dark or light theme, board colours, piece sets, sound; export your reviewed games as an annotated PGN (evals, clocks, !/? symbols) or a single game from its review; quick-switch between recently used profiles.
- **Sunday summary** (optional, with reminders on): one notification with your week's games, record and accuracy against the week before.
- **Play Stockfish**: a full game against the engine at Beginner (1350) to Maximum strength, as White, Black or random, with an optional blindfold mode (pieces hidden, 2.5-second peek), take-back, resign, PGN download and a one-tap analysis of the final position.
- **Daily puzzle**: today's puzzle from chess.com (and random ones), with hint and answer; counts for your streak.
- **Training calendar**: a 20-week heatmap of the days you trained, under Progress.
- **Puzzle Rush**: three minutes and three strikes of puzzles from your own mistakes, with a saved best score and a share button.
- **Chess story + poster**: which of eight legends you play like (with the numbers behind the match), your greatest comeback, giant-killer win, nemesis and most expensive move, and a shareable poster image.
- **Roadmap**: a step-by-step plan built from the habits behind your own mistakes (the blunder check, hanging pieces, free material, finishing won positions, the first moves), each with a short lesson, practice and an example from your games. A step is only done when your last 10 games show the improvement.
- **Opening drills**: learn real opening theory move by move (London System, Italian Game, Sicilian, French, Caro-Kann, Queen's Gambit and about 30 more, with variations) with spaced repetition.
- **Analytics**: results by colour, time control, opponent strength, time of day and weekday; how you win and lose; streaks and tilt; time management from the clocks; accuracy trends; mistake patterns by move number and piece; conversion and resilience.
- **Openings explorer**: click through the lines you actually play, with your win/draw/loss score.
- **Insights**: your weakest phase of the game, recurring opening mistakes, openings that cost you the most.
- **Train your mistakes**: puzzles built from your own blunders, with a visual replay after each one, also available for every mistake in a game review (red arrow for what you played, orange for how it is punished, green for the best line, step-through chips and win-chance bars), with spaced repetition (a position you solve returns after 1, 3, 7, 21, 60 days; one you miss returns soon).
- **Saved in your browser**: enter your username once; games, analysis and training progress are kept locally (IndexedDB), and only new games are fetched next time.
- **Add your own games**: paste or upload any PGN (chess.com, lichess, over the board), or play the moves on a board.
- **Mobile friendly**: tap-to-move puzzles and a layout that fits phones.
- Games come from the public chess.com and lichess APIs (no login or key needed). A lichess profile is stored as `li.<name>` on the server.

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

### Reminders (Web Push)

`web-push` is the only dependency (`cd server && npm ci --omit=dev`). On first start the server creates a VAPID key
pair in `DATA_DIR/vapid.json` (mode 600, never commit it). Subscriptions are only accepted from the real browser
push services (an allow-list, so the server cannot be pointed at arbitrary addresses) and are stored in
`DATA_DIR/push.json`. Add this to the nginx site so the manifest has the right type:

    location = /manifest.webmanifest { default_type application/manifest+json; add_header Cache-Control "no-cache" always; }
