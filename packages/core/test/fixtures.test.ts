import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ClaudeCodeNormalizer } from '../src/normalizers/claude-code.js';
import { CodexNormalizer } from '../src/normalizers/codex.js';
import {
  pairEvents as pairClaudeCodeEvents,
  parseLine as parseClaudeCodeLine,
} from '../src/parsers/claude-code.js';
import {
  pairEvents as pairCodexEvents,
  parseLine as parseCodexLine,
} from '../src/parsers/codex.js';
import { asProjectIdentity } from '../src/types/brands.js';
import type { ClientNormalizer, McpCall, NormalizeContext } from '../src/types/canonical.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = resolve(here, '..', 'fixtures');

interface FixtureMeta {
  scenario: string;
  expected_call_count: number;
  expected_servers: string[];
  expected_tools: string[];
  expected_errors: number;
  expected_null_is_error_count?: number;
  expected_null_duration_count?: number;
  expected_sidechain_count?: number;
  expected_session_ids?: string[];
}

type PairedEvent = { isSidechain?: boolean };

interface ClientRunner {
  dir: string;
  requiredScenarios: string[];
  normalizer: ClientNormalizer<never>;
  run(jsonlPath: string): Promise<{ calls: McpCall[]; paired: PairedEvent[] }>;
}

async function listDirFiles(root: string): Promise<string[]> {
  const fs = await import('node:fs/promises');
  const out: string[] = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.isFile()) out.push(join(root, entry.name));
  }
  return out;
}

async function loadFixtures(dir: string): Promise<Array<{ meta: FixtureMeta; jsonlPath: string }>> {
  const files = await listDirFiles(dir);
  const metas = files.filter((f) => f.endsWith('.meta.json'));
  const jsonls = new Set(files.filter((f) => f.endsWith('.jsonl')));
  const loaded: Array<{ meta: FixtureMeta; jsonlPath: string }> = [];
  for (const metaPath of metas) {
    const jsonlPath = metaPath.replace(/\.meta\.json$/, '.jsonl');
    if (!jsonls.has(jsonlPath)) throw new Error(`fixture missing sibling jsonl: ${metaPath}`);
    const meta = JSON.parse(await readFile(metaPath, 'utf-8')) as FixtureMeta;
    loaded.push({ meta, jsonlPath });
  }
  return loaded;
}

function makeCtx(): NormalizeContext {
  return { projectIdentity: asProjectIdentity('fixture-proj'), hasApiKey: false };
}

const clients: ClientRunner[] = [
  {
    dir: resolve(fixturesRoot, 'claude-code'),
    requiredScenarios: ['happy-path', 'compacted-session', 'subagent-session'],
    normalizer: ClaudeCodeNormalizer as ClientNormalizer<never>,
    async run(jsonlPath) {
      const text = await readFile(jsonlPath, 'utf-8');
      const events = [];
      for (const line of text.split(/\r?\n/)) {
        const ev = parseClaudeCodeLine(line);
        if (ev !== null) events.push(ev);
      }
      const paired = pairClaudeCodeEvents(events);
      const ctx = makeCtx();
      const calls: McpCall[] = [];
      for (const raw of paired) {
        const call = ClaudeCodeNormalizer.normalize(raw, ctx);
        if (call !== null) calls.push(call);
      }
      return { calls, paired };
    },
  },
  {
    dir: resolve(fixturesRoot, 'codex'),
    requiredScenarios: ['happy-path', 'malformed', 'edge'],
    normalizer: CodexNormalizer as ClientNormalizer<never>,
    async run(jsonlPath) {
      const text = await readFile(jsonlPath, 'utf-8');
      const events = [];
      for (const line of text.split(/\r?\n/)) {
        const ev = parseCodexLine(line);
        if (ev !== null) events.push(ev);
      }
      const paired = pairCodexEvents(events);
      const ctx = makeCtx();
      const calls: McpCall[] = [];
      for (const raw of paired) {
        const call = CodexNormalizer.normalize(raw, ctx);
        if (call !== null) calls.push(call);
      }
      return { calls, paired };
    },
  },
];

for (const client of clients) {
  describe(`fixtures/${client.normalizer.client}`, () => {
    it('has required scenarios', async () => {
      const all = await listDirFiles(client.dir);
      const scenarios = all
        .filter((f) => f.endsWith('.meta.json'))
        .map((f) => f.replace(/.*\/([^/]+)\.meta\.json$/, '$1'));
      for (const required of client.requiredScenarios) {
        expect(scenarios).toContain(required);
      }
    });

    it('each fixture matches its meta expectations', async () => {
      const fixtures = await loadFixtures(client.dir);
      expect(fixtures.length).toBeGreaterThanOrEqual(client.requiredScenarios.length);
      for (const { meta, jsonlPath } of fixtures) {
        const { calls, paired } = await client.run(jsonlPath);
        expect(
          calls,
          `${client.normalizer.client}/${meta.scenario}: expected_call_count`,
        ).toHaveLength(meta.expected_call_count);

        const servers = [...new Set(calls.map((c) => c.server_name))].sort();
        expect(servers, `${client.normalizer.client}/${meta.scenario}: expected_servers`).toEqual(
          [...meta.expected_servers].sort(),
        );

        const tools = [...new Set(calls.map((c) => `${c.server_name}/${c.tool_name}`))].sort();
        expect(tools, `${client.normalizer.client}/${meta.scenario}: expected_tools`).toEqual(
          [...meta.expected_tools].sort(),
        );

        const errors = calls.filter((c) => c.is_error === true).length;
        expect(errors, `${client.normalizer.client}/${meta.scenario}: expected_errors`).toBe(
          meta.expected_errors,
        );

        if (typeof meta.expected_null_is_error_count === 'number') {
          const nulls = calls.filter((c) => c.is_error === null).length;
          expect(
            nulls,
            `${client.normalizer.client}/${meta.scenario}: expected_null_is_error_count`,
          ).toBe(meta.expected_null_is_error_count);
        }

        if (typeof meta.expected_null_duration_count === 'number') {
          const nulls = calls.filter((c) => c.duration_ms === null).length;
          expect(
            nulls,
            `${client.normalizer.client}/${meta.scenario}: expected_null_duration_count`,
          ).toBe(meta.expected_null_duration_count);
        }

        if (typeof meta.expected_sidechain_count === 'number') {
          // `isSidechain` lives on the paired raw event; `McpCall` does not
          // carry it (canonical shape frozen by INV-06). Assert pre-normalization.
          const sidechainPaired = paired.filter((p) => p.isSidechain === true).length;
          expect(
            sidechainPaired,
            `${client.normalizer.client}/${meta.scenario}: expected_sidechain_count (paired)`,
          ).toBe(meta.expected_sidechain_count);
        }

        if (Array.isArray(meta.expected_session_ids)) {
          const seen = [...new Set(calls.map((c) => c.session_id as string))].sort();
          expect(
            seen,
            `${client.normalizer.client}/${meta.scenario}: expected_session_ids`,
          ).toEqual([...meta.expected_session_ids].sort());
        }
      }
    });
  });
}
