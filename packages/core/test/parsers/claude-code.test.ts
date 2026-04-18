import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ClaudeCodeParser, pairEvents, parseLine } from '../../src/parsers/claude-code.js';
import { claudeCodeDefaultLogPaths, readJsonlLines } from '../../src/util/io.js';
import { discoverSessionFiles } from '../../src/util/paths.js';

function assistantLine(
  sessionId: string,
  tsIso: string,
  toolUses: Array<{ id: string; name: string }>,
  opts: {
    isSidechain?: boolean;
    usage?: { input: number; output: number; cache: number };
    extraContent?: Array<Record<string, unknown>>;
  } = {},
): string {
  const usage = opts.usage ?? { input: 100, output: 20, cache: 0 };
  return JSON.stringify({
    type: 'assistant',
    sessionId,
    timestamp: tsIso,
    isSidechain: opts.isSidechain ?? false,
    cwd: '/work',
    gitBranch: 'main',
    message: {
      model: 'claude-opus-4-7',
      content: [
        ...(opts.extraContent ?? []),
        ...toolUses.map((t) => ({ type: 'tool_use', id: t.id, name: t.name, input: {} })),
      ],
      usage: {
        input_tokens: usage.input,
        output_tokens: usage.output,
        cache_read_input_tokens: usage.cache,
      },
    },
  });
}

function userToolResultLine(
  sessionId: string,
  tsIso: string,
  results: Array<{ toolUseId: string; isError: boolean | null }>,
): string {
  return JSON.stringify({
    type: 'user',
    sessionId,
    timestamp: tsIso,
    message: {
      role: 'user',
      content: results.map((r) => ({
        type: 'tool_result',
        tool_use_id: r.toolUseId,
        content: 'x',
        is_error: r.isError,
      })),
    },
  });
}

