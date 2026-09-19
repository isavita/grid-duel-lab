import test from 'node:test';
import assert from 'node:assert/strict';
import { TicTacToeGame } from '../public/js/game.js';
import { JevPlayer } from '../public/js/players.js';
import { buildJevRequest, createJevClient, createJevDecision } from '../lib/jev.js';

function answer(label, type = 'choice') {
  return { answers: { best_move: { type, choice: label } } };
}

test('builds the coordinate-based request for a valid O turn without an API call', () => {
  const game = new TicTacToeGame(3);
  // Add X at r3c1 to the sample so O is actually next under X-first rules.
  for (const move of [0, 3, 1, 7, 6]) game.play(move);
  const before = game.snapshot();
  assert.deepEqual(buildJevRequest(game), {
    model: 'jev-latest',
    state: {
      game: 'tic-tac-toe',
      board_size: 3,
      win_condition: 'Get 3 marks in a row horizontally, vertically, or diagonally.',
      current_player: 'O',
      opponent: 'X',
      empty_cell: '.',
      board: [['X', 'X', '.'], ['O', '.', '.'], ['X', 'O', '.']],
      legal_moves: ['r1c3', 'r2c2', 'r2c3', 'r3c3'],
      coordinate_system: 'Rows and columns are numbered starting from 1. r1c3 means row 1, column 3.',
      objective: 'Choose the legal move that gives O the best chance of winning. A draw is preferable to a loss.',
    },
    questions: {
      best_move: {
        type: 'choice',
        instructions: 'Which legal move should O make now?',
        criteria: {
          r1c3: 'Place O at row 1, column 3',
          r2c2: 'Place O at row 2, column 2',
          r2c3: 'Place O at row 2, column 3',
          r3c3: 'Place O at row 3, column 3',
        },
      },
    },
  });
  assert.deepEqual(game.snapshot(), before);
});

test('Jev uses exactly the supplied moves in a Choice for every board size and mark', async () => {
  for (const size of [3, 4, 5]) {
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
          assert.equal(request.questions.best_move.type, 'choice');
          assert.deepEqual(Object.keys(request.questions.best_move.criteria), [`r${size}c${size}`, 'r1c3']);
          assert.equal(request.questions.best_move.instructions, `Which legal move should ${mark} make now?`);
          assert.equal(request.questions.best_move.criteria[`r${size}c${size}`], `Place ${mark} at row ${size}, column ${size}`);
          assert.equal(request.state.board.length, size);
          assert.ok(request.state.board.every(row => row.length === size));
          assert.deepEqual(request.state.board.flat(), game.board.map(cell => cell || '.'));
          assert.equal(request.state.board_size, size);
          assert.equal(request.state.empty_cell, '.');
          assert.deepEqual(request.state.legal_moves, [`r${size}c${size}`, 'r1c3']);
          assert.equal(request.state.current_player, mark);
          assert.equal(request.state.opponent, mark === 'X' ? 'O' : 'X');
          assert.equal(request.state.objective, `Choose the legal move that gives ${mark} the best chance of winning. A draw is preferable to a loss.`);
          assert.equal(request.state.win_condition, `Get ${size} marks in a row horizontally, vertically, or diagonally.`);
          assert.equal(options.signal, controller.signal);
          return answer(`r${size}c${size}`);
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

test('coordinate responses use the active board width when mapping to engine indices', async () => {
  for (const size of [3, 4, 5]) {
    const game = new TicTacToeGame(size);
    game.play(0);
    const player = new JevPlayer('O', { decide: createJevDecision({
      systemOne: async () => answer('r2c1'),
    }) });
    assert.equal(await player.chooseMove(game), size);
  }
});

test('accepts an engine snapshot and still asks Jev when only one move is supplied', async () => {
  const game = new TicTacToeGame(3);
  const player = new JevPlayer('X', { decide: createJevDecision({
    async systemOne({ questions }) {
      assert.deepEqual(Object.keys(questions.best_move.criteria), ['r1c1']);
      return answer('r1c1');
    },
  }) });
  assert.equal(await player.chooseMove({ ...game.snapshot(), legalMoves: [0] }), 0);
});

test('rejects unknown, occupied, malformed and wrong-type API decisions without fallback', async () => {
  const game = new TicTacToeGame(3);
  game.play(0);
  for (const result of [answer('r1c1'), answer('r3c3'), answer('r1c3junk'), answer('r0c3'),
    answer('r01c3'), answer('R1C3'), answer('cell_2'), answer('2'), answer(2),
    answer('r1c3', 'score'), { answers: { move: { type: 'choice', choice: 'r1c3' } } }, {}, null]) {
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
  await assert.rejects(player.chooseMove({ size: 6, board: Array(36).fill(''), currentPlayer: 'X', legalMoves: [0] }));
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
    assert.equal(request.questions.best_move.type, 'choice');
    assert.deepEqual(Object.keys(request.questions.best_move.criteria), ['r1c1', 'r3c3']);
    return Response.json({ ...answer('r3c3'), model: 'jev-latest', usage: { input_tokens: 10, output_tokens: 1 } });
  });
  const player = new JevPlayer('X', { decide: createJevDecision() });
  assert.equal(await player.chooseMove(new TicTacToeGame(3), [0, 8]), 8);
  assert.equal(calls, 1);
});
