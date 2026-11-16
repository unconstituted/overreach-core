import { describe, expect, it } from 'vitest';
import {
  connectHeartRate, connectTrainer, DeviceManager, getBluetooth, SimFtmsPeripheral,
  type Bt, type BtCharacteristic, type BtDevice, type BtServer, type PowerData,
} from '../../src/devices';
import { encodeCyclingPowerMeasurement } from '../../src/devices/protocol/cps';
import { parseControlPointCommand } from '../../src/devices/protocol/ftms';
import { encodeHeartRateMeasurement } from '../../src/devices/protocol/hrs';

/**
 * A fake Web Bluetooth stack. It implements the same structural interface
 * the browser does, backed by the simulated FTMS peripheral, so the real
 * GATT plumbing (discovery, subscriptions, writes, reconnect) runs in tests.
 */
class FakeCharacteristic implements BtCharacteristic {
  value: DataView | null = null;
  notifying = false;
  private listeners = new Set<(ev: { target: unknown }) => void>();
  constructor(private onWrite?: (b: Uint8Array) => Promise<void>, private readBytes?: Uint8Array) {}
  async startNotifications() { this.notifying = true; }
  async readValue() { return new DataView((this.readBytes ?? new Uint8Array()).buffer); }
  async writeValueWithResponse(v: Uint8Array) { await this.onWrite?.(v); }
  addEventListener(_t: string, cb: (ev: { target: unknown }) => void) { this.listeners.add(cb); }
  removeEventListener(_t: string, cb: (ev: { target: unknown }) => void) { this.listeners.delete(cb); }
  push(bytes: Uint8Array) {
    if (!this.notifying) return;
    this.value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (const l of [...this.listeners]) l({ target: this });
  }
}

class FakeDevice implements BtDevice {
  id = 'fake';
  gatt: BtServer;
  connects = 0;
  failConnects = 0;
  private dropListeners = new Set<() => void>();
  chars = new Map<number, Map<number, FakeCharacteristic>>();
  constructor(public name: string) {
    this.gatt = {
      connected: false,
      connect: async () => {
        if (this.failConnects > 0) { this.failConnects--; throw new Error('out of range'); }
        this.connects++;
        this.gatt.connected = true;
        // A reconnect yields fresh characteristic objects with no subscriptions, as in the browser.
        for (const svc of this.chars.values()) for (const ch of svc.values()) ch.notifying = false;
        return this.gatt;
      },
      disconnect: () => { this.gatt.connected = false; },
      getPrimaryService: async (uuid: number) => {
        const svc = this.chars.get(uuid);
        if (!svc) throw new Error(`No service 0x${uuid.toString(16)}`);
        return { getCharacteristic: async (c: number) => {
          const ch = svc.get(c);
          if (!ch) throw new Error(`No characteristic 0x${c.toString(16)}`);
          return ch;
        } };
      },
    };
  }
  addEventListener(_t: string, cb: () => void) { this.dropListeners.add(cb); }
  removeEventListener(_t: string, cb: () => void) { this.dropListeners.delete(cb); }
  drop() {
    this.gatt.connected = false;
    for (const l of [...this.dropListeners]) l();
  }
}

function fakeFtmsDevice() {
  const sim = new SimFtmsPeripheral({ seed: 1 });
  const dev = new FakeDevice('KICKR CORE 1234');
  const bike = new FakeCharacteristic();
  const control = new FakeCharacteristic((b) => sim.writeControlPoint(b));
  const status = new FakeCharacteristic();
  const range = new FakeCharacteristic(undefined, new Uint8Array([0x00, 0x00, 0xd0, 0x07, 0x01, 0x00]));
  sim.onIndoorBikeData((b) => bike.push(b));
  sim.onControlPoint((b) => control.push(b));
  sim.onStatus((b) => status.push(b));
  dev.chars.set(0x1826, new Map([[0x2ad2, bike], [0x2ad9, control], [0x2ada, status], [0x2ad8, range]]));
  return { sim, dev };
}

const btFor = (dev: BtDevice, seen?: unknown[]): Bt => ({
  requestDevice: async (opts) => { seen?.push(opts); return dev; },
});
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

