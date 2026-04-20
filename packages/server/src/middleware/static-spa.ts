import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

import type { Logger } from '@mcpinsight/core';
import type { MiddlewareHandler } from 'hono';

/**
 * Serves the built `packages/web/dist/` as an SPA alongside the API.
 *
 * Decision rationale (Day 20 carry-forward vs. `@hono/node-server/serve-static`):
 *   - The helper ships with a `root`-relative-to-cwd quirk; `mcpinsight
 *     serve` is launched from arbitrary working dirs, so an absolute root
 *     must be respected.
 *   - We also need an SPA fallback (non-`.ext` GETs serve `index.html`) that
 *     the library does not expose directly.
 *   - Reading a handful of static files by hand is ~40 lines, no yak-shave.
 *
 * Path-safety: the requested path is normalized and joined to the dist root;
 * if the resolved absolute path escapes the root (traversal via `..`), the
 * handler falls through to `next()` — let the 404 envelope fire.
 */
export function createStaticSpaMiddleware(webDistDir: string, logger: Logger): MiddlewareHandler {
  const root = resolve(webDistDir);

  return async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      await next();
      return;
    }
    if (c.req.path.startsWith('/api/')) {
      await next();
      return;
    }

    const requested = decodeURIComponent(c.req.path);
    const hasExtension = extname(requested) !== '';

    const targetRelative = hasExtension ? normalize(`.${requested}`) : 'index.html';
    const targetAbsolute = resolve(join(root, targetRelative));

    if (!targetAbsolute.startsWith(`${root}/`) && targetAbsolute !== root) {
      await next();
      return;
    }

    try {
      const body = await readFile(targetAbsolute);
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': contentTypeFor(targetAbsolute),
          'cache-control': hasExtension ? 'public, max-age=31536000, immutable' : 'no-cache',
        },
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EISDIR') {
        if (hasExtension) {
          await next();
          return;
        }
        logger.warn('static_spa.index_missing', { path: targetAbsolute });
        await next();
        return;
      }
      throw err;
    }
  };
}

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

function contentTypeFor(absPath: string): string {
  const ext = extname(absPath).toLowerCase();
  return MIME[ext] ?? 'application/octet-stream';
}
