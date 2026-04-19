import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Command } from 'commander';

import { createQueries, openDb } from '@mcpinsight/core';
import type { Client, TopServerRow } from '@mcpinsight/core';

/**
 * `mcpinsight top` — ranked list of MCP servers by call count within a
 * trailing window. Sources from `mcp_calls` via `topServers` (INV-04 exclusion
 * embedded server-side). Human output is a plain padded table; --json emits
 * the raw TopServerRow[] so automation and contract tests can rely on the
 * canonical shape.
 */

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 7;
const DEFAULT_LIMIT = 20;

const VALID_CLIENTS: ReadonlySet<string> = new Set([
  'claude-code',
  'codex',
  'cursor',
  'windsurf',
  'copilot',
]);

interface TopOptions {
  days: string;
  client?: string;
  json?: boolean;
  limit: string;
  db?: string;
}

export interface TopRunOptions {
  days: number;
  client: Client | null;
  json: boolean;
  limit: number;
  db: string;
  nowMs: number;
}

export interface TopRunDeps {
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

function defaultDbPath(): string {
  return join(homedir(), '.mcpinsight', 'data.db');
}

export function registerTopCommand(program: Command): void {
  program
    .command('top')
    .description('Show top MCP servers by call count in a trailing window (default 7 days).')
    .option('--days <n>', 'Trailing window size in days', String(DEFAULT_DAYS))
    .option('--client <id>', `Filter by client: ${[...VALID_CLIENTS].join('|')}`)
    .option('--json', 'Emit raw TopServerRow[] as JSON', false)
    .option('--limit <n>', 'Max servers to show', String(DEFAULT_LIMIT))
    .option('--db <path>', 'Override SQLite path (default: ~/.mcpinsight/data.db)')
    .action((raw: TopOptions) => {
      runTop({
        days: parsePositiveInt(raw.days, '--days'),
        client: normalizeClient(raw.client),
        json: Boolean(raw.json),
        limit: parsePositiveInt(raw.limit, '--limit'),
        db: raw.db ?? defaultDbPath(),
        nowMs: Date.now(),
      });
    });
}

export function runTop(options: TopRunOptions, deps: TopRunDeps = {}): void {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;

  const { db, close } = openDb({ path: options.db });
  try {
    const queries = createQueries(db);
    const sinceMs = options.nowMs - options.days * DAY_MS;
    const rows = queries.topServers({
      sinceMs,
      client: options.client,
      limit: options.limit,
    });

    if (options.json) {
      stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
      return;
    }

    if (rows.length === 0) {
      stderr.write(
        `no mcp calls in the last ${options.days} day(s). Run \`mcpinsight scan\` to ingest your logs.\n`,
      );
      return;
    }

    stdout.write(formatTopTable(rows));
    stdout.write('\n');
  } finally {
    close();
  }
}

export function formatTopTable(rows: ReadonlyArray<TopServerRow>): string {
  const headers = ['SERVER', 'CALLS', 'TOOLS', 'SUCCESS', 'TOKENS'];
  const data = rows.map((r) => [
    r.server_name,
    formatInt(r.calls),
    formatInt(r.unique_tools),
    formatSuccessRate(r.calls, r.errors),
    formatInt(r.input_tokens + r.output_tokens + r.cache_read_tokens),
  ]);
  const alignRight = [false, true, true, true, true];
  return renderPaddedTable(headers, data, alignRight);
}

function normalizeClient(raw: string | undefined): Client | null {
  if (!raw) return null;
  if (!VALID_CLIENTS.has(raw)) {
    throw new Error(
      `invalid --client: "${raw}". Expected one of: ${[...VALID_CLIENTS].join(', ')}`,
    );
  }
  return raw as Client;
}

function parsePositiveInt(raw: string, flag: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`invalid ${flag}: "${raw}" (expected positive integer)`);
  }
  return n;
}

function formatInt(value: number): string {
  return value.toLocaleString('en-US');
}

function formatSuccessRate(calls: number, errors: number): string {
  if (calls <= 0) return '-';
  const pct = ((calls - errors) / calls) * 100;
  return `${pct.toFixed(1)}%`;
}

/**
 * Minimal padded table — no deps. Columns are space-separated with widths
 * computed from the max of header + body per column. `alignRight[i]` controls
 * alignment per column (numbers right, text left).
 */
export function renderPaddedTable(
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
  alignRight: ReadonlyArray<boolean>,
  gap = 2,
): string {
  const widths = headers.map((h, i) => {
    let w = h.length;
    for (const row of rows) {
      const cell = row[i] ?? '';
      if (cell.length > w) w = cell.length;
    }
    return w;
  });

  const sep = ' '.repeat(gap);
  const pad = (cell: string, i: number): string => {
    const w = widths[i] ?? cell.length;
    return alignRight[i] ? cell.padStart(w) : cell.padEnd(w);
  };

  const lines: string[] = [];
  lines.push(headers.map((h, i) => pad(h, i)).join(sep));
  for (const row of rows) {
    lines.push(row.map((cell, i) => pad(cell, i)).join(sep));
  }
  return lines.join('\n');
}
