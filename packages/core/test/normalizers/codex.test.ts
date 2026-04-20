import { describe, expect, it } from 'vitest';

import { CodexNormalizer } from '../../src/normalizers/codex.js';
import type { CodexRawEvent } from '../../src/parsers/codex.js';
import { asProjectIdentity } from '../../src/types/brands.js';
import type { NormalizeContext } from '../../src/types/canonical.js';

const ctx: NormalizeContext = {
  projectIdentity: asProjectIdentity('proj-test'),
  hasApiKey: false,
};

function rawEvent(overrides: Partial<CodexRawEvent> = {}): CodexRawEvent {
  return {
    sessionId: 'sess-1',
    callId: 'call_1',
    server: 'github',
    tool: 'get_issue',
    tsMs: 1_000_000,
    cwd: '/work',
    gitBranch: 'main',
    result: { tsMs: 1_000_500, isError: false },
    ...overrides,
  };
}

describe('CodexNormalizer', () => {
  it('declares the codex client and version 1', () => {
    expect(CodexNormalizer.client).toBe('codex');
    expect(CodexNormalizer.version).toBe(1);
  });

  it('passes server and tool through without parseMcpToolName', () => {
    // Codex delivers these already split via McpInvocation — no flat-name stripping needed.
    const call = CodexNormalizer.normalize(
      rawEvent({ server: 'filesystem', tool: 'read_file' }),
      ctx,
    );
    expect(call).not.toBeNull();
    expect(call?.server_name).toBe('filesystem');
    expect(call?.tool_name).toBe('read_file');
  });

  it('preserves underscores in tool and server names verbatim', () => {
    const call = CodexNormalizer.normalize(
      rawEvent({ server: 'claude_ai_Google_Drive', tool: 'read_file_content' }),
      ctx,
    );
    expect(call?.server_name).toBe('claude_ai_Google_Drive');
    expect(call?.tool_name).toBe('read_file_content');
  });

  it('returns null defensively when server or tool is empty', () => {
    expect(CodexNormalizer.normalize(rawEvent({ server: '' }), ctx)).toBeNull();
    expect(CodexNormalizer.normalize(rawEvent({ tool: '' }), ctx)).toBeNull();
  });

  it('passes through session_id and project_identity', () => {
    const call = CodexNormalizer.normalize(rawEvent({ sessionId: 'my-sess' }), ctx);
    expect(call?.session_id).toBe('my-sess');
    expect(call?.project_identity).toBe('proj-test');
  });

  it('stamps client as codex', () => {
    const call = CodexNormalizer.normalize(rawEvent(), ctx);
    expect(call?.client).toBe('codex');
  });

  it('zeroes all token fields for MVP (Codex does not report per-call tokens)', () => {
    const call = CodexNormalizer.normalize(rawEvent(), ctx);
    expect(call?.input_tokens).toBe(0);
    expect(call?.output_tokens).toBe(0);
    expect(call?.cache_read_tokens).toBe(0);
  });

  it('MVP: cost_usd=0 and cost_is_estimated=1 always (INV-02)', () => {
    const call = CodexNormalizer.normalize(rawEvent(), ctx);
    expect(call?.cost_usd).toBe(0);
    expect(call?.cost_is_estimated).toBe(1);
  });

  it('propagates is_error=false from a successful result', () => {
    const call = CodexNormalizer.normalize(rawEvent(), ctx);
    expect(call?.is_error).toBe(false);
  });

  it('propagates is_error=true from a failing result', () => {
    const call = CodexNormalizer.normalize(
      rawEvent({ result: { tsMs: 1_000_500, isError: true } }),
      ctx,
    );
    expect(call?.is_error).toBe(true);
  });

  it('returns is_error=null when the paired result has is_error=null (unknown shape)', () => {
    const call = CodexNormalizer.normalize(
      rawEvent({ result: { tsMs: 1_000_500, isError: null } }),
      ctx,
    );
    expect(call?.is_error).toBeNull();
  });

  it('returns is_error=null and duration_ms=null when result is absent (unpaired begin)', () => {
    const call = CodexNormalizer.normalize(rawEvent({ result: null }), ctx);
    expect(call?.is_error).toBeNull();
    expect(call?.duration_ms).toBeNull();
  });

  it('computes duration_ms as result.tsMs - raw.tsMs', () => {
    const call = CodexNormalizer.normalize(
      rawEvent({ tsMs: 1_000_000, result: { tsMs: 1_002_345, isError: false } }),
      ctx,
    );
    expect(call?.duration_ms).toBe(2_345);
  });

  it('accepts the unknown session id sentinel unchanged', () => {
    const call = CodexNormalizer.normalize(rawEvent({ sessionId: 'unknown' }), ctx);
    expect(call?.session_id).toBe('unknown');
  });
});
