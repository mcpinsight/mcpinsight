import type { APIContext } from 'astro';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { WaitlistEnv } from '../src/pages/api/waitlist';
import { POST } from '../src/pages/api/waitlist';

type FetchArgs = [input: string, init?: RequestInit];
type FetchReturn = Promise<Response>;

const VALID_ENV: WaitlistEnv = {
  RESEND_API_KEY: 'test-api-key',
  RESEND_AUDIENCE_ID: 'aud-123',
};

function buildContext(body: string, env: WaitlistEnv): APIContext {
  const request = new Request('https://mcpinsight.dev/api/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  return {
    request,
    locals: { runtime: { env } },
  } as unknown as APIContext;
}

function jsonBody(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

function mockFetchResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/waitlist', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  test('happy path: valid email is forwarded to Resend and returns 200', async () => {
    const fetchMock = vi.fn<FetchArgs, FetchReturn>(async () =>
      mockFetchResponse(201, { id: 'c_123' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(buildContext(jsonBody({ email: '  user@example.com  ' }), VALID_ENV));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [url, init] = call;
    expect(url).toBe('https://api.resend.com/audiences/aud-123/contacts');
    expect(init).toBeDefined();
    if (!init) throw new Error('fetch init missing');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-api-key');
    expect(headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ email: 'user@example.com', unsubscribed: false }));
  });

  test('invalid email (no @) returns 400 invalid_email and skips Resend', async () => {
    const fetchMock = vi.fn<FetchArgs, FetchReturn>(async () => mockFetchResponse(201, {}));
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(buildContext(jsonBody({ email: 'notanemail' }), VALID_ENV));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid_email' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('email longer than 254 chars returns 400 invalid_email', async () => {
    const fetchMock = vi.fn<FetchArgs, FetchReturn>(async () => mockFetchResponse(201, {}));
    vi.stubGlobal('fetch', fetchMock);

    const longLocal = 'a'.repeat(290);
    const longEmail = `${longLocal}@example.com`;
    expect(longEmail.length).toBeGreaterThanOrEqual(300);

    const res = await POST(buildContext(jsonBody({ email: longEmail }), VALID_ENV));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid_email' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('honeypot filled: returns 200 without calling Resend', async () => {
    const fetchMock = vi.fn<FetchArgs, FetchReturn>(async () => mockFetchResponse(201, {}));
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(
      buildContext(jsonBody({ email: 'valid@example.com', website: 'http://spam.com' }), VALID_ENV),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('Resend returns 422: handler returns 502 upstream_error', async () => {
    const fetchMock = vi.fn<FetchArgs, FetchReturn>(async () =>
      mockFetchResponse(422, { name: 'validation_error', message: 'Unprocessable' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(buildContext(jsonBody({ email: 'user@example.com' }), VALID_ENV));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: 'upstream_error' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('Resend returns 409 (duplicate): handler returns 200 ok', async () => {
    const fetchMock = vi.fn<FetchArgs, FetchReturn>(async () =>
      mockFetchResponse(409, {
        name: 'already_exists',
        message: 'Contact already exists in this audience.',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(buildContext(jsonBody({ email: 'dup@example.com' }), VALID_ENV));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('missing RESEND_API_KEY returns 500 server_misconfigured and skips Resend', async () => {
    const fetchMock = vi.fn<FetchArgs, FetchReturn>(async () => mockFetchResponse(201, {}));
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(
      buildContext(jsonBody({ email: 'user@example.com' }), {
        RESEND_API_KEY: '',
        RESEND_AUDIENCE_ID: 'aud-123',
      }),
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, error: 'server_misconfigured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('body is not JSON: returns 400 invalid_body', async () => {
    const fetchMock = vi.fn<FetchArgs, FetchReturn>(async () => mockFetchResponse(201, {}));
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(buildContext('not json', VALID_ENV));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid_body' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('body is JSON null: returns 400 invalid_body', async () => {
    const fetchMock = vi.fn<FetchArgs, FetchReturn>(async () => mockFetchResponse(201, {}));
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(buildContext('null', VALID_ENV));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid_body' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('fetch throws (network error): handler returns 502 upstream_error', async () => {
    const fetchMock = vi.fn<FetchArgs, FetchReturn>(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(buildContext(jsonBody({ email: 'user@example.com' }), VALID_ENV));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: 'upstream_error' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('duplicate via body.name (non-409 status): returns 200 ok', async () => {
    const fetchMock = vi.fn<FetchArgs, FetchReturn>(async () =>
      mockFetchResponse(400, { name: 'already_exists', message: 'Already subscribed.' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(buildContext(jsonBody({ email: 'dup@example.com' }), VALID_ENV));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('duplicate via body.message substring (no 409, no name match): returns 200 ok', async () => {
    const fetchMock = vi.fn<FetchArgs, FetchReturn>(async () =>
      mockFetchResponse(422, {
        name: 'other_error',
        message: 'The contact already exists here.',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(buildContext(jsonBody({ email: 'dup@example.com' }), VALID_ENV));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
