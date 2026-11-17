import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { writeCatalogue } from './tools/content';

const TYPES: Record<string, string> = {
  '.json': 'application/json', '.zwo': 'application/xml', '.fit': 'application/octet-stream',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg',
};

/**
 * Content is data: `content/` is indexed into a catalogue, served as-is at
 * /content/ in development, and copied beside the build. Nothing in it is bundled.
 */
function contentPlugin(): Plugin {
  const root = resolve('content');
  const rebuild = (log: (m: string) => void) => {
    try { writeCatalogue('.'); } catch (e) { log((e as Error).message); return false; }
    return true;
  };
  return {
    name: 'overreach-content',
    buildStart() {
      // A broken reference fails a production build outright.
      if (process.env.VITEST) return;
      writeCatalogue('.');
    },
    configureServer(server) {
      server.watcher.add(root);
      server.watcher.on('all', (_event, file) => {
        if (file.startsWith(root) && !file.endsWith('catalogue.json') && rebuild((m) => server.config.logger.error(m))) {
          server.ws.send({ type: 'full-reload' });
        }
      });
      server.middlewares.use('/content', (req, res, next) => {
        const rel = normalize(decodeURIComponent((req.url ?? '').split('?')[0])).replace(/^([/\\]|\.\.)+/, '');
        const file = join(root, rel);
        if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) return next();
        const ext = file.slice(file.lastIndexOf('.'));
        res.setHeader('Content-Type', TYPES[ext] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      if (process.env.VITEST || !existsSync('dist')) return;
      cpSync(root, join('dist', 'content'), { recursive: true });
    },
  };
}

export default defineConfig({
  base: './',
  // Chapters are data: they are served as-is and fetched at run time, never bundled.
  publicDir: 'chapters',
  plugins: [contentPlugin()],
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
