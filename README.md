# ChessCoach

A free, browser-only chess game reviewer for your [chess.com](https://www.chess.com) games.
Enter your username, load your games, and let Stockfish show you what went wrong.

- **Game review**: every move rated best / excellent / good / inaccuracy / mistake / blunder, accuracy %, eval graph, and a short explanation of hung pieces, missed captures and missed mates.
- **Openings explorer**: click through the lines you actually play, with your win/draw/loss score.
- **Insights**: your weakest phase of the game, recurring opening mistakes, openings that cost you the most.
- **Import**: uses the public chess.com API (no login or key needed).

Everything runs in the browser: Stockfish 18 (WebAssembly) analyses locally, and results are cached in your browser. Nothing is sent anywhere except the public chess.com API requests.

## Run it

It is a static site, so any web server works:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000/>. To deploy, upload `index.html` and the `engine/` folder to any static host.

## Licence

GPL-3.0, see [LICENSE](LICENSE). The `engine/` folder contains [Stockfish.js](https://github.com/nmrugg/stockfish.js) (Stockfish 18, GPLv3) by Chess.com, LLC and the Stockfish developers. Piece images are loaded from the [lichess](https://github.com/lichess-org/lila) cburnett set; chess logic uses [chess.js](https://github.com/jhlywa/chess.js).
