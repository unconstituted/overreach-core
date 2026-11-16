// End-to-end check of a chapter in headless Chromium, against the production build.
// Usage: npm run build && node tools/ride-check.mjs [chapter] [rate]
//
// It rides the whole chapter with the simulated rider at accelerated time and checks:
//   - no console errors or exceptions
//   - seeking backwards and forwards works and fires no stale one-shots
//   - a rider who stops pedalling sees the ship slow while the story clock keeps running
//   - the end screen appears and the .fit decodes with an independent decoder
//
// Playwright is not a project dependency: install it (npm i -D playwright && npx playwright install chromium)
// or rely on a global install.
import { preview } from 'vite';
import { createRequire } from 'node:module';
import { Buffer } from 'node:buffer';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const FitParser = require('fit-file-parser').default ?? require('fit-file-parser');

const [chapter = 'ch1', rate = '30', fitOut] = process.argv.slice(2);
const server = await preview({ preview: { port: 4180, strictPort: false }, logLevel: 'silent' });
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) problems.push(what); };
const app = (fn, arg) => page.evaluate(`(${fn})(window.overreach, ${JSON.stringify(arg ?? null)})`);

if (chapter === 'ch1') {
/* ---- 1. real-time section: seeking and stop-pedalling ---- */
await page.goto(`${base}index.html?chapter=${chapter}&auto&mute&t=1100`);
await page.waitForFunction('window.overreach && window.overreach.started', null, { timeout: 60000 });
await page.waitForTimeout(6000);
const before = await app((a) => ({ T: a.T, factor: a.feel.state.speedFactor, power: a.devices.live.power, story: a.state.scene.speed }));
check(before.power > 50 && before.factor > 0.6, `simulated rider is pedalling (${Math.round(before.power)} W, speed factor ${before.factor.toFixed(2)})`);
await page.keyboard.press('p');
await page.waitForTimeout(7000);
const stopped = await app((a) => ({ T: a.T, factor: a.feel.state.speedFactor, power: a.devices.live.power, story: a.state.scene.speed }));
check(stopped.power < 10, `rider stopped pedalling (${Math.round(stopped.power)} W)`);
check(stopped.factor < 0.3, `the ship slows when the rider stops (speed factor ${stopped.factor.toFixed(2)})`);
check(stopped.T - before.T > 6, `the story keeps its pace (${(stopped.T - before.T).toFixed(1)} s of story in 7 s)`);
await page.keyboard.press('p');

await app((a) => a.seek(300));
await page.waitForTimeout(1500);
const back = await app((a) => ({ T: a.T, scene: a.state.scene.id }));
check(back.T > 300 && back.T < 304 && back.scene === 'tunnel', `seek backwards lands in the right scene (${back.T.toFixed(1)} s, ${back.scene})`);
await app((a) => a.seek(336));
await page.waitForTimeout(1200);
const mid = await app((a) => ({ T: a.T, active: a.state.dialogue.active.map((d) => [d.cue.clip, d.offset]) }));
check(mid.active.length > 0 && mid.active[0][1] > 1.5, `seeking into a line resumes it mid-clip (${JSON.stringify(mid.active)})`);
await page.keyboard.press('ArrowRight');
await page.keyboard.press(' ');
await page.waitForTimeout(600);
const paused = await app((a) => ({ T: a.T, playing: a.playing }));
await page.waitForTimeout(800);
const paused2 = await app((a) => ({ T: a.T }));
check(!paused.playing && paused2.T === paused.T, 'pause holds the story clock');
}

/* ---- 2. the whole chapter, accelerated ---- */
await page.goto(`${base}index.html?chapter=${chapter}&auto&mute&rate=${rate}`);
await page.waitForFunction('window.overreach && window.overreach.started', null, { timeout: 60000 });
const duration = await app((a) => a.rt.duration);
const started = Date.now();
await page.waitForFunction('window.overreach.finished', null, { timeout: (duration / Number(rate)) * 4000 + 120000, polling: 500 });
console.log(`rode ${duration} s of story in ${((Date.now() - started) / 1000).toFixed(0)} s`);
check(await page.locator('#end').count() === 1, 'end screen is shown');
check(await page.locator('#e-fit').count() === 1, 'Download .fit button is present');
const flags = await app((a) => a.state.flags);
if (Object.keys(flags).length) console.log(`story flags at the end: ${JSON.stringify(flags)}`);
const errors = await app((a) => a.errors);
check(errors.length === 0, `no errors in the frame loop${errors.length ? `: ${errors[0]}` : ''}`);

const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#e-fit')]);
check(/^overreach-.*\.fit$/.test(download.suggestedFilename()), `download is named ${download.suggestedFilename()}`);
const bytes = Buffer.from(await app((a) => Array.from(a.fitBytes())));
if (fitOut) writeFileSync(fitOut, bytes);
const parsed = await new Promise((resolve, reject) => new FitParser({ force: false }).parse(bytes, (err, data) => (err ? reject(err) : resolve(data))));
const summary = await app((a) => a.summary);
const session = parsed.sessions?.[0];
check(parsed.records.length >= duration - 2 && parsed.records.length <= duration + 1, `.fit has one record per second (${parsed.records.length})`);
check(!!session && Math.abs(session.total_timer_time - duration) < 3, `.fit session lasts ${session?.total_timer_time} s`);
check(Math.abs(session.avg_power - Math.round(summary.avgPower)) <= 1, `.fit average power ${session.avg_power} W matches the end screen`);
check(Math.abs(session.normalized_power - Math.round(summary.normalisedPower)) <= 1, `.fit normalised power ${session.normalized_power} W matches the end screen`);
check(parsed.laps.length >= 3, `.fit has a lap per workout step (${parsed.laps.length})`);
check(summary.avgPower > 100 && summary.maxHeartRate > 120, `the simulated rider did the workout (avg ${Math.round(summary.avgPower)} W, NP ${Math.round(summary.normalisedPower)} W, max HR ${Math.round(summary.maxHeartRate)})`);

check(problems.length === 0, 'no console errors');
if (problems.length) console.log(problems.map((p) => `  - ${p}`).join('\n'));
await browser.close();
await server.close();
process.exit(problems.length ? 1 : 0);
