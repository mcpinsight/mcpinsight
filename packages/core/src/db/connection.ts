import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import BetterSqlite3 from 'better-sqlite3';

export type Database = BetterSqlite3.Database;

export type MigrationLogger = (msg: string, meta?: Record<string, unknown>) => void;

export interface OpenDbOptions {
  /** Path to the SQLite file. Use `:memory:` for tests. */
  path: string;
  /** Migration directory. Defaults to `packages/core/migrations` resolved relative to this module. */
  migrationsDir?: string;
  /** Log callback invoked per applied migration. Silent by default. */
  logger?: MigrationLogger;
}

export interface OpenedDb {
  db: Database;
  close: () => void;
}

/**
 * Open a SQLite database, apply pending migrations, and return the connection.
 *
 * PRAGMAs set at connection time (in addition to what the migration sets in the
 * DB header):
 *   - `foreign_keys = ON` (connection-scoped; SQLite default is off)
 *   - `busy_timeout = 5000` (retry for 5s on lock contention)
 *   - `synchronous = NORMAL` (pair with WAL)
 *   - `journal_mode = WAL` (no-op on `:memory:` — it ignores)
 *
 * Parent directory of `path` is created if missing. The caller is responsible
 * for calling `close()` on shutdown.
 */
export function openDb(options: OpenDbOptions): OpenedDb {
  const { path, migrationsDir = defaultMigrationsDir(), logger } = options;

  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new BetterSqlite3(path);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  if (path !== ':memory:') db.pragma('journal_mode = WAL');

  runMigrations(db, migrationsDir, logger);
  return {
    db,
    close: () => db.close(),
  };
}

/**
 * Apply all pending migrations in version order. Idempotent — a second call
 * is a no-op.
 *
 * Each migration file must match `NNNN_name.sql`. Applied versions are tracked
 * in `schema_migrations`. The applied_at insert is guarded by a SELECT 1 check
 * because 0001_init.sql self-records (append-only means we can't remove that).
 */
export function runMigrations(db: Database, migrationsDir: string, logger?: MigrationLogger): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all() as {
    version: number;
  }[];
  const applied = new Set(appliedRows.map((r) => r.version));

  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();

  for (const file of files) {
    const version = Number.parseInt(file.slice(0, 4), 10);
    if (applied.has(version)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    // PRAGMA statements like `journal_mode = WAL` or `synchronous = NORMAL`
    // cannot run inside a transaction. They are documented in migration files
    // but applied at connection time by `openDb`; strip them before exec.
    const pragmaLess = sql.replace(/^\s*PRAGMA\s[^;]*;\s*$/gim, '');
    const runOne = db.transaction(() => {
      db.exec(pragmaLess);
      const exists = db
        .prepare('SELECT 1 AS present FROM schema_migrations WHERE version = ?')
        .get(version);
      if (!exists) {
        db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
          version,
          new Date().toISOString(),
        );
      }
    });
    runOne();
    logger?.('migration.applied', { version, file });
  }
}

/**
 * Resolve the `migrations/` directory next to this package, whether we're
 * running from source (`src/db/index.ts`) or compiled (`dist/index.js`).
 */
export function defaultMigrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '..', '..', 'migrations'), // src/db/index.ts → packages/core/migrations
    resolve(here, '..', 'migrations'), // dist/index.js → packages/core/migrations
    resolve(here, 'migrations'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
  }
  throw new Error(
    `Could not locate migrations directory. Tried:\n  ${candidates.join('\n  ')}\nPass \`migrationsDir\` explicitly to openDb().`,
  );
}
