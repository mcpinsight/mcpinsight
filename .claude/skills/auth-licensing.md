# Skill: Auth & Licensing (Ed25519 signed keys, no user accounts in Y1)

> Load when touching `packages/core/src/pro/license.ts`, `apps/worker/src/license/*`, or any code checking `tier`.

## Design principle

MCPInsight has **no user accounts in Year 1**. No signup form, no password, no OAuth. The unit of identity is the **license key**, which is an Ed25519-signed payload emailed after payment.

This is a deliberate scope cut. Accounts add:
- Auth provider integration work (Clerk/Auth0 or custom).
- Email verification flows, password resets, 2FA nagging.
- A database schema to maintain.

In exchange for: nothing we actually need at MRR < $5k.

Team tier (m6+) will require some notion of "admin assigns seats to teammates". That's the *first* time account-shaped work becomes necessary, and it will be scoped tightly.

## License key format

```
<base64url(JSON payload)>.<base64url(ed25519 signature)>
```

The payload:

```ts
interface LicensePayload {
  tier: 'presale' | 'pro' | 'team';
  stripe_customer_id: string;       // "cus_xxx"
  stripe_subscription_id: string | null;   // null for one-time presale
  issued_at: number;                // unix ms
  expires_at: number | null;        // null = lifetime (presale)
  seats: number;                    // 1 for Pro, N for Team
  email_hash: string;               // sha256(lowercase(email)), for support lookup
  version: 1;
}
```

The signature is **over the exact base64url-encoded JSON body** (not re-stringified JSON; that would break round-tripping).

## Key generation (Worker side)

Private key lives **only** in Worker secrets (`ED25519_PRIVATE_KEY`, base64). Never leaves. Never committed. Rotation plan: a `version` field in the payload + CLI accepts keys signed by any public key in its embedded allowlist (initially 1; grows during rotation).

## Key verification (CLI side)

```ts
// packages/core/src/pro/license.ts
import { verify } from '@noble/ed25519';

const PUBLIC_KEYS: Uint8Array[] = [
  decodeBase64('mcpinsight-pubkey-v1-base64...'),
];

export async function verifyLicenseKey(key: string): Promise<LicensePayload | null> {
  const parts = key.split('.');
  if (parts.length !== 2) return null;
  const [bodyB64, sigB64] = parts;
  const bodyBytes = new TextEncoder().encode(bodyB64);
  const sigBytes  = decodeBase64Url(sigB64);

  for (const pub of PUBLIC_KEYS) {
    if (await verify(sigBytes, bodyBytes, pub)) {
      const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(bodyB64))) as LicensePayload;
      if (isExpired(payload)) return null;
      return payload;
    }
  }
  return null;
}
```

- **No network call in the common path.** CLI works offline; Pro features work offline. This is critical: devs often work on planes, in SCIFs, etc.
- **Online validation** is a daily opt-in check against the Worker, for revocation awareness. On failure: CLI proceeds with cached status for up to 14 days, then downgrades to Free.

## Activation flow (CLI)

```bash
$ mcpinsight activate
? Paste your license key: mAAAB...xxxx
✓ License valid (Pro, 3 seats, expires 2027-04-22)
$ 
```

The key is saved to `~/.mcpinsight/license.key` (file mode 0600). The file is never committed (gitignored in repo; user shouldn't put it in their own repos either — we warn once).

## Fingerprint cap

Each activation sends a **fingerprint** to `/api/license/validate`:

```ts
function computeFingerprint(): string {
  return sha256([
    os.hostname(),
    os.platform(),
    os.arch(),
    os.userInfo().username,
  ].join('|')).slice(0, 16);
}
```

The Worker tracks up to **3 fingerprints per license**. Exceeding returns `403 fingerprint_cap`, with user-facing CLI message:

```
Your license is already activated on 3 machines. To switch, email
support@mcpinsight.dev with the machine you'd like to deactivate.
```

Manual support ticket flow in Y1. Self-serve in Y2 (when accounts exist).

## Tier gating (the Pro code path)

Because we chose a **single public bundle** (INV-07), Pro features live in the same code, guarded by:

```ts
// packages/core/src/pro/gate.ts
export function requiresTier(needed: 'pro' | 'team', license: LicensePayload | null): boolean {
  if (!license) return false;
  if (needed === 'pro')  return license.tier === 'pro' || license.tier === 'team';
  if (needed === 'team') return license.tier === 'team';
  return false;
}
```

Usage:

```ts
if (!requiresTier('pro', license)) {
  return { error: 'pro_required', hint: 'Upgrade at mcpinsight.dev/pricing' };
}
// ... run Pro-only algorithm
```

**Killer Pro features** (those we really don't want free users replicating) run **server-side** on the Worker:
- Health Score calibration using aggregated community data.
- Cross-machine sync.
- State-of-MCP API (which Pro users can query).

Trade-off accepted: a sophisticated user can read the bundle and see a `requiresTier('pro', ...)` check, fork, and bypass. For $12/month, this is a fine trade-off. Obfuscation is theater.

## Storage of license status in CLI

```sql
-- in ~/.mcpinsight/data.db
CREATE TABLE license_cache (
  key_hash            TEXT PRIMARY KEY,     -- sha256 of the full key
  tier                TEXT NOT NULL,
  expires_at          INTEGER,
  last_validated_at   INTEGER NOT NULL,
  validation_status   TEXT NOT NULL         -- 'valid' | 'revoked' | 'grace' | 'offline'
);
```

CLI picks the most recent row per `key_hash`, respects `validation_status`. If `last_validated_at < now - 14d`, CLI forces re-validation.

## Anti-patterns

- **Rolling our own signature scheme.** Use `@noble/ed25519`. Zero deps, audited.
- **Storing the license key hashed in the Worker DB.** We store the *payload* + separate `license_keys` issuances log (for revocation). The raw key is what the user has; we can regenerate it from payload because we have the private key.
- **Asking for email twice.** We have it from Stripe. Tie the license to Stripe customer, not the typed email.
- **A "forgot my license key" flow before we have 100 paying users.** Manual email support. Seriously.

## Testing

- `verifyLicenseKey` unit tests: valid, expired, wrong signature, tampered payload, unknown version.
- Integration test: Worker `/api/license/validate` with fake DB row.
- Fingerprint test: 3 different fingerprints allowed, 4th rejected with correct error code.

## Claude hints

- Never log license keys or payloads beyond a `key_hash` prefix (first 8 chars).
- If adding a new tier, update `LicensePayload.tier` union + `requiresTier` + `PUBLIC_KEYS` if rotating.
- The CLI must work offline. Any feature that hard-requires a Worker round-trip needs explicit PM approval.
