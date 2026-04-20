import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import path from 'path';

export default defineConfig({
  site: 'https://mcplab.inspectr.dev',
  output: 'static',
  trailingSlash: 'always',
  redirects: {
    '/docs/configuration/': '/docs/cli/configuration/',
    '/docs/usage/': '/docs/cli/running-evaluations/',
    '/docs/app-mode/': '/docs/app/getting-started/',
  },
  integrations: [react(), tailwind(), sitemap()],
  server: {
    host: '::',
    port: 8558,
  },
  vite: {
    resolve: {
      alias: {
        '@': path.resolve('./src'),
      },
    },
  },
});
