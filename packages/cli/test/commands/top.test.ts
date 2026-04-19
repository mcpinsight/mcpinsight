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

import { formatTopTable, renderPaddedTable, runTop } from '../../src/commands/top.js';

/**
 * Contract tests: `mcpinsight top --json` must emit TopServerRow[] with every
 * documented field present. If Day 15+ or Week 3 refactors break the shape,
 * downstream code (dashboard fetch, alpha-tester scripts, CI comparison) will
 * see the type error here before it lands in a published artifact.
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

describe('runTop --json (contract)', () => {
  let dir: string;
  let dbPath: string;
  const NOW = Date.UTC(2026, 3, 16, 0, 0, 0);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcpinsight-cli-top-'));
    dbPath = join(dir, 'data.db');
    const handle = openDb({ path: dbPath });
    const queries = createQueries(handle.db);
    ingestCalls(handle.db, queries, [
      call({ server_name: 'filesystem', tool_name: 'read_file', input_tokens: 100 }),
      call({ server_name: 'filesystem', tool_name: 'write_file', input_tokens: 50 }),
      call({
        server_name: 'github',
        tool_name: 'search',
        is_error: true,
        input_tokens: 30,
        output_tokens: 5,
      }),
      // INV-04: should never appear in output
      call({ server_name: 'mcpinsight', tool_name: 'overview' }),
    ]);
    handle.close();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('emits a JSON array of TopServerRow with every documented field', () => {
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    runTop(
      { days: 7, client: null, json: true, limit: 20, db: dbPath, nowMs: NOW },
      { stdout, stderr },
    );

    const parsed = JSON.parse(stdout.text) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
    const rows = parsed as Array<Record<string, unknown>>;
    // INV-04 check — mcpinsight must be excluded at the query layer.
    expect(rows.some((r) => r.server_name === 'mcpinsight')).toBe(false);

    // Order is by `calls DESC`, so filesystem (2 calls) comes before github (1).
    expect(rows[0]?.server_name).toBe('filesystem');
    expect(rows[1]?.server_name).toBe('github');

    const requiredFields = [
      'server_name',
      'calls',
      'errors',
      'unique_tools',
      'input_tokens',
      'output_tokens',
      'cache_read_tokens',
      'cost_usd_real',
      'cost_usd_est',
    ] as const;
    for (const row of rows) {
      for (const field of requiredFields) {
        expect(row).toHaveProperty(field);
      }
      expect(typeof row.server_name).toBe('string');
      expect(typeof row.calls).toBe('number');
      expect(typeof row.errors).toBe('number');
      expect(typeof row.unique_tools).toBe('number');
    }
  });

  it('applies --days window — old calls fall out of scope', () => {
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    // Seeds are at 2026-04-15 12:00 UTC. Run 3 days after NOW with a 1-day
    // window → sinceMs = 2026-04-18 00:00 UTC, excludes every seed.
    runTop(
      { days: 1, client: null, json: true, limit: 20, db: dbPath, nowMs: NOW + 3 * 86_400_000 },
      { stdout, stderr },
    );
    expect(JSON.parse(stdout.text)).toEqual([]);
  });

  it('respects --limit', () => {
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    runTop(
      { days: 7, client: null, json: true, limit: 1, db: dbPath, nowMs: NOW },
      { stdout, stderr },
    );
    const rows = JSON.parse(stdout.text) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.server_name).toBe('filesystem');
  });

  it('respects --client filter', () => {
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    runTop(
      { days: 7, client: 'codex' as Client, json: true, limit: 20, db: dbPath, nowMs: NOW },
      { stdout, stderr },
    );
    expect(JSON.parse(stdout.text)).toEqual([]);
  });

  it('human output prints a padded table with headers and emits no JSON', () => {
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    runTop(
      { days: 7, client: null, json: false, limit: 20, db: dbPath, nowMs: NOW },
      { stdout, stderr },
    );
    const out = stdout.text;
    expect(out).toContain('SERVER');
    expect(out).toContain('CALLS');
    expect(out).toContain('TOOLS');
    expect(out).toContain('SUCCESS');
    expect(out).toContain('TOKENS');
    expect(out).toContain('filesystem');
    expect(out).toContain('github');
    // No JSON-ish boundary characters on their own line.
    expect(out.split('\n')[0]?.trim().startsWith('[')).toBe(false);
  });

  it('empty result emits a helpful hint to stderr', () => {
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    const emptyDir = mkdtempSync(join(tmpdir(), 'mcpinsight-cli-top-empty-'));
    const emptyDb = join(emptyDir, 'data.db');
    try {
      const h = openDb({ path: emptyDb });
      h.close();
      runTop(
        { days: 7, client: null, json: false, limit: 20, db: emptyDb, nowMs: NOW },
        { stdout, stderr },
      );
      expect(stdout.text).toBe('');
      expect(stderr.text).toContain('no mcp calls');
      expect(stderr.text).toContain('mcpinsight scan');
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

describe('formatTopTable', () => {
  it('formats numbers with thousands separators and success rate with 1 decimal', () => {
    const out = formatTopTable([
      {
        server_name: 'filesystem',
        calls: 1234,
        errors: 10,
        unique_tools: 5,
        input_tokens: 1_000_000,
        output_tokens: 234_567,
        cache_read_tokens: 0,
        cost_usd_real: 0,
        cost_usd_est: 0,
      },
    ]);
    expect(out).toContain('1,234');
    expect(out).toContain('1,234,567');
    expect(out).toContain('99.2%');
  });
});

describe('renderPaddedTable', () => {
  it('pads text-left and numbers-right with a consistent gap', () => {
    const out = renderPaddedTable(
      ['A', 'N'],
      [
        ['x', '1'],
        ['yz', '22'],
      ],
      [false, true],
      2,
    );
    // col widths: 2, 2; gap = 2 spaces. Header 'A ' + '  ' + ' N' = 'A    N'.
    expect(out).toBe(['A    N', 'x    1', 'yz  22'].join('\n'));
  });
});
