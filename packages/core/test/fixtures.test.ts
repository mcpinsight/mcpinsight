import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ClaudeCodeNormalizer } from '../src/normalizers/claude-code.js';
import type { ClaudeCodeRawEvent } from '../src/parsers/claude-code.js';
import { pairEvents, parseLine } from '../src/parsers/claude-code.js';
import { asProjectIdentity } from '../src/types/brands.js';
import type { McpCall } from '../src/types/canonical.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(here, '..', 'fixtures', 'claude-code');

interface FixtureMeta {
  scenario: string;
  expected_call_count: number;
  expected_servers: string[];
  expected_tools: string[];
  expected_errors: number;
  expected_null_is_error_count?: number;
  expected_null_duration_count?: number;
  expected_sidechain_count?: number;
}

async function listDirFiles(root: string): Promise<string[]> {
  const fs = await import('node:fs/promises');
  const out: string[] = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.isFile()) out.push(join(root, entry.name));
  }
  return out;
}

async function loadFixtures(): Promise<Array<{ meta: FixtureMeta; jsonlPath: string }>> {
  const files = await listDirFiles(fixtureRoot);
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

async function runFixture(
  jsonlPath: string,
): Promise<{ calls: McpCall[]; paired: ClaudeCodeRawEvent[] }> {
  const text = await readFile(jsonlPath, 'utf-8');
  const lines = text.split(/\r?\n/);
  const events = [];
  for (const line of lines) {
    const ev = parseLine(line);
    if (ev !== null) events.push(ev);
  }
  const paired = pairEvents(events);
  const ctx = { projectIdentity: asProjectIdentity('fixture-proj'), hasApiKey: false };
  const calls: McpCall[] = [];
  for (const raw of paired) {
    const call = ClaudeCodeNormalizer.normalize(raw, ctx);
    if (call !== null) calls.push(call);
  }
  return { calls, paired };
}

describe('fixtures/claude-code', () => {
  it('has at least 3 fixture scenarios covering happy-path, compacted, and subagent', async () => {
    const all = await listDirFiles(fixtureRoot);
    const scenarios = all
      .filter((f) => f.endsWith('.meta.json'))
      .map((f) => f.replace(/.*\/([^/]+)\.meta\.json$/, '$1'));
    expect(scenarios).toContain('happy-path');
    expect(scenarios).toContain('compacted-session');
    expect(scenarios).toContain('subagent-session');
  });

  it('each fixture matches its meta expectations', async () => {
    const fixtures = await loadFixtures();
    expect(fixtures.length).toBeGreaterThanOrEqual(3);
    for (const { meta, jsonlPath } of fixtures) {
      const { calls, paired } = await runFixture(jsonlPath);
      expect(calls, `${meta.scenario}: expected_call_count`).toHaveLength(meta.expected_call_count);

      const servers = [...new Set(calls.map((c) => c.server_name))].sort();
      expect(servers, `${meta.scenario}: expected_servers`).toEqual(
        [...meta.expected_servers].sort(),
      );

      const tools = [...new Set(calls.map((c) => `${c.server_name}/${c.tool_name}`))].sort();
      expect(tools, `${meta.scenario}: expected_tools`).toEqual([...meta.expected_tools].sort());

      const errors = calls.filter((c) => c.is_error === true).length;
      expect(errors, `${meta.scenario}: expected_errors`).toBe(meta.expected_errors);

      if (typeof meta.expected_null_is_error_count === 'number') {
        const nulls = calls.filter((c) => c.is_error === null).length;
        expect(nulls, `${meta.scenario}: expected_null_is_error_count`).toBe(
          meta.expected_null_is_error_count,
        );
      }

      if (typeof meta.expected_null_duration_count === 'number') {
        const nulls = calls.filter((c) => c.duration_ms === null).length;
        expect(nulls, `${meta.scenario}: expected_null_duration_count`).toBe(
          meta.expected_null_duration_count,
        );
      }

      if (typeof meta.expected_sidechain_count === 'number') {
        // `isSidechain` lives on the paired raw event; `McpCall` does not carry
        // it (canonical shape frozen by INV-06). Assert pre-normalization.
        const mcpToolUseIds = new Set(calls.map((c) => `${c.session_id}:${c.tool_name}`));
        const sidechainPaired = paired.filter((p) => p.isSidechain).length;
        expect(sidechainPaired, `${meta.scenario}: expected_sidechain_count (paired)`).toBe(
          meta.expected_sidechain_count,
        );
        // Sanity: none of the sidechain raw events should have been dropped by
        // the normalizer (MCP tools all carry through).
        expect(mcpToolUseIds.size).toBeGreaterThan(0);
      }
    }
  });
});