describe('parseLine', () => {
  it('returns null for empty/whitespace lines', () => {
    expect(parseLine('')).toBeNull();
    expect(parseLine('   ')).toBeNull();
    expect(parseLine('\n')).toBeNull();
  });

  it('returns null for malformed JSON without throwing', () => {
    expect(parseLine('{not json')).toBeNull();
    expect(parseLine('[1, 2')).toBeNull();
  });

  it('returns null for non-assistant/user record types', () => {
    expect(
      parseLine(JSON.stringify({ type: 'permission-mode', permissionMode: 'default' })),
    ).toBeNull();
    expect(parseLine(JSON.stringify({ type: 'file-history-snapshot' }))).toBeNull();
  });

  it('returns null when sessionId or timestamp is missing', () => {
    expect(
      parseLine(
        JSON.stringify({
          type: 'assistant',
          timestamp: '2026-04-10T10:00:00.000Z',
          message: { content: [{ type: 'tool_use', id: 't', name: 'Bash' }] },
        }),
      ),
    ).toBeNull();
    expect(
      parseLine(
        JSON.stringify({
          type: 'assistant',
          sessionId: 's1',
          message: { content: [{ type: 'tool_use', id: 't', name: 'Bash' }] },
        }),
      ),
    ).toBeNull();
  });

  it('returns null for text-only assistant messages (no tool_use blocks)', () => {
    const line = JSON.stringify({
      type: 'assistant',
      sessionId: 's1',
      timestamp: '2026-04-10T10:00:00.000Z',
      message: {
        content: [{ type: 'text', text: 'hello' }],
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
      },
    });
    expect(parseLine(line)).toBeNull();
  });

  it('parses an assistant tool_use line and captures usage', () => {
    const line = assistantLine('s1', '2026-04-10T10:00:05.000Z', [
      { id: 'u1', name: 'mcp__filesystem__read_file' },
    ]);
    const ev = parseLine(line);
    expect(ev).not.toBeNull();
    if (!ev || ev.kind !== 'tool_use') throw new Error('expected tool_use kind');
    expect(ev.sessionId).toBe('s1');
    expect(ev.tsMs).toBe(Date.parse('2026-04-10T10:00:05.000Z'));
    expect(ev.toolUses).toEqual([{ id: 'u1', name: 'mcp__filesystem__read_file' }]);
    expect(ev.usage).toEqual({ input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0 });
    expect(ev.isSidechain).toBe(false);
    expect(ev.cwd).toBe('/work');
    expect(ev.gitBranch).toBe('main');
  });

  it('preserves non-mcp tool_use names (filtering happens in the normalizer)', () => {
    const line = assistantLine('s1', '2026-04-10T10:00:05.000Z', [{ id: 'u1', name: 'Bash' }]);
    const ev = parseLine(line);
    expect(ev?.kind).toBe('tool_use');
    if (ev?.kind === 'tool_use') {
      expect(ev.toolUses[0]?.name).toBe('Bash');
    }
  });

  it('captures multiple tool_use blocks from one line', () => {
    const line = assistantLine('s1', '2026-04-10T10:00:05.000Z', [
      { id: 'u1', name: 'mcp__foo__a' },
      { id: 'u2', name: 'mcp__foo__b' },
    ]);
    const ev = parseLine(line);
    expect(ev?.kind).toBe('tool_use');
    if (ev?.kind === 'tool_use') {
      expect(ev.toolUses).toHaveLength(2);
    }
  });

  it('skips tool_use blocks missing id or name', () => {
    const line = JSON.stringify({
      type: 'assistant',
      sessionId: 's1',
      timestamp: '2026-04-10T10:00:05.000Z',
      message: {
        content: [
          { type: 'tool_use', name: 'mcp__x__y' },
          { type: 'tool_use', id: 'ok', name: 'mcp__a__b' },
        ],
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
      },
    });
    const ev = parseLine(line);
    expect(ev?.kind).toBe('tool_use');
    if (ev?.kind === 'tool_use') {
      expect(ev.toolUses).toEqual([{ id: 'ok', name: 'mcp__a__b' }]);
    }
  });

  it('parses a user tool_result line and preserves null is_error', () => {
    const line = userToolResultLine('s1', '2026-04-10T10:00:06.000Z', [
      { toolUseId: 'u1', isError: null },
    ]);
    const ev = parseLine(line);
    expect(ev?.kind).toBe('tool_result');
    if (ev?.kind === 'tool_result') {
      expect(ev.results).toEqual([{ toolUseId: 'u1', isError: null }]);
    }
  });

  it('treats missing is_error as null', () => {
    const line = JSON.stringify({
      type: 'user',
      sessionId: 's1',
      timestamp: '2026-04-10T10:00:06.000Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'x' }],
      },
    });
    const ev = parseLine(line);
    expect(ev?.kind).toBe('tool_result');
    if (ev?.kind === 'tool_result') {
      expect(ev.results[0]?.isError).toBeNull();
    }
  });

  it('returns null when top-level JSON is an array, not an object', () => {
    expect(parseLine('[1, 2, 3]')).toBeNull();
    expect(parseLine('null')).toBeNull();
  });

  it('clamps non-finite usage tokens (NaN, Infinity) to 0', () => {
    const line = JSON.stringify({
      type: 'assistant',
      sessionId: 's1',
      timestamp: '2026-04-10T10:00:05.000Z',
      message: {
        content: [{ type: 'tool_use', id: 'u', name: 'mcp__x__y', input: {} }],
        usage: { input_tokens: 'nope', output_tokens: null, cache_read_input_tokens: undefined },
      },
    });
    const ev = parseLine(line);
    expect(ev?.kind).toBe('tool_use');
    if (ev?.kind === 'tool_use') {
      expect(ev.usage).toEqual({
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
      });
    }
  });

  it('returns null when timestamp is a malformed string', () => {
    const line = JSON.stringify({
      type: 'assistant',
      sessionId: 's1',
      timestamp: 'not-a-date',
      message: {
        content: [{ type: 'tool_use', id: 'u', name: 'mcp__x__y' }],
      },
    });
    expect(parseLine(line)).toBeNull();
  });

  it('returns null when user message.content is not an array (e.g. string)', () => {
    const line = JSON.stringify({
      type: 'user',
      sessionId: 's1',
      timestamp: '2026-04-10T10:00:00.000Z',
      message: { role: 'user', content: 'some string stdout' },
    });
    expect(parseLine(line)).toBeNull();
  });

  it('returns null for user messages with string content (not tool_result)', () => {
    const line = JSON.stringify({
      type: 'user',
      sessionId: 's1',
      timestamp: '2026-04-10T10:00:06.000Z',
      message: { role: 'user', content: '<local-command-stdout>...</local-command-stdout>' },
    });
    expect(parseLine(line)).toBeNull();
  });

  it('preserves isSidechain=true', () => {
    const line = assistantLine(
      's1',
      '2026-04-10T10:00:05.000Z',
      [{ id: 'u1', name: 'mcp__x__y' }],
      { isSidechain: true },
    );
    const ev = parseLine(line);
    expect(ev?.kind).toBe('tool_use');
    if (ev?.kind === 'tool_use') {
      expect(ev.isSidechain).toBe(true);
    }
  });
});

