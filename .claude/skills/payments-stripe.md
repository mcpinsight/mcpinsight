# Skill: Payments (Stripe Checkout + Webhooks on Cloudflare Workers)

> Load when working on `apps/worker/src/routes/stripe-webhook.ts`, pricing logic, or pre-sale flow.

## Scope

- **Pre-sale (Day 10 of the 30-day plan)**: $6 one-time payment → email + license key.
- **Pro (post-launch)**: $12/month subscription → license key tied to Stripe customer ID.
- **Team tier (m6+)**: $29/seat/month subscription with `quantity`. Not in Y1 first 6 months.

Stripe is **the** system of record for billing. Our DB stores licenses keyed by Stripe customer ID. We never invent a user without a Stripe customer behind it.

## Product + price configuration

Products are **defined in Stripe Dashboard**, referenced by ID in Worker env:

```toml
# apps/worker/wrangler.toml (vars)
STRIPE_PRICE_PRESALE   = "price_xxx"   # $6 one-time
STRIPE_PRICE_PRO_MONTHLY = "price_yyy" # $12/month
STRIPE_PRICE_TEAM_MONTHLY = "price_zzz" # $29/seat/month (added m6)
```

Secrets (never vars):
```
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
ED25519_PRIVATE_KEY (base64; for license signing)
RESEND_API_KEY
```

Set via `wrangler secret put`.

## Checkout flow

Landing page calls a Worker endpoint that creates a Checkout Session and returns a URL:

```ts
// apps/worker/src/routes/checkout.ts
app.post('/api/checkout/presale', async (c) => {
  const { email } = await c.req.json();
  if (!isEmail(email)) return c.json({ error: 'invalid_email' }, 400);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: c.env.STRIPE_PRICE_PRESALE, quantity: 1 }],
    customer_email: email,
    metadata: { plan: 'presale' },
    success_url: 'https://mcpinsight.dev/thanks?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'https://mcpinsight.dev/',
  });
  return c.json({ url: session.url });
});
```

- `customer_email` prefills the Checkout form.
- `metadata.plan` travels with the event; we branch on it in the webhook.
- Success page shows a "check your inbox for your license key" message; the email arrives async.

## Webhook handler (the important one)

```ts
// apps/worker/src/routes/stripe-webhook.ts
app.post('/api/stripe/webhook', async (c) => {
  const sig = c.req.header('stripe-signature');
  const body = await c.req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, c.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    c.env.LOG.warn('stripe.sig.invalid', { err: String(err) });
    return c.text('bad signature', 400);
  }

  switch (event.type) {
    case 'checkout.session.completed':       await handleCheckout(event, c.env); break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':    await handleSubscription(event, c.env); break;
    case 'customer.subscription.deleted':    await handleSubscriptionCanceled(event, c.env); break;
    case 'invoice.payment_failed':           await handlePaymentFailed(event, c.env); break;
    default: /* ignore */ break;
  }
  return c.text('ok');
});
```

### Idempotency

Webhook events are retried by Stripe. Our handler **must be idempotent**. The pattern:

```ts
async function handleCheckout(event: Stripe.Event, env: Env) {
  const session = event.data.object as Stripe.Checkout.Session;
  const existing = await env.DB.prepare('SELECT id FROM license WHERE stripe_session_id = ?').bind(session.id).first();
  if (existing) return;   // already processed

  // generate + insert + email, wrapped in a D1 batch for atomicity
  // ...
}
```

Always key on `event.id` or on the subscription/session ID — never on `now()`.

## License key generation (Ed25519)

```ts
// apps/worker/src/license/generate.ts
import { sign } from '@noble/ed25519';

export async function generateLicenseKey(payload: LicensePayload, privKey: Uint8Array): Promise<string> {
  const body = base64url(JSON.stringify(payload));
  const sig  = base64url(await sign(new TextEncoder().encode(body), privKey));
  return `${body}.${sig}`;
}

export interface LicensePayload {
  tier: 'presale' | 'pro' | 'team';
  stripe_customer_id: string;
  issued_at: number;        // unix ms
  expires_at: number | null;
  seats: number;            // 1 for Pro, N for Team
  version: 1;
}
```

Verification lives in both the Worker (for quick online checks) and the local CLI (`packages/core/src/pro/license.ts`). The CLI has only the public key embedded; it cannot forge.

## Failure modes to handle

| Event | Action |
|---|---|
| `checkout.session.completed` | Create license row, generate key, email via Resend, respond 200. |
| `customer.subscription.updated` (status → `past_due`) | Mark license `grace_until = now + 3d`, CLI shows banner. |
| `customer.subscription.updated` (status → `active` after past_due) | Clear grace. |
| `customer.subscription.deleted` | Revoke license key; CLI falls back to Free tier. |
| `invoice.payment_failed` | Log; Stripe handles retries and final cancellation. No immediate action. |

## Fingerprint cap

Every license may be activated on up to **3 machine fingerprints** (typical dev has laptop + desktop + work machine). Enforced at `/api/license/validate`:

```ts
if (fingerprints.size >= 3 && !fingerprints.has(incomingFingerprint)) {
  return c.json({ valid: false, reason: 'fingerprint_cap' }, 403);
}
```

User-resolvable via an email to support (manual process in Y1; UI self-serve in Y2).

## Anti-patterns

- **Trusting the success redirect.** A user can hit `/thanks?session_id=...` without completing payment (shared URL). Fulfillment happens on the webhook **only**.
- **Synchronous email in the webhook**. If Resend is slow, Stripe retries. Use queue or catch-and-log: webhook response must be ≤10 s per Stripe's rules.
- **Storing card data**. We don't. Stripe has `customer_id` — that's all.
- **Skipping signature verification** in dev. Use `stripe listen --forward-to` + `STRIPE_WEBHOOK_SECRET` from the CLI.

## Testing

- Unit tests for `generateLicenseKey` + `verifyLicenseKey` — including tampered payload rejection.
- Integration test: fake Stripe event JSON → webhook handler → assert D1 row + no duplicate on replay.
- **No real network calls in tests.** Use `stripe-mock` or hand-rolled event fixtures.

## Claude hints

- When asked to add a new plan tier, update (a) Stripe Dashboard (manual), (b) wrangler var, (c) webhook branch, (d) `LicensePayload.tier` union, (e) CLI license verification fallback.
- If you're writing a `setTimeout` in a webhook handler, stop. Workers don't support background work; use a queue or a scheduled task.
