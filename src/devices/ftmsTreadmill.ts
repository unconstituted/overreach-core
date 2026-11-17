import {
  encodeRequestControl, encodeReset, encodeStart, encodeStop, parseControlPointResponse, parseMachineStatus,
  type MachineStatus,
} from './protocol/ftms';
import {
  encodeSetTargetInclination, encodeSetTargetSpeed, parseTreadmillData, type Range,
} from './protocol/treadmill';
import { FtmsError } from './ftmsTrainer';
import {
  Emitter, type ConnectionState, type ControllableTreadmill, type DeviceInfo, type RunData, type Unsubscribe,
} from './types';

/** The byte-level link to an FTMS treadmill. Web Bluetooth and the simulator each provide one. */
export interface TreadmillTransport {
  /** Absent when the treadmill has no control point (it only reports). */
  writeControlPoint?(bytes: Uint8Array): Promise<void>;
  onTreadmillData(cb: (bytes: Uint8Array) => void): Unsubscribe;
  onControlPoint(cb: (bytes: Uint8Array) => void): Unsubscribe;
  onStatus(cb: (bytes: Uint8Array) => void): Unsubscribe;
  /** km/h */
  speedRange?: Range;
  /** percent */
  inclineRange?: Range;
}

export interface TreadmillLimits {
  /** The fastest speed the engine will ever ask for, m/s, whatever the workout says. Default 20 km/h. */
  maxSpeed: number;
  /** The steepest incline the engine will ask for, percent. Default 10. */
  maxIncline: number;
}

export const DEFAULT_TREADMILL_LIMITS: TreadmillLimits = { maxSpeed: 20 / 3.6, maxIncline: 10 };

type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void };

/**
 * FTMS treadmill control: request control, start the belt, send speed and
 * incline targets, match responses, parse data.
 *
 * Safety comes first. Targets are clamped to the treadmill's own range and to
 * `limits`. When the treadmill reports that it was stopped (the runner pressed
 * stop, or pulled the safety key), `stoppedByRunner` is set and no further
 * speeds are sent, so the belt is never restarted under someone who has
 * stepped off. Only `resume()`, called when the runner chooses to carry on,
 * clears it.
 */
export class FtmsTreadmill implements ControllableTreadmill {
  state: ConnectionState = 'connected';
  stoppedByRunner = false;
  limits: TreadmillLimits = { ...DEFAULT_TREADMILL_LIMITS };
  private readonly run = new Emitter<RunData>();
  private readonly states = new Emitter<ConnectionState>();
  private readonly status = new Emitter<MachineStatus>();
  private queue: Promise<void> = Promise.resolve();
  private hasControl = false;
  private started = false;
  private targetKmh?: number;
  private targetIncline?: number;
  private pending?: { op: number; resolve: () => void; reject: (e: Error) => void };
  private unsubs: Unsubscribe[] = [];
  /** We sent a stop ourselves: the status that comes back is not the runner's doing. */
  private expectingStop = false;
  responseTimeoutMs = 3000;

  constructor(readonly info: DeviceInfo, private transport: TreadmillTransport,
    private readonly timers: Timers = {
      set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    }) {
    this.attach(transport);
  }

  get controllable(): boolean {
    return typeof this.transport.writeControlPoint === 'function';
  }

  /** The last speed target sent, m/s. */
  get targetSpeed(): number | undefined {
    return this.targetKmh === undefined ? undefined : this.targetKmh / 3.6;
  }

  private attach(transport: TreadmillTransport): void {
    this.unsubs.forEach((u) => u());
    this.transport = transport;
    this.unsubs = [
      transport.onTreadmillData((bytes) => {
        const d = parseTreadmillData(bytes);
        const out: RunData = {};
        if (d.speedKmh !== undefined) out.speed = d.speedKmh / 3.6;
        if (d.inclination !== undefined) out.incline = d.inclination;
        if (d.totalDistance !== undefined) out.distance = d.totalDistance;
        if (d.power !== undefined && d.power > 0) out.power = d.power;
        if (Object.keys(out).length) this.run.emit(out);
      }),
      transport.onControlPoint((bytes) => {
        const r = parseControlPointResponse(bytes);
        if (!r || !this.pending || r.requestOp !== this.pending.op) return;
        const p = this.pending;
        this.pending = undefined;
        if (r.ok) p.resolve();
        else p.reject(new FtmsError(`Treadmill refused command 0x${r.requestOp.toString(16)}: ${r.text}`));
      }),
      transport.onStatus((bytes) => {
        const s = parseMachineStatus(bytes);
        if (s.kind === 'controlPermissionLost' || s.kind === 'reset') this.hasControl = false;
        if (s.kind === 'started') this.started = true;
        if (s.kind === 'stopped' || s.kind === 'paused' || s.kind === 'stoppedBySafetyKey' || s.kind === 'reset') {
          this.started = false;
          if (!this.expectingStop) this.stoppedByRunner = true;
          this.expectingStop = false;
        }
        this.status.emit(s);
      }),
    ];
  }

