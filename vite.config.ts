import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  // Chapters are data: they are served as-is and fetched at run time, never bundled.
  publicDir: 'chapters',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: { input: { main: 'index.html', devices: 'devices.html' } },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
