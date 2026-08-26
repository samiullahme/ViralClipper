// vite.config.mjs — Vite bundler config for the React renderer.
// Builds the renderer into dist/ which the Electron main process loads.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base so the built index.html works from file:// inside Electron.
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Split vendor chunks so pages lazy-load fast on low-end machines.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
