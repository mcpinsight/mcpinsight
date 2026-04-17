# Pull Request

<!-- Delete sections that don't apply, but don't leave them empty to fake completeness. -->

## What this PR does
<1-3 sentences. No marketing; just the change.>

## Story
Closes STORY-NNN.

## Why
<If not obvious from the story link. Link to research, user quote, or metric.>

## Changes
- packages/<pkg>: <what changed>
- packages/<pkg>: <what changed>

## Tests
- Unit: <count added / modified>
- Integration: <count>
- Fixtures: <added? removed?>
- Coverage delta: <+/- X% on affected package>

## Invariants
- Respected: <INV-XX, ...> or "none applicable"
- Changed: <INV-XX> (requires ADR link) or "none"

## Migration
- DB: <migration file path> or "none"
- Data: <describes any backfill required> or "none"

## Rollback plan
<One or two lines. "Revert the commit" counts only if no migration was applied.>

## Screenshots / recordings
<For UI changes. Before + after.>

## Reviewer focus
<What should the reviewer look at hardest? E.g., "the edge-case branch in normalizer.ts line 47">
```

## Rules

- No PR description says "fixes stuff" or "improvements". Name the change.
- If you changed a public contract (types, SQL, REST shape), the description lists the ADR that blessed it. No ADR → blocked.
- Screenshots only where they add signal. A CLI output diff is better than a terminal screenshot.
