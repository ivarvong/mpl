// Static server for the interactive demo in tools/live (run `npm run dev`; needs `npm run live:build` first).
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const ROOT = fileURLToPath(new URL('../tools/live/', import.meta.url));
const PORT = Number(process.env['PORT'] ?? 8080);
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  try {
    // normalize() rewrites '/' to '\' on Windows, so test with the platform separator too.
    const file = join(ROOT, rel.endsWith(sep) ? rel + 'index.html' : rel);
    if (!file.startsWith(ROOT)) throw new Error('outside root');
    // Read before writing headers: a missing file must reach the 404 branch, not throw after 200.
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => console.log(`mpl live demo: http://localhost:${PORT}/`));
