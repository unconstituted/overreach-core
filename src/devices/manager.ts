import { runEffort } from '../core/workout/effort';
import { connectFootpod, connectHeartRate, connectTrainer, connectTreadmill, type Bt } from './bluetooth';
import { FtmsTreadmill, type TreadmillLimits } from './ftmsTreadmill';
import { SimHeartRate, SimTrainer, type SimHeartOptions, type SimRiderOptions } from './sim';
import { SimTreadmill, type SimRunnerOptions } from './simRun';
import {
  Emitter, type ConnectionState, type ControllableTrainer, type HeartRateSource, type PowerSource, type RunSource, type Unsubscribe,
} from './types';

export type DeviceSport = 'bike' | 'run';

export interface LiveRider {
  /** Watts. For a runner, running power from a footpod or treadmill that reports it, otherwise 0. */
  power: number;
  /** Pedal rpm for a rider; steps per minute for a runner. */
  cadence: number;
  /** Running: belt (or footpod) speed, m/s. 0 on the bike. */
  speed: number;
  /** Running: treadmill incline, percent. */
  incline: number;
  /** Zero when no heart-rate source is connected. */
  heartRate: number;
  /** Seconds since the last power packet (by the manager's clock), to detect a stalled device. */
  powerAge: number;
}

export interface DeviceSummary {
  sport: DeviceSport;
  power?: { name: string; protocol: string; state: ConnectionState; kind: 'sim' | 'bluetooth'; controllable: boolean };
  heart?: { name: string; protocol: string; state: ConnectionState; kind: 'sim' | 'bluetooth' };
  /** Running: the treadmill. */
  belt?: { name: string; protocol: string; state: ConnectionState; kind: 'sim' | 'bluetooth'; controllable: boolean; stoppedByRunner: boolean };
  /** Running: the footpod. */
  pod?: { name: string; protocol: string; state: ConnectionState; kind: 'sim' | 'bluetooth' };
}

/**
 * Owns the current power and heart-rate sources and exposes the latest
 * readings. The game reads `live` each frame and calls `tick(dt)`; it does
 * not care whether the data comes from Bluetooth or the simulator.
 */
export class DeviceManager {
  readonly live: LiveRider = { power: 0, cadence: 0, speed: 0, incline: 0, heartRate: 0, powerAge: 0 };
  readonly changed = new Emitter<DeviceSummary>();
  power?: PowerSource;
  trainer?: ControllableTrainer;
  heart?: HeartRateSource;
  simTrainer?: SimTrainer;
  simHeart?: SimHeartRate;
  /* Running. */
  sport: DeviceSport = 'bike';
  /** The treadmill (smart or not). Speed, incline and distance come from here when present. */
  belt?: RunSource;
  /** The treadmill when it can be controlled. */
  treadmill?: FtmsTreadmill;
  /** The footpod: cadence, running power, and speed when there is no treadmill. */
  pod?: RunSource;
  simTreadmill?: SimTreadmill;
  /** Let the workout set the treadmill's speed and incline. Off: the runner sets them by hand. */
  treadmillControl = true;
  /** Safety limits for anything the engine asks a treadmill to do. */
  treadmillLimits: TreadmillLimits = { maxSpeed: 20 / 3.6, maxIncline: 10 };
  /** Fires when the runner stops the belt themselves (stop button or safety key). Pause the ride. */
  readonly runnerStopped = new Emitter<void>();
  private unsubBelt: Unsubscribe[] = [];
  private unsubPod: Unsubscribe[] = [];
  private beltAge = 0;
  private podSpeed = 0;
  private lastSpeed?: number;
  private lastIncline?: number;

  private unsubPower: Unsubscribe[] = [];
  private unsubHeart: Unsubscribe[] = [];
  private lastTarget?: number;

  constructor(private simOptions: SimRiderOptions & SimHeartOptions & SimRunnerOptions = {}) {}

  /** Change the simulated athlete's profile (FTP, threshold pace and so on). Applies to simulated devices created afterwards. */
  setSimOptions(opts: SimRiderOptions & SimHeartOptions & SimRunnerOptions): void {
    this.simOptions = { ...this.simOptions, ...opts };
  }

