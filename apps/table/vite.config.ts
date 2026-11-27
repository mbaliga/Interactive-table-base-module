import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const HUB = process.env.HUB_URL ?? 'http://localhost:8080';

export default defineConfig({
  // Relative asset URLs: the hub serves the built app under /table/, the dev server at /.
  base: './',
  server: {
    host: '0.0.0.0', port: 5173,
    // Dev: the table talks to a locally running hub (`pnpm hub`) for the QR code, data proxies and TUIO.
    proxy: {
      '/api': HUB,
      '/proxy': HUB,
      '/phone': HUB,
      '/tuio': { target: HUB.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    outDir: resolve(__dirname, '../../dist/table'),
    emptyOutDir: true,
    // lightningcss (the default) drops the unprefixed backdrop-filter, which Chrome needs for blurred panels.
    cssMinify: 'esbuild',
    // input-debug.html: raw touches and objects on a plain surface, for calibrating a new table (docs/HARDWARE.md)
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), 'input-debug': resolve(__dirname, 'input-debug.html') } },
  },
});
