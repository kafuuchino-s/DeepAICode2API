import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Isolated fixture server: no production proxy and no reloads from other workspaces.
export default defineConfig({ plugins: [react()], server: { hmr: false } });