  summary(): DeviceSummary {
    return {
      sport: this.sport,
      belt: this.belt && {
        name: this.belt.info.name, protocol: this.belt.info.protocol, state: this.belt.state, kind: this.belt.info.kind,
        controllable: !!this.treadmill?.controllable, stoppedByRunner: !!this.treadmill?.stoppedByRunner,
      },
      pod: this.pod && { name: this.pod.info.name, protocol: this.pod.info.protocol, state: this.pod.state, kind: this.pod.info.kind },
      power: this.power && {
        name: this.power.info.name, protocol: this.power.info.protocol, state: this.power.state,
        kind: this.power.info.kind, controllable: !!this.trainer,
      },
      heart: this.heart && {
        name: this.heart.info.name, protocol: this.heart.info.protocol, state: this.heart.state, kind: this.heart.info.kind,
      },
    };
  }

  private async setPower(source: PowerSource, trainer?: ControllableTrainer): Promise<void> {
    const old = this.power;
    this.unsubPower.forEach((u) => u());
    this.power = source;
    this.trainer = trainer;
    this.lastTarget = undefined;
    this.live.power = 0;
    this.live.cadence = 0;
    this.live.powerAge = 0;
    this.unsubPower = [
      source.onPower((d) => {
        this.live.power = d.power;
        if (d.cadence !== undefined) this.live.cadence = d.cadence;
        this.live.powerAge = 0;
      }),
      source.onState(() => this.changed.emit(this.summary())),
    ];
    if (old && old !== source) await old.disconnect().catch(() => undefined);
    this.changed.emit(this.summary());
  }

  private async setHeart(source: HeartRateSource | undefined): Promise<void> {
    const old = this.heart;
    this.unsubHeart.forEach((u) => u());
    this.heart = source;
    this.live.heartRate = 0;
    this.unsubHeart = source ? [
      source.onHeartRate((d) => { if (d.contact !== false) this.live.heartRate = d.bpm; }),
      source.onState(() => this.changed.emit(this.summary())),
    ] : [];
    if (old && old !== source) await old.disconnect().catch(() => undefined);
    this.changed.emit(this.summary());
  }

  /** Use the simulated trainer (and, unless a real strap is connected, the simulated heart). */
  async useSimTrainer(): Promise<SimTrainer> {
    await this.setSport('bike');
    const sim = new SimTrainer(this.simOptions);
    this.simTrainer = sim;
    await this.setPower(sim, sim);
    if (!this.heart || this.heart.info.kind === 'sim') await this.useSimHeart();
    return sim;
  }

  async useSimHeart(): Promise<SimHeartRate> {
    // On the bike the simulated heart follows the power source; running, `tick` feeds it the runner's effort.
    const hr = new SimHeartRate(this.simOptions, this.sport === 'bike' ? this.power : undefined);
    this.simHeart = hr;
    await this.setHeart(hr);
    return hr;
  }

  /** Open the Bluetooth picker for a trainer or power meter. Call from a click. */
  async connectBluetoothTrainer(bt?: Bt): Promise<void> {
    const conn = await connectTrainer(bt);
    await this.setSport('bike');
    this.simTrainer = undefined;
    await this.setPower(conn.source, conn.trainer);
    // A simulated heart should follow the new power source.
    if (this.heart?.info.kind === 'sim') await this.useSimHeart();
  }

  /** Open the Bluetooth picker for a heart-rate sensor. Call from a click. */
  async connectBluetoothHeart(bt?: Bt): Promise<void> {
    const hr = await connectHeartRate(bt);
    this.simHeart = undefined;
    await this.setHeart(hr);
  }

  async removeHeart(): Promise<void> {
    this.simHeart = undefined;
    await this.setHeart(undefined);
  }

