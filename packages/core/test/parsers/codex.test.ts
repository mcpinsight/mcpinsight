import { describe, expect, it } from 'vitest';

import {
  CODEX_UNKNOWN_SESSION_ID,
  CodexParser,
  pairEvents,
  parseLine,
} from '../../src/parsers/codex.js';
import { codexDefaultLogPaths } from '../../src/util/io.js';

function sessionMetaLine(
  id: string,
  tsIso: string,
  opts: { cwd?: string; branch?: string; cliVersion?: string } = {},
): string {
  return JSON.stringify({
    timestamp: tsIso,
    type: 'session_meta',
    payload: {
      id,
      timestamp: tsIso,
      cwd: opts.cwd ?? '/work',
      originator: 'codex_cli_rs',
      cli_version: opts.cliVersion ?? '0.88.0',
      source: 'cli',
      git: { branch: opts.branch ?? 'main' },
    },
  });
}

function beginLine(
  tsIso: string,
  callId: string,
  server: string,
  tool: string,
  args: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    timestamp: tsIso,
    type: 'event_msg',
    payload: {
      type: 'mcp_tool_call_begin',
      call_id: callId,
      invocation: { server, tool, arguments: args },
    },
  });
}

function endLine(
  tsIso: string,
  callId: string,
  result: unknown,
  opts: { server?: string; tool?: string } = {},
): string {
  return JSON.stringify({
    timestamp: tsIso,
    type: 'event_msg',
    payload: {
      type: 'mcp_tool_call_end',
      call_id: callId,
      invocation: { server: opts.server ?? 'x', tool: opts.tool ?? 'y', arguments: {} },
      duration: { secs: 0, nanos: 100_000_000 },
      result,
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

  it('returns null for top-level arrays or primitives', () => {
    expect(parseLine('[1, 2, 3]')).toBeNull();
    expect(parseLine('null')).toBeNull();
    expect(parseLine('"a string"')).toBeNull();
  });

  it('returns null for unknown RolloutItem types we do not consume', () => {
    const types = ['session_state', 'response_item', 'compacted', 'turn_context'];
    for (const t of types) {
      const line = JSON.stringify({
        timestamp: '2026-04-20T14:23:00.000Z',
        type: t,
        payload: { foo: 'bar' },
      });
      expect(parseLine(line)).toBeNull();
    }
  });

  it('returns null for event_msg payloads that are not mcp_tool_call_*', () => {
    const line = JSON.stringify({
      timestamp: '2026-04-20T14:23:00.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'hello' },
    });
    expect(parseLine(line)).toBeNull();
  });

  it('returns null when timestamp is missing or malformed', () => {
    expect(parseLine(JSON.stringify({ type: 'session_meta', payload: { id: 's1' } }))).toBeNull();
    expect(
      parseLine(
        JSON.stringify({
          timestamp: 'not-a-date',
          type: 'session_meta',
          payload: { id: 's1' },
        }),
      ),
    ).toBeNull();
  });

  it('parses a session_meta line and captures id, cwd, branch, cli_version', () => {
    const line = sessionMetaLine('sess-01', '2026-04-20T14:23:01.003Z', {
      cwd: '/repo',
      branch: 'feat/x',
      cliVersion: '0.88.0',
    });
    const ev = parseLine(line);
    expect(ev?.kind).toBe('session_meta');
    if (ev?.kind !== 'session_meta') throw new Error('expected session_meta');
    expect(ev.sessionId).toBe('sess-01');
    expect(ev.tsMs).toBe(Date.parse('2026-04-20T14:23:01.003Z'));
    expect(ev.cwd).toBe('/repo');
    expect(ev.gitBranch).toBe('feat/x');
    expect(ev.cliVersion).toBe('0.88.0');
  });

  it('returns null when session_meta payload lacks a string id', () => {
    const line = JSON.stringify({
      timestamp: '2026-04-20T14:23:01.003Z',
      type: 'session_meta',
      payload: { id: null },
    });
    expect(parseLine(line)).toBeNull();
  });

  it('parses mcp_tool_call_begin with server + tool from invocation', () => {
    const line = beginLine('2026-04-20T14:23:05.120Z', 'call_1', 'github', 'get_issue', {
      number: 42,
    });
    const ev = parseLine(line);
    expect(ev?.kind).toBe('tool_use');
    if (ev?.kind !== 'tool_use') throw new Error('expected tool_use');
    expect(ev.callId).toBe('call_1');
    expect(ev.server).toBe('github');
    expect(ev.tool).toBe('get_issue');
    expect(ev.tsMs).toBe(Date.parse('2026-04-20T14:23:05.120Z'));
  });

  it('drops mcp_tool_call_begin with missing/empty call_id', () => {
    expect(
      parseLine(
        JSON.stringify({
          timestamp: '2026-04-20T14:23:00.000Z',
          type: 'event_msg',
          payload: {
            type: 'mcp_tool_call_begin',
            call_id: '',
            invocation: { server: 'github', tool: 'get_issue' },
          },
        }),
      ),
    ).toBeNull();
    expect(
      parseLine(
        JSON.stringify({
          timestamp: '2026-04-20T14:23:00.000Z',
          type: 'event_msg',
          payload: { type: 'mcp_tool_call_begin', invocation: { server: 'x', tool: 'y' } },
        }),
      ),
    ).toBeNull();
  });

  it('drops mcp_tool_call_begin with empty server or tool', () => {
    expect(
      parseLine(
        JSON.stringify({
          timestamp: '2026-04-20T14:23:00.000Z',
          type: 'event_msg',
          payload: {
            type: 'mcp_tool_call_begin',
            call_id: 'c1',
            invocation: { server: '', tool: 'x' },
          },
        }),
      ),
    ).toBeNull();
    expect(
      parseLine(
        JSON.stringify({
          timestamp: '2026-04-20T14:23:00.000Z',
          type: 'event_msg',
          payload: {
            type: 'mcp_tool_call_begin',
            call_id: 'c1',
            invocation: { server: 'x', tool: '' },
          },
        }),
      ),
    ).toBeNull();
  });

  it('parses mcp_tool_call_end with result:{Ok,is_error:false} as not-error', () => {
    const line = endLine('2026-04-20T14:23:05.500Z', 'call_1', {
      Ok: { content: [], is_error: false },
    });
    const ev = parseLine(line);
    expect(ev?.kind).toBe('tool_result');
    if (ev?.kind !== 'tool_result') throw new Error('expected tool_result');
    expect(ev.callId).toBe('call_1');
    expect(ev.isError).toBe(false);
  });

  it('parses mcp_tool_call_end with result:{Ok,is_error:true} as app-level error', () => {
    const line = endLine('2026-04-20T14:23:05.500Z', 'call_1', {
      Ok: { content: [], is_error: true },
    });
    const ev = parseLine(line);
    expect(ev?.kind).toBe('tool_result');
    if (ev?.kind !== 'tool_result') throw new Error('expected tool_result');
    expect(ev.isError).toBe(true);
  });

  it('parses mcp_tool_call_end with result:{Err} as transport error', () => {
    const line = endLine('2026-04-20T14:23:05.500Z', 'call_1', { Err: 'rate_limit' });
    const ev = parseLine(line);
    expect(ev?.kind).toBe('tool_result');
    if (ev?.kind !== 'tool_result') throw new Error('expected tool_result');
    expect(ev.isError).toBe(true);
  });

  it('defaults is_error to false when Ok has no is_error field', () => {
    const line = endLine('2026-04-20T14:23:05.500Z', 'call_1', { Ok: { content: [] } });
    const ev = parseLine(line);
    expect(ev?.kind).toBe('tool_result');
    if (ev?.kind !== 'tool_result') throw new Error('expected tool_result');
    expect(ev.isError).toBe(false);
  });

  it('surfaces is_error as null when result is empty / unknown shape', () => {
    for (const bad of [{}, { Other: 'x' }, null, 'plain-string']) {
      const line = JSON.stringify({
        timestamp: '2026-04-20T14:23:05.500Z',
        type: 'event_msg',
        payload: {
          type: 'mcp_tool_call_end',
          call_id: 'call_1',
          invocation: { server: 'x', tool: 'y' },
          result: bad,
        },
      });
      const ev = parseLine(line);
      expect(ev?.kind).toBe('tool_result');
      if (ev?.kind === 'tool_result') expect(ev.isError).toBeNull();
    }
  });

  it('drops mcp_tool_call_end with missing call_id', () => {
    expect(
      parseLine(
        JSON.stringify({
          timestamp: '2026-04-20T14:23:05.500Z',
          type: 'event_msg',
          payload: { type: 'mcp_tool_call_end', result: {} },
        }),
      ),
    ).toBeNull();
  });
});

describe('pairEvents', () => {
  it('pairs a begin with its end and carries the current session id', () => {
    const meta = parseLine(sessionMetaLine('sess-1', '2026-04-20T14:23:00.000Z'));
    const begin = parseLine(beginLine('2026-04-20T14:23:05.000Z', 'c1', 'github', 'get_issue'));
    const end = parseLine(
      endLine('2026-04-20T14:23:05.500Z', 'c1', { Ok: { content: [], is_error: false } }),
    );
    if (!meta || !begin || !end) throw new Error('unexpected null');
    const paired = pairEvents([meta, begin, end]);
    expect(paired).toHaveLength(1);
    expect(paired[0]?.sessionId).toBe('sess-1');
    expect(paired[0]?.server).toBe('github');
    expect(paired[0]?.tool).toBe('get_issue');
    expect(paired[0]?.result?.isError).toBe(false);
    expect((paired[0]?.result?.tsMs ?? 0) - (paired[0]?.tsMs ?? 0)).toBe(500);
  });

  it('falls back to unknown session id when no session_meta precedes events', () => {
    const begin = parseLine(beginLine('2026-04-20T14:23:05.000Z', 'c1', 'github', 'get_issue'));
    const end = parseLine(endLine('2026-04-20T14:23:05.200Z', 'c1', { Ok: { is_error: false } }));
    if (!begin || !end) throw new Error('unexpected null');
    const paired = pairEvents([begin, end]);
    expect(paired).toHaveLength(1);
    expect(paired[0]?.sessionId).toBe(CODEX_UNKNOWN_SESSION_ID);
  });

  it('drops orphan tool_results (no matching begin)', () => {
    const orphan = parseLine(
      endLine('2026-04-20T14:23:05.500Z', 'orphan', { Ok: { is_error: false } }),
    );
    if (!orphan) throw new Error('unexpected null');
    expect(pairEvents([orphan])).toEqual([]);
  });

  it('emits unpaired begins with result:null at end of stream', () => {
    const meta = parseLine(sessionMetaLine('sess-1', '2026-04-20T14:23:00.000Z'));
    const begin = parseLine(beginLine('2026-04-20T14:23:05.000Z', 'c1', 'github', 'get_issue'));
    if (!meta || !begin) throw new Error('unexpected null');
    const paired = pairEvents([meta, begin]);
    expect(paired).toHaveLength(1);
    expect(paired[0]?.result).toBeNull();
  });

  it('surfaces the stale begin with result:null when a call_id is reused', () => {
    const meta = parseLine(sessionMetaLine('sess-1', '2026-04-20T14:23:00.000Z'));
    const begin1 = parseLine(beginLine('2026-04-20T14:23:05.000Z', 'dup', 'github', 'first'));
    const begin2 = parseLine(beginLine('2026-04-20T14:23:06.000Z', 'dup', 'github', 'second'));
    const end = parseLine(endLine('2026-04-20T14:23:06.400Z', 'dup', { Ok: { is_error: false } }));
    if (!meta || !begin1 || !begin2 || !end) throw new Error('unexpected null');
    const paired = pairEvents([meta, begin1, begin2, end]);
    expect(paired).toHaveLength(2);
    const byTool = new Map(paired.map((p) => [p.tool, p]));
    // First was overwritten by second; must surface with result=null (not silently dropped).
    expect(byTool.get('first')?.result).toBeNull();
    // Second pairs with the end.
    expect(byTool.get('second')?.result?.isError).toBe(false);
  });

  it('updates the session id when a second session_meta appears mid-file', () => {
    const meta1 = parseLine(sessionMetaLine('sess-A', '2026-04-20T14:23:00.000Z'));
    const a1 = parseLine(beginLine('2026-04-20T14:23:05.000Z', 'a1', 'x', 'a'));
    const endA1 = parseLine(endLine('2026-04-20T14:23:05.200Z', 'a1', { Ok: { is_error: false } }));
    const meta2 = parseLine(sessionMetaLine('sess-B', '2026-04-20T14:23:10.000Z'));
    const b1 = parseLine(beginLine('2026-04-20T14:23:15.000Z', 'b1', 'x', 'b'));
    const endB1 = parseLine(endLine('2026-04-20T14:23:15.400Z', 'b1', { Ok: { is_error: false } }));
    if (!meta1 || !a1 || !endA1 || !meta2 || !b1 || !endB1) throw new Error('unexpected null');
    const paired = pairEvents([meta1, a1, endA1, meta2, b1, endB1]);
    expect(paired).toHaveLength(2);
    const byCall = new Map(paired.map((p) => [p.callId, p]));
    expect(byCall.get('a1')?.sessionId).toBe('sess-A');
    expect(byCall.get('b1')?.sessionId).toBe('sess-B');
  });

  it('carries cwd and gitBranch from the most-recent session_meta', () => {
    const meta = parseLine(
      sessionMetaLine('sess-1', '2026-04-20T14:23:00.000Z', { cwd: '/r', branch: 'b' }),
    );
    const begin = parseLine(beginLine('2026-04-20T14:23:05.000Z', 'c1', 'x', 'y'));
    if (!meta || !begin) throw new Error('unexpected null');
    const [pairedEvent] = pairEvents([meta, begin]);
    expect(pairedEvent?.cwd).toBe('/r');
    expect(pairedEvent?.gitBranch).toBe('b');
  });
});

describe('CodexParser interface compliance', () => {
  it('declares client and version', () => {
    expect(CodexParser.client).toBe('codex');
    expect(CodexParser.version).toBe(1);
  });

  it('defaultLogPaths returns ~/.codex/sessions on macOS/Linux (no CODEX_HOME)', () => {
    if (process.platform === 'win32') return;
    const prior = process.env.CODEX_HOME;
    // biome-ignore lint/performance/noDelete: setting to undefined assigns the string "undefined"; delete actually unsets.
    delete process.env.CODEX_HOME;
    try {
      const paths = codexDefaultLogPaths();
      expect(paths).toHaveLength(1);
      expect(paths[0]?.endsWith('.codex/sessions')).toBe(true);
    } finally {
      if (prior !== undefined) process.env.CODEX_HOME = prior;
    }
  });

  it('honors the CODEX_HOME env var when set', () => {
    if (process.platform === 'win32') return;
    const prior = process.env.CODEX_HOME;
    process.env.CODEX_HOME = '/custom/codex';
    try {
      const paths = codexDefaultLogPaths();
      expect(paths).toEqual(['/custom/codex/sessions']);
    } finally {
      if (prior === undefined) {
        // biome-ignore lint/performance/noDelete: setting to undefined assigns the string "undefined"; delete actually unsets.
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = prior;
      }
    }
  });
});
