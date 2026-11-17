import { paceToEffort } from '../workout/effort';
import type { RideSample } from './recorder';

/** Coggan power zones as upper bounds (fraction of FTP). Zone 7 is open-ended. */
export const POWER_ZONE_BOUNDS = [0.55, 0.75, 0.9, 1.05, 1.2, 1.5];
export const POWER_ZONE_NAMES = ['Recovery', 'Endurance', 'Tempo', 'Threshold', 'VO2 max', 'Anaerobic', 'Neuromuscular'];
/** Heart-rate zones as upper bounds (fraction of max HR). Zone 5 is open-ended. */
export const HR_ZONE_BOUNDS = [0.6, 0.7, 0.8, 0.9];

export function powerZone(watts: number, ftp: number): number {
  const f = watts / ftp;
  for (let i = 0; i < POWER_ZONE_BOUNDS.length; i++) if (f < POWER_ZONE_BOUNDS[i]) return i + 1;
  return 7;
}

export function hrZone(bpm: number, maxHr: number): number {
  const f = bpm / maxHr;
  for (let i = 0; i < HR_ZONE_BOUNDS.length; i++) if (f < HR_ZONE_BOUNDS[i]) return i + 1;
  return 5;
}

/**
 * Normalised power: 30 s rolling average of power, raised to the fourth power,
 * averaged, then the fourth root. Rides shorter than 30 s fall back to average power.
 * Expects one value per second.
 */
export function normalisedPower(power: number[]): number {
  const n = power.length;
  if (n === 0) return 0;
  if (n < 30) return power.reduce((a, b) => a + b, 0) / n;
  let window = 0;
  for (let i = 0; i < 30; i++) window += power[i];
  let acc = 0;
  let count = 0;
  for (let i = 29; i < n; i++) {
    if (i > 29) window += power[i] - power[i - 30];
    const avg = window / 30;
    acc += avg * avg * avg * avg;
    count++;
  }
  return Math.pow(acc / count, 0.25);
}

export interface SummaryOptions {
  sport?: 'bike' | 'run';
  /** Runner's threshold speed, m/s: scores a run that has no power data. */
  thresholdSpeed?: number;
  /** Body mass, kg, for a run's calories when there is no power. */
  mass?: number;
}

export interface RideSummary {
  sport: 'bike' | 'run';
  /** Seconds. */
  duration: number;
  /** Metres: from the bike model, a map's terrain, or the treadmill or footpod. */
  distance: number;
  /** True when any sample had power (a run without a power-reporting footpod has none). */
  hasPower: boolean;
  /**
   * For runs: normalised speed (the speed counterpart of normalised power), m/s.
   * Intensity and training stress for a run without power come from this.
   */
  normalisedSpeed?: number;
  avgPower: number;
  maxPower: number;
  normalisedPower: number;
  /** Mechanical work, kilojoules. */
  kilojoules: number;
  /** Rough energy burned, kcal (work at about 24% gross efficiency, which lands close to 1 kcal per kJ). */
  calories: number;
  intensityFactor: number;
  trainingStress: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  avgCadence?: number;
  maxCadence?: number;
  avgSpeed: number;
  maxSpeed: number;
  /** Seconds in power zones 1 to 7 (for a run without power, effort zones from pace). */
  timeInPowerZones: number[];
  /** Seconds in heart-rate zones 1 to 5 (empty when there was no heart-rate data). */
  timeInHrZones: number[];
}

export function summarise(samples: RideSample[], ftp: number, maxHr?: number, opts: SummaryOptions = {}): RideSummary {
  const sport = opts.sport ?? 'bike';
  const n = samples.length;
  const power = samples.map((s) => s.power);
  let sumP = 0, maxP = 0, sumHr = 0, nHr = 0, maxH = 0, sumCad = 0, nCad = 0, maxCad = 0, maxSpeed = 0;
  const pz = [0, 0, 0, 0, 0, 0, 0];
  const hz = [0, 0, 0, 0, 0];
  for (const s of samples) {
    sumP += s.power;
    if (s.power > maxP) maxP = s.power;
    pz[powerZone(s.power, ftp) - 1]++;
    if (s.heartRate !== undefined && s.heartRate > 0) {
      sumHr += s.heartRate; nHr++;
      if (s.heartRate > maxH) maxH = s.heartRate;
      if (maxHr) hz[hrZone(s.heartRate, maxHr) - 1]++;
    }
    // Average cadence excludes coasting, as head units do.
    if (s.cadence !== undefined && s.cadence > 0) {
      sumCad += s.cadence; nCad++;
      if (s.cadence > maxCad) maxCad = s.cadence;
    }
    if (s.bikeSpeed > maxSpeed) maxSpeed = s.bikeSpeed;
  }
  const avgPower = n ? sumP / n : 0;
  const np = normalisedPower(power);
  const kj = sumP / 1000; // one sample per second, so the sum of watts is joules
  const distance = n ? samples[n - 1].distance : 0;
  const hasPower = maxP > 0;
  let intensity = ftp > 0 ? np / ftp : 0;
  let calories = kj / 4.184 / 0.24;
  let normalisedSpeed: number | undefined;
  if (sport === 'run' && !hasPower && opts.thresholdSpeed) {
    // No power: time in zones goes by running effort instead, so the zone bar still means something.
    pz.fill(0);
    for (const x of samples) pz[powerZone(paceToEffort(x.bikeSpeed / (opts.thresholdSpeed as number)) * 100, 100) - 1]++;
  }
  if (sport === 'run') {
    // The same rolling fourth-power average, on speed. Effort, not speed, is what is scored,
    // so the result goes through the running effort curve (threshold pace = intensity 1).
    normalisedSpeed = normalisedPower(samples.map((s) => s.bikeSpeed));
    if (!hasPower && opts.thresholdSpeed) intensity = paceToEffort(normalisedSpeed / opts.thresholdSpeed);
    // Running costs about 1 kcal per kilogram per kilometre, whatever the pace.
    if (!hasPower) calories = (distance / 1000) * (opts.mass ?? 70);
  }
  return {
    sport, duration: n, distance, hasPower, normalisedSpeed, avgPower, maxPower: maxP, normalisedPower: np, kilojoules: kj,
    calories,
    intensityFactor: intensity,
    trainingStress: (n / 3600) * intensity * intensity * 100,
    avgHeartRate: nHr ? sumHr / nHr : undefined,
    maxHeartRate: nHr ? maxH : undefined,
    avgCadence: nCad ? sumCad / nCad : undefined,
    maxCadence: nCad ? maxCad : undefined,
    avgSpeed: n ? distance / n : 0,
    maxSpeed,
    timeInPowerZones: pz,
    timeInHrZones: nHr && maxHr ? hz : [],
  };
}
