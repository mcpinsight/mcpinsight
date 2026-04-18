# ADR-0003: Landing page stack — Astro + Cloudflare Pages + Resend Audience

- **Status**: accepted
- **Date**: 2026-04-17
- **Author**: Architect (MCPInsight)
- **Deciders**: solo dev + Architect agent

## Context

Day 10 of the 30-day plan requires a live marketing site at `https://mcpinsight.dev` with a working email waitlist, shipped in a ~3.5-hour budget. The site has four jobs: (1) state the product thesis, (2) capture emails, (3) survive a Reddit/HN traffic spike, (4) not cost engineering time during Weeks 2–4 while the real product is being built.

The landing is distinct from the in-app dashboard (`packages/web`). The dashboard runs locally, uses React 18 + Vite + TanStack, and is bundled by the Hono server. The landing is public, zero-auth, and served from the edge. The two share brand tokens but nothing else — conflating them would couple marketing iteration to core-engine releases.

The `apps/worker` Cloudflare Worker (billing + telemetry + State-of-MCP API) does not exist yet (planned for Week 4). A waitlist endpoint needed today cannot wait for that Worker.

Pre-sale via Stripe was removed from Day 10 scope by a business decision on 2026-04-17. The landing ships with email-only capture; paid tiers come later.

## Decision

### 1. Framework: **Astro 4.x**
Ships zero JS by default, has first-class Cloudflare Pages adapter, supports TypeScript-strict and Tailwind through official integrations. Islands architecture keeps the waitlist form as the only interactive surface (progressive enhancement: form posts even with JS disabled).

### 2. Location: **`apps/landing`** as `@mcpinsight/landing`
`apps/` is the convention for deployable runtime units (parallel to `apps/worker`); `packages/` is for importable libraries. Landing is a deployable, not a library. The package is `private: true` — it will never be published to npm.

### 3. Styling: **Tailwind CSS 3 + shared token file**
Same CSS variable set as `packages/web/src/styles/tokens.css` (when that exists). Zero custom CSS, zero shadcn — shadcn is a dashboard component library, overkill for a 3-card landing.

### 4. Waitlist endpoint: **Cloudflare Pages Functions**
`apps/landing/functions/api/waitlist.ts` runs as a Pages Function (a Worker under the hood) co-deployed with the static site. A separate `apps/worker` deployment is not created today; the distinct Worker for billing/telemetry in Week 4 may absorb this endpoint later (revisit with a follow-up ADR if we do).

### 5. Waitlist storage: **Resend Audience** (not Cloudflare D1)
Resend handles storage, double-opt-in switch, unsubscribe compliance, and export-to-CSV. For <500 contacts the UI is sufficient; beyond that or if we need SQL analytics we migrate to D1 under a follow-up ADR. Weekly CSV snapshot to `private-docs/waitlist-snapshots/` is the backup.

### 6. Opt-in mode: **single opt-in for now**
One POST → contact added → confirmation email from Resend. Double-opt-in (token-verified) is deferred to Week 3 when the Worker exists to host the `/verify/:token` endpoint. Single opt-in is acceptable risk for a pre-launch waitlist; compliance tightens before public launch.

### 7. What is explicitly **not** in this decision
- No Next.js (SSR not needed; would add ~80 KB JS baseline).
- No Vercel (Cloudflare already owns the DNS + domain; one vendor is simpler).
- No CMS, no blog engine, no MDX pipeline (Y1 — a flat `src/pages/*.astro` is enough).
- No analytics SDK on Day 10 (add Plausible or CF Web Analytics in Week 3; Day 10 budget is already tight).
- No i18n (INV-08 — English only in Y1; all strings in `src/copy/en.ts`).

## Alternatives considered

- **Next.js 14 App Router on Cloudflare Pages**: more engineering, heavier bundle, edge-runtime sharp edges. Rejected — the landing doesn't need RSC or client-side routing.
- **Vanilla HTML + Vite**: lower complexity by one notch than Astro, but loses components + TS + routing primitives we get free from Astro. Rejected as false economy; Astro is "vanilla + batteries" for the static-first case.
- **Cloudflare D1 as waitlist storage (no Resend Audience)**: gives SQL analytics on day 1, but requires a schema, migration, and our own unsubscribe / GDPR handling. Rejected on P5 (no speculative abstraction) and P9 (time budget) — we don't have the data scale yet to justify the compliance surface.
- **Resend Audience + shadow copy to D1 on every insert**: double-writes for a future analytics need that doesn't exist today. Rejected — YAGNI; migration from Resend export to D1 later is a 30-minute job.
- **Separate Worker (`apps/worker/landing-api`) instead of Pages Functions**: cleaner separation of concerns, but adds a second `wrangler deploy`, second DNS route, second secret set. Rejected for Day 10 — revisit when the billing Worker lands.
- **Keep pre-sale Stripe checkout on Day 10**: the original plan. Rejected per 2026-04-17 business decision: first validate waitlist-to-conversion signal, then add paid tier after Week 3 when the parser is real.

