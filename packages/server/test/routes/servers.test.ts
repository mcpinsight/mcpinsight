import type { Client } from '@mcpinsight/core';
import { describe, expect, it } from 'vitest';

import { FIXED_NOW, call, setup } from '../_setup.js';

const REQUIRED_TOP_FIELDS = [
  'server_name',
  'calls',
  'errors',
  'unique_tools',
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cost_usd_real',
  'cost_usd_est',
] as const;

describe('GET /api/servers', () => {
  it('returns TopServerRow[] with every documented field, ordered by calls DESC', async () => {
    const { app, close } = setup({
      seed: [
        call({ server_name: 'filesystem', tool_name: 'read_file' }),
        call({ server_name: 'filesystem', tool_name: 'write_file' }),
        call({ server_name: 'github', tool_name: 'search', is_error: true }),
        // INV-04: must not appear.
        call({ server_name: 'mcpinsight', tool_name: 'overview' }),
      ],
    });
    try {
      const res = await app.request('http://test/api/servers');
      expect(res.status).toBe(200);
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.some((r) => r.server_name === 'mcpinsight')).toBe(false);
      expect(rows[0]?.server_name).toBe('filesystem');
      expect(rows[1]?.server_name).toBe('github');
      for (const row of rows) {
        for (const f of REQUIRED_TOP_FIELDS) {
          expect(row).toHaveProperty(f);
        }
      }
    } finally {
      close();
    }
  });

  it('empty DB → []', async () => {
    const { app, close } = setup();
    try {
      const res = await app.request('http://test/api/servers');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    } finally {
      close();
    }
  });

  it('respects ?days — old calls fall outside the window', async () => {
    const { app, close } = setup({
      seed: [call({ server_name: 'filesystem' })],
      nowMs: FIXED_NOW + 10 * 86_400_000,
    });
    try {
      const resWide = await app.request('http://test/api/servers?days=30');
      const resTight = await app.request('http://test/api/servers?days=1');
      expect(((await resWide.json()) as unknown[]).length).toBe(1);
      expect(await resTight.json()).toEqual([]);
    } finally {
      close();
    }
  });

  it('respects ?limit', async () => {
    const { app, close } = setup({
      seed: [
        call({ server_name: 'filesystem', tool_name: 'a' }),
        call({ server_name: 'filesystem', tool_name: 'b' }),
        call({ server_name: 'github', tool_name: 'c' }),
      ],
    });
    try {
      const res = await app.request('http://test/api/servers?limit=1');
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.server_name).toBe('filesystem');
    } finally {
      close();
    }
  });

  it('respects ?client filter', async () => {
    const { app, close } = setup({
      seed: [
        call({ server_name: 'filesystem', client: 'claude-code' as Client }),
        call({ server_name: 'github', client: 'codex' as Client }),
      ],
    });
    try {
      const res = await app.request('http://test/api/servers?client=codex');
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.server_name).toBe('github');
    } finally {
      close();
    }
  });

  it('rejects invalid ?client with 400 + bad_request envelope', async () => {
    const { app, close } = setup();
    try {
      const res = await app.request('http://test/api/servers?client=chrome');
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; message: string; hint?: string };
      };
      expect(body.error.code).toBe('bad_request');
      expect(body.error.message).toContain('chrome');
      expect(body.error.hint).toContain('claude-code');
    } finally {
      close();
    }
  });

  it('rejects invalid ?days with 400', async () => {
    const { app, close } = setup();
    try {
      const res = await app.request('http://test/api/servers?days=foo');
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('bad_request');
      expect(body.error.message).toContain('days');
    } finally {
      close();
    }
  });

  it('rejects ?days=0 with 400 (positive integer)', async () => {
    const { app, close } = setup();
    try {
      const res = await app.request('http://test/api/servers?days=0');
      expect(res.status).toBe(400);
    } finally {
      close();
    }
  });

  it('rejects negative ?limit with 400', async () => {
    const { app, close } = setup();
    try {
      const res = await app.request('http://test/api/servers?limit=-5');
      expect(res.status).toBe(400);
    } finally {
      close();
    }
  });
});

describe('GET /api/servers/:name', () => {
  it('returns {server_name, summary, timeseries, tools} on a hit', async () => {
    const { app, close } = setup({
      seed: [
        call({ server_name: 'filesystem', tool_name: 'read_file' }),
        call({ server_name: 'filesystem', tool_name: 'write_file' }),
      ],
    });
    try {
      const res = await app.request('http://test/api/servers/filesystem');
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        server_name: string;
        summary: Record<string, unknown>;
        timeseries: Array<Record<string, unknown>>;
        tools: string[];
      };
      expect(body.server_name).toBe('filesystem');
      for (const f of REQUIRED_TOP_FIELDS) {
        expect(body.summary).toHaveProperty(f);
      }
      expect(body.summary.calls).toBe(2);
      expect(body.tools).toEqual(['read_file', 'write_file']);
      expect(body.timeseries.length).toBeGreaterThanOrEqual(1);
      expect(body.timeseries[0]).toHaveProperty('day');
      expect(body.timeseries[0]).toHaveProperty('calls');
      expect(body.timeseries[0]).toHaveProperty('errors');
      expect(body.timeseries[0]).toHaveProperty('input_tokens');
      expect(body.timeseries[0]).toHaveProperty('output_tokens');
    } finally {
      close();
    }
  });

  it('decodes URL-encoded names', async () => {
    const { app, close } = setup({
      seed: [call({ server_name: 'slack mcp', tool_name: 'send' })],
    });
    try {
      const res = await app.request('http://test/api/servers/slack%20mcp');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { server_name: string };
      expect(body.server_name).toBe('slack mcp');
    } finally {
      close();
    }
  });

  it('returns 404 with not_found envelope when no matching calls in window', async () => {
    const { app, close } = setup({ seed: [call({ server_name: 'filesystem' })] });
    try {
      const res = await app.request('http://test/api/servers/no-such-server');
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('not_found');
      expect(body.error.message).toContain('no-such-server');
    } finally {
      close();
    }
  });

  it('returns 404 when a server has data but only outside the window', async () => {
    const { app, close } = setup({
      seed: [call({ server_name: 'filesystem' })],
      nowMs: FIXED_NOW + 30 * 86_400_000,
    });
    try {
      const res = await app.request('http://test/api/servers/filesystem?days=1');
      expect(res.status).toBe(404);
    } finally {
      close();
    }
  });

  it('rejects invalid ?days with 400 even before the lookup', async () => {
    const { app, close } = setup();
    try {
      const res = await app.request('http://test/api/servers/filesystem?days=bad');
      expect(res.status).toBe(400);
    } finally {
      close();
    }
  });
});
