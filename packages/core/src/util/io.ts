import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import { expandHome } from './paths.js';

/**
 * Async generator yielding lines from a JSONL file. Accepts an optional byte
 * offset so callers can implement incremental scans (scan_state.last_byte_offset).
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
export function claudeCodeDefaultLogPaths(): string[] {
  if (process.platform === 'win32') return [];
  return [expandHome('~/.claude/projects')];
}

/**
 * OS-specific default log paths for OpenAI Codex CLI.
 *
 * Codex writes rollout files under `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`.
 * We return the root `sessions/` dir; `discoverSessionFiles` recurses through
 * the date sub-dirs. If `CODEX_HOME` is set, prefer it; otherwise default to
 * `~/.codex/sessions`. Windows deferred (same rationale as Claude Code).
 */
export function codexDefaultLogPaths(): string[] {
  if (process.platform === 'win32') return [];
  const codexHome = process.env.CODEX_HOME;
  if (codexHome && codexHome.length > 0) return [expandHome(`${codexHome}/sessions`)];
  return [expandHome('~/.codex/sessions')];
}
