import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createAppServer } from '../server.js';

// Offline integration checks. Only --live opts into real TypeSafe calls.
const live = process.argv.includes('--live');
let behavior = 'normal';
let heldRequest;
let aborted = false;
const server = createAppServer(live ? {} : { decide: async (state, { signal }) => {
  if (behavior === 'fail') throw new Error('Simulated upstream failure');
  if (behavior === 'illegal') return 999;
  if (behavior === 'hold') {
    return new Promise((resolve, reject) => {
      heldRequest = { state, resolve };
      signal.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('Cancelled'));
      }, { once: true });
    });
  }
  return state.legalMoves[0];
} });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const browser = await chromium.launch();
const errors = [];
await mkdir('output/browser', { recursive: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  // Explicit failure cases below produce expected HTTP 502 messages.
  if (message.type() === 'error' && !message.text().includes('502 (Bad Gateway)')) errors.push(message.text());
});
const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const waitFor = (predicate) => page.waitForFunction(predicate, null, { timeout: 30_000 });
const waitForHeld = async () => {
  for (let i = 0; i < 500; i += 1) {
    if (heldRequest) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for a pending Jev request.');
};

try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  assert.deepEqual(await page.locator('input[name="board-size"]').evaluateAll(inputs => inputs.map(input => input.value)), ['3', '4', '5']);
  // Native radio controls retain their standard arrow-key behavior.
  await page.locator('input[name="board-size"]:checked').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal((await state()).size, 4);
  await page.keyboard.press('ArrowLeft');
  assert.equal((await state()).size, 3);
  await page.locator('#game-options summary').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#game-options').getAttribute('open'), null);
  await page.click('[data-opponent="jev"]');
  for (const size of [3, 4, 5]) {
    await page.locator(`input[name="board-size"][value="${size}"]`).check();
    await page.click('[data-index="0"]');
    await waitFor(() => JSON.parse(window.render_game_to_text()).moveCount === 2);
    const snapshot = await state();
    assert.equal(snapshot.board.filter(Boolean).length, 2);
    assert.equal(snapshot.players.O, 'jev');
    assert.equal(snapshot.error, '');
    await page.screenshot({ path: `output/browser/${live ? 'live' : 'offline'}-${size}x${size}.png`, fullPage: true });
  }

  await page.locator(`input[name="board-size"][value="3"]`).check();
  await page.locator('#game-options summary').click();
  await page.selectOption('#human-mark', 'O');
  await waitFor(() => JSON.parse(window.render_game_to_text()).moveCount === 1);
  assert.equal((await state()).players.X, 'jev');

  await page.selectOption('#mode', 'cpu-vs-cpu');
  await page.selectOption('#computer-x', 'jev');
  await page.selectOption('#computer-o', 'classic');
  await page.selectOption('#speed', '100');
  await page.click('#new-game');
  const scoreBefore = (await state()).score;
  await waitFor(() => JSON.parse(window.render_game_to_text()).isOver);
  const finished = await state();
  assert.equal(Object.values(finished.score).reduce((a, b) => a + b), Object.values(scoreBefore).reduce((a, b) => a + b) + 1);
  assert.equal(await page.locator('.cell:not(:disabled)').count(), 0);
  await page.screenshot({ path: `output/browser/${live ? 'live' : 'offline'}-match.png`, fullPage: true });

  if (!live) {
    // Pause cancels the active request; resume starts just one replacement turn.
    behavior = 'hold';
    await page.click('#new-game');
    await waitForHeld();
    await page.click('#pause');
    await page.waitForTimeout(100);
    assert.equal(aborted, true);
    assert.equal((await state()).moveCount, 0);
    assert.equal((await state()).paused, true);
    behavior = 'normal';
    await page.click('#pause');
    await waitFor(() => JSON.parse(window.render_game_to_text()).isOver);
    assert.equal((await state()).error, '');

    // Restart/board changes must not apply a result from an old request.
    behavior = 'hold';
    heldRequest = null;
    aborted = false;
    await page.click('#new-game');
    await waitForHeld();
    const oldRequest = heldRequest;
    await page.selectOption('#mode', 'human-vs-cpu');
    await page.selectOption('#human-mark', 'X');
    await page.locator(`input[name="board-size"][value="5"]`).check();
    oldRequest.resolve(oldRequest.state.legalMoves[0]);
    await page.waitForTimeout(300);
    assert.equal(aborted, true);
    assert.equal((await state()).moveCount, 0);
    assert.equal((await state()).size, 5);

    // Errors retain the board, expose retry, and never play a fallback move.
    await page.locator(`input[name="board-size"][value="3"]`).check();
    await page.click('[data-opponent="jev"]');
    for (const failure of ['fail', 'illegal']) {
      behavior = failure;
      await page.click('#new-game');
      await page.click('[data-index="0"]');
      await waitFor(() => Boolean(JSON.parse(window.render_game_to_text()).error));
      assert.equal((await state()).moveCount, 1);
      assert.equal(await page.locator('#retry').isVisible(), true);
      behavior = 'normal';
      await page.click('#retry');
      await waitFor(() => JSON.parse(window.render_game_to_text()).moveCount === 2);
      assert.equal((await state()).error, '');
    }

    // Existing classic self-play still draws.
    await page.selectOption('#mode', 'cpu-vs-cpu');
    await page.selectOption('#computer-x', 'classic');
    await page.selectOption('#computer-o', 'classic');
    await page.click('#new-game');
    await waitFor(() => JSON.parse(window.render_game_to_text()).isOver);
    assert.equal((await state()).isDraw, true);
  }

  await page.setViewportSize({ width: 375, height: 812 });
  await page.selectOption('#mode', 'human-vs-cpu');
  await page.selectOption('#human-mark', 'X');
  await page.click('[data-opponent="jev"]');
  await page.locator(`input[name="board-size"][value="5"]`).check();
  await page.locator('#game-options summary').click();
  await page.click('[data-index="0"]');
  await waitFor(() => JSON.parse(window.render_game_to_text()).moveCount === 2);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator('.cell').count(), 25);
  assert.equal(await page.locator('#computer-x-wrap').isVisible(), false);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `output/browser/${live ? 'live' : 'offline'}-mobile-5x5.png`, fullPage: true });
  assert.deepEqual(errors, []);
  console.log(`${live ? 'Live' : 'Offline'} browser checks passed: all sizes, both marks, autoplay${live ? '' : ', cancellation, retry, classic regression'}, mobile layout; no unexpected console errors.`);
} finally {
  await browser.close();
  await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
}
