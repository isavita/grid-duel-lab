import { EMPTY, PLAYERS, findWinningLine } from './game.js';

// The browser uses our server; headless matches inject the server-side decision function.
// Neither this module nor anything else under public/ receives an API key.
export class JevPlayer {
  constructor(mark, { decide = requestJevMove } = {}) {
    if (![PLAYERS.X, PLAYERS.O].includes(mark)) throw new Error('Invalid player mark.');
    this.mark = mark;
    this.decide = decide;
  }

  async chooseMove(game, legalMoves, { signal } = {}) {
    if (game.currentPlayer !== this.mark) throw new Error(`It is not ${this.mark}'s turn.`);
    const state = jevState(game, legalMoves);
    // Retain a private copy of the allowed set across the asynchronous request.
    const allowed = [...state.legalMoves];
    const move = await this.decide(state, { signal });
    if (!Number.isInteger(move) || !allowed.includes(move)) {
      throw new Error('Jev returned a move outside the supplied legal moves.');
    }
    return move;
  }
}

export function jevState(game, suppliedMoves) {
  const { size, board, currentPlayer } = game;
  if (!Number.isInteger(size) || size < 3 || size > 6
    || !Array.isArray(board) || board.length !== size * size
    || !board.every((cell) => [EMPTY, PLAYERS.X, PLAYERS.O].includes(cell))) {
    throw new Error('Invalid board state.');
  }
  if (game.isOver || !board.includes(EMPTY)
    || findWinningLine(board, size, PLAYERS.X) || findWinningLine(board, size, PLAYERS.O)) {
    throw new Error('Cannot choose a move for a finished game.');
  }
  const xCount = board.filter((cell) => cell === PLAYERS.X).length;
  const oCount = board.filter((cell) => cell === PLAYERS.O).length;
  if ((xCount !== oCount && xCount !== oCount + 1)
    || currentPlayer !== (xCount === oCount ? PLAYERS.X : PLAYERS.O)) {
    throw new Error('Invalid player turn.');
  }
  const moves = suppliedMoves ?? (typeof game.legalMoves === 'function'
    ? game.legalMoves() : game.legalMoves);
  if (!Array.isArray(moves) || moves.length === 0
    || new Set(moves).size !== moves.length
    || !moves.every((move) => Number.isInteger(move) && move >= 0
      && move < board.length && board[move] === EMPTY)) {
    throw new Error('Supply a nonempty list of distinct legal moves.');
  }
  return { size, board: [...board], currentPlayer, legalMoves: [...moves] };
}

async function requestJevMove(state, { signal } = {}) {
  const response = await fetch('/api/jev/move', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(state),
    signal,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Jev is unavailable. Please retry.');
  return body.move;
}
