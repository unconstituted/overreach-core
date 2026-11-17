/** Common device interfaces. The game only ever talks to these, never to Bluetooth or a simulator directly. */

export type Unsubscribe = () => void;
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface DeviceInfo {
  name: string;
  kind: 'sim' | 'bluetooth';
  /** Short description of the protocol in use, for the device panel. */
  protocol: string;
}

export interface Device {
  readonly info: DeviceInfo;
  readonly state: ConnectionState;
  onState(cb: (state: ConnectionState) => void): Unsubscribe;
  disconnect(): Promise<void>;
}

export interface PowerData {
  /** Watts. */
  power: number;
  /** Crank rpm, when the device reports it. */
  cadence?: number;
  /** Device-reported speed in m/s, when present (trainer flywheel speed; not used for gameplay). */
  speed?: number;
}

export interface PowerSource extends Device {
  onPower(cb: (data: PowerData) => void): Unsubscribe;
}

export interface HeartRateData {
  bpm: number;
  /** RR intervals in seconds, when the strap reports them. */
  rr?: number[];
  /** False when the strap reports that it has lost skin contact. */
  contact?: boolean;
}

export interface HeartRateSource extends Device {
  onHeartRate(cb: (data: HeartRateData) => void): Unsubscribe;
}

export interface SimulationParams {
  /** Road grade in percent (5 = 5%). */
  grade: number;
  /** Head wind in m/s. */
  windSpeed?: number;
  /** Rolling resistance coefficient. */
  crr?: number;
  /** Wind resistance coefficient, kg/m. */
  cw?: number;
}

export interface ControllableTrainer extends PowerSource {
  /** Hold a power target (ERG mode). */
  setTargetPower(watts: number): Promise<void>;
  /** Simulate a road (the rider's power depends on gear and cadence). */
  setSimulation(params: SimulationParams): Promise<void>;
  /** Fixed resistance level, 0 to 100. */
  setResistance(level: number): Promise<void>;
  /** Give control back: the trainer drops to its default, easy resistance. */
  release(): Promise<void>;
}

/** Minimal typed event emitter. */
export class Emitter<T> {
  private listeners = new Set<(v: T) => void>();
  on(cb: (v: T) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }
  emit(v: T): void {
    for (const l of [...this.listeners]) l(v);
  }
  get size(): number {
    return this.listeners.size;
  }
}

/* ---------- Running ---------- */

export interface RunData {
  /** Belt or footpod speed, m/s. */
  speed?: number;
  /** Steps per minute. */
  cadence?: number;
  /** Treadmill incline, percent. */
  incline?: number;
  /** Device's own distance counter, metres. */
  distance?: number;
  /** Running power, watts, from a footpod or treadmill that reports it. */
  power?: number;
}

/** A treadmill (smart or not) or a footpod. */
export interface RunSource extends Device {
  onRun(cb: (data: RunData) => void): Unsubscribe;
}

export interface ControllableTreadmill extends RunSource {
  /** False when the treadmill reports data but refuses control (or has no control point). */
  readonly controllable: boolean;
  /**
   * True after the runner has stopped the belt themselves (the stop button or
   * the safety key). The engine sends no more speeds until `resume()`.
   */
  readonly stoppedByRunner: boolean;
  /** Belt speed target, m/s. Starts the belt if it is idle, unless the runner stopped it. */
  setTargetSpeed(speed: number): Promise<void>;
  setTargetIncline(percent: number): Promise<void>;
  /** Stop (or pause) the belt. */
  stop(pause?: boolean): Promise<void>;
  /** The runner asked to carry on: clear `stoppedByRunner`. Does not start the belt by itself. */
  resume(): void;
  /** Stop the belt and give control back. */
  release(): Promise<void>;
}
