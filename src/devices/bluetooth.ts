/**
 * Web Bluetooth devices (Chrome and Edge on desktop; not Safari or Firefox).
 * Protocol logic lives in `protocol/` and `ftmsTrainer.ts`; this file is only
 * the GATT plumbing: pick a device, find characteristics, subscribe, reconnect.
 */
import { FtmsTrainer, type FtmsTransport } from './ftmsTrainer';
import { CPS_MEASUREMENT, CPS_SERVICE, CrankCadence, parseCyclingPowerMeasurement } from './protocol/cps';
import {
  FTMS_CONTROL_POINT, FTMS_INDOOR_BIKE_DATA, FTMS_SERVICE, FTMS_STATUS, FTMS_SUPPORTED_POWER_RANGE,
  parseSupportedPowerRange, type PowerRange,
} from './protocol/ftms';
import { HRS_MEASUREMENT, HRS_SERVICE, parseHeartRateMeasurement } from './protocol/hrs';
import { parseRscMeasurement, RSC_MEASUREMENT, RSC_SERVICE } from './protocol/rsc';
import {
  FTMS_SUPPORTED_INCLINATION_RANGE, FTMS_SUPPORTED_SPEED_RANGE, FTMS_TREADMILL_DATA, parseSupportedInclinationRange,
  parseSupportedSpeedRange, type Range,
} from './protocol/treadmill';
import { FtmsTreadmill, type TreadmillTransport } from './ftmsTreadmill';
import {
  Emitter, type ConnectionState, type DeviceInfo, type HeartRateData, type HeartRateSource,
  type PowerData, type PowerSource, type RunData, type RunSource, type Unsubscribe,
} from './types';

/* Minimal structural types for the parts of Web Bluetooth we use, so no extra typings package is needed. */
export interface BtCharacteristic {
  value?: DataView | null;
  startNotifications(): Promise<unknown>;
  readValue(): Promise<DataView>;
  writeValueWithResponse?(value: Uint8Array): Promise<void>;
  writeValue?(value: Uint8Array): Promise<void>;
  addEventListener(type: 'characteristicvaluechanged', cb: (ev: { target: unknown }) => void): void;
  removeEventListener(type: 'characteristicvaluechanged', cb: (ev: { target: unknown }) => void): void;
}
export interface BtService {
  getCharacteristic(uuid: number): Promise<BtCharacteristic>;
}
export interface BtServer {
  connected: boolean;
  connect(): Promise<BtServer>;
  disconnect(): void;
  getPrimaryService(uuid: number): Promise<BtService>;
}
export interface BtDevice {
  id: string;
  name?: string | null;
  gatt?: BtServer | null;
  addEventListener(type: 'gattserverdisconnected', cb: () => void): void;
  removeEventListener(type: 'gattserverdisconnected', cb: () => void): void;
}
export interface BtRequestOptions {
  filters: { services: number[] }[];
  optionalServices?: number[];
}
export interface Bt {
  requestDevice(opts: BtRequestOptions): Promise<BtDevice>;
}

export class BluetoothUnavailableError extends Error {}

/** The browser's Bluetooth object, or a clear error explaining why there is none. */
export function getBluetooth(): Bt {
  const nav = (globalThis as { navigator?: { bluetooth?: Bt } }).navigator;
  if (!nav?.bluetooth) {
    throw new BluetoothUnavailableError(
      'Web Bluetooth is not available. Use Chrome or Edge on a desktop, over https or localhost, with Bluetooth switched on.');
  }
  return nav.bluetooth;
}

export function bluetoothSupported(): boolean {
  return !!(globalThis as { navigator?: { bluetooth?: unknown } }).navigator?.bluetooth;
}

function bytesOf(ev: { target: unknown }): Uint8Array | undefined {
  const dv = (ev.target as BtCharacteristic).value;
  if (!dv) return undefined;
  return new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength));
}

async function subscribe(ch: BtCharacteristic, cb: (bytes: Uint8Array) => void): Promise<Unsubscribe> {
  const handler = (ev: { target: unknown }) => {
    const b = bytesOf(ev);
    if (b) cb(b);
  };
  ch.addEventListener('characteristicvaluechanged', handler);
  await ch.startNotifications();
  return () => ch.removeEventListener('characteristicvaluechanged', handler);
}

export interface ReconnectOptions {
  /** Delays between reconnect attempts, ms. The last value repeats. */
  backoffMs?: number[];
  /** Give up after this many failed attempts (0 = never). */
  maxAttempts?: number;
  wait?: (ms: number) => Promise<void>;
}

/**
 * Keeps a GATT connection alive. `setup` runs after every successful connect
 * (first time and after each reconnect) to find characteristics and subscribe.
 */
