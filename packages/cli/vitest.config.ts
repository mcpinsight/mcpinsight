import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    include: ['test/**/*.test.ts'],
    // better-sqlite3 native bindings segfault on teardown when vitest spawns
    // multiple worker threads that each import the same binary. Forks give
    // every test file its own process, matching one-file-per-DB usage.
    pool: 'forks',
  },
});
