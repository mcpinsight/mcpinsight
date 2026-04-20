# API Contract

The local HTTP API exposed by `packages/server`. All endpoints are JSON, served on a random local port chosen by `mcpinsight serve`.

Frontend consumes from `packages/web/src/api/client.ts` (Day 20). Contract changes require a PR that updates this file and bumps `packages/server` minor version.

## Status: v0.2 — Day 21 (Health Score v2 + detail fan-out)

v0.2 is **additive** over v0.1: no existing field shape changes, no status codes removed.
`GET /api/health/:name` flips from the 501 stub to a live handler per
[ADR-0004](./adr/0004-health-score-v2.md); `GET /api/servers/:name` grows `tools`
and populates `timeseries`. Clients written against v0.1 continue to parse.

| Endpoint | v0.2 | Lands |
|---|---|---|
| `GET /api/health` (liveness) | ✅ | Day 19 |
| `GET /api/servers` | ✅ | Day 19 |
| `GET /api/servers/:name` | ✅ with populated `timeseries` + additive `tools: string[]` | Day 21 |
| `GET /api/clients` | ✅ | Day 19 |
| `GET /api/health/:name` (Health Score) | ✅ live | Day 21 |
| `POST /api/scan` | 501 | Day 22 polish |
| `POST /api/telemetry/*` | not present | Week 4 |

## Base

- **Local only**: `http://127.0.0.1:<random-port>`. Server binds to `127.0.0.1` only (INV-07). Never exposed to LAN.
- **No auth** in Y1. Local binding is the security boundary.
- **All timestamps** are unix ms (number). All dates are ISO `YYYY-MM-DD` strings. All counts are integers.
- **CORS**: not enabled in v0.1. The dashboard is served from the same origin (Hono serves `packages/web/dist` from Day 20 onward); cross-origin browser callers are not supported.

## Endpoints

### `GET /api/health`

Liveness check. Returns immediately; does not touch the DB.

**Response 200:**
```json
{ "ok": true, "version": "0.1.0" }
```

`license_tier` is **not** exposed in v0.1 — licensing ships Week 4. When it does, the field will be additive (existing consumers unaffected).

### `GET /api/servers`

Top servers by call count within a trailing window. Sourced from `Queries.topServers`. **INV-04** self-reference exclusion is embedded in the query — `mcpinsight` never appears in this list.

**Query params:**
- `days` (number, default `7`, must be a positive integer)
- `client` (optional string; one of `claude-code | codex | cursor | windsurf | copilot`)
- `limit` (number, default `20`, must be a positive integer)

**Response 200** — array of `TopServerRow` (see `packages/core/src/db/queries.ts`):
```json
[
  {
    "server_name": "claude_ai_Google_Drive",
    "calls": 3,
    "errors": 0,
    "unique_tools": 2,
    "input_tokens": 540,
    "output_tokens": 1200,
    "cache_read_tokens": 65606,
    "cost_usd_real": 0.0,
    "cost_usd_est": 0.0
  }
]
```

Empty DB or no calls in window → `[]` (200, not 404).

**Response 400** — invalid `client`, `days`, or `limit`:
```json
{ "error": { "code": "bad_request", "message": "invalid client: \"chrome\"", "hint": "Expected one of: claude-code, codex, cursor, windsurf, copilot." } }
```

### `GET /api/servers/:name`

Per-server detail — summary + per-day timeseries + distinct tool list, all filtered to the same (`days`, `client`) window. v0.2 populates `timeseries` and adds a `tools` string array; v0.1 clients that treated `timeseries` as `[]` continue to render (the array is simply non-empty now).

**Path param:**
- `name` — URL-encoded server name (e.g. `claude_ai_Google_Drive` or `slack%20mcp`).

**Query params:**
- `days` (number, default `7`)
- `client` (optional, same enum as above)

**Response 200:**
```json
{
  "server_name": "filesystem",
  "summary": {
    "server_name": "filesystem",
    "calls": 412,
    "errors": 3,
    "unique_tools": 4,
    "input_tokens": 88500,
    "output_tokens": 91840,
    "cache_read_tokens": 0,
    "cost_usd_real": 0.0,
    "cost_usd_est": 0.0
  },
  "timeseries": [
    { "day": "2026-04-20", "calls": 31, "errors": 0, "input_tokens": 6000, "output_tokens": 7100 },
    { "day": "2026-04-21", "calls": 58, "errors": 1, "input_tokens": 12400, "output_tokens": 13900 }
  ],
  "tools": ["list_directory", "read_file", "search_files", "write_file"]
}
```

`timeseries` is ordered by `day` ASC. `tools` is alphabetized, case-sensitive. Both arrays scope to the same (`days`, `client`) window as `summary`.