  /** Advance simulated devices and the staleness clock. */
  tick(dt: number): void {
    this.live.powerAge += dt;
    this.simTrainer?.tick(dt);
    if (this.sport === 'run') {
      this.simTreadmill?.tick(dt);
      this.beltAge += dt;
      if (!this.belt) this.live.speed = this.podSpeed;
      // A treadmill that goes quiet should read as stopped.
      if (this.belt?.info.kind === 'bluetooth' && this.beltAge > 4) this.live.speed = 0;
      if (this.simHeart) {
        const ftp = this.simOptions.ftp ?? 250;
        this.simHeart.setPower(runEffort(this.live.speed, this.live.incline, this.simOptions.thresholdSpeed ?? 4) * ftp);
      }
    }
    this.simHeart?.tick(dt);
    // A real device that goes quiet (dropped connection) should read as zero, not as its last value.
    if (this.live.powerAge > 4 && this.power?.info.kind === 'bluetooth') {
      this.live.power = 0;
      this.live.cadence = 0;
    }
  }

  /**
   * Apply the workout's wishes: hold `watts` in ERG, or switch the trainer
   * to flat-road simulation when ERG is off. Safe to call every frame; it only talks to the trainer
   * when something changes. The simulated rider is told the target either way.
   */
  applyTarget(watts: number | undefined, erg: boolean, cadence?: number): void {
    this.simTrainer?.setRiderTarget(watts ?? 0, cadence);
    if (!this.trainer) return;
    const want = erg && watts !== undefined ? Math.round(watts) : undefined;
    if (want === this.lastTarget) return;
    this.lastTarget = want;
    // Out of ERG the trainer simulates a flat road, so the rider has something to push against in a sprint.
    const p = want === undefined ? this.trainer.setSimulation({ grade: 0 }) : this.trainer.setTargetPower(want);
    p.catch(() => { this.lastTarget = NaN; }); // retry on the next call
  }

  /** Free riding: send the road grade (percent) to the trainer's simulation mode. */
  applyGrade(grade: number): void {
    if (!this.trainer) return;
    const key = -100000 - Math.round(grade * 10);
    if (key === this.lastTarget) return;
    this.lastTarget = key;
    this.trainer.setSimulation({ grade }).catch(() => { this.lastTarget = NaN; });
  }

  /* ---------------------------------------------------------------- */
  /* Running                                                           */
  /* ---------------------------------------------------------------- */

  /** Switch between bike and run devices. Disconnects the other sport's devices. */
  async setSport(sport: DeviceSport): Promise<void> {
    if (sport === this.sport) return;
    this.sport = sport;
    Object.assign(this.live, { power: 0, cadence: 0, speed: 0, incline: 0 });
    if (sport === 'run') {
      this.unsubPower.forEach((u) => u());
      this.unsubPower = [];
      await this.power?.disconnect().catch(() => undefined);
      this.power = this.trainer = this.simTrainer = undefined;
    } else {
      await this.setBelt(undefined);
      await this.setPod(undefined);
    }
    if (!this.heart || this.heart.info.kind === 'sim') await this.useSimHeart();
    this.changed.emit(this.summary());
  }

  private async setBelt(source: RunSource | undefined, treadmill?: FtmsTreadmill): Promise<void> {
    const old = this.belt;
    this.unsubBelt.forEach((u) => u());
    this.belt = source;
    this.treadmill = treadmill;
    this.lastSpeed = this.lastIncline = undefined;
    this.live.speed = 0;
    this.live.incline = 0;
    this.unsubBelt = [];
    if (source) {
      this.unsubBelt.push(
        source.onRun((d) => {
          if (d.speed !== undefined) { this.live.speed = d.speed; this.beltAge = 0; }
          if (d.incline !== undefined) this.live.incline = d.incline;
          if (d.power !== undefined && !this.pod) this.live.power = d.power;
        }),
        source.onState(() => this.changed.emit(this.summary())),
      );
    }
    if (treadmill) {
      treadmill.limits = this.treadmillLimits;
      this.unsubBelt.push(treadmill.onStatus(() => {
        if (treadmill.stoppedByRunner) this.runnerStopped.emit();
        this.changed.emit(this.summary());
      }));
    }
    if (old && old !== source) await old.disconnect().catch(() => undefined);
    this.changed.emit(this.summary());
  }

