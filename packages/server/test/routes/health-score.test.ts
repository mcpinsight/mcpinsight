import { describe, expect, it } from 'vitest';

import { setup } from '../_setup.js';

describe('GET /api/health/:name (Day 19 stub)', () => {
  it('returns 501 with not_implemented envelope', async () => {
    const { app, close } = setup();
    try {
      const res = await app.request('http://test/api/health/filesystem');
      expect(res.status).toBe(501);
      const body = (await res.json()) as { error: { code: string; message: string; hint: string } };
      expect(body.error.code).toBe('not_implemented');
      expect(body.error.message).toContain('Day 21');
      expect(body.error.hint).toContain('phase-multi-client-ui');
    } finally {
      close();
    }
  });

  it('liveness GET /api/health is unaffected by the :name stub', async () => {
    const { app, close } = setup();
    try {
      const res = await app.request('http://test/api/health');
      expect(res.status).toBe(200);
    } finally {
      close();
    }
  });
});