  /** Swap in a fresh transport after a reconnect, then restore control and the last targets (never a stopped belt). */
  async reattach(transport: TreadmillTransport): Promise<void> {
    this.attach(transport);
    this.hasControl = false;
    this.pending = undefined;
    this.queue = Promise.resolve();
    const kmh = this.targetKmh;
    const incline = this.targetIncline;
    this.targetKmh = undefined;
    this.targetIncline = undefined;
    if (!this.controllable || this.stoppedByRunner) return;
    if (incline !== undefined) await this.setTargetIncline(incline);
    if (kmh !== undefined && this.started) await this.setTargetSpeed(kmh / 3.6);
  }

  setState(state: ConnectionState): void {
    if (state === this.state) return;
    this.state = state;
    this.states.emit(state);
  }

  onRun(cb: (d: RunData) => void): Unsubscribe { return this.run.on(cb); }
  onState(cb: (s: ConnectionState) => void): Unsubscribe { return this.states.on(cb); }
  onStatus(cb: (s: MachineStatus) => void): Unsubscribe { return this.status.on(cb); }

  private send(bytes: Uint8Array): Promise<void> {
    const write = this.transport.writeControlPoint?.bind(this.transport);
    if (!write) return Promise.reject(new FtmsError('This treadmill cannot be controlled'));
    const run = async (): Promise<void> => {
      const op = bytes[0];
      let timer: unknown;
      const response = new Promise<void>((resolve, reject) => {
        this.pending = { op, resolve, reject };
        timer = this.timers.set(() => {
          if (this.pending?.op === op) {
            this.pending = undefined;
            reject(new FtmsError(`Treadmill did not answer command 0x${op.toString(16)}`));
          }
        }, this.responseTimeoutMs);
      });
      response.catch(() => undefined);
      try {
        await write(bytes);
        await response;
      } finally {
        this.timers.clear(timer);
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async command(bytes: Uint8Array): Promise<void> {
    if (!this.hasControl) {
      await this.send(encodeRequestControl());
      this.hasControl = true;
    }
    try {
      await this.send(bytes);
    } catch (e) {
      if (e instanceof FtmsError && /control not permitted/.test(e.message)) {
        this.hasControl = false;
        await this.send(encodeRequestControl());
        this.hasControl = true;
        await this.send(bytes);
      } else throw e;
    }
  }

  async setTargetSpeed(speed: number): Promise<void> {
    if (this.stoppedByRunner || !this.controllable) return;
    const range = this.transport.speedRange;
    let kmh = Math.min(speed, this.limits.maxSpeed) * 3.6;
    if (range) kmh = Math.max(range.min, Math.min(range.max, kmh));
    kmh = Math.max(0, Math.round(kmh * 100) / 100);
    if (this.targetKmh !== undefined && Math.abs(this.targetKmh - kmh) < 0.05 && this.started) return;
    this.targetKmh = kmh;
    if (!this.started && kmh > 0) {
      await this.command(encodeStart());
      this.started = true;
    }
    await this.command(encodeSetTargetSpeed(kmh));
  }

  async setTargetIncline(percent: number): Promise<void> {
    if (this.stoppedByRunner || !this.controllable) return;
    const range = this.transport.inclineRange;
    let p = Math.min(percent, this.limits.maxIncline);
    if (range) p = Math.max(range.min, Math.min(range.max, p));
    p = Math.round(p * 10) / 10;
    if (this.targetIncline === p) return;
    this.targetIncline = p;
    await this.command(encodeSetTargetInclination(p));
  }

  /** Our own stop is not the runner's; forget that after a few seconds in case the treadmill never confirms. */
  private expectStop(): void {
    this.expectingStop = true;
    this.timers.set(() => { this.expectingStop = false; }, 3000);
  }

  async stop(pause = false): Promise<void> {
    if (!this.controllable) return;
    this.expectStop();
    this.started = false;
    this.targetKmh = undefined;
    await this.command(encodeStop(pause));
  }

  resume(): void {
    this.stoppedByRunner = false;
  }

  async release(): Promise<void> {
    if (!this.controllable || !this.hasControl) return;
    try {
      if (this.started) await this.stop();
      this.expectStop();
      await this.send(encodeReset());
    } finally {
      this.hasControl = false;
      this.targetKmh = undefined;
      this.targetIncline = undefined;
    }
  }

  async disconnect(): Promise<void> {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.setState('disconnected');
  }
}
