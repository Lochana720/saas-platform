import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin API in dev, so the httpOnly refresh cookie just works
    proxy: { '/api': 'http://localhost:4000' },
  },
});
