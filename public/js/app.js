import { PLAYERS, TicTacToeGame } from './game.js';
import { ClassicComputerPlayer, JevPlayer } from './players.js';

const els = {
  board: document.querySelector('#board'),
  status: document.querySelector('#status'),
  boardSize: document.querySelector('#board-size'),
  mode: document.querySelector('#mode'),
  humanMark: document.querySelector('#human-mark'),
  humanMarkWrap: document.querySelector('#human-mark-wrap'),
  speed: document.querySelector('#speed'),
  speedWrap: document.querySelector('#speed-wrap'),
  computerX: document.querySelector('#computer-x'),
  computerO: document.querySelector('#computer-o'),
  opponentPicker: document.querySelector('#opponent-picker'),
  watchSetup: document.querySelector('#watch-setup'),
  opponentButtons: document.querySelectorAll('[data-opponent]'),
  newGame: document.querySelector('#new-game'),
  pause: document.querySelector('#pause'),
  retry: document.querySelector('#retry'),
  error: document.querySelector('#error'),
  scoreX: document.querySelector('#score-x'),
  scoreO: document.querySelector('#score-o'),
  scoreDraw: document.querySelector('#score-draw'),
  scoreXLabel: document.querySelector('#score-x-label'),
  scoreOLabel: document.querySelector('#score-o-label'),
  rules: document.querySelector('#rules'),
};

let game;
let players;
let runningToken = 0;
let paused = false;
let score = { X: 0, O: 0, draw: 0 };
let resultRecorded = false;
let pendingMove = null;
let moveError = '';
let opponent = 'classic';

function isComputer(mark) {
  return players[mark] !== null;
}

function makeComputer(mark) {
  const selection = mark === PLAYERS.X ? els.computerX : els.computerO;
  const kind = els.mode.value === 'cpu-vs-cpu' ? selection.value : opponent;
  return kind === 'jev' ? new JevPlayer(mark) : new ClassicComputerPlayer(mark);
}

function buildPlayers() {
  const mode = els.mode.value;
  if (mode === 'cpu-vs-cpu') {
    return {
      X: makeComputer(PLAYERS.X),
      O: makeComputer(PLAYERS.O),
    };
  }

  const humanMark = els.humanMark.value;
  const computerMark = humanMark === PLAYERS.X ? PLAYERS.O : PLAYERS.X;
  return {
    [humanMark]: null,
    [computerMark]: makeComputer(computerMark),
  };
}

function startGame() {
  pendingMove?.abort();
  runningToken += 1;
  paused = false;
  moveError = '';
  resultRecorded = false;
  els.pause.textContent = 'Pause';

  const size = Number(els.boardSize.value);
  game = new TicTacToeGame(size);
  players = buildPlayers();
  render();
  continueGame(runningToken);
}

function render() {
  const snapshot = game.snapshot();
  els.board.style.setProperty('--board-size', String(snapshot.size));
  els.board.replaceChildren();

  snapshot.board.forEach((mark, index) => {
    const cell = document.createElement('button');
    cell.className = 'cell';
    cell.type = 'button';
    cell.dataset.index = String(index);
    if (mark) cell.appendChild(createMark(mark));
    cell.setAttribute('aria-label', cellLabel(index, mark, snapshot.size));

    if (mark) cell.classList.add(`cell--${mark.toLowerCase()}`);
    if (snapshot.winningLine.includes(index)) cell.classList.add('cell--winner');

    const humanTurn = !snapshot.isOver && !isComputer(snapshot.currentPlayer);
    cell.disabled = mark !== '' || !humanTurn || paused;
    cell.addEventListener('click', onCellClick);
    els.board.appendChild(cell);
  });

  updateStatus();
  updateControls();
  updateScore();
}

function createMark(mark) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', 'mark');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const shape = document.createElementNS(ns, mark === PLAYERS.X ? 'path' : 'circle');
  if (mark === PLAYERS.X) {
    shape.setAttribute('d', 'M18 18L82 82M82 18L18 82');
  } else {
    shape.setAttribute('cx', '50');
    shape.setAttribute('cy', '50');
    shape.setAttribute('r', '34');
  }
  shape.setAttribute('fill', 'none');
  shape.setAttribute('stroke', 'currentColor');
  shape.setAttribute('stroke-width', '10');
  shape.setAttribute('stroke-linecap', 'round');
  svg.appendChild(shape);
  return svg;
}

function playerName(mark) {
  return !isComputer(mark) ? 'You' : players[mark] instanceof JevPlayer ? 'Jev' : 'Classic';
}

