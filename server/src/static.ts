import { createReadStream, existsSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import type { Context, MiddlewareHandler } from 'hono';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Serve the built SPA with SPA fallback:
 * - exact file (traversal-guarded) wins
 * - anything else (non-API, no file) → index.html
 * - no index.html present (dev mode, Vite serves the UI) → fall through
 */
export function createSpaMiddleware(rootDir: string): MiddlewareHandler {
  const rootAbs = path.resolve(rootDir);
  const indexPath = path.join(rootAbs, 'index.html');

  return async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next();
    if (c.req.path === '/api' || c.req.path.startsWith('/api/')) return next();

    let decoded: string;
    try {
      decoded = decodeURIComponent(c.req.path);
    } catch {
      return next(); // malformed percent-encoding → 404 below
    }
    if (decoded.split('/').some((seg) => seg === '..')) return next(); // traversal → 404 below

    const candidate = path.resolve(rootAbs, `.${decoded}`);
    if (candidate !== rootAbs && candidate.startsWith(`${rootAbs}${path.sep}`) && isFile(candidate)) {
      return sendFile(c, candidate);
    }
    if (existsSync(indexPath)) return sendFile(c, indexPath);
    return next();
  };
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function sendFile(c: Context, filePath: string): Response {
  const size = statSync(filePath).size;
  const type = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  const headers = {
    'Content-Type': type,
    'Content-Length': String(size),
    'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
  };
  if (c.req.method === 'HEAD') {
    return c.body(null, 200, headers);
  }
  const stream = createReadStream(filePath);
  return c.body(Readable.toWeb(stream) as unknown as ReadableStream, 200, headers);
}
