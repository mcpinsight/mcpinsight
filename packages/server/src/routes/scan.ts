import { NotImplementedError } from '@mcpinsight/core';
import { Hono } from 'hono';

/**
 * `POST /api/scan` — dashboard-driven scan trigger. Day 19 ships a 501 stub
 * (option B in `docs/api-contract.md`): extracting the scan pipeline from
 * the CLI into `@mcpinsight/core` is a > 60-min yak shave per the Day 19
 * STOP condition, and a read-only API is enough for the Day 20 dashboard
 * MVP. Real implementation lands Day 22 polish.
 */
export function scanRoutes(): Hono {
  const r = new Hono();
  r.post('/', (_c) => {
    throw new NotImplementedError(
      'Scan trigger ships Day 22 polish',
      'Run `mcpinsight scan` from the CLI for now.',
    );
  });
  return r;
}
