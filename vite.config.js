import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: process.env.NODE_ENV === 'production' ? '/nvidia-nim-model-benchmark/' : '/',
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/results.json': 'http://localhost:3000',
      '/models.json': 'http://localhost:3000',
    },
  },
});
