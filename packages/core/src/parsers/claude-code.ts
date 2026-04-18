import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import type { Client, ClientParser } from '../types/canonical.js';
import { discoverSessionFiles, expandHome } from '../util/paths.js';

export const CLAUDE_CODE_CLIENT: Client = 'claude-code';
export const CLAUDE_CODE_PARSER_VERSION = 1;

export interface ClaudeCodeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
}

export interface ClaudeCodeToolUseLine {
  kind: 'tool_use';
  sessionId: string;
  tsMs: number;
  usage: ClaudeCodeUsage | null;
  isSidechain: boolean;
  cwd: string | null;
  gitBranch: string | null;
  toolUses: ReadonlyArray<{ id: string; name: string }>;
}

export interface ClaudeCodeToolResultLine {
  kind: 'tool_result';
  sessionId: string;
  tsMs: number;
  results: ReadonlyArray<{ toolUseId: string; isError: boolean | null }>;
}

export type ClaudeCodeLineEvent = ClaudeCodeToolUseLine | ClaudeCodeToolResultLine;

/**
 * Paired tool_use with its optional tool_result. Consumed by the normalizer.
 * `result === null` when no matching tool_result was seen in the file — this
 * is the compacted-session edge case (INV-02 is_error null).
 */
export interface ClaudeCodeRawEvent {
  sessionId: string;
  toolUseId: string;
  toolName: string;
  tsMs: number;
  /** Token usage for the originating assistant message. Null when split across
   * multiple tool_uses in one message — only the first carries tokens so that
   * summing across McpCalls recovers the per-message total exactly. */
  usage: ClaudeCodeUsage | null;
  isSidechain: boolean;
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

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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

function parseUsage(raw: unknown): ClaudeCodeUsage | null {
  if (!isRecord(raw)) return null;
  return {
    input_tokens: asFiniteNumber(raw.input_tokens) ?? 0,
    output_tokens: asFiniteNumber(raw.output_tokens) ?? 0,
    cache_read_input_tokens: asFiniteNumber(raw.cache_read_input_tokens) ?? 0,
  };
}

/**
 * Parse a single JSONL line from a Claude Code session file.
 *
 * Returns `null` for: empty lines, malformed JSON, non-message records
 * (permission-mode, file-history-snapshot, deferred_tools_delta attachments),
 * and messages with no tool_use/tool_result blocks.
 *
 * Parser is intentionally client-neutral about MCP filtering — the normalizer
 * decides which tool names to keep (via `parseMcpToolName`). This keeps the
 * parser reusable and its surface small.
 */
export function parseLine(line: string): ClaudeCodeLineEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const type = asString(parsed.type);
  if (type !== 'assistant' && type !== 'user') return null;

  const sessionId = asString(parsed.sessionId);
  if (sessionId === null || sessionId.length === 0) return null;

  const tsMs = parseTimestampMs(parsed.timestamp);
  if (tsMs === null) return null;

  const message = isRecord(parsed.message) ? parsed.message : null;
  if (message === null) return null;

  const content = Array.isArray(message.content) ? message.content : null;
  if (content === null) return null;

  const isSidechain = asBooleanOrNull(parsed.isSidechain) ?? false;

  if (type === 'assistant') {
    const toolUses: Array<{ id: string; name: string }> = [];
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type !== 'tool_use') continue;
      const id = asString(block.id);
      const name = asString(block.name);
      if (id === null || name === null) continue;
      toolUses.push({ id, name });
    }
    if (toolUses.length === 0) return null;
    return {
      kind: 'tool_use',
      sessionId,
      tsMs,
      usage: parseUsage(message.usage),
      isSidechain,
      cwd: asString(parsed.cwd),
      gitBranch: asString(parsed.gitBranch),
      toolUses,
    };
  }

  // type === 'user': search content for tool_result blocks.
  const results: Array<{ toolUseId: string; isError: boolean | null }> = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type !== 'tool_result') continue;
    const toolUseId = asString(block.tool_use_id);
    if (toolUseId === null) continue;
    results.push({ toolUseId, isError: asBooleanOrNull(block.is_error) });
  }
  if (results.length === 0) return null;
  return { kind: 'tool_result', sessionId, tsMs, results };
}

/**
 * Combine line-level tool_use / tool_result events into paired ClaudeCodeRawEvents.
 *
 * Pairing is scoped per-sessionId so tool_use_ids can theoretically repeat across
 * sessions without cross-contamination. Unpaired tool_results (result arriving
 * for a tool_use whose prefix was compacted out) are silently dropped. Unpaired
 * tool_uses at end of scan emit with `result: null` so the normalizer surfaces
 * them with `is_error: null`, `duration_ms: null`.
 *
 * When an assistant message has N > 1 tool_uses, only the first carries usage
 * tokens — the rest get `usage: null`. Summing tokens across the resulting
 * McpCalls recovers the per-message total without N× inflation.
 */
export function pairEvents(events: Iterable<ClaudeCodeLineEvent>): ClaudeCodeRawEvent[] {
  type Pending = Omit<ClaudeCodeRawEvent, 'result'>;
  const pendingBySession = new Map<string, Map<string, Pending>>();
  const out: ClaudeCodeRawEvent[] = [];

  function getOrCreateSession(sessionId: string): Map<string, Pending> {
    let session = pendingBySession.get(sessionId);
    if (!session) {
      session = new Map();
      pendingBySession.set(sessionId, session);
    }
    return session;
  }

  for (const event of events) {
    if (event.kind === 'tool_use') {
      const session = getOrCreateSession(event.sessionId);
      for (const [idx, toolUse] of event.toolUses.entries()) {
        session.set(toolUse.id, {
          sessionId: event.sessionId,
          toolUseId: toolUse.id,
          toolName: toolUse.name,
          tsMs: event.tsMs,
          usage: idx === 0 ? event.usage : null,
          isSidechain: event.isSidechain,
          cwd: event.cwd,
          gitBranch: event.gitBranch,
        });
      }
    } else {
      const session = pendingBySession.get(event.sessionId);
      if (!session) continue;
      for (const result of event.results) {
        const pending = session.get(result.toolUseId);
        if (!pending) continue;
        out.push({ ...pending, result: { tsMs: event.tsMs, isError: result.isError } });
        session.delete(result.toolUseId);
      }
    }
  }

  for (const session of pendingBySession.values()) {
    for (const pending of session.values()) {
      out.push({ ...pending, result: null });
    }
  }

  return out;
}

/**
 * Async generator yielding lines from a JSONL file. Accepts an optional byte
 * offset so callers can implement incremental scans (Day 13 scan_state).
 */
export async function* readJsonlLines(path: string, startByte = 0): AsyncGenerator<string> {
  const stream = createReadStream(path, { start: startByte, encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  for await (const line of rl) yield line;
}

/**
 * OS-specific default log paths for Claude Code. Returns empty on Windows
 * for MVP — Windows support deferred until a Windows user reports it.
 */
export function defaultLogPaths(): string[] {
  if (process.platform === 'win32') return [];
  return [expandHome('~/.claude/projects')];
}

export const ClaudeCodeParser: ClientParser<ClaudeCodeLineEvent> = {
  client: CLAUDE_CODE_CLIENT,
  version: CLAUDE_CODE_PARSER_VERSION,
  parseLine,
  defaultLogPaths,
};

export { discoverSessionFiles };
