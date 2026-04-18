import type { Command } from 'commander';

import {
  ClaudeCodeNormalizer,
  ClaudeCodeParser,
  asProjectIdentity,
  discoverSessionFiles,
  pairClaudeCodeEvents,
  parseClaudeCodeLine,
  readJsonlLines,
} from '@mcpinsight/core';
import type { ClaudeCodeLineEvent, McpCall, NormalizeContext } from '@mcpinsight/core';

interface ScanOptions {
  print?: boolean;
  path: string[];
  limit?: number;
}

/**
 * Day 12 CLI entrypoint. No DB yet — emits McpCall[] as JSON. Day 13 replaces
 * `--print` with aggregator persistence.
 */
export function registerScanCommand(program: Command): void {
  program
    .command('scan')
    .description(
      'Parse Claude Code session logs and extract MCP tool calls (INV-05: no DB write, Day 13 adds persistence).',
    )
    .option('--print', 'Emit the extracted calls as JSON to stdout (default for Day 12)', true)
    .option('--path <path>', 'Override log root (repeatable)', collect, [] as string[])
    .option('--limit <n>', 'Cap emitted calls (useful on large local log corpora)', parseIntArg)
    .action(runScan);
}

async function runScan(options: ScanOptions): Promise<void> {
  const roots: string[] =
    options.path.length > 0 ? options.path : ClaudeCodeParser.defaultLogPaths();

  const allFiles: string[] = [];
  for (const root of roots) {
    const found = await discoverSessionFiles(root);
    allFiles.push(...found);
  }

  const ctx: NormalizeContext = {
    projectIdentity: asProjectIdentity('unresolved-day-12'),
    hasApiKey: false,
  };

  const calls: McpCall[] = [];
  let filesScanned = 0;
  let linesSeen = 0;
  let relevantEvents = 0;
  let readErrors = 0;
  const limit = options.limit;

  outer: for (const file of allFiles) {
    filesScanned++;
    const events: ClaudeCodeLineEvent[] = [];
    try {
      for await (const line of readJsonlLines(file)) {
        linesSeen++;
        const ev = parseClaudeCodeLine(line);
        if (ev !== null) {
          relevantEvents++;
          events.push(ev);
        }
      }
    } catch (cause) {
      readErrors++;
      process.stderr.write(`warning: failed to read ${file}: ${String(cause)}\n`);
      continue;
    }

    for (const raw of pairClaudeCodeEvents(events)) {
      const call = ClaudeCodeNormalizer.normalize(raw, ctx);
      if (call === null) continue;
      calls.push(call);
      if (typeof limit === 'number' && calls.length >= limit) break outer;
    }
  }

  process.stdout.write(`${JSON.stringify(calls, null, 2)}\n`);
  process.stderr.write(
    `scanned ${filesScanned} file(s), ${linesSeen} lines, ${relevantEvents} relevant events, ${readErrors} read error(s) → ${calls.length} MCP call(s)\n`,
  );
}

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function parseIntArg(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`invalid --limit: "${value}" (expected non-negative integer)`);
  }
  return n;
}
