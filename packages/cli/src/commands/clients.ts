import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Command } from 'commander';

import { createQueries, openDb } from '@mcpinsight/core';
import type { ClientListRow } from '@mcpinsight/core';

import { renderPaddedTable } from './top.js';

/**
 * `mcpinsight clients` — per-client activity breakdown within a trailing
 * window. Sources from `mcp_calls` via `listClients`, which embeds the
 * INV-04 self-reference exclusion so the `mcpinsight` MCP server doesn't
 * inflate Claude Code's row. Human output is a plain padded table; --json
 * emits the raw `ClientListRow[]` for automation and contract tests.
 */

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT = 20;

interface ClientsOptions {
  days: string;
  json?: boolean;
  limit: string;
  db?: string;
}

export interface ClientsRunOptions {
  days: number;
  json: boolean;
  limit: number;
  db: string;
  nowMs: number;
}

export interface ClientsRunDeps {
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

function defaultDbPath(): string {
  return join(homedir(), '.mcpinsight', 'data.db');
}

export function registerClientsCommand(program: Command): void {
  program
    .command('clients')
    .description(
      'Per-client activity breakdown in a trailing window (default 30 days): calls, distinct servers, first/last activity.',
    )
    .option('--days <n>', 'Trailing window size in days', String(DEFAULT_DAYS))
    .option('--json', 'Emit raw ClientListRow[] as JSON', false)
    .option('--limit <n>', 'Max clients to show', String(DEFAULT_LIMIT))
    .option('--db <path>', 'Override SQLite path (default: ~/.mcpinsight/data.db)')
    .action((raw: ClientsOptions) => {
      runClients({
        days: parsePositiveInt(raw.days, '--days'),
        json: Boolean(raw.json),
        limit: parsePositiveInt(raw.limit, '--limit'),
        db: raw.db ?? defaultDbPath(),
        nowMs: Date.now(),
      });
    });
}

export function runClients(options: ClientsRunOptions, deps: ClientsRunDeps = {}): void {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;

  const { db, close } = openDb({ path: options.db });
  try {
    const queries = createQueries(db);
    const sinceMs = options.nowMs - options.days * DAY_MS;
    const rows = queries.listClients({ sinceMs }).slice(0, options.limit);

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

    stdout.write(formatClientsTable(rows));
    stdout.write('\n');
  } finally {
    close();
  }
}

export function formatClientsTable(rows: ReadonlyArray<ClientListRow>): string {
  const headers = ['CLIENT', 'CALLS', 'SERVERS', 'FIRST', 'LAST'];
  const data = rows.map((r) => [
    r.client,
    r.calls.toLocaleString('en-US'),
    r.servers.toLocaleString('en-US'),
    formatUtcMinute(r.first_ts),
    formatUtcMinute(r.last_ts),
  ]);
  const alignRight = [false, true, true, false, false];
  return renderPaddedTable(headers, data, alignRight);
}

function parsePositiveInt(raw: string, flag: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`invalid ${flag}: "${raw}" (expected positive integer)`);
  }
  return n;
}

function formatUtcMinute(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const mo = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const da = d.getUTCDate().toString().padStart(2, '0');
  const h = d.getUTCHours().toString().padStart(2, '0');
  const mi = d.getUTCMinutes().toString().padStart(2, '0');
  return `${y}-${mo}-${da} ${h}:${mi}`;
}