describe('Bluetooth trainer over FTMS', () => {
  it('asks the browser for FTMS or Cycling Power devices', async () => {
    const { dev } = fakeFtmsDevice();
    const seen: unknown[] = [];
    await connectTrainer(btFor(dev, seen));
    expect(seen[0]).toEqual({
      filters: [{ services: [0x1826] }, { services: [0x1818] }],
      optionalServices: [0x1826, 0x1818],
    });
  });

  it('connects, receives power and controls ERG', async () => {
    const { sim, dev } = fakeFtmsDevice();
    const conn = await connectTrainer(btFor(dev));
    expect(conn.trainer).toBeDefined();
    expect(conn.source.info).toMatchObject({ name: 'KICKR CORE 1234', kind: 'bluetooth' });
    expect(conn.source.state).toBe('connected');
    const got: PowerData[] = [];
    conn.source.onPower((d) => got.push(d));
    await conn.trainer!.setTargetPower(230);
    expect(sim.mode).toBe('erg');
    expect(sim.targetPower).toBe(230);
    sim.tick(30);
    expect(got.length).toBeGreaterThan(100);
    expect(got[got.length - 1].power).toBeGreaterThan(215);
    expect(got[got.length - 1].power).toBeLessThan(245);
  });

  it('reconnects after a drop and restores control and the last target', async () => {
    const { sim, dev } = fakeFtmsDevice();
    const conn = await connectTrainer(btFor(dev), { backoffMs: [0], wait: async () => undefined });
    const states: string[] = [];
    conn.source.onState((s) => states.push(s));
    await conn.trainer!.setTargetPower(200);
    const writesBefore = sim.writes.length;

    // The trainer loses power for a moment: it forgets control and its target.
    sim.hasControl = false;
    sim.mode = 'none';
    dev.failConnects = 2; // the first two reconnect attempts fail
    dev.drop();
    await flush();
    await flush();
    expect(states).toEqual(['reconnecting', 'connected']);
    expect(dev.connects).toBe(3); // probe, first connect, successful reconnect
    const after = sim.writes.slice(writesBefore).map((w) => parseControlPointCommand(w));
    expect(after).toEqual([{ op: 'requestControl' }, { op: 'setTargetPower', watts: 200 }]);
    expect(sim.mode).toBe('erg');

    // Data flows again on the new subscription.
    const got: PowerData[] = [];
    conn.source.onPower((d) => got.push(d));
    sim.tick(2);
    expect(got.length).toBeGreaterThan(0);
  });

  it('stops reconnecting once the user disconnects', async () => {
    const { dev } = fakeFtmsDevice();
    const conn = await connectTrainer(btFor(dev), { backoffMs: [0], wait: async () => undefined });
    await conn.source.disconnect();
    const before = dev.connects;
    dev.drop();
    await flush();
    expect(dev.connects).toBe(before);
    expect(conn.source.state).toBe('disconnected');
  });

  it('gives up after the configured number of attempts', async () => {
    const { dev } = fakeFtmsDevice();
    const conn = await connectTrainer(btFor(dev), { backoffMs: [0], maxAttempts: 3, wait: async () => undefined });
    dev.failConnects = 99;
    dev.drop();
    await flush();
    expect(conn.source.state).toBe('disconnected');
  });
});

describe('Cycling Power fallback', () => {
  it('uses the Cycling Power Service when the device has no FTMS, as a read-only source', async () => {
    const dev = new FakeDevice('Assioma DUO');
    const meas = new FakeCharacteristic();
    dev.chars.set(0x1818, new Map([[0x2a63, meas]]));
    const conn = await connectTrainer(btFor(dev));
    expect(conn.trainer).toBeUndefined();
    expect(conn.source.info.protocol).toMatch(/Cycling Power/);
    const got: PowerData[] = [];
    conn.source.onPower((d) => got.push(d));
    // 90 rpm: one revolution every 2/3 s = 683 ticks of 1/1024 s
    meas.push(encodeCyclingPowerMeasurement({ power: 250, crankRevolutions: 10, crankEventTime: 0 }));
    meas.push(encodeCyclingPowerMeasurement({ power: 255, crankRevolutions: 13, crankEventTime: 2048 }));
    expect(got).toEqual([{ power: 250, cadence: 0 }, { power: 255, cadence: 90 }]);
  });
});

describe('Bluetooth heart rate', () => {
  it('connects to a strap (or a broadcasting watch) and reports heart rate', async () => {
    const dev = new FakeDevice('Forerunner 965');
    const meas = new FakeCharacteristic();
    dev.chars.set(0x180d, new Map([[0x2a37, meas]]));
    const seen: unknown[] = [];
    const hr = await connectHeartRate(btFor(dev, seen));
    expect(seen[0]).toEqual({ filters: [{ services: [0x180d] }] });
    const got: number[] = [];
    hr.onHeartRate((d) => got.push(d.bpm));
    meas.push(encodeHeartRateMeasurement({ bpm: 142 }));
    meas.push(encodeHeartRateMeasurement({ bpm: 143, contact: true, rr: [0.42] }));
    expect(got).toEqual([142, 143]);
    expect(hr.info.name).toBe('Forerunner 965');
  });
});

describe('DeviceManager: switching between Sim and Bluetooth', () => {
  it('switches sources and keeps live data flowing', async () => {
    const m = new DeviceManager({ seed: 1 });
    const sim = await m.useSimTrainer();
    expect(m.summary().power).toMatchObject({ kind: 'sim', controllable: true });
    expect(m.summary().heart).toMatchObject({ kind: 'sim' });
    m.applyTarget(200, true);
    await flush();
    for (let i = 0; i < 300; i++) m.tick(0.1);
    expect(m.live.power).toBeGreaterThan(185);
    expect(m.live.heartRate).toBeGreaterThan(100);

    const { sim: remote, dev } = fakeFtmsDevice();
    await m.connectBluetoothTrainer(btFor(dev));
    expect(m.summary().power).toMatchObject({ kind: 'bluetooth', controllable: true, name: 'KICKR CORE 1234' });
    expect(sim.state).toBe('disconnected');
    expect(m.live.power).toBe(0);
    m.applyTarget(180, true);
    await flush();
    expect(remote.targetPower).toBe(180);
    remote.tick(20);
    expect(m.live.power).toBeGreaterThan(165);

    // Out of ERG the trainer is switched to flat-road simulation.
    m.applyTarget(300, false);
    await flush();
    expect(remote.mode).toBe('sim');

    await m.useSimTrainer();
    expect(m.summary().power?.kind).toBe('sim');
  });

  it('zeroes stale readings from a Bluetooth device that has gone quiet', async () => {
    const m = new DeviceManager();
    const { sim: remote, dev } = fakeFtmsDevice();
    await m.connectBluetoothTrainer(btFor(dev));
    remote.follow = 200;
    remote.tick(20);
    expect(m.live.power).toBeGreaterThan(100);
    for (let i = 0; i < 50; i++) m.tick(0.1); // five seconds with no packets
    expect(m.live.power).toBe(0);
  });
});

describe('Web Bluetooth availability', () => {
  it('explains what to do when the browser has no Bluetooth', () => {
    expect(() => getBluetooth()).toThrow(/Chrome or Edge/);
  });
});
