# Skill: Database (SQLite via better-sqlite3)

> Load when touching `packages/core/src/db/` or any `.sql` migration.

## Why SQLite, not Postgres

Local-first product. Each user has their own `~/.mcpinsight/data.db`. No network, no auth, no ops. Ten years of this data is still <100 MB for a typical user. Postgres would be ops without benefit.

For the Worker (Cloudflare), we use **D1** (Cloudflare's SQLite-as-a-service). Same mental model, different driver.

## Schema rules

### 1. Migrations are append-only

Every schema change is a new file `packages/core/migrations/NNNN_snake_case.sql`. **Never edit an applied migration.** If you need to "fix" something, write the next migration.

```sql
-- 0001_init.sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_calls (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  client             TEXT    NOT NULL,
  session_id         TEXT    NOT NULL,
  project_identity   TEXT    NOT NULL,
  server_name        TEXT    NOT NULL,
  tool_name          TEXT    NOT NULL,
  ts                 INTEGER NOT NULL,                 -- unix ms
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_usd           REAL    NOT NULL DEFAULT 0,
  cost_is_estimated  INTEGER NOT NULL DEFAULT 1,       -- INV-02
  is_error           INTEGER,                          -- nullable for compacted sessions
  duration_ms        INTEGER
);

CREATE INDEX idx_mcp_calls_ts               ON mcp_calls (ts);
CREATE INDEX idx_mcp_calls_server_ts        ON mcp_calls (server_name, ts);
CREATE INDEX idx_mcp_calls_client_server_ts ON mcp_calls (client, server_name, ts);
CREATE INDEX idx_mcp_cost_real              ON mcp_calls (cost_is_estimated) WHERE cost_is_estimated = 0;
```

### 2. Nullable or defaulted, always

Every new column added to an existing table must be `NULL`-able or have a `DEFAULT`. Otherwise migrating an existing database breaks.

```sql
-- 0002_add_duration.sql
ALTER TABLE mcp_calls ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;  -- ✅
-- ALTER TABLE mcp_calls ADD COLUMN retry_count INTEGER NOT NULL;          -- ❌ would fail
```

### 3. Indexes with intent

Every index has a comment explaining the query it supports.

```sql
-- Serves: /api/servers (last 30 days per server)
CREATE INDEX idx_mcp_calls_server_ts ON mcp_calls (server_name, ts);
```

### 4. Foreign keys are on

```sql
PRAGMA foreign_keys = ON;
```

Set in the `db.ts` wrapper at connection time; don't rely on the SQLite default (off).

### 5. WAL mode

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
```

Set at connection time. WAL gives concurrent reads during writes — matters when the CLI is writing while the web UI is querying.

## Query patterns

### Use prepared statements, cache them

```ts
// packages/core/src/db/queries.ts
export function createQueries(db: Database) {
  const stmts = {
    topServers: db.prepare(`
      SELECT server_name, COUNT(*) AS calls,
             SUM(CASE WHEN is_error = 1 THEN 0 ELSE 1 END) * 1.0 / COUNT(*) AS success_rate
        FROM mcp_calls
       WHERE ts >= ?
         AND client = COALESCE(?, client)
       GROUP BY server_name
       ORDER BY calls DESC
       LIMIT ?
    `),
    // ...
  };
  return {
    topServers(sinceMs: number, client: string | null, limit: number) {
      return stmts.topServers.all(sinceMs, client, limit) as TopServerRow[];
    },
  };
}
```

One prepared statement per query, built at connection time. Shaped row types assert at the boundary.

### Never build SQL by string concatenation

Always parameterized. If you think you need dynamic SQL (e.g., ORDER BY a user-chosen column), allow-list the column names in TypeScript and format into the prepared statement template at prepare time — not per-call from user input.

### Transactions for multi-row writes

```ts
const insertMany = db.transaction((rows: McpCall[]) => {
  for (const r of rows) stmts.insertCall.run(r);
});
insertMany(batch);
```

This is ~10x faster than individual inserts and atomic.

### Migration runner

```ts
// packages/core/src/db/migrations.ts
export function runMigrations(db: Database, migrationsDir: string, logger: Logger) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[])
      .map(r => r.version)
  );
  const files = readdirSync(migrationsDir).filter(f => /^\d{4}_.+\.sql$/.test(f)).sort();
  for (const file of files) {
    const version = parseInt(file.slice(0, 4), 10);
    if (applied.has(version)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    const runOne = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString());
    });
    runOne();
    logger.info('migration.applied', { version, file });
  }
}
```

## Anti-patterns

- ORM (Prisma, Drizzle, TypeORM). Unnecessary layer. Raw SQL is fine for our query surface.
- Storing JSON blobs in columns we need to query. If you need to `GROUP BY`, it's a column.
- `SELECT *`. Always explicit columns — adding one shouldn't silently pollute caller shapes.
- Using the DB as a queue. It's a database.
- Multiple SQLite files for the same user (e.g., "one per client"). One DB, `client` column.

## Testing

- Integration tests use `new Database(':memory:')` + run migrations fresh per test.
- Always assert on shape, not implementation: "top server is X" not "query returned 3 rows".
- Fixture SQL: `packages/core/test/fixtures/seed.sql` with deterministic rows.

## Claude hints

- When asked to add a query, first check `queries.ts` for something similar — don't duplicate.
- When asked to add a column, write the migration first, then update the shape type in `types/`, then update the query.
- When asked to add an index, justify it with the specific query it serves and run `EXPLAIN QUERY PLAN` in a comment.
