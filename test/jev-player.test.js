import test from 'node:test';
import assert from 'node:assert/strict';
import { TicTacToeGame } from '../public/js/game.js';
import { JevPlayer } from '../public/js/players.js';
import { buildJevRequest, createJevClient, createJevDecision } from '../lib/jev.js';

function evaluation(probabilities = [0, 1, 0, 0]) {
  return { type: 'score', score: probabilities.reduce((sum, value, level) => sum + value * level, 0),
    probabilities: Object.fromEntries(probabilities.map((value, level) => [level, value])), confidence: 1 };
}

function answer(request, preferred) {
  return { answers: Object.fromEntries(Object.keys(request.questions).map((label) =>
    [label, evaluation(label === preferred ? [0, 0, 0, 1] : [0, 1, 0, 0])])) };
}

function screenshotGame() {
  const game = new TicTacToeGame(3);
  for (const move of [1, 0, 3, 2, 4, 5, 6]) game.play(move);
  return game;
}

test('the screenshot request exposes both successor boards and their full lines without choosing for Jev', () => {
  const game = screenshotGame();
  const before = game.snapshot();
  const request = buildJevRequest(game);
  assert.deepEqual(request.state.board, [['O', 'X', 'O'], ['X', 'X', 'O'], ['X', '.', '.']]);
  assert.deepEqual(request.state.legal_moves, ['r3c2', 'r3c3']);
  assert.deepEqual(Object.keys(request.questions), ['r3c2', 'r3c3']);
  const win = request.questions.r3c3;
  assert.equal(win.type, 'score');
  assert.deepEqual(win.instructions.board_after_move, [['O', 'X', 'O'], ['X', 'X', 'O'], ['X', '.', 'O']]);
  assert.deepEqual(win.instructions.lines_after_move, {
    rows: ['O X O', 'X X O', 'X . O'],
    columns: ['O X X', 'X X .', 'O O O'],
    main_diagonals: ['O X O', 'O X X'],
  });
  assert.match(win.instructions.evaluation_order[0], /game ends immediately/);
  assert.match(win.instructions.question, /after playing r3c3/);
  assert.equal(win.criteria.length, 4);
  assert.match(win.criteria[0], /O will lose/);
  assert.match(win.criteria[3], /O has already won/);
  assert.deepEqual(request.questions.r3c2.instructions.board_after_move[2], ['X', 'O', '.']);
  assert.deepEqual(game.snapshot(), before);
});

