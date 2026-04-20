import { Hono } from 'hono';

const VERSION = '0.1.0';

/**
 * `GET /api/health` — liveness check. Does NOT touch the DB so it stays
 * useful as a "server is up" probe even when SQLite is locked.
 *
 * Distinct from `/api/health/:name` (Health Score, 501 stub on Day 19).
 */
export function systemRoutes(): Hono {
  const r = new Hono();
  r.get('/', (c) => c.json({ ok: true, version: VERSION }));
  return r;
}
