import { DEFAULT_BIKE, stepBikeSpeed, type BikeParams } from './physics';

/** One second of ride data. */
export interface RideSample {
  /** Whole seconds since the ride started (the sample covers t-1 to t). */
  t: number;
  /** Watts, averaged over the second. */
  power: number;
  cadence?: number;
  heartRate?: number;
  /** In-game speed, m/s (story speed; not written to the FIT record's speed field). */
  gameSpeed: number;
  /** Realistic speed from the bike model, m/s. */
  bikeSpeed: number;
  /** Cumulative realistic distance, metres. */
  distance: number;
}

export interface LapMarker {
  /** Seconds since the ride started. */
  t: number;
  label?: string;
}

export interface LiveData {
  power: number;
  cadence?: number;
  heartRate?: number;
  gameSpeed?: number;
}

export interface Ride {
  /** Unix seconds at the start of the ride. */
  startTime: number;
  samples: RideSample[];
  /** Lap boundaries, excluding the implicit lap that starts at 0. */
  laps: LapMarker[];
}

/**
 * Records a ride at 1 Hz from data arriving at any rate. The caller drives
 * time (`update(elapsed, live)`), so recording is deterministic and pauses
 * naturally when the caller stops advancing the clock.
 */
export class RideRecorder {
  readonly samples: RideSample[] = [];
  readonly laps: LapMarker[] = [];
  private last = 0;
  private accPower = 0;
  private accGame = 0;
  private accTime = 0;
  private lastLive: LiveData = { power: 0 };
  private bikeSpeed = 0;
  private distance = 0;

  constructor(readonly startTime: number, private readonly bike: BikeParams = DEFAULT_BIKE) {}

  /** Feed the latest live data at ride time `elapsed` (seconds, never decreasing). */
  update(elapsed: number, live: LiveData): void {
    if (elapsed < this.last) return; // time never runs backwards in a recording
    let from = this.last;
    while (from < elapsed) {
      const boundary = Math.floor(from) + 1;
      const to = Math.min(elapsed, boundary);
      const dt = to - from;
      // Hold the previous reading until now (zero-order hold), as the data was valid over that span.
      this.accPower += this.lastLive.power * dt;
      this.accGame += (this.lastLive.gameSpeed ?? 0) * dt;
      this.accTime += dt;
      if (to === boundary) this.emit(boundary);
      from = to;
    }
    this.last = elapsed;
    this.lastLive = { ...live };
  }

  private emit(t: number): void {
    const span = this.accTime || 1;
    const power = this.accPower / span;
    this.bikeSpeed = stepBikeSpeed(this.bikeSpeed, power, 1, this.bike);
    this.distance += this.bikeSpeed;
    this.samples.push({
      t, power: Math.round(power), cadence: this.lastLive.cadence, heartRate: this.lastLive.heartRate,
      gameSpeed: this.accGame / span, bikeSpeed: this.bikeSpeed, distance: this.distance,
    });
    this.accPower = 0;
    this.accGame = 0;
    this.accTime = 0;
  }

  /** Mark a lap boundary (for example, when a workout step begins). */
  lap(t: number, label?: string): void {
    const at = Math.round(t);
    if (at <= 0) return;
    const prev = this.laps[this.laps.length - 1];
    if (prev && prev.t >= at) return;
    this.laps.push({ t: at, label });
  }

  get elapsed(): number {
    return this.last;
  }

  ride(): Ride {
    return { startTime: this.startTime, samples: this.samples.slice(), laps: this.laps.slice() };
  }
}
