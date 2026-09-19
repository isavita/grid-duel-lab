import { score, TypeSafeClient } from '@typesafe-ai/sdk';
import { jevState } from '../public/js/jev-player.js';
import { otherPlayer } from '../public/js/game.js';

// Bound the prompt while showing every possible reply in shorter positions.
const MAX_REPLY_CONTEXT_EMPTY_CELLS = 8;

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

function rows(board, size) {
  return Array.from({ length: size }, (_, row) =>
    board.slice(row * size, (row + 1) * size).map((mark) => mark || '.'));
}

// Expose geometry, not tactical judgments: Jev evaluates every line itself.
function boardLines(board, size) {
  const marks = (indices) => indices.map((index) => board[index] || '.').join(' ');
  return {
    rows: Array.from({ length: size }, (_, r) => marks(Array.from({ length: size }, (_, c) => r * size + c))),
    columns: Array.from({ length: size }, (_, c) => marks(Array.from({ length: size }, (_, r) => r * size + c))),
    main_diagonals: [
      marks(Array.from({ length: size }, (_, i) => i * size + i)),
      marks(Array.from({ length: size }, (_, i) => i * size + size - 1 - i)),
    ],
  };
}

// Pure inspection hook. Every legal move is evaluated by Jev, even a forced move.
export function buildJevRequest(snapshot) {
  const { size, board, currentPlayer, legalMoves } = jevState(snapshot);
  const opponent = otherPlayer(currentPlayer);
  const showReplies = board.filter((mark) => !mark).length <= MAX_REPLY_CONTEXT_EMPTY_CELLS;
  const criteria = [
    `${currentPlayer} will lose: ${opponent} can force a win from this resulting board even if ${currentPlayer} defends optimally.`,
    `${currentPlayer} can secure a draw against optimal ${opponent} play, but cannot force a win.`,
    `${currentPlayer} can force a win on a future turn against optimal ${opponent} play, but has not already won.`,
    `${currentPlayer} has already won on this resulting board: a full row, column, or main diagonal consists entirely of ${currentPlayer}.`,
  ];
  return {
    model: 'jev-latest',
    state: {
      game: 'tic-tac-toe',
      board_size: size,
      win_condition: `Get ${size} marks in a full row, column, or main diagonal.`,
      current_player: currentPlayer,
      opponent,
      empty_cell: '.',
      board: rows(board, size),
      legal_moves: legalMoves.map((move) => coordinate(move, size)),
      coordinate_system: 'Rows and columns start at 1 at the top-left. r1c3 means row 1, column 3.',
      objective: 'Take an immediate win: winning ends the game and prevents any loss. Otherwise avoid defeat, prefer a draw to a loss, and pursue a forced win over a draw. Consider the opponent\'s best reply, not a cooperative opponent.',
    },
    questions: Object.fromEntries(legalMoves.map((move) => {
      const label = coordinate(move, size);
      const nextBoard = [...board];
      nextBoard[move] = currentPlayer;
      const replyLines = showReplies ? Object.fromEntries(nextBoard.flatMap((mark, reply) => {
        if (mark) return [];
        const afterReply = [...nextBoard];
        afterReply[reply] = opponent;
        return [[`${opponent}_at_${coordinate(reply, size)}`, boardLines(afterReply, size)]];
      })) : undefined;
      return [label, score({
        question: `Evaluate the outcome for ${currentPlayer} after playing ${label}. Evaluate the resulting board below, not the original board.`,
        player_being_evaluated: currentPlayer,
        board_after_move: rows(nextBoard, size),
        lines_after_move: boardLines(nextBoard, size),
        next_player_if_game_continues: opponent,
        evaluation_order: [
          `First check whether any resulting row, column, or main diagonal contains ${size} ${currentPlayer} marks. If so, ${currentPlayer} has already won. The game ends immediately; ${opponent} cannot reply. Blocking a threat is unnecessary after winning.`,
          `Otherwise consider every legal ${opponent} reply. If ${opponent} can complete a winning line on its next turn, this candidate loses, even if ${currentPlayer} also threatens a later win.`,
          showReplies
            ? 'Inspect the supplied opponent reply lines only if the candidate has not already won. After each opponent reply, it is your turn. First check whether you can win immediately. Otherwise, if the opponent threatens wins at two different empty cells, you can block only one and will lose. Two lines sharing the same winning empty cell are only one threat. If any opponent reply forces defeat, evaluate this candidate as a loss regardless of its other replies.'
            : `Otherwise look ahead through ${opponent}'s strongest reply and ${currentPlayer}'s best response, including forks (two separate winning threats). A threat that ${opponent} can block is not a forced win.`,
          `Prefer a guaranteed draw to a possible loss. A forced win is better than a draw, and winning immediately is best.`,
        ],
        ...(showReplies ? { reply_lines_if_game_continues: replyLines } : {}),
      }, criteria)];
    })),
  };
}

function readEvaluation(answer) {
  const probabilities = answer?.probabilities;
  const values = [0, 1, 2, 3].map((level) => probabilities?.[level]);
  if (answer?.type !== 'score' || !Number.isFinite(answer.score)
    || answer.score < 0 || answer.score > 3
    || values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
    || Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) > 0.020001) {
    throw new Error('Jev returned an invalid move evaluation. Please retry.');
  }
  // SDK normalization can introduce floating-point noise in otherwise equal risks.
  return { lossRisk: Math.round(values[0] * 1e12) / 1e12, score: answer.score };
}

export function createJevDecision(client = createJevClient()) {
  return async (snapshot, { signal } = {}) => {
    signal?.throwIfAborted();
    const state = jevState(snapshot);
    const result = await client.systemOne(buildJevRequest(state), { signal });
    signal?.throwIfAborted();
    // Validate every requested evaluation before ranking; never fill missing scores.
    const evaluated = state.legalMoves.map((move) => ({
      move,
      ...readEvaluation(result?.answers?.[coordinate(move, state.size)]),
    }));
    // Preserve the user's priority: lower estimated loss risk first; win potential second.
    evaluated.sort((a, b) => a.lossRisk - b.lossRisk || b.score - a.score);
    return evaluated[0].move;
  };
}
