import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  web?: string;
  noWeb?: boolean;
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_LEVEL = 'info';
const VALID_LEVELS: ReadonlySet<LogLevel> = new Set(['debug', 'info', 'warn', 'error']);

function defaultDbPath(): string {
  return join(homedir(), '.mcpinsight', 'data.db');
}

/**
 * Best-effort locator for the built `packages/web/dist/` directory.
 *
 * The CLI may be invoked from anywhere on disk (user's project root), so we
 * walk up from the CLI's own module URL looking for a sibling `web/dist/`.
 * Returns the absolute path on hit, `null` otherwise — in which case
 * `mcpinsight serve` runs API-only and users visit the Vite dev server
 * (`pnpm --filter @mcpinsight/web dev` on :5173) instead.
 */
function locateWebDist(): string | null {
  const here = fileURLToPath(import.meta.url);
  let dir = dirname(here);
  for (let i = 0; i < 8; i += 1) {
    const candidate = resolve(dir, '..', 'web', 'dist');
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      const index = join(candidate, 'index.html');
      if (existsSync(index)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description(
      'Start the local Hono REST API + bundled dashboard. Defaults to 127.0.0.1 + OS-assigned port (INV-07).',
    )
    .option('--port <n>', 'Bind to a specific port (0 = OS-assigned, the default)')
    .option(
      '--host <addr>',
      `Bind host (default: ${DEFAULT_HOST}; keep on loopback unless you understand INV-07)`,
      DEFAULT_HOST,
    )
    .option('--db <path>', 'Override SQLite path (default: ~/.mcpinsight/data.db)')
    .option('--log-level <level>', `Logger level: ${[...VALID_LEVELS].join('|')}`, DEFAULT_LEVEL)
    .option(
      '--web <path>',
      'Serve the built dashboard from this directory (default: auto-detect packages/web/dist)',
    )
    .option('--no-web', 'API-only mode; do not serve the dashboard bundle')
    .action((raw: ServeOptions) => {
      void runServe(raw);
    });
}

async function runServe(raw: ServeOptions): Promise<void> {
  const dbPath = raw.db ?? defaultDbPath();
  const port = raw.port !== undefined ? parseNonNegativeInt(raw.port, '--port') : 0;
  const host = raw.host;
  const level = parseLogLevel(raw.logLevel);
  const webDistDir = resolveWebDistDir(raw);

  const { db, close: closeDb } = openDb({ path: dbPath });
  const queries = createQueries(db);
  const logger = createLogger({ level });

  let serverHandle: { close: () => Promise<void> } | null = null;
  try {
    const running = await startServer(
      { queries, clock: systemClock, logger },
      {
        port,
        host,
        ...(webDistDir !== null ? { webDistDir } : {}),
      },
    );
    serverHandle = running;
    logger.info('serve.ready', {
      url: running.url,
      dbPath,
      webDistDir: webDistDir ?? null,
    });
    process.stdout.write(`mcpinsight serve listening on ${running.url}\n`);
    process.stdout.write(`  API:       ${running.url}/api/health\n`);
    if (webDistDir !== null) {
      process.stdout.write(`  Dashboard: ${running.url}/ (bundled)\n`);
    } else {
      process.stdout.write(
        '  Dashboard: not bundled (run `pnpm --filter @mcpinsight/web build`, or `pnpm --filter @mcpinsight/web dev` on :5173)\n',
      );
    }
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

function resolveWebDistDir(raw: ServeOptions): string | null {
  if (raw.noWeb === true) return null;
  if (raw.web !== undefined && raw.web !== '') {
    const abs = resolve(raw.web);
    if (!existsSync(abs)) {
      throw new Error(`invalid --web: "${raw.web}" does not exist`);
    }
    return abs;
  }
  return locateWebDist();
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
