# API Contract

The local HTTP API exposed by `packages/server`. All endpoints are JSON, served on a random local port.

Contract changes require a PR that updates this file. Frontend consumes from `packages/web/src/api/client.ts`.

## Base

- Local only: `http://127.0.0.1:<random-port>`. Never exposed to LAN.
- No auth in Y1 (local-only). The Worker at `apps/worker` is separate and requires the license key for Pro-only endpoints.
- All timestamps are unix ms (number). All dates are ISO `YYYY-MM-DD` strings.

## Endpoints

### `GET /api/health`

Liveness check.

**Response 200:**
```json
{ "ok": true, "version": "0.1.0", "license_tier": "free" | "presale" | "pro" | "team" }
```

### `GET /api/servers`

List of servers with 7-day aggregates.

**Query params:**
- `days` (number, default 7)
- `client` (string, optional, one of the Client union)

**Response 200:**
```json
[
  {
    "server_name": "filesystem",
    "calls": 847,
    "errors": 3,
    "success_rate": 0.9965,
    "unique_tools_used": 5,
    "total_tools": 7,
    "last_active_ts": 1712345678000,
    "cost_usd_real": 0.0,
    "cost_usd_est": 0.42,
    "health_score": 82
  }
]
```

### `GET /api/servers/:name`

Server detail, including per-day breakdown and per-tool stats.

**Path param:**
- `name` (url-encoded server name)

**Response 200:**
```json
{
  "server_name": "filesystem",
  "summary": { /* same shape as items in /api/servers */ },
  "daily": [
    { "day": "2026-04-10", "calls": 120, "errors": 0, "input_tokens": 10234 }
  ],
  "tools": [
    { "tool_name": "read",  "calls": 600, "errors": 1 },
    { "tool_name": "write", "calls": 240, "errors": 2 }
  ]
}
```

**Response 404:** `{ "error": "not_found", "hint": "No calls recorded for this server." }`

### `GET /api/clients`

Per-client breakdown across all servers.

**Response 200:**
```json
[
  { "client": "claude-code", "calls": 1204, "unique_servers": 8 },
  { "client": "codex",       "calls":  312, "unique_servers": 3 }
]
```

### `GET /api/health/:name`

Health Score detail for a server.

**Response 200 (enough data):**
```json
{
  "server_name": "filesystem",
  "score": 82,
  "components": {
    "activation":   0.93,
    "successRate":  1.00,
    "toolUtil":     0.71,
    "clarity":      0.95,
    "tokenEff":     0.88
  },
  "is_essential": true
}
```

**Response 200 (insufficient data):**
```json
{
  "server_name": "github",
  "score": null,
  "components": null,
  "insufficient_data_reason": "too_recent"
}
```

### `POST /api/telemetry/preview` (Pro)

Preview what would be sent to the Worker in the next telemetry batch. Safe to call multiple times; does not send.

**Response 200:**
```json
{
  "schema_version": 1,
  "batch_start_ts": 1712000000000,
  "batch_end_ts":   1712345678000,
  "anonymous_user_id": "anon_abcdef01",
  "aggregates": [
    {
      "server_name": "filesystem",
      "calls": 847,
      "errors": 3,
      "unique_tools_used": 5,
      "project_count": 3
    }
  ]
}
```

### `POST /api/telemetry/sync` (Pro)

Sends pending batches to the Worker. Only available to users who opted in (`telemetry_consent.decision = 'opt_in'`).

**Response 200:**
```json
{ "sent": 3, "remaining": 0, "last_sent_at": 1712345678000 }
```

**Response 403 (no consent):** `{ "error": "no_consent" }`

## Error shape

Any 4xx/5xx response:
```json
{ "error": "<snake_case_code>", "hint": "<user-facing explanation>" }
```

## Versioning

This is a local-only API. We do not version the URL prefix. Breaking changes require:
1. An ADR.
2. Bumping `packages/server` minor version.
3. Updating `packages/web`'s API client in the same PR.

## Not endpoints (explicitly)

- No `POST /api/servers` — data is ingested via `mcpinsight scan`, not HTTP.
- No `DELETE /api/servers/:name` — if a user wants to forget a server, they delete `~/.mcpinsight/data.db` and re-scan.
- No raw SQL endpoint. Period.
