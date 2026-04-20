import { NotFoundError } from '@mcpinsight/core';
import type { TopServerRow } from '@mcpinsight/core';
import { Hono } from 'hono';

import type { Deps } from '../types.js';
import { parseClient, parsePositiveInt } from './params.js';

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 7;
const DEFAULT_LIMIT = 20;

/**
 * `GET /api/servers` — top-N roll-up. `GET /api/servers/:name` — per-server
 * detail: summary + daily timeseries + distinct tool list, all filtered to the
 * same (days, client) window. The detail path fans out via a single
 * `queries.getServerDetail` call (retired the Day 19 `DETAIL_SCAN_CAP`
 * clientside filter in favor of a purpose-built query).
 */
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
    const detail = deps.queries.getServerDetail({ name, sinceMs, client });
    if (detail.summary === null) {
      throw new NotFoundError(
        `no calls recorded for server "${name}" in the last ${days} day(s)`,
        'Try a wider days window, or run `mcpinsight scan`.',
      );
    }
    return c.json({
      server_name: name,
      summary: detail.summary,
      timeseries: detail.timeseries,
      tools: detail.tools,
    });
  });

  return r;
}
