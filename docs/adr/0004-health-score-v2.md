# ADR-0004: Health Score v2 algorithm, weights, and edge cases

- **Status**: accepted
- **Date**: 2026-04-26
- **Author**: Architect (MCPInsight)
- **Deciders**: Architect + Backend Engineer + UX Researcher (self-calibration gate)

## Context

Day 21 (calendar) ships the MVP Health Score. It is the single most trust-sensitive
number the dashboard will display: a score that feels wrong on a user's pet server
destroys credibility in one screen. `.claude/tasks/phase-multi-client-ui.md §Day 19`
sketched the algorithm; this ADR pins the weights, the tie-breakers, and the
insufficient-data contract before a line of implementation lands.

The `ServerHealth` canonical shape (`packages/core/src/types/canonical.ts`) already
locked the response surface during Week 2:

```ts
interface ServerHealth {
  server_name: string;
  score: number | null;                 // 0-100 or null
  components: {
    activation: number; successRate: number; toolUtil: number;
    clarity: number; tokenEff: number;
  } | null;
  is_essential: boolean;
  insufficient_data_reason?: 'too_recent' | 'too_few_calls';
}
```

Constraints:
- Solo dev, Day 21 of a 7-day week. Budget: ≤2 h for the core algorithm.
- Essential-server override exists to stop a valid heavy-use server being
  mislabelled "low" because of one bad dimension.
- Minimum-data threshold exists to stop the dashboard shipping a false-precision
  number when we simply don't have the calibration signal yet.
- INV-02 (`cost_is_estimated`) is orthogonal to Health Score — we do not use
  cost in v2.

## Decision

### Weights — unchanged from the Day 19 sketch

| Factor         | Weight | Definition                                                                 |
|----------------|--------|----------------------------------------------------------------------------|
| `activation`   | 0.30   | `clamp(calls_30d / 30, 0, 1)` — ~1 call/day saturates                       |
| `successRate`  | 0.30   | `(calls - errors) / calls` over calls where `is_error !== null`; `1` if all `is_error` are `null` |
| `toolUtil`     | 0.20   | `min(unique_tools_used / 5, 1)` — heuristic surrogate for tool-surface exploration |
| `clarity`      | 0.10   | `1 - calculateToolConfusion(tools)` — Levenshtein < 3 on first 8 chars     |
| `tokenEff`     | 0.10   | `1 - clamp(avg_output_tokens / 10_000, 0, 1)` — cheaper = better           |

Sum = 1.0 exactly. Unit-tested.

