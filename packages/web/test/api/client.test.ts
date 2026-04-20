import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TopServerRow } from '@mcpinsight/core';

import { ApiError, api } from '@/api/client';

/**
 * Contract-level tests for the typed fetch wrapper. Verify it hits the
 * documented `/api/servers?days=7` shape, parses the response, and maps
 * error envelopes (incl. the 501 placeholder contract) to structured
 * `ApiError`s without regressing the `isPlaceholder` heuristic.
 */

function row(over: Partial<TopServerRow> = {}): TopServerRow {
  return {
    server_name: 'filesystem',
    calls: 12,
    errors: 0,
    unique_tools: 3,
    input_tokens: 100,
    output_tokens: 200,
    cache_read_tokens: 0,
    cost_usd_real: 0,
    cost_usd_est: 0,
    ...over,
  };
}

// biome-ignore lint/suspicious/noExplicitAny: vi.spyOn's return shape varies by version; a narrow type buys nothing here.
let fetchSpy: any;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('api.servers', () => {
  it('GETs /api/servers?days=7 and returns TopServerRow[]', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify([row()]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const rows = await api.servers({ days: 7 });
    expect(rows).toEqual([row()]);
    const [url] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toContain('/api/servers');
    expect(String(url)).toContain('days=7');
  });

  it('omits client param when "all" is selected', async () => {
    fetchSpy.mockResolvedValue(new Response('[]', { status: 200 }));
    await api.servers({ client: 'all', days: 7 });
    const [url] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).not.toContain('client=');
  });

  it('forwards a concrete client id as ?client=', async () => {
    fetchSpy.mockResolvedValue(new Response('[]', { status: 200 }));
    await api.servers({ client: 'codex', days: 7 });
    const [url] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toContain('client=codex');
  });

  it('maps an error envelope to ApiError with code + hint', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'bad_request', message: 'invalid client', hint: 'try again' },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(api.servers({ client: 'codex' })).rejects.toMatchObject({
      status: 400,
      code: 'bad_request',
      hint: 'try again',
    });
  });

  it('treats 501 as a placeholder, not a generic error', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'not_implemented', message: 'ships later' } }), {
        status: 501,
        headers: { 'content-type': 'application/json' },
      }),
    );
    try {
      await api.server('filesystem');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(501);
      expect(apiErr.isPlaceholder).toBe(true);
    }
  });

  it('synthesizes an envelope when the server returns a non-JSON error body', async () => {
    fetchSpy.mockResolvedValue(
      new Response('<html>nope</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
    );
    await expect(api.clients()).rejects.toMatchObject({
      status: 502,
      code: 'http_502',
    });
  });
});

describe('api.server', () => {
  it('URL-encodes the name path segment', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ server_name: 'slack mcp', summary: row(), timeseries: [] }), {
        status: 200,
      }),
    );
    await api.server('slack mcp');
    const [url] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toContain('/api/servers/slack%20mcp');
  });
});
