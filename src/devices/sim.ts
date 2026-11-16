import { approach, clamp } from '../core/util/math';
import { Rng } from '../core/util/rng';
import { DEFAULT_BIKE, stepBikeSpeed } from '../core/record/physics';
import { FtmsTrainer, type FtmsTransport } from './ftmsTrainer';
import {
  encodeControlPointResponse, encodeIndoorBikeData, encodeStatusTargetPower, FtmsOp, FtmsResult,
  parseControlPointCommand, type PowerRange,
} from './protocol/ftms';
import { encodeHeartRateMeasurement, parseHeartRateMeasurement } from './protocol/hrs';
import {
  Emitter, type ConnectionState, type DeviceInfo, type HeartRateData, type HeartRateSource,
  type PowerSource, type Unsubscribe,
} from './types';

export interface SimRiderOptions {
  ftp?: number;
  seed?: number;
  /** Preferred easy cadence, rpm. */
  cadence?: number;
}

/**
 * A simulated FTMS trainer with a rider on it. It speaks real FTMS bytes:
 * Indoor Bike Data notifications out, Control Point writes in, with the same
 * response and status packets a physical trainer sends.
 *
 * The rider follows the workout: in ERG the trainer holds the target (with a
 * couple of seconds of lag and a little noise); out of ERG the rider aims for
 * `follow` watts with a slower, noisier response. `override` replaces all of
 * that with a manual power, and `pedalling = false` makes the rider stop.
 */
export class SimFtmsPeripheral implements FtmsTransport {
  readonly powerRange: PowerRange = { min: 0, max: 2000, increment: 1 };

  /* Rider controls. */
  /** What the rider aims for when the trainer is not in ERG (usually the workout target). */
  follow = 0;
  /** Manual power (keyboard or slider). Null means follow the workout. */
  override: number | null = null;
  /** Cadence the workout asks for, if any. */
  cadenceTarget: number | null = null;
  pedalling = true;
  /** How well the rider hits the target: 1 = on target, 0.9 = 10% under. */
  compliance = 1;

  /* Trainer state. */
  hasControl = false;
  mode: 'none' | 'erg' | 'sim' | 'resistance' = 'none';
  targetPower = 0;
  grade = 0;
  resistance = 0;

  /* Outputs (true values, before packet rounding). */
  power = 0;
  cadence = 0;
  speed = 0;
  distance = 0;
  elapsed = 0;

  private readonly ftp: number;
  private readonly baseCadence: number;
  private readonly rng: Rng;
  private noise = 0;
  private sinceNotify = 0;
  private readonly data = new Emitter<Uint8Array>();
  private readonly cp = new Emitter<Uint8Array>();
  private readonly status = new Emitter<Uint8Array>();
  /** Every control point write received, for tests and the dev page. */
  readonly writes: Uint8Array[] = [];
  /** Seconds between Indoor Bike Data notifications (real trainers send 1 to 4 per second). */
  notifyInterval = 0.25;

  constructor(opts: SimRiderOptions = {}) {
    this.ftp = opts.ftp ?? 250;
    this.baseCadence = opts.cadence ?? 86;
    this.rng = new Rng(opts.seed ?? 7);
  }

  onIndoorBikeData(cb: (b: Uint8Array) => void): Unsubscribe { return this.data.on(cb); }
  onControlPoint(cb: (b: Uint8Array) => void): Unsubscribe { return this.cp.on(cb); }
  onStatus(cb: (b: Uint8Array) => void): Unsubscribe { return this.status.on(cb); }

  async writeControlPoint(bytes: Uint8Array): Promise<void> {
    this.writes.push(bytes.slice());
    const cmd = parseControlPointCommand(bytes);
    const respond = (result: number) => this.cp.emit(encodeControlPointResponse(bytes[0], result));
    if (cmd.op === 'requestControl') {
      this.hasControl = true;
      return respond(FtmsResult.success);
    }
    if (cmd.op === 'unknown') return respond(FtmsResult.opCodeNotSupported);
    if (!this.hasControl) return respond(FtmsResult.controlNotPermitted);
    switch (cmd.op) {
      case 'reset':
        this.mode = 'none';
        this.hasControl = false;
        respond(FtmsResult.success);
        this.status.emit(new Uint8Array([0x01]));
        return;
      case 'setTargetPower':
        if (cmd.watts < this.powerRange.min || cmd.watts > this.powerRange.max) return respond(FtmsResult.invalidParameter);
        this.mode = 'erg';
        this.targetPower = cmd.watts;
        respond(FtmsResult.success);
        this.status.emit(encodeStatusTargetPower(cmd.watts));
        return;
      case 'setSimulation':
        this.mode = 'sim';
        this.grade = cmd.grade;
        return respond(FtmsResult.success);
      case 'setTargetResistance':
        this.mode = 'resistance';
        this.resistance = cmd.level;
        return respond(FtmsResult.success);
      default:
        return respond(FtmsResult.success);
    }
  }

