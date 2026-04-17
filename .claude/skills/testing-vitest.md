# Skill: Testing (Vitest + Playwright)

> Load when writing or reviewing tests, designing fixtures, or debugging coverage.

## Tools

- **Vitest 1.x** for unit, integration, contract tests. Shares Vite config; fast; good TS support.
- **Playwright** for e2e: CLI smoke test and web dashboard happy path. CI only (not in local PR loop).
- **`@testing-library/react`** for component rendering/interaction.
- **`msw`** for API mocking in web component tests (not for integration — those use the real server factory).

No Jest. No Mocha/Chai. No Cypress.

## Test layout

```
packages/core/test/
├── unit/
│   ├── parsers/
│   │   └── claude-code.test.ts
│   ├── normalizers/
│   ├── health/
│   └── util/
├── integration/
│   ├── aggregator.test.ts        # parser → DB end-to-end
│   └── db-migrations.test.ts     # migration runner + seed
└── fixtures.test.ts              # runs parser+normalizer over packages/core/fixtures/

packages/server/test/
├── contract/
│   ├── servers.test.ts
│   └── health.test.ts
└── integration/
    └── error-handling.test.ts

packages/web/test/
├── components/
│   └── ServerTable.test.tsx
└── routes/
    └── OverviewRoute.test.tsx

tests-e2e/                         # repo root, runs against built artifacts
├── cli-smoke.spec.ts
└── dashboard-happy-path.spec.ts
```

## Configuration

Shared `vitest.config.ts` per package:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      lines: 80, branches: 75, functions: 80, statements: 80,
      include: ['src/**/*.ts'],
      exclude: ['src/**/index.ts', 'src/**/*.d.ts'],
    },
  },
});
```

Each package has its own thresholds (80/75 for core; lower for web).

## Writing a good test

### Name the behavior, not the function

```ts
// ✅
it('drops malformed JSON lines without crashing the parser', () => { ... });
// ❌
it('parseLine', () => { ... });
```

### Arrange / Act / Assert, visibly

```ts
it('counts unique MCP servers over 7 days', () => {
  // arrange
  const calls: McpCall[] = [
    call({ server: 'filesystem', ts: daysAgo(1) }),
    call({ server: 'github',     ts: daysAgo(2) }),
    call({ server: 'filesystem', ts: daysAgo(3) }),
  ];
  const db = seed(calls);

  // act
  const result = queries(db).topServers(daysAgo(7).getTime(), null, 10);

  // assert
  expect(result).toHaveLength(2);
  expect(result[0].server_name).toBe('filesystem');
  expect(result[0].calls).toBe(2);
});
```

### Use builders, not inline objects

```ts
// test/util/factories.ts
export function call(overrides: Partial<McpCall> = {}): McpCall {
  return {
    id: 0, client: 'claude-code', session_id: 'sess-1',
    project_identity: 'proj-abc', server_name: 'filesystem',
    tool_name: 'read', ts: Date.now(), input_tokens: 10, output_tokens: 20,
    cache_read_tokens: 0, cost_usd: 0, cost_is_estimated: 1, is_error: false,
    duration_ms: 50, ...overrides,
  };
}
```

Factories keep tests short. Override only what matters.

### Don't test implementation

```ts
// ❌ tests that `healthScore` multiplies by 0.30 — brittle if weights rebalance
expect(activationComponent).toBe(calls / 30 * 0.30);

// ✅ tests intent
it('gives essential servers a non-zero score even with low recent activity', () => {
  const server = serverFactory({ is_essential: true, calls_30d: 0 });
  expect(healthScore(server)).toBeGreaterThanOrEqual(50);
});
```

## Fixture pattern

`packages/core/fixtures/claude-code/compacted-session.jsonl` (real JSONL, anonymized):

```json
{"type":"assistant","message":{"id":"msg_1","content":[{"type":"tool_use","id":"toolu_1","name":"mcp__filesystem__read","input":{"path":"/work/README.md"}}]},"timestamp":"2026-03-14T10:00:00.000Z"}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"...","is_error":null}]},"timestamp":"2026-03-14T10:00:01.000Z"}
```

Companion `compacted-session.meta.json`:

```json
{
  "client": "claude-code",
  "version": "0.9.2",
  "recorded_at": "2026-03-14",
  "scenario": "compacted-session-is-error-null",
  "expected_call_count": 1,
  "expected_servers": ["filesystem"],
  "expected_edge_cases": ["is_error: null"]
}
```

The fixture runner iterates all files, asserts expectations from meta.

## Integration test pattern (DB)

```ts
import Database from 'better-sqlite3';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  runMigrations(db, resolve(__dirname, '../../migrations'), silentLogger);
  return db;
}

it('rolls up daily server stats on ingest', () => {
  const db = freshDb();
  const agg = createAggregator(db, fixedClock(day('2026-04-10T12:00:00Z')));
  agg.ingest([call({ server: 'filesystem' })]);
  const row = db.prepare('SELECT * FROM server_stats_daily WHERE server_name = ?').get('filesystem');
  expect(row).toMatchObject({ calls: 1, day: '2026-04-10' });
});
```

## Contract test pattern (Hono)

```ts
import { createApp } from '../src';

it('GET /api/servers returns list with empty array when no calls', async () => {
  const app = createApp({ db: freshDb(), clock: fixedClock(0), logger: silent });
  const res = await app.request('/api/servers');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});
```

No HTTP listener. Hono's `app.request()` is test-mode Fetch-style — fast, isolated.

## Playwright e2e

Minimal set (only the truly critical paths):

```ts
// tests-e2e/cli-smoke.spec.ts
import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';

test('cli scan then top produces non-empty output', () => {
  execSync('node packages/cli/dist/index.js scan --fixtures', { stdio: 'inherit' });
  const top = execSync('node packages/cli/dist/index.js top --json').toString();
  const json = JSON.parse(top);
  expect(Array.isArray(json)).toBe(true);
  expect(json.length).toBeGreaterThan(0);
});
```

Only run in CI. `pnpm test:e2e` separately invoked.

## Coverage policing

- PR CI fails if coverage drops for `packages/core` below 80/75.
- `packages/web` target is 60/50; UI testing has steep diminishing returns.
- Coverage isn't the goal — behavior coverage is. Every `if` branch should correspond to a test case that cares about that branch.

## Anti-patterns

- **Snapshot tests for UI.** Brittle, noisy, encourages nobody reading them.
- **Mocking `fs`, `better-sqlite3`, `fetch` at the unit level.** Instead, use in-memory DB, `:memory:` paths, `MSW`.
- **Shared state between tests.** Every test creates its own DB, its own factory rows.
- **Long-running tests as the default.** Keep individual tests under 100 ms. If it's slow, it's integration and lives in `integration/`.
- **Testing private functions** via `__tests__` exports. If it's worth testing, export it. If it's not worth exporting, it's not worth testing.

## Claude hints

- When asked to add a test, first find the behavior in the implementation and restate it in plain English. If you can't, the code is confused — refactor first.
- Reuse factories from `test/util/factories.ts`. Don't inline a fresh `McpCall` literal.
- When a fixture fails, update the `.meta.json` only if the expectation was wrong — never to silence a real regression.
