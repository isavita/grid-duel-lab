import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import http from 'node:http';
import { JevPlayer, jevState } from './public/js/jev-player.js';
import { createJevDecision } from './lib/jev.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, 'public');
const port = Number(process.env.PORT ?? 3000);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function resolvePublicPath(urlPath) {
  const requested = decodeURIComponent(urlPath.split('?')[0]);
  const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
  const safe = normalize(relative).replace(/^(\.\.(\/|\\|$))+/, '');
  return join(publicDir, safe);
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let body = '';
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 8192) throw new Error('Request too large.');
    body += chunk.toString();
  }
  return JSON.parse(body);
}

export function createAppServer({ decide } = {}) {
  // Lazy initialization keeps classic play and /health available without a Jev key.
  let jevDecision = decide;
  return http.createServer(async (req, res) => {
    if (req.url === '/health') {
      json(res, 200, { status: 'ok' });
      return;
    }

    if (req.url?.split('?')[0] === '/api/jev/move') {
      if (req.method !== 'POST') {
        res.setHeader('allow', 'POST');
        json(res, 405, { error: 'Use POST for Jev moves.' });
        return;
      }
      if (!req.headers['content-type']?.startsWith('application/json')) {
        json(res, 415, { error: 'Send a JSON board state.' });
        return;
      }
      let state;
      try {
        state = jevState(await readJson(req));
      } catch {
        json(res, 400, { error: 'Invalid board state or legal moves.' });
        return;
      }
      if (!jevDecision) {
        try {
          jevDecision = createJevDecision();
        } catch {
          json(res, 503, { error: 'Set TYPESAFE_AI_API_KEY on the server to use Jev.' });
          return;
        }
      }
      const controller = new AbortController();
      const onClose = () => controller.abort();
      res.on('close', onClose);
      try {
        const player = new JevPlayer(state.currentPlayer, { decide: jevDecision });
        const move = await player.chooseMove(state, state.legalMoves, { signal: controller.signal });
        if (!res.destroyed) json(res, 200, { move });
      } catch {
        // Do not expose upstream errors, request headers or credentials to the browser.
        if (!res.destroyed) json(res, 502, { error: 'Jev could not choose a legal move. Please retry.' });
      } finally {
        res.off('close', onClose);
      }
      return;
    }

    let filePath;
    try {
      filePath = resolvePublicPath(req.url ?? '/');
    } catch {
      json(res, 400, { error: 'Invalid URL.' });
      return;
    }

    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      filePath = join(publicDir, 'index.html');
    }

    const contentType = contentTypes[extname(filePath)] ?? 'application/octet-stream';
    res.writeHead(200, {
      'content-type': contentType,
      'cache-control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
    });
    createReadStream(filePath).pipe(res);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createAppServer().listen(port, '0.0.0.0', () => {
    console.log(`Grid Duel Lab listening on http://0.0.0.0:${port}`);
  });
}
