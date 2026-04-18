import cloudflare from '@astrojs/cloudflare';
import tailwind from '@astrojs/tailwind';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://mcpinsight.dev',
  output: 'server',
  adapter: cloudflare({
    mode: 'directory',
    // platformProxy makes locals.runtime.env available in `astro dev` via
    // miniflare, reading `.dev.vars` for local secrets (RESEND_API_KEY etc.).
    platformProxy: { enabled: true },
  }),
  integrations: [tailwind({ applyBaseStyles: true })],
  image: {
    // The Cloudflare adapter is not compatible with the Sharp image service.
    // We don't use <Image /> on the landing yet; fall back to the no-op service.
    service: { entrypoint: 'astro/assets/services/noop' },
  },
});
