import test from 'node:test';
import assert from 'node:assert/strict';
import { TicTacToeGame } from '../public/js/game.js';
import { JevPlayer } from '../public/js/players.js';
import { createJevClient, createJevDecision } from '../lib/jev.js';

function answer(label, type = 'choice') {
  return { answers: { move: { type, choice: label } } };
}

test('Jev uses exactly the supplied moves in a Choice for every board size and mark', async () => {
  for (const size of [3, 4, 5, 6]) {
    for (const mark of ['X', 'O']) {
      const game = new TicTacToeGame(size);
      if (mark === 'O') game.play(0);
      const before = game.snapshot();
      const legal = [size * size - 1, 2];
      const controller = new AbortController();
      let calls = 0;
      const decide = createJevDecision({
        async systemOne(request, options) {
          calls += 1;
          assert.equal(request.model, 'jev-latest');
          assert.equal(request.questions.move.type, 'choice');
          assert.deepEqual(Object.keys(request.questions.move.criteria), legal.map((n) => `cell_${n}`));
          assert.deepEqual(request.state.board, game.board);
          assert.deepEqual(request.state.legalMoves, legal);
          assert.equal(request.state.currentPlayer, mark);
          assert.match(request.state.rules, new RegExp(`${size} of your marks`));
          assert.equal(options.signal, controller.signal);
          return answer(`cell_${legal[0]}`);
        },
      });
      const player = new JevPlayer(mark, { decide });
      assert.equal(await player.chooseMove(game, legal, { signal: controller.signal }), legal[0]);
      assert.equal(calls, 1);
      assert.deepEqual(game.snapshot(), before);
      assert.deepEqual(legal, [size * size - 1, 2]);
    }
  }
});

test('accepts an engine snapshot and still asks Jev when only one move is supplied', async () => {
  const game = new TicTacToeGame(3);
  const player = new JevPlayer('X', { decide: createJevDecision({
    async systemOne({ questions }) {
      assert.deepEqual(Object.keys(questions.move.criteria), ['cell_0']);
      return answer('cell_0');
    },
  }) });
  assert.equal(await player.chooseMove({ ...game.snapshot(), legalMoves: [0] }), 0);
});

test('rejects unknown, occupied, malformed and wrong-type API decisions without fallback', async () => {
  const game = new TicTacToeGame(3);
  game.play(0);
  for (const result of [answer('cell_0'), answer('cell_8'), answer('cell_2junk'),
    answer('2'), answer(2), answer('cell_2', 'score'), {}, null]) {
    const player = new JevPlayer('O', { decide: createJevDecision({ systemOne: async () => result }) });
    await assert.rejects(player.chooseMove(game, [2, 3]), /outside the supplied/);
  }
  for (const move of [0, 8, '2', undefined, NaN, -1, 2.5]) {
    const player = new JevPlayer('O', { decide: async () => move });
    await assert.rejects(player.chooseMove(game, [2, 3]), /outside the supplied/);
  }
});

test('refuses invalid inputs before contacting Jev', async () => {
  assert.throws(() => new JevPlayer('Z'), /Invalid player mark/);
  let calls = 0;
  const player = new JevPlayer('X', { decide: async () => { calls += 1; return 0; } });
  const game = new TicTacToeGame(3);
  for (const legal of [[], [0, 0], [-1], [9], ['0']]) {
    await assert.rejects(player.chooseMove(game, legal));
  }
  await assert.rejects(player.chooseMove({ ...game.snapshot(), board: ['X'] }));
  await assert.rejects(player.chooseMove({ ...game.snapshot(), size: 7 }));
  game.play(0);
  await assert.rejects(player.chooseMove(game), /not X's turn/);
  const opponent = new JevPlayer('O', { decide: player.decide });
  await assert.rejects(opponent.chooseMove(game, [0]), /legal moves/);
  await assert.rejects(opponent.chooseMove({ ...game.snapshot(), board: Array(9).fill('') }), /Invalid player turn/);
  game.play(3); game.play(1); game.play(4); game.play(2);
  await assert.rejects(player.chooseMove(game), /finished game/);
  // A caller cannot hide a win by lying about isOver.
  await assert.rejects(opponent.chooseMove({ ...game.snapshot(), currentPlayer: 'O', isOver: false }), /finished game/);
  const draw = new TicTacToeGame(3);
  for (const move of [0, 4, 8, 1, 7, 6, 2, 5, 3]) draw.play(move);
  await assert.rejects(player.chooseMove(draw));
  assert.equal(calls, 0);
});

test('API failures and cancellation propagate without mutating the game', async () => {
  const game = new TicTacToeGame(3);
  const before = game.snapshot();
  for (const error of [new Error('API unavailable'), new DOMException('Cancelled', 'AbortError')]) {
    const player = new JevPlayer('X', { decide: createJevDecision({ systemOne: async () => { throw error; } }) });
    await assert.rejects(player.chooseMove(game), (caught) => caught === error);
    assert.deepEqual(game.snapshot(), before);
  }
});

test('retains its legal-move contract across an asynchronous decision', async () => {
  const game = new TicTacToeGame(3);
  const player = new JevPlayer('X', { decide: async (state) => {
    state.legalMoves.push(1);
    state.board[0] = 'X';
    return 1;
  } });
  await assert.rejects(player.chooseMove(game, [0]), /outside the supplied/);
  assert.equal(game.board[0], '');
});

test('client explicitly uses TYPESAFE_AI_API_KEY and the official Choice HTTP contract', async (t) => {
  const original = process.env.TYPESAFE_AI_API_KEY;
  t.after(() => {
    if (original === undefined) delete process.env.TYPESAFE_AI_API_KEY;
    else process.env.TYPESAFE_AI_API_KEY = original;
  });
  delete process.env.TYPESAFE_AI_API_KEY;
  assert.throws(createJevClient, /TYPESAFE_AI_API_KEY/);
  process.env.TYPESAFE_AI_API_KEY = 'test-only-placeholder';
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls += 1;
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(new Headers(options.headers).get('authorization'), 'Bearer test-only-placeholder');
    const request = JSON.parse(options.body);
    assert.equal(request.questions.move.type, 'choice');
    assert.deepEqual(Object.keys(request.questions.move.criteria), ['cell_0', 'cell_8']);
    return Response.json({ ...answer('cell_8'), model: 'jev-latest', usage: { input_tokens: 10, output_tokens: 1 } });
  });
  const player = new JevPlayer('X', { decide: createJevDecision() });
  assert.equal(await player.chooseMove(new TicTacToeGame(3), [0, 8]), 8);
  assert.equal(calls, 1);
});
