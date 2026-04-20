import type { CodexRawEvent } from '../parsers/codex.js';
import { CODEX_CLIENT, CODEX_PARSER_VERSION } from '../parsers/codex.js';
import { asSessionId } from '../types/brands.js';
import type { ClientNormalizer, McpCall } from '../types/canonical.js';

/**
 * Convert a paired Codex raw event into a canonical `McpCall`.
 *
 * Codex rollout payloads carry `server` and `tool` as structured fields on
 * `McpInvocation`, so this normalizer skips `parseMcpToolName` (which is only
 * applicable to the Claude Code flat-name format `mcp__<server>__<tool>`).
 * See `docs/codex-log-format-notes.md` §4.
 *
 * Token fields are zero and `cost_is_estimated: 1` for MVP (INV-02). Codex
 * reports token usage as cumulative session snapshots in `session_state`
 * rollout items, not per-call, so per-call attribution is a Week 4+ concern.
 * The same `TODO(week4):` anchor as `claude-code.ts` applies.
 */
export const CodexNormalizer: ClientNormalizer<CodexRawEvent> = {
  client: CODEX_CLIENT,
  version: CODEX_PARSER_VERSION,
  normalize(raw, ctx): McpCall | null {
    if (raw.server.length === 0 || raw.tool.length === 0) return null;

    return {
      client: CODEX_CLIENT,
      session_id: asSessionId(raw.sessionId),
      project_identity: ctx.projectIdentity,
      server_name: raw.server,
      tool_name: raw.tool,
      ts: raw.tsMs,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cost_usd: 0,
      // TODO(week4): drive cost_is_estimated from ctx.hasApiKey + per-call
      // token backfill once session_state snapshots are consumed.
      cost_is_estimated: 1,
      is_error: raw.result?.isError ?? null,
      duration_ms: raw.result ? raw.result.tsMs - raw.tsMs : null,
    };
  },
};
