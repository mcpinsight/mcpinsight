import { NotImplementedError } from '@mcpinsight/core';
import { Hono } from 'hono';

/**
 * `GET /api/health/:name` — Health Score. Day 19 ships a 501 stub; Day 21
 * implements the algorithm. The stub exists so the dashboard skeleton
 * (Day 20) can render a placeholder card without a 404 cliff.
 *
 * Mounted at `/api/health/:name`. Liveness `GET /api/health` exact-match is
 * served by `systemRoutes` mounted at `/api/health` — matching '/' wins,
 * '/:name' takes the named segment.
 */
export function healthScoreRoutes(): Hono {
  const r = new Hono();
  r.get('/:name', (_c) => {
    throw new NotImplementedError(
      'Health Score ships Day 21',
      'Tracked in .claude/tasks/phase-multi-client-ui.md',
    );
  });
  return r;
}
