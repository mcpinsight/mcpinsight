import { describe, expect, it } from 'vitest';

import { SELF_REFERENCE_SERVERS, ingestCalls } from '../../src/aggregator/ingest.js';
import { openDb } from '../../src/db/connection.js';
import { createQueries } from '../../src/db/queries.js';
import { asProjectIdentity, asSessionId } from '../../src/types/brands.js';
import type { Client, McpCall } from '../../src/types/canonical.js';

const PROJECT = asProjectIdentity('git:abcdef012345');
const SESSION = asSessionId('sess-1');

function call(overrides: Partial<McpCall> = {}): McpCall {
  return {
    client: 'claude-code' as Client,
    session_id: SESSION,
    project_identity: PROJECT,
    server_name: 'filesystem',
    tool_name: 'read_file',
    ts: Date.UTC(2026, 3, 10, 12, 0, 0), // 2026-04-10 12:00 UTC
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

function freshDb() {
  const handle = openDb({ path: ':memory:' });
  const queries = createQueries(handle.db);
  return { ...handle, queries };
}

describe('ingestCalls', () => {
  it('inserts every McpCall into mcp_calls (no-op for empty batch)', () => {
    const { db, queries, close } = freshDb();
    try {
      const empty = ingestCalls(db, queries, []);
      expect(empty).toEqual({
        inserted: 0,
        selfReferenceExcluded: 0,
        dailyAggregatesAffected: 0,
      });

      const stats = ingestCalls(db, queries, [call(), call({ tool_name: 'write_file' })]);
      expect(stats.inserted).toBe(2);
      const rowCount = db.prepare('SELECT COUNT(*) AS n FROM mcp_calls').get() as { n: number };
      expect(rowCount.n).toBe(2);
    } finally {
      close();
    }
  });

  it('preserves is_error boolean round-trip through the 0/1/null SQLite encoding', () => {
    const { db, queries, close } = freshDb();
    try {
      ingestCalls(db, queries, [
        call({ tool_name: 't-true', is_error: true }),
        call({ tool_name: 't-false', is_error: false }),
        call({ tool_name: 't-null', is_error: null }),
      ]);
      const rows = db
        .prepare('SELECT tool_name, is_error FROM mcp_calls ORDER BY tool_name')
        .all() as { tool_name: string; is_error: number | null }[];
      expect(rows).toEqual([
        { tool_name: 't-false', is_error: 0 },
        { tool_name: 't-null', is_error: null },
        { tool_name: 't-true', is_error: 1 },
      ]);
    } finally {
      close();
    }
  });

  it('rolls up server_stats_daily per (day, client, server, project)', () => {
    const { db, queries, close } = freshDb();
    try {
      ingestCalls(db, queries, [
        call({ tool_name: 'read_file', input_tokens: 10, output_tokens: 2 }),
        call({ tool_name: 'write_file', input_tokens: 5, output_tokens: 1, is_error: true }),
        call({ tool_name: 'read_file', input_tokens: 7, output_tokens: 3 }), // dup tool, same day
      ]);

      const daily = db.prepare('SELECT * FROM server_stats_daily').all() as Array<
        Record<string, unknown>
      >;
      expect(daily).toHaveLength(1);
      expect(daily[0]).toMatchObject({
        day: '2026-04-10',
        client: 'claude-code',
        server_name: 'filesystem',
        project_identity: PROJECT,
        calls: 3,
        errors: 1,
        unique_tools: 2, // read_file and write_file
        input_tokens: 22,
        output_tokens: 6,
        cost_usd_est: 0,
        cost_usd_real: 0,
      });
    } finally {
      close();
    }
  });

  it('accumulates across two ingest batches (ON CONFLICT update)', () => {
    const { db, queries, close } = freshDb();
    try {
      ingestCalls(db, queries, [call({ tool_name: 'a', input_tokens: 10 })]);
      ingestCalls(db, queries, [call({ tool_name: 'b', input_tokens: 20 })]);
      const row = db
        .prepare('SELECT calls, unique_tools, input_tokens FROM server_stats_daily')
        .get() as { calls: number; unique_tools: number; input_tokens: number };
      expect(row).toEqual({ calls: 2, unique_tools: 2, input_tokens: 30 });
    } finally {
      close();
    }
  });

  it('INV-04: self-reference server lands in mcp_calls but not in server_stats_daily', () => {
    const { db, queries, close } = freshDb();
    try {
      const stats = ingestCalls(db, queries, [
        call({ server_name: 'mcpinsight', tool_name: 'overview' }),
        call({ server_name: 'filesystem', tool_name: 'read_file' }),
      ]);
      expect(stats.selfReferenceExcluded).toBe(1);
      expect(stats.dailyAggregatesAffected).toBe(1);

      const rawRows = db
        .prepare('SELECT server_name FROM mcp_calls ORDER BY server_name')
        .all() as { server_name: string }[];
      expect(rawRows.map((r) => r.server_name)).toEqual(['filesystem', 'mcpinsight']);

      const dailyRows = db.prepare('SELECT server_name FROM server_stats_daily').all() as {
        server_name: string;
      }[];
      expect(dailyRows.map((r) => r.server_name)).toEqual(['filesystem']);
    } finally {
      close();
    }
  });

  it('topServers excludes self-reference and orders by call count', () => {
    const { db, queries, close } = freshDb();
    try {
      const base = Date.UTC(2026, 3, 15, 12, 0, 0);
      const mk = (server: string, n: number): McpCall[] =>
        Array.from({ length: n }, (_, i) =>
          call({ server_name: server, tool_name: `t-${i}`, ts: base + i * 1000 }),
        );
      ingestCalls(db, queries, [
        ...mk('filesystem', 5),
        ...mk('github', 3),
        ...mk('mcpinsight', 10), // excluded
      ]);

      const top = queries.topServers({
        sinceMs: Date.UTC(2026, 3, 1),
        client: null,
        limit: 10,
      });
      expect(top.map((r) => r.server_name)).toEqual(['filesystem', 'github']);
      expect(top[0]?.calls).toBe(5);
      expect(top[1]?.calls).toBe(3);
    } finally {
      close();
    }
  });

  it('topServers respects --client filter', () => {
    const { db, queries, close } = freshDb();
    try {
      ingestCalls(db, queries, [
        call({ client: 'claude-code', server_name: 'filesystem' }),
        call({ client: 'codex', server_name: 'github' }),
      ]);
      const claudeOnly = queries.topServers({
        sinceMs: Date.UTC(2026, 0, 1),
        client: 'claude-code',
        limit: 10,
      });
      expect(claudeOnly.map((r) => r.server_name)).toEqual(['filesystem']);
    } finally {
      close();
    }
  });

  it('SELF_REFERENCE_SERVERS set includes mcpinsight (sanity)', () => {
    expect(SELF_REFERENCE_SERVERS.has('mcpinsight')).toBe(true);
    expect(SELF_REFERENCE_SERVERS.has('filesystem')).toBe(false);
  });

  it('records cost_usd into real vs estimated buckets based on cost_is_estimated', () => {
    const { db, queries, close } = freshDb();
    try {
      ingestCalls(db, queries, [
        call({ cost_usd: 1.5, cost_is_estimated: 0 }),
        call({ cost_usd: 2.25, cost_is_estimated: 1 }),
      ]);
      const row = db
        .prepare('SELECT cost_usd_real, cost_usd_est FROM server_stats_daily')
        .get() as { cost_usd_real: number; cost_usd_est: number };
      expect(row.cost_usd_real).toBeCloseTo(1.5);
      expect(row.cost_usd_est).toBeCloseTo(2.25);
    } finally {
      close();
    }
  });
});

describe('listServers', () => {
  it('returns empty array when no calls are present', () => {
    const { queries, close } = freshDb();
    try {
      expect(queries.listServers({ windowSinceMs: 0 })).toEqual([]);
    } finally {
      close();
    }
  });

  it('rolls up per server with last activity, windowed count, and client list', () => {
    const { db, queries, close } = freshDb();
    try {
      const base = Date.UTC(2026, 3, 10);
      ingestCalls(db, queries, [
        // filesystem: 3 calls, two in-window, one out; two clients
        call({ server_name: 'filesystem', tool_name: 'read', ts: base + 1_000_000 }),
        call({
          server_name: 'filesystem',
          tool_name: 'read',
          ts: base + 2_000_000,
          client: 'codex',
        }),
        call({ server_name: 'filesystem', tool_name: 'read', ts: base - 10_000_000 }),
        // github: one call, in-window
        call({ server_name: 'github', tool_name: 'search', ts: base + 500_000 }),
      ]);
      const rows = queries.listServers({ windowSinceMs: base });
      expect(rows).toHaveLength(2);
      // Ordered by most recent last_activity_ms first
      expect(rows[0]?.server_name).toBe('filesystem');
      expect(rows[0]?.last_activity_ms).toBe(base + 2_000_000);
      expect(rows[0]?.calls_in_window).toBe(2);
      expect(rows[0]?.total_calls).toBe(3);
      expect(rows[0]?.clients).toBe('claude-code,codex');

      expect(rows[1]?.server_name).toBe('github');
      expect(rows[1]?.calls_in_window).toBe(1);
      expect(rows[1]?.total_calls).toBe(1);
    } finally {
      close();
    }
  });

  it('surfaces zombies — servers with total_calls > 0 but calls_in_window = 0', () => {
    const { db, queries, close } = freshDb();
    try {
      const ancient = Date.UTC(2026, 0, 1);
      const windowStart = Date.UTC(2026, 3, 1);
      ingestCalls(db, queries, [call({ server_name: 'gdrive', tool_name: 'list', ts: ancient })]);
      const rows = queries.listServers({ windowSinceMs: windowStart });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        server_name: 'gdrive',
        calls_in_window: 0,
        total_calls: 1,
      });
    } finally {
      close();
    }
  });

  it('INV-04: self-reference server is excluded from listServers', () => {
    const { db, queries, close } = freshDb();
    try {
      ingestCalls(db, queries, [
        call({ server_name: 'mcpinsight', tool_name: 'overview' }),
        call({ server_name: 'filesystem', tool_name: 'read' }),
      ]);
      const rows = queries.listServers({ windowSinceMs: 0 });
      expect(rows.map((r) => r.server_name)).toEqual(['filesystem']);
    } finally {
      close();
    }
  });
});

describe('scan_state', () => {
  it('getScanState returns null for unknown file', () => {
    const { queries, close } = freshDb();
    try {
      expect(queries.getScanState('/nope.jsonl')).toBeNull();
    } finally {
      close();
    }
  });

  it('upsertScanState inserts and updates by file_path', () => {
    const { queries, close } = freshDb();
    try {
      queries.upsertScanState({
        file_path: '/a.jsonl',
        last_byte_offset: 100,
        last_scanned_at: 1_700_000_000_000,
        client: 'claude-code',
      });
      expect(queries.getScanState('/a.jsonl')).toEqual({
        file_path: '/a.jsonl',
        last_byte_offset: 100,
        last_scanned_at: 1_700_000_000_000,
        client: 'claude-code',
      });
      queries.upsertScanState({
        file_path: '/a.jsonl',
        last_byte_offset: 250,
        last_scanned_at: 1_700_000_100_000,
        client: 'claude-code',
      });
      expect(queries.getScanState('/a.jsonl')?.last_byte_offset).toBe(250);
    } finally {
      close();
    }
  });
});
