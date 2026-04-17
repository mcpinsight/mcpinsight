# User Story Template

Use this for every story added to `docs/backlog.md`.

```markdown
## STORY-NNN: <Short title>

**Status**: proposed | ready | in-progress | done | deferred
**Persona**: P1 | P2 | P3
**Size**: S | M | L   (S ≤ 4h, M ≤ 12h, L ≤ 3 days)
**Phase**: <WEEK_N_... from .claude/config/phase.md>
**Owner**: <agent or name>

### Story
As a <persona description>, I want <capability>, so that <outcome>.

### Acceptance criteria
- Given <pre-state>, when <action>, then <observable result>.
- Given <pre-state>, when <action>, then <observable result>.

### Metric to watch
<what number changes — conversion, opt-in rate, scan time, etc.>

### Kill switch
<when to revisit or remove — e.g., "if opt-in rate stays <15% after 2 weeks, reshape the modal">

### Out of scope (explicit)
- <what we are NOT doing>
- <what we are NOT doing>

### Invariants touched
- <INV-XX or "none">

### Dependencies
- STORY-XXX (must ship first)
- external: <e.g., "Stripe Checkout must be in production mode">

### Notes / references
- research/<file>
- ADR-XXXX
```

## Rules

- Every story has exactly one persona. If you're tempted to list two, split it into two stories.
- Acceptance criteria use Given/When/Then. At least two.
- "Out of scope" prevents drift in implementation. Write it even if it feels obvious.
- "Kill switch" is load-bearing — forces the writer to think about what "failed" looks like.
