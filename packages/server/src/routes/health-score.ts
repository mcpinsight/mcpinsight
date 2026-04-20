import { NotFoundError, computeHealthScore } from '@mcpinsight/core';
import { Hono } from 'hono';

import type { Deps } from '../types.js';
import { parseClient, parsePositiveInt } from './params.js';

/** Health Score window — 30 days per ADR-0004 §Activation. */
const HEALTH_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * `GET /api/health/:name` — returns `ServerHealth` per ADR-0004.
 *
 * - 200 with numeric score when enough user-level data exists
 * - 200 with `{score: null, insufficient_data_reason}` when user-level data is
 *   below the `MIN_DAYS_HISTORY` / `MIN_TOTAL_CALLS` threshold
 * - 404 when the named server has no calls at all in the user's history
 *   (mirrors the `/api/servers/:name` behavior — with the filter relaxed to
 *   "ever" instead of "in window", because zombies must get a score of 0 not
 *   a 404; the existence check uses `server_project_count > 0`)
 *
 * Mounted at `/api/health/:name`. The liveness `GET /api/health` exact match
 * is served by `systemRoutes` (sibling route tree mounted at the same prefix).
 *
 * `days` query param is intentionally NOT exposed — the Health Score
 * algorithm's `calls_30d` component is fixed at 30 days by design, per
 * ADR-0004. Exposing `days` would let clients silently reshape the score.
 */
export function healthScoreRoutes(deps: Deps): Hono {
  const r = new Hono();

  r.get('/:name', (c) => {
    const name = decodeURIComponent(c.req.param('name'));
    const client = parseClient(c.req.query('client'));
    // `days` is not part of the Health Score contract but we still reject
    // garbage input if a client sends it — fails closed rather than silently
    // ignoring.
    const _ignored = parsePositiveInt(c.req.query('days'), 'days', HEALTH_WINDOW_DAYS);
    void _ignored;

    const sinceMs = deps.clock.now() - HEALTH_WINDOW_DAYS * DAY_MS;
    const inputs = deps.queries.healthInputs({ server_name: name, sinceMs, client });

    if (inputs.server_project_count === 0) {
      throw new NotFoundError(
        `no calls recorded for server "${name}"`,
        'Run `mcpinsight scan` to ingest sessions, then retry.',
      );
    }

    const health = computeHealthScore(inputs, deps.clock.now());
    return c.json(health);
  });

  return r;
}
