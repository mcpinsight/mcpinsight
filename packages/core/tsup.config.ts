import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/types/canonical.ts',
    'src/normalizers/types.ts',
    'src/parsers/claude-code.ts',
    'src/normalizers/claude-code.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  splitting: false,
});
