# Telemetry Schema

What we collect from opted-in users, what we don't, and how it evolves.

## Non-negotiables

1. **Telemetry is opt-in.** Default is no telemetry. The modal shown after the first scan asks explicitly.
2. **Content is never transmitted.** No tool arguments, no tool results, no prompts, no file paths, no session IDs.
3. **Anonymity is per-user-environment.** One user sending data from one machine produces one stable `anonymous_user_id` per install. Rotating is allowed; de-anonymizing is never done.
4. **Schema is versioned.** Fields can be added (new version). Existing fields are never removed or semantically changed without a new version.
5. **Transparency.** This file is the source of truth. Any code that collects or sends data references it.

## `anonymous_user_id`

Generated once per install, stored in `~/.mcpinsight/config.json`:

```
anonymous_user_id = "anon_" + hex(sha256(random_bytes(16)))[:16]
```

Never includes hostname, username, email, or any identifier linked to the user.

## Schema version 1 (initial)

Fields collected per aggregated batch:

| Field | Type | Notes |
|---|---|---|
| `anonymous_user_id` | string | As above |
| `schema_version` | integer | 1 |
| `batch_start_ts` | integer (ms) | Earliest call in this batch |
| `batch_end_ts` | integer (ms) | Latest call in this batch |
| `client` | enum | claude-code / codex / cursor / windsurf / copilot |
| `cli_version` | string | E.g. "0.1.0" |
| `aggregates` | array of `ServerAggregate` | See below |

`ServerAggregate`:

| Field | Type | Notes |
|---|---|---|
| `server_name` | string | E.g. "filesystem". Public names only (the user's own MCP registry entry). |
| `calls` | integer | Total calls in this batch |
| `errors` | integer | Count with `is_error = true` |
| `unique_tools_used` | integer | Distinct tools called on this server |
| `project_count` | integer | Distinct `project_identity` values |
| `cost_usd_real` | number | Sum of `cost_is_estimated = 0` rows; 0 if none |
| `avg_output_tokens` | number | Per-call mean |

What is explicitly **not** in schema v1:

- No `session_id`, `project_identity`, or any hash thereof.
- No `tool_name` list (tool names can be user-chosen and sometimes identifying — "my_weather_api_for_krakow").
- No timestamps within a session.
- No model identifiers.
- No file paths.

## Adding a field (schema v2 and beyond)

Process:

1. Propose the field in an ADR.
2. Add it to schema v2 in this doc. Mark the old fields unchanged.
3. Bump `consent_version` in the opt-in flow; old opt-ins are v1 and continue sending v1 payloads until they re-consent.
4. Worker ingests both v1 and v2 for at least 4 quarters.
5. State-of-MCP reports that need the new field clearly label which reports use it.

## Worker-side retention

- Per-batch rows: retained 18 months, then aggregated into quarterly `state_of_mcp_public` tables.
- `anonymous_user_id` → batch mapping: retained 6 months (to support opt-out requests).
- On opt-out: all rows matching the ID are deleted within 30 days.

## User controls

- `mcpinsight telemetry status` — shows current consent state.
- `mcpinsight telemetry opt-out` — revokes consent; subsequent scans queue nothing, and we delete server-side within 30 days.
- `mcpinsight telemetry preview` — dumps the next batch that would be sent.
- `mcpinsight telemetry forget` — as opt-out + clear local `telemetry_pending` table.

## State-of-MCP methodology touchpoints

- **Deduplication**: per `anonymous_user_id` + `server_name` per quarter (one user cannot vote 100×).
- **Trust weighting**: accounts active >30 days = weight 1.0; <7 days = 0.3.
- **Minimum N per ranked row**: 50 distinct users using a server over 7+ days.
- Full methodology in `docs/state-of-mcp/methodology.md`.

## Audit log

Every edit to this file is a PR. Commits to this file are linked from the State-of-MCP methodology page with dates.
