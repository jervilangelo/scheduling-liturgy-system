import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/scheduling-liturgy-system/',
  plugins: [tailwindcss()],
  build: { outDir: 'dist', sourcemap: false },
  server: { port: 5173 },
  preview: { port: 4173 },
});
