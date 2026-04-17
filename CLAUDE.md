# CLAUDE.md — MCPInsight Development Orchestration

> **You are working on MCPInsight** — analytics for MCP servers used by AI coding agents (Claude Code, Codex, Cursor).
> This file is the **root context** loaded by Claude Code at every session start.
> Read it fully before taking any action.

---

## 1. Project snapshot

| Field | Value |
|---|---|
| Product | MCPInsight — observability for MCP servers |
| Domain | `mcpinsight.dev` |
| Repo | `github.com/mcpinsight/mcpinsight` (public) |
| Stack | TypeScript, Node 20+, pnpm workspaces, SQLite (better-sqlite3), Hono, React 18 + Vite, Tailwind + shadcn/ui, Cloudflare Workers + D1 |
| Architecture | Local-first CLI + local web UI + single Cloudflare Worker for billing + telemetry |
| Licensing | **Single public bundle** with runtime `license.tier` flags + server-side killer features (no private npm scope) |
| Target MRR (m12, realistic) | ~$1,335 |
| Kill criterion (m12) | < $1,200 MRR |
| Solo dev budget | 18–22 h/week |

**Core truth to internalize:** this is a solo project with an ~8 month competitive window before Anthropic ships native MCP history. Every hour spent on over-engineering is an hour not spent on the data moat (State of MCP).

---

## 2. How to work in this repo

### 2.1. Always read first

Before touching code, Claude must load context in this order:

1. This file (`CLAUDE.md`) — you already have it.
2. `.claude/config/principles.md` — non-negotiable rules.
3. The relevant **skill** file(s) under `.claude/skills/` (e.g., for backend work → `backend-node.md`, `database-sqlite.md`).
4. The relevant **agent** file under `.claude/agents/` if running a specific role.
5. The **task** file under `.claude/tasks/` if executing a predefined workflow.

Do not skip this. Cost of loading 3 short markdown files: ~5 s. Cost of violating an invariant: hours of rework.

### 2.2. Always end with validation

After any non-trivial change:

1. Run `pnpm lint && pnpm typecheck && pnpm test --run` (in the relevant package).
2. Update or create tests — **coverage is enforced at 80% lines, 75% branches for `packages/core`**.
3. If you touched `packages/core/src/db/schema.sql` → add a migration file, never mutate existing migrations.
4. If you touched a parser or normalizer → run `pnpm test:fixtures` which replays 12 recorded JSONL fixtures.

### 2.3. Never do

- Never read `/mnt/user-data/uploads` from production code — that's sandbox-only.
- Never commit `.env`, `~/.mcpinsight/`, `*.db`, or any file under `.claude/tasks/_scratch/`.
- Never introduce a new top-level dependency without justifying it in the PR description. We prefer stdlib + already-present deps.
- Never break the `McpCall` canonical shape in `packages/core/src/types/canonical.ts` without a schema version bump and migration plan.
- Never add a "clever" parser shortcut that only works on current Claude Code format. All client-specific code lives in `parsers/<client>.ts` + `normalizers/<client>.ts` — nothing else.

---

## 3. The multi-agent model

Work is split into 10 specialized agents. Each has a dedicated file in `.claude/agents/` describing role, inputs, outputs, collaboration rules, and prompts.

| Agent | When to invoke | File |
|---|---|---|
| **Product Manager** (PM) | Shaping a feature, writing acceptance criteria, prioritizing backlog | `.claude/agents/product-manager.md` |
| **Architect** | Cross-package decisions, schema changes, choosing libraries | `.claude/agents/architect.md` |
| **Backend Engineer** | Work inside `packages/core`, `packages/server`, `apps/worker` | `.claude/agents/backend-engineer.md` |
| **Frontend Engineer** | Work inside `packages/web` (React + Vite dashboard) | `.claude/agents/frontend-engineer.md` |
| **DevOps** | CI, Cloudflare deployments, monorepo tooling, release scripts | `.claude/agents/devops.md` |
| **QA / Test** | Test strategy, fixtures, regression gates, coverage audits | `.claude/agents/qa-test.md` |
| **Documentation** | README, API docs, SKILL files, blog posts (State of MCP) | `.claude/agents/documentation.md` |
| **Prompt Engineer** | Owns `.claude/prompts/`, refines agent prompts, tunes evaluations | `.claude/agents/prompt-engineer.md` |
| **UI Designer** | Visual design, Tailwind tokens, shadcn customizations | `.claude/agents/ui-designer.md` |
| **UX Researcher** | Onboarding flows, telemetry opt-in modal copy, alpha-feedback synthesis | `.claude/agents/ux-researcher.md` |

Agents communicate through **contracts**, not prose. Every agent file specifies its I/O contract (what it accepts, what it returns). See `.claude/workflows/agent-collaboration.md` for the orchestration patterns (sequential, parallel, review loop).

### 3.1. Default agent for a session

If no agent is specified, Claude acts as the **Architect** for the first turn — enough to decide which specialized agent should own the work, then hand off.

---

## 4. Repository map (what lives where)

