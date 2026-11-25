import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json', '.webmanifest': 'application/manifest+json',
};

/** Resolve a URL path inside `root`; null if it would escape (traversal, NUL, absolute-path tricks, Windows drive letters). */
export function safeResolve(root: string, urlPath: string): string | null {
  let rel: string;
  try { rel = decodeURIComponent(urlPath); } catch { return null; }
  if (rel.includes('\0')) return null;
  rel = rel.replace(/^[/\\]+/, '');
  if (/^[a-zA-Z]:/.test(rel) || rel.split(/[/\\]/).includes('..')) return null;
  const abs = path.resolve(root, rel);
  const back = path.relative(root, abs);
  if (back.startsWith('..') || path.isAbsolute(back)) return null;
  return abs;
}

/** Serve files under `root` for the URL path below `prefix`. Returns false if the request is not for this mount. */
export function serveStatic(root: string, prefix: string, req: IncomingMessage, res: ServerResponse, urlPath: string): boolean {
  if (urlPath !== prefix.slice(0, -1) && !urlPath.startsWith(prefix)) return false;
  if (urlPath === prefix.slice(0, -1)) { res.writeHead(301, { location: prefix + (req.url?.includes('?') ? '?' + req.url.split('?')[1] : '') }); res.end(); return true; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return true; }
  let abs = safeResolve(root, urlPath.slice(prefix.length));
  if (!abs) { res.writeHead(400); res.end('Bad path'); return true; }
  try { if (fs.statSync(abs).isDirectory()) abs = path.join(abs, 'index.html'); } catch { /* fallthrough to 404 */ }
  let st: fs.Stats;
  try { st = fs.statSync(abs); if (!st.isFile()) throw new Error('not a file'); } catch { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return true; }
  const ext = path.extname(abs).toLowerCase();
  const html = ext === '.html';
  const headers: Record<string, string | number> = {
    'content-type': MIME[ext] ?? 'application/octet-stream', 'content-length': st.size,
    'cache-control': html ? 'no-cache' : 'public, max-age=3600', 'last-modified': st.mtime.toUTCString(),
  };
  if (req.headers['if-modified-since'] && new Date(req.headers['if-modified-since']).getTime() >= Math.floor(st.mtimeMs / 1000) * 1000 && !html) { res.writeHead(304); res.end(); return true; }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(abs).on('error', () => res.destroy()).pipe(res);
  return true;
}
