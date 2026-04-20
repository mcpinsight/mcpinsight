import { NotFoundError } from '@mcpinsight/core';
import { Hono } from 'hono';

import { createErrorHandler } from './middleware/error.js';
import { clientsRoutes } from './routes/clients.js';
import { healthScoreRoutes } from './routes/health-score.js';
import { scanRoutes } from './routes/scan.js';
import { serversRoutes } from './routes/servers.js';
import { systemRoutes } from './routes/system.js';
import type { Deps } from './types.js';

/**
 * Factory returning a fully-wired Hono app. Pure construction — no I/O, no
 * port binding. The CLI's `serve` command (and any test) builds the app
 * once and either passes it to `@hono/node-server.serve` or exercises it
 * directly via `app.request(new Request(...))`.
 */
export function createApp(deps: Deps): Hono {
  const app = new Hono();

  app.onError(createErrorHandler(deps.logger));

  app.route('/api/health', systemRoutes());
  app.route('/api/health', healthScoreRoutes());
  app.route('/api/servers', serversRoutes(deps));
  app.route('/api/clients', clientsRoutes(deps));
  app.route('/api/scan', scanRoutes());

  app.notFound(() => {
    throw new NotFoundError('route not found', 'See docs/api-contract.md for the endpoint list.');
  });

  return app;
}