export class BleLink {
  state: ConnectionState = 'disconnected';
  readonly states = new Emitter<ConnectionState>();
  private closed = false;
  private reconnecting = false;
  private readonly backoff: number[];
  private readonly maxAttempts: number;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly onDrop = () => { void this.handleDrop(); };

  constructor(readonly device: BtDevice, private readonly setup: (server: BtServer) => Promise<void>, opts: ReconnectOptions = {}) {
    this.backoff = opts.backoffMs ?? [500, 1000, 2000, 4000, 8000];
    this.maxAttempts = opts.maxAttempts ?? 0;
    this.wait = opts.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private set(state: ConnectionState): void {
    if (state === this.state) return;
    this.state = state;
    this.states.emit(state);
  }

  async connect(): Promise<void> {
    if (!this.device.gatt) throw new Error('This device has no GATT server');
    this.set('connecting');
    try {
      const server = await this.device.gatt.connect();
      await this.setup(server);
    } catch (e) {
      this.set('disconnected');
      throw e;
    }
    this.device.addEventListener('gattserverdisconnected', this.onDrop);
    this.set('connected');
  }

  private async handleDrop(): Promise<void> {
    if (this.closed || this.reconnecting) return;
    this.reconnecting = true;
    this.set('reconnecting');
    let attempt = 0;
    while (!this.closed) {
      await this.wait(this.backoff[Math.min(attempt, this.backoff.length - 1)]);
      if (this.closed) break;
      try {
        const server = await (this.device.gatt as BtServer).connect();
        await this.setup(server);
        this.reconnecting = false;
        this.set('connected');
        return;
      } catch {
        attempt++;
        if (this.maxAttempts && attempt >= this.maxAttempts) break;
      }
    }
    this.reconnecting = false;
    this.set('disconnected');
  }

  async close(): Promise<void> {
    this.closed = true;
    this.device.removeEventListener('gattserverdisconnected', this.onDrop);
    if (this.device.gatt?.connected) this.device.gatt.disconnect();
    this.set('disconnected');
  }
}

async function ftmsTransport(server: BtServer): Promise<FtmsTransport> {
  const service = await server.getPrimaryService(FTMS_SERVICE);
  const data = new Emitter<Uint8Array>();
  const cp = new Emitter<Uint8Array>();
  const status = new Emitter<Uint8Array>();
  const bike = await service.getCharacteristic(FTMS_INDOOR_BIKE_DATA);
  const control = await service.getCharacteristic(FTMS_CONTROL_POINT);
  await subscribe(bike, (b) => data.emit(b));
  // The control point answers with indications; startNotifications enables those too.
  await subscribe(control, (b) => cp.emit(b));
  try {
    await subscribe(await service.getCharacteristic(FTMS_STATUS), (b) => status.emit(b));
  } catch { /* status is optional on some trainers */ }
  let powerRange: PowerRange | undefined;
  try {
    powerRange = parseSupportedPowerRange(await (await service.getCharacteristic(FTMS_SUPPORTED_POWER_RANGE)).readValue());
  } catch { /* optional */ }
  return {
    powerRange,
    onIndoorBikeData: (cb) => data.on(cb),
    onControlPoint: (cb) => cp.on(cb),
    onStatus: (cb) => status.on(cb),
    async writeControlPoint(bytes) {
      if (control.writeValueWithResponse) await control.writeValueWithResponse(bytes);
      else if (control.writeValue) await control.writeValue(bytes);
      else throw new Error('The control point cannot be written');
    },
  };
}

/** A read-only power meter (or a trainer without FTMS) over the Cycling Power Service. */
export class BlePowerMeter implements PowerSource {
  readonly info: DeviceInfo;
  private readonly power = new Emitter<PowerData>();
  private readonly cadence = new CrankCadence();
  link!: BleLink;

  constructor(name: string) {
    this.info = { name, kind: 'bluetooth', protocol: 'Cycling Power Service (power only, no ERG)' };
  }

  async setup(server: BtServer): Promise<void> {
    const service = await server.getPrimaryService(CPS_SERVICE);
    this.cadence.reset();
    await subscribe(await service.getCharacteristic(CPS_MEASUREMENT), (b) => {
      const m = parseCyclingPowerMeasurement(b);
      const data: PowerData = { power: Math.max(0, m.power) };
      if (m.crankRevolutions !== undefined && m.crankEventTime !== undefined) {
        data.cadence = Math.round(this.cadence.update(m.crankRevolutions, m.crankEventTime));
      }
      this.power.emit(data);
    });
  }

