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

import { formatServersTable, runServers } from '../../src/commands/servers.js';

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

describe('runServers --json (contract)', () => {
  let dir: string;
  let dbPath: string;
  const NOW = Date.UTC(2026, 3, 20, 0, 0, 0); // 2026-04-20 UTC

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcpinsight-cli-servers-'));
    dbPath = join(dir, 'data.db');
    const handle = openDb({ path: dbPath });
    const queries = createQueries(handle.db);
    ingestCalls(handle.db, queries, [
      // Active server — two calls recent, two clients.
      call({ server_name: 'filesystem', tool_name: 'read', ts: NOW - 3 * 86_400_000 }),
      call({
        server_name: 'filesystem',
        tool_name: 'read',
        ts: NOW - 2 * 86_400_000,
        client: 'codex',
      }),
      // Zombie — single call 60 days ago.
      call({ server_name: 'gdrive', tool_name: 'list', ts: NOW - 60 * 86_400_000 }),
      // Self-reference — excluded.
      call({ server_name: 'mcpinsight', tool_name: 'overview', ts: NOW - 1_000 }),
    ]);
    handle.close();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('emits a JSON array of ServerListRow with every documented field', () => {
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    runServers(
      { zombies: false, windowDays: 30, json: true, db: dbPath, nowMs: NOW },
      { stdout, stderr },
    );

    const rows = JSON.parse(stdout.text) as Array<Record<string, unknown>>;
    expect(rows.some((r) => r.server_name === 'mcpinsight')).toBe(false);

    for (const row of rows) {
      expect(row).toHaveProperty('server_name');
      expect(row).toHaveProperty('last_activity_ms');
      expect(row).toHaveProperty('calls_in_window');
      expect(row).toHaveProperty('total_calls');
      expect(row).toHaveProperty('clients');
      expect(typeof row.last_activity_ms).toBe('number');
      expect(typeof row.clients).toBe('string');
    }

    expect(rows.map((r) => r.server_name)).toEqual(['filesystem', 'gdrive']);
    const filesystem = rows.find((r) => r.server_name === 'filesystem');
    expect(filesystem?.calls_in_window).toBe(2);
    expect(filesystem?.total_calls).toBe(2);
    expect(filesystem?.clients).toBe('claude-code,codex');
  });

  it('--zombies narrows to servers with 0 calls in the window', () => {
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    runServers(
      { zombies: true, windowDays: 30, json: true, db: dbPath, nowMs: NOW },
      { stdout, stderr },
    );
    const rows = JSON.parse(stdout.text) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.server_name).toBe('gdrive');
    expect(rows[0]?.calls_in_window).toBe(0);
    expect(rows[0]?.total_calls).toBe(1);
  });

  it('human output emits header labels and a UTC timestamp line', () => {
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    runServers(
      { zombies: false, windowDays: 30, json: false, db: dbPath, nowMs: NOW },
      { stdout, stderr },
    );
    const out = stdout.text;
    expect(out).toContain('SERVER');
    expect(out).toContain('LAST ACTIVITY (UTC)');
    expect(out).toContain('CALLS (30D)');
    expect(out).toContain('TOTAL');
    expect(out).toContain('CLIENTS');
    expect(out).toContain('filesystem');
    expect(out).toContain('gdrive');
    expect(out).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  });

  it('--zombies with no zombies produces a friendly stderr hint', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'mcpinsight-cli-servers-empty-'));
    const emptyDb = join(emptyDir, 'data.db');
    try {
      const h = openDb({ path: emptyDb });
      const q = createQueries(h.db);
      ingestCalls(h.db, q, [call({ ts: NOW - 5 * 86_400_000 })]);
      h.close();

      const stdout = new CaptureStream();
      const stderr = new CaptureStream();
      runServers(
        { zombies: true, windowDays: 30, json: false, db: emptyDb, nowMs: NOW },
        { stdout, stderr },
      );
      expect(stdout.text).toBe('');
      expect(stderr.text).toContain('no zombie servers');
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

describe('formatServersTable', () => {
  it('renders clients with a ", " separator (readability)', () => {
    const out = formatServersTable(
      [
        {
          server_name: 'filesystem',
          last_activity_ms: Date.UTC(2026, 3, 20, 13, 45, 0),
          calls_in_window: 12,
          total_calls: 30,
          clients: 'claude-code,codex',
        },
      ],
      30,
    );
    expect(out).toContain('claude-code, codex');
    expect(out).toContain('2026-04-20 13:45');
  });

  it('renders dash for servers with no client attribution', () => {
    const out = formatServersTable(
      [
        {
          server_name: 'filesystem',
          last_activity_ms: 0,
          calls_in_window: 0,
          total_calls: 0,
          clients: '',
        },
      ],
      30,
    );
    expect(out).toMatch(/filesystem\s+1970-01-01 00:00\s+0\s+0\s+-/);
  });
});
