import { describe, expect, it } from 'vitest';

import { setup } from '../_setup.js';

describe('GET /api/health (liveness)', () => {
  it('returns 200 with {ok, version} and does not require any DB rows', async () => {
    const { app, close } = setup();
    try {
      const res = await app.request('http://test/api/health');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.ok).toBe(true);
      expect(typeof body.version).toBe('string');
      expect((body.version as string).length).toBeGreaterThan(0);
      // license_tier is intentionally NOT in v0.1; Week 4 adds it additively.
      expect(body).not.toHaveProperty('license_tier');
    } finally {
      close();
    }
  });

  it('content-type is JSON', async () => {
    const { app, close } = setup();
    try {
      const res = await app.request('http://test/api/health');
      expect(res.headers.get('content-type') ?? '').toContain('application/json');
    } finally {
      close();
    }
  });
});
