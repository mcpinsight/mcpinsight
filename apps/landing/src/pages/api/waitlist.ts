import type { APIRoute } from 'astro';

export interface WaitlistEnv {
  RESEND_API_KEY: string;
  RESEND_AUDIENCE_ID: string;
}

interface WaitlistBody {
  email: unknown;
  website?: unknown;
}

interface ResendErrorBody {
  name?: unknown;
  message?: unknown;
  statusCode?: unknown;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MIN_LEN = 3;
const EMAIL_MAX_LEN = 254;
const RESEND_CONTACTS_URL = (audienceId: string): string =>
  `https://api.resend.com/audiences/${audienceId}/contacts`;

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function hashEmailPrefix(email: string): Promise<string> {
  try {
    const data = new TextEncoder().encode(email);
    const digest = await crypto.subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < 3; i += 1) {
      const b = bytes[i] ?? 0;
      hex += b.toString(16).padStart(2, '0');
    }
    return hex;
  } catch {
    return 'n/a';
  }
}

function isDuplicateContact(status: number, body: unknown): boolean {
  if (status === 409) return true;
  if (typeof body !== 'object' || body === null) return false;
  const err = body as ResendErrorBody;
  if (typeof err.name === 'string' && err.name.toLowerCase() === 'already_exists') {
    return true;
  }
  if (typeof err.message === 'string' && err.message.toLowerCase().includes('already exists')) {
    return true;
  }
  return false;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// Astro CF adapter surfaces CF Pages env bindings via locals.runtime.env.
// We narrow manually to avoid depending on augmented App.Locals types.
export function extractEnv(locals: unknown): WaitlistEnv | null {
  if (typeof locals !== 'object' || locals === null) return null;
  const l = locals as { runtime?: { env?: unknown } };
  const env = l.runtime?.env;
  if (typeof env !== 'object' || env === null) return null;
  const e = env as Partial<WaitlistEnv>;
  if (typeof e.RESEND_API_KEY !== 'string' || typeof e.RESEND_AUDIENCE_ID !== 'string') {
    return null;
  }
  if (!e.RESEND_API_KEY || !e.RESEND_AUDIENCE_ID) return null;
  return { RESEND_API_KEY: e.RESEND_API_KEY, RESEND_AUDIENCE_ID: e.RESEND_AUDIENCE_ID };
}

export const POST: APIRoute = async ({ request, locals }) => {
  let parsed: WaitlistBody;
  try {
    parsed = (await request.json()) as WaitlistBody;
  } catch {
    return jsonResponse(400, { ok: false, error: 'invalid_body' });
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return jsonResponse(400, { ok: false, error: 'invalid_body' });
  }

  if (typeof parsed.website === 'string' && parsed.website.length > 0) {
    const emailForHash = typeof parsed.email === 'string' ? parsed.email.trim() : '';
    const emailHash = emailForHash.length > 0 ? await hashEmailPrefix(emailForHash) : 'n/a';
    // biome-ignore lint/suspicious/noConsoleLog: pages function observability
    console.log(JSON.stringify({ event: 'waitlist.honeypot_triggered', email_hash: emailHash }));
    return jsonResponse(200, { ok: true });
  }

  if (typeof parsed.email !== 'string') {
    return jsonResponse(400, { ok: false, error: 'invalid_email' });
  }

  const email = parsed.email.trim();
  if (email.length < EMAIL_MIN_LEN || email.length > EMAIL_MAX_LEN || !EMAIL_REGEX.test(email)) {
    return jsonResponse(400, { ok: false, error: 'invalid_email' });
  }

  const env = extractEnv(locals);
  if (!env) {
    // biome-ignore lint/suspicious/noConsoleLog: pages function observability
    console.log(JSON.stringify({ event: 'waitlist.server_misconfigured' }));
    return jsonResponse(500, { ok: false, error: 'server_misconfigured' });
  }

  const emailHash = await hashEmailPrefix(email);

  let upstream: Response;
  try {
    upstream = await fetch(RESEND_CONTACTS_URL(env.RESEND_AUDIENCE_ID), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, unsubscribed: false }),
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'unknown';
    // biome-ignore lint/suspicious/noConsoleLog: pages function observability
    console.log(
      JSON.stringify({
        event: 'waitlist.upstream_network_error',
        email_hash: emailHash,
        reason,
      }),
    );
    return jsonResponse(502, { ok: false, error: 'upstream_error' });
  }

  if (upstream.ok) {
    // biome-ignore lint/suspicious/noConsoleLog: pages function observability
    console.log(JSON.stringify({ event: 'waitlist.success', email_hash: emailHash }));
    return jsonResponse(200, { ok: true });
  }

  const errorBody = await safeJson(upstream);

  if (isDuplicateContact(upstream.status, errorBody)) {
    // biome-ignore lint/suspicious/noConsoleLog: pages function observability
    console.log(JSON.stringify({ event: 'waitlist.duplicate', email_hash: emailHash }));
    return jsonResponse(200, { ok: true });
  }

  // biome-ignore lint/suspicious/noConsoleLog: pages function observability
  console.log(
    JSON.stringify({
      event: 'waitlist.upstream_error',
      email_hash: emailHash,
      upstream_status: upstream.status,
      upstream_body: errorBody,
    }),
  );
  return jsonResponse(502, { ok: false, error: 'upstream_error' });
};
