---
version: 1
audience: architect | qa-test | prompt-engineer
---

# Validation Prompt: Review a PR

Use this for any PR that touches `packages/core/src/types/`, a SQL migration, a parser/normalizer, or any public REST endpoint.

```
[PR REVIEW]

PR title: <string>
Summary (from PR description):
"""
<paste>
"""

Files changed:
- <path>
- <path>

Tests added:
- <path>

Claimed invariants respected: <list or "none applicable">
Migration added: <path or "none">
ADR referenced: <doc/adr/NNNN-... or "none">

Please answer these 5 questions, numbered, each ≤120 words:

1. Does this respect every invariant in CLAUDE.md §6 that applies? If not, which one is violated and in what line?
2. Is any public contract changed (types in packages/core/src/types/, SQL schema, REST endpoint shape)? If yes, is the change documented (ADR, api-contract.md, telemetry-schema.md)?
3. Do the tests cover the intended behavior? List any behavior in the diff without a test.
4. Is there a simpler version that achieves 80% of the value in 50% of the code? If yes, describe it in 2-3 sentences. If no, say "no simpler version".
5. Does this change expand the solo-dev maintenance surface? (New dependency, new deploy target, new env var, new operational step?) If yes, is the cost justified for the phase we're in?

Output format: five sections with the above headings. No prose outside the sections.
```

## Notes

- This is intentionally adversarial — the reviewer's job is to find what wasn't thought through, not to bless the work.
- A PR that fails 1 or 2 must be blocked. Failures on 3, 4, or 5 are discussed but not necessarily blocking.
