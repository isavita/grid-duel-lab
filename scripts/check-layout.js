import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createAppServer } from '../server.js';

// Deterministic moves exercise every rendered turn without making API calls.
const server = createAppServer({ decide: async (state) => state.legalMoves[0] });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const browser = await chromium.launch();
await mkdir('output/layout', { recursive: true });
const errors = [];
let checkedStates = 0;
try {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
    { width: 390, height: 844 },
    { width: 1280, height: 900 },
  ]) {
    const page = await browser.newPage({ viewport });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    assert.equal(await page.locator('#game-options').getAttribute('open'), null);
    assert.equal(await page.locator('[data-opponent="classic"]').getAttribute('aria-pressed'), 'true');
    const initialLayout = await page.evaluate(() => ({
      bottom: document.querySelector('#rules').getBoundingClientRect().bottom,
      overflow: document.documentElement.scrollWidth > innerWidth,
      buttons: [...document.querySelectorAll('[data-opponent]')].map((button) => button.getBoundingClientRect().height),
    }));
    assert.equal(initialLayout.overflow, false);
    assert.ok(initialLayout.bottom <= viewport.height, `Default game should fit ${viewport.width}×${viewport.height}: ${initialLayout.bottom}`);
    assert.ok(initialLayout.buttons.every((height) => height >= 44));
    await page.screenshot({ path: `output/layout/${viewport.width}-initial.png`, fullPage: true });

    await page.locator('#game-options summary').click();
    await page.selectOption('#mode', 'cpu-vs-cpu');
    await page.selectOption('#computer-x', 'jev');
    await page.selectOption('#computer-o', 'jev');
    await page.selectOption('#speed', '100');
    await page.locator('#game-options summary').click();
    for (const size of [3, 4, 5, 6]) {
      await page.selectOption('#board-size', String(size));
      await page.evaluate(() => {
        window.layoutObserver?.disconnect();
        window.layoutFrames = [];
        const capture = () => {
          const board = document.querySelector('#board');
          const r = board.getBoundingClientRect();
          window.layoutFrames.push({
            moves: JSON.parse(window.render_game_to_text()).moveCount,
            board: { x: r.x, y: r.y, w: r.width, h: r.height },
            cells: [...board.children].map((cell) => {
              const c = cell.getBoundingClientRect();
              return { x: c.x, y: c.y, w: c.width, h: c.height };
            }),
            overflow: document.documentElement.scrollWidth > innerWidth,
          });
        };
        capture();
        window.layoutObserver = new MutationObserver(capture);
        window.layoutObserver.observe(document.querySelector('#board'), { childList: true });
      });
      await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).isOver);
      const frames = await page.evaluate(() => window.layoutFrames);
      const baseline = frames[0];
      const finalState = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
      assert.equal(new Set(frames.map((frame) => frame.moves)).size, finalState.moveCount + 1);
      for (const frame of frames) {
        assert.equal(frame.overflow, false);
        assert.ok(Math.abs(frame.board.w - frame.board.h) < 1, 'Board must be square');
        assert.equal(frame.cells.length, size * size);
        frame.cells.forEach((cell, index) => {
          assert.ok(Math.abs(cell.w - cell.h) < 1, 'Each cell must be square');
          assert.ok(cell.w >= 44, 'Even 6×6 cells need usable touch targets');
          for (const dimension of ['x', 'y', 'w', 'h']) {
            assert.ok(Math.abs(cell[dimension] - baseline.cells[index][dimension]) < 1,
              `${viewport.width}px ${size}×${size}, move ${frame.moves}: cell ${index} ${dimension} shifted`);
          }
        });
        checkedStates += 1;
      }
      await page.screenshot({ path: `output/layout/${viewport.width}-${size}x${size}-finished.png`, fullPage: true });
    }
    // A real human turn remains stable, with the simplified opponent picker.
    await page.locator('#game-options summary').click();
    await page.selectOption('#mode', 'human-vs-cpu');
    await page.locator('#game-options summary').click();
    await page.click('[data-opponent="jev"]');
    await page.selectOption('#board-size', '3');
    await page.click('[data-index="0"]');
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).moveCount === 2);
    await page.click('[data-opponent="jev"]');
    assert.equal(await page.evaluate(() => JSON.parse(window.render_game_to_text()).moveCount), 2,
      'Re-selecting the current opponent must not reset the board');
    assert.match(await page.locator('[data-index="0"]').getAttribute('aria-label'), /X/);
    assert.equal(await page.locator('.mark').count(), 2);
    await page.screenshot({ path: `output/layout/${viewport.width}-playing.png`, fullPage: true });
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(`Layout checks passed: ${checkedStates} rendered states, 3×3–6×6, four viewports (320–1280px); square cells with no position/size changes, no horizontal overflow, default mobile game fits the screen.`);
} finally {
  await browser.close();
  await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
}
