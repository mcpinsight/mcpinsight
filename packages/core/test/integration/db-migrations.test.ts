import { describe, expect, it } from 'vitest';

import { defaultMigrationsDir, openDb, runMigrations } from '../../src/db/connection.js';

describe('openDb + runMigrations', () => {
  it('applies 0001_init.sql and creates every canonical table', () => {
    const { db, close } = openDb({ path: ':memory:' });
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as { name: string }[];
      const names = tables.map((t) => t.name);
      for (const table of [
        'license_cache',
        'mcp_calls',
        'scan_state',
        'schema_migrations',
        'server_stats_daily',
        'telemetry_consent',
        'telemetry_pending',
      ]) {
        expect(names).toContain(table);
      }
    } finally {
      close();
    }
  });

  it('records migration version 1 in schema_migrations', () => {
    const { db, close } = openDb({ path: ':memory:' });
    try {
      const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
        version: number;
      }[];
      expect(rows.map((r) => r.version)).toEqual([1]);
    } finally {
      close();
    }
  });

  it('is idempotent — a second runMigrations call is a no-op', () => {
    const { db, close } = openDb({ path: ':memory:' });
    try {
      runMigrations(db, defaultMigrationsDir());
      runMigrations(db, defaultMigrationsDir());
      const rows = db.prepare('SELECT version FROM schema_migrations').all() as {
        version: number;
      }[];
      expect(rows).toHaveLength(1);
    } finally {
      close();
    }
  });

  it('enables foreign_keys and sets busy_timeout on the connection', () => {
    const { db, close } = openDb({ path: ':memory:' });
    try {
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    } finally {
      close();
    }
  });

  it('invokes logger callback once per applied migration', () => {
    const seen: Array<{ msg: string; meta: Record<string, unknown> | undefined }> = [];
    const { close } = openDb({
      path: ':memory:',
      logger: (msg, meta) => seen.push({ msg, meta }),
    });
    try {
      expect(seen.length).toBeGreaterThanOrEqual(1);
      expect(seen[0]?.msg).toBe('migration.applied');
      expect(seen[0]?.meta).toMatchObject({ version: 1 });
    } finally {
      close();
    }
  });
});
