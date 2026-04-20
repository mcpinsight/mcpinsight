import { homedir } from 'node:os';
import { join } from 'node:path';

import { createLogger, createQueries, openDb, systemClock } from '@mcpinsight/core';
import type { LogLevel } from '@mcpinsight/core';
import { startServer } from '@mcpinsight/server';
import type { Command } from 'commander';

/**
 * `mcpinsight serve` — start the local Hono REST API. Binds 127.0.0.1 by
 * default (INV-07: server is local-first; loopback-only is the security
 * boundary in lieu of auth).
 *
 * Port `0` (default) asks the OS for a free port; the assigned URL is
 * printed to stdout so a future `mcpinsight open` (Day 22 polish) — or a
 * shell wrapper — can pick it up. Ctrl-C closes the HTTP listener and the
 * SQLite connection cleanly.
 */

interface ServeOptions {
  port?: string;
  host: string;
  db?: string;
  logLevel: string;
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_LEVEL = 'info';
const VALID_LEVELS: ReadonlySet<LogLevel> = new Set(['debug', 'info', 'warn', 'error']);

function defaultDbPath(): string {
  return join(homedir(), '.mcpinsight', 'data.db');
}

export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description(
      'Start the local Hono REST API. Defaults to 127.0.0.1 + OS-assigned port (INV-07).',
    )
    .option('--port <n>', 'Bind to a specific port (0 = OS-assigned, the default)')
    .option(
      '--host <addr>',
      `Bind host (default: ${DEFAULT_HOST}; keep on loopback unless you understand INV-07)`,
      DEFAULT_HOST,
    )
    .option('--db <path>', 'Override SQLite path (default: ~/.mcpinsight/data.db)')
    .option('--log-level <level>', `Logger level: ${[...VALID_LEVELS].join('|')}`, DEFAULT_LEVEL)
    .action((raw: ServeOptions) => {
      void runServe(raw);
    });
}

async function runServe(raw: ServeOptions): Promise<void> {
  const dbPath = raw.db ?? defaultDbPath();
  const port = raw.port !== undefined ? parseNonNegativeInt(raw.port, '--port') : 0;
  const host = raw.host;
  const level = parseLogLevel(raw.logLevel);

  const { db, close: closeDb } = openDb({ path: dbPath });
  const queries = createQueries(db);
  const logger = createLogger({ level });

  let serverHandle: { close: () => Promise<void> } | null = null;
  try {
    const running = await startServer({ queries, clock: systemClock, logger }, { port, host });
    serverHandle = running;
    logger.info('serve.ready', { url: running.url, dbPath });
    process.stdout.write(`mcpinsight serve listening on ${running.url}\n`);
    process.stdout.write(`db: ${dbPath}\n`);
    process.stdout.write('Ctrl-C to stop.\n');
  } catch (err) {
    closeDb();
    process.stderr.write(`failed to start server: ${String(err)}\n`);
    process.exit(1);
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`\nreceived ${signal}, shutting down...\n`);
    try {
      await serverHandle?.close();
    } finally {
      closeDb();
    }
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

function parseNonNegativeInt(raw: string, flag: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`invalid ${flag}: "${raw}" (expected non-negative integer)`);
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`invalid ${flag}: "${raw}" (expected non-negative integer)`);
  }
  return n;
}

function parseLogLevel(raw: string): LogLevel {
  if (!VALID_LEVELS.has(raw as LogLevel)) {
    throw new Error(
      `invalid --log-level: "${raw}" (expected one of: ${[...VALID_LEVELS].join(', ')})`,
    );
  }
  return raw as LogLevel;
}
