import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Command } from 'commander';

import {
  ClaudeCodeNormalizer,
  ClaudeCodeParser,
  CodexNormalizer,
  CodexParser,
  createQueries,
  discoverSessionFiles,
  getProjectIdentity,
  ingestCalls,
  openDb,
  pairClaudeCodeEvents,
  pairCodexEvents,
  parseClaudeCodeLine,
  parseCodexLine,
  readJsonlLines,
} from '@mcpinsight/core';
import type {
  ClaudeCodeLineEvent,
  Client,
  CodexLineEvent,
  Database,
  McpCall,
  NormalizeContext,
  Queries,
} from '@mcpinsight/core';

interface ScanOptions {
  print?: boolean;
  path: string[];
  limit?: number;
  db?: string;
}

interface ProcessFileResult {
  calls: McpCall[];
  linesSeen: number;
  relevantEvents: number;
  pairedEvents: number;
  nonMcpCalls: number;
}

/**
 * One entry in the client registry. Encapsulates the parser + normalizer
 * pipeline for a single client so the scan command stays client-agnostic.
 * Adding a new client (cursor, windsurf, copilot) is a single append here.
 */
interface ClientAdapter {
  readonly client: Client;
  readonly label: string;
  defaultLogPaths(): string[];
  emptyMessage(roots: string[]): string;
  processFile(args: {
    filePath: string;
    startByte: number;
    ctx: NormalizeContext;
  }): Promise<ProcessFileResult>;
}

const ADAPTERS: ReadonlyArray<ClientAdapter> = [
  {
    client: 'claude-code',
    label: 'claude-code',
    defaultLogPaths: () => ClaudeCodeParser.defaultLogPaths(),
    emptyMessage: (roots) => `no Claude Code session files found (searched ${roots.join(', ')}).`,
    async processFile({ filePath, startByte, ctx }) {
      const events: ClaudeCodeLineEvent[] = [];
      let linesSeen = 0;
      let relevantEvents = 0;
      for await (const line of readJsonlLines(filePath, startByte)) {
        linesSeen++;
        const ev = parseClaudeCodeLine(line);
        if (ev !== null) {
          relevantEvents++;
          events.push(ev);
        }
      }
      const paired = pairClaudeCodeEvents(events);
      const calls: McpCall[] = [];
      let nonMcpCalls = 0;
      for (const raw of paired) {
        const call = ClaudeCodeNormalizer.normalize(raw, ctx);
        if (call === null) nonMcpCalls++;
        else calls.push(call);
      }
      return { calls, linesSeen, relevantEvents, pairedEvents: paired.length, nonMcpCalls };
    },
  },
  {
    client: 'codex',
    label: 'codex',
    defaultLogPaths: () => CodexParser.defaultLogPaths(),
    emptyMessage: (roots) => `no Codex rollout files found (searched ${roots.join(', ')}).`,
    async processFile({ filePath, startByte, ctx }) {
      const events: CodexLineEvent[] = [];
      let linesSeen = 0;
      let relevantEvents = 0;
      for await (const line of readJsonlLines(filePath, startByte)) {
        linesSeen++;
        const ev = parseCodexLine(line);
        if (ev !== null) {
          relevantEvents++;
          events.push(ev);
        }
      }
      const paired = pairCodexEvents(events);
      const calls: McpCall[] = [];
      let nonMcpCalls = 0;
      for (const raw of paired) {
        const call = CodexNormalizer.normalize(raw, ctx);
        if (call === null) nonMcpCalls++;
        else calls.push(call);
      }
      return { calls, linesSeen, relevantEvents, pairedEvents: paired.length, nonMcpCalls };
    },
  },
];

interface PerClientStats {
  label: string;
  filesScanned: number;
  filesSkippedUpToDate: number;
  readErrors: number;
  linesSeen: number;
  relevantEvents: number;
  pairedEvents: number;
  nonMcpCalls: number;
  ingested: number;
  selfReferenceExcluded: number;
  totalInDb: number;
}

function defaultDbPath(): string {
  return join(homedir(), '.mcpinsight', 'data.db');
}

export function registerScanCommand(program: Command): void {
  program
    .command('scan')
    .description(
      'Parse Claude Code + Codex session logs, normalize MCP tool calls, ingest to SQLite (INV-01/04/05).',
    )
    .option('--print', 'Emit the extracted calls as JSON to stdout (skips DB write)', false)
    .option(
      '--path <path>',
      'Override log root (repeatable; applies to every client)',
      collect,
      [] as string[],
    )
    .option('--limit <n>', 'Cap emitted calls (useful on large local log corpora)', parseIntArg)
    .option('--db <path>', 'Override SQLite path (default: ~/.mcpinsight/data.db)')
    .action(runScan);
}

