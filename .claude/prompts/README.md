# Prompts Library

Canonical source for every prompt used by agents. Agent files link here by path so there's one place to change.

## Layout

```
.claude/prompts/
├── README.md                        # this file
├── CHANGELOG.md                     # version history
├── system/                          # one file per agent
│   ├── architect.md
│   ├── product-manager.md
│   ├── backend-engineer.md
│   ├── frontend-engineer.md
│   ├── devops.md
│   ├── qa-test.md
│   ├── documentation.md
│   ├── prompt-engineer.md
│   ├── ui-designer.md
│   └── ux-researcher.md
├── task/                            # reusable task templates
│   ├── implement-story.md
│   ├── review-pr.md
│   ├── write-tests.md
│   ├── debug-failing-test.md
│   ├── synthesize-feedback.md
│   └── draft-changelog.md
├── validation/                      # review/critic prompts
│   ├── architect-review.md
│   ├── copy-critique.md
│   └── coverage-audit.md
└── debugging/                       # failure-diagnosis prompts
    ├── parser-regression.md
    ├── flaky-test.md
    └── webhook-idempotency.md
```

## Versioning

- Each prompt file has a front-matter `version: N` integer.
- Any non-trivial edit bumps `version` and appends a line to `CHANGELOG.md`.
- The Prompt Engineer agent is the only agent allowed to bump versions; they run evals before/after.

## Composition

Agent files in `.claude/agents/*.md` quote excerpts of these prompts inline for readability, but the **source of truth** is this directory. If they drift, the version in `.claude/prompts/system/<n>.md` wins.

## Usage in Claude Code

When a user invokes an agent, Claude Code loads:

1. `CLAUDE.md` (root)
2. `.claude/config/principles.md`
3. `.claude/agents/<agent>.md`
4. `.claude/prompts/system/<agent>.md` (authoritative system prompt)
5. Any relevant skill files referenced in the agent definition.

This is the canonical load order. If disagreement, the **more specific** file wins (i.e., skill beats root principles where they overlap on technical choice).
