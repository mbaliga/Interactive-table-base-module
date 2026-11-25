import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const HUB = process.env.HUB_URL ?? 'http://localhost:8080';

export default defineConfig({
  // The hub serves the built pages under /phone/ (or they can be hosted publicly: set phoneUrl in hub.config.json).
  base: './',
  server: { host: '0.0.0.0', port: 5174, proxy: { '/api': HUB, '/proxy': HUB } },
  build: { outDir: resolve(__dirname, '../../dist/phone'), emptyOutDir: true, cssMinify: 'esbuild' },
});