## Consequences

### Positive

- Day 10 budget held: Astro scaffold ~30 min, copy ~30 min, styling ~45 min, form + Pages Function + tests ~60 min, DNS + Pages project + deploy ~30 min. Leaves buffer for DNS propagation waits.
- `apps/landing` has no build-time coupling to `packages/core` or `packages/web` — landing can iterate (copy, hero variants, A/B tests) without touching the engine. Marketing cadence decoupled from engine cadence.
- Single vendor for DNS + hosting + TLS + Pages Functions (Cloudflare) and one for email (Resend). Two accounts to secure instead of four.
- Zero JS on the static shell — lighthouse ≥95, loads fast on mobile Reddit links.
- Follows INV-07 (single public bundle): landing source is in the public repo, secrets are in GitHub Actions + Cloudflare env, zero private code.
- Follows INV-08 (English only): `src/copy/en.ts` is the single source of user-visible strings; no i18n framework imported.

### Negative

- Resend Audience lock-in for the list itself. Mitigation: weekly CSV export (manual, ~2 min) to `private-docs/waitlist-snapshots/`.
- Pages Functions have cold-start characteristics distinct from the main Worker; if we later unify to `apps/worker`, the waitlist handler gets re-tested. Acceptable — the handler is ~40 lines.
- Single opt-in has compliance risk in some jurisdictions (CASL, strict GDPR reads). Mitigation: switch to double opt-in in Week 3 before any paid tier launches; form copy explicitly states what we collect + a link to a brief privacy blurb.
- Two frontend stacks in the repo (Astro for landing, React+Vite for dashboard). Branding tokens are shared via a copied `tokens.css`; if the dashboard's tokens drift, the landing doesn't auto-update. Mitigation: when `packages/web` is scaffolded, re-export `tokens.css` and the landing imports from there via a relative path (no package dependency needed).

### Neutral / trade-offs

- The landing repo entry in `apps/` is not versioned by changesets — it's a deployment target. Same treatment as `apps/worker`.
- No test coverage gate on the landing (UI/copy per P4 — tests optional). One integration test for the waitlist Pages Function is required; unit tests for Astro components are not.
- Build output (`apps/landing/dist`) and the `.wrangler/` + `.astro/` caches are `.gitignore`'d.

## Invariants touched

- **INV-07** (single public bundle, no private npm scope): upheld — landing is fully public; only env-var secrets live outside the repo.
- **INV-08** (English-only strings in Y1): upheld — `src/copy/en.ts` is the single source of UI strings; no `astro-i18n`, no `i18next`.
- No other INV materially affected. INV-03 (telemetry schema versioning) would apply if we tracked form submission events; we don't on Day 10.

## Migration / follow-up

- [ ] DevOps: scaffold `apps/landing` with Astro minimal template, Tailwind integration, Cloudflare Pages adapter (solo dev, Day 10).
- [ ] DevOps: verify `mcpinsight.dev` in Resend (TXT + DKIM + SPF in Cloudflare DNS), create Audience "MCPInsight Waitlist", capture `RESEND_AUDIENCE_ID` into GitHub Secrets (solo dev, Day 10).
- [ ] Backend: implement `functions/api/waitlist.ts` with regex + honeypot + Resend API call, plus `waitlist-function.test.ts` (solo dev, Day 10).
- [ ] Frontend: Hero + 3 feature cards + form + `thanks.astro` + `copy/en.ts` with "Launching soon" wording (solo dev, Day 10).
- [ ] DevOps: create Cloudflare Pages project, bind secrets, custom-domain `mcpinsight.dev` + `www.mcpinsight.dev`, smoke-test end-to-end (solo dev, Day 10).
- [ ] Documentation: update root README with live URL (solo dev, Day 10).
- [ ] Operations: weekly Resend CSV export to `private-docs/waitlist-snapshots/YYYY-MM-DD.csv` (solo dev, recurring).
- [ ] Revisit in Week 3: migrate waitlist to double opt-in once `apps/worker` exists and can host the verify endpoint.
- [ ] Revisit in Week 4: decide whether the waitlist endpoint stays in Pages Functions or moves into `apps/worker` for consolidation (new ADR if moved).

## References

- `.claude/tasks/phase-mvp-parser.md` §Day 10 — original task definition.
- `CLAUDE.md §6` — invariant list.
- `.claude/config/principles.md` — P1 (boring > clever), P5 (no speculative abstraction), P9 (solo-dev time honesty).
- ADR-0001 — monorepo layout: `apps/` for deployables, `packages/` for libraries.
- Astro on Cloudflare Pages: https://docs.astro.build/en/guides/integrations-guide/cloudflare/
- Resend Audiences API: https://resend.com/docs/api-reference/audiences
