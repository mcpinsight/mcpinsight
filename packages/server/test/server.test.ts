import {
  asProjectIdentity,
  asSessionId,
  createQueries,
  ingestCalls,
  openDb,
  silentLogger,
  systemClock,
} from '@mcpinsight/core';
import type { Client, McpCall } from '@mcpinsight/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

/**
 * Live HTTP integration: bind on an OS-assigned port, fetch over the loopback,
 * then close. Validates that `serve()` actually wires up Hono's app on a real
 * socket and that `close()` doesn't hang.
 */

const PROJECT = asProjectIdentity('git:test0srv01');
const SESSION = asSessionId('sess-srv-1');

function call(overrides: Partial<McpCall> = {}): McpCall {
  return {
    client: 'claude-code' as Client,
    session_id: SESSION,
    project_identity: PROJECT,
    server_name: 'filesystem',
    tool_name: 'read_file',
    ts: Date.UTC(2026, 3, 15, 12, 0, 0),
    input_tokens: 100,
    output_tokens: 20,
    cache_read_tokens: 0,
    cost_usd: 0,
    cost_is_estimated: 1,
    is_error: false,
    duration_ms: 500,
    ...overrides,
  };
}

describe('startServer', () => {
  let dbHandle: ReturnType<typeof openDb> | null = null;
  let runningClose: (() => Promise<void>) | null = null;

  beforeEach(() => {
    dbHandle = openDb({ path: ':memory:' });
    const queries = createQueries(dbHandle.db);
    ingestCalls(dbHandle.db, queries, [call()]);
  });

  afterEach(async () => {
    if (runningClose) {
      await runningClose();
      runningClose = null;
    }
    dbHandle?.close();
    dbHandle = null;
  });

  it('binds 127.0.0.1, returns the assigned URL, serves a real request', async () => {
    if (!dbHandle) throw new Error('dbHandle missing');
    const queries = createQueries(dbHandle.db);
    const running = await startServer(
      { queries, clock: systemClock, logger: silentLogger },
      { port: 0, host: '127.0.0.1' },
    );
    runningClose = running.close;

    expect(running.host).toBe('127.0.0.1');
    expect(running.port).toBeGreaterThan(0);
    expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const res = await fetch(`${running.url}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; version: string };
    expect(body.ok).toBe(true);
  });

  it('exposes the seeded data via /api/servers', async () => {
    if (!dbHandle) throw new Error('dbHandle missing');
    const queries = createQueries(dbHandle.db);
    const running = await startServer(
      { queries, clock: { now: () => Date.UTC(2026, 3, 16, 0, 0, 0) }, logger: silentLogger },
      { port: 0, host: '127.0.0.1' },
    );
    runningClose = running.close;

    const res = await fetch(`${running.url}/api/servers?days=30`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ server_name: string; calls: number }>;
    expect(rows.length).toBe(1);
    expect(rows[0]?.server_name).toBe('filesystem');
    expect(rows[0]?.calls).toBe(1);
  });

  it('close() resolves and stops accepting connections', async () => {
    if (!dbHandle) throw new Error('dbHandle missing');
    const queries = createQueries(dbHandle.db);
    const running = await startServer(
      { queries, clock: systemClock, logger: silentLogger },
      { port: 0 },
    );
    const url = running.url;
    await running.close();
    runningClose = null;

    await expect(fetch(`${url}/api/health`)).rejects.toThrow();
  });
});
