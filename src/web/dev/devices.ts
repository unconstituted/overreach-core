import '../ui.css';
import { DeviceManager } from '../../devices';
import { formatPace } from '../../core/workout';
import { mountDevicePanel } from '../devicePanel';

/**
 * Device test page: switch between Sim and Bluetooth, watch live data, drive
 * ERG (or the treadmill's speed and incline) by hand.
 */
const devices = new DeviceManager({ ftp: 250, thresholdSpeed: 1000 / 300 });
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

document.body.innerHTML = `
<div class="wrap">
  <div>
    <h1>Device test</h1>
    <p class="dim">Check a trainer, treadmill, footpod or heart-rate strap before a session. <a href="./index.html">Back to Overreach</a></p>
  </div>
  <div class="panel" id="devices"></div>
  <div class="panel" data-bike>
    <h2>Live</h2>
    <div class="stats">
      <div class="stat"><span class="big" id="power">0</span><span class="unit">Watts</span></div>
      <div class="stat"><span class="big" id="cadence">0</span><span class="unit">Cadence rpm</span></div>
      <div class="stat"><span class="big" id="heart">–</span><span class="unit">Heart rate bpm</span></div>
      <div class="stat"><span class="big" id="target">–</span><span class="unit">ERG target</span></div>
    </div>
    <canvas class="trace" id="trace" width="940" height="160" aria-label="Power over the last two minutes"></canvas>
  </div>
  <div class="panel" data-run hidden>
    <h2>Live</h2>
    <div class="stats">
      <div class="stat"><span class="big" id="rspeed">0.0</span><span class="unit">Speed km/h</span></div>
      <div class="stat"><span class="big" id="rpace">–:––</span><span class="unit">Pace /km</span></div>
      <div class="stat"><span class="big" id="rincline">0.0</span><span class="unit">Incline %</span></div>
      <div class="stat"><span class="big" id="rcad">0</span><span class="unit">Cadence spm</span></div>
      <div class="stat"><span class="big" id="rpower">–</span><span class="unit">Running power W</span></div>
      <div class="stat"><span class="big" id="rheart">–</span><span class="unit">Heart rate bpm</span></div>
    </div>
  </div>
  <div class="panel" data-run hidden>
    <h2>Treadmill control</h2>
    <p class="small dim">Keep the safety key on and the stop button in reach. The page never restarts a belt you have stopped: press Carry on first.</p>
    <div class="row">
      <button id="belt">Start belt</button>
      <button id="carry" hidden>Carry on</button>
      <label class="grow">Speed: <span id="tspeedValue">8.0 km/h</span>
        <input type="range" id="tspeed" min="2" max="20" step="0.1" value="8"></label>
      <label class="grow">Incline: <span id="tinclineValue">0.0%</span>
        <input type="range" id="tincline" min="0" max="10" step="0.5" value="0"></label>
    </div>
    <p class="small dim" id="tnote"></p>
  </div>
  <div class="panel" id="runPanel" data-run hidden>
    <h2>Simulated runner</h2>
    <div class="row">
      <button id="running" class="on" aria-pressed="true">Running</button>
      <span class="small dim">Stopping is the runner pressing the treadmill's stop button.</span>
    </div>
  </div>
  <div class="panel" data-bike>
    <h2>Trainer control</h2>
    <div class="row">
      <button id="erg" class="on" aria-pressed="true">ERG on</button>
      <label class="grow">Target: <span id="ergValue">150 W</span>
        <input type="range" id="ergTarget" min="50" max="500" step="5" value="150">
      </label>
    </div>
    <p class="small dim" id="controlNote"></p>
  </div>
  <div class="panel" id="simPanel" data-bike>
    <h2>Simulated rider</h2>
    <div class="row">
      <button id="pedal" class="on" aria-pressed="true">Pedalling</button>
      <button id="follow" class="on" aria-pressed="true">Following the target</button>
      <label class="grow">Manual power: <span id="overrideValue">200 W</span>
        <input type="range" id="override" min="0" max="800" step="5" value="200">
      </label>
    </div>
    <p class="small dim"><kbd>↑</kbd> <kbd>↓</kbd> change manual power by 10 W · <kbd>Space</kbd> stop or start pedalling · <kbd>F</kbd> follow the target again</p>
  </div>
</div>`;

mountDevicePanel($('devices'), devices);

let erg = true;
let ergTarget = 150;
let manual: number | null = null;
let pedalling = true;

let belt = false;
let tspeed = 8;
let tincline = 0;
let running = true;