  private async setPod(source: RunSource | undefined): Promise<void> {
    const old = this.pod;
    this.unsubPod.forEach((u) => u());
    this.pod = source;
    this.podSpeed = 0;
    this.unsubPod = source ? [
      source.onRun((d) => {
        if (d.cadence !== undefined) this.live.cadence = d.cadence;
        if (d.power !== undefined) this.live.power = d.power;
        if (d.speed !== undefined) this.podSpeed = d.speed;
      }),
      source.onState(() => this.changed.emit(this.summary())),
    ] : [];
    if (old && old !== source && !(old.info.kind === 'sim' && source?.info.kind === 'sim')) await old.disconnect().catch(() => undefined);
    this.changed.emit(this.summary());
  }

  /** Use the simulated treadmill, with its runner's footpod (and a simulated heart unless a real strap is connected). */
  async useSimTreadmill(): Promise<SimTreadmill> {
    await this.setSport('run');
    const sim = new SimTreadmill(this.simOptions);
    this.simTreadmill = sim;
    await this.setBelt(sim, sim);
    await this.setPod(sim.footpod);
    if (!this.heart || this.heart.info.kind === 'sim') await this.useSimHeart();
    return sim;
  }

  /** Open the Bluetooth picker for a treadmill. Call from a click. */
  async connectBluetoothTreadmill(bt?: Bt): Promise<void> {
    const t = await connectTreadmill(bt);
    await this.setSport('run');
    if (this.simTreadmill) {
      // The simulated footpod belongs to the simulated runner; it goes with them.
      if (this.pod?.info.kind === 'sim') await this.setPod(undefined);
      this.simTreadmill = undefined;
    }
    await this.setBelt(t, t);
  }

  /** Open the Bluetooth picker for a footpod. Call from a click. */
  async connectBluetoothFootpod(bt?: Bt): Promise<void> {
    const pod = await connectFootpod(bt);
    await this.setSport('run');
    await this.setPod(pod);
  }

  /** Run with a footpod only (no treadmill data): speed comes from the pod. */
  async removeTreadmill(): Promise<void> {
    this.simTreadmill = undefined;
    await this.setBelt(undefined);
  }

  /**
   * Running: apply the workout's wishes. With treadmill control on, send the
   * target speed (and incline) to a controllable treadmill; otherwise the
   * runner sets it. Safe to call every frame: it only talks to the treadmill
   * when something changes, and never once the runner has stopped the belt.
   */
  applyRunTarget(speed: number | undefined, incline?: number): void {
    this.simTreadmill?.setRunnerTarget(speed);
    const t = this.treadmill;
    if (!t || !t.controllable || !this.treadmillControl || t.stoppedByRunner) return;
    if (speed !== undefined && (this.lastSpeed === undefined || Math.abs(speed - this.lastSpeed) > 0.01)) {
      this.lastSpeed = speed;
      t.setTargetSpeed(speed).catch(() => { this.lastSpeed = undefined; });
    }
    const inc = incline ?? 0;
    if (this.lastIncline === undefined || Math.abs(inc - this.lastIncline) > 0.05) {
      this.lastIncline = inc;
      t.setTargetIncline(inc).catch(() => { this.lastIncline = undefined; });
    }
  }

  /** Pause or end a run: stop the belt if the game controls it. */
  async stopBelt(pause = true): Promise<void> {
    this.lastSpeed = undefined;
    if (this.treadmill?.controllable && this.treadmillControl) await this.treadmill.stop(pause).catch(() => undefined);
  }

  /** The runner chose to carry on after stopping the belt: allow speeds again (the next target restarts it). */
  resumeBelt(): void {
    this.treadmill?.resume();
    this.lastSpeed = undefined;
    this.changed.emit(this.summary());
  }

  async disconnectAll(): Promise<void> {
    this.unsubPower.forEach((u) => u());
    this.unsubHeart.forEach((u) => u());
    await this.power?.disconnect().catch(() => undefined);
    await this.heart?.disconnect().catch(() => undefined);
    await this.setBelt(undefined);
    await this.setPod(undefined);
    this.power = this.trainer = this.heart = undefined;
    this.simTrainer = this.simHeart = undefined;
    this.simTreadmill = undefined;
    this.changed.emit(this.summary());
  }
}
