# Repository Structure

## Layout (pnpm workspace monorepo)

```
mcpinsight/
├── CLAUDE.md
├── README.md
├── LICENSE                                    # MIT
├── pnpm-workspace.yaml
├── package.json                                # workspace root
├── tsconfig.base.json                          # strict, composite
├── .editorconfig
├── .gitignore
├── .npmrc                                      # save-exact = true
├── .nvmrc                                      # 20.11.1
├── biome.json                                  # linter + formatter (lighter than ESLint+Prettier)
│
├── .claude/                                    # Claude Code orchestration
│   ├── agents/
│   ├── skills/
│   ├── prompts/
│   ├── templates/
│   ├── workflows/
│   ├── tasks/
│   ├── config/
│   └── tests/                                  # prompt/agent eval harness
│
├── packages/
│   ├── core/
│   │   ├── src/
│   │   │   ├── types/                          # canonical.ts, license.ts, telemetry.ts
│   │   │   ├── parsers/                        # claude-code.ts, codex.ts, cursor.ts, index.ts
│   │   │   ├── normalizers/                    # claude-code.ts, codex.ts, index.ts
│   │   │   ├── aggregator/                     # ingest.ts, rollups.ts, server-stats.ts
│   │   │   ├── health/                         # score.ts, tool-confusion.ts
│   │   │   ├── db/                             # index.ts, migrations.ts, queries.ts
│   │   │   ├── project/                        # identity.ts
│   │   │   ├── telemetry/                      # consent.ts, anonymize.ts, sync.ts
│   │   │   ├── pro/                            # flagged features, license.ts
│   │   │   └── util/                           # logger.ts, clock.ts (injected for tests)
│   │   ├── migrations/                         # 0001_init.sql, 0002_add_cost_is_estimated.sql
│   │   ├── fixtures/                           # recorded JSONL, sanitized
│   │   ├── test/                               # unit + integration
│   │   └── package.json
│   │
│   ├── cli/
│   │   ├── src/
│   │   │   ├── index.ts                        # shebang + commander setup
│   │   │   ├── commands/                       # scan.ts, top.ts, servers.ts, serve.ts, sync.ts, doctor.ts
│   │   │   └── ui/                             # @clack/prompts helpers
│   │   └── package.json
│   │
│   ├── server/
│   │   ├── src/
│   │   │   ├── index.ts                        # Hono app factory
│   │   │   ├── routes/                         # servers.ts, clients.ts, health.ts, telemetry.ts
│   │   │   ├── middleware/                     # cors.ts, error.ts, logger.ts
│   │   │   └── static.ts                       # serves packages/web/dist
│   │   └── package.json
│   │
│   ├── web/
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── router.tsx                      # TanStack Router
│   │   │   ├── api/                            # fetch client, TanStack Query hooks
│   │   │   ├── components/                     # Shared (Button/Card come from shadcn)
│   │   │   ├── routes/                         # overview.tsx, server-detail.tsx, settings.tsx
│   │   │   ├── copy/                           # en.ts (all user-facing strings)
│   │   │   └── styles/                         # tokens.css (Tailwind), fonts.css
│   │   ├── index.html
│   │   └── vite.config.ts
│   │
│   └── mcp-server/
│       ├── src/
│       │   ├── index.ts                        # stdio server per MCP spec
│       │   └── tools/                          # list-servers.ts, get-health.ts
│       └── package.json
│
├── apps/
│   └── worker/
│       ├── src/
│       │   ├── index.ts                        # Hono on workers
│       │   ├── routes/                         # stripe-webhook.ts, license.ts, telemetry.ts, sotm.ts
│       │   ├── license/                        # ed25519.ts, verify.ts, generate.ts
│       │   └── db/                             # d1 queries
│       ├── migrations/                         # D1 migrations (separate from core's SQLite)
│       ├── wrangler.toml
│       └── package.json
│
├── fixtures/                                   # cross-package recorded JSONL (shared)
│
├── docs/
│   ├── adr/                                    # ADR-0001, ADR-0002...
│   ├── telemetry-schema.md
│   ├── state-of-mcp/                           # methodology.md, first-100.md (drafts + published)
│   ├── open-questions.md
│   └── runbooks/
│
└── .github/
    └── workflows/                              # ci.yml, release.yml, deploy-worker.yml
```

## Naming conventions

- **Package names**: `@mcpinsight/<kebab>` (e.g., `@mcpinsight/core`, `@mcpinsight/cli`). The root `mcpinsight` name on npm ships only the CLI as a user-facing binary (with `core` bundled).
- **Files**: `kebab-case.ts`. One exported concept per file; name matches the concept.
- **Types**: `PascalCase` interfaces/types. Branded IDs where appropriate (`type SessionId = string & { __brand: 'SessionId' }`).
- **Env vars**: `MCPI_<UPPER_SNAKE>` (e.g., `MCPI_DB_PATH`, `MCPI_LOG_LEVEL`).
- **SQL migrations**: `NNNN_snake_case.sql` where `NNNN` is zero-padded sequence; never re-numbered.
- **Commits**: conventional commits (`feat(core):`, `fix(cli):`, `chore(ci):`).

## Modular boundaries

- `packages/core` has **zero** dependency on `packages/server` or `packages/web`. It exposes functions. Server and CLI consume them.
- `packages/cli` depends on `packages/core` only.
- `packages/server` depends on `packages/core` only.
- `packages/web` never imports from `core` directly; it talks to `server` over HTTP. This decouples shipping (web can stay behind; API is the contract).
- `apps/worker` is **completely separate runtime** (Cloudflare Workers, not Node). It uses D1, not SQLite. It shares *types* with core via `packages/core/src/types/license.ts` and `telemetry.ts` only (no runtime dependency).

## Scalability strategy

- Year 1: single-file SQLite per user, single Worker, manual releases.
- Year 2 (if Path A activates): extract `packages/telemetry-pipeline/` as a separate app, add D1 read replicas, consider Postgres for the Worker's license DB if row count > 50k. Decision gate: ADR-required.
- No speculative sharding, no queue, no redis until we have hard numbers showing a bottleneck.
