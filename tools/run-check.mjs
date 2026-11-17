// End-to-end check of running in headless Chromium, against the production build.
// Usage: npm run build && node tools/run-check.mjs [rate]
//
// 1. Chapter 1 as a run, in real time: pace on the visor, the simulated treadmill following the
//    workout, the runner pressing stop (the ride pauses and the belt stays stopped until play),
//    then resuming.
// 2. Through the menus: start the Ground Crew plan, run today's session (accelerated), and check
//    the post-run screen, the history and the .fit (decoded as a treadmill run).
// 3. Chapter 1 run start to finish, accelerated: no errors, a .fit that decodes as a run.
// Playwright is not a project dependency: install it or rely on a global install.
import { preview } from 'vite';
import { createRequire } from 'node:module';
import { Buffer } from 'node:buffer';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const FitParser = require('fit-file-parser').default ?? require('fit-file-parser');

const RATE = process.argv[2] ?? '40';
const server = await preview({ preview: { port: 4195, strictPort: false }, logLevel: 'silent' });
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const problems = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) problems.push(what); };
const newPage = async () => {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return page;
};
const decode = (bytes) => new Promise((res, rej) => new FitParser({ force: false, speedUnit: 'm/s', lengthUnit: 'm' }).parse(Buffer.from(bytes), (e, d) => (e ? rej(e) : res(d))));

/* ---- 1. real time: pace, treadmill control, the runner stopping ---- */
{
  const page = await newPage();
  const app = (fn) => page.evaluate(`(${fn})(window.overreach)`);
  await page.goto(`${base}index.html?chapter=ch1&auto&mute&sport=run&t=1180`);
  await page.waitForFunction('window.overreach && window.overreach.started', null, { timeout: 60000 });
  await page.waitForTimeout(14000);
  const a = await app((o) => ({
    sport: o.sport, speed: o.devices.live.speed, target: o.state.workout.targetSpeed, kind: o.state.workout.targetKind,
    cad: o.devices.live.cadence, pace: document.getElementById('pwn').textContent, unit: document.getElementById('pwu').textContent,
    cadu: document.getElementById('cadu').textContent, controlled: o.devices.simTreadmill.peripheral.controlled,
  }));
  check(a.sport === 'run' && a.kind === 'pace', `Chapter 1 runs with pace targets (${a.kind})`);
  check(a.controlled && Math.abs(a.speed - a.target) < 0.25, `the treadmill follows the workout (${a.speed.toFixed(2)} m/s for a ${a.target?.toFixed(2)} m/s target)`);
  check(/^\d+:\d\d$/.test(a.pace) && a.unit === '/KM', `the hero number is pace (${a.pace} ${a.unit})`);
  check(a.cadu === 'SPM' && a.cad > 140, `cadence is steps per minute (${Math.round(a.cad)})`);
  await page.keyboard.press('p'); // the simulated runner presses stop
  await page.waitForTimeout(4000);
  const b = await app((o) => ({ playing: o.playing, stopped: o.devices.treadmill.stoppedByRunner, T: o.T, flash: document.getElementById('ct').textContent }));
  await page.waitForTimeout(4000);
  const c = await app((o) => ({ T: o.T, speed: o.devices.live.speed, writes: o.devices.simTreadmill.peripheral.writes.length }));
  check(!b.playing && b.stopped, 'the runner pressing stop pauses the run');
  check(c.T === b.T && c.speed === 0, `the belt stays stopped and the story waits (speed ${c.speed})`);
  check(/BELT STOPPED/i.test(b.flash), `the visor says what happened (${b.flash})`);
  await page.keyboard.press('p'); // back on the belt
  await page.keyboard.press(' '); // and play
  await page.waitForTimeout(12000);
  const d = await app((o) => ({ playing: o.playing, speed: o.devices.live.speed, stopped: o.devices.treadmill.stoppedByRunner }));
  check(d.playing && !d.stopped && d.speed > 2, `pressing play carries on and the belt starts again (${d.speed.toFixed(2)} m/s)`);
  await page.screenshot({ path: process.env.RUN_SHOT ?? '/tmp/run-check.png' }).catch(() => undefined);
  await page.context().close();
}

