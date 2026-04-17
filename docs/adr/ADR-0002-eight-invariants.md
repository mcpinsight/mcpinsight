# ADR-0002: Eight invariants as the technical contract

- **Status**: accepted
- **Date**: 2026-04-18
- **Author**: Architect (MCPInsight)
- **Deciders**: solo dev + Architect agent

## Context

Biblia v4 identified four technical traps that surfaced only after v3 and would cost weeks if discovered in month 4 instead of week 2 (project-hash stability, cost-estimation flag, telemetry schema versioning, self-referential server pollution). Beyond those four, the project needs a small set of invariants that hold across weeks and multiple agents.

Solo developers have one working memory. Multi-agent LLM workflows have none. Both need an explicit contract to prevent drift.

## Decision

Publish 8 invariants at the top of `CLAUDE.md §6`. Every agent reads them at session start. Every PR touching `packages/core/src/types/`, a migration, or a REST endpoint requires the Architect agent to verify the invariants aren't silently broken.

The 8 invariants:

| INV | One-line | Why it matters |
|---|---|---|
| INV-01 | `project_identity` from `git remote`, not `cwd` | Survives `mv`, rename, clone |
| INV-02 | `cost_usd` always paired with `cost_is_estimated` | State-of-MCP cost stats stay credible |
| INV-03 | Telemetry schema is versioned from v1 | No forced re-opt-in when fields grow |
| INV-04 | Self-referential MCP server excluded from rankings | Trivial bug class, permanent fix |
| INV-05 | Parsers/normalizers don't touch DB; aggregator owns writes | Client expansion stays linear, not quadratic |
| INV-06 | Polling first (5s), chokidar never in `core` before m3 | Predictability > real-time until users demand it |
| INV-07 | No private npm scope; Pro gated by `license.tier` | Saves ~5h/week operational overhead |
| INV-08 | English-only strings in Y1 | No i18n framework until 3 paying users ask |

## Alternatives considered

- **No explicit invariants, just "senior judgment"**: works until the third parser's normalizer drifts; debt accumulates silently. Rejected — our memory (solo dev + LLM agents) is worse than we'd like to admit.
- **Enforce via ESLint rules**: possible for some (INV-05 via import bans), impossible for most. ESLint wouldn't catch an INV-02 violation in SQL. Rejected as insufficient; chosen as a complement for INV-05.
- **Much longer list of rules**: tempting for completeness. Rejected — 8 is the working-memory limit. Adding INV-09 means removing something else.

## Consequences

### Positive

- Agent prompts (in `.claude/agents/*.md`) reference invariants by number. Shared vocabulary.
- Architect reviews become fast: 5-question template, each mapping to invariants.
- Every ADR that modifies an invariant is a loud event, not a silent drift.

### Negative

- If a new kind of technical constraint arises that genuinely deserves invariant status, we have to either (a) accept the list growing to 9+, or (b) drop one. The forcing function is deliberate.

### Neutral

- Invariants are expressed in plain English, not as automated rules. Enforcement is via (human + agent) review. This is a feature: machine-enforceable rules encourage minimum-compliance; human-read rules encourage understanding.

## Invariants touched

Creates the set. Each subsequent ADR that modifies one lists it here.

## Migration / follow-up

- [x] Publish list in `CLAUDE.md §6`.
- [x] Agent files reference INVs by number.
- [x] PR-review prompt (`.claude/prompts/validation/review-pr.md`) checks INV-compliance explicitly.
- [ ] Add minimal Biome rules where enforceable (INV-05 via banned imports between `packages/web` and `packages/core`).

## References

- Biblia v4 §2.2 — the four technical traps.
- `CLAUDE.md §6` — canonical invariant list.
