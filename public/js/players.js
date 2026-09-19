import { EMPTY, PLAYERS, getLines, otherPlayer } from './game.js';

export { JevPlayer } from './jev-player.js';

const WIN_SCORE = 1_000_000;

export class ClassicComputerPlayer {
  constructor(mark) {
    if (![PLAYERS.X, PLAYERS.O].includes(mark)) throw new Error('Invalid player mark.');
    this.mark = mark;
  }

  async chooseMove(game) {
    if (game.currentPlayer !== this.mark) throw new Error(`It is not ${this.mark}'s turn.`);
    if (game.isOver) throw new Error('Cannot choose a move for a finished game.');

    return game.size === 3
      ? choosePerfect3x3Move(game, this.mark)
      : chooseLargeBoardMove(game, this.mark);
  }
}

export function choosePerfect3x3Move(game, player) {
  const board = [...game.board];
  const moves = orderedMoves(board, 3);

  let bestMove = moves[0];
  let bestScore = -Infinity;

  for (const move of moves) {
    board[move] = player;
    const score = minimax3x3(board, otherPlayer(player), player, 1, -Infinity, Infinity);
    board[move] = EMPTY;

    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  return bestMove;
}

function minimax3x3(board, turn, rootPlayer, depth, alpha, beta) {
  const terminal = terminalScore(board, 3, rootPlayer, depth);
  if (terminal !== null) return terminal;

  const maximizing = turn === rootPlayer;
  let best = maximizing ? -Infinity : Infinity;

  for (const move of orderedMoves(board, 3)) {
    board[move] = turn;
    const score = minimax3x3(board, otherPlayer(turn), rootPlayer, depth + 1, alpha, beta);
    board[move] = EMPTY;

    if (maximizing) {
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, score);
      beta = Math.min(beta, best);
    }

    if (beta <= alpha) break;
  }

  return best;
}

function chooseLargeBoardMove(game, player) {
  const size = game.size;
  const board = [...game.board];
  const opponent = otherPlayer(player);
  const legal = legalMoves(board);

  const winningMove = findImmediateMove(board, size, player, legal);
  if (winningMove !== null) return winningMove;

  const blockingMove = findImmediateMove(board, size, opponent, legal);
  if (blockingMove !== null) return blockingMove;

  const depth = size === 4 ? 4 : size === 5 ? 3 : 3;
  const maxCandidates = size === 4 ? 12 : size === 5 ? 10 : 9;
  const moves = orderedMoves(board, size, maxCandidates, player);

  let bestMove = moves[0];
  let bestScore = -Infinity;

  for (const move of moves) {
    board[move] = player;
    const score = alphaBeta(
      board,
      size,
      opponent,
      player,
      depth - 1,
      -Infinity,
      Infinity,
      maxCandidates,
    );
    board[move] = EMPTY;

    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  return bestMove;
}

function alphaBeta(board, size, turn, rootPlayer, depth, alpha, beta, maxCandidates) {
  const terminal = terminalScore(board, size, rootPlayer, 0);
  if (terminal !== null) return terminal;
  if (depth === 0) return evaluateBoard(board, size, rootPlayer);

  const maximizing = turn === rootPlayer;
  let best = maximizing ? -Infinity : Infinity;
  const moves = orderedMoves(board, size, maxCandidates, turn);

  for (const move of moves) {
    board[move] = turn;
    const score = alphaBeta(
      board,
      size,
      otherPlayer(turn),
      rootPlayer,
      depth - 1,
      alpha,
      beta,
      maxCandidates,
    );
    board[move] = EMPTY;

    if (maximizing) {
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, score);
      beta = Math.min(beta, best);
    }

    if (beta <= alpha) break;
  }

  return best;
}

function terminalScore(board, size, rootPlayer, depth) {
  const opponent = otherPlayer(rootPlayer);
  if (hasWon(board, size, rootPlayer)) return WIN_SCORE - depth;
  if (hasWon(board, size, opponent)) return -WIN_SCORE + depth;
  if (!board.includes(EMPTY)) return 0;
  return null;
}

function hasWon(board, size, player) {
  return getLines(size).some((line) => line.every((index) => board[index] === player));
}

function findImmediateMove(board, size, player, moves) {
  for (const move of moves) {
    board[move] = player;
    const wins = hasWon(board, size, player);
    board[move] = EMPTY;
    if (wins) return move;
  }
  return null;
}

function evaluateBoard(board, size, player) {
  const opponent = otherPlayer(player);
  let score = 0;

  for (const line of getLines(size)) {
    let own = 0;
    let theirs = 0;

    for (const index of line) {
      if (board[index] === player) own += 1;
      else if (board[index] === opponent) theirs += 1;
    }

    if (own > 0 && theirs > 0) continue;
    if (own > 0) score += lineValue(own, size);
    if (theirs > 0) score -= lineValue(theirs, size) * 1.08;
  }

  score += positionalScore(board, size, player);
  score -= positionalScore(board, size, opponent);
  return score;
}

function lineValue(count, size) {
  if (count === size) return WIN_SCORE;
  if (count === size - 1) return 20_000;
  if (count === size - 2) return 900;
  return 6 ** count;
}

function positionalScore(board, size, player) {
  const center = (size - 1) / 2;
  let score = 0;

  for (let index = 0; index < board.length; index += 1) {
    if (board[index] !== player) continue;
    const row = Math.floor(index / size);
    const col = index % size;
    const distance = Math.abs(row - center) + Math.abs(col - center);
    score += Math.max(0, size - distance);
  }

  return score;
}

function legalMoves(board) {
  const moves = [];
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] === EMPTY) moves.push(index);
  }
  return moves;
}

function orderedMoves(board, size, limit = Infinity, player = null) {
  const center = (size - 1) / 2;
  const moves = legalMoves(board);

  return moves
    .map((index) => {
      const row = Math.floor(index / size);
      const col = index % size;
      const distance = Math.abs(row - center) + Math.abs(col - center);
      let tactical = 0;

      if (player) {
        board[index] = player;
        tactical += evaluateBoard(board, size, player) * 0.001;
        board[index] = EMPTY;
      }

      return { index, score: -distance + tactical };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ index }) => index);
}
