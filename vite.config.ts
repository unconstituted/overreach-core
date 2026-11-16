import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
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
