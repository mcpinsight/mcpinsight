import { describe, expect, it } from 'vitest';

import { setup } from './_setup.js';

describe('createApp not-found handling', () => {
  it('unknown route → 404 with not_found envelope (uniform error shape)', async () => {
    const { app, close } = setup();
    try {
      const res = await app.request('http://test/api/does-not-exist');
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string; message: string; hint: string } };
      expect(body.error.code).toBe('not_found');
      expect(body.error.hint).toContain('docs/api-contract.md');
    } finally {
      close();
    }
  });

  it('root / also 404 (no UI routes mounted at the API server)', async () => {
    const { app, close } = setup();
    try {
      const res = await app.request('http://test/');
      expect(res.status).toBe(404);
    } finally {
      close();
    }
  });
});
