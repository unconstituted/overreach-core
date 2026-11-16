import { bluetoothSupported, type DeviceManager } from '../devices';

/**
 * The device picker: choose the simulated rider or a Bluetooth trainer, and a
 * heart-rate source. Used by the start screen and the device test page.
 */
export function mountDevicePanel(root: HTMLElement, devices: DeviceManager): () => void {
  root.innerHTML = `
    <h2>Devices</h2>
    <div class="row">
      <div class="grow">
        <div>Trainer or power meter</div>
        <div class="status"><span class="dot" data-dot="power"></span><span data-status="power" class="dim"></span></div>
      </div>
      <button data-act="sim-power">Simulated rider</button>
      <button data-act="bt-power">Bluetooth…</button>
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
  note.textContent = btOk
    ? 'Bluetooth: wake your trainer, close other apps connected to it (a trainer talks to one app at a time), then choose it in the browser\'s list.'
    : 'Bluetooth needs Chrome or Edge on a desktop computer. The simulated rider works everywhere.';
  q<HTMLButtonElement>('[data-act="bt-power"]').disabled = !btOk;
  q<HTMLButtonElement>('[data-act="bt-heart"]').disabled = !btOk;

  const render = () => {
    const s = devices.summary();
    const set = (key: 'power' | 'heart', d?: { name: string; protocol: string; state: string }) => {
      q(`[data-dot="${key}"]`).className = `dot ${d ? d.state : ''}`;
      q(`[data-status="${key}"]`).textContent = d
        ? `${d.name} · ${d.protocol} · ${d.state}`
        : key === 'heart' ? 'No heart-rate source' : 'Nothing connected';
    };
    set('power', s.power);
    set('heart', s.heart);
    q('[data-act="sim-power"]').classList.toggle('on', s.power?.kind === 'sim');
    q('[data-act="bt-power"]').classList.toggle('on', s.power?.kind === 'bluetooth');
    q('[data-act="sim-heart"]').classList.toggle('on', s.heart?.kind === 'sim');
    q('[data-act="bt-heart"]').classList.toggle('on', s.heart?.kind === 'bluetooth');
    q('[data-act="no-heart"]').classList.toggle('on', !s.heart);
  };

  const run = async (fn: () => Promise<unknown>) => {
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

  const onClick = (ev: Event) => {
    const act = (ev.target as HTMLElement).closest('button')?.dataset.act;
    if (act === 'sim-power') void run(() => devices.useSimTrainer());
    else if (act === 'bt-power') void run(() => devices.connectBluetoothTrainer());
    else if (act === 'sim-heart') void run(() => devices.useSimHeart());
    else if (act === 'bt-heart') void run(() => devices.connectBluetoothHeart());
    else if (act === 'no-heart') void run(() => devices.removeHeart());
  };
  root.addEventListener('click', onClick);
  const off = devices.changed.on(render);
  render();
  return () => { root.removeEventListener('click', onClick); off(); };
}
