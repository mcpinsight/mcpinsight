import { URL, fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Vite config for `@mcpinsight/web`. Builds a static SPA into `dist/` that the
 * Hono server (`packages/server` via `mcpinsight serve`) serves at the root.
 * Dev server runs on 5173; dev-mode fetches hit `VITE_API_BASE` (default
 * `http://127.0.0.1:3000`) — set it to the URL printed by `mcpinsight serve`.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
