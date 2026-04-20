# Codex Rollout JSONL — Format Notes (Day 17, 2026-04-22)

Reference doc for `packages/core/src/parsers/codex.ts`. Sourced from the
current `main` branch of [`github.com/openai/codex`](https://github.com/openai/codex)
(April 2026) via WebSearch + direct reads of `codex-rs/protocol/src/protocol.rs`.
No real rollout file was available on the dev box — validation of this parser
against production data is a user-side follow-up (§5).

## 1. File layout and naming

- Root: `$CODEX_HOME/sessions/` (defaults to `~/.codex/sessions/`).
- Layout: `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl`.
- One rollout file per conversation. Append-only; compaction emits a
  `compacted` RolloutItem in the same file rather than rewriting history.
- Nested date directories mean our discovery walker in
  `packages/core/src/util/paths.ts#discoverSessionFiles` works unchanged —
  it already recurses and filters by `.jsonl`.

## 2. Line envelope

Every line is a `RolloutLine`:

```json
{ "timestamp": "<RFC3339>", "type": "<variant>", "payload": <variant-payload> }
```

- `timestamp` is an RFC3339 UTC string with millisecond precision, e.g.
  `"2026-04-20T14:23:05.120Z"`.
- `type` + `payload` come from `#[serde(tag="type", content="payload")]` on
  the `RolloutItem` enum.

### `RolloutItem` variants (all six confirmed on `main`):

| `type`          | Meaning                                           |
|-----------------|---------------------------------------------------|
| `session_meta`  | Session id + originator + cwd + cli_version + git |
| `session_state` | Token usage snapshots + mid-session state updates |
| `response_item` | Responses-API message / function_call / tool_output |
| `compacted`     | Marks a compaction boundary (prefix collapsed)    |
| `turn_context`  | Per-turn policy context (approval, sandbox, ...)  |
| `event_msg`     | Semantic events — **where MCP calls live**        |

For MVP (Week 3) we only consume `session_meta` + `event_msg/mcp_tool_call_*`.
The other four are handled as **known-but-ignored** — the parser returns
`null` for them so they don't become "unknown line" warnings.

## 3. MCP events (the only payloads we read)

### 3.1 `session_meta`

Payload (flattened `SessionMetaLine` → `SessionMeta`):

```json
{
  "id": "01924abc-0b38-70f0-baff-a394265d8291",
  "timestamp": "2026-04-20T14:23:01Z",
  "cwd": "/Users/you/proj",
  "originator": "codex_cli_rs",
  "cli_version": "0.88.0",
  "source": "cli",
  "model_provider": "openai",
  "git": { "commit_hash": "abc123", "branch": "main", "repository_url": "..." }
}
```

We extract:
- `payload.id` → our `session_id`
- `payload.cwd` → debug-only (INV-01 uses git remote, not cwd)
- `payload.git.branch` → debug-only

### 3.2 `event_msg` → `mcp_tool_call_begin`

```json
{
  "timestamp": "2026-04-20T14:23:05.120Z",
  "type": "event_msg",
  "payload": {
    "type": "mcp_tool_call_begin",
    "call_id": "call_abc123",
    "invocation": {
      "server": "github",
      "tool": "get_issue",
      "arguments": { "owner": "openai", "repo": "codex", "issue_number": 42 }
    }
  }
}
```

Key fields:
- `payload.call_id` — correlates with the matching `*_end` event.
- `payload.invocation.server` — MCP server name (e.g. `github`). **Already
  structured; no `mcp_`/`mcp__` prefix to strip.**
- `payload.invocation.tool` — tool name (e.g. `get_issue`).
- `payload.invocation.arguments` — optional object.

### 3.3 `event_msg` → `mcp_tool_call_end`

```json
{
  "timestamp": "2026-04-20T14:23:07.890Z",
  "type": "event_msg",
  "payload": {
    "type": "mcp_tool_call_end",
    "call_id": "call_abc123",
    "invocation": { "server": "github", "tool": "get_issue", "arguments": {} },
    "duration": { "secs": 2, "nanos": 770000000 },
    "result": { "Ok": { "content": [{ "type": "text", "text": "..." }], "is_error": false } }
  }
}
```

Key fields:
- `payload.call_id` — must match a prior `mcp_tool_call_begin`.
- `payload.result` — serde-tagged `Result<CallToolResult, String>`.
  - `{"Ok": CallToolResult}` → normal completion. Read `Ok.is_error` for
    application-level errors (the MCP server returned an error payload).
  - `{"Err": string}` → transport error. Always `is_error: true`.
  - Missing/unknown shape → `is_error: null` (defensive).
- `payload.duration` — we **ignore this field**. We compute `duration_ms`
  from the envelope timestamps (`end.ts - begin.ts`) to match Claude Code's
  approach and avoid depending on an evolving serialization format (the
  `Duration` type could serialize as `{secs,nanos}`, as a string, or as a
  number of milliseconds depending on future Codex versions).

## 4. Divergences from `.claude/skills/mcp-protocol.md` (skill doc drift)

The skill doc's Codex section was written at a point where less of Codex
was publicly documented. Two explicit corrections land in this parser:

1. **No `mcp_<server>_<tool>` naming.** The skill doc claimed Codex flattens
   MCP tool names into a single underscore-delimited string like
   `mcp_filesystem_read`. Reality (confirmed from the Rust source): Codex
   has first-class `server` and `tool` fields inside `McpInvocation`.
   Consequently, **`parseMcpToolName` is not used by the Codex normalizer**
   — the fields are already split. (Claude Code still uses it, unchanged.)

2. **`parseMcpToolName` only ever handled `mcp__`.** The skill doc also
   claimed our normalizer handles both `mcp__` and `mcp_` prefixes. Grep
   of `packages/core/src/normalizers/types.ts` shows it only handles the
   double-underscore form. Even if Codex had used the flat naming, the
   helper would have returned `null` for it. This is now moot (see #1)
   but worth calling out so nobody "fixes" `parseMcpToolName` to handle
   `mcp_` on the theory that Codex needs it.

3. **Token usage is not per-call.** Claude Code carries `usage` on the
   assistant message that contained the `tool_use` block. Codex emits
   `session_state` rollout items with cumulative token counts, not per-call
   deltas. For MVP we **set all token fields to 0 and `cost_is_estimated:
   1`** (same INV-02 anchor as Claude Code). Per-call token attribution
   for Codex is a Week 4+ concern if at all.

4. **Sub-agents.** Claude Code uses `isSidechain: true` on sub-agent lines.
   Codex handles sub-agents via a separate rollout file with
   `session_meta.source` in the `sub_agent` family, **not** an in-stream
   flag. For MVP we ignore this distinction — every Codex rollout file is
   treated as a main session. A sub-agent rollout would appear as its own
   session-id in our DB, which is arguably correct.

## 5. Outstanding unknowns (require a real rollout sample)

Not blocking the parser — the defensive fallbacks in §3.3 handle them —
but worth confirming against live data before Week 4 ship:

1. `duration` payload shape — `{secs, nanos}` vs string vs number.
2. `result` envelope — whether `{"Ok": ...}` / `{"Err": ...}` is the actual
   serde-default shape or whether Codex overrides to untagged enums.
3. `CallToolResult.is_error` — may be `null`/absent on success (rmcp SDK).
4. Whether Codex ever emits `session_state` items that would help us
   backfill token counts. (Week 4+ if so.)
5. The full `ResponseItem` variant list for the `response_item` envelope —
   we only care about this if we decide to use `function_call` as a
   secondary source for MCP calls. For MVP, `mcp_tool_call_begin/end` is
   sufficient.

**Action**: when the first Codex alpha tester lands (ideally by Day 22's
alpha test #2), have them share a sanitized `rollout-*.jsonl` that includes
≥1 MCP call. That single file resolves 1–4 above.

## 6. Quick reference for the parser

```
mcp_tool_call_begin  →  CodexToolUseLine  (parser kind)
mcp_tool_call_end    →  CodexToolResultLine
session_meta         →  CodexSessionMetaLine
everything else      →  null (silently skipped)
```

`pairEvents` threads `session_meta.id` onto subsequent `tool_use`/`tool_result`
events (which don't carry their own session id). If a file is missing its
`session_meta` line (partial corruption or resumed-without-meta edge case),
`pairEvents` falls back to the literal string `'unknown'` so ingestion
doesn't block — but flag for investigation.
