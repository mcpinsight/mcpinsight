import type { Client } from '@mcpinsight/core';
import { describe, expect, it } from 'vitest';

import { FIXED_NOW, call, setup } from '../_setup.js';

const REQUIRED_CLIENT_FIELDS = ['client', 'calls', 'servers', 'first_ts', 'last_ts'] as const;

describe('GET /api/clients', () => {
  it('returns ClientListRow[] with every documented field, ordered by calls DESC', async () => {
    const { app, close } = setup({
      seed: [
        call({ client: 'claude-code' as Client, server_name: 'filesystem', tool_name: 'a' }),
        call({ client: 'claude-code' as Client, server_name: 'filesystem', tool_name: 'b' }),
        call({ client: 'codex' as Client, server_name: 'github', tool_name: 'c' }),
      ],
    });
    try {
      const res = await app.request('http://test/api/clients');
      expect(res.status).toBe(200);
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      expect(Array.isArray(rows)).toBe(true);
      expect(rows[0]?.client).toBe('claude-code');
      expect(rows[1]?.client).toBe('codex');
      for (const row of rows) {
        for (const f of REQUIRED_CLIENT_FIELDS) {
          expect(row).toHaveProperty(f);
        }
      }
    } finally {
      close();
    }
  });

  it('INV-04: self-reference (mcpinsight) excluded', async () => {
    const { app, close } = setup({
      seed: [
        call({ server_name: 'filesystem', client: 'claude-code' as Client }),
        call({ server_name: 'mcpinsight', client: 'claude-code' as Client }),
      ],
    });
    try {
      const res = await app.request('http://test/api/clients');
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      const ccRow = rows.find((r) => r.client === 'claude-code') as
        | { calls: number; servers: number }
        | undefined;
      expect(ccRow?.calls).toBe(1);
      expect(ccRow?.servers).toBe(1);
    } finally {
      close();
    }
  });

  it('empty DB → []', async () => {
    const { app, close } = setup();
    try {
      const res = await app.request('http://test/api/clients');
      expect(await res.json()).toEqual([]);
    } finally {
      close();
    }
  });

  it('respects ?limit', async () => {
    const { app, close } = setup({
      seed: [
        call({ client: 'claude-code' as Client, server_name: 'a', tool_name: 'a' }),
        call({ client: 'codex' as Client, server_name: 'b', tool_name: 'b' }),
      ],
    });
    try {
      const res = await app.request('http://test/api/clients?limit=1');
      const rows = (await res.json()) as unknown[];
      expect(rows).toHaveLength(1);
    } finally {
      close();
    }
  });

  it('respects ?days window (default 30 days, broader than /api/servers)', async () => {
    const { app, close } = setup({
      seed: [call({ server_name: 'filesystem' })],
      nowMs: FIXED_NOW + 60 * 86_400_000,
    });
    try {
      const resDefault = await app.request('http://test/api/clients');
      const resTight = await app.request('http://test/api/clients?days=7');
      expect(await resDefault.json()).toEqual([]);
      expect(await resTight.json()).toEqual([]);
    } finally {
      close();
    }
  });

  it('rejects invalid ?days with 400', async () => {
    const { app, close } = setup();
    try {
      const res = await app.request('http://test/api/clients?days=foo');
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('bad_request');
    } finally {
      close();
    }
  });
});
