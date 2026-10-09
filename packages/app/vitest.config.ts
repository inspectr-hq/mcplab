import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    pool: 'vmThreads',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}']
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      // Match the browser export used by Vite, including in VM test workers.
      '@inspectr/mcplab-core': path.resolve(import.meta.dirname, '../core/src/browser.ts')
    }
  }
});
