import type { Client, ClientParser } from '../types/canonical.js';
import { codexDefaultLogPaths } from '../util/io.js';

export const CODEX_CLIENT: Client = 'codex';
export const CODEX_PARSER_VERSION = 1;

/**
 * `'unknown'` is used when a rollout file has no `session_meta` line before
 * its first MCP event (corruption or resumed-without-meta edge case).
 * Surfacing it rather than dropping gives us a signal to investigate.
 */
export const CODEX_UNKNOWN_SESSION_ID = 'unknown';

/**
 * One `session_meta` line carries the session id (and other metadata) for
 * the rest of the rollout file. Subsequent `event_msg` lines don't repeat
 * the id, so `pairEvents` threads it through.
 */
export interface CodexSessionMetaLine {
  kind: 'session_meta';
  sessionId: string;
  tsMs: number;
  cwd: string | null;
  gitBranch: string | null;
  cliVersion: string | null;
}

export interface CodexToolUseLine {
  kind: 'tool_use';
  tsMs: number;
  callId: string;
  server: string;
  tool: string;
}

export interface CodexToolResultLine {
  kind: 'tool_result';
  tsMs: number;
  callId: string;
  isError: boolean | null;
}

export type CodexLineEvent = CodexSessionMetaLine | CodexToolUseLine | CodexToolResultLine;

/**
 * Paired tool_use with its optional tool_result. Consumed by the normalizer.
 * `result === null` when no matching `mcp_tool_call_end` was seen in the file
 * — this is the Codex equivalent of Claude Code's compacted-suffix edge case.
 *
 * Unlike Claude Code's raw event, Codex carries `server` and `tool` split
 * because the rollout format has them as first-class fields inside
 * `McpInvocation`. No name-splitting happens in the normalizer.
 */