  /** Simulate another app stealing the trainer: control is lost until requested again. */
  dropControl(): void {
    this.hasControl = false;
    this.status.emit(new Uint8Array([0xff]));
  }

  /** Advance the simulation by `dt` seconds. */
  tick(dt: number): void {
    if (dt <= 0) return;
    const step = Math.min(dt, 0.1);
    let left = dt;
    while (left > 1e-9) {
      const h = Math.min(step, left);
      this.integrate(h);
      left -= h;
      this.sinceNotify += h;
      if (this.sinceNotify >= this.notifyInterval - 1e-9) {
        this.sinceNotify -= this.notifyInterval;
        this.notify();
      }
    }
  }

  private integrate(h: number): void {
    this.elapsed += h;
    const manual = this.override !== null;
    const erg = this.mode === 'erg' && !manual;
    let aim = manual ? (this.override as number) : erg ? this.targetPower : this.follow * this.compliance;

    // Cadence: riders spin faster as the effort rises.
    const frac = aim / this.ftp;
    const wantCadence = this.pedalling
      ? (this.cadenceTarget ?? this.baseCadence + 16 * clamp((frac - 0.6) / 0.6)) + this.noise * 20
      : 0;
    this.cadence += (wantCadence - this.cadence) * approach(h, this.pedalling ? 1.4 : 0.9);
    if (this.cadence < 0.5) this.cadence = 0;

    // A trainer cannot hold power with nobody pedalling.
    if (!this.pedalling || this.cadence < 25) aim = 0;

    // ERG settles in a couple of seconds; a human chasing a number is slower and looser.
    const tau = aim === 0 ? 0.8 : erg ? 2.0 : 3.5;
    this.power += (aim - this.power) * approach(h, tau);

    // Slowly wandering noise (an Ornstein-Uhlenbeck process) rather than white noise.
    const sigma = erg ? 0.012 : 0.035;
    this.noise += -this.noise * approach(h, 1.5) + this.rng.gauss() * sigma * Math.sqrt(h) * 1.6;
    this.noise = clamp(this.noise, -0.12, 0.12);

    const out = this.measuredPower();
    this.speed = stepBikeSpeed(this.speed, out, h, { ...DEFAULT_BIKE, grade: this.mode === 'sim' ? this.grade / 100 : 0 });
    this.distance += this.speed * h;
  }

  /** Power as the trainer's strain gauge would report it. */
  measuredPower(): number {
    return Math.max(0, this.power * (1 + this.noise));
  }

  private notify(): void {
    this.data.emit(encodeIndoorBikeData({
      speedKmh: this.speed * 3.6, cadence: this.cadence, totalDistance: this.distance,
      power: this.measuredPower(), elapsedTime: Math.floor(this.elapsed) & 0xffff,
    }));
  }
}

/**
 * The simulated twin of a smart trainer: the real FTMS control logic running
 * against `SimFtmsPeripheral`. Call `tick(dt)` from the game loop.
 */
export class SimTrainer extends FtmsTrainer {
  readonly peripheral: SimFtmsPeripheral;

  constructor(opts: SimRiderOptions = {}) {
    const peripheral = new SimFtmsPeripheral(opts);
    super({ name: 'Simulated trainer', kind: 'sim', protocol: 'FTMS (simulated)' }, peripheral);
    this.peripheral = peripheral;
  }

  tick(dt: number): void {
    this.peripheral.tick(dt);
  }

  /** Tell the simulated rider what the workout wants, so it follows targets when ERG is off. */
  setRiderTarget(watts: number, cadence?: number): void {
    this.peripheral.follow = Math.max(0, watts);
    this.peripheral.cadenceTarget = cadence ?? null;
  }

