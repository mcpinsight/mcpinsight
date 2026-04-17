# Skill: Backend (Node 20 + TypeScript)

> Load this skill when working in `packages/core`, `packages/server`, `packages/cli`, or `packages/mcp-server`.

## Runtime and tooling

- **Node 20.11.1** LTS. Pinned via `.nvmrc`. No optional chaining on older runtimes.
- **TypeScript 5.4+**, `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- **Module system**: ESM only. `"type": "module"` in every `package.json`. Imports with explicit `.js` extension in source (Node ESM quirk).
- **Build**: `tsup` for the CLI + core. Dual output (`esm` only in Y1; add CJS if a user complains).
- **Runtime deps**: pinned exact (`save-exact=true` in `.npmrc`). Lockfile is the source of truth.

## Best practices

### Pure functions at the boundary

Parser reads text, returns a structured object. No side effects.

```ts
// ✅ good
export function parseClaudeCodeLine(line: string): Result<ClaudeCodeRawEvent, ParseError> {
  if (!line.trim()) return ok({ kind: 'empty' });
  try {
    const json = JSON.parse(line);
    return ok({ kind: 'event', data: json });
  } catch (err) {
    return err({ kind: 'malformed_json', line, cause: String(err) });
  }
}

// ❌ bad
export function parseClaudeCodeLine(line: string, db: Database): void {
  const data = JSON.parse(line); // will throw on malformed
  db.insert(data); // side effect inside parser
}
```

### `Result<T, E>` for expected failures

```ts
// packages/core/src/util/result.ts
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
export const ok  = <T>(value: T): Result<T, never>  => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
```

Reserve `throw` for bugs and unexpected states. Malformed JSONL is expected — that's a `Result`.

### Inject the clock

```ts
// packages/core/src/util/clock.ts
export interface Clock { now(): number }
export const systemClock: Clock = { now: () => Date.now() };
// in tests: const fakeClock: Clock = { now: () => 1700000000000 };
```

Any function that timestamps data takes a `clock: Clock` parameter.

### Structured logging

```ts
// packages/core/src/util/logger.ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}
```

One exported `createLogger()`. No `console.log` in library code. CLI commands may use `process.stdout` directly for user output (tables, prompts) — that's not logging.

### Hono server shape

```ts
// packages/server/src/index.ts
import { Hono } from 'hono';
export function createApp(deps: { db: Database; clock: Clock; logger: Logger }) {
  const app = new Hono();
  app.use(errorMiddleware(deps.logger));
  app.route('/api/servers', serversRoutes(deps));
  app.route('/api/clients', clientsRoutes(deps));
  return app;
}
```

Factory function. Dependencies injected. Testable without starting a server.

### Streaming file I/O

For large JSONL files, use `readline` with `createReadStream`, not `fs.readFileSync`.

```ts
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export async function* readJsonlLines(path: string, startByte = 0): AsyncGenerator<string> {
  const stream = createReadStream(path, { start: startByte, encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) yield line;
}
```

### Error hierarchy

```ts
// packages/core/src/util/errors.ts
export class UserFacingError extends Error {
  constructor(msg: string, public readonly hint?: string) { super(msg); }
}
export class ConfigError extends UserFacingError {}
export class NotFoundError extends UserFacingError {}
```

Server catches `UserFacingError` → 4xx with message; everything else → 500 with opaque message + logged stack.

## Anti-patterns (reject in review)

- `any`, `as any`, `@ts-ignore`, `@ts-expect-error` (without a linked issue and date).
- `new Date()` / `Date.now()` in business logic (inject clock).
- `async` functions that never `await` (they lie about their nature).
- Mutating input parameters.
- `default export` for library code (named exports only; defaults hide refactoring).
- Big files with "util" in the name — split by concept, not by generality.
- `JSON.parse` without try/catch.
- Inline SQL in route handlers (goes through `db/queries.ts`).

## Performance considerations

- **`better-sqlite3`** is synchronous and fast. Do not wrap it in `await Promise.resolve()` theater.
- Prepared statements cached via `db.prepare()` once, reused.
- Transactions for batch inserts (`db.transaction(() => { ... })()`).
- Parser target: 10k JSONL lines/s on a 2020 laptop. Measured via fixture benchmark.
- Hono local server p99 response time: <50 ms for cached queries, <200 ms for uncached.

## Testing requirements

- Every exported function in `packages/core`: unit test covering happy path + ≥1 edge case.
- Every SQL query in `db/queries.ts`: integration test against a fresh in-memory SQLite.
- Every Hono route: contract test using `app.request(...)` (no HTTP listener needed).
- Coverage target: 80% lines / 75% branches.

## Claude hints

When you write backend code, your first reflex should be:

1. What's the canonical type shape involved? → check `packages/core/src/types/canonical.ts`.
2. Is this a pure function or does it touch I/O? → they live in different folders.
3. What errors are *expected* here? → those go through `Result`, not `throw`.
4. What's the test I'd write first? → write it first.
