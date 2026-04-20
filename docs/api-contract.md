# API Contract

The local HTTP API exposed by `packages/server`. All endpoints are JSON, served on a random local port chosen by `mcpinsight serve`.

Frontend consumes from `packages/web/src/api/client.ts` (Day 20). Contract changes require a PR that updates this file and bumps `packages/server` minor version.

## Status: v0.1 — Day 19 (read-only surface)

This v0.1 ships exactly what `Queries` already exposes plus thin route shims. Forward-looking endpoints (Health Score, telemetry, scan trigger) are present as **501 stubs** with a clear `code` so the React dashboard can render placeholders without a CORS/404 cliff.

| Endpoint | v0.1 | Lands |
|---|---|---|
| `GET /api/health` (liveness) | ✅ | Day 19 |
| `GET /api/servers` | ✅ | Day 19 |
| `GET /api/servers/:name` | ✅ aggregate; `timeseries: []` placeholder | Day 19 (timeseries Day 21) |
| `GET /api/clients` | ✅ | Day 19 |
| `GET /api/health/:name` (Health Score) | 501 | Day 21 |
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

Per-server detail. v0.1 returns the same aggregate row as `/api/servers` filtered to one server, plus a `timeseries: []` placeholder so the dashboard can render the chart slot. Day 21 populates `timeseries` and adds a `tools` breakdown.

**Path param:**
- `name` — URL-encoded server name (e.g. `claude_ai_Google_Drive` or `slack%20mcp`).

**Query params:**
- `days` (number, default `7`)
- `client` (optional, same enum as above)

**Response 200:**
```json
{
  "server_name": "claude_ai_Google_Drive",
  "summary": {
    "server_name": "claude_ai_Google_Drive",
    "calls": 3,
    "errors": 0,
    "unique_tools": 2,
    "input_tokens": 540,
    "output_tokens": 1200,
    "cache_read_tokens": 65606,
    "cost_usd_real": 0.0,
    "cost_usd_est": 0.0
  },
  "timeseries": []
}
```

`timeseries` is **always `[]` in v0.1**. Consumers MUST tolerate the empty array and not crash; Day 21 will add objects of shape `{day: "YYYY-MM-DD", calls, errors, input_tokens, output_tokens}`.

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

### `GET /api/health/:name` — 501 stub (Day 21)

Health Score ships Day 21. v0.1 returns 501 so dashboard skeleton can render a placeholder card without a 404.

**Response 501:**
```json
{ "error": { "code": "not_implemented", "message": "Health Score ships Day 21", "hint": "Tracked in .claude/tasks/phase-multi-client-ui.md" } }
```

The Day 21 contract will be:
```jsonc
// 200 (enough data):
{ "server_name": "...", "score": 82, "components": { /* 5 factors 0-1 */ }, "is_essential": true }
// 200 (insufficient data):
{ "server_name": "...", "score": null, "components": null, "insufficient_data_reason": "too_recent" | "too_few_calls" }
```

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
