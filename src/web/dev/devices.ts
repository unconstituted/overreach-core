import '../ui.css';
import { DeviceManager } from '../../devices';
import { mountDevicePanel } from '../devicePanel';

/** Device test page: switch between Sim and Bluetooth, watch live data, drive ERG by hand. */
const devices = new DeviceManager({ ftp: 250 });
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

document.body.innerHTML = `
<div class="wrap">
  <div>
    <h1>Device test</h1>
    <p class="dim">Check a trainer and heart-rate strap before a ride. <a href="./index.html">Back to Overreach</a></p>
  </div>
  <div class="panel" id="devices"></div>
  <div class="panel">
    <h2>Live</h2>
    <div class="stats">
      <div class="stat"><span class="big" id="power">0</span><span class="unit">Watts</span></div>
      <div class="stat"><span class="big" id="cadence">0</span><span class="unit">Cadence rpm</span></div>
      <div class="stat"><span class="big" id="heart">–</span><span class="unit">Heart rate bpm</span></div>
      <div class="stat"><span class="big" id="target">–</span><span class="unit">ERG target</span></div>
    </div>
    <canvas class="trace" id="trace" width="940" height="160" aria-label="Power over the last two minutes"></canvas>
  </div>
  <div class="panel">
    <h2>Trainer control</h2>
    <div class="row">
      <button id="erg" class="on" aria-pressed="true">ERG on</button>
      <label class="grow">Target: <span id="ergValue">150 W</span>
        <input type="range" id="ergTarget" min="50" max="500" step="5" value="150">
      </label>
    </div>
    <p class="small dim" id="controlNote"></p>
  </div>
  <div class="panel" id="simPanel">
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

const sync = () => {
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