describe('pairEvents', () => {
  it('pairs a tool_use with its tool_result and computes duration', () => {
    const use = parseLine(
      assistantLine('s1', '2026-04-10T10:00:00.000Z', [{ id: 'u1', name: 'mcp__a__b' }]),
    );
    const result = parseLine(
      userToolResultLine('s1', '2026-04-10T10:00:00.500Z', [{ toolUseId: 'u1', isError: false }]),
    );
    if (!use || !result) throw new Error('unexpected null');
    const paired = pairEvents([use, result]);
    expect(paired).toHaveLength(1);
    expect(paired[0]?.toolUseId).toBe('u1');
    expect(paired[0]?.result?.isError).toBe(false);
    expect((paired[0]?.result?.tsMs ?? 0) - (paired[0]?.tsMs ?? 0)).toBe(500);
  });

  it('drops orphan tool_results silently', () => {
    const result = parseLine(
      userToolResultLine('s1', '2026-04-10T10:00:00.500Z', [
        { toolUseId: 'orphan', isError: false },
      ]),
    );
    if (!result) throw new Error('unexpected null');
    expect(pairEvents([result])).toEqual([]);
  });

  it('emits unpaired tool_uses with result: null at end of stream', () => {
    const use = parseLine(
      assistantLine('s1', '2026-04-10T10:00:00.000Z', [{ id: 'u-dangling', name: 'mcp__a__b' }]),
    );
    if (!use) throw new Error('unexpected null');
    const paired = pairEvents([use]);
    expect(paired).toHaveLength(1);
    expect(paired[0]?.result).toBeNull();
  });

  it('scopes pairing per sessionId (no cross-session matching)', () => {
    const useA = parseLine(
      assistantLine('s-A', '2026-04-10T10:00:00.000Z', [{ id: 'same-id', name: 'mcp__a__b' }]),
    );
    const resultB = parseLine(
      userToolResultLine('s-B', '2026-04-10T10:00:00.500Z', [
        { toolUseId: 'same-id', isError: false },
      ]),
    );
    if (!useA || !resultB) throw new Error('unexpected null');
    const paired = pairEvents([useA, resultB]);
    expect(paired).toHaveLength(1);
    expect(paired[0]?.sessionId).toBe('s-A');
    expect(paired[0]?.result).toBeNull();
  });

  it('only the first tool_use in a multi-block message carries usage tokens', () => {
    const use = parseLine(
      assistantLine('s1', '2026-04-10T10:00:00.000Z', [
        { id: 'u1', name: 'mcp__a__b' },
        { id: 'u2', name: 'mcp__a__c' },
      ]),
    );
    if (!use) throw new Error('unexpected null');
    const paired = pairEvents([use]);
    expect(paired).toHaveLength(2);
    const byId = new Map(paired.map((p) => [p.toolUseId, p]));
    expect(byId.get('u1')?.usage).not.toBeNull();
    expect(byId.get('u2')?.usage).toBeNull();
  });

  it('emits both calls when the same tool_use_id is reused within a session', () => {
    const use1 = parseLine(
      assistantLine('s1', '2026-04-10T10:00:00.000Z', [{ id: 'u-dup', name: 'mcp__a__first' }]),
    );
    const use2 = parseLine(
      assistantLine('s1', '2026-04-10T10:00:05.000Z', [{ id: 'u-dup', name: 'mcp__a__second' }]),
    );
    const result = parseLine(
      userToolResultLine('s1', '2026-04-10T10:00:05.500Z', [
        { toolUseId: 'u-dup', isError: false },
      ]),
    );
    if (!use1 || !use2 || !result) throw new Error('unexpected null');
    const paired = pairEvents([use1, use2, result]);
    expect(paired).toHaveLength(2);
    const byTool = new Map(paired.map((p) => [p.toolName, p]));
    // First was overwritten by second; must surface with result=null (not silently dropped).
    expect(byTool.get('mcp__a__first')?.result).toBeNull();
    // Second pairs with the incoming tool_result.
    expect(byTool.get('mcp__a__second')?.result?.isError).toBe(false);
  });

  it('pairs multiple tool_results in a single user message line', () => {
    const use = parseLine(
      assistantLine('s1', '2026-04-10T10:00:00.000Z', [
        { id: 'u1', name: 'mcp__a__one' },
        { id: 'u2', name: 'mcp__a__two' },
      ]),
    );
    const result = parseLine(
      userToolResultLine('s1', '2026-04-10T10:00:00.500Z', [
        { toolUseId: 'u1', isError: false },
        { toolUseId: 'u2', isError: true },
      ]),
    );
    if (!use || !result) throw new Error('unexpected null');
    const paired = pairEvents([use, result]);
    expect(paired).toHaveLength(2);
    const byId = new Map(paired.map((p) => [p.toolUseId, p]));
    expect(byId.get('u1')?.result?.isError).toBe(false);
    expect(byId.get('u2')?.result?.isError).toBe(true);
  });
});

