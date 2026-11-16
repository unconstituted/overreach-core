import { connectHeartRate, connectTrainer, type Bt } from './bluetooth';
import { SimHeartRate, SimTrainer, type SimHeartOptions, type SimRiderOptions } from './sim';
import {
  Emitter, type ConnectionState, type ControllableTrainer, type HeartRateSource, type PowerSource, type Unsubscribe,
} from './types';

export interface LiveRider {
  power: number;
  cadence: number;
  /** Zero when no heart-rate source is connected. */
  heartRate: number;
  /** Seconds since the last power packet (by the manager's clock), to detect a stalled device. */
  powerAge: number;
}

export interface DeviceSummary {
  power?: { name: string; protocol: string; state: ConnectionState; kind: 'sim' | 'bluetooth'; controllable: boolean };
  heart?: { name: string; protocol: string; state: ConnectionState; kind: 'sim' | 'bluetooth' };
}

/**
 * Owns the current power and heart-rate sources and exposes the latest
 * readings. The game reads `live` each frame and calls `tick(dt)`; it does
 * not care whether the data comes from Bluetooth or the simulator.
 */
export class DeviceManager {
  readonly live: LiveRider = { power: 0, cadence: 0, heartRate: 0, powerAge: 0 };
  readonly changed = new Emitter<DeviceSummary>();
  power?: PowerSource;
  trainer?: ControllableTrainer;
  heart?: HeartRateSource;
  simTrainer?: SimTrainer;
  simHeart?: SimHeartRate;
  private unsubPower: Unsubscribe[] = [];
  private unsubHeart: Unsubscribe[] = [];
  private lastTarget?: number;

  constructor(private readonly simOptions: SimRiderOptions & SimHeartOptions = {}) {}

  summary(): DeviceSummary {
    return {
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
    const sim = new SimTrainer(this.simOptions);
    this.simTrainer = sim;
    await this.setPower(sim, sim);
    if (!this.heart || this.heart.info.kind === 'sim') await this.useSimHeart();
    return sim;
  }

  async useSimHeart(): Promise<SimHeartRate> {
    const hr = new SimHeartRate(this.simOptions, this.power);
    this.simHeart = hr;
    await this.setHeart(hr);
    return hr;
  }

  /** Open the Bluetooth picker for a trainer or power meter. Call from a click. */
  async connectBluetoothTrainer(bt?: Bt): Promise<void> {
    const conn = await connectTrainer(bt);
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

  async disconnectAll(): Promise<void> {
    this.unsubPower.forEach((u) => u());
    this.unsubHeart.forEach((u) => u());
    await this.power?.disconnect().catch(() => undefined);
    await this.heart?.disconnect().catch(() => undefined);
    this.power = this.trainer = this.heart = undefined;
    this.simTrainer = this.simHeart = undefined;
    this.changed.emit(this.summary());
  }
}
