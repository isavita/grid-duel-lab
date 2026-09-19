import { choice, TypeSafeClient } from '@typesafe-ai/sdk';
import { jevState } from '../public/js/jev-player.js';
import { otherPlayer } from '../public/js/game.js';

export function createJevClient() {
  const apiKey = process.env.TYPESAFE_AI_API_KEY;
  if (!apiKey?.trim()) throw new Error('Set TYPESAFE_AI_API_KEY on the server to use Jev.');
  return new TypeSafeClient({
    apiKey,
    baseURL: 'https://api.typesafe.ai',
    timeout: 15_000,
    retry: { maxRetries: 0 },
    logLevel: 'off',
  });
}

function coordinate(move, size) {
  return `r${Math.floor(move / size) + 1}c${move % size + 1}`;
}

// Keep the model-facing format and wording in one place, separate from engine indices.
// This pure builder can be inspected or tuned without making an API call.
export function buildJevRequest(snapshot) {
  const { size, board, currentPlayer, legalMoves } = jevState(snapshot);
  const criteria = Object.fromEntries(legalMoves.map((move) => [
    coordinate(move, size),
    `Place ${currentPlayer} at row ${Math.floor(move / size) + 1}, column ${move % size + 1}`,
  ]));
  return {
    model: 'jev-latest',
    state: {
      game: 'tic-tac-toe',
      board_size: size,
      win_condition: `Get ${size} marks in a row horizontally, vertically, or diagonally.`,
      current_player: currentPlayer,
      opponent: otherPlayer(currentPlayer),
      empty_cell: '.',
      board: Array.from({ length: size }, (_, row) =>
        board.slice(row * size, (row + 1) * size).map((mark) => mark || '.')),
      legal_moves: legalMoves.map((move) => coordinate(move, size)),
      coordinate_system: 'Rows and columns are numbered starting from 1. r1c3 means row 1, column 3.',
      objective: `The most important goal for ${currentPlayer} is not to lose. Prevent the opponent from winning and prefer a draw over risking a loss. Winning is the second priority: among moves that are equally safe from defeat, choose the one with the best chance of winning.`,
    },
    questions: {
      best_move: choice(`Which legal move should ${currentPlayer} make to avoid losing first and pursue a win second?`, criteria),
    },
  };
}

export function createJevDecision(client = createJevClient()) {
  return async (snapshot, { signal } = {}) => {
    const state = jevState(snapshot);
    const allowed = new Map(state.legalMoves.map((move) => [coordinate(move, state.size), move]));
    const result = await client.systemOne(buildJevRequest(state), { signal });
    const answer = result?.answers?.best_move;
    // Map only exact, supplied coordinates back to engine indices, including index 0.
    const move = allowed.get(answer?.choice);
    if (answer?.type !== 'choice' || move === undefined) {
      throw new Error('Jev returned a move outside the supplied legal moves.');
    }
    return move;
  };
}
