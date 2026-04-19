# @mcpinsight/cli

Local CLI that reads your AI coding agent's session logs, extracts MCP tool calls, and writes them to a SQLite database at `~/.mcpinsight/data.db`.

## Status

Pre-launch (Day 13 of 30). **Not yet published to npm.** To use it today, build from source.

Supported clients:

| Client | Status |
|---|---|
| Claude Code (`~/.claude/projects/**/*.jsonl`) | shipped |
| Codex | Week 3 |
| Cursor, Windsurf, Copilot | later |

## Run it locally

From the repo root:

```bash
# 1. Install dependencies (once)
pnpm install

# 2. Build the CLI and its dependency (after any src/ change)
pnpm --filter @mcpinsight/core build
pnpm --filter @mcpinsight/cli build

# 3. Pick one to invoke:
node packages/cli/dist/index.js scan   # direct (always works)
pnpm cli -- scan                       # via root package.json script
```

For a persistent `mcpinsight` on your PATH:

```bash
pnpm --filter @mcpinsight/cli link --global
mcpinsight scan
# later:
pnpm unlink --global @mcpinsight/cli
```

## Commands

### `mcpinsight scan`

Parses Claude Code session logs, normalizes MCP tool calls, and ingests them into SQLite.

```bash
mcpinsight scan                      # default: ~/.claude/projects → ~/.mcpinsight/data.db
mcpinsight scan --print              # JSON to stdout, skip DB write
mcpinsight scan --db /tmp/trial.db   # override DB path
mcpinsight scan --path /some/root    # override log root (repeatable)
mcpinsight scan --limit 100          # cap emitted calls
```

Output goes to stdout only with `--print`. A summary line is always written to stderr:

```
project_identity: git:5949dbc724c7 (source=git)
files: 68 scanned | 0 up-to-date | 0 read errors | lines: 5851 read |
  relevant: 3385 | paired: 1693 | mcp_calls: 3 ingested |
  non_mcp: 1690 (Bash/Read/Edit/Agent filtered) | self_reference_excluded: 0
db: /Users/you/.mcpinsight/data.db
```

Second run is incremental — files are tracked by byte offset in the `scan_state` table, so unchanged files are skipped. Files that shrank (rotation / compaction) are rescanned from 0.

`project_identity` is derived from `git remote get-url origin` where available (so `git@github.com:org/repo.git` and `https://github.com/org/repo.git` hash to the same id) and falls back to a sha256 of the current working directory. This is invariant INV-01 in [`CLAUDE.md`](../../CLAUDE.md).

### `mcpinsight top`

Ranked list of MCP servers by call count over a trailing window.

```bash
mcpinsight top                         # default: 7 days, 20 servers
mcpinsight top --days 30               # wider window
mcpinsight top --client claude-code    # filter by client
mcpinsight top --limit 5               # truncate
mcpinsight top --json                  # raw TopServerRow[] for scripting
mcpinsight top --db /tmp/trial.db      # override DB path
```

Valid `--client` values: `claude-code`, `codex`, `cursor`, `windsurf`, `copilot`.

Human output is a space-padded table:

```
SERVER                  CALLS  TOOLS  SUCCESS  TOKENS
claude_ai_Google_Drive      3      2   100.0%  67,346
```

Columns: server name; total calls in window; distinct tool names exercised on that server; success rate `(calls − errors) / calls`; and summed tokens (input + output + cache_read). `--json` emits the full `TopServerRow[]` shape, including per-token and `cost_usd_real` / `cost_usd_est` splits (INV-02).

Servers named `mcpinsight` are excluded from the ranking (INV-04) — once the self-referential MCP server ships, its own calls never inflate its own ranking.

### `mcpinsight servers`

Inventory of every detected MCP server, with last-activity timestamp, in-window call count, and the clients that have called it.

```bash
mcpinsight servers                     # default: 30-day window
mcpinsight servers --days 7            # tighter window
mcpinsight servers --zombies           # only servers with 0 calls in the window
mcpinsight servers --json              # raw ServerListRow[] for scripting
mcpinsight servers --db /tmp/trial.db  # override DB path
```

Sample output:

```
SERVER                  LAST ACTIVITY (UTC)  CALLS (30D)  TOTAL  CLIENTS
claude_ai_Google_Drive  2026-04-18 22:27               3      3  claude-code
```

`--zombies` narrows to servers with zero calls in the window. Typical finding: an MCP server registered in your client config that performed an auth handshake but never made a content call (see `research/personal-audit.md` for the Day 1 walkthrough).

### `mcpinsight hello`

Smoke test — prints `hello from mcpinsight`. Useful to confirm the binary was built.

## Inspecting the database

The DB is plain SQLite. Any tool works:

```bash
sqlite3 ~/.mcpinsight/data.db "SELECT server_name, COUNT(*) AS calls
                                 FROM mcp_calls
                                 GROUP BY server_name
                                 ORDER BY calls DESC;"

sqlite3 ~/.mcpinsight/data.db "SELECT day, server_name, calls, unique_tools
                                 FROM server_stats_daily
                                 ORDER BY day DESC
                                 LIMIT 10;"
```

Tables: `mcp_calls` (every normalized call), `server_stats_daily` (daily rollup by client + server + project), `scan_state` (per-file byte offsets), `schema_migrations`, `telemetry_consent`, `telemetry_pending`, `license_cache`. The latter three are scaffolding for Week 4 — empty today.

Full schema: [`packages/core/migrations/0001_init.sql`](../core/migrations/0001_init.sql).

Note: by INV-04, calls to a server named `mcpinsight` (the planned self-referential MCP server) land in `mcp_calls` but are excluded from `server_stats_daily` rollups and from the `top` query. This keeps rankings honest once the self-server ships.

## Privacy

Everything runs locally. The CLI reads files under `~/.claude/projects/` and writes to `~/.mcpinsight/data.db`. No network calls. Opt-in telemetry arrives in Week 4; until then the telemetry tables stay empty.

## Contributing

See the [root README](../../README.md) and [`CLAUDE.md`](../../CLAUDE.md) for architecture.
