import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Command } from 'commander';

import { createQueries, openDb } from '@mcpinsight/core';
import type { ServerListRow } from '@mcpinsight/core';

import { renderPaddedTable } from './top.js';

/**
 * `mcpinsight servers` — inventory of every MCP server detected in the local
 * database, with last-activity and a trailing-window call count.
 *
 * The `--zombies` flag narrows to servers with `calls_in_window === 0` — the
 * typical signal that a server is configured but unused (registered in MCP
 * config, perhaps auth-only, but never actually called). Self-reference is
 * excluded at the query layer (INV-04).
 */

const DAY_MS = 86_400_000;
const DEFAULT_WINDOW_DAYS = 30;

interface ServersOptions {
  zombies?: boolean;
  days: string;
  json?: boolean;
  db?: string;
}

export interface ServersRunOptions {
  zombies: boolean;
  windowDays: number;
  json: boolean;
  db: string;
  nowMs: number;
}

export interface ServersRunDeps {
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

function defaultDbPath(): string {
  return join(homedir(), '.mcpinsight', 'data.db');
}

export function registerServersCommand(program: Command): void {
  program
    .command('servers')
    .description(
      'List detected MCP servers with last activity. --zombies narrows to servers with 0 calls in the window.',
    )
    .option('--zombies', 'Show only servers with 0 calls in the trailing window', false)
    .option(
      '--days <n>',
      'Trailing window (days) for the zombie threshold',
      String(DEFAULT_WINDOW_DAYS),
    )
    .option('--json', 'Emit raw ServerListRow[] as JSON', false)
    .option('--db <path>', 'Override SQLite path (default: ~/.mcpinsight/data.db)')
    .action((raw: ServersOptions) => {
      runServers({
        zombies: Boolean(raw.zombies),
        windowDays: parsePositiveInt(raw.days, '--days'),
        json: Boolean(raw.json),
        db: raw.db ?? defaultDbPath(),
        nowMs: Date.now(),
      });
    });
}

export function runServers(options: ServersRunOptions, deps: ServersRunDeps = {}): void {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;

  const { db, close } = openDb({ path: options.db });
  try {
    const queries = createQueries(db);
    const windowSinceMs = options.nowMs - options.windowDays * DAY_MS;
    const all = queries.listServers({ windowSinceMs });
    const rows = options.zombies ? all.filter((r) => r.calls_in_window === 0) : all;

    if (options.json) {
      stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
      return;
    }

    if (rows.length === 0) {
      if (options.zombies) {
        stderr.write(
          `no zombie servers (every detected server has >=1 call in the last ${options.windowDays} day(s)).\n`,
        );
      } else {
        stderr.write('no mcp servers detected. Run `mcpinsight scan` to ingest your logs.\n');
      }
      return;
    }

    stdout.write(formatServersTable(rows, options.windowDays));
    stdout.write('\n');
  } finally {
    close();
  }
}

export function formatServersTable(rows: ReadonlyArray<ServerListRow>, windowDays: number): string {
  const headers = ['SERVER', 'LAST ACTIVITY (UTC)', `CALLS (${windowDays}D)`, 'TOTAL', 'CLIENTS'];
  const data = rows.map((r) => [
    r.server_name,
    formatUtcMinute(r.last_activity_ms),
    r.calls_in_window.toLocaleString('en-US'),
    r.total_calls.toLocaleString('en-US'),
    r.clients.length > 0 ? r.clients.replaceAll(',', ', ') : '-',
  ]);
  const alignRight = [false, false, true, true, false];
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
