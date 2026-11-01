// Lokal utvecklingsserver utan beroenden: serverar public/ och kör api/*.js som Vercel gör.
// Start: npm run dev  ->  http://localhost:3000
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

// Läs .env.local / .env om de finns
for (const f of ['.env.local', '.env']) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.png': 'image/png', '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname.startsWith('/api/')) {
      const file = path.join(root, `${pathname.replace(/\/$/, '')}.js`);
      if (!file.startsWith(path.join(root, 'api')) || !fs.existsSync(file)) {
        res.statusCode = 404;
        return res.end('Not found');
      }
      const mod = await import(pathToFileURL(file).href + `?t=${Date.now()}`);
      return await mod.default(req, res);
    }
    let file = path.join(root, 'public', pathname === '/' ? 'index.html' : pathname);
    if (!file.startsWith(path.join(root, 'public')) || !fs.existsSync(file)) {
      res.statusCode = 404;
      return res.end('Not found');
    }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.end(String(err));
  }
}).listen(PORT, () => console.log(`Rinkside körs på http://localhost:${PORT}`));
