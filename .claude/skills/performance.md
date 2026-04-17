# Skill: Performance

> Load when writing code that processes logs, runs on cold-start paths, or renders large tables.

## Guiding principle

Performance matters in exactly three places:
1. **Parser throughput** — a user with 6 months of sessions has 500k+ JSONL lines. Slow parser = slow `mcpinsight scan` = bad first impression.
2. **Worker cold start** — Cloudflare cold start should be <50 ms. A fat bundle adds tens of ms that compound across daily license checks.
3. **Dashboard interactivity** — the overview page must render within 1.5 s on a local stack from a cold fetch.

Everything else ships and we optimize when measured. No micro-optimization without a benchmark.

## Budgets (measured in CI)

| Path | Target | Measured by |
|---|---|---|
| Parser: parse + normalize 10k JSONL lines | <1.5 s on a 2020 MBA | `packages/core/bench/parser.bench.ts` |
| Aggregator: ingest 10k rows | <0.5 s | `packages/core/bench/aggregator.bench.ts` |
| Worker bundle size | <500 KB minified | `wrangler deploy --dry-run` output |
| Worker cold start p99 | <50 ms | Cloudflare analytics (observed in prod) |
| Dashboard: first meaningful paint | <1.5 s | Lighthouse in CI |
| Dashboard: JS initial chunk | <200 KB gzipped | `vite build` output |

## Techniques (in order of reach-for)

### 1. Cache prepared statements

Already covered in database skill. Rebuilding SQL at each call is a measurable tax.

### 2. Batch inserts in transactions

```ts
const insertMany = db.transaction((rows: McpCall[]) => {
  for (const r of rows) stmts.insertCall.run(r);
});
insertMany(batch);   // orders of magnitude faster than row-by-row
```

### 3. Stream, don't slurp

For JSONL parsing, use `createReadStream` + `readline`. `readFileSync` a 500 MB file is either OOM or many seconds.

### 4. Debounce the polling loop

`setInterval` at 5 s is fine, but skip scans when the previous one is still running. Use a `isScanning` flag.

### 5. Incremental offsets

`scan_state.last_byte_offset` per file. Never re-read the prefix that's already in the DB. This is the single biggest win for large-log users.

### 6. Avoid re-renders in React

- `React.memo` for rows in tables with >50 items.
- `useMemo` for formatted numbers that are expensive to compute (rare).
- Keyed children; stable keys (DB ID, not array index).
- TanStack Query already deduplicates in-flight requests.

### 7. Worker bundle slimming

- `esbuild` tree-shakes well; avoid barrel exports from heavy packages.
- No `lodash` (use native or one-off helpers).
- No `moment` / `luxon` — use native `Date` or `Intl.DateTimeFormat`.
- Prefer `@noble/ed25519` over full Web Crypto glue layers.

## Benchmarking

Use Vitest's bench API for micro-benchmarks. Keep results comparable across runs by pinning Node version in CI.

```ts
// packages/core/bench/parser.bench.ts
import { bench, describe } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseClaudeCodeLine } from '../src/parsers/claude-code';

const lines = readFileSync('fixtures/claude-code/10k-session.jsonl', 'utf-8').split('\n');

describe('parser', () => {
  bench('parseClaudeCodeLine (10k lines)', () => {
    for (const line of lines) parseClaudeCodeLine(line);
  }, { iterations: 20 });
});
```

Run `pnpm --filter @mcpinsight/core bench`. Record baseline in `docs/benchmarks.md`; compare PRs against it informally.

## When NOT to optimize

- Before a benchmark shows a hot spot. "It feels slow" is not a benchmark.
- For code that runs <100 times/day in total (license validation UI polling, etc.).
- In the CLI-output rendering path. Users accept 200 ms there gladly if the data is right.

## Anti-patterns

- **Premature `Worker`/`WorkerThreads`** in Node. Complexity far exceeds savings for parser workloads (it's CPU-bound but SQLite is sync anyway).
- **Virtualized tables** for dashboards with <500 rows. Real users have fewer servers than that.
- **Caching in the Worker with a TTL of minutes** for license status. Correctness > ms.
- **Image optimization for a UI that has no images.**

## Claude hints

- When you think you need to optimize, first: benchmark. Show the number.
- When reviewing a PR that claims a perf improvement, ask for before/after numbers. If absent, request them.
- If a bundle-size regression is proposed, trace it to the specific new import.
