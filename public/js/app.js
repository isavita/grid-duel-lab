import { PLAYERS, TicTacToeGame } from './game.js';
import { ClassicComputerPlayer } from './players.js';

const els = {
  board: document.querySelector('#board'),
  status: document.querySelector('#status'),
  boardSize: document.querySelector('#board-size'),
  mode: document.querySelector('#mode'),
  humanMark: document.querySelector('#human-mark'),
  humanMarkWrap: document.querySelector('#human-mark-wrap'),
  speed: document.querySelector('#speed'),
  speedWrap: document.querySelector('#speed-wrap'),
  newGame: document.querySelector('#new-game'),
  pause: document.querySelector('#pause'),
  scoreX: document.querySelector('#score-x'),
  scoreO: document.querySelector('#score-o'),
  scoreDraw: document.querySelector('#score-draw'),
};

let game;
let players;
let runningToken = 0;
let paused = false;
let score = { X: 0, O: 0, draw: 0 };
let resultRecorded = false;

function isComputer(mark) {
  return players[mark] instanceof ClassicComputerPlayer;
}

function buildPlayers() {
  const mode = els.mode.value;
  if (mode === 'cpu-vs-cpu') {
    return {
      X: new ClassicComputerPlayer(PLAYERS.X),
      O: new ClassicComputerPlayer(PLAYERS.O),
    };
  }

  const humanMark = els.humanMark.value;
  const computerMark = humanMark === PLAYERS.X ? PLAYERS.O : PLAYERS.X;
  return {
    [humanMark]: null,
    [computerMark]: new ClassicComputerPlayer(computerMark),
  };
}

function startGame() {
  runningToken += 1;
  paused = false;
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
    cell.textContent = mark;
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

function cellLabel(index, mark, size) {
  const row = Math.floor(index / size) + 1;
  const col = (index % size) + 1;
  return mark ? `Row ${row}, column ${col}, ${mark}` : `Row ${row}, column ${col}, empty`;
}

function updateStatus() {
  if (game.winner) {
    els.status.textContent = `${game.winner} wins`;
    recordResult(game.winner);
    return;
  }

  if (game.isDraw) {
    els.status.textContent = 'Draw';
    recordResult('draw');
    return;
  }

  const role = isComputer(game.currentPlayer) ? 'Computer' : 'You';
  els.status.textContent = `${game.currentPlayer} · ${role} to move`;
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
}

function updateControls() {
  const cpuVsCpu = els.mode.value === 'cpu-vs-cpu';
  els.humanMarkWrap.hidden = cpuVsCpu;
  els.speedWrap.hidden = !cpuVsCpu;
  els.pause.hidden = !cpuVsCpu;
  els.pause.disabled = game?.isOver ?? true;
}

async function onCellClick(event) {
  if (game.isOver || paused || isComputer(game.currentPlayer)) return;

  const index = Number(event.currentTarget.dataset.index);
  game.play(index);
  render();
  await continueGame(runningToken);
}

async function continueGame(token) {
  while (!game.isOver && !paused && isComputer(game.currentPlayer) && token === runningToken) {
    render();
    await delay(currentDelay());
    if (paused || token !== runningToken || game.isOver) return;

    const player = players[game.currentPlayer];
    const move = await player.chooseMove(game.clone());
    if (token !== runningToken || paused) return;

    game.play(move);
    render();
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
els.speed.addEventListener('change', () => {});
els.pause.addEventListener('click', async () => {
  paused = !paused;
  runningToken += 1;
  els.pause.textContent = paused ? 'Resume' : 'Pause';
  render();

  if (!paused) {
    await continueGame(runningToken);
  }
});

startGame();
