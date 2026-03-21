import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: __dirname,
  plugins: [preact(), tailwindcss()],
  build: {
    outDir: '../dist/ui',
    emptyOutDir: true,
  },
  server: {
    port: 5180,
    // During UI development the admin API runs separately on 4100.
    proxy: { '/api': 'http://127.0.0.1:4100' },
  },
});
