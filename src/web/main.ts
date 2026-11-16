import './ui.css';
import './ride/ride.css';
import { RideApp } from './ride/app';

const q = new URLSearchParams(location.search);
const root = document.getElementById('app') as HTMLElement;
const app = new RideApp(root, {
  chapter: q.get('chapter') ?? 'ch1',
  startAt: q.has('t') ? parseFloat(q.get('t') as string) : undefined,
  auto: q.has('auto'),
  rate: q.has('rate') ? parseFloat(q.get('rate') as string) : undefined,
  mute: q.has('mute'),
  noWorld: q.has('noworld'),
});
// Exposed for the headless smoke test and for poking at things from the console.
(window as unknown as { overreach: RideApp }).overreach = app;
app.init().catch((e) => {
  console.error(e);
  root.innerHTML = `<div class="wrap"><h1>Overreach Core</h1><p class="error">${e instanceof Error ? e.message : String(e)}</p></div>`;
});
