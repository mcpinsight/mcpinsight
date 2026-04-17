# Prompt Eval Harness

Tests that agent prompts produce expected-shape outputs against recorded examples.

## Structure

```
.claude/tests/
├── README.md                      # this file
├── flake-log.md                   # QA's flaky-test registry
├── prompt-evals/
│   ├── architect/
│   │   ├── EX-001-schema-change/
│   │   │   ├── input.md           # the user/agent input
│   │   │   ├── expected.yaml      # shape assertions
│   │   │   ├── rubric.md          # 0-1 scale questions for Claude-graded check
│   │   │   └── actual/            # gitignored; populated per-run
│   │   └── EX-002-library-choice/
│   ├── product-manager/
│   ├── backend-engineer/
│   └── ... one per agent
└── run-evals.ts                   # harness entrypoint
```

## How an eval is structured

### `input.md`

The exact input the agent receives. No meta-commentary.

```markdown
[ARCHITECT REVIEW REQUEST]

Context:
We need to add a new column `retry_count` to `mcp_calls` to track agent retry behavior.

What changed / what is proposed:
Straight ALTER TABLE + normalizer update.

Their recommendation:
Migration 0003_add_retry_count.sql with DEFAULT 0.

Constraints:
- Phase: WEEK_3_MULTI_CLIENT_UI
- Time budget: 1h
- Reversibility required: medium

Invariants possibly affected:
INV-05 (one-way data flow)
```

### `expected.yaml`

Structural assertions only — what must exist in the output.

```yaml
required_keys:
  - decision
  - reasoning
  - if_approved.invariants_touched
  - if_approved.required_tests
  - if_approved.migration_required
  - if_approved.adr_required

values:
  decision:
    oneOf: [approved, rejected, needs-adr, escalate]

constraints:
  reasoning:
    type: list
    min_length: 3
    max_length: 7
```

### `rubric.md`

Three 0–1 questions Claude grades the actual output against:

```markdown
1. Does the reasoning reference at least one specific INV-xx or file path? (yes/no → 1/0)
2. Does the decision match the migration rules (append-only, nullable/defaulted)? (yes/partial/no → 1/0.5/0)
3. Does the output follow the YAML contract exactly (no prose outside YAML)? (yes/no → 1/0)

Pass threshold: average ≥ 0.8.
```

## Running evals

```bash
pnpm --filter claude-eval run                 # runs every eval, reports pass/fail
pnpm --filter claude-eval run --agent architect   # only architect evals
pnpm --filter claude-eval run --record EX-003 # records a new expected from current prompt
```

The harness:
1. Reads `input.md`.
2. Constructs the agent's full system + task prompt (per `.claude/prompts/system/<agent>.md`).
3. Sends to Claude API; captures output to `actual/<timestamp>.md`.
4. Validates shape against `expected.yaml` (JSON-schema style).
5. Asks Claude (second call) to grade actual vs rubric; parses numeric scores.
6. Pass = all shape checks pass AND average rubric ≥ 0.8.

## When to add an eval

- When adding a new agent (minimum: 3 evals per agent, covering a clear pass, a clear edge-case, and a correctly-rejected bad request).
- When refining a prompt to fix a regression (add the example that caused the regression).
- When a PM or engineer notices "the agent keeps getting this wrong" — that's an eval.

## When NOT to add an eval

- When the test is really about code correctness (that's Vitest, not eval).
- When the variance between runs is expected and irrelevant (rubric at 0.8 gives enough headroom).
- When there's no measurable pass/fail signal — "does it sound professional?" is not an eval.

## Governance

- Prompt Engineer owns additions/removals.
- Evals stay deterministic: pinned model, `temperature: 0.2`, max_tokens bounded.
- Results stored as markdown artifacts, not JSON, so diffs are human-readable.