const sync = () => {
  const run = devices.sport === 'run';
  document.querySelectorAll<HTMLElement>('[data-run]').forEach((el) => { el.hidden = !run; });
  document.querySelectorAll<HTMLElement>('[data-bike]').forEach((el) => { el.hidden = run; });
  $('runPanel').hidden = !run || !devices.simTreadmill;
  const stopped = !!devices.treadmill?.stoppedByRunner;
  if (stopped) belt = false;
  $('belt').textContent = belt ? 'Stop belt' : 'Start belt';
  $('belt').classList.toggle('on', belt);
  ($('belt') as HTMLButtonElement).disabled = stopped || !devices.treadmill?.controllable;
  $('carry').hidden = !stopped;
  $('tspeedValue').textContent = `${tspeed.toFixed(1)} km/h (${formatPace(tspeed / 3.6)} /km)`;
  $('tinclineValue').textContent = `${tincline.toFixed(1)}%`;
  $('running').textContent = running ? 'Running' : 'Stopped';
  $('running').classList.toggle('on', running);
  $('tnote').textContent = !devices.belt ? 'No treadmill: speed comes from the footpod.'
    : stopped ? 'You stopped the belt. Press Carry on, then Start belt.'
      : devices.treadmill?.controllable ? '' : 'This treadmill only reports; set the speed on its console.';
  devices.simTreadmill?.setRunning(running);
  $('erg').classList.toggle('on', erg);
  $('erg').textContent = erg ? 'ERG on' : 'ERG off';
  $('erg').setAttribute('aria-pressed', String(erg));
  $('ergValue').textContent = `${ergTarget} W`;
  $('pedal').classList.toggle('on', pedalling);
  $('pedal').textContent = pedalling ? 'Pedalling' : 'Stopped';
  $('pedal').setAttribute('aria-pressed', String(pedalling));
  $('follow').classList.toggle('on', manual === null);
  $('follow').setAttribute('aria-pressed', String(manual === null));
  $('overrideValue').textContent = `${manual ?? Number(($('override') as HTMLInputElement).value)} W`;
  $('simPanel').hidden = !devices.simTrainer;
  $('controlNote').textContent = devices.trainer
    ? 'With ERG off the trainer simulates a flat road and the target is only a guide.'
    : 'This power source cannot be controlled (no FTMS), so there is no ERG.';
  devices.simTrainer?.setOverride(manual);
  devices.simTrainer?.setPedalling(pedalling);
};

$('erg').onclick = () => { erg = !erg; sync(); };
$('belt').onclick = () => {
  belt = !belt;
  if (!belt) void devices.stopBelt(false);
  sync();
};
$('carry').onclick = () => { devices.resumeBelt(); sync(); };
($('tspeed') as HTMLInputElement).oninput = (e) => { tspeed = Number((e.target as HTMLInputElement).value); sync(); };
($('tincline') as HTMLInputElement).oninput = (e) => { tincline = Number((e.target as HTMLInputElement).value); sync(); };
$('running').onclick = () => { running = !running; sync(); };
($('ergTarget') as HTMLInputElement).oninput = (e) => { ergTarget = Number((e.target as HTMLInputElement).value); sync(); };
$('pedal').onclick = () => { pedalling = !pedalling; sync(); };
$('follow').onclick = () => { manual = null; sync(); };
($('override') as HTMLInputElement).oninput = (e) => { manual = Number((e.target as HTMLInputElement).value); sync(); };
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  const slider = $('override') as HTMLInputElement;
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    manual = Math.max(0, Math.min(800, (manual ?? Math.round(devices.live.power / 10) * 10) + (e.key === 'ArrowUp' ? 10 : -10)));
    slider.value = String(manual);
    e.preventDefault();
  } else if (e.key === ' ') { pedalling = !pedalling; e.preventDefault(); }
  else if (e.key === 'f' || e.key === 'F') manual = null;
  else return;
  sync();
});
devices.changed.on(sync);

const trace: { p: number; t: number }[] = [];
const canvas = $('trace') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
let last = performance.now();
let sinceSample = 0;

function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (devices.sport === 'run') {
    if (belt) devices.applyRunTarget(tspeed / 3.6, tincline);
    else devices.simTreadmill?.setRunnerTarget(tspeed / 3.6);
    devices.tick(dt);
    const l = devices.live;
    $('rspeed').textContent = (l.speed * 3.6).toFixed(1);
    $('rpace').textContent = formatPace(l.speed);
    $('rincline').textContent = l.incline.toFixed(1);
    $('rcad').textContent = String(Math.round(l.cadence));
    $('rpower').textContent = l.power ? String(Math.round(l.power)) : '–';
    $('rheart').textContent = l.heartRate ? String(Math.round(l.heartRate)) : '–';
    requestAnimationFrame(frame);
    return;
  }
  devices.applyTarget(ergTarget, erg);
  devices.tick(dt);
  $('power').textContent = String(Math.round(devices.live.power));
  $('cadence').textContent = String(Math.round(devices.live.cadence));
  $('heart').textContent = devices.live.heartRate ? String(Math.round(devices.live.heartRate)) : '–';
  $('target').textContent = erg && devices.trainer ? String(ergTarget) : '–';
  sinceSample += dt;
  if (sinceSample >= 0.25) {
    sinceSample = 0;
    trace.push({ p: devices.live.power, t: ergTarget });
    if (trace.length > 480) trace.shift();
    const w = canvas.width;
    const h = canvas.height;
    const max = Math.max(300, ...trace.map((s) => Math.max(s.p, s.t))) * 1.1;
    ctx.clearRect(0, 0, w, h);
    const line = (key: 'p' | 't', colour: string, width: number) => {
      ctx.beginPath();
      trace.forEach((s, i) => {
        const x = (i / 479) * w;
        const y = h - (s[key] / max) * h;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    line('t', 'rgba(255,180,84,0.7)', 1);
    line('p', '#7fe9ff', 2);
  }
  requestAnimationFrame(frame);
}

void devices.useSimTrainer().then(() => { sync(); requestAnimationFrame(frame); });
