import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The API runs on :4000. Proxying keeps the browser on one origin, which also works
// from a phone on the LAN (it only needs to reach the Vite port).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/playsync/',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:4000',
      '/socket.io': { target: 'http://127.0.0.1:4000', ws: true },
    },
  },
});
