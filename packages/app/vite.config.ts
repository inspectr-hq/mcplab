import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: '::',
    port: 8685,
    hmr: {
      overlay: false
    }
  },
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
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
}));
