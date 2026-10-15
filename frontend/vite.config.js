import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The browser talks to http://localhost:5173/api/... and Vite forwards it to the
// backend on port 5000. If you change PORT in backend/.env, change the target below.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        // Video analysis can take several minutes, so do not cut the connection early.
        timeout: 330000,
        proxyTimeout: 330000,
      },
    },
  },
});