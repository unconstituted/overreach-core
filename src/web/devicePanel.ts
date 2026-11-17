import { bluetoothSupported, type DeviceManager, type DeviceSport } from '../devices';

export interface DevicePanelOptions {
  /** Which sports this session can be done as. Default: both. A pace workout is run-only, for example. */
  sports?: DeviceSport[];
  /** Told when the player switches sport. */
  onSport?(sport: DeviceSport): void;
  /** The sport to start on (the player's usual one). */
  initial?: DeviceSport;
}

type Row = { name: string; protocol: string; state: string; kind?: string } | undefined;

/**
 * The device picker: bike or run, then the trainer (or treadmill and
 * footpod) and a heart-rate source. Used by the screen before a ride, the
 * direct start screen and the device test page.
 */
export function mountDevicePanel(root: HTMLElement, devices: DeviceManager, opts: DevicePanelOptions = {}): () => void {
  const sports = opts.sports ?? ['bike', 'run'];
  root.innerHTML = `
    <h2>Devices</h2>
    <div class="row" data-sports>
      <div class="grow">Session</div>
      <button data-act="sport-bike">Ride</button>
      <button data-act="sport-run">Run</button>
    </div>
    <div class="row" data-for="bike">
      <div class="grow">
        <div>Trainer or power meter</div>
        <div class="status"><span class="dot" data-dot="power"></span><span data-status="power" class="dim"></span></div>
      </div>
      <button data-act="sim-power">Simulated rider</button>
      <button data-act="bt-power">Bluetooth…</button>
    </div>
    <div class="row" data-for="run">
      <div class="grow">
        <div>Treadmill</div>
        <div class="status"><span class="dot" data-dot="belt"></span><span data-status="belt" class="dim"></span></div>
      </div>
      <button data-act="sim-belt">Simulated runner</button>
      <button data-act="bt-belt">Bluetooth…</button>
      <button data-act="no-belt">None</button>
    </div>
    <div class="row" data-for="run">
      <div class="grow">
        <div>Footpod</div>
        <div class="status"><span class="dot" data-dot="pod"></span><span data-status="pod" class="dim"></span></div>
      </div>
      <button data-act="bt-pod">Bluetooth…</button>
    </div>
    <div class="row">
      <div class="grow">
        <div>Heart rate</div>
        <div class="status"><span class="dot" data-dot="heart"></span><span data-status="heart" class="dim"></span></div>
      </div>
      <button data-act="sim-heart">Simulated</button>
      <button data-act="bt-heart">Bluetooth…</button>
      <button data-act="no-heart">None</button>
    </div>
    <p class="error" data-error hidden></p>
    <p class="small dim" data-note></p>`;

  const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const errorEl = q<HTMLElement>('[data-error]');
  const note = q<HTMLElement>('[data-note]');
  const btOk = bluetoothSupported();
  for (const a of ['bt-power', 'bt-heart', 'bt-belt', 'bt-pod']) q<HTMLButtonElement>(`[data-act="${a}"]`).disabled = !btOk;
  q('[data-sports]').hidden = sports.length < 2;

  const render = () => {
    const s = devices.summary();
    const run = s.sport === 'run';
    root.querySelectorAll<HTMLElement>('[data-for]').forEach((el) => { el.hidden = el.dataset.for !== s.sport; });
    const set = (key: string, d: Row, empty: string, extra = '') => {
      q(`[data-dot="${key}"]`).className = `dot ${d ? d.state : ''}`;
      q(`[data-status="${key}"]`).textContent = d ? `${d.name} · ${d.protocol} · ${d.state}${extra}` : empty;
    };
    set('power', s.power, 'Nothing connected');
    set('belt', s.belt, 'No treadmill: speed comes from the footpod',
      s.belt?.stoppedByRunner ? ' · stopped by you' : s.belt && !s.belt.controllable ? ' · you set the speed' : '');
    set('pod', s.pod, s.belt ? 'No footpod: no cadence' : 'Nothing connected');
    set('heart', s.heart, 'No heart-rate source');
    const on = (act: string, v: boolean) => q(`[data-act="${act}"]`).classList.toggle('on', v);
    on('sport-bike', !run);
    on('sport-run', run);
    on('sim-power', s.power?.kind === 'sim');
    on('bt-power', s.power?.kind === 'bluetooth');
    on('sim-belt', s.belt?.kind === 'sim');
    on('bt-belt', s.belt?.kind === 'bluetooth');
    on('no-belt', run && !s.belt);
    on('bt-pod', s.pod?.kind === 'bluetooth');
    on('sim-heart', s.heart?.kind === 'sim');
    on('bt-heart', s.heart?.kind === 'bluetooth');
    on('no-heart', !s.heart);
    note.textContent = !btOk
      ? 'Bluetooth needs Chrome or Edge on a desktop computer. The simulated rider and runner work everywhere.'
      : run
        ? 'Bluetooth: close other apps connected to the treadmill or footpod first. Keep the treadmill\'s stop button and safety key within reach: the game never restarts a belt you have stopped.'
        : 'Bluetooth: wake your trainer, close other apps connected to it (a trainer talks to one app at a time), then choose it in the browser\'s list.';
  };

  const act = async (fn: () => Promise<unknown>) => {
    errorEl.hidden = true;
    try {
      await fn();
    } catch (e) {
      const err = e as Error;
      // Closing the browser's picker is not an error worth showing.
      if (err.name !== 'NotFoundError') {
        errorEl.textContent = err.message || String(e);
        errorEl.hidden = false;
      }
    }
    render();
  };

  const sport = async (s: DeviceSport) => {
    if (!sports.includes(s)) return;
    if (s === 'run') { if (devices.sport !== 'run' || !devices.belt && !devices.pod) await devices.useSimTreadmill(); }
    else if (devices.sport !== 'bike' || !devices.power) await devices.useSimTrainer();
    opts.onSport?.(s);
  };

  const onClick = (ev: Event) => {
    const a = (ev.target as HTMLElement).closest('button')?.dataset.act;
    if (a === 'sport-bike') void act(() => sport('bike'));
    else if (a === 'sport-run') void act(() => sport('run'));
    else if (a === 'sim-power') void act(() => devices.useSimTrainer());
    else if (a === 'bt-power') void act(() => devices.connectBluetoothTrainer());
    else if (a === 'sim-belt') void act(() => devices.useSimTreadmill());
    else if (a === 'bt-belt') void act(() => devices.connectBluetoothTreadmill());
    else if (a === 'no-belt') void act(() => devices.removeTreadmill());
    else if (a === 'bt-pod') void act(() => devices.connectBluetoothFootpod());
    else if (a === 'sim-heart') void act(() => devices.useSimHeart());
    else if (a === 'bt-heart') void act(() => devices.connectBluetoothHeart());
    else if (a === 'no-heart') void act(() => devices.removeHeart());
  };
  root.addEventListener('click', onClick);
  const off = devices.changed.on(render);
  // Start on the only sport allowed, or the player's usual one.
  const first = sports.length === 1 ? sports[0] : opts.initial;
  if (first) {
    if (devices.sport !== first) void act(() => sport(first));
    else opts.onSport?.(first);
  }
  render();
  return () => { root.removeEventListener('click', onClick); off(); };
}
