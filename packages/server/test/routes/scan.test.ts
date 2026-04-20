import { describe, expect, it } from 'vitest';

import { setup } from '../_setup.js';

describe('POST /api/scan (Day 19 stub)', () => {
  it('returns 501 with not_implemented envelope', async () => {
    const { app, close } = setup();
    try {
      const res = await app.request('http://test/api/scan', { method: 'POST' });
      expect(res.status).toBe(501);
      const body = (await res.json()) as { error: { code: string; hint: string } };
      expect(body.error.code).toBe('not_implemented');
      expect(body.error.hint).toContain('mcpinsight scan');
    } finally {
      close();
    }
  });

  it('GET /api/scan returns 404 (route accepts POST only)', async () => {
    const { app, close } = setup();
    try {
      const res = await app.request('http://test/api/scan');
      expect(res.status).toBe(404);
    } finally {
      close();
    }
  });
});
