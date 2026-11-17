// End-to-end check of the menus in headless Chromium, against the production build.
// Usage: npm run build && node tools/menu-check.mjs
//
// Walks: Home → Plans → start a plan → today's session → ride (accelerated) → post-ride shows the
// session completed and the plan advanced → a settings change persists after reload. Also checks
// missed-session handling on a later day, a free ride on a map, ride history and .fit re-download,
// export and import, and that a plan added purely as data shows up in the menus.
import { preview } from 'vite';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const RATE = process.argv[2] ?? '40';
const server = await preview({ preview: { port: 4190, strictPort: false }, logLevel: 'silent' });
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) problems.push(what); };
const url = (today, hash = '#/home') => `${base}index.html?mute&rate=${RATE}&today=${today}${hash}`;
const ready = () => page.waitForFunction('window.menu && window.menu.player && document.querySelector("#screen").dataset.screen', null, { timeout: 30000 });
const screen = (name) => page.waitForFunction(`document.querySelector("#screen").dataset.screen === "${name}"`, null, { timeout: 15000 });
// textContent, not innerText: CSS upper-casing must not change what we compare.
const text = async (sel) => (await page.locator(sel).first().textContent()) ?? '';

/* ---- Home → Plans → start a plan ---- */
await page.goto(url('2026-11-16'));
await ready();
check((await text('#today')).includes('No plan running'), 'Home starts with no plan');
await page.click('nav a[href="#/plans"]');
await screen('plans');
check(await page.locator('.card[data-id]').count() >= 3, 'Plans lists the shipped plans');
await page.selectOption('select[data-filter="weeks"]', '2');
check(await page.locator('.card[data-id]').count() === 1 && await page.locator('.card[data-id="shakedown-week"]').count() === 1, 'the length filter narrows the list');
await page.click('.card[data-id="shakedown-week"]');
await page.waitForSelector('#plan-start-btn');
check(await page.locator('#calendar .chip').count() === 3, 'plan detail shows a calendar with its three sessions');
await page.click('#plan-start-btn');
await page.waitForSelector('#plan-pause');
check((await text('#plan-controls')).includes('0 of 3 sessions done'), 'the plan is now active');

/* ---- today's session → ride → post-ride ---- */
await page.click('nav a[href="#/home"]');
await screen('home');
check((await text('#today')).includes('Dock Spin'), 'Home shows today\'s session');
await page.click('#today a[data-ride]');
await page.waitForSelector('#ride-start');
check((await text('#screen')).includes('Dock Spin') && await page.locator('#pre-devices').count() === 1, 'pre-ride shows the workout and the devices');
await page.click('#ride-start');
await page.waitForFunction('window.menu.riding && window.menu.riding.started', null, { timeout: 60000 });
await page.waitForTimeout(1500);
const mid = await page.evaluate(() => ({ T: window.menu.riding.T, power: window.menu.devices.live.power, hud: !!document.querySelector('#hud'), errors: window.menu.riding.errors }));
check(mid.hud && mid.power > 30 && mid.errors.length === 0, `the workout is riding (${Math.round(mid.power)} W at ${Math.round(mid.T)} s)`);
await page.waitForSelector('#post-ride', { timeout: (1800 / Number(RATE)) * 4000 + 90000 });
check((await text('#post-ride')).includes('Workout complete'), 'post-ride screen appears when the workout ends');
check((await text('#post-session')).includes('Session complete: Dock Spin'), 'post-ride shows the session completed');
check((await text('#post-plan-progress')).includes('1 of 3 sessions done'), 'post-ride shows the plan advanced');
check(await page.locator('#ride').count() === 0 && await page.locator('canvas').count() === 0, 'the ride view is torn down afterwards');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#post-fit')]);
check(/\.fit$/.test(dl.suggestedFilename()), `post-ride offers the .fit (${dl.suggestedFilename()})`);
await page.click('#post-home');
await screen('home');
check((await text('#today')).includes('1 of 3 sessions done') && (await text('#today')).includes('Rest day'), 'Home now shows the session done and nothing else today');

