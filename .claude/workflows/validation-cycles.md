# Workflow: Validation Cycles

Three layers of validation run on different clocks. Each catches a different failure mode.

## Layer 1 — Invariant validation (per PR)

**Catches**: regressions in the 8 invariants from `CLAUDE.md §6`.
**Cadence**: every PR.
**Owner**: Architect (for type/schema/REST), QA (for parsers/fixtures), Prompt Engineer (for prompt files).

**Mechanism**:
1. CI runs `pnpm lint && pnpm typecheck && pnpm test && pnpm coverage` — automated.
2. Reviewer runs the PR-review prompt (`.claude/prompts/validation/review-pr.md`) — 5 questions, must answer all.
3. If the PR touches `packages/core/src/types/` → Architect mandatory-review. No self-merge.

**Stop rule**: 2 review rounds max. If still contested, escalate to an ADR. ADR decides, PR goes back once more, merges.

## Layer 2 — Phase validation (per phase boundary, ~weekly)

**Catches**: reality drift from plan. "We think we're shipping, but actually we're not hitting exit criteria."
**Cadence**: end of each phase (see `.claude/tasks/phase-*.md`).
**Owner**: solo dev + accountability partner.

**Mechanism**:
1. Open `.claude/config/phase.md`.
2. Check every exit-criterion box.
3. Produce a phase retro (`.claude/templates/retro.md`).
4. Decide: advance, extend, or pivot.

**Stop rule**: two consecutive extensions of the same phase = strategic review triggered.

## Layer 3 — Strategic validation (monthly)

**Catches**: the business losing, even though the tactics are on track. E.g., shipping features on time but MRR is at 30% of projection.
**Cadence**: first Monday of each month.
**Owner**: solo dev + accountability partner; outputs read by no one else unless they ask.

**Mechanism**:
1. Compare actuals to Biblia v4 realistic projection (`docs/biblia-projections.md` — TODO: extract from biblia).
2. Check the early-warning signals table (Biblia v4 §1.4):
   - Anthropic release notes for "MCP usage history" or "per-server"
   - ccusage CHANGELOG for any "MCP" mention
   - context-mode release notes for "analytics dashboard"
3. Write `docs/strategic-reviews/YYYY-MM.md` — one page, three sections: Numbers / Signals / Decision.

**Outputs**:
- "On track": no action.
- "Off track, tactical": adjust next phase's scope (usually cut, rarely add).
- "Off track, strategic": invoke Pattern D (Research → decision → execute) with the pivot options from Biblia v4 §9.3 (Plan B scenarios).

**Stop rule**: two consecutive months at <70% of realistic MRR projection = trigger the kill criteria review from `.claude/config/principles.md` P10.

## What each layer doesn't catch

- Layer 1 doesn't catch "we're building the wrong thing well". That's Layer 2.
- Layer 2 doesn't catch "we're executing the plan, but the plan was wrong". That's Layer 3.
- Layer 3 doesn't catch "a subtle bug silently corrupts parser output". That's Layer 1 (invariant + fixture).

All three are needed. Dropping any one is a known failure mode.

## Relationship to kill criteria

The kill criteria are not separate from validation — they are the **output** of the strategic-review layer. If Layer 3 reveals two months of <70% MRR, we don't immediately kill; we invoke the strategic review process, which *may* lead to a kill decision if Plan B options also fail.

Killing is supposed to feel hard. That's why the criteria are written ahead of time (P10) — so the decision isn't made under the psychological pressure of the moment.
