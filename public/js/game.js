export const EMPTY = '';
export const PLAYERS = Object.freeze({ X: 'X', O: 'O' });

export function otherPlayer(player) {
  return player === PLAYERS.X ? PLAYERS.O : PLAYERS.X;
}

export class TicTacToeGame {
  constructor(size = 3) {
    if (!Number.isInteger(size) || size < 3 || size > 6) {
      throw new RangeError('Board size must be an integer from 3 to 6.');
    }

    this.size = size;
    this.reset();
  }

  reset() {
    this.board = Array(this.size * this.size).fill(EMPTY);
    this.currentPlayer = PLAYERS.X;
    this.winner = null;
    this.winningLine = [];
    this.moveCount = 0;
  }

  clone() {
    const copy = new TicTacToeGame(this.size);
    copy.board = [...this.board];
    copy.currentPlayer = this.currentPlayer;
    copy.winner = this.winner;
    copy.winningLine = [...this.winningLine];
    copy.moveCount = this.moveCount;
    return copy;
  }

  get isDraw() {
    return this.winner === null && this.moveCount === this.board.length;
  }

  get isOver() {
    return this.winner !== null || this.isDraw;
  }

  legalMoves() {
    if (this.isOver) return [];

    const moves = [];
    for (let index = 0; index < this.board.length; index += 1) {
      if (this.board[index] === EMPTY) moves.push(index);
    }
    return moves;
  }

  play(index) {
    if (this.isOver) throw new Error('The game is already over.');
    if (!Number.isInteger(index) || index < 0 || index >= this.board.length) {
      throw new RangeError('Move is outside the board.');
    }
    if (this.board[index] !== EMPTY) throw new Error('Cell is already occupied.');

    const player = this.currentPlayer;
    this.board[index] = player;
    this.moveCount += 1;

    const line = findWinningLine(this.board, this.size, player);
    if (line) {
      this.winner = player;
      this.winningLine = line;
    } else if (!this.isDraw) {
      this.currentPlayer = otherPlayer(player);
    }

    return { player, index, winner: this.winner, draw: this.isDraw };
  }

  snapshot() {
    return {
      size: this.size,
      board: [...this.board],
      currentPlayer: this.currentPlayer,
      winner: this.winner,
      winningLine: [...this.winningLine],
      moveCount: this.moveCount,
      legalMoves: this.legalMoves(),
      isDraw: this.isDraw,
      isOver: this.isOver,
    };
  }
}

export function getLines(size) {
  const lines = [];

  for (let row = 0; row < size; row += 1) {
    lines.push(Array.from({ length: size }, (_, col) => row * size + col));
  }

  for (let col = 0; col < size; col += 1) {
    lines.push(Array.from({ length: size }, (_, row) => row * size + col));
  }

  lines.push(Array.from({ length: size }, (_, i) => i * size + i));
  lines.push(Array.from({ length: size }, (_, i) => i * size + (size - 1 - i)));

  return lines;
}

export function findWinningLine(board, size, player) {
  for (const line of getLines(size)) {
    if (line.every((index) => board[index] === player)) return line;
  }
  return null;
}
