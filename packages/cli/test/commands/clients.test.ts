import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  asProjectIdentity,
  asSessionId,
  createQueries,
  ingestCalls,
  openDb,
} from '@mcpinsight/core';
import type { Client, McpCall } from '@mcpinsight/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { formatClientsTable, runClients } from '../../src/commands/clients.js';

/**
 * Contract tests for `mcpinsight clients` — Day 18 multi-client surface.
 * Parallels top.test.ts / servers.test.ts structure so the three CLI
 * commands share the same quality bar.
 */

const PROJECT = asProjectIdentity('git:test000');
const SESSION = asSessionId('sess');

function call(overrides: Partial<McpCall> = {}): McpCall {
  return {
    client: 'claude-code' as Client,
    session_id: SESSION,
    project_identity: PROJECT,
    server_name: 'filesystem',
    tool_name: 'read_file',
    ts: Date.UTC(2026, 3, 15, 12, 0, 0),
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cost_usd: 0,
    cost_is_estimated: 1,
    is_error: false,
    duration_ms: 100,
    ...overrides,
  };
}

class CaptureStream {
  private buf = '';
  write(chunk: string | Uint8Array): boolean {
    this.buf += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    return true;
  }
  get text(): string {
    return this.buf;
  }
}

describe('runClients --json (contract)', () => {
  let dir: string;
  let dbPath: string;
  const NOW = Date.UTC(2026, 3, 20, 0, 0, 0); // 2026-04-20 UTC

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcpinsight-cli-clients-'));
    dbPath = join(dir, 'data.db');
    const handle = openDb({ path: dbPath });
    const queries = createQueries(handle.db);
    ingestCalls(handle.db, queries, [
      // Claude Code: 2 servers, 3 calls
      call({ client: 'claude-code', server_name: 'filesystem', ts: NOW - 5 * 86_400_000 }),
      call({ client: 'claude-code', server_name: 'filesystem', ts: NOW - 4 * 86_400_000 }),
      call({ client: 'claude-code', server_name: 'github', ts: NOW - 3 * 86_400_000 }),
      // Codex: 1 server, 2 calls
      call({ client: 'codex', server_name: 'filesystem', ts: NOW - 2 * 86_400_000 }),
      call({ client: 'codex', server_name: 'filesystem', ts: NOW - 1 * 86_400_000 }),
      // Self-reference — INV-04; dropped from listClients.
      call({ client: 'claude-code', server_name: 'mcpinsight', ts: NOW - 1_000 }),
    ]);
    handle.close();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('emits a JSON array of ClientListRow with every documented field', () => {
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    runClients({ days: 30, json: true, limit: 20, db: dbPath, nowMs: NOW }, { stdout, stderr });

    const rows = JSON.parse(stdout.text) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.client).sort()).toEqual(['claude-code', 'codex']);

    const required = ['client', 'calls', 'servers', 'first_ts', 'last_ts'] as const;
    for (const row of rows) {
      for (const field of required) {
        expect(row).toHaveProperty(field);
      }
      expect(typeof row.client).toBe('string');
      expect(typeof row.calls).toBe('number');
      expect(typeof row.servers).toBe('number');
      expect(typeof row.first_ts).toBe('number');
      expect(typeof row.last_ts).toBe('number');
    }

    const cc = rows.find((r) => r.client === 'claude-code');
    const codex = rows.find((r) => r.client === 'codex');
    // INV-04: the self-reference mcpinsight call must not count here.
    expect(cc?.calls).toBe(3);
    expect(cc?.servers).toBe(2);
    expect(codex?.calls).toBe(2);
    expect(codex?.servers).toBe(1);
  });

  it('orders rows by calls DESC', () => {
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    runClients({ days: 30, json: true, limit: 20, db: dbPath, nowMs: NOW }, { stdout, stderr });
    const rows = JSON.parse(stdout.text) as Array<Record<string, unknown>>;
    expect(rows[0]?.client).toBe('claude-code');
    expect(rows[1]?.client).toBe('codex');
  });

  it('respects --days window (excludes calls older than window)', () => {
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    // 1-day window → only the NOW - 1 day codex call qualifies.
    runClients({ days: 1, json: true, limit: 20, db: dbPath, nowMs: NOW }, { stdout, stderr });
    const rows = JSON.parse(stdout.text) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.client)).toEqual(['codex']);
    expect(rows[0]?.calls).toBe(1);
  });

  it('respects --limit (client-side truncation)', () => {
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    runClients({ days: 30, json: true, limit: 1, db: dbPath, nowMs: NOW }, { stdout, stderr });
    const rows = JSON.parse(stdout.text) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.client).toBe('claude-code');
  });

  it('human output emits header labels + UTC minute timestamp + no JSON bracket', () => {
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    runClients({ days: 30, json: false, limit: 20, db: dbPath, nowMs: NOW }, { stdout, stderr });
    const out = stdout.text;
    expect(out).toContain('CLIENT');
    expect(out).toContain('CALLS');
    expect(out).toContain('SERVERS');
    expect(out).toContain('FIRST');
    expect(out).toContain('LAST');
    expect(out).toContain('claude-code');
    expect(out).toContain('codex');
    expect(out).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    expect(out.split('\n')[0]?.trim().startsWith('[')).toBe(false);
  });

  it('empty DB emits a helpful stderr hint and nothing on stdout', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'mcpinsight-cli-clients-empty-'));
    const emptyDb = join(emptyDir, 'data.db');
    try {
      const h = openDb({ path: emptyDb });
      h.close();
      const stdout = new CaptureStream();
      const stderr = new CaptureStream();
      runClients({ days: 30, json: false, limit: 20, db: emptyDb, nowMs: NOW }, { stdout, stderr });
      expect(stdout.text).toBe('');
      expect(stderr.text).toContain('no mcp calls');
      expect(stderr.text).toContain('mcpinsight scan');
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

describe('formatClientsTable', () => {
  it('formats numeric columns right-aligned with thousands separators', () => {
    const out = formatClientsTable([
      {
        client: 'claude-code',
        calls: 12345,
        servers: 7,
        first_ts: Date.UTC(2026, 3, 10, 9, 30, 0),
        last_ts: Date.UTC(2026, 3, 20, 14, 45, 0),
      },
    ]);
    expect(out).toContain('12,345');
    expect(out).toContain('2026-04-10 09:30');
    expect(out).toContain('2026-04-20 14:45');
  });

  it('handles a single row with zero servers (degenerate but possible)', () => {
    // In practice listClients only returns rows with calls > 0 (GROUP BY
    // drops empty groups), but formatter shouldn't blow up if a caller
    // passes synthetic zeros.
    const out = formatClientsTable([
      {
        client: 'cursor',
        calls: 0,
        servers: 0,
        first_ts: 0,
        last_ts: 0,
      },
    ]);
    expect(out).toContain('cursor');
    expect(out).toContain('1970-01-01 00:00');
  });
});