/* ---- settings persist across a reload ---- */
await page.click('nav a[href="#/settings"]');
await screen('settings');
check(await page.locator('.setting').count() >= 25 && await page.locator('section[data-category]').count() === 8, 'Settings is generated from the table, in eight categories');
await page.selectOption('#set-hud-position', 'bot');
await page.waitForFunction('window.menu.player.settings["hud.position"] === "bot"');
await page.fill('#set-ftp', '262');
await page.locator('#set-ftp').blur();
await page.waitForFunction('window.menu.player.profile.ftp === 262');
await page.selectOption('#set-feel-preset', 'aggressive');
await page.waitForFunction('window.menu.player.settings["feel.punch"] === 1.6');
await page.reload();
await ready();
const kept = await page.evaluate(() => ({ pos: window.menu.player.settings['hud.position'], ftp: window.menu.player.profile.ftp, feel: window.menu.player.settings['feel.preset'], rides: window.menu.player.history.length, plan: window.menu.player.progress.activePlan?.plan }));
check(kept.pos === 'bot' && kept.ftp === 262 && kept.feel === 'aggressive', `settings persist after a reload (${JSON.stringify(kept)})`);
check(kept.rides === 1 && kept.plan === 'shakedown-week', 'the ride and the plan persist after a reload');
check(await page.locator('#set-hud-position').inputValue() === 'bot', 'the settings screen shows the saved value');
await page.click('button[data-reset="HUD"]');
await page.waitForFunction('window.menu.player.settings["hud.position"] === "top"');
check(true, 'reset to defaults works per category');

/* ---- a later day: the missed session is pushed ---- */
await page.goto(url('2026-11-19'));
await ready();
const today = await text('#today');
check(today.includes('Long Haul') && (await page.locator('#missed-note').count()) === 1, 'three days on, the missed session has been pushed to today, with a note saying so');
await page.click('nav a[href="#/plans"]');
await screen('plans');
await page.click('.card[data-id="shakedown-week"]');
await page.waitForSelector('#calendar');
check(await page.locator('.chip.done').count() === 1 && await page.locator('.day.is-today .chip').count() === 1, 'the calendar shows one session done and the moved one on today');

/* ---- season, workouts, maps ---- */
await page.click('nav a[href="#/season"]');
await screen('season');
check(await page.locator('li[data-chapter="ch1"] a.button').count() === 1 && await page.locator('li[data-chapter="test-clamp"].is-locked').count() === 1, 'Season shows Chapter 1 open and the next chapter locked');

/* ---- a story chapter from the menus: completion, flags, unlocks, and the plan session ridden early ---- */
await page.click('li[data-chapter="ch1"] a.button');
await page.waitForSelector('#ride-start');
await page.click('#ride-start');
await page.waitForFunction('window.menu.riding && window.menu.riding.started', null, { timeout: 60000 });
await page.waitForSelector('#post-ride', { timeout: (2100 / Number(RATE)) * 4000 + 120000 });
const chapterPost = await text('#post-ride');
check(chapterPost.includes('Chapter complete'), 'Chapter 1 rides to the end from the menus');
check((await text('#post-unlocked')).includes('Terror Flats') && (await page.locator('#post-unlocked a').count()) === 2, 'post-ride lists what the chapter unlocked (a map and the next chapter)');
check((await text('#post-session')).includes('The Disaster') && (await text('#post-plan-progress')).includes('2 of 3'), 'riding Saturday\'s chapter early counts for the plan');
await page.click('nav a[href="#/season"]');
await screen('season');
check(await page.locator('li[data-chapter="ch1"].done').count() === 1 && await page.locator('li[data-chapter="test-clamp"] a.button').count() === 1, 'Season now shows Chapter 1 complete and the next chapter open');

await page.click('nav a[href="#/workouts"]');
await screen('workouts');
check(await page.locator('.card[data-id]').count() >= 12 && await page.locator('.card svg.graph').count() >= 12, 'Workouts lists the library with a power graph each');
await page.selectOption('select[data-filter="focus"]', 'vo2');
check(await page.locator('.card[data-id]').count() === 2, 'the focus filter works');
await page.click('nav a[href="#/maps"]');
await screen('maps');
check(await page.locator('a.card[data-id="meridian-approach"]').count() === 1 && await page.locator('a.card[data-id="terror-flats"]').count() === 1 && await page.locator('div.card.is-locked').count() === 1, 'Maps shows two open maps and one locked with the reason');

