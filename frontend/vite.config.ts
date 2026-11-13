import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: '../internal/server/web/dist', emptyOutDir: true },
  server: { proxy: { '/admin': 'http://127.0.0.1:10087', '/health': 'http://127.0.0.1:10087' } },
});