describe('ClaudeCodeParser interface compliance', () => {
  it('declares client and version', () => {
    expect(ClaudeCodeParser.client).toBe('claude-code');
    expect(ClaudeCodeParser.version).toBe(1);
  });

  it('defaultLogPaths returns ~/.claude/projects on macOS/Linux', () => {
    if (process.platform === 'win32') return;
    const paths = claudeCodeDefaultLogPaths();
    expect(paths).toHaveLength(1);
    expect(paths[0]?.endsWith('.claude/projects')).toBe(true);
  });
});

describe('readJsonlLines + discoverSessionFiles', () => {
  it('yields each line from a JSONL file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcpi-p-'));
    try {
      const file = join(dir, 'a.jsonl');
      await writeFile(file, 'line1\nline2\nline3\n');
      const lines: string[] = [];
      for await (const line of readJsonlLines(file)) lines.push(line);
      expect(lines).toEqual(['line1', 'line2', 'line3']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('discovers nested *.jsonl files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mcpi-d-'));
    try {
      const nested = join(root, 'session-1', 'subagents');
      await writeFile(join(root, 'ignore-me.txt'), 'nope');
      await (await import('node:fs/promises')).mkdir(nested, { recursive: true });
      await writeFile(join(root, 'top.jsonl'), '{}');
      await writeFile(join(nested, 'agent-1.jsonl'), '{}');
      const found = await discoverSessionFiles(root);
      expect(found).toHaveLength(2);
      expect(found.some((p) => p.endsWith('top.jsonl'))).toBe(true);
      expect(found.some((p) => p.endsWith('agent-1.jsonl'))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns [] for a missing root directory', async () => {
    const result = await discoverSessionFiles('/nonexistent-path-for-mcpinsight-tests-123');
    expect(result).toEqual([]);
  });
});
