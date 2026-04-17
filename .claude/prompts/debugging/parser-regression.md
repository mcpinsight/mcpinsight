---
version: 1
audience: backend-engineer | qa-test
---

# Debugging Prompt: Parser Regression

Use this when a parser test fails, a fixture no longer matches expected output, or a user reports "wrong call count".

```
[PARSER REGRESSION DEBUG]

Symptom (one sentence):
<e.g., "parser drops 3 of 47 mcp__ tool_use events in fixture compacted-session">

Client affected: <claude-code | codex | cursor | ...>

Failing test or fixture:
<path + test name>

Actual output:
"""
<paste>
"""

Expected output (from .meta.json or test assertion):
"""
<paste>
"""

Recent changes to the parser or normalizer (last 7 days):
- <commit: summary>
- <commit: summary>

Please, step by step:

1. State the hypothesis (what you think broke). If more than one, list each.
2. For the top hypothesis, point at the exact lines of code (path:line) that implement that logic.
3. Write the *minimal reproducing test* — a single JSONL line or two that exercises the suspected path. Confirm it fails with the current code.
4. Propose the fix. Apply it. Confirm the new test passes AND the fixture test passes AND no other test regresses (run full suite).
5. Consider whether the bug class could exist in the other parsers/normalizers. State yes/no with one-sentence reasoning.
6. If the fix changes the canonical McpCall shape or adds a new edge case, update the relevant fixture's .meta.json and add a new fixture demonstrating the edge case.

Return:
- Diagnosis (one paragraph)
- Fix (code diff)
- Test added (path + behavior)
- Cross-parser impact (yes/no + reasoning)
```
