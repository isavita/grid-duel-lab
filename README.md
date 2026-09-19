# Grid Duel Lab

Mobile-first Tic-Tac-Toe for 3×3, 4×4 and 5×5 boards.

## Modes

- Tap **Classic** or **Jev** to choose your opponent, then tap a square to play.
- Choose a board size from 3×3 to 5×5.
- Open **Game options** to play as X or O, or switch to **Watch computers**.
- Watch mode provides independent X/O computer choices and adjustable autoplay speed.

The winning rule is deliberately simple: on an N×N board, complete an entire row, column or main diagonal of length N.

## AI

`ClassicComputerPlayer` and `JevPlayer` implement the same asynchronous `chooseMove(game)` interface. Both use the same game rules and support exactly 3×3, 4×4, and 5×5 boards.

Classic uses full Minimax with alpha-beta pruning on 3×3, and immediate win/block detection plus depth-limited search on 4×4–5×5.

Jev makes every move from its own evaluations. It receives the current board and **one [Score question](https://docs.typesafe.ai/primitives/score) per supplied legal move**, batched in a single API call. Each question includes the board after that move, with every row, column, and main diagonal written out. With eight or fewer empty cells, it also receives all hypothetical opponent reply lines. This is board expansion only: no local win/block filter, tactical labels, Minimax, or rule-based move override is used. Even a sole legal move goes through Jev.

`buildJevRequest(snapshot)` in `lib/jev.js` defines the format and instructions in one place. The shared state contains the complete current 2D `board`, `"."` empties, size, marks, winning rule, and one-based coordinates such as `r1c3`. Each question explicitly identifies its move and player, so it can be evaluated independently. All fields adapt to 3×3, 4×4, and 5×5 and to either mark.

The instructions tell Jev to check for a completed win first: winning ends the game, so the opponent cannot reply and there is no need to block a threat. Otherwise it must consider immediate losses, the opponent's strongest reply, and forks. Jev evaluates each resulting position on four ordered levels:

1. Forced loss, even with optimal defense.
2. A draw can be secured, but no win can be forced.
3. A future win can be forced.
4. The move has already won the game.

The adapter first minimizes Jev's probability assigned to the loss level, then prefers the higher outcome score for equal estimated loss risk. These probabilities are model judgments, not proven game outcomes or calibrated loss odds. Ties preserve the supplied move order. Every requested evaluation must be valid; missing or malformed results fail instead of guessing.

See [a complete generated request](docs/jev-request.example.json) for the reported screenshot position: O can win at `r3c3`, while `r3c2` merely blocks. Both moves remain available to Jev. The browser endpoint still returns an integer index, such as `{ "move": 8 }` for `r3c3` on 3×3. `JevPlayer` accepts a game or snapshot and an optional legal-move list: `await player.chooseMove(game, legalMoves)`.

To inspect or tune the prompt without making an API call:

```js
import { buildJevRequest } from './lib/jev.js';
import { TicTacToeGame } from './public/js/game.js';

const game = new TicTacToeGame(4); // 3, 4, or 5
game.play(0); // O to move
console.log(JSON.stringify(buildJevRequest(game), null, 2));
```

The browser calls `POST /api/jev/move`. The server validates the board and moves, then uses the official `@typesafe-ai/sdk` client with `apiKey: process.env.TYPESAFE_AI_API_KEY` and model `jev-latest`. Credentials never go to the browser. A failed, timed-out, or invalid decision leaves the board unchanged and offers **Retry move**; there is no classic or random fallback. Pausing, restarting, or changing setup cancels the pending request and discards stale results.

## Run locally

Requires Node.js 20+.

```bash
npm install
npm start
```

Open <http://localhost:3000>.

For Jev, start the server from an environment containing `TYPESAFE_AI_API_KEY`. The local testing environment already supplies it. Classic play and `/health` work without a key. Never put the key in public files, source code, or a committed configuration file. If using an ignored `.env` file, load it explicitly with Node 20.6+: `node --env-file=.env server.js`.

To watch Jev against Classic, open **Game options**, select **Watch computers**, set **Computer X** to **Jev** and **Computer O** to **Classic** (or swap them), then choose a board size.

Development mode with server restart:

```bash
npm run dev
```

## Tests

```bash
npm test
```

Offline tests cover Score serialization, the complete current and successor boards, bounded reply context, model-only decisions, loss-first ranking, legal-move enforcement, invalid evaluations, cancellation, credentials, the HTTP endpoint, and existing engine/classic behavior. They verify the integration, not model strength.

Browser checks (offline by default, with an injected decision service):

```bash
npx playwright install chromium
npm run test:browser
npm run test:layout
```

The tabletop-inspired UI uses ivory tiles, terracotta Xs, green Os, and a compact phone layout. Desktops place setup beside the board, while tablets keep the controls above it. Short landscape screens also place setup beside the game. All board sizes retain square cells and touch targets of at least 44px. Board-size buttons support arrow-key navigation; Escape closes Game options, and reduced-motion preferences disable mark animations.

The layout check plays full games at nine phone, tablet, and desktop viewport sizes from 320px to 1920px, including portrait and landscape. It checks cell size and position after every rendered turn, horizontal overflow, touch targets, screen fit, and preservation of an active game when a phone rotates.

Live API matches are opt-in and use the environment key. Test 3×3 first, then reuse the same adapter for the larger boards:

```bash
npm run test:jev -- 3
npm run test:jev -- 4 5
npm run test:browser -- --live
```

Repeatable live tactical probes cover the screenshot, taking a win before blocking, mandatory blocks, and fork defense:

```bash
npm run test:jev:tactics
npm run test:jev:tactics -- --repeats 3
npm run test:jev:tactics -- --case screenshot-win --repeats 3
```

The tactical command saves requests, answers, selected moves, and timings to `output/jev-evaluation/tactics.json`. It exits nonzero for missed tactics or API failures, preserving failures for inspection. Expected moves are test-only references and never enter Jev's request.

Latest small live sample (2026-09-19, `jev-latest`): the final Score request passed **29/30** probes across ten positions repeated three times. All 27 immediate win/block probes passed, including the screenshot in all three repeats. Fork defense passed 2/3. A phone-sized browser replay of the reported position also produced O's bottom-right win through the live API. Two complete 3×3 matches against Classic, one as each mark, both ended in draws. Prompt changes during exploration affected fork results, so this is evidence of improvement on these cases, not a guarantee of perfect play.

The match command plays Jev as both X and O against Classic, checks every returned move, and prints a JSON move history and outcome. These commands make billable API calls. `npm run test:jev` without arguments runs all sizes in ascending order.

Historical live smoke test (including the since-removed 6×6 size; 2026-09-19, `jev-latest`): two games per size, one as each mark. All 57 Jev decisions were legal; Classic won all eight games. This checks integration, not competitive strength, and is a small sample rather than a benchmark.

## Vercel

`server.js` exports the HTTP server as its default export so Vercel can load it as a Node.js function. It starts its own listener only when run directly with `npm start`, which also supports local development and Railway.

Set `TYPESAFE_AI_API_KEY` in the Vercel project's environment variables to enable Jev, then deploy the updated source. Classic play and `/health` work without a key. After deploying, check `/health`, the game at `/`, and a Jev move if the key is configured.

## Railway

The app uses a Node web server with the TypeSafe SDK as its runtime dependency. `railway.json` configures `npm start` and the `/health` deployment health check. The server reads Railway's `PORT` environment variable and exposes:

- `/` — game
- `/health` — deployment health check
- `/api/jev/move` — server-side Jev decision endpoint (POST)

Deploy using either a GitHub repository or the Railway CLI (`railway init`, then `railway up`). After deployment, generate a public domain in Railway's Networking settings. Set `TYPESAFE_AI_API_KEY` as a Railway service variable to enable Jev and use `/health` for the health check.
