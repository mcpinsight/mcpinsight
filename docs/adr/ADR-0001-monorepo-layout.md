# ADR-0001: Monorepo layout with pnpm workspaces

- **Status**: accepted
- **Date**: 2026-04-18
- **Author**: Architect (MCPInsight)
- **Deciders**: solo dev + Architect agent

## Context

MCPInsight ships as a CLI (`mcpinsight`), a local HTTP server (Hono), a React dashboard, and a Cloudflare Worker. These share types, but they have different runtimes (Node / browser / Workers) and release cadences.

Biblia v4 §2.1 rejected the earlier v3 plan of a private npm scope for Pro features. The alternative options for code organization were:

1. **Single repo, flat layout**: everything in `src/` — no package boundaries.
2. **Single repo, pnpm monorepo**: one `packages/` tree + one `apps/` tree; each package publishable independently if needed.
3. **Multi-repo**: separate repos per runtime.

Solo developer budget is 18–22 h/week. Operational overhead of publishing & versioning must be minimal.

## Decision

Adopt a pnpm monorepo (option 2). Layout:

```
packages/            # shared, versioned npm units
  core/              # parsers, normalizers, aggregator, SQLite, Health Score
  cli/               # the 'mcpinsight' binary on npm
  server/            # Hono local REST API
  web/               # React + Vite dashboard (bundled by server)
  mcp-server/        # self-referential MCP server

apps/                # deployable units, not on npm
  worker/            # Cloudflare Worker: licenses, telemetry ingest, State-of-MCP API
```

- **pnpm** (not npm, not yarn) for workspace support and disk efficiency.
- **changesets** for versioning only the publishable packages; `apps/*` are not versioned.
- One `tsconfig.base.json` at root; packages extend it.
- One linter (Biome); one test runner (Vitest) with per-package configs.

## Alternatives considered

- **Flat single repo**: simpler on day 1 but forces parser code and dashboard code to share a build tree and dependencies. Breaks the principle that web never imports from core directly (INV boundary in `CLAUDE.md`).
- **Multi-repo**: each repo has separate CI, versioning, and release. For a solo dev this is hours of overhead per change. Rejected on principle P1 ("boring > clever") and P9 (time budget).
- **Turborepo / Nx**: more powerful task orchestration. Rejected for Y1 — pnpm's own filter flags (`--filter @mcpinsight/core`) cover the 80% case. We can add Turbo later if build times bite.

## Consequences

### Positive

- One PR can touch API + UI atomically (common for feature work).
- Shared types in `packages/core/src/types/` enforce INV-05 (one source of truth).
- Easy to add the MCP server package (`packages/mcp-server`) without spinning up new CI.

### Negative

- Requires understanding pnpm workspace filter syntax — small learning curve.
- Bundle isolation is convention-only; nothing prevents `packages/web` from directly importing `packages/core` (it's enforced via lint rule + review, not tooling).

### Neutral / trade-offs

- `apps/worker` lives in the same repo but uses a completely different runtime (Cloudflare Workers). We accept that it can't share runtime code with Node packages — only types.

## Invariants touched

- Establishes INV-05 (one-way data flow) as enforceable: parsers, normalizers, aggregator, and DB live in distinct folders under `packages/core/src/`.
- Establishes INV-07 (single public bundle): `packages/core` contains Pro features gated by `license.tier`; no private scope.

## Migration / follow-up

- [x] Configure `pnpm-workspace.yaml`.
- [x] Root `package.json` with `packageManager: pnpm@9.1.0`.
- [x] `tsconfig.base.json` at root.
- [x] Biome config at root.
- [ ] Add `changesets` when first package is published (not in Week 2).
- [ ] CI matrix with `pnpm install --frozen-lockfile` (`.github/workflows/ci.yml` — done).

## References

- Biblia v4 §2.1 — simplified architecture (no private npm).
- pnpm workspace docs: https://pnpm.io/workspaces
