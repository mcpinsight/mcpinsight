import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setup } from '../_setup.js';

/**
 * Exercises `createApp(deps, {webDistDir})` + the SPA middleware end-to-end
 * via `app.request(...)`. No live HTTP — same pattern as the route tests.
 *
 * Each test builds a tiny dist with a sentinel HTML + asset, then verifies
 * routing, SPA fallback, traversal safety, and API-path non-interception.
 */

let distDir: string;

beforeEach(() => {
  distDir = mkdtempSync(join(tmpdir(), 'mcpinsight-web-dist-'));
  mkdirSync(join(distDir, 'assets'), { recursive: true });
  writeFileSync(join(distDir, 'index.html'), '<!DOCTYPE html><html><body>INDEX</body></html>');
  writeFileSync(join(distDir, 'assets', 'app.js'), 'console.log("hello");');
  writeFileSync(join(distDir, 'favicon.ico'), 'ICO-BYTES');
});

afterEach(() => {
  rmSync(distDir, { recursive: true, force: true });
});

describe('static SPA middleware', () => {
  it('serves index.html at /', async () => {
    const { app, close } = setup({ appOptions: { webDistDir: distDir } });
    try {
      const res = await app.request('http://test/');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(await res.text()).toContain('INDEX');
    } finally {
      close();
    }
  });

  it('serves an asset file verbatim with long cache', async () => {
    const { app, close } = setup({ appOptions: { webDistDir: distDir } });
    try {
      const res = await app.request('http://test/assets/app.js');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('javascript');
      expect(res.headers.get('cache-control')).toContain('max-age=31536000');
      expect(await res.text()).toContain('hello');
    } finally {
      close();
    }
  });

  it('falls back to index.html for an unknown SPA route (/servers/filesystem)', async () => {
    const { app, close } = setup({ appOptions: { webDistDir: distDir } });
    try {
      const res = await app.request('http://test/servers/filesystem');
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('INDEX');
    } finally {
      close();
    }
  });

  it('does NOT intercept /api/* — 404 still returns the JSON envelope', async () => {
    const { app, close } = setup({ appOptions: { webDistDir: distDir } });
    try {
      const res = await app.request('http://test/api/does-not-exist');
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string; hint?: string } };
      expect(body.error.code).toBe('not_found');
      expect(body.error.hint).toContain('docs/api-contract.md');
    } finally {
      close();
    }
  });

  it('still returns real API data when dashboard is bundled', async () => {
    const { app, close } = setup({ appOptions: { webDistDir: distDir } });
    try {
      const res = await app.request('http://test/api/health');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);
    } finally {
      close();
    }
  });

  it('rejects URL-encoded path traversal that survives URL normalization', async () => {
    const { app, close } = setup({ appOptions: { webDistDir: distDir } });
    try {
      // %2e%2e decodes to `..`. The URL parser does NOT normalize these away —
      // the raw decoded path reaches the middleware and the startsWith(root)
      // guard is what stops it. With a `.js` extension set so the middleware
      // takes the asset branch (not the SPA fallback).
      const res = await app.request('http://test/%2e%2e/%2e%2e/etc/passwd.js');
      expect(res.status).toBe(404);
    } finally {
      close();
    }
  });

  it('returns 404 for a missing asset (e.g. typo in /assets/*)', async () => {
    const { app, close } = setup({ appOptions: { webDistDir: distDir } });
    try {
      const res = await app.request('http://test/assets/missing.js');
      expect(res.status).toBe(404);
    } finally {
      close();
    }
  });

  it('is inert when webDistDir is not set — SPA routes 404 with envelope', async () => {
    const { app, close } = setup();
    try {
      const res = await app.request('http://test/');
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('not_found');
    } finally {
      close();
    }
  });
});