/* ---- free ride on a map ---- */
await page.click('a.card[data-id="meridian-approach"]');
await page.waitForSelector('#ride-start');
await page.click('#ride-start');
await page.waitForFunction('window.menu.riding && window.menu.riding.started', null, { timeout: 60000 });
await page.waitForFunction('window.menu.riding.freeRide.distance > 1500', null, { timeout: 120000 });
const free = await page.evaluate(() => ({ d: window.menu.riding.freeRide.distance, v: window.menu.riding.freeRide.speed, nav: document.querySelector('#nav').textContent, scene: window.menu.riding.state.scene.id }));
check(free.v > 5 && free.v < 14 && /TO GO/.test(free.nav) && free.scene === 'space', `free ride: the rider's power moves the ship (${free.v.toFixed(1)} m/s, "${free.nav}")`);
await page.evaluate(() => window.menu.riding.finish());
await page.waitForSelector('#post-ride');
const post = await text('#post-ride');
check(post.includes('Ride ended early') && post.includes('Free rides do not count'), 'ending a free ride early is recorded, and does not count for the plan');

/* ---- profile, history, .fit, export and import ---- */
await page.click('nav a[href="#/profile"]');
await screen('profile');
check(await page.locator('table.rides tbody tr').count() === 3, 'Profile lists all three rides');
const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.locator('button[data-fit]').last().click()]);
check(/\.fit$/.test(dl2.suggestedFilename()), 'an old ride\'s .fit can be downloaded again');
const round = await page.evaluate(async () => {
  const m = window.menu;
  const before = JSON.stringify(m.player);
  const json = await m.store.exportAll(m.player, 'x');
  const fits = Object.keys(JSON.parse(json).fits).length;
  await m.store.clear();
  const empty = (await m.store.load()).fresh;
  const back = await m.store.importAll(json);
  const fit = await m.store.getFit(back.history[0].id);
  return { same: JSON.stringify(back) === before, fits, empty, fitBytes: fit ? fit.length : 0 };
});
check(round.same && round.fits === 3 && round.empty && round.fitBytes > 1000, `export, erase and import restores everything (${JSON.stringify(round)})`);

/* ---- content added as data appears without code changes ---- */
await page.route('**/content/catalogue.json', async (route) => {
  const res = await route.fetch();
  const cat = await res.json();
  cat.entries.push({ type: 'plan', id: 'dropped-in', title: 'Dropped-In Plan', path: 'content/plans/dropped-in.plan.json', description: 'Added as a file.', sport: 'bike', level: 'advanced', goal: 'Prove the point', hoursPerWeek: [1, 2], weeks: 1, style: 'calendar', sessions: 1 });
  await route.fulfill({ response: res, json: cat });
});
await page.route('**/content/plans/dropped-in.plan.json', (route) => route.fulfill({
  json: { format: 1, id: 'dropped-in', title: 'Dropped-In Plan', description: 'Added as a file.', sport: 'bike', level: 'advanced', goal: 'Prove the point', hoursPerWeek: [1, 2], style: 'calendar', weeks: [{ days: [{ day: 2, sessions: [{ ref: 'workout:scramble' }] }] }] },
}));
await page.goto(url('2026-11-19', '#/plans'));
await page.reload(); // the address differs only by its hash, which alone would not refetch the catalogue
await ready();
check(await page.locator('.card[data-id="dropped-in"]').count() === 1, 'a plan that exists only as data appears in the Plans list');
await page.click('.card[data-id="dropped-in"]');
await page.waitForSelector('#calendar');
check((await text('#calendar')).includes('Scramble'), 'and its detail page renders its sessions');

check(problems.length === 0, 'no console errors');
if (problems.length) console.log(problems.map((p) => `  - ${p}`).join('\n'));
await browser.close();
await server.close();
process.exit(problems.length ? 1 : 0);