  get state(): ConnectionState { return this.link.state; }
  onPower(cb: (d: PowerData) => void): Unsubscribe { return this.power.on(cb); }
  onState(cb: (s: ConnectionState) => void): Unsubscribe { return this.link.states.on(cb); }
  disconnect(): Promise<void> { return this.link.close(); }
}

/** A smart trainer over FTMS, with reconnect that restores control and the last target. */
export class BleTrainer extends FtmsTrainer {
  link!: BleLink;
  override async disconnect(): Promise<void> {
    await this.link.close();
    await super.disconnect();
  }
}

export interface TrainerConnection {
  source: PowerSource;
  /** Present when the device supports FTMS control (ERG). */
  trainer?: BleTrainer;
}

/**
 * Show the browser's device picker for trainers and power meters, then
 * connect. Prefers FTMS; falls back to the Cycling Power Service.
 * Must be called from a user gesture (a click), as Web Bluetooth requires.
 */
export async function connectTrainer(bt: Bt = getBluetooth(), opts: ReconnectOptions = {}): Promise<TrainerConnection> {
  const device = await bt.requestDevice({
    filters: [{ services: [FTMS_SERVICE] }, { services: [CPS_SERVICE] }],
    optionalServices: [FTMS_SERVICE, CPS_SERVICE],
  });
  const name = device.name || 'Bluetooth trainer';
  if (!device.gatt) throw new Error('This device has no GATT server');

  // Probe once to decide which protocol to use.
  let server = await device.gatt.connect();
  let hasFtms = true;
  try { await server.getPrimaryService(FTMS_SERVICE); } catch { hasFtms = false; }

  if (hasFtms) {
    let trainer: BleTrainer | undefined;
    const link = new BleLink(device, async (srv) => {
      server = srv;
      const transport = await ftmsTransport(srv);
      if (!trainer) trainer = new BleTrainer({ name, kind: 'bluetooth', protocol: 'FTMS (controllable)' }, transport);
      else await trainer.reattach(transport);
    }, opts);
    await link.connect();
    const t = trainer as unknown as BleTrainer;
    t.link = link;
    t.setState(link.state);
    link.states.on((s) => t.setState(s));
    return { source: t, trainer: t };
  }

  const meter = new BlePowerMeter(name);
  meter.link = new BleLink(device, (srv) => meter.setup(srv), opts);
  await meter.link.connect();
  return { source: meter };
}

/** A heart-rate strap, or a watch broadcasting heart rate, over the Heart Rate Service. */
export class BleHeartRate implements HeartRateSource {
  readonly info: DeviceInfo;
  private readonly hr = new Emitter<HeartRateData>();
  link!: BleLink;

  constructor(name: string) {
    this.info = { name, kind: 'bluetooth', protocol: 'Heart Rate Service' };
  }

  async setup(server: BtServer): Promise<void> {
    const service = await server.getPrimaryService(HRS_SERVICE);
    await subscribe(await service.getCharacteristic(HRS_MEASUREMENT), (b) => {
      const m = parseHeartRateMeasurement(b);
      // A strap that has lost skin contact reports rubbish; pass the flag on and let the game decide.
      this.hr.emit({ bpm: m.bpm, rr: m.rr.length ? m.rr : undefined, contact: m.contact });
    });
  }