export interface CodexRawEvent {
  sessionId: string;
  callId: string;
  server: string;
  tool: string;
  tsMs: number;
  cwd: string | null;
  gitBranch: string | null;
  result: { tsMs: number; isError: boolean | null } | null;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asBooleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function parseTimestampMs(value: unknown): number | null {
  const s = asString(value);
  if (s === null) return null;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Derive is_error from a Codex `mcp_tool_call_end` payload's `result` field.
 *
 * Serde-default serialization of `Result<CallToolResult, String>` yields
 * `{"Ok": {...}}` on success and `{"Err": "msg"}` on transport error. The
 * inner `CallToolResult` may carry its own `is_error` for application-level
 * errors (the MCP server returned an error payload).
 *
 * Anything that doesn't match either shape collapses to `null` — same signal
 * we use for unpaired tool_uses, so downstream code handles it uniformly.
 */
function extractIsError(result: unknown): boolean | null {
  if (!isRecord(result)) return null;
  if ('Err' in result) return true;
  if ('Ok' in result) {
    const ok = result.Ok;
    if (isRecord(ok)) {
      const inner = asBooleanOrNull(ok.is_error);
      return inner ?? false;
    }
    return false;
  }
  return null;
}

function parseSessionMeta(payload: unknown, tsMs: number): CodexSessionMetaLine | null {
  if (!isRecord(payload)) return null;
  const sessionId = asString(payload.id);
  if (sessionId === null || sessionId.length === 0) return null;
  const git = isRecord(payload.git) ? payload.git : null;
  return {
    kind: 'session_meta',
    sessionId,
    tsMs,
    cwd: asString(payload.cwd),
    gitBranch: git ? asString(git.branch) : null,
    cliVersion: asString(payload.cli_version),
  };
}

function parseToolUse(payload: UnknownRecord, tsMs: number): CodexToolUseLine | null {
  const callId = asString(payload.call_id);
  if (callId === null || callId.length === 0) return null;
  const invocation = isRecord(payload.invocation) ? payload.invocation : null;
  if (invocation === null) return null;
  const server = asString(invocation.server);
  const tool = asString(invocation.tool);
  if (server === null || server.length === 0) return null;
  if (tool === null || tool.length === 0) return null;
  return { kind: 'tool_use', tsMs, callId, server, tool };
}

function parseToolResult(payload: UnknownRecord, tsMs: number): CodexToolResultLine | null {
  const callId = asString(payload.call_id);
  if (callId === null || callId.length === 0) return null;
  return {
    kind: 'tool_result',
    tsMs,
    callId,
    isError: extractIsError(payload.result),
  };
}

/**
 * Parse a single JSONL line from a Codex rollout file.
 *
 * Returns `null` for: empty lines, malformed JSON, RolloutItem variants we
 * don't consume (`session_state`, `response_item`, `compacted`, `turn_context`),
 * and EventMsg variants other than `mcp_tool_call_begin`/`mcp_tool_call_end`.
 *
 * Skipping is silent — `response_item/function_call` can carry MCP calls too,
 * but it's redundant with the `event_msg/mcp_tool_call_*` pair and mixing the
 * sources risks double-counting. The single-source rule keeps the parser
 * simple and the test surface small.
 *
 * See `docs/codex-log-format-notes.md` for the full schema reference.
 */
export function parseLine(line: string): CodexLineEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const outerType = asString(parsed.type);
  if (outerType !== 'session_meta' && outerType !== 'event_msg') return null;

  const tsMs = parseTimestampMs(parsed.timestamp);
  if (tsMs === null) return null;

  const payload = parsed.payload;

  if (outerType === 'session_meta') {
    return parseSessionMeta(payload, tsMs);
  }

  if (!isRecord(payload)) return null;
  const innerType = asString(payload.type);
  if (innerType === 'mcp_tool_call_begin') return parseToolUse(payload, tsMs);
  if (innerType === 'mcp_tool_call_end') return parseToolResult(payload, tsMs);
  return null;
}

/**
 * Combine line-level events into paired `CodexRawEvent`s.
 *
 * Rollout files are one-session-per-file. A `session_meta` line establishes
 * the id; subsequent `tool_use`/`tool_result` lines inherit it. If a file
 * has no `session_meta` before its first MCP event, we fall back to
 * `CODEX_UNKNOWN_SESSION_ID` so ingestion never blocks — the signal
 * surfaces in aggregation as an `unknown` session for investigation.
 *
 * Unpaired `tool_use`s (no matching `mcp_tool_call_end` in the file — session
 * still live, or the prefix before a compaction) emit with `result: null`,
 * same as Claude Code's compacted-session edge case. Unpaired `tool_result`s
 * (orphan results with no matching begin) are silently dropped.
 *
 * A second `session_meta` mid-file (unusual but possible after a resume)
 * updates the threaded session id for subsequent events. Already-pending
 * tool_uses keep their original session id.
 */
export function pairEvents(events: Iterable<CodexLineEvent>): CodexRawEvent[] {
  type Pending = Omit<CodexRawEvent, 'result'>;
  const pendingByCallId = new Map<string, Pending>();
  const out: CodexRawEvent[] = [];

  let currentSessionId: string = CODEX_UNKNOWN_SESSION_ID;
  let currentCwd: string | null = null;
  let currentGitBranch: string | null = null;

  for (const event of events) {
    if (event.kind === 'session_meta') {
      currentSessionId = event.sessionId;
      currentCwd = event.cwd;
      currentGitBranch = event.gitBranch;
      continue;
    }

    if (event.kind === 'tool_use') {
      // Duplicate call_id within a session (rare: retry or resumed replay).
      // Surface the stale pending with `result: null` before overwriting —
      // same signal we use for unpaired events at end of scan. Never silently
      // drop a tool_use.
      const existing = pendingByCallId.get(event.callId);
      if (existing) {
        out.push({ ...existing, result: null });
      }
      pendingByCallId.set(event.callId, {
        sessionId: currentSessionId,
        callId: event.callId,
        server: event.server,
        tool: event.tool,
        tsMs: event.tsMs,
        cwd: currentCwd,
        gitBranch: currentGitBranch,
      });
      continue;
    }

    // tool_result
    const pending = pendingByCallId.get(event.callId);
    if (!pending) continue; // orphan result (prefix compacted or corrupted begin)
    out.push({
      ...pending,
      result: { tsMs: event.tsMs, isError: event.isError },
    });
    pendingByCallId.delete(event.callId);
  }

  for (const pending of pendingByCallId.values()) {
    out.push({ ...pending, result: null });
  }

  return out;
}

export const CodexParser: ClientParser<CodexLineEvent> = {
  client: CODEX_CLIENT,
  version: CODEX_PARSER_VERSION,
  parseLine,
  defaultLogPaths: codexDefaultLogPaths,
};
