# Workflow: Agent Collaboration Patterns

How the 10 agents actually work together. Pick a pattern based on the shape of the task.

## Four patterns

### Pattern A — Sequential pipeline (most common)

Linear hand-off. Good for: a new feature story from idea to shipped code.

```
UX Researcher  →  PM  →  Architect  →  Backend  →  QA  →  Documentation
   (evidence)    (story)  (decision)   (code)    (tests)  (changelog)
                                        ↓
                                   Frontend (parallel)
```

**When to use**: any new user-visible capability. Default pattern.

**Rules**:
- Each agent returns its Output Contract before the next starts.
- If an agent rejects (e.g., Architect vetoes a story), it goes back to the prior stage with reasoning, not sideways.
- No agent starts without the prior agent's output in context.

### Pattern B — Parallel fan-out

Two or more agents work on independent slices of the same story simultaneously.

```
PM  →  Architect  →  ┬─ Backend (API endpoint)
                     ├─ Frontend (UI shell with mocked data)
                     └─ UI Designer (mock markdown)
                     ↓
                   Integration point: Frontend wires to real API
```

**When to use**: UI + API for the same feature. Lets frontend develop against a mock while backend ships the real thing.

**Rules**:
- The **API contract is written first** and committed to `docs/api-contract.md`. That's the integration point.
- Frontend uses MSW to mock the contract until Backend lands.
- Integration PR is its own commit with both real endpoints and frontend wired up. Small.

### Pattern C — Review loop

Critic agent gates the producing agent's output.

```
Producer (Backend)  →  Reviewer (Architect or QA)  →  ┬── approved → merge
                                                     └── changes-requested → back to Producer
```

**When to use**:
- Any PR touching `packages/core/src/types/`, a migration, or a REST endpoint shape → Architect reviews.
- Any PR adding/changing a parser/normalizer → QA reviews (fixture check).
- Any PR changing a prompt file → Prompt Engineer reviews (eval check).

**Rules**:
- Reviewer uses the validation prompt in `.claude/prompts/validation/review-pr.md`.
- A "changes-requested" outcome lists specific line-level issues, not vibes.
- Max 2 review rounds before escalation to "decide and move on" by the Architect.

### Pattern D — Research → decision → execute

For ambiguous problems where the first question is "is this even the right thing to build?".

```
UX Researcher  →  PM (drafts options)  →  Architect (scores options)  →  PM (picks)  →  Pattern A
   (data)          (reframes)              (technical trade-offs)         (story)
```

**When to use**: feature requests from users that don't obviously map to an existing story; competitive responses; pivot decisions.

**Rules**:
- Research budget capped at 1 day. If you can't find enough signal in 1 day, ship a probe instead.
- PM's options list has ≥2 alternatives with honest trade-offs.
- Architect scores on (complexity, maintenance, reversibility); PM scores on (Pro conversion, moat, retention). Final call is PM's.

## Batch vs real-time

**Real-time**: an active session where Claude runs multiple agents in sequence within one conversation. Used during implementation work.

**Batch**: a scheduled sweep — e.g., weekly backlog triage, weekly flake audit, monthly retro. Used for maintenance work. Outputs go into `docs/` or `research/` folders.

### Batch jobs schedule

| Job | Agent | Cadence | Output |
|---|---|---|---|
| Backlog triage | PM | Monday morning | `docs/backlog.md` reordered |
| Alpha-feedback synthesis | UX | Weekly (Friday) | `research/alpha-feedback.md` themes |
| Flake audit | QA | Weekly | `.claude/tests/flake-log.md` reviewed |
| Coverage audit | QA | End of each phase | `docs/coverage-<phase>.md` |
| Dependency audit | DevOps | Monthly | `docs/deps-<YYYY-MM>.md` |
| Prompt eval run | Prompt Engineer | On prompt-change + monthly | `.claude/tests/prompt-evals/<agent>/results.md` |

## Task orchestration rules

1. **One agent speaks at a time.** Even in parallel (Pattern B), each agent produces its artifact independently; the orchestrator (human or session Claude) merges.
2. **Contracts are the API between agents.** If an agent's output doesn't match its declared contract, it's not done.
3. **No implicit context.** Each agent re-reads `CLAUDE.md` + its own file + referenced skills. We don't assume memory carries.
4. **Escalation is valid output.** An agent that returns `status: blocked` with a clear question has done its job. The orchestrator resolves.
5. **Time-box every agent turn.** Backend implementing a Medium story: 2–4 hours. If it runs over, break it into smaller stories (or accept scope cut).

## Iteration loops

Every phase has a **build → test → demo → retro** loop:

```
build  →  test (QA gates)  →  demo (to alpha testers or self)  →  retro (journal/week-NN-retro.md)
  ↑                                                                            │
  └────────────────────────────── lessons feed next build ─────────────────────┘
```

- **build** happens in ≤4-hour focused sessions with one agent at a time.
- **test** is automated (CI) plus exploratory (QA-Test agent spending 30 min poking around).
- **demo** is a screen recording, a CLI transcript, or a live call with a pre-salowiec. No unshown demo counts.
- **retro** is written, not verbal. Template in `.claude/templates/retro.md` (TODO: add).

## Validation cycles

Three levels of validation, applied at different cadences:

1. **Invariant validation** (every PR): Architect or QA runs the PR review prompt.
2. **Phase validation** (end of each week): do the exit criteria in `.claude/config/phase.md` hold? If not, the phase extends — don't pretend.
3. **Strategic validation** (every 4 weeks): do metrics match the Biblia v4 realistic projection? If MRR is <70% of projection for two consecutive checkpoints, PM + solo-dev hold a "Pivot or Persist?" session. Outcome documented in `docs/strategic-reviews/YYYY-MM.md`.

## When to break the pattern

If a task is under 30 minutes of total work and doesn't touch invariants → act as one agent (usually Backend or Documentation) without the full pipeline. Patterns are scaffolding; they exist to prevent shortcuts on serious work, not to slow down trivial work.
