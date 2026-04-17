# Skill: MCP Protocol & Client Log Formats

> Load when adding or modifying a parser/normalizer for a specific client (Claude Code, Codex, Cursor, Windsurf, Copilot).

## Background

**MCP (Model Context Protocol)** is the open protocol AI coding agents use to expose tools to models. Tool calls show up in each client's session log. The log format differs per client, but the semantic event we extract is always the same: "this model called this tool on this server at this time with this outcome."

Our canonical shape:

```ts
// packages/core/src/types/canonical.ts
export interface McpCall {
  client:            'claude-code' | 'codex' | 'cursor' | 'windsurf' | 'copilot';
  session_id:        string;
  project_identity:  string;              // INV-01: git-remote-derived where possible
  server_name:       string;              // e.g., "filesystem"
  tool_name:         string;              // e.g., "read" or "browse__search"
  ts:                number;              // unix ms
  input_tokens:      number;
  output_tokens:     number;
  cache_read_tokens: number;
  cost_usd:          number;
  cost_is_estimated: 0 | 1;               // INV-02
  is_error:          boolean | null;      // null when unknowable (compacted)
  duration_ms:       number | null;
}
```

Parsers read raw logs; normalizers convert to `McpCall`. The aggregator ingests `McpCall[]` — **nothing** else talks to the DB for calls.

## Client log locations

| Client | Path | Format | Notes |
|---|---|---|---|
| Claude Code | `~/.claude/projects/<project-hash>/*.jsonl` | JSONL | One file per session. `type: "assistant" / "user"`. |
| Codex | `~/.codex/sessions/*.jsonl` | JSONL | Similar to Claude Code; OpenAI wraps differently. |
| Cursor | `~/.cursor/<platform-specific>/state.db` (SQLite) + logs | SQLite + JSONL | More involved; ship in Q2. |
| Windsurf | `~/.windsurf/...` | JSONL | Codex-like. |
| Copilot (VS Code ext) | `~/Library/Application Support/Code/User/.../copilot-chat/...` | JSON | Variable. |

Always check the **OS-specific path** via `os.platform()` — macOS vs Linux vs Windows paths differ. `packages/core/src/parsers/<client>.ts` exports a `defaultLogPaths()` function returning the OS-correct path.

## Claude Code JSONL shape (core event we care about)

The "tool use" event (model calling an MCP tool):

```json
{
  "type": "assistant",
  "message": {
    "id": "msg_01XXX",
    "model": "claude-sonnet-4-5-20250929",
    "content": [
      {
        "type": "tool_use",
        "id": "toolu_01YYY",
        "name": "mcp__filesystem__read",
        "input": { "path": "/work/README.md" }
      }
    ],
    "usage": {
      "input_tokens": 1234,
      "output_tokens": 56,
      "cache_read_input_tokens": 789
    }
  },
  "timestamp": "2026-04-01T12:34:56.789Z",
  "sessionId": "sess-abc"
}
```

The matching `tool_result`:

```json
{
  "type": "user",
  "message": {
    "content": [
      { "type": "tool_result", "tool_use_id": "toolu_01YYY", "content": "...", "is_error": false }
    ]
  },
  "timestamp": "2026-04-01T12:34:57.100Z",
  "sessionId": "sess-abc"
}
```

### Extraction rules for Claude Code

1. Filter `message.content[i].type === 'tool_use'` and `name.startsWith('mcp__')`.
2. `server_name = name.split('__')[1]`.
3. `tool_name  = name.split('__').slice(2).join('__')`. (Handles tools like `mcp__foo__bar__baz`.)
4. `input_tokens = message.usage.input_tokens ?? 0`. Same pattern for the others (some compacted messages lack usage).
5. Pair `tool_use.id` with the subsequent `tool_result.tool_use_id` to get `is_error` and `duration_ms` (timestamp delta).
6. If the tool_use has no matching tool_result within the same JSONL file → `is_error: null`, `duration_ms: null`. This is the **compacted-session edge case**.

### Edge cases that must be handled

- **Malformed JSON lines** (session crashed mid-write). Skip, don't throw. Log once per scan.
- **Compacted sessions** (`/compact` command). The prefix is gone; we only see suffix. `is_error` may be `null` for early calls.
- **Sub-agents** (Claude Code's `/agents`). A different `sessionId` appears in the same file. Preserve; don't merge.
- **Model retries**. Rare; treat as separate calls.
- **Non-ASCII tool names** (unlikely but possible). Preserve bytes; don't normalize Unicode.

## Codex JSONL shape

Codex logs share the JSONL principle but field names differ:

```json
{
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "tool_call",
      "id": "call_01",
      "function": { "name": "mcp_filesystem_read", "arguments": "{\"path\": \"/work/...\"}" }
    }
  ],
  "created_at": 1712345678
}
```

Note: Codex uses `mcp_` prefix (single underscore). Our normalizer handles both `mcp__*` (Claude Code) and `mcp_*` (Codex) and unifies them.

## Normalizer pattern

```ts
// packages/core/src/normalizers/claude-code.ts
import type { ClientNormalizer, McpCall } from '../types/canonical';
import type { ClaudeCodeRawEvent } from '../parsers/claude-code';

export const ClaudeCodeNormalizer: ClientNormalizer<ClaudeCodeRawEvent> = {
  client: 'claude-code',
  version: 1,
  normalize(raw, ctx): McpCall | null {
    if (raw.type !== 'tool_use_with_result') return null;
    if (!raw.toolUseName.startsWith('mcp__')) return null;
    const [_, server, ...toolParts] = raw.toolUseName.split('__');
    return {
      client: 'claude-code',
      session_id: raw.sessionId,
      project_identity: ctx.projectIdentity,
      server_name: server,
      tool_name: toolParts.join('__'),
      ts: raw.tsMs,
      input_tokens: raw.usage?.input_tokens ?? 0,
      output_tokens: raw.usage?.output_tokens ?? 0,
      cache_read_tokens: raw.usage?.cache_read_input_tokens ?? 0,
      cost_usd: 0,
      cost_is_estimated: 1,
      is_error: raw.result?.isError ?? null,
      duration_ms: raw.result ? raw.result.tsMs - raw.tsMs : null,
    };
  },
};
```

## Fragmentation risk (from Biblia v4 §1.3)

The MCP standard is young. Clients diverge. Our moat against this: **normalizers absorb the divergence**. Never bake a client-specific assumption into the aggregator, queries, or UI.

If a client adds a new field (e.g., `retry_count`), we have two options:
1. **Absorb silently**: drop the field at the normalizer. Our canonical shape stays stable.
2. **Extend canonically**: add `retry_count: number` to `McpCall` with a default. Requires a schema migration and a type bump.

Default to (1). Only do (2) when ≥2 clients have the field and at least one user story uses it.

## Self-referential server

The mcpinsight self-server (`mcp__mcpinsight__*`) is logged like any other. The **aggregator** has a hardcoded whitelist (INV-04):

```ts
const SELF_REFERENCE_SERVERS = new Set(['mcpinsight']);
export function shouldIncludeInRanking(server: string) {
  return !SELF_REFERENCE_SERVERS.has(server);
}
```

UI may show a separate "your MCPInsight usage" widget, but rankings exclude it.

## Claude hints

- When adding a client: copy `parsers/claude-code.ts` → `<client>.ts`; write ≥3 fixtures; write `normalizers/<client>.ts`; wire in `parsers/index.ts` and `normalizers/index.ts`; add test for `McpCall` round-trip.
- Never modify the canonical `McpCall` shape without an ADR. The cost of doing so quietly is a subtle data-moat bug that surfaces months later.