test('Jev scores exactly the supplied moves for every board size and mark', async () => {
  for (const size of [3, 4, 5]) {
    for (const mark of ['X', 'O']) {
      const game = new TicTacToeGame(size);
      if (mark === 'O') game.play(0);
      const before = game.snapshot();
      const legal = [size * size - 1, 2];
      const labels = [`r${size}c${size}`, 'r1c3'];
      const controller = new AbortController();
      let calls = 0;
      const decide = createJevDecision({
        async systemOne(request, options) {
          calls += 1;
          assert.equal(request.model, 'jev-latest');
          assert.deepEqual(Object.keys(request.questions), labels);
          assert.deepEqual(request.state.board.flat(), game.board.map(cell => cell || '.'));
          assert.equal(request.state.board_size, size);
          assert.equal(request.state.empty_cell, '.');
          assert.deepEqual(request.state.legal_moves, labels);
          assert.equal(request.state.current_player, mark);
          assert.equal(request.state.opponent, mark === 'X' ? 'O' : 'X');
          assert.match(request.state.objective, /Take an immediate win/);
          assert.equal(request.state.win_condition, `Get ${size} marks in a full row, column, or main diagonal.`);
          for (const [i, label] of labels.entries()) {
            const question = request.questions[label];
            assert.equal(question.type, 'score');
            assert.equal(question.instructions.player_being_evaluated, mark);
            assert.equal(question.instructions.next_player_if_game_continues, mark === 'X' ? 'O' : 'X');
            assert.match(question.instructions.question, new RegExp(label));
            assert.ok(question.criteria.every(criterion => criterion.startsWith(mark)));
            const next = [...game.board]; next[legal[i]] = mark;
            assert.deepEqual(question.instructions.board_after_move.flat(), next.map(cell => cell || '.'));
            const lines = question.instructions.lines_after_move;
            assert.equal(lines.rows.length, size);
            assert.equal(lines.columns.length, size);
            assert.equal(lines.main_diagonals.length, 2);
            assert.equal(lines.columns[size - 1].split(' ')[size - 1], i === 0 ? mark : '.');
          }
          assert.equal(options.signal, controller.signal);
          return answer(request, labels[0]);
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

test('short positions include all opponent replies, independent of supplied candidate restrictions', () => {
  const game = new TicTacToeGame(4);
  for (const move of [0, 1, 2, 3, 5, 4, 7, 6]) game.play(move);
  const request = buildJevRequest({ ...game.snapshot(), legalMoves: [8, 9] });
  assert.deepEqual(Object.keys(request.questions), ['r3c1', 'r3c2']);
  const replies = request.questions.r3c1.instructions.reply_lines_if_game_continues;
  assert.deepEqual(Object.keys(replies), ['O_at_r3c2', 'O_at_r3c3', 'O_at_r3c4',
    'O_at_r4c1', 'O_at_r4c2', 'O_at_r4c3', 'O_at_r4c4']);
  assert.deepEqual(replies.O_at_r4c4.rows, ['X O X O', 'O X O X', 'X . . .', '. . . O']);
  assert.deepEqual(replies.O_at_r4c4.columns, ['X O X .', 'O X . .', 'X O . .', 'O X . O']);
  assert.deepEqual(replies.O_at_r4c4.main_diagonals, ['X X . O', 'O O . .']);
  // A tiny candidate subset must not expand hundreds of replies on a mostly empty board.
  const opening = buildJevRequest({ ...new TicTacToeGame(5).snapshot(), legalMoves: [0, 24] });
  assert.ok(Object.values(opening.questions).every(q => !('reply_lines_if_game_continues' in q.instructions)));
});

test('model evaluations alone decide even when a move wins immediately or is the sole option', async () => {
  for (const preferred of ['r3c2', 'r3c3']) {
    let calls = 0;
    const decide = createJevDecision({ systemOne: async (request) => {
      calls += 1;
      return answer(request, preferred);
    } });
    assert.equal(await decide(screenshotGame()), preferred === 'r3c2' ? 7 : 8);
    assert.equal(calls, 1, 'No rule-based win override is permitted');
  }
  let calls = 0;
  const player = new JevPlayer('X', { decide: createJevDecision({ systemOne: async (request) => {
    calls += 1;
    assert.deepEqual(Object.keys(request.questions), ['r1c1']);
    return answer(request, 'r1c1');
  } }) });
  assert.equal(await player.chooseMove({ ...new TicTacToeGame(3).snapshot(), legalMoves: [0] }), 0);
  assert.equal(calls, 1);
});

test('lower model-estimated loss risk takes precedence; higher outcome score breaks equal-risk ties', async () => {
  const game = new TicTacToeGame(3);
  for (const [first, second, expected] of [
    [[0.05, 0.95, 0, 0], [0.1, 0, 0, 0.9], 0],
    [[0.1, 0.9, 0, 0], [0.1, 0, 0.9, 0], 8],
    [[0, 0, 1, 0], [0, 0, 0, 1], 8],
    [[0.3, 0.7, 0, 0], [0.1 + 0.2, 0, 0.7, 0], 8],
    [[0, 1, 0, 0], [0, 1, 0, 0], 0],
  ]) {
    const decide = createJevDecision({ systemOne: async () => ({ answers: {
      r1c1: evaluation(first), r3c3: evaluation(second),
    } }) });
    assert.equal(await new JevPlayer('X', { decide }).chooseMove(game, [0, 8]), expected);
  }
});

test('coordinate scores map to the active board width and observe fresh state on later turns', async () => {
  for (const size of [3, 4, 5]) {
    const game = new TicTacToeGame(size);
    game.play(0);
    const player = new JevPlayer('O', { decide: createJevDecision({
      systemOne: async (request) => {
        assert.deepEqual(request.state.board.flat(), game.board.map(cell => cell || '.'));
        return answer(request, 'r2c1');
      },
    }) });
    assert.equal(await player.chooseMove(game), size);
    game.play(size); game.play(1);
    assert.notEqual(await player.chooseMove(game), size, 'Occupied cells disappear from evaluations');
  }
});

test('rejects missing or malformed model scores without fallback', async () => {
  const game = new TicTacToeGame(3);
  game.play(0);
  for (const bad of [undefined, null, {}, { ...evaluation(), type: 'choice' },
    ...[NaN, Infinity, -1, 4, '1'].map(value => ({ ...evaluation(), score: value })),
    ...[undefined, {}, { 0: 0, 1: 1, 2: 0 }, { 0: 0, 1: 0, 2: 0, 3: 0 },
      { 0: -0.1, 1: 1.1, 2: 0, 3: 0 }, { 0: '0', 1: 1, 2: 0, 3: 0 }]
      .map(value => ({ ...evaluation(), probabilities: value })),
  ]) {
    const decide = createJevDecision({ systemOne: async () => ({ answers: {
      r1c3: evaluation([0, 0, 0, 1]), r2c1: bad,
    } }) });
    await assert.rejects(new JevPlayer('O', { decide }).chooseMove(game, [2, 3]), /invalid move evaluation/);
  }
  for (const result of [undefined, null, {}, { answers: {} }]) {
    const decide = createJevDecision({ systemOne: async () => result });
    await assert.rejects(new JevPlayer('O', { decide }).chooseMove(game, [2, 3]), /invalid move evaluation/);
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

test('aborted decisions never call Jev or accept a late model response', async () => {
  const controller = new AbortController();
  controller.abort();
  const decide = createJevDecision({ systemOne: () => assert.fail('Must not call with an aborted signal') });
  await assert.rejects(decide(screenshotGame(), { signal: controller.signal }), { name: 'AbortError' });
  const late = new AbortController();
  const pending = createJevDecision({ systemOne: async (request) => {
    late.abort(); return answer(request, 'r3c3');
  } });
  await assert.rejects(pending(screenshotGame(), { signal: late.signal }), { name: 'AbortError' });
});

test('client uses TYPESAFE_AI_API_KEY and serializes the official Score HTTP contract', async (t) => {
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
    assert.deepEqual(Object.keys(request.questions), ['r1c1', 'r3c3']);
    assert.equal(request.questions.r3c3.type, 'score');
    assert.equal(request.questions.r3c3.criteria.length, 4);
    assert.equal(request.questions.r3c3.instructions.board_after_move[2][2], 'X');
    return Response.json({ ...answer(request, 'r3c3'), model: 'jev-latest', usage: { input_tokens: 10, output_tokens: 1 } });
  });
  const player = new JevPlayer('X', { decide: createJevDecision() });
  assert.equal(await player.chooseMove(new TicTacToeGame(3), [0, 8]), 8);
  assert.equal(calls, 1);
});
