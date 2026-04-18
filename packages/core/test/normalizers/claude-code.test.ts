import { describe, expect, it } from 'vitest';

import { ClaudeCodeNormalizer } from '../../src/normalizers/claude-code.js';
import type { ClaudeCodeRawEvent } from '../../src/parsers/claude-code.js';
import { asProjectIdentity } from '../../src/types/brands.js';
import type { NormalizeContext } from '../../src/types/canonical.js';

const ctx: NormalizeContext = {
  projectIdentity: asProjectIdentity('proj-test'),
  hasApiKey: false,
};

function rawEvent(overrides: Partial<ClaudeCodeRawEvent> = {}): ClaudeCodeRawEvent {
  return {
    sessionId: 'sess-1',
    toolUseId: 'toolu_1',
    toolName: 'mcp__filesystem__read_file',
    tsMs: 1_000_000,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 10 },
    isSidechain: false,
    cwd: '/work',
    gitBranch: 'main',
    result: { tsMs: 1_000_500, isError: false },
    ...overrides,
  };
}

describe('ClaudeCodeNormalizer', () => {
  it('declares the claude-code client and version 1', () => {
    expect(ClaudeCodeNormalizer.client).toBe('claude-code');
    expect(ClaudeCodeNormalizer.version).toBe(1);
  });

  it('extracts server and tool from an mcp__ name', () => {
    const call = ClaudeCodeNormalizer.normalize(rawEvent(), ctx);
    expect(call).not.toBeNull();
    expect(call?.server_name).toBe('filesystem');
    expect(call?.tool_name).toBe('read_file');
  });

  it('returns null for non-mcp tool names (Bash, Read, Edit, Agent)', () => {
    for (const name of ['Bash', 'Read', 'Edit', 'Agent']) {
      expect(ClaudeCodeNormalizer.normalize(rawEvent({ toolName: name }), ctx)).toBeNull();
    }
  });

  it('passes through session_id and project_identity', () => {
    const call = ClaudeCodeNormalizer.normalize(rawEvent({ sessionId: 'my-sess' }), ctx);
    expect(call?.session_id).toBe('my-sess');
    expect(call?.project_identity).toBe('proj-test');
  });

  it('copies usage tokens when present', () => {
    const call = ClaudeCodeNormalizer.normalize(rawEvent(), ctx);
    expect(call?.input_tokens).toBe(100);
    expect(call?.output_tokens).toBe(20);
    expect(call?.cache_read_tokens).toBe(10);
  });

  it('defaults tokens to 0 when usage is null (non-first tool_use in a multi-block message)', () => {
    const call = ClaudeCodeNormalizer.normalize(rawEvent({ usage: null }), ctx);
    expect(call?.input_tokens).toBe(0);
    expect(call?.output_tokens).toBe(0);
    expect(call?.cache_read_tokens).toBe(0);
  });

  it('MVP: cost_usd=0 and cost_is_estimated=1 always (INV-02)', () => {
    const call = ClaudeCodeNormalizer.normalize(rawEvent(), ctx);
    expect(call?.cost_usd).toBe(0);
    expect(call?.cost_is_estimated).toBe(1);
  });

  it('propagates is_error=false from a successful result', () => {
    const call = ClaudeCodeNormalizer.normalize(rawEvent(), ctx);
    expect(call?.is_error).toBe(false);
  });

  it('propagates is_error=true from a failing result', () => {
    const call = ClaudeCodeNormalizer.normalize(
      rawEvent({ result: { tsMs: 1_000_500, isError: true } }),
      ctx,
    );
    expect(call?.is_error).toBe(true);
  });

  it('returns is_error=null when the paired result itself has is_error=null (compacted)', () => {
    const call = ClaudeCodeNormalizer.normalize(
      rawEvent({ result: { tsMs: 1_000_500, isError: null } }),
      ctx,
    );
    expect(call?.is_error).toBeNull();
  });

  it('returns is_error=null and duration_ms=null when result is absent (unpaired tool_use)', () => {
    const call = ClaudeCodeNormalizer.normalize(rawEvent({ result: null }), ctx);
    expect(call?.is_error).toBeNull();
    expect(call?.duration_ms).toBeNull();
  });

  it('computes duration_ms as result.tsMs - raw.tsMs', () => {
    const call = ClaudeCodeNormalizer.normalize(
      rawEvent({ tsMs: 1_000_000, result: { tsMs: 1_002_345, isError: false } }),
      ctx,
    );
    expect(call?.duration_ms).toBe(2_345);
  });
});
