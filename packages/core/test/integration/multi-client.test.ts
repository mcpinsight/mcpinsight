import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ingestCalls } from '../../src/aggregator/ingest.js';
import { openDb } from '../../src/db/connection.js';
import { createQueries } from '../../src/db/queries.js';
import { ClaudeCodeNormalizer } from '../../src/normalizers/claude-code.js';
import { CodexNormalizer } from '../../src/normalizers/codex.js';
import {
  pairEvents as pairClaudeCodeEvents,
  parseLine as parseClaudeCodeLine,
} from '../../src/parsers/claude-code.js';
import {
  pairEvents as pairCodexEvents,
  parseLine as parseCodexLine,
} from '../../src/parsers/codex.js';
import { asProjectIdentity } from '../../src/types/brands.js';
import type { McpCall, NormalizeContext } from '../../src/types/canonical.js';

/**
 * Multi-client integration — parse both fixture corpora into canonical
 * McpCalls, ingest into one in-memory DB, then assert that:
 *   - topServers filters by --client correctly (claude-code ⊥ codex, sum = all)
 *   - listClients returns exactly one row per client observed
 *   - countCallsByClient matches physical ingestion (self-ref included)
 *   - INV-04 self-reference exclusion survives through listClients
 * This is the first test that wires both parsers through the aggregator
 * into the same DB — it guards the Day 18 contract that scan works
 * identically across clients.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = resolve(here, '..', '..', 'fixtures');

function makeCtx(): NormalizeContext {
  return { projectIdentity: asProjectIdentity('proj-multi'), hasApiKey: false };
}

async function parseClaudeCodeFile(path: string): Promise<McpCall[]> {
  const text = await readFile(path, 'utf-8');
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    const ev = parseClaudeCodeLine(line);
    if (ev !== null) events.push(ev);
  }
  const calls: McpCall[] = [];
  const ctx = makeCtx();
  for (const raw of pairClaudeCodeEvents(events)) {
    const call = ClaudeCodeNormalizer.normalize(raw, ctx);
    if (call !== null) calls.push(call);
  }
  return calls;
}

async function parseCodexFile(path: string): Promise<McpCall[]> {
  const text = await readFile(path, 'utf-8');
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    const ev = parseCodexLine(line);
    if (ev !== null) events.push(ev);
  }
  const calls: McpCall[] = [];
  const ctx = makeCtx();
  for (const raw of pairCodexEvents(events)) {
    const call = CodexNormalizer.normalize(raw, ctx);
    if (call !== null) calls.push(call);
  }
  return calls;
}

function freshDb() {
  const handle = openDb({ path: ':memory:' });
  const queries = createQueries(handle.db);
  return { ...handle, queries };
}

describe('multi-client ingest', () => {
  it('topServers --client partitions call counts disjointly between claude-code and codex', async () => {
    const { db, queries, close } = freshDb();
    try {
      const ccCalls = await parseClaudeCodeFile(
        resolve(fixturesRoot, 'claude-code', 'happy-path.jsonl'),
      );
      const codexCalls = await parseCodexFile(resolve(fixturesRoot, 'codex', 'happy-path.jsonl'));

      ingestCalls(db, queries, ccCalls);
      ingestCalls(db, queries, codexCalls);

      const sinceMs = 0;
      const ccTop = queries.topServers({ sinceMs, client: 'claude-code', limit: 50 });
      const codexTop = queries.topServers({ sinceMs, client: 'codex', limit: 50 });
      const combined = queries.topServers({ sinceMs, client: null, limit: 50 });

      expect(ccTop.reduce((acc, r) => acc + r.calls, 0)).toBe(ccCalls.length);
      expect(codexTop.reduce((acc, r) => acc + r.calls, 0)).toBe(codexCalls.length);

      // Servers overlap between the two fixtures (both exercise filesystem +
      // github). Invariant under partition: cc(s) + codex(s) == combined(s).
      for (const row of combined) {
        const cc = ccTop.find((r) => r.server_name === row.server_name)?.calls ?? 0;
        const codex = codexTop.find((r) => r.server_name === row.server_name)?.calls ?? 0;
        expect(cc + codex).toBe(row.calls);
      }
    } finally {
      close();
    }
  });

  it('listClients returns one row per observed client with correct call/server counts', async () => {
    const { db, queries, close } = freshDb();
    try {
      const ccCalls = await parseClaudeCodeFile(
        resolve(fixturesRoot, 'claude-code', 'happy-path.jsonl'),
      );
      const codexCalls = await parseCodexFile(resolve(fixturesRoot, 'codex', 'happy-path.jsonl'));

      ingestCalls(db, queries, ccCalls);
      ingestCalls(db, queries, codexCalls);

      const rows = queries.listClients({ sinceMs: 0 });
      expect(rows.map((r) => r.client).sort()).toEqual(['claude-code', 'codex']);

      const cc = rows.find((r) => r.client === 'claude-code');
      const codex = rows.find((r) => r.client === 'codex');

      expect(cc?.calls).toBe(ccCalls.length);
      expect(codex?.calls).toBe(codexCalls.length);

      // Both happy-path fixtures span exactly {filesystem, github}.
      expect(cc?.servers).toBe(2);
      expect(codex?.servers).toBe(2);

      expect(cc?.first_ts).toBeLessThanOrEqual(cc?.last_ts ?? 0);
      expect(codex?.first_ts).toBeLessThanOrEqual(codex?.last_ts ?? 0);
    } finally {
      close();
    }
  });

  it('listClients drops self-reference calls from count + distinct-servers (INV-04)', async () => {
    const { db, queries, close } = freshDb();
    try {
      const ccCalls = await parseClaudeCodeFile(
        resolve(fixturesRoot, 'claude-code', 'happy-path.jsonl'),
      );
      const first = ccCalls[0];
      if (!first) throw new Error('fixture produced zero calls — regression');
      const selfRef: McpCall = { ...first, server_name: 'mcpinsight', tool_name: 'overview' };
      ingestCalls(db, queries, [...ccCalls, selfRef]);

      const rows = queries.listClients({ sinceMs: 0 });
      const cc = rows.find((r) => r.client === 'claude-code');

      // Self-ref must not inflate the call count or the distinct-server count.
      expect(cc?.calls).toBe(ccCalls.length);
      expect(cc?.servers).toBe(2);
    } finally {
      close();
    }
  });

  it('listClients on an empty DB returns []', () => {
    const { queries, close } = freshDb();
    try {
      expect(queries.listClients({ sinceMs: 0 })).toEqual([]);
    } finally {
      close();
    }
  });

  it('listClients --days window excludes calls before sinceMs', async () => {
    const { db, queries, close } = freshDb();
    try {
      const ccCalls = await parseClaudeCodeFile(
        resolve(fixturesRoot, 'claude-code', 'happy-path.jsonl'),
      );
      ingestCalls(db, queries, ccCalls);

      // Fixture timestamps are all in 2026-04. sinceMs in 2100 → empty.
      const futureSince = Date.UTC(2100, 0, 1);
      expect(queries.listClients({ sinceMs: futureSince })).toEqual([]);
    } finally {
      close();
    }
  });

  it('countCallsByClient reports physical row count (self-ref included, INV-04 does NOT apply)', async () => {
    const { db, queries, close } = freshDb();
    try {
      const ccCalls = await parseClaudeCodeFile(
        resolve(fixturesRoot, 'claude-code', 'happy-path.jsonl'),
      );
      const codexCalls = await parseCodexFile(resolve(fixturesRoot, 'codex', 'happy-path.jsonl'));

      expect(queries.countCallsByClient('claude-code')).toBe(0);
      expect(queries.countCallsByClient('codex')).toBe(0);

      const first = ccCalls[0];
      if (!first) throw new Error('fixture produced zero calls — regression');
      const selfRef: McpCall = { ...first, server_name: 'mcpinsight', tool_name: 'overview' };
      ingestCalls(db, queries, [...ccCalls, selfRef]);
      ingestCalls(db, queries, codexCalls);

      // Claude Code row count must include the self-ref row (physical count).
      expect(queries.countCallsByClient('claude-code')).toBe(ccCalls.length + 1);
      expect(queries.countCallsByClient('codex')).toBe(codexCalls.length);
      // Client we never wrote → 0 (no error).
      expect(queries.countCallsByClient('cursor')).toBe(0);
    } finally {
      close();
    }
  });
});
