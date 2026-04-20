import type { Client } from '@mcpinsight/core';
import { describe, expect, it } from 'vitest';

import { FIXED_NOW, call, setup } from '../_setup.js';

const DAY_MS = 86_400_000;

interface HealthBody {
  server_name: string;
  score: number | null;
  components: Record<string, number> | null;
  is_essential: boolean;
  insufficient_data_reason?: 'too_recent' | 'too_few_calls';
}

function manyCalls(count: number, overrides: Parameters<typeof call>[0] = {}) {
  return Array.from({ length: count }, (_, i) =>
    call({ ...overrides, ts: (overrides.ts ?? FIXED_NOW - 5 * DAY_MS) + i * 1000 }),
  );
}

describe('GET /api/health/:name — live handler', () => {
  it('liveness GET /api/health is unaffected by the :name tree', async () => {
    const { app, close } = setup();
    try {
      const res = await app.request('http://test/api/health');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);
    } finally {
      close();
    }
  });

  it('returns 404 when the named server has no calls in history', async () => {
    const { app, close } = setup({ seed: [call({ server_name: 'filesystem' })] });
    try {
      const res = await app.request('http://test/api/health/no-such-server');
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('not_found');
      expect(body.error.message).toContain('no-such-server');
    } finally {
      close();
    }
  });

  it('returns 200 with insufficient_data_reason when history is too short', async () => {
    const { app, close } = setup({
      seed: [call({ server_name: 'filesystem', ts: FIXED_NOW - 2 * DAY_MS })],
    });
    try {
      const res = await app.request('http://test/api/health/filesystem');
      expect(res.status).toBe(200);
      const body = (await res.json()) as HealthBody;
      expect(body.server_name).toBe('filesystem');
      expect(body.score).toBeNull();
      expect(body.components).toBeNull();
      expect(body.insufficient_data_reason).toBe('too_recent');
      expect(body.is_essential).toBe(true);
    } finally {
      close();
    }
  });

  it('returns 200 with insufficient_data_reason too_few_calls when calls < 50 but history ≥ 14d', async () => {
    const base = FIXED_NOW - 20 * DAY_MS;
    const seed = [
      call({ server_name: 'filesystem', ts: base }),
      call({ server_name: 'filesystem', ts: base + 1000 }),
      call({ server_name: 'filesystem', ts: base + 2000 }),
    ];
    const { app, close } = setup({ seed });
    try {
      const res = await app.request('http://test/api/health/filesystem');
      expect(res.status).toBe(200);
      const body = (await res.json()) as HealthBody;
      expect(body.score).toBeNull();
      expect(body.insufficient_data_reason).toBe('too_few_calls');
    } finally {
      close();
    }
  });

  it('returns 200 with numeric score when enough user-level data exists', async () => {
    // 60 calls across 20 days — both user-level thresholds pass.
    const base = FIXED_NOW - 20 * DAY_MS;
    const seed = Array.from({ length: 60 }, (_, i) =>
      call({
        server_name: 'filesystem',
        tool_name: `read_file_${i % 4}`, // 4 distinct tools
        ts: base + i * (DAY_MS / 3), // spread over ~20 days
        is_error: i % 30 === 0, // ~3% error rate
      }),
    );
    const { app, close } = setup({ seed });
    try {
      const res = await app.request('http://test/api/health/filesystem');
      expect(res.status).toBe(200);
      const body = (await res.json()) as HealthBody;
      expect(body.server_name).toBe('filesystem');
      expect(typeof body.score).toBe('number');
      const score = body.score ?? -1;
      expect(score >= 0 && score <= 100).toBe(true);
      expect(body.components).not.toBeNull();
      expect(body.components).toHaveProperty('activation');
      expect(body.components).toHaveProperty('successRate');
      expect(body.components).toHaveProperty('toolUtil');
      expect(body.components).toHaveProperty('clarity');
      expect(body.components).toHaveProperty('tokenEff');
      expect(body.is_essential).toBe(true);
    } finally {
      close();
    }
  });

  it('returns score 0 for zombie (≥14d history + ≥50 calls, but 0 in window)', async () => {
    // 60 historical calls, all older than the 30d window.
    const base = FIXED_NOW - 90 * DAY_MS;
    const seed = manyCalls(60, { server_name: 'filesystem', ts: base });
    const { app, close } = setup({ seed });
    try {
      const res = await app.request('http://test/api/health/filesystem');
      expect(res.status).toBe(200);
      const body = (await res.json()) as HealthBody;
      expect(body.score).toBe(0);
      expect(body.components).not.toBeNull();
    } finally {
      close();
    }
  });

  it('decodes URL-encoded server names', async () => {
    const base = FIXED_NOW - 20 * DAY_MS;
    const seed = Array.from({ length: 55 }, (_, i) =>
      call({ server_name: 'slack mcp', tool_name: 'send', ts: base + i * 1000 }),
    );
    const { app, close } = setup({ seed });
    try {
      const res = await app.request('http://test/api/health/slack%20mcp');
      expect(res.status).toBe(200);
      const body = (await res.json()) as HealthBody;
      expect(body.server_name).toBe('slack mcp');
    } finally {
      close();
    }
  });

  it('respects the client filter on the existence check', async () => {
    const base = FIXED_NOW - 20 * DAY_MS;
    const seed = Array.from({ length: 55 }, (_, i) =>
      call({ client: 'claude-code' as Client, ts: base + i * 1000 }),
    );
    const { app, close } = setup({ seed });
    try {
      const codexRes = await app.request('http://test/api/health/filesystem?client=codex');
      expect(codexRes.status).toBe(404);
      const claudeRes = await app.request('http://test/api/health/filesystem?client=claude-code');
      expect(claudeRes.status).toBe(200);
    } finally {
      close();
    }
  });

  it('rejects an invalid ?client with 400', async () => {
    const { app, close } = setup();
    try {
      const res = await app.request('http://test/api/health/filesystem?client=chrome');
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('bad_request');
    } finally {
      close();
    }
  });

  it('INV-04: self-reference server is 404, not a score', async () => {
    const { app, close } = setup({
      seed: [call({ server_name: 'mcpinsight', tool_name: 'overview' })],
    });
    try {
      const res = await app.request('http://test/api/health/mcpinsight');
      expect(res.status).toBe(404);
    } finally {
      close();
    }
  });
});
