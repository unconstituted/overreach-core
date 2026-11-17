import './ui.css';
import './ride/ride.css';
import './menu/menu.css';
import { MenuApp } from './menu/app';
import { SCREENS } from './menu/screens';
import { RideApp } from './ride/app';

const q = new URLSearchParams(location.search);
const root = document.getElementById('app') as HTMLElement;
const fail = (e: unknown): void => {
  console.error(e);
  root.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'wrap';
  box.innerHTML = '<h1>Overreach</h1>';
  const p = document.createElement('p');
  p.className = 'error';
  p.textContent = e instanceof Error ? e.message : String(e);
  box.appendChild(p);
  root.appendChild(box);
};
const rate = q.has('rate') ? parseFloat(q.get('rate') as string) : undefined;

if (q.has('chapter') || q.has('auto')) {
  // Straight into one chapter, without menus or saved progress: for development and the headless ride check.
  const app = new RideApp(root, {
    chapter: q.get('chapter') ?? 'ch1',
    startAt: q.has('t') ? parseFloat(q.get('t') as string) : undefined,
    auto: q.has('auto'), rate, mute: q.has('mute'), noWorld: q.has('noworld'),
    sport: q.get('sport') === 'run' ? 'run' : undefined,
  });
  (window as unknown as { overreach: RideApp }).overreach = app;
  app.init().catch(fail);
} else {
  const today = q.get('today');
  const menu = new MenuApp(root, SCREENS, {
    today: today && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : undefined, rate, mute: q.has('mute'), noWorld: q.has('noworld'),
  });
  // Exposed for the headless checks and for poking at things from the console.
  (window as unknown as { menu: MenuApp }).menu = menu;
  menu.init().catch(fail);
}
