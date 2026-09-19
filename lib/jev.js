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

export function createJevDecision(client = createJevClient()) {
  return async (snapshot, { signal } = {}) => {
    const state = jevState(snapshot);
    const criteria = Object.fromEntries(state.legalMoves.map((move) => [
      `cell_${move}`,
      `Place ${state.currentPlayer} at row ${Math.floor(move / state.size) + 1}, column ${(move % state.size) + 1} (index ${move}).`,
    ]));
    const result = await client.systemOne({
      model: 'jev-latest',
      state: {
        ...state,
        opponent: otherPlayer(state.currentPlayer),
        coordinates: 'Flat board, row-major, zero-based indices. Empty cells are empty strings.',
        rows: Array.from({ length: state.size }, (_, row) => state.board.slice(row * state.size, (row + 1) * state.size)),
        rules: `Players alternate placing one mark. Win by filling an entire row, column, or either main diagonal with ${state.size} of your marks. A full board without a winner is a draw.`,
      },
      questions: {
        move: choice(
          `Choose the best legal move for ${state.currentPlayer}. Win now if possible; otherwise prevent an immediate opponent win, create winning threats and avoid losing. Choose exactly one supplied cell.`,
          criteria,
        ),
      },
    }, { signal });
    const answer = result?.answers?.move;
    // Map exact option labels back to the original integers; never parse arbitrary text.
    const move = state.legalMoves.find((candidate) => `cell_${candidate}` === answer?.choice);
    if (answer?.type !== 'choice' || move === undefined) {
      throw new Error('Jev returned a move outside the supplied legal moves.');
    }
    return move;
  };
}
