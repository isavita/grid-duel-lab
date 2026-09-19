import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, TicTacToeGame } from '../public/js/game.js';
import { ClassicComputerPlayer } from '../public/js/players.js';

test('supports every board size from 3 to 6', () => {
  for (const size of [3, 4, 5, 6]) {
    const game = new TicTacToeGame(size);
    assert.equal(game.board.length, size * size);
    assert.equal(game.legalMoves().length, size * size);
  }
});

test('detects row, column and diagonal wins', () => {
  const row = new TicTacToeGame(3);
  row.play(0); row.play(3); row.play(1); row.play(4); row.play(2);
  assert.equal(row.winner, PLAYERS.X);

  const col = new TicTacToeGame(3);
  col.play(0); col.play(1); col.play(3); col.play(2); col.play(6);
  assert.equal(col.winner, PLAYERS.X);

  const diagonal = new TicTacToeGame(3);
  diagonal.play(0); diagonal.play(1); diagonal.play(4); diagonal.play(2); diagonal.play(8);
  assert.equal(diagonal.winner, PLAYERS.X);
});

test('classic 3x3 computer takes an immediate win', async () => {
  const game = new TicTacToeGame(3);
  game.play(0); // X
  game.play(3); // O
  game.play(1); // X
  game.play(4); // O

  const ai = new ClassicComputerPlayer(PLAYERS.X);
  const move = await ai.chooseMove(game);
  assert.equal(move, 2);
});

test('classic 3x3 computer blocks a forced immediate loss', async () => {
  const game = new TicTacToeGame(3);
  game.play(0); // X
  game.play(4); // O
  game.play(1); // X

  const ai = new ClassicComputerPlayer(PLAYERS.O);
  const move = await ai.chooseMove(game);
  assert.equal(move, 2);
});


test('perfect 3x3 computer self-play always draws', async () => {
  const game = new TicTacToeGame(3);
  const players = {
    X: new ClassicComputerPlayer(PLAYERS.X),
    O: new ClassicComputerPlayer(PLAYERS.O),
  };

  while (!game.isOver) {
    const move = await players[game.currentPlayer].chooseMove(game.clone());
    game.play(move);
  }

  assert.equal(game.winner, null);
  assert.equal(game.isDraw, true);
});

test('large-board AI always returns a legal move', async () => {
  for (const size of [4, 5, 6]) {
    const game = new TicTacToeGame(size);
    const ai = new ClassicComputerPlayer(PLAYERS.X);
    const move = await ai.chooseMove(game);
    assert.ok(game.legalMoves().includes(move), `${size}x${size}: ${move} should be legal`);
  }
});

test('large-board AI takes immediate winning move', async () => {
  const game = new TicTacToeGame(4);
  game.board = [
    'X', 'X', 'X', '',
    'O', 'O', '', '',
    '',  '',  '', '',
    '',  '',  '', 'O',
  ];
  game.currentPlayer = 'X';
  game.moveCount = 6;

  const ai = new ClassicComputerPlayer(PLAYERS.X);
  const move = await ai.chooseMove(game);
  assert.equal(move, 3);
});
