import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig({
  plugins: [
    {
      name: 'copilotkit-headless-styles',
      enforce: 'pre',
      load(id) {
        if (id.endsWith('/@copilotkit/react-core/dist/v2/index.css')) return '';
      }
    },
    react()
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    server: {
      deps: {
        inline: ['@copilotkit/react-core']
      }
    }
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  }
});
