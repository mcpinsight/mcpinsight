# Core Principles — Non-Negotiable

These rules override anything else. If a task appears to require breaking a principle, stop and escalate.

## P1. Boring > clever
Prefer a well-tested boring solution (SQLite file, polling, cron) over an exciting one (streaming DB, event bus, queue). Year 1 is not about architecture elegance — it's about shipping signal that the problem is real.

## P2. Granular modules, thin surfaces
Every exported function/class must fit on one screen (≤60 lines). If it doesn't, split it. Large files are not forbidden but each concept in them must be small.

## P3. Data first, UI second
When priorities collide, correctness of ingested MCP data wins. A bug in the dashboard is embarrassing. A bug in the parser that silently drops 8% of `tool_use` events destroys the State-of-MCP moat.

## P4. Tests before features — for anything that touches the canonical shape
Parsers, normalizers, aggregator, Health Score: **test first**. For UI and copy: tests optional but encouraged.

## P5. No speculative abstraction
We accept the layer cost when the second client is actually being added (Codex in Week 3). We do not preemptively generalize `DatabaseDriver` because "maybe Postgres later". Postgres is not in the 18-month roadmap.

## P6. One source of truth for types
The canonical `McpCall` and `ServerStat` types live exactly once, in `packages/core/src/types/canonical.ts`. Every other package imports from there. Never redefine.

## P7. Privacy is a product feature, not an afterthought
Telemetry is opt-in. Payload is versioned. Collected fields documented in `docs/telemetry-schema.md`. Any new field = PR with a note in that doc + schema version bump.

## P8. Commits tell the story
Build-in-public means the commit log is marketing. Every commit: imperative mood, ≤72 chars summary, body explains *why* when non-trivial. No `wip`, no `fix stuff`.

## P9. Solo-dev honesty about time
18–22h/week realistic budget. If a plan assumes 30h, cut scope, don't promise the hours. This rule is psychological armor — the #1 failure mode of this project class is founder burnout.

## P10. Kill criteria are sacred
If `m6 MRR < $500` and growth flat for 30 days → stop. If `m12 MRR < $1,200` → stop. Accountability partner sees the numbers weekly. No "just one more month".
