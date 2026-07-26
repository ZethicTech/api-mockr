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
});
