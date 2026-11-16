// Headless smoke-test helper: serves the production build and opens a page in Chromium.
// Usage: node tools/smoke.mjs <page> [seconds] [screenshot.png]
import { preview } from 'vite';
import { createRequire } from 'node:module';

// Playwright is not a project dependency: install it yourself (npm i -D playwright && npx playwright install chromium)
// or rely on a global install. `require` is used so a global install on NODE_PATH is found.
const { chromium } = createRequire(import.meta.url)('playwright');

const [page = 'index.html', seconds = '3', shot] = process.argv.slice(2);
const server = await preview({ preview: { port: 4179, strictPort: false }, logLevel: 'silent' });
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const problems = [];
p.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
p.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
await p.goto(base + page);
await p.waitForTimeout(Number(seconds) * 1000);
if (shot) await p.screenshot({ path: shot });
console.log(JSON.stringify({ title: await p.title(), problems }, null, 1));
await browser.close();
await server.close();
process.exit(problems.length ? 1 : 0);
