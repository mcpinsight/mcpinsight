import type { ClaudeCodeRawEvent } from '../parsers/claude-code.js';
import { CLAUDE_CODE_CLIENT, CLAUDE_CODE_PARSER_VERSION } from '../parsers/claude-code.js';
import { asSessionId } from '../types/brands.js';
import type { ClientNormalizer, McpCall } from '../types/canonical.js';
import { parseMcpToolName } from './types.js';

/**
 * Convert a paired Claude Code raw event into a canonical `McpCall`.
 *
 * Returns `null` for non-MCP tool calls (Bash, Read, Edit, Agent, ...) — only
 * names matching `mcp__<server>__<tool>` cross the boundary.
 *
 * `cost_usd` is hardcoded 0 and `cost_is_estimated: 1` per INV-02 for MVP —
 * accurate per-call USD attribution requires pairing log data with the user's
 * API key, which Day 12 explicitly defers (Week 4+).
 */
export const ClaudeCodeNormalizer: ClientNormalizer<ClaudeCodeRawEvent> = {
  client: CLAUDE_CODE_CLIENT,
  version: CLAUDE_CODE_PARSER_VERSION,
  normalize(raw, ctx): McpCall | null {
    const parsed = parseMcpToolName(raw.toolName);
    if (parsed === null) return null;

    const usage = raw.usage;
    return {
      client: CLAUDE_CODE_CLIENT,
      session_id: asSessionId(raw.sessionId),
      project_identity: ctx.projectIdentity,
      server_name: parsed.server,
      tool_name: parsed.tool,
      ts: raw.tsMs,
      input_tokens: usage?.input_tokens ?? 0,
      output_tokens: usage?.output_tokens ?? 0,
      cache_read_tokens: usage?.cache_read_input_tokens ?? 0,
      cost_usd: 0,
      // TODO(week4): drive cost_is_estimated from ctx.hasApiKey
      cost_is_estimated: 1,
      is_error: raw.result?.isError ?? null,
      duration_ms: raw.result ? raw.result.tsMs - raw.tsMs : null,
    };
  },
};