function cellLabel(index, mark, size) {
  const row = Math.floor(index / size) + 1;
  const col = (index % size) + 1;
  return mark ? `Row ${row}, column ${col}, ${mark}` : `Row ${row}, column ${col}, empty`;
}

function updateStatus() {
  if (game.winner) {
    const name = playerName(game.winner);
    els.status.textContent = `${name} ${name === 'You' ? 'win' : 'wins'} · ${game.winner}`;
    recordResult(game.winner);
    return;
  }

  if (game.isDraw) {
    els.status.textContent = 'Draw';
    recordResult('draw');
    return;
  }

  const role = playerName(game.currentPlayer);
  els.status.textContent = paused ? `Paused · ${game.currentPlayer}`
    : role === 'You' ? `Your turn · ${game.currentPlayer}`
    : `${role} to move · ${game.currentPlayer}`;
}

function recordResult(result) {
  if (resultRecorded) return;
  resultRecorded = true;
  score[result] += 1;
}

function updateScore() {
  els.scoreX.textContent = String(score.X);
  els.scoreO.textContent = String(score.O);
  els.scoreDraw.textContent = String(score.draw);
  els.scoreXLabel.textContent = `${playerName(PLAYERS.X)} · X`;
  els.scoreOLabel.textContent = `${playerName(PLAYERS.O)} · O`;
}

function updateControls() {
  const cpuVsCpu = els.mode.value === 'cpu-vs-cpu';
  els.humanMarkWrap.hidden = cpuVsCpu;
  els.speedWrap.hidden = !cpuVsCpu;
  els.pause.hidden = !cpuVsCpu || game.isOver;
  els.pause.disabled = game?.isOver ?? true;
  els.opponentPicker.hidden = cpuVsCpu;
  els.watchSetup.hidden = !cpuVsCpu;
  els.opponentButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.opponent === opponent));
  });
  els.rules.textContent = `Get ${game.size} in a row, column, or diagonal.`;
  els.error.hidden = !moveError;
  els.error.textContent = moveError;
  els.retry.hidden = !moveError;
  els.retry.disabled = paused;
}

async function onCellClick(event) {
  if (game.isOver || paused || isComputer(game.currentPlayer)) return;

  const index = Number(event.currentTarget.dataset.index);
  game.play(index);
  render();
  await continueGame(runningToken);
}

async function continueGame(token) {
  while (!game.isOver && !paused && !moveError && isComputer(game.currentPlayer) && token === runningToken) {
    render();
    await delay(currentDelay());
    if (paused || token !== runningToken || game.isOver) return;

    const player = players[game.currentPlayer];
    const controller = new AbortController();
    pendingMove = controller;
    try {
      const move = await player.chooseMove(game.clone(), game.legalMoves(), { signal: controller.signal });
      if (token !== runningToken || paused) return;
      game.play(move);
      render();
    } catch (error) {
      if (token !== runningToken || controller.signal.aborted) return;
      moveError = error.message || 'Computer could not choose a move. Please retry.';
      render();
      return;
    } finally {
      if (pendingMove === controller) pendingMove = null;
    }
  }
}

function currentDelay() {
  if (els.mode.value !== 'cpu-vs-cpu') return 220;
  return Number(els.speed.value);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

els.newGame.addEventListener('click', startGame);
els.boardSize.addEventListener('change', startGame);
els.mode.addEventListener('change', startGame);
els.humanMark.addEventListener('change', startGame);
els.computerX.addEventListener('change', startGame);
els.computerO.addEventListener('change', startGame);
els.opponentButtons.forEach((button) => button.addEventListener('click', () => {
  if (opponent === button.dataset.opponent) return;
  opponent = button.dataset.opponent;
  startGame();
}));
els.speed.addEventListener('change', () => {});
els.pause.addEventListener('click', async () => {
  pendingMove?.abort();
  paused = !paused;
  runningToken += 1;
  els.pause.textContent = paused ? 'Resume' : 'Pause';
  render();

  if (!paused) {
    await continueGame(runningToken);
  }
});

els.retry.addEventListener('click', () => {
  moveError = '';
  render();
  continueGame(++runningToken);
});

window.render_game_to_text = () => JSON.stringify({
  ...game.snapshot(),
  mode: els.mode.value,
  players: Object.fromEntries(Object.entries(players).map(([mark, player]) => [mark,
    player === null ? 'human' : player instanceof JevPlayer ? 'jev' : 'classic',
  ])),
  paused,
  error: moveError,
  score,
  coordinates: 'Zero-based row-major indices from the top-left corner.',
});

startGame();
