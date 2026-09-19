import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Server } from 'node:http';
import { createAppServer } from '../server.js';
import { TicTacToeGame } from '../public/js/game.js';

async function serve(t, options) {
  return serveServer(t, createAppServer(options));
}

async function serveServer(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return (path, options) => fetch(base + path, options);
}

const post = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('deployment entry point exports an HTTP server without starting a listener', async (t) => {
  const { default: server } = await import('../server.js');
  assert.ok(server instanceof Server, 'the deployment runtime needs a default HTTP server export');
  assert.equal(server.listening, false);
  const request = await serveServer(t, server);
  assert.deepEqual(await (await request('/health')).json(), { status: 'ok' });
  for (const [path, contentType] of [
    ['/', 'text/html'],
    ['/styles.css', 'text/css'],
    ['/js/app.js', 'text/javascript'],
  ]) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').startsWith(contentType));
    assert.ok((await response.text()).length > 0);
  }
  assert.equal((await request('/api/jev/move')).status, 405);
});

test('move endpoint returns only a move, supporting all four sizes', async (t) => {
  let calls = 0;
  const request = await serve(t, { decide: async (state) => {
    calls += 1;
    return state.legalMoves.at(-1);
  } });
  for (const size of [3, 4, 5, 6]) {
    const game = new TicTacToeGame(size);
    const response = await request('/api/jev/move', post(game.snapshot()));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { move: size * size - 1 });
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(calls, 4);
  assert.deepEqual(await (await request('/health')).json(), { status: 'ok' });
  assert.match(await (await request('/')).text(), /computer-o/);
});

test('endpoint rejects bad requests before an API call', async (t) => {
  let calls = 0;
  const request = await serve(t, { decide: async () => { calls += 1; return 0; } });
  assert.equal((await request('/api/jev/move')).status, 405);
  assert.equal((await request('/api/jev/move', { method: 'POST', body: '{}' })).status, 415);
  for (const body of [null, {}, { ...new TicTacToeGame(3).snapshot(), legalMoves: [99] },
    { ...new TicTacToeGame(3).snapshot(), currentPlayer: 'O' }]) {
    assert.equal((await request('/api/jev/move', post(body))).status, 400);
  }
  assert.equal((await request('/api/jev/move', { ...post({}), body: '{' })).status, 400);
  assert.equal((await request('/%E0%A4%A')).status, 400);
  assert.equal(calls, 0);
});

test('endpoint sanitizes upstream failures and refuses illegal moves', async (t) => {
  for (const decide of [async () => { throw new Error('sensitive-upstream-detail'); }, async () => 99]) {
    const request = await serve(t, { decide });
    const response = await request('/api/jev/move', post(new TicTacToeGame(3).snapshot()));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'Jev could not choose a legal move. Please retry.' });
  }
});

test('missing key leaves the site and classic play available', async (t) => {
  const original = process.env.TYPESAFE_AI_API_KEY;
  delete process.env.TYPESAFE_AI_API_KEY;
  t.after(() => {
    if (original !== undefined) process.env.TYPESAFE_AI_API_KEY = original;
  });
  const request = await serve(t);
  assert.equal((await request('/health')).status, 200);
  assert.equal((await request('/')).status, 200);
  const response = await request('/api/jev/move', post(new TicTacToeGame(3).snapshot()));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /TYPESAFE_AI_API_KEY/);
});
