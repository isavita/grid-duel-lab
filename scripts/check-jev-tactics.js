import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createJevClient, createJevDecision } from '../lib/jev.js';
import { TicTacToeGame } from '../public/js/game.js';

// Explicit opt-in: real, billable Jev evaluations. Expected moves are test oracles;
// they never enter the model request or the production decision code.
const cases = [
  { name: 'screenshot-win', size: 3, moves: [1, 0, 3, 2, 4, 5, 6], expected: [8] },
  { name: '3x3-win-before-block-X', size: 3, moves: [0, 3, 1, 4], expected: [2] },
  { name: '3x3-block-O', size: 3, moves: [0, 3, 1, 7, 6], expected: [2] },
  { name: '3x3-fork-defense-O', size: 3, moves: [0, 4, 8], expected: [1, 3, 5, 7] },
  { name: '4x4-win-before-block-X', size: 4, moves: [0, 4, 1, 5, 2, 6], expected: [3] },
  { name: '4x4-win-before-block-O', size: 4, moves: [4, 0, 5, 1, 6, 2, 12], expected: [3] },
  { name: '4x4-block-O', size: 4, moves: [0, 4, 1, 6, 2], expected: [3] },
  { name: '5x5-win-before-block-X', size: 5, moves: [0, 5, 1, 6, 2, 7, 3, 8], expected: [4] },
  { name: '5x5-win-before-block-O', size: 5, moves: [5, 0, 6, 1, 7, 2, 8, 3, 20], expected: [4] },
  { name: '5x5-block-O', size: 5, moves: [0, 5, 1, 7, 2, 9, 3], expected: [4] },
];
const args = process.argv.slice(2);
let repeats = 1;
let selected = cases;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--repeats') repeats = Number(args[++i]);
  else if (args[i] === '--case') {
    const caseName = args[++i];
    selected = cases.filter(({ name }) => name === caseName);
  }
  else throw new Error(`Unknown argument: ${args[i]}`);
}
assert.ok(Number.isInteger(repeats) && repeats >= 1 && repeats <= 10, 'Use --repeats 1 through 10');
assert.ok(selected.length, 'Unknown --case name');
const client = createJevClient();
const results = [];
await mkdir('output/jev-evaluation', { recursive: true });
for (let repeat = 0; repeat < repeats; repeat += 1) {
  for (const fixture of selected) {
    const game = new TicTacToeGame(fixture.size);
    for (const move of fixture.moves) game.play(move);
    assert.equal(game.isOver, false);
    const before = game.snapshot();
    const started = performance.now();
    let evidence;
    const decide = createJevDecision({ systemOne: async (request, options) => {
      const response = await client.systemOne(request, options);
      evidence = { request, response };
      return response;
    } });
    let result;
    try {
      const move = await decide(game);
      assert.ok(game.legalMoves().includes(move));
      assert.deepEqual(game.snapshot(), before);
      result = { name: fixture.name, repeat, move, expected: fixture.expected, pass: fixture.expected.includes(move) };
    } catch (error) {
      result = { name: fixture.name, repeat, pass: false, error: error.message };
    }
    result.elapsedMs = Math.round(performance.now() - started);
    console.log(JSON.stringify(result));
    results.push({ ...result, ...evidence });
    await writeFile('output/jev-evaluation/tactics.json', `${JSON.stringify(results, null, 2)}\n`);
  }
}
const passed = results.filter(({ pass }) => pass).length;
console.log(`${passed}/${results.length} tactical probes passed. Small live sample, not a strength guarantee.`);
if (passed !== results.length) process.exitCode = 1;
