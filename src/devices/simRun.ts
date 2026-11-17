import { approach, clamp } from '../core/util/math';
import { Rng } from '../core/util/rng';
import { encodeControlPointResponse, FtmsResult, parseControlPointCommand } from './protocol/ftms';
import { encodeRscMeasurement, parseRscMeasurement } from './protocol/rsc';
import { encodeTreadmillData, type Range } from './protocol/treadmill';
import { FtmsTreadmill, type TreadmillTransport } from './ftmsTreadmill';
import { Emitter, type ConnectionState, type DeviceInfo, type RunData, type RunSource, type Unsubscribe } from './types';

export interface SimRunnerOptions {
  /** Threshold speed, m/s. Default 4 m/s (4:10 per km). */
  thresholdSpeed?: number;
  seed?: number;
}

/**
 * A simulated FTMS treadmill with a runner on it, wearing a footpod. It
 * speaks real bytes: Treadmill Data and RSC Measurement notifications out,
 * Control Point writes in, with the response and status packets a real
 * treadmill sends.
 *
 * The belt accelerates and decelerates at treadmill rates. Under control it
 * runs at the target; otherwise the runner sets the speed themselves, a few
 * seconds behind the workout, as people do with the buttons. `running =
 * false` is the runner pressing stop: the belt winds down and the treadmill
 * reports it, exactly as the safety logic expects.
 */
export class SimTreadmillPeripheral implements TreadmillTransport {
  readonly speedRange: Range = { min: 0.8, max: 22, increment: 0.1 };
  readonly inclineRange: Range = { min: 0, max: 15, increment: 0.5 };

  /* Runner controls. */
  /** What the runner aims for when the treadmill is not under control, m/s (usually the workout target). */
  follow = 0;
  /** Manual speed (the slider), m/s. Null means follow the workout. */
  override: number | null = null;
  running = true;

  /* Treadmill state. */
  hasControl = false;
  controlled = false;
  started = false;
  targetSpeed = 0;
  targetIncline = 0;

  /* Outputs (true values). */
  speed = 0;
  incline = 0;
  distance = 0;
  cadence = 0;
  elapsed = 0;

  readonly writes: Uint8Array[] = [];
  notifyInterval = 0.5;
  private readonly rng: Rng;
  private readonly easy: number;
  private manualSet = 0;
  private sinceNotify = 0;
  private sinceButton = 0;
  private wasRunning = true;
  /** Stopped or reset from the control point: the belt stays still until someone starts it. */
  private idle = false;
  private readonly data = new Emitter<Uint8Array>();
  private readonly pod = new Emitter<Uint8Array>();
  private readonly cp = new Emitter<Uint8Array>();
  private readonly status = new Emitter<Uint8Array>();

  constructor(opts: SimRunnerOptions = {}) {
    this.rng = new Rng(opts.seed ?? 5);
    this.easy = (opts.thresholdSpeed ?? 4) * 0.78;
  }

  onTreadmillData(cb: (b: Uint8Array) => void): Unsubscribe { return this.data.on(cb); }
  onControlPoint(cb: (b: Uint8Array) => void): Unsubscribe { return this.cp.on(cb); }
  onStatus(cb: (b: Uint8Array) => void): Unsubscribe { return this.status.on(cb); }
  /** The runner's footpod (RSC Measurement bytes). */
  onFootpod(cb: (b: Uint8Array) => void): Unsubscribe { return this.pod.on(cb); }

  async writeControlPoint(bytes: Uint8Array): Promise<void> {
    this.writes.push(bytes.slice());
    const cmd = parseControlPointCommand(bytes);
    const respond = (result: number) => this.cp.emit(encodeControlPointResponse(bytes[0], result));
    if (cmd.op === 'requestControl') { this.hasControl = true; return respond(FtmsResult.success); }
    if (cmd.op === 'unknown' || cmd.op === 'setTargetPower' || cmd.op === 'setSimulation' || cmd.op === 'setTargetResistance') {
      return respond(FtmsResult.opCodeNotSupported);
    }
    if (!this.hasControl) return respond(FtmsResult.controlNotPermitted);
    switch (cmd.op) {
      case 'start':
        if (!this.running) return respond(FtmsResult.operationFailed); // nobody on the belt
        this.started = true; this.controlled = true; this.idle = false;
        respond(FtmsResult.success);
        this.status.emit(new Uint8Array([0x04]));
        return;
      case 'stop':
        this.started = false; this.idle = true;
        respond(FtmsResult.success);
        this.status.emit(new Uint8Array([0x02, cmd.pause ? 0x02 : 0x01]));
        return;
      case 'reset':
        this.started = false; this.controlled = false; this.hasControl = false; this.idle = true;
        respond(FtmsResult.success);
        this.status.emit(new Uint8Array([0x01]));
        return;
      case 'setTargetSpeed':
        if (cmd.kmh < this.speedRange.min - 1e-9 || cmd.kmh > this.speedRange.max + 1e-9) return respond(FtmsResult.invalidParameter);
        this.targetSpeed = cmd.kmh / 3.6; this.controlled = true;
        respond(FtmsResult.success);
        this.status.emit(new Uint8Array([0x05, Math.round(cmd.kmh * 100) & 0xff, Math.round(cmd.kmh * 100) >> 8]));
        return;
      case 'setTargetInclination':
        this.targetIncline = clamp(cmd.percent, this.inclineRange.min, this.inclineRange.max);
        return respond(FtmsResult.success);
      default:
        return respond(FtmsResult.success);
    }
  }

