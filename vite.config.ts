import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Vite app lives in ./client; the Express JSON API runs on :8080.
// In dev, /api is proxied to the API server (same-origin model, like ReturnSignal).
export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist', // → client/dist (served by the API server in production)
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Split heavy deps into their own chunks (ReturnSignal lazy-loads Plotly).
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
