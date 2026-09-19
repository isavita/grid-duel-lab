# Grid Duel Lab

Mobile-first Tic-Tac-Toe for 3×3, 4×4, 5×5 and 6×6 boards.

## Modes

- You vs computer
- Computer vs computer
- Choose X or O in human mode
- Adjustable autoplay speed in computer-vs-computer mode

The winning rule is deliberately simple: on an N×N board, complete an entire row, column or main diagonal of length N.

## AI

`ClassicComputerPlayer` is isolated behind a `chooseMove(game)` interface so another decision maker (for example Jev) can be added later without changing the game engine or UI flow.

- 3×3: full Minimax with alpha-beta pruning
- 4×4–6×6: immediate win/block detection plus depth-limited alpha-beta search and deterministic board evaluation

## Run locally

Requires Node.js 20+.

```bash
npm start
```

Open <http://localhost:3000>.

Development mode with server restart:

```bash
npm run dev
```

## Tests

```bash
npm test
```

## Railway

The app is intentionally a zero-dependency Node web server. `railway.json` configures `npm start` and the `/health` deployment health check. The server reads Railway's `PORT` environment variable and exposes:

- `/` — game
- `/health` — deployment health check

Deploy using either a GitHub repository or the Railway CLI (`railway init`, then `railway up`). After deployment, generate a public domain in Railway's Networking settings. Set the healthcheck path to `/health` if desired.