**Response 404** — server has no calls in the window (or doesn't exist at all; the two are indistinguishable by design):
```json
{ "error": { "code": "not_found", "message": "no calls recorded for server \"foo\" in the last 7 day(s)", "hint": "Try a wider --days window, or run `mcpinsight scan`." } }
```

### `GET /api/clients`

Per-client activity breakdown. Sourced from `Queries.listClients`. INV-04 self-reference exclusion is embedded in the query.

**Query params:**
- `days` (number, default `30` — broader than `/api/servers` because client adoption is a slower signal)
- `limit` (number, default `20`)

**Response 200** — array of `ClientListRow`:
```json
[
  { "client": "claude-code", "calls": 1204, "servers": 8, "first_ts": 1712000000000, "last_ts": 1712345678000 },
  { "client": "codex",       "calls":  312, "servers": 3, "first_ts": 1712100000000, "last_ts": 1712345600000 }
]
```

Clients with zero calls in window are dropped (matches `listClients` GROUP BY semantics — consistent with `topServers`).

**Response 400** — invalid `days` or `limit`:
```json
{ "error": { "code": "bad_request", "message": "invalid days: \"foo\"", "hint": "Expected positive integer." } }
```

### `GET /api/health/:name`

Per-server Health Score per [ADR-0004](./adr/0004-health-score-v2.md). The window is fixed at 30 days server-side (algorithm constant, not caller-tunable); `?client` is the only query param that affects the response shape.

**Path param:**
- `name` — URL-encoded server name.

**Query params:**
- `client` (optional; same enum as `/api/servers`)

**Response 200 — enough data:**
```json
{
  "server_name": "filesystem",
  "score": 82,
  "components": {
    "activation": 1.0,
    "successRate": 0.99,
    "toolUtil": 0.8,
    "clarity": 1.0,
    "tokenEff": 0.95
  },
  "is_essential": true
}
```

`score` is an integer in `[0, 100]`. `components` values are floats in `[0, 1]` — the pre-weighting factor values. Clients can recompute the weighted sum locally using the weights in ADR-0004 (`activation 30% · successRate 30% · toolUtil 20% · clarity 10% · tokenEff 10%`).

**Response 200 — insufficient user-level data:**
```json
{
  "server_name": "filesystem",
  "score": null,
  "components": null,
  "is_essential": false,
  "insufficient_data_reason": "too_recent"
}
```

`insufficient_data_reason` is one of `"too_recent"` (< 14 days of history) or `"too_few_calls"` (< 50 total calls across all servers). `is_essential` remains informative even on the insufficient-data path.

**Response 404 — server never seen:**
```json
{ "error": { "code": "not_found", "message": "no calls recorded for server \"foo\"", "hint": "Run `mcpinsight scan` to ingest sessions, then retry." } }
```

404 fires only when the named server has zero lifetime calls (or no lifetime calls under the client filter). A server with history but zero calls in the 30-day window returns **200** with `score: 0` — the zombie signal.

**Response 400 — invalid client:** same `bad_request` envelope as `/api/servers`.

### `POST /api/scan` — 501 stub (Day 22 polish)

Scan trigger from the dashboard. Deferred to Day 22 because extracting the scan pipeline from `packages/cli/src/commands/scan.ts` into `@mcpinsight/core` is a > 60-min yak-shave per the Day 19 opener STOP condition. Until Day 22, users run `mcpinsight scan` from the CLI.

**Response 501:**
```json
{ "error": { "code": "not_implemented", "message": "Scan trigger ships Day 22 polish", "hint": "Run `mcpinsight scan` from the CLI for now." } }
```

#### Architect rationale (Option B vs A)

- **(A)** `POST /api/scan` shells into the same pipeline the CLI uses. Requires extracting `runScan` orchestration from `packages/cli/src/commands/scan.ts` into `@mcpinsight/core` (it currently calls `discoverSessionFiles`, `readJsonlLines`, parser/normalizer/aggregator end-to-end). Estimated 60–120 min if any I/O coupling surfaces, plus new tests for the extracted module, plus a fresh contract for streaming progress to a long-poll caller.
- **(B)** Defer scan trigger; ship the read-only surface for Day 19. Dashboard's "Scan now" button becomes Day 22 polish.
- **Decision: (B)**. Day 19 is read-only. The 30-min Architect block + 2.5-h Backend block budget for Day 19 cannot absorb the extraction without compressing test coverage on the new package below 80/75. Option (A) is a known-cost migration; deferring it costs nothing in the meantime because the CLI scan still works.

## Error envelope

Every 4xx and 5xx response uses:
```json
{ "error": { "code": "<snake_case>", "message": "<human-readable>", "hint": "<optional next step>" } }
```

| HTTP | When | Source |
|---|---|---|
| 400 | Bad query param (invalid client, non-numeric days/limit) | `BadRequestError` (extends `UserFacingError`) |
| 404 | Server detail with no matching calls in window | `NotFoundError` (extends `UserFacingError`) |
| 501 | `/api/health/:name`, `/api/scan` | hardcoded in route |
| 500 | Anything else (programmer error, DB corruption, unhandled throw) | `app.onError` middleware logs full stack via `Logger`, returns opaque `{code: 'internal_error'}` to the caller |

Stack traces are **never** exposed to the response body. Internal errors are logged server-side with the full cause; the response carries only the opaque code.

## Versioning

This is a local-only API. We do not version the URL prefix.

Breaking changes (removing a field, changing a field's type, changing status codes for an existing condition):
1. Open an ADR under `docs/adr/`.
2. Bump `packages/server/package.json` minor.
3. Update `packages/web/src/api/client.ts` in the same PR.

Additive changes (new endpoint, new optional field) do **not** require an ADR.

## Not endpoints (explicitly)

- **No `POST /api/servers`** — data is ingested via `mcpinsight scan`, not HTTP.
- **No `DELETE /api/servers/:name`** — to forget a server, delete `~/.mcpinsight/data.db` and re-scan.
- **No raw SQL endpoint.** Period.
- **No remote endpoints.** The Worker at `apps/worker` is a separate service (Week 4) — its contract lives in a future `docs/worker-contract.md`.