```
mcpinsight/
├── CLAUDE.md                         # THIS FILE — root orchestration
├── .claude/                          # Claude Code workspace (agents, skills, prompts, workflows)
├── packages/
│   ├── core/                         # Parsers, normalizers, aggregator, Health Score, SQLite
│   ├── cli/                          # commander + @clack/prompts
│   ├── server/                       # Hono local REST API
│   ├── web/                          # React + Vite dashboard
│   └── mcp-server/                   # Self-referential MCP server (Claude asks about its own stats)
├── apps/
│   └── worker/                       # Cloudflare Worker: licenses + telemetry ingest + State of MCP API
├── fixtures/                         # Recorded JSONL samples from real users (anonymized)
├── migrations/                       # SQL migrations (append-only; never edit applied ones)
├── docs/                             # Strategic docs, ADRs, State-of-MCP methodology
└── .github/workflows/                # CI
```

Full structure with naming conventions: `.claude/config/repo-structure.md`.

---

## 5. Current phase

Track phase in `.claude/config/phase.md`. Update it at every week-boundary retro.

As of **2026-04-17**, phase is `WEEK_1_VALIDATION`. See `.claude/tasks/phase-validation.md` for the step-by-step.

Phases, in order:
1. `WEEK_1_VALIDATION` — no code. Interviews, Reddit, Twitter, GitHub issue scanning.
2. `WEEK_2_MVP_PARSER` — monorepo scaffolding, Claude Code parser, SQLite, CLI `top`.
3. `WEEK_3_MULTI_CLIENT_UI` — Codex parser, Hono API, React dashboard, Health Score v2.
4. `WEEK_4_LICENSING_SOFT_LAUNCH` — Worker + Stripe + telemetry opt-in + soft launch.
5. `POST_LAUNCH` — public launch, State of MCP cadence, Team tier buildout.

Do not skip ahead. A polished Week 3 deliverable that lacks Week 1 validation evidence is worth less than a rough Week 2 deliverable that does.

---

## 6. Critical technical invariants (do not break)

These are distilled from the Biblia v4 critical-analysis section. Violating any of them has a measured multi-week cost.

### INV-01: `project_identity` is derived from `git remote`, not `cwd`
Exists to survive `mv`, `rename`, `clone`. Fallback to `sha256(cwd)` only when no remote is set. Implementation: `packages/core/src/project/identity.ts`.

### INV-02: `cost_usd` always ships alongside `cost_is_estimated: 0|1`
Never treat an estimated cost as a real cost in aggregations. `State of MCP` only uses `cost_is_estimated = 0` rows for any cost statistic.

### INV-03: Telemetry schema is versioned from v1
`telemetry_consent.consent_version` and `schema_fields` are required. New fields → new version. Never drop fields.

### INV-04: Self-referential MCP server excluded from rankings
`SELF_REFERENCE_SERVERS = new Set(['mcpinsight'])`. Hardcoded in aggregator. Unit-tested.

### INV-05: Parsers do not speak to DB. Normalizers do not speak to DB. Aggregator owns writes.
One-way flow: `raw JSONL → parser → normalizer → canonical McpCall → aggregator → SQLite`. Breaking this flow = regression risk when adding clients.

### INV-06: Polling first (MVP), chokidar never in `packages/core` before m3
Polling every 5 s on `scan_state.last_byte_offset` is boring, predictable, zero race conditions. Event-driven is a phase-2 opt-in.

### INV-07: No private npm scope. Pro features live in the main bundle, gated by `license.tier`.
Killer features that *need* protection live server-side in `apps/worker`. Local code is all-or-nothing visible.

### INV-08: Every user-facing string ships in English first
No i18n framework in year 1. Copy lives in `packages/web/src/copy/` as plain TS exports.

If a change appears to require breaking an invariant, stop and escalate to the Architect agent. Do not silently work around it.

---

## 7. Commands cheatsheet

```bash
# Setup
pnpm install                        # from repo root
pnpm build                          # all packages

# Dev loop
pnpm --filter @mcpinsight/cli dev   # watch CLI
pnpm --filter @mcpinsight/web dev   # Vite dev server
pnpm --filter @mcpinsight/server dev

# Tests
pnpm test                           # all packages, unit + integration
pnpm test:fixtures                  # parser fixtures (slower)
pnpm test:e2e                       # Playwright, only in CI by default

# Quality gates
pnpm lint
pnpm typecheck
pnpm coverage                       # enforces 80/75

# DB
pnpm --filter @mcpinsight/core db:migrate   # apply pending migrations
pnpm --filter @mcpinsight/core db:new       # scaffold new migration

# Worker
pnpm --filter @mcpinsight/worker dev       # wrangler dev
pnpm --filter @mcpinsight/worker deploy    # wrangler deploy (main only)
```

---

## 8. Escalation ladder

If stuck:
1. Re-read the relevant skill file in `.claude/skills/`.
2. Check `docs/adr/` for a relevant Architecture Decision Record.
3. Invoke the Architect agent with a concise framing.
4. If still stuck: write the question + 3 options + your recommendation to `docs/open-questions.md` and move on. Do not block on ambiguity.

---

## 9. Meta

This file is versioned. Every edit that changes an invariant or a phase requires a note in the commit message: `CLAUDE.md: <what changed> — <why>`.

Last significant update: 2026-04-17 (initial workspace).
