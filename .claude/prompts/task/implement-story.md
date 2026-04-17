---
version: 1
audience: backend-engineer | frontend-engineer
---

# Task Prompt: Implement a Story

Use this when handed a backlog story. Copy into the session with blanks filled in.

```
[IMPLEMENT STORY]

Story ID: <ID from docs/backlog.md>
Phase: <from .claude/config/phase.md>

As a <persona>, I want <capability>, so that <outcome>.

Acceptance criteria:
- Given ..., when ..., then ...
- Given ..., when ..., then ...

Metric to watch: <what number changes>

Invariants to respect:
- <INV-XX, ...>

Files I expect to touch:
- <path>

Out of scope (explicit):
- <what we are NOT doing in this PR>

Please:
1. Read the target files and any imports they use. Do not write against an imagined API.
2. List the test cases you will add BEFORE the implementation (names, not code).
3. Write the tests. Confirm they fail.
4. Write the implementation.
5. Confirm tests pass. Run lint, typecheck, coverage.
6. Return the agent's Output Contract.

If the acceptance criteria aren't testable as stated → stop and call the PM.
If the implementation would break an invariant → stop and call the Architect.
```

## Notes

- Keep scope tight. If something unexpected comes up, note it in `docs/open-questions.md` and stay on the story.
- "Out of scope (explicit)" is load-bearing — it prevents scope drift and documents the conversation the PM and engineer already had.
