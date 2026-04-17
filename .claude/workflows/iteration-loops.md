# Workflow: Iteration Loops

How we iterate at three timescales. Each loop has inputs, outputs, a decision, and a stop rule.

## Loop 1 — The session loop (hours)

**Cadence**: every focused work block (2.5–3 hours per the 30-day plan).

```
Plan (5 min)
  ↓
Context load (5 min — read CLAUDE.md, relevant agent, relevant skills)
  ↓
Build (main time)
  ↓
Test (lint + typecheck + test --run for affected package)
  ↓
Commit + short journal line (5 min)
```

**Inputs**: the story being worked on + the relevant phase from `.claude/config/phase.md`.

**Outputs**: one or more commits, each standalone and green.

**Stop rule**: if at the end of a session the tests aren't green, **revert local work** and write what stuck in `docs/open-questions.md`. Don't leave broken state overnight.

## Loop 2 — The week loop

**Cadence**: Sunday retro + Monday plan.

```
Sunday (45 min)
  ├── Retro: what shipped? what didn't? why?
  ├── Metrics check: MRR, waitlist, pre-sale, opt-in rate
  └── Red flags? (>25h/week, missed deliverable 3 days in a row, etc.)
       ↓
Monday (30 min)
  ├── Read .claude/config/phase.md — still correct?
  ├── Pull backlog: top 3 stories for the week (cumulative ≤22h)
  └── Pick a pattern (A/B/C/D from agent-collaboration.md) per story
```

**Inputs**: the week's outputs, current metrics, current phase.

**Outputs**: `journal/week-NN-retro.md` + `journal/week-MM-plan.md`.

**Stop rule**: if retro shows 3 weeks below expected throughput, **scope cut** (remove stories), don't add hours. The rule from principles.md P9.

## Loop 3 — The phase loop (2–4 weeks)

**Cadence**: at each phase boundary (see `.claude/config/phase.md`).

```
Phase exit criteria met?
  ├── Yes → advance phase, update phase.md, announce in journal
  ├── Partial → extend phase by up to 50% of original duration, document why
  └── No → escalate to "Pivot or Persist?" session
```

**Inputs**: phase exit criteria (in each `phase-*.md` task file).

**Outputs**: updated `.claude/config/phase.md` + phase retro (`docs/phase-retros/<phase>.md`).

**Stop rule**: two consecutive extensions on the same phase is a signal the plan was wrong. Call a strategic review.

## Common pitfalls

1. **Accumulating debt across sessions** — ending sessions with half-working code. Rule: revert if not green by session end.
2. **Silent phase extension** — working on the next phase's stuff while still not done with current. Phase changes are explicit events.
3. **Metrics vibes** — "feels like it's growing". Metrics live in a spreadsheet (or `docs/metrics.md`) with numbers and dates.
4. **Retrospectives that are journals, not analyses** — a retro lists 2 things to change next week. If not, it's not a retro.

## Templates referenced

- `.claude/templates/retro.md` — weekly retro shape (created with this file).