  get state(): ConnectionState { return this.link.state; }
  onHeartRate(cb: (d: HeartRateData) => void): Unsubscribe { return this.hr.on(cb); }
  onState(cb: (s: ConnectionState) => void): Unsubscribe { return this.link.states.on(cb); }
  disconnect(): Promise<void> { return this.link.close(); }
}

/** Show the device picker for heart-rate sensors and connect. Call from a user gesture. */
export async function connectHeartRate(bt: Bt = getBluetooth(), opts: ReconnectOptions = {}): Promise<BleHeartRate> {
  const device = await bt.requestDevice({ filters: [{ services: [HRS_SERVICE] }] });
  const hr = new BleHeartRate(device.name || 'Heart-rate sensor');
  hr.link = new BleLink(device, (srv) => hr.setup(srv), opts);
  await hr.link.connect();
  return hr;
}

/* ---------- Running: treadmills and footpods ---------- */

async function treadmillTransport(server: BtServer): Promise<TreadmillTransport> {
  const service = await server.getPrimaryService(FTMS_SERVICE);
  const data = new Emitter<Uint8Array>();
  const cp = new Emitter<Uint8Array>();
  const status = new Emitter<Uint8Array>();
  await subscribe(await service.getCharacteristic(FTMS_TREADMILL_DATA), (b) => data.emit(b));
  let control: BtCharacteristic | undefined;
  try {
    control = await service.getCharacteristic(FTMS_CONTROL_POINT);
    await subscribe(control, (b) => cp.emit(b));
  } catch { control = undefined; /* a treadmill that only reports */ }
  try {
    await subscribe(await service.getCharacteristic(FTMS_STATUS), (b) => status.emit(b));
  } catch { /* optional */ }
  let speedRange: Range | undefined;
  let inclineRange: Range | undefined;
  try { speedRange = parseSupportedSpeedRange(await (await service.getCharacteristic(FTMS_SUPPORTED_SPEED_RANGE)).readValue()); } catch { /* optional */ }
  try { inclineRange = parseSupportedInclinationRange(await (await service.getCharacteristic(FTMS_SUPPORTED_INCLINATION_RANGE)).readValue()); } catch { /* optional */ }
  const t: TreadmillTransport = {
    speedRange, inclineRange,
    onTreadmillData: (cb) => data.on(cb),
    onControlPoint: (cb) => cp.on(cb),
    onStatus: (cb) => status.on(cb),
  };
  if (control) {
    const ch = control;
    t.writeControlPoint = async (bytes) => {
      if (ch.writeValueWithResponse) await ch.writeValueWithResponse(bytes);
      else if (ch.writeValue) await ch.writeValue(bytes);
      else throw new Error('The control point cannot be written');
    };
  }
  return t;
}

/** A treadmill over FTMS, with reconnect that restores control and targets (but never restarts a stopped belt). */
export class BleTreadmill extends FtmsTreadmill {
  link!: BleLink;
  override async disconnect(): Promise<void> {
    await this.link.close();
    await super.disconnect();
  }
}

/**
 * Show the device picker for treadmills and connect over FTMS. Must be
 * called from a user gesture. A treadmill without a control point connects
 * as read-only (`controllable` is false): the runner sets the speed by hand.
 */
export async function connectTreadmill(bt: Bt = getBluetooth(), opts: ReconnectOptions = {}): Promise<BleTreadmill> {
  const device = await bt.requestDevice({ filters: [{ services: [FTMS_SERVICE] }] });
  const name = device.name || 'Bluetooth treadmill';
  let treadmill: BleTreadmill | undefined;
  let probed = false;
  const link = new BleLink(device, async (srv) => {
    const transport = await treadmillTransport(srv);
    if (!treadmill) {
      treadmill = new BleTreadmill({ name, kind: 'bluetooth', protocol: transport.writeControlPoint ? 'FTMS treadmill (controllable)' : 'FTMS treadmill (read-only)' }, transport);
    } else await treadmill.reattach(transport);
    probed = true;
  }, opts);
  await link.connect();
  if (!probed || !treadmill) throw new Error('This device does not report treadmill data');
  const t = treadmill as BleTreadmill;
  t.link = link;
  t.setState(link.state);
  link.states.on((s) => t.setState(s));
  return t;
}

/**
 * A footpod over the Running Speed and Cadence Service, with running power
 * from the Cycling Power Service when the pod offers it (as Stryd does).
 */
export class BleFootpod implements RunSource {
  readonly info: DeviceInfo;
  private readonly run = new Emitter<RunData>();
  link!: BleLink;
  /** True once the pod has offered running power. */
  hasPower = false;

  constructor(name: string) {
    this.info = { name, kind: 'bluetooth', protocol: 'Running Speed and Cadence' };
  }

  async setup(server: BtServer): Promise<void> {
    const service = await server.getPrimaryService(RSC_SERVICE);
    await subscribe(await service.getCharacteristic(RSC_MEASUREMENT), (b) => {
      const m = parseRscMeasurement(b);
      this.run.emit({ speed: m.speed, cadence: m.cadence, distance: m.totalDistance });
    });
    try {
      const cps = await server.getPrimaryService(CPS_SERVICE);
      await subscribe(await cps.getCharacteristic(CPS_MEASUREMENT), (b) => {
        this.run.emit({ power: Math.max(0, parseCyclingPowerMeasurement(b).power) });
      });
      this.hasPower = true;
      (this.info as { protocol: string }).protocol = 'Running Speed and Cadence, with running power';
    } catch { /* most footpods have no power */ }
  }

  get state(): ConnectionState { return this.link.state; }
  onRun(cb: (d: RunData) => void): Unsubscribe { return this.run.on(cb); }
  onState(cb: (s: ConnectionState) => void): Unsubscribe { return this.link.states.on(cb); }
  disconnect(): Promise<void> { return this.link.close(); }
}

/** Show the device picker for footpods and connect. Call from a user gesture. */
export async function connectFootpod(bt: Bt = getBluetooth(), opts: ReconnectOptions = {}): Promise<BleFootpod> {
  const device = await bt.requestDevice({ filters: [{ services: [RSC_SERVICE] }], optionalServices: [CPS_SERVICE] });
  const pod = new BleFootpod(device.name || 'Footpod');
  pod.link = new BleLink(device, (srv) => pod.setup(srv), opts);
  await pod.link.connect();
  return pod;
}
