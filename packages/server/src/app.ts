import { NotFoundError } from '@mcpinsight/core';
import { Hono } from 'hono';

import { createErrorHandler } from './middleware/error.js';
import { createStaticSpaMiddleware } from './middleware/static-spa.js';
import { clientsRoutes } from './routes/clients.js';
import { healthScoreRoutes } from './routes/health-score.js';
import { scanRoutes } from './routes/scan.js';
import { serversRoutes } from './routes/servers.js';
import { systemRoutes } from './routes/system.js';
import type { Deps } from './types.js';

export interface CreateAppOptions {
  /**
   * Absolute path to the built `packages/web/dist/` directory. When supplied,
   * the server mounts SPA handlers that serve static assets and fall back to
   * `index.html` for non-`/api/*` routes (so TanStack Router's client-side
   * routes resolve on a browser refresh). When omitted, the server is
   * API-only — the dashboard runs on a separate dev port (e.g. 5173).
   */
  webDistDir?: string;
}

/**
 * Factory returning a fully-wired Hono app. Pure construction — no I/O, no
 * port binding. The CLI's `serve` command (and any test) builds the app
 * once and either passes it to `@hono/node-server.serve` or exercises it
 * directly via `app.request(new Request(...))`.
 *
 * If `options.webDistDir` is set, SPA handlers are registered AFTER the API
 * routes so non-matching `/api/*` paths still reach `notFound` and return the
 * error envelope; only paths outside the API prefix fall through to the
 * static handler.
 */
export function createApp(deps: Deps, options: CreateAppOptions = {}): Hono {
  const app = new Hono();

  app.onError(createErrorHandler(deps.logger));

  app.route('/api/health', systemRoutes());
  app.route('/api/health', healthScoreRoutes());
  app.route('/api/servers', serversRoutes(deps));
  app.route('/api/clients', clientsRoutes(deps));
  app.route('/api/scan', scanRoutes());

  if (options.webDistDir !== undefined) {
    app.use('*', createStaticSpaMiddleware(options.webDistDir, deps.logger));
  }

  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) {
      throw new NotFoundError('route not found', 'See docs/api-contract.md for the endpoint list.');
    }
    throw new NotFoundError('route not found');
  });

  return app;
}
