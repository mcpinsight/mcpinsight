import { describe, expect, it } from 'vitest';

import { ingestCalls } from '../../src/aggregator/ingest.js';
import { openDb } from '../../src/db/connection.js';
import { createQueries } from '../../src/db/queries.js';
import { asProjectIdentity, asSessionId } from '../../src/types/brands.js';
import type { Client, McpCall } from '../../src/types/canonical.js';

const P1 = asProjectIdentity('git:p1000000');
const P2 = asProjectIdentity('git:p2000000');
const P3 = asProjectIdentity('git:p3000000');
const SESSION = asSessionId('sess-1');

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 3, 26);

function call(overrides: Partial<McpCall> = {}): McpCall {
  return {
    client: 'claude-code' as Client,
    session_id: SESSION,
    project_identity: P1,
    server_name: 'filesystem',
    tool_name: 'read_file',
    ts: NOW - 5 * DAY_MS,
    input_tokens: 100,
    output_tokens: 200,
    cache_read_tokens: 0,
    cost_usd: 0,
    cost_is_estimated: 1,
    is_error: false,
    duration_ms: 500,
    ...overrides,
  };
}

function freshDb() {
  const handle = openDb({ path: ':memory:' });
  const queries = createQueries(handle.db);
  return { ...handle, queries };
}

describe('queries.getServerDetail', () => {
  it('returns null summary when no calls match the window', () => {
    const { queries, close } = freshDb();
    try {
      const result = queries.getServerDetail({
        name: 'filesystem',
        sinceMs: NOW - 7 * DAY_MS,
        client: null,
      });
      expect(result.summary).toBeNull();
      expect(result.timeseries).toEqual([]);
      expect(result.tools).toEqual([]);
    } finally {
      close();
    }
  });

  it('returns summary + timeseries + alphabetized tools in one call', () => {
    const { db, queries, close } = freshDb();
    try {
      ingestCalls(db, queries, [
        call({ tool_name: 'read_file', ts: NOW - 5 * DAY_MS }),
        call({ tool_name: 'read_file', ts: NOW - 5 * DAY_MS + 1000 }),
        call({ tool_name: 'write_file', ts: NOW - 3 * DAY_MS, is_error: true }),
        call({ tool_name: 'list_directory', ts: NOW - 1 * DAY_MS }),
      ]);

      const result = queries.getServerDetail({
        name: 'filesystem',
        sinceMs: NOW - 7 * DAY_MS,
        client: null,
      });

      expect(result.summary).not.toBeNull();
      expect(result.summary?.calls).toBe(4);
      expect(result.summary?.errors).toBe(1);
      expect(result.summary?.unique_tools).toBe(3);
      expect(result.timeseries).toHaveLength(3);
      expect(result.timeseries.map((r) => r.day).sort()).toEqual(
        [...result.timeseries.map((r) => r.day)].sort(),
      );
      expect(result.tools).toEqual(['list_directory', 'read_file', 'write_file']);
    } finally {
      close();
    }
  });

  it('respects the client filter', () => {
    const { db, queries, close } = freshDb();
    try {
      ingestCalls(db, queries, [
        call({ tool_name: 'read_file', client: 'claude-code' as Client }),
        call({ tool_name: 'search', client: 'codex' as Client }),
      ]);
      const result = queries.getServerDetail({
        name: 'filesystem',
        sinceMs: NOW - 7 * DAY_MS,
        client: 'codex' as Client,
      });
      expect(result.summary?.calls).toBe(1);
      expect(result.tools).toEqual(['search']);
    } finally {
      close();
    }
  });

  it('excludes self-reference server even if the caller asks by name', () => {
    const { db, queries, close } = freshDb();
    try {
      ingestCalls(db, queries, [call({ server_name: 'mcpinsight', tool_name: 'overview' })]);
      const result = queries.getServerDetail({
        name: 'mcpinsight',
        sinceMs: NOW - 7 * DAY_MS,
        client: null,
      });
      expect(result.summary).toBeNull();
      expect(result.tools).toEqual([]);
    } finally {
      close();
    }
  });
});

describe('queries.healthInputs', () => {
  it('returns zeros/nulls when the DB is empty', () => {
    const { queries, close } = freshDb();
    try {
      const inputs = queries.healthInputs({
        server_name: 'filesystem',
        sinceMs: NOW - 30 * DAY_MS,
        client: null,
      });
      expect(inputs.total_calls_all_servers).toBe(0);
      expect(inputs.earliest_ts_ms).toBeNull();
      expect(inputs.calls_30d).toBe(0);
      expect(inputs.tools_30d).toEqual([]);
      expect(inputs.server_project_count).toBe(0);
      expect(inputs.user_project_count).toBe(0);
    } finally {
      close();
    }
  });

  it('aggregates windowed metrics and full-history project counts', () => {
    const { db, queries, close } = freshDb();
    try {
      ingestCalls(db, queries, [
        call({ ts: NOW - 60 * DAY_MS, project_identity: P1, tool_name: 'read_file' }),
        call({ ts: NOW - 10 * DAY_MS, project_identity: P1, tool_name: 'read_file' }),
        call({
          ts: NOW - 5 * DAY_MS,
          project_identity: P2,
          tool_name: 'write_file',
          output_tokens: 500,
        }),
        call({
          ts: NOW - 2 * DAY_MS,
          project_identity: P3,
          tool_name: 'list_directory',
          is_error: null,
          output_tokens: 200,
        }),
      ]);

      const inputs = queries.healthInputs({
        server_name: 'filesystem',
        sinceMs: NOW - 30 * DAY_MS,
        client: null,
      });

      expect(inputs.total_calls_all_servers).toBe(4);
      expect(inputs.earliest_ts_ms).toBe(NOW - 60 * DAY_MS);
      expect(inputs.calls_30d).toBe(3);
      expect(inputs.errors_30d).toBe(0);
      expect(inputs.scored_calls_30d).toBe(2);
      expect(inputs.output_tokens_30d).toBe(900);
      expect(inputs.tools_30d).toEqual(['list_directory', 'read_file', 'write_file']);
      expect(inputs.server_project_count).toBe(3);
      expect(inputs.user_project_count).toBe(3);
    } finally {
      close();
    }
  });

  it('INV-04: self-reference never contributes to user-level totals', () => {
    const { db, queries, close } = freshDb();
    try {
      ingestCalls(db, queries, [
        call({ server_name: 'mcpinsight', ts: NOW - 5 * DAY_MS }),
        call({ server_name: 'filesystem', ts: NOW - 5 * DAY_MS }),
      ]);
      const inputs = queries.healthInputs({
        server_name: 'filesystem',
        sinceMs: NOW - 30 * DAY_MS,
        client: null,
      });
      expect(inputs.total_calls_all_servers).toBe(1);
      expect(inputs.user_project_count).toBe(1);
    } finally {
      close();
    }
  });

  it('respects the client filter on every sub-query', () => {
    const { db, queries, close } = freshDb();
    try {
      ingestCalls(db, queries, [
        call({ client: 'claude-code' as Client, project_identity: P1 }),
        call({
          client: 'codex' as Client,
          project_identity: P2,
          tool_name: 'search',
        }),
      ]);
      const inputs = queries.healthInputs({
        server_name: 'filesystem',
        sinceMs: NOW - 30 * DAY_MS,
        client: 'codex' as Client,
      });
      expect(inputs.total_calls_all_servers).toBe(1);
      expect(inputs.tools_30d).toEqual(['search']);
      expect(inputs.user_project_count).toBe(1);
    } finally {
      close();
    }
  });
});