  tick(dt: number): void {
    if (dt <= 0) return;
    let left = dt;
    while (left > 1e-9) {
      const h = Math.min(0.1, left);
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
    // The runner pressing stop, and later stepping back on and pressing start.
    if (this.wasRunning && !this.running) {
      this.started = false;
      this.status.emit(new Uint8Array([0x02, 0x01]));
    } else if (!this.wasRunning && this.running && !this.controlled) {
      this.started = true;
      this.idle = false;
    }
    this.wasRunning = this.running;

    let want: number;
    if (!this.running || this.idle || (!this.started && this.controlled)) want = 0;
    else if (this.override !== null) want = this.override;
    else if (this.controlled && this.started) want = this.targetSpeed;
    else {
      // Pressing the buttons by hand: catch up with the workout every few seconds.
      this.sinceButton += h;
      if (this.sinceButton > 3) { this.sinceButton = 0; this.manualSet = this.follow > 0 ? this.follow : this.easy; }
      if (!this.started && this.running) this.started = true;
      want = this.manualSet;
    }
    // Treadmill motors: about 1.5 km/h per second up, faster down.
    const up = 0.42;
    const down = 0.8;
    const dv = want - this.speed;
    this.speed += clamp(dv, -down * h, up * h);
    if (this.speed < 0.05 && want === 0) this.speed = 0;
    this.incline += clamp(this.targetIncline - this.incline, -0.5 * h, 0.5 * h);

    // Steps per minute: walking under about 2 m/s, then running cadence rising gently with speed.
    const v = this.speed;
    const want_cad = v < 0.3 ? 0 : v < 2 ? 95 + 15 * v : clamp(158 + 8 * (v - 2.5), 150, 196);
    this.cadence += (want_cad + (v > 0.3 ? this.rng.gauss() * 1.2 : 0) - this.cadence) * approach(h, 1.2);
    if (want_cad === 0 && this.cadence < 5) this.cadence = 0;
    this.distance += this.speed * h;
  }

  private notify(): void {
    this.data.emit(encodeTreadmillData({
      speedKmh: this.speed * 3.6, totalDistance: this.distance, inclination: this.incline, elapsedTime: Math.floor(this.elapsed) & 0xffff,
    }));
    // A footpod's speed is a little noisier than the belt's.
    this.pod.emit(encodeRscMeasurement({
      speed: Math.max(0, this.speed * (1 + this.rng.gauss() * 0.01)), cadence: this.cadence,
      totalDistance: this.distance, running: this.speed > 2.2,
    }));
  }
}

/**
 * The simulated twin of a smart treadmill: the real FTMS treadmill control
 * logic running against `SimTreadmillPeripheral`. Call `tick(dt)` from the game loop.
 */
export class SimTreadmill extends FtmsTreadmill {
  readonly peripheral: SimTreadmillPeripheral;
  readonly footpod: SimFootpod;

  constructor(opts: SimRunnerOptions = {}) {
    const peripheral = new SimTreadmillPeripheral(opts);
    super({ name: 'Simulated treadmill', kind: 'sim', protocol: 'FTMS treadmill (simulated)' }, peripheral);
    this.peripheral = peripheral;
    this.footpod = new SimFootpod(peripheral);
  }

  tick(dt: number): void {
    this.peripheral.tick(dt);
  }

  /** Tell the simulated runner what the workout wants, so they follow targets when the treadmill is not under control. */
  setRunnerTarget(speed: number | undefined): void {
    this.peripheral.follow = Math.max(0, speed ?? 0);
  }

  setOverride(speed: number | null): void {
    this.peripheral.override = speed === null ? null : Math.max(0, speed);
  }

  /** The runner stops (presses stop) or starts running again. */
  setRunning(on: boolean): void {
    this.peripheral.running = on;
  }
}

/** The footpod on the simulated runner: cadence (and speed) over real RSC bytes. */
export class SimFootpod implements RunSource {
  readonly info: DeviceInfo = { name: 'Simulated footpod', kind: 'sim', protocol: 'Running Speed and Cadence (simulated)' };
  state: ConnectionState = 'connected';
  private readonly run = new Emitter<RunData>();
  private readonly states = new Emitter<ConnectionState>();
  private readonly unsub: Unsubscribe;

  constructor(peripheral: SimTreadmillPeripheral) {
    this.unsub = peripheral.onFootpod((bytes) => {
      const m = parseRscMeasurement(bytes);
      this.run.emit({ speed: m.speed, cadence: m.cadence, distance: m.totalDistance });
    });
  }

  onRun(cb: (d: RunData) => void): Unsubscribe { return this.run.on(cb); }
  onState(cb: (s: ConnectionState) => void): Unsubscribe { return this.states.on(cb); }
  async disconnect(): Promise<void> {
    this.unsub();
    this.state = 'disconnected';
    this.states.emit('disconnected');
  }
}