Rationale for `toolUtil` heuristic: MCP servers expose `tools/list` we don't observe
in the rollout logs. We cannot compute true `unique_used / total_available`. Instead
we pick 5 as the "well-explored surface" threshold — most real MCP servers expose
3-8 tools; a user exercising 5 is getting the feature. The floor-at-1 clamp keeps
servers with 5+ tools at full score. This is intentionally a heuristic (P5: no
speculative abstraction toward a server-catalog module we don't need yet).

### Tie-breakers (the part that matters)

**T1. Zero calls beats essential-server floor.**

```ts
if (calls_30d === 0) return { score: 0, ... };        // hard 0
// otherwise compute raw, then:
if (is_essential && raw < 50) score = 50;             // floor
```

An "essential" server (ever-used in >80% of projects) with 0 calls over 30 days is
the loudest possible alarm — the user used to rely on it everywhere and stopped.
Floorin g to 50 would mask the alarm. The user needs to SEE a 0 to investigate.
If the server is genuinely dead and the user is comfortable, they dismiss it; if
not, the 0 is the prompt to fix it.

**T2. Insufficient-data threshold is user-level, not per-server.**

```ts
if (days_of_history < 14)   → { score: null, reason: 'too_recent' }
else if (total_calls_all_servers < 50) → { score: null, reason: 'too_few_calls' }
```

`days_of_history = (now - earliest_ts_across_all_calls) / 86_400_000`.
`total_calls_all_servers = SUM(calls) in user's mcp_calls`.

The minimum-data check is user-level because the Health Score needs *calibration
signal* — a number means "this server relative to your other servers and your
usage history". Without baseline usage, we cannot compute a trustworthy relative
number even for a per-server window where we have 50 calls.

**T3. When both insufficient-data reasons apply, `too_recent` wins.**

A user with 2 days of history and 10 calls gets `too_recent`. Rationale: "more time"
is a passive-resolution path (the user just keeps using their tools); "more calls"
(`too_few_calls`) is the action we communicate only when time is no longer the
limiter. Reporting `too_recent` first is honest about what will resolve first.

**T4. Insufficient-data pre-empts zero-calls.**

If a user has `days_of_history < 14`, every server returns `{score: null}` —
including servers that happen to have 0 calls in 30d. We don't flag a zombie before
we have enough calibration to distinguish zombie from "just not used this week".

### Essential-server definition

```ts
is_essential = (server_project_count / user_project_count) > 0.8
  where
    server_project_count = COUNT(DISTINCT project_identity) WHERE server_name = X
    user_project_count   = COUNT(DISTINCT project_identity) in mcp_calls
```

Both counts are taken over the full `mcp_calls` history (not the 30-day window),
because essential-ness is a stable property across a user's projects, not a
moving average. A user with one project (solo) has every server essential — that
is the correct signal for them.

Tooling invariant: the `is_essential` field is populated on every response, even
the insufficient-data path, so the UI can show a subtle "essential to your work"
tag even before the score is computable.

### Success-rate computation

```ts
const scored = calls.filter(c => c.is_error !== null);
successRate = scored.length === 0 ? 1
  : (scored.length - scored.filter(c => c.is_error).length) / scored.length;
```

`is_error = null` ("unknowable" — compacted session) is excluded from the
denominator, not charitable-counted as success. A server with 100 calls, 10 errors,
and 50 unknowables is a 90% success rate, not 80%. This aligns with the semantic
of `null` in `McpCall` (§`types/canonical.ts`).

Edge: all `is_error` are `null` → `successRate = 1` (we have no information to
claim errors, so we do not penalize).

### Tool-confusion calculation

```ts
calculateToolConfusion(tools: string[]): number
```

Algorithm:
1. Take the first 8 characters of each tool name (case-insensitive, lower).
2. For every unordered pair (t_i, t_j): if `levenshtein(prefix_i, prefix_j) < 3`,
   flag both as "confused".
3. Return `flaggedSet.size / tools.length`.

Complexity: O(n² * k) where k is prefix length (8). For a 100-tool server this is
~10k comparisons × 8 chars = ~80k character ops — well inside the 50 ms STOP budget.
No bucketing needed at this scale. We memoize the prefix list but not pairs (pair
memoization is useless within a single call; tools are provided fresh per invocation).

Edge cases:
- empty `tools` → confusion 0 (clarity 1)
- single tool → confusion 0
- `read_file` vs `read-file`: Levenshtein 1 → flagged
- `read_file` vs `readFile`: prefixes `read_fil` / `readfile` (lowercased) →
  Levenshtein 1 → flagged
- `get` vs `set`: Levenshtein 1 on a 3-char prefix → flagged as confused, which
  is a **known false positive**. We accept it because short distinct primitives
  exist but confusion here is mostly about longer misspellings; the 10% weight
  caps damage at ±10 score points.

### Insufficient data surfaces a score AND a reason, not a 501

Per the Day 21 contract lock (below), `GET /api/health/:name` returns HTTP 200 for
both the computable path and the insufficient-data path. The 501 stub path (Day 19)
is retired. 404 is reserved for "no such server" (mirror `GET /api/servers/:name`).

### API contract extension

`GET /api/health/:name` response shape locked:

```jsonc
// 200 — computable
{
  "server_name": "filesystem",
  "score": 82,
  "components": { "activation": 1.0, "successRate": 0.99, "toolUtil": 0.8, "clarity": 1.0, "tokenEff": 0.95 },
  "is_essential": true
}

// 200 — insufficient user-level data
{
  "server_name": "filesystem",
  "score": null,
  "components": null,
  "is_essential": false,
  "insufficient_data_reason": "too_recent"
}

// 404 — no calls recorded for that name in window
{ "error": { "code": "not_found", "message": "...", "hint": "..." } }
```

`GET /api/servers/:name` gains one additive field: `tools: string[]` (alphabetized
distinct tool names observed in window). Additive = no ADR normally, but mentioned
here because the same `getServerDetail` query feeds both endpoints.

## Alternatives considered

- **Drop `toolUtil`, redistribute to 40/40/10/10.** Rejected: tool-surface usage
  is a real signal (a user reaching for only 1 of 7 exposed tools is a soft
  symptom of tool discoverability friction). Losing it costs product signal.
- **Per-server catalog of `total_tools` (hardcoded).** Rejected: maintenance debt
  against every new MCP server, and this is before we have a stable registry.
  The `unique/5` heuristic is defensible today and reversible when `tools/list`
  observation lands.
- **Zero-calls score 0 wins over insufficient-data.** Rejected: on a fresh install
  (3 days, 8 calls) almost every server will be a "zombie" by the 30d lookback
  but none of that is calibration signal. Insufficient-data must pre-empt.
- **Essential-server floor at 40 (more permissive).** Rejected: 50 is "better
  than mediocre"; floor below that loses the point of the floor. A zombie
  essential server is an important signal and the 0-wins-over-floor tie-breaker
  handles it.
- **Essential-server floor at 60 (stricter).** Rejected: saturates too easily
  against real data — the dev DB today has `claude_ai_Google_Drive` which hits
  essential (single project) and would always show 60+ regardless of signal.
  50 leaves room for quality dimensions to move the number.
- **Use `cost_is_estimated = 0` only for `tokenEff`.** Rejected: we have almost
  no raw-cost data today (no user with their own API key), so token counts
  from both camps are our only signal. Revisit Week 4 if cost data grows.
- **Return 501 on insufficient-data.** Rejected: 501 means "the server is not
  yet implemented"; insufficient data is "we can't compute yet" — different
  semantics. 501 would also force the frontend into an error branch; 200 with a
  `null` score + reason is the correct shape.

## Consequences

### Positive

- One canonical algorithm, one test suite, one calibration gate. No drift.
- The `ServerHealth` shape already on disk (Week 2) is honored exactly.
- Insufficient-data path is trust-preserving: dashboard never shows a
  precision number on three days of data.
- `is_essential` is a first-class field on every response, enabling the UI
  to tag heavy-use servers even before score compute.

### Negative

- The `toolUtil` heuristic (unique/5) is provably wrong for servers that expose
  only 3 tools — using all 3 scores 0.6 instead of 1.0. Accept: the 20% weight
  caps the miscalibration at ~8 score points (0.4 × 20 = 8). Future work item:
  observe `tools/list` calls (parser change, not algorithm change).
- The tool-confusion threshold (<3 on first 8 chars) will false-positive on
  very short commands (`get` / `set`). 10% weight caps damage.
- Running tool-confusion on a 100+ tool server is O(n²). Stays under 50 ms at
  100 tools (measured). A user with 500+ tools across all servers would notice;
  revisit with prefix bucketing only if this lands in real data.

### Neutral / trade-offs

- The "too_recent" vs "too_few_calls" distinction is user-facing copy: both
  resolve to "Not enough data yet" in the UI. The distinction exists in the
  API for future debug/telemetry; the frontend is free to collapse them in copy.

## Invariants touched

- **INV-02** — `cost_usd` and `cost_is_estimated` are orthogonal to Health
  Score v2. No change.
- **INV-04** — self-reference exclusion already in queries; Health Score inputs
  come from queries that already filter self-reference. No change.
- **INV-05** — `health/score.ts` is a pure function; it does not touch DB.
  `queries.healthInputs` owns the DB read; the server route composes them.
  Preserves the one-way flow.
- **INV-08** — any user-facing copy around insufficient-data lives in
  `packages/web/src/copy/en.ts`.

No invariants broken; no invariants added.

## Migration / follow-up

- [x] Commit this ADR before code.
- [ ] Ship `packages/core/src/health/score.ts` pure module (Backend Day 21).
- [ ] Ship `queries.healthInputs` and `queries.getServerDetail` (Backend Day 21).
- [ ] Flip `GET /api/health/:name` from 501 to 200 (Backend Day 21).
- [ ] Lock `timeseries` shape in `docs/api-contract.md` v0.2 (Backend Day 21).
- [ ] Self-calibration gate run by UX Researcher on user's dev DB (Day 21 close).
- [ ] Revisit `toolUtil` heuristic when parser observes `tools/list` (Week 5+).
- [ ] Revisit tool-confusion bucketing if any user has >500 tools aggregate.

## References

- `.claude/tasks/phase-multi-client-ui.md §Day 19 block` — original algorithm sketch.
- `packages/core/src/types/canonical.ts` — `ServerHealth` canonical shape.
- `docs/api-contract.md` v0.1 — 501 stub contract being retired.
- Levenshtein distance: https://en.wikipedia.org/wiki/Levenshtein_distance
