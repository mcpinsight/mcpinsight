import {
  BadRequestError,
  NotFoundError,
  NotImplementedError,
  UserFacingError,
  silentLogger,
} from '@mcpinsight/core';
import type { Logger } from '@mcpinsight/core';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createErrorHandler } from '../../src/middleware/error.js';

class CapturingLogger implements Logger {
  public readonly entries: Array<{
    level: string;
    msg: string;
    meta?: Record<string, unknown>;
  }> = [];

  debug(msg: string, meta?: Record<string, unknown>): void {
    this.push('debug', msg, meta);
  }
  info(msg: string, meta?: Record<string, unknown>): void {
    this.push('info', msg, meta);
  }
  warn(msg: string, meta?: Record<string, unknown>): void {
    this.push('warn', msg, meta);
  }
  error(msg: string, meta?: Record<string, unknown>): void {
    this.push('error', msg, meta);
  }
  private push(level: string, msg: string, meta?: Record<string, unknown>): void {
    this.entries.push(meta !== undefined ? { level, msg, meta } : { level, msg });
  }
}

function buildApp(throwable: () => never, logger: Logger = silentLogger): Hono {
  const app = new Hono();
  app.onError(createErrorHandler(logger));
  app.get('/boom', () => {
    throwable();
  });
  return app;
}

describe('errorMiddleware', () => {
  it('translates UserFacingError → status + {error: {code, message, hint}} envelope', async () => {
    const app = buildApp(() => {
      throw new UserFacingError('teapot', 'short and stout', { status: 418, hint: 'tip' });
    });
    const res = await app.request('http://test/boom');
    expect(res.status).toBe(418);
    expect(res.headers.get('content-type') ?? '').toContain('application/json');
    const body = (await res.json()) as { error: { code: string; message: string; hint: string } };
    expect(body.error.code).toBe('teapot');
    expect(body.error.message).toBe('short and stout');
    expect(body.error.hint).toBe('tip');
  });

  it('omits hint from the JSON when not supplied', async () => {
    const app = buildApp(() => {
      throw new UserFacingError('foo', 'bar');
    });
    const res = await app.request('http://test/boom');
    const body = (await res.json()) as { error: Record<string, unknown> };
    expect(body.error).not.toHaveProperty('hint');
  });

  it('handles BadRequestError → 400 + bad_request', async () => {
    const app = buildApp(() => {
      throw new BadRequestError('invalid x', 'fix it');
    });
    const res = await app.request('http://test/boom');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('bad_request');
  });

  it('handles NotFoundError → 404 + not_found', async () => {
    const app = buildApp(() => {
      throw new NotFoundError('gone');
    });
    const res = await app.request('http://test/boom');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });

  it('handles NotImplementedError → 501 + not_implemented', async () => {
    const app = buildApp(() => {
      throw new NotImplementedError('soon');
    });
    const res = await app.request('http://test/boom');
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_implemented');
  });

  it('translates unexpected throws → 500 + opaque envelope + log line with stack', async () => {
    const logger = new CapturingLogger();
    const app = buildApp(() => {
      throw new Error('database exploded with secrets');
    }, logger);
    const res = await app.request('http://test/boom');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('internal_error');
    // Critical: the secret message must NOT leak to the response body.
    expect(body.error.message).not.toContain('secrets');
    expect(body.error.message).not.toContain('database');
    // It should be in the logs though, for the operator to debug.
    const errorEntries = logger.entries.filter((e) => e.level === 'error');
    expect(errorEntries.length).toBeGreaterThan(0);
    expect(errorEntries[0]?.meta?.message).toContain('secrets');
    expect(typeof errorEntries[0]?.meta?.stack).toBe('string');
    expect(errorEntries[0]?.meta?.path).toBe('/boom');
    expect(errorEntries[0]?.meta?.method).toBe('GET');
  });
});
