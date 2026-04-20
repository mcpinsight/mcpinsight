import {
  asProjectIdentity,
  asSessionId,
  createQueries,
  ingestCalls,
  openDb,
  silentLogger,
} from '@mcpinsight/core';
import type { Client, Logger, McpCall, Queries } from '@mcpinsight/core';

import { createApp } from '../src/app.js';
import type { Deps } from '../src/types.js';

/**
 * Shared test scaffolding for the server package. Builds an in-memory SQLite,
 * ingests the supplied seed calls, and returns a wired Hono app with a
 * frozen clock so route handlers see a deterministic `now()`.
 *
 * Keep this file lean — anything that grows past a single concept should
 * move into a dedicated test util module.
 */

export const TEST_PROJECT = asProjectIdentity('git:test0000abc');
export const TEST_SESSION = asSessionId('sess-test-1');

export function call(overrides: Partial<McpCall> = {}): McpCall {
  return {
    client: 'claude-code' as Client,
    session_id: TEST_SESSION,
    project_identity: TEST_PROJECT,
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

export interface TestHarness {
  app: ReturnType<typeof createApp>;
  queries: Queries;
  logger: Logger;
  close: () => void;
}

export interface SetupOptions {
  seed?: ReadonlyArray<McpCall>;
  nowMs?: number;
  logger?: Logger;
}

export const FIXED_NOW = Date.UTC(2026, 3, 16, 0, 0, 0); // 2026-04-16 00:00 UTC

export function setup(options: SetupOptions = {}): TestHarness {
  const handle = openDb({ path: ':memory:' });
  const queries = createQueries(handle.db);
  if (options.seed && options.seed.length > 0) {
    ingestCalls(handle.db, queries, options.seed);
  }
  const logger = options.logger ?? silentLogger;
  const deps: Deps = {
    queries,
    clock: { now: () => options.nowMs ?? FIXED_NOW },
    logger,
  };
  const app = createApp(deps);
  return {
    app,
    queries,
    logger,
    close: handle.close,
  };
}
