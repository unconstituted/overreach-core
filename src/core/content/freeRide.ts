import { DEFAULT_BIKE, stepBikeSpeed, type BikeParams } from '../record/physics';
import { gradeAt } from './catalogue';
import type { MapDoc } from './types';

/**
 * A free ride on a map: the rider's power moves a bike along the terrain
 * profile, and that drives both what they see and what the trainer simulates.
 */
export class FreeRide {
  /** Road speed, m/s. */
  speed = 0;
  /** Road distance covered, metres. */
  distance = 0;
  /** Metres climbed. */
  climbed = 0;
  private readonly bike: BikeParams;

  constructor(readonly map: MapDoc, riderWeight = 75) {
    this.bike = { ...DEFAULT_BIKE, mass: riderWeight + 8 };
  }

  /** True grade here, percent. */
  get grade(): number { return gradeAt(this.map.profile, this.distance); }
  get remaining(): number { return Math.max(0, this.map.length - this.distance); }
  get finished(): boolean { return this.distance >= this.map.length; }
  /** Scenery speed and distance: road figures times the map's speed scale. */
  get sceneScale(): number { return this.map.scene.speedScale ?? 12; }

  update(dt: number, power: number): void {
    if (this.finished || dt <= 0) return;
    const grade = this.grade;
    this.speed = stepBikeSpeed(this.speed, power, dt, { ...this.bike, grade: grade / 100 });
    const d = Math.min(this.speed * dt, this.remaining);
    this.distance += d;
    if (grade > 0) this.climbed += (d * grade) / 100;
  }

  /** Grade to send to the trainer, percent, after the player's "trainer difficulty" setting. */
  trainerGrade(scale: number): number {
    return Math.round(this.grade * scale * 10) / 10;
  }

  /** Field of view for the current speed, between the map's rest and full-speed values. */
  fov(): number {
    const [lo, hi] = this.map.scene.fov ?? [70, 92];
    return lo + (hi - lo) * Math.min(1, this.speed / 14);
  }
}