async function runScan(options: ScanOptions): Promise<void> {
  const identity = getProjectIdentity(process.cwd());
  const ctx: NormalizeContext = { projectIdentity: identity.identity, hasApiKey: false };
  const limit = options.limit;

  process.stderr.write(`project_identity: ${identity.identity} (source=${identity.source})\n`);

  const useDb = !options.print;
  const dbHandle = useDb ? openDb({ path: options.db ?? defaultDbPath() }) : null;
  const queries = dbHandle ? createQueries(dbHandle.db) : null;

  const collected: McpCall[] = [];
  const perClient: PerClientStats[] = [];

  try {
    for (const adapter of ADAPTERS) {
      const stats: PerClientStats = {
        label: adapter.label,
        filesScanned: 0,
        filesSkippedUpToDate: 0,
        readErrors: 0,
        linesSeen: 0,
        relevantEvents: 0,
        pairedEvents: 0,
        nonMcpCalls: 0,
        ingested: 0,
        selfReferenceExcluded: 0,
        totalInDb: 0,
      };
      perClient.push(stats);

      const roots = options.path.length > 0 ? options.path : adapter.defaultLogPaths();
      const files: string[] = [];
      for (const root of roots) {
        const found = await discoverSessionFiles(root);
        files.push(...found);
      }

      if (files.length === 0) {
        process.stderr.write(`${adapter.emptyMessage(roots)}\n`);
      }

      await scanFilesForClient({
        adapter,
        files,
        ctx,
        limit,
        collected,
        stats,
        db: dbHandle?.db ?? null,
        queries,
      });

      if (queries) {
        stats.totalInDb = queries.countCallsByClient(adapter.client);
      }

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

  writeSummary(perClient, useDb, options.db);
}

interface ScanFilesArgs {
  adapter: ClientAdapter;
  files: ReadonlyArray<string>;
  ctx: NormalizeContext;
  limit: number | undefined;
  collected: McpCall[];
  stats: PerClientStats;
  db: Database | null;
  queries: Queries | null;
}

async function scanFilesForClient(args: ScanFilesArgs): Promise<void> {
  const { adapter, files, ctx, limit, collected, stats, db, queries } = args;
  for (const file of files) {
    stats.filesScanned++;

    let startByte = 0;
    if (queries) {
      const prior = queries.getScanState(file);
      const fileStats = await stat(file).catch(() => null);
      if (!fileStats) continue;
      startByte = prior?.last_byte_offset ?? 0;
      // File shrunk (rotated/compacted) → rescan from 0.
      if (startByte > fileStats.size) startByte = 0;
      if (startByte >= fileStats.size) {
        stats.filesSkippedUpToDate++;
        continue;
      }
    }

    let result: ProcessFileResult;
    try {
      result = await adapter.processFile({ filePath: file, startByte, ctx });
    } catch (cause) {
      stats.readErrors++;
      process.stderr.write(`warning: failed to read ${file}: ${String(cause)}\n`);
      continue;
    }

    stats.linesSeen += result.linesSeen;
    stats.relevantEvents += result.relevantEvents;
    stats.pairedEvents += result.pairedEvents;
    stats.nonMcpCalls += result.nonMcpCalls;

    // Apply global --limit across clients — cap perFile to the remaining budget.
    const remaining =
      typeof limit === 'number' ? Math.max(0, limit - collected.length) : result.calls.length;
    const capped = result.calls.slice(0, remaining);

    if (db && queries) {
      const ingestStats = ingestCalls(db, queries, capped);
      stats.ingested += ingestStats.inserted;
      stats.selfReferenceExcluded += ingestStats.selfReferenceExcluded;
      const sizeNow = (await stat(file).catch(() => null))?.size ?? startByte;
      queries.upsertScanState({
        file_path: file,
        last_byte_offset: sizeNow,
        last_scanned_at: Date.now(),
        client: adapter.client,
      });
    }

    collected.push(...capped);
    if (typeof limit === 'number' && collected.length >= limit) break;
  }
}

function writeSummary(
  perClient: ReadonlyArray<PerClientStats>,
  useDb: boolean,
  dbPath: string | undefined,
): void {
  const topLine = perClient
    .map((s) => `${s.label}: ${formatInt(s.totalInDb)} (${formatInt(s.ingested)} new)`)
    .join(' | ');
  process.stderr.write(`${topLine}\n`);

  for (const s of perClient) {
    const detail = [
      `${s.label}:`,
      `${s.filesScanned} scanned`,
      `${s.filesSkippedUpToDate} up-to-date`,
      `${s.readErrors} read errors`,
      `${s.linesSeen} lines`,
      `${s.relevantEvents} relevant`,
      `${s.pairedEvents} paired`,
      `${s.nonMcpCalls} non_mcp`,
      `${s.selfReferenceExcluded} self_reference`,
    ].join(' | ');
    process.stderr.write(`${detail}\n`);
  }

  if (useDb) {
    process.stderr.write(`db: ${dbPath ?? defaultDbPath()}\n`);
  }
}

function formatInt(value: number): string {
  return value.toLocaleString('en-US');
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
