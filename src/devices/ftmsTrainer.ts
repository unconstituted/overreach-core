import {
  encodeRequestControl, encodeSetSimulation, encodeSetTargetPower, encodeSetTargetResistance, encodeReset,
  parseControlPointResponse, parseIndoorBikeData, parseMachineStatus, FtmsOp, type MachineStatus, type PowerRange,
} from './protocol/ftms';
import {
  Emitter, type ConnectionState, type ControllableTrainer, type DeviceInfo, type PowerData,
  type SimulationParams, type Unsubscribe,
} from './types';

/**
 * The byte-level link to an FTMS trainer. Web Bluetooth provides one
 * implementation; the simulated trainer provides another. Everything above
 * this line (control logic, parsing) is shared, so the simulator exercises
 * the same code a real trainer will.
 */
export interface FtmsTransport {
  /** Write to the Fitness Machine Control Point. */
  writeControlPoint(bytes: Uint8Array): Promise<void>;
  onIndoorBikeData(cb: (bytes: Uint8Array) => void): Unsubscribe;
  onControlPoint(cb: (bytes: Uint8Array) => void): Unsubscribe;
  onStatus(cb: (bytes: Uint8Array) => void): Unsubscribe;
  /** Supported power range, when the trainer exposes it. */
  powerRange?: PowerRange;
}

type Mode =
  | { kind: 'none' }
  | { kind: 'erg'; watts: number }
  | { kind: 'sim'; params: SimulationParams }
  | { kind: 'resistance'; level: number };

export class FtmsError extends Error {}

/**
 * FTMS control logic: request control, send targets, match responses, parse
 * data. Writes are queued because GATT allows one operation at a time, and
 * each write waits for the trainer's response indication.
 */
export class FtmsTrainer implements ControllableTrainer {
  state: ConnectionState = 'connected';
  private readonly power = new Emitter<PowerData>();
  private readonly states = new Emitter<ConnectionState>();
  private readonly status = new Emitter<MachineStatus>();
  private queue: Promise<void> = Promise.resolve();
  private hasControl = false;
  private mode: Mode = { kind: 'none' };
  private pending?: { op: number; resolve: () => void; reject: (e: Error) => void };
  private unsubs: Unsubscribe[] = [];
  /** How long to wait for a control point response before giving up, ms. */
  responseTimeoutMs = 3000;

  constructor(readonly info: DeviceInfo, private transport: FtmsTransport,
    private readonly timers: { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void } = {
      set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    }) {
    this.attach(transport);
  }

  private attach(transport: FtmsTransport): void {
    this.unsubs.forEach((u) => u());
    this.transport = transport;
    this.unsubs = [
      transport.onIndoorBikeData((bytes) => {
        const d = parseIndoorBikeData(bytes);
        if (d.power === undefined) return;
        this.power.emit({
          power: Math.max(0, d.power), cadence: d.cadence,
          speed: d.speedKmh !== undefined ? d.speedKmh / 3.6 : undefined,
        });
      }),
      transport.onControlPoint((bytes) => {
        const r = parseControlPointResponse(bytes);
        if (!r || !this.pending || r.requestOp !== this.pending.op) return;
        const p = this.pending;
        this.pending = undefined;
        if (r.ok) p.resolve();
        else p.reject(new FtmsError(`Trainer refused command 0x${r.requestOp.toString(16)}: ${r.text}`));
      }),
      transport.onStatus((bytes) => {
        const s = parseMachineStatus(bytes);
        if (s.kind === 'controlPermissionLost' || s.kind === 'reset') this.hasControl = false;
        this.status.emit(s);
      }),
    ];
  }

  /**
   * Swap in a fresh transport after a reconnect, then restore control and
   * the last target so the rider does not notice the drop.
   */
  async reattach(transport: FtmsTransport): Promise<void> {
    this.attach(transport);
    this.hasControl = false;
    this.pending = undefined;
    this.queue = Promise.resolve();
    const mode = this.mode;
    this.mode = { kind: 'none' };
    if (mode.kind === 'erg') await this.setTargetPower(mode.watts);
    else if (mode.kind === 'sim') await this.setSimulation(mode.params);
    else if (mode.kind === 'resistance') await this.setResistance(mode.level);
  }

  setState(state: ConnectionState): void {
    if (state === this.state) return;
    this.state = state;
    this.states.emit(state);
  }

  onPower(cb: (d: PowerData) => void): Unsubscribe { return this.power.on(cb); }
  onState(cb: (s: ConnectionState) => void): Unsubscribe { return this.states.on(cb); }
  onStatus(cb: (s: MachineStatus) => void): Unsubscribe { return this.status.on(cb); }

  /** The last ERG target sent, if the trainer is in ERG mode. */
  get targetPower(): number | undefined {
    return this.mode.kind === 'erg' ? this.mode.watts : undefined;
  }

  private send(bytes: Uint8Array): Promise<void> {
    const run = async (): Promise<void> => {
      const op = bytes[0];
      let timer: unknown;
      const response = new Promise<void>((resolve, reject) => {
        this.pending = { op, resolve, reject };
        timer = this.timers.set(() => {
          if (this.pending?.op === op) {
            this.pending = undefined;
            reject(new FtmsError(`Trainer did not answer command 0x${op.toString(16)}`));
          }
        }, this.responseTimeoutMs);
      });
      // Attach a handler now so a rejection during the write is not reported as unhandled.
      response.catch(() => undefined);
      try {
        await this.transport.writeControlPoint(bytes);
        await response;
      } finally {
        this.timers.clear(timer);
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async ensureControl(): Promise<void> {
    if (this.hasControl) return;
    await this.send(encodeRequestControl());
    this.hasControl = true;
  }

  private async command(bytes: Uint8Array): Promise<void> {
    await this.ensureControl();
    try {
      await this.send(bytes);
    } catch (e) {
      // Some trainers silently drop control (e.g. another app connected). Ask again once.
      if (e instanceof FtmsError && /control not permitted/.test(e.message)) {
        this.hasControl = false;
        await this.ensureControl();
        await this.send(bytes);
      } else throw e;
    }
  }

  async setTargetPower(watts: number): Promise<void> {
    const range = this.transport.powerRange;
    let w = Math.round(watts);
    if (range) w = Math.max(range.min, Math.min(range.max, w));
    else w = Math.max(0, Math.min(4000, w));
    if (this.mode.kind === 'erg' && this.mode.watts === w) return; // nothing to send
    this.mode = { kind: 'erg', watts: w };
    await this.command(encodeSetTargetPower(w));
  }

  async setSimulation(params: SimulationParams): Promise<void> {
    this.mode = { kind: 'sim', params };
    await this.command(encodeSetSimulation(params));
  }

  async setResistance(level: number): Promise<void> {
    const l = Math.max(0, Math.min(100, level));
    this.mode = { kind: 'resistance', level: l };
    await this.command(encodeSetTargetResistance(l));
  }

  /** Leave ERG: reset the machine, which drops resistance to its default and gives up control. */
  async release(): Promise<void> {
    if (this.mode.kind === 'none' && !this.hasControl) return;
    this.mode = { kind: 'none' };
    try {
      await this.ensureControl();
      await this.send(encodeReset());
    } finally {
      this.hasControl = false;
    }
  }

  async disconnect(): Promise<void> {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.setState('disconnected');
  }
}

export { FtmsOp };