/* ---- 2. the menus: a running plan ---- */
{
  const page = await newPage();
  const url = (hash) => `${base}index.html?mute&rate=${RATE}&today=2026-11-16${hash}`;
  await page.goto(url('#/plans/ground-crew'));
  await page.waitForSelector('#plan-start-btn', { timeout: 30000 });
  await page.click('#plan-start-btn');
  await page.waitForFunction('window.menu.activePlan', null, { timeout: 15000 });
  await page.goto(url('#/ride/workout:deck-run'));
  await page.waitForSelector('#ride-start', { timeout: 30000 });
  await page.waitForFunction('document.querySelector("#ride-start").textContent === "Start run"', null, { timeout: 10000 });
  const panel = await page.evaluate(() => ({
    bikeHidden: document.querySelector('[data-for="bike"]').hidden, sportsHidden: document.querySelector('[data-sports]').hidden,
  }));
  check(panel.bikeHidden && panel.sportsHidden, 'a pace workout can only be run: the bike rows and the sport switch are hidden');
  await page.click('#ride-start');
  await page.waitForFunction('document.querySelector("#screen").dataset.screen === "done"', null, { timeout: 300000, polling: 500 });
  const done = await page.evaluate(() => ({
    title: document.querySelector('#post-ride h2').textContent, session: document.querySelector('#post-session')?.textContent ?? '',
    stats: document.querySelector('#post-ride .stats').textContent, rec: window.menu.player.history[0],
  }));
  check(/Run summary/.test(done.title), `the post-run screen says run (${done.title})`);
  check(/Average pace/.test(done.stats) && /spm/.test(done.stats), 'it shows pace and cadence, not power');
  check(/Deck Run/.test(done.session), `the plan session is marked done (${done.session})`);
  check(done.rec.sport === 'run' && done.rec.distance > 5000, `history records a run (${done.rec.distance} m)`);
  const fit = await page.evaluate(async () => Array.from(await window.menu.store.getFit(window.menu.player.history[0].id)));
  const parsed = await decode(fit);
  check(parsed.sessions[0].sport === 'running' && parsed.sessions[0].sub_sport === 'treadmill', 'its .fit decodes as a treadmill run');
  // Chapter 1 from the menus offers both, starting on the player's usual sport.
  await page.goto(url('#/ride/chapter:ch1'));
  await page.waitForSelector('#ride-start');
  const sportsShown = await page.evaluate(() => !document.querySelector('[data-sports]').hidden);
  check(sportsShown, 'a chapter offers Ride or Run');
  await page.context().close();
}

/* ---- 3. Chapter 1 as a run, start to finish ---- */
{
  const page = await newPage();
  await page.goto(`${base}index.html?chapter=ch1&auto&mute&sport=run&rate=${RATE}`);
  await page.waitForFunction('window.overreach && window.overreach.started', null, { timeout: 60000 });
  await page.waitForFunction('window.overreach.finished', null, { timeout: 600000, polling: 500 });
  const r = await page.evaluate(() => ({ errors: window.overreach.errors, summary: window.overreach.summary, end: !!document.getElementById('end') }));
  check(r.errors.length === 0, `no errors in the frame loop${r.errors.length ? `: ${r.errors[0]}` : ''}`);
  check(r.end && r.summary.sport === 'run', 'the end screen shows a run');
  const fit = await page.evaluate(() => Array.from(window.overreach.fitBytes()));
  const parsed = await decode(fit);
  const s = parsed.sessions[0];
  check(s.sport === 'running' && Math.abs(s.total_timer_time - 2100) < 3, `the .fit is a 35-minute run (${s.total_timer_time} s)`);
  check(s.total_distance > 5000 && s.total_distance < 12000, `with a believable distance (${Math.round(s.total_distance)} m)`);
  check(parsed.records[100].cadence > 70 && parsed.records[100].cadence < 100, `and cadence in strides per minute (${parsed.records[100].cadence})`);
  await page.context().close();
}

check(problems.filter((p) => p.startsWith('console') || p.startsWith('pageerror')).length === 0, 'no console errors');
if (problems.length) console.log(problems.map((p) => `  - ${p}`).join('\n'));
await browser.close();
await server.close();
process.exit(problems.length ? 1 : 0);
