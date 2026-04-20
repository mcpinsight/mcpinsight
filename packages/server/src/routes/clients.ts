import type { ClientListRow } from '@mcpinsight/core';
import { Hono } from 'hono';

import type { Deps } from '../types.js';
import { parsePositiveInt } from './params.js';

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT = 20;

/**
 * `GET /api/clients` — per-client breakdown. Defaults to a 30-day window
 * (broader than `/api/servers`'s 7) because client adoption is a slower
 * signal than per-server activity.
 *
 * INV-04 self-reference exclusion lives inside `Queries.listClients`; the
 * route never re-implements it.
 */
export function clientsRoutes(deps: Deps): Hono {
  const r = new Hono();

  r.get('/', (c) => {
    const days = parsePositiveInt(c.req.query('days'), 'days', DEFAULT_DAYS);
    const limit = parsePositiveInt(c.req.query('limit'), 'limit', DEFAULT_LIMIT);
    const sinceMs = deps.clock.now() - days * DAY_MS;
    const rows: ClientListRow[] = deps.queries.listClients({ sinceMs }).slice(0, limit);
    return c.json(rows);
  });

  return r;
}
