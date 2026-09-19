import assert from 'node:assert/strict';
import { TicTacToeGame } from '../public/js/game.js';
import { ClassicComputerPlayer, JevPlayer } from '../public/js/players.js';
import { createJevDecision } from '../lib/jev.js';

// Explicit opt-in: this command makes real, billable TypeSafe API calls.
const sizes = process.argv.slice(2).map(Number);
if (sizes.length === 0) sizes.push(3, 4, 5);
if (sizes.some((size) => ![3, 4, 5].includes(size))) {
  throw new Error('Usage: npm run test:jev -- [3 4 5]');
}
const decide = createJevDecision();
for (const size of sizes) {
  for (const jevMark of ['X', 'O']) {
    const game = new TicTacToeGame(size);
    const players = Object.fromEntries(['X', 'O'].map((mark) => [mark,
      mark === jevMark ? new JevPlayer(mark, { decide }) : new ClassicComputerPlayer(mark),
    ]));
    const moves = [];
    const started = performance.now();
    while (!game.isOver) {
      const legal = game.legalMoves();
      const mark = game.currentPlayer;
      const before = game.snapshot();
      const move = await players[mark].chooseMove(game.clone(), legal);
      assert.deepEqual(game.snapshot(), before, 'Player must not mutate the live game');
      assert.ok(legal.includes(move), `Illegal ${mark} move: ${move}`);
      game.play(move);
      moves.push({ mark, move });
    }
    console.log(JSON.stringify({ size, jevMark, winner: game.winner, draw: game.isDraw,
      moves, elapsedMs: Math.round(performance.now() - started) }));
  }
}