  /** Manual power override (keyboard or slider). Pass null to go back to following the workout. */
  setOverride(watts: number | null): void {
    this.peripheral.override = watts === null ? null : Math.max(0, watts);
  }

  setPedalling(on: boolean): void {
    this.peripheral.pedalling = on;
  }
}

export interface SimHeartOptions {
  ftp?: number;
  restHr?: number;
  maxHr?: number;
  /** Time constant of the rise, seconds (real hearts: roughly 20 to 60). */
  tauUp?: number;
  /** Time constant of the recovery, seconds. */
  tauDown?: number;
  seed?: number;
}

/**
 * A simulated heart-rate strap. Heart rate chases a steady-state value for
 * the current power with a first-order lag (so it trails power by tens of
 * seconds), recovers more slowly than it rises, and drifts up over a long
 * ride. It emits real Heart Rate Measurement packets once a second.
 */
export class SimHeartRate implements HeartRateSource {
  readonly info: DeviceInfo = { name: 'Simulated heart-rate strap', kind: 'sim', protocol: 'Heart Rate Service (simulated)' };
  state: ConnectionState = 'connected';
  /** True heart rate, before rounding. */
  bpm: number;
  private power = 0;
  private elapsed = 0;
  private sinceNotify = 0;
  private wobble = 0;
  private readonly rng: Rng;
  private readonly hr = new Emitter<HeartRateData>();
  private readonly states = new Emitter<ConnectionState>();
  private readonly o: Required<SimHeartOptions>;
  private unsub?: Unsubscribe;
  /** The last packet sent, for tests. */
  lastPacket?: Uint8Array;

  constructor(opts: SimHeartOptions = {}, source?: PowerSource) {
    this.o = { ftp: 250, restHr: 58, maxHr: 185, tauUp: 32, tauDown: 48, seed: 11, ...opts };
    this.bpm = this.o.restHr + 12;
    this.rng = new Rng(this.o.seed);
    if (source) this.unsub = source.onPower((d) => { this.power = d.power; });
  }

  /** Feed power directly when not bound to a power source. */
  setPower(watts: number): void {
    this.power = watts;
  }

  /** Steady-state heart rate for a power, before drift. */
  steadyState(watts: number): number {
    const frac = clamp(watts / this.o.ftp, 0, 1.6);
    // About 88% of heart-rate reserve at FTP, approaching max above it.
    const reserve = frac <= 1 ? 0.2 + 0.68 * frac : 0.88 + 0.12 * clamp((frac - 1) / 0.25);
    return this.o.restHr + (this.o.maxHr - this.o.restHr) * (watts <= 0 ? 0.08 : reserve);
  }

  tick(dt: number): void {
    if (dt <= 0) return;
    let left = dt;
    while (left > 1e-9) {
      const h = Math.min(0.25, left);
      left -= h;
      this.elapsed += h;
      const drift = 1 + 0.03 * clamp(this.elapsed / 3600);
      const want = Math.min(this.o.maxHr, this.steadyState(this.power) * (this.power > 0 ? drift : 1));
      const tau = want > this.bpm ? this.o.tauUp : this.o.tauDown;
      this.bpm += (want - this.bpm) * approach(h, tau);
      this.wobble += -this.wobble * approach(h, 4) + this.rng.gauss() * 0.5 * Math.sqrt(h);
      this.sinceNotify += h;
      if (this.sinceNotify >= 1 - 1e-9) {
        this.sinceNotify -= 1;
        const bpm = Math.round(clamp(this.bpm + this.wobble, 30, 240));
        this.lastPacket = encodeHeartRateMeasurement({ bpm, contact: true, rr: [60 / bpm] });
        const m = parseHeartRateMeasurement(this.lastPacket);
        this.hr.emit({ bpm: m.bpm, rr: m.rr, contact: m.contact });
      }
    }
  }

  onHeartRate(cb: (d: HeartRateData) => void): Unsubscribe { return this.hr.on(cb); }
  onState(cb: (s: ConnectionState) => void): Unsubscribe { return this.states.on(cb); }

  async disconnect(): Promise<void> {
    this.unsub?.();
    this.state = 'disconnected';
    this.states.emit(this.state);
  }
}

export { FtmsOp };
