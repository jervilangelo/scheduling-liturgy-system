import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Multi-page build: every physical *.html file in the project root is an
 * entry point. Adding a future module (e.g. kids-ministry.html) only requires
 * creating the file — no config change.
 */
const root = __dirname;
const pages = Object.fromEntries(
  readdirSync(root)
    .filter((f) => f.endsWith('.html'))
    .map((f) => [f.replace(/\.html$/, ''), resolve(root, f)]),
);

export default defineConfig({
  base: '/scheduling-liturgy-system/',
  plugins: [tailwindcss()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: { input: pages },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
