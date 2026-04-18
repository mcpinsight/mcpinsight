import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Command } from 'commander';

import {
  ClaudeCodeNormalizer,
  ClaudeCodeParser,
  createQueries,
  discoverSessionFiles,
  getProjectIdentity,
  ingestCalls,
  openDb,
  pairClaudeCodeEvents,
  parseClaudeCodeLine,
  readJsonlLines,
} from '@mcpinsight/core';
import type { ClaudeCodeLineEvent, McpCall, NormalizeContext } from '@mcpinsight/core';

interface ScanOptions {
  print?: boolean;
  path: string[];
  limit?: number;
  db?: string;
}

const CLIENT = 'claude-code';

/** Default DB path — ~/.mcpinsight/data.db. */
function defaultDbPath(): string {
  return join(homedir(), '.mcpinsight', 'data.db');
}

export function registerScanCommand(program: Command): void {
  program
    .command('scan')
    .description(
      'Parse Claude Code session logs, normalize MCP tool calls, ingest to SQLite (INV-01/04/05).',
    )
    .option('--print', 'Emit the extracted calls as JSON to stdout (skips DB write)', false)
    .option('--path <path>', 'Override log root (repeatable)', collect, [] as string[])
    .option('--limit <n>', 'Cap emitted calls (useful on large local log corpora)', parseIntArg)
    .option('--db <path>', 'Override SQLite path (default: ~/.mcpinsight/data.db)')
    .action(runScan);
}

async function runScan(options: ScanOptions): Promise<void> {
  const roots = options.path.length > 0 ? options.path : ClaudeCodeParser.defaultLogPaths();
  const identity = getProjectIdentity(process.cwd());
  const ctx: NormalizeContext = { projectIdentity: identity.identity, hasApiKey: false };
  const limit = options.limit;

  process.stderr.write(`project_identity: ${identity.identity} (source=${identity.source})\n`);

  const allFiles: string[] = [];
  for (const root of roots) {
    const found = await discoverSessionFiles(root);
    allFiles.push(...found);
  }

  const useDb = !options.print;
  const dbHandle = useDb ? openDb({ path: options.db ?? defaultDbPath() }) : null;
  const queries = dbHandle ? createQueries(dbHandle.db) : null;

  let linesSeen = 0;
  let relevantEvents = 0;
  let pairedEvents = 0;
  let nonMcpCalls = 0;
  let readErrors = 0;
  let filesScanned = 0;
  let filesSkippedUpToDate = 0;
  let selfReferenceExcluded = 0;
  const collected: McpCall[] = [];

  try {
    for (const file of allFiles) {
      filesScanned++;

      let startByte = 0;
      if (queries) {
        const prior = queries.getScanState(file);
        const stats = await stat(file).catch(() => null);
        if (!stats) continue;
        startByte = prior?.last_byte_offset ?? 0;
        // File shrunk (rotated/compacted) → rescan from 0.
        if (startByte > stats.size) startByte = 0;
        if (startByte >= stats.size) {
          filesSkippedUpToDate++;
          continue;
        }
      }

      const events: ClaudeCodeLineEvent[] = [];
      try {
        for await (const line of readJsonlLines(file, startByte)) {
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

      const paired = pairClaudeCodeEvents(events);
      pairedEvents += paired.length;

      const perFileCalls: McpCall[] = [];
      for (const raw of paired) {
        const call = ClaudeCodeNormalizer.normalize(raw, ctx);
        if (call === null) {
          nonMcpCalls++;
          continue;
        }
        perFileCalls.push(call);
        if (typeof limit === 'number' && collected.length + perFileCalls.length >= limit) {
          break;
        }
      }

      if (dbHandle && queries) {
        const ingestStats = ingestCalls(dbHandle.db, queries, perFileCalls);
        selfReferenceExcluded += ingestStats.selfReferenceExcluded;
        const sizeNow = (await stat(file).catch(() => null))?.size ?? startByte;
        queries.upsertScanState({
          file_path: file,
          last_byte_offset: sizeNow,
          last_scanned_at: Date.now(),
          client: CLIENT,
        });
      }

      collected.push(...perFileCalls);
      if (typeof limit === 'number' && collected.length >= limit) break;
    }

    if (options.print) {
      process.stdout.write(
        `${JSON.stringify(collected.slice(0, limit ?? collected.length), null, 2)}\n`,
      );
    }
  } finally {
    dbHandle?.close();
  }

  const summary = [
    `files: ${filesScanned} scanned`,
    `${filesSkippedUpToDate} up-to-date`,
    `${readErrors} read errors`,
    `lines: ${linesSeen} read`,
    `relevant: ${relevantEvents}`,
    `paired: ${pairedEvents}`,
    `mcp_calls: ${collected.length} ingested`,
    `non_mcp: ${nonMcpCalls} (Bash/Read/Edit/Agent filtered)`,
    `self_reference_excluded: ${selfReferenceExcluded}`,
  ].join(' | ');
  process.stderr.write(`${summary}\n`);
  if (useDb) {
    process.stderr.write(`db: ${options.db ?? defaultDbPath()}\n`);
  }
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
