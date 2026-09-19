import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import http from 'node:http';

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

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  let filePath = resolvePublicPath(req.url ?? '/');

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

server.listen(port, '0.0.0.0', () => {
  console.log(`Grid Duel Lab listening on http://0.0.0.0:${port}`);
});
