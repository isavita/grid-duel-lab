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

- 3×3: full Minimax with alpha-beta pruning
- 4×4–5×5: immediate win/block detection plus depth-limited alpha-beta search and deterministic board evaluation

`JevPlayer` sends the current board, player mark, N-in-a-row rules, and supplied legal moves to TypeSafe using one [Choice decision](https://docs.typesafe.ai/primitives/choice). Each option maps to one legal cell; the response must match an exact option label. The player returns only its corresponding integer board index. It accepts an engine instance or snapshot, plus an optional explicit legal-move list: `await player.chooseMove(game, legalMoves)`. The same implementation handles all three sizes.

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

Offline tests cover the Choice request/response contract, legal-move enforcement, invalid inputs, failures, credential configuration, the HTTP endpoint, and the existing engine/classic behavior.

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
