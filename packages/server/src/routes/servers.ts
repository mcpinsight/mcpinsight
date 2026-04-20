import { NotFoundError } from '@mcpinsight/core';
import type { TopServerRow } from '@mcpinsight/core';
import { Hono } from 'hono';

import type { Deps } from '../types.js';
import { parseClient, parsePositiveInt } from './params.js';

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 7;
const DEFAULT_LIMIT = 20;

/**
 * Day 19 thin shim: per-server detail uses `topServers` with a generous limit
 * and filters clientside, since `Queries.topServers` doesn't accept a
 * server_name filter today and `/:name` is low-traffic (single-server view).
 *
 * Day 21 (Health Score) introduces `Queries.getServerDetail(name, sinceMs)`
 * that returns `{summary, timeseries, tools}` in one shot — at which point
 * this scan cap is removed.
 */
const DETAIL_SCAN_CAP = 10_000;

export function serversRoutes(deps: Deps): Hono {
  const r = new Hono();

  r.get('/', (c) => {
    const days = parsePositiveInt(c.req.query('days'), 'days', DEFAULT_DAYS);
    const client = parseClient(c.req.query('client'));
    const limit = parsePositiveInt(c.req.query('limit'), 'limit', DEFAULT_LIMIT);
    const sinceMs = deps.clock.now() - days * DAY_MS;
    const rows: TopServerRow[] = deps.queries.topServers({ sinceMs, client, limit });
    return c.json(rows);
  });

  r.get('/:name', (c) => {
    const name = decodeURIComponent(c.req.param('name'));
    const days = parsePositiveInt(c.req.query('days'), 'days', DEFAULT_DAYS);
    const client = parseClient(c.req.query('client'));
    const sinceMs = deps.clock.now() - days * DAY_MS;
    const all = deps.queries.topServers({ sinceMs, client, limit: DETAIL_SCAN_CAP });
    const summary = all.find((row) => row.server_name === name);
    if (summary === undefined) {
      throw new NotFoundError(
        `no calls recorded for server "${name}" in the last ${days} day(s)`,
        'Try a wider days window, or run `mcpinsight scan`.',
      );
    }
    return c.json({ server_name: name, summary, timeseries: [] });
  });

  return r;
}
