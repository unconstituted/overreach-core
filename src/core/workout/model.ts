/**
 * Workout model.
 *
 * Authors write `StepSpec`s (which may include interval sets). The engine
 * runs a flat list of `WorkoutStep`s produced by `buildWorkout`. Targets are
 * power (fraction of FTP or watts), running pace (fraction of threshold speed
 * or metres per second) or heart rate (fraction of maximum or bpm).
 */

import { effortToPace } from './effort';

/**
 * How a target is expressed.
 *  - "ftp": fraction of FTP (1.0 = FTP)          - "watts": absolute power
 *  - "pace": fraction of threshold speed (1.0 = threshold pace; 1.1 = 10% faster)
 *  - "speed": metres per second
 *  - "hr": fraction of maximum heart rate       - "bpm": beats per minute
 */
export type TargetUnit = 'ftp' | 'watts' | 'pace' | 'speed' | 'hr' | 'bpm';
/** Kept for older code: any target unit. */
export type PowerUnit = TargetUnit;
export type TargetKind = 'power' | 'pace' | 'hr';

/** The athlete's reference values that fractional targets are scaled by. */
export interface Thresholds {
  /** Watts. */
  ftp: number;
  /** Threshold running speed, metres per second. */
  thresholdSpeed?: number;
  /** Beats per minute. */
  maxHr?: number;
}

/** Used when a threshold is needed but was not given: 5:00 /km and 185 bpm. */
export const DEFAULT_THRESHOLD_SPEED = 1000 / 300;
export const DEFAULT_MAX_HR = 185;

export function targetKind(unit: TargetUnit): TargetKind {
  return unit === 'ftp' || unit === 'watts' ? 'power' : unit === 'pace' || unit === 'speed' ? 'pace' : 'hr';
}

function reference(unit: TargetUnit, th: Thresholds): number {
  const kind = targetKind(unit);
  return kind === 'power' ? th.ftp : kind === 'pace' ? th.thresholdSpeed ?? DEFAULT_THRESHOLD_SPEED : th.maxHr ?? DEFAULT_MAX_HR;
}

/** A target value in absolute terms: watts, metres per second or beats per minute. */
export function toAbsolute(value: number, unit: TargetUnit, th: Thresholds): number {
  return unit === 'watts' || unit === 'speed' || unit === 'bpm' ? value : value * reference(unit, th);
}

/** A target value as a fraction of the matching threshold. */
export function toFraction(value: number, unit: TargetUnit, th: Thresholds): number {
  return unit === 'ftp' || unit === 'pace' || unit === 'hr' ? value : value / reference(unit, th);
}

/** Seconds per kilometre to metres per second, and back. */
export function paceToSpeed(secondsPerKm: number): number {
  return 1000 / secondsPerKm;
}
export function speedToPace(metresPerSecond: number): number {
  return metresPerSecond > 0 ? 1000 / metresPerSecond : Infinity;
}

/** "4:32" for a speed, per kilometre or per mile. A dash when standing still. */
export function formatPace(metresPerSecond: number, units: 'metric' | 'imperial' = 'metric'): string {
  if (!(metresPerSecond > 0.3)) return '–:––';
  const s = Math.round((units === 'imperial' ? 1609.344 : 1000) / metresPerSecond);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface TextEvent {
  /** Seconds from the start of the step. */
  offset: number;
  message: string;
  /** Seconds to keep the message on screen, if the source specified it. */
  duration?: number;
}

export interface PowerTarget {
  unit: PowerUnit;
  /** Target at the start of the step. */
  from: number;
  /** Target at the end of the step. Equal to `from` for a steady step. */
  to: number;
  /** Optional acceptable band (same unit), e.g. from a FIT custom target range. */
  low?: number;
  high?: number;
}

export type StepKind = 'steady' | 'ramp' | 'free';
export type Intensity = 'warmup' | 'active' | 'recovery' | 'rest' | 'cooldown' | 'interval';

export interface WorkoutStep {
  kind: StepKind;
  /** Seconds. */
  duration: number;
  /** Absent for free ride. */
  target?: PowerTarget;
  /** Cadence target in rpm. */
  cadence?: number;
  /** Whether the trainer should hold the target (ERG). Free ride is always false. */
  erg: boolean;
  label?: string;
  intensity?: Intensity;
  texts: TextEvent[];
  /** Set when the step came from an interval set. */
  set?: { index: number; rep: number; of: number; phase: 'on' | 'off' };
}

export interface Workout {
  name: string;
  description?: string;
  author?: string;
  sport: 'bike' | 'run';
  steps: WorkoutStep[];
}

/** One leg of an interval set, or the body of a simple step. */
export interface LegSpec {
  duration: number;
  /** Shorthand: fraction of FTP for a steady target. */
  power?: number;
  /** Shorthand: absolute watts for a steady target. */
  watts?: number;
  /** Running: fraction of threshold speed (1.0 = threshold pace). */
  pace?: number;
  /** Running: an absolute pace, seconds per kilometre. */
  secPerKm?: number;
  /** Fraction of maximum heart rate. */
  hr?: number;
  /** Heart rate, beats per minute. */
  bpm?: number;
  cadence?: number;
  label?: string;
}

export type StepSpec =
  | (LegSpec & { kind: 'steady'; erg?: boolean; intensity?: Intensity; texts?: TextEvent[] })
  | {
      /** `from` and `to` are fractions of FTP, or of threshold pace in a run workout, unless `unit` says otherwise. */
      kind: 'ramp'; duration: number; from: number; to: number; unit?: PowerUnit;
      cadence?: number; erg?: boolean; label?: string; intensity?: Intensity; texts?: TextEvent[];
    }
  | { kind: 'free'; duration: number; cadence?: number; label?: string; intensity?: Intensity; texts?: TextEvent[] }
  | { kind: 'intervals'; repeat: number; on: LegSpec; off: LegSpec; erg?: boolean; texts?: TextEvent[] };

export interface WorkoutSpec {
  name: string;
  description?: string;
  author?: string;
  sport?: 'bike' | 'run';
  steps: StepSpec[];
}

export class WorkoutError extends Error {}

function legTarget(leg: LegSpec): PowerTarget {
  if (leg.watts !== undefined) return { unit: 'watts', from: leg.watts, to: leg.watts };
  if (leg.power !== undefined) return { unit: 'ftp', from: leg.power, to: leg.power };
  if (leg.pace !== undefined) return { unit: 'pace', from: leg.pace, to: leg.pace };
  if (leg.secPerKm !== undefined) { const v = paceToSpeed(leg.secPerKm); return { unit: 'speed', from: v, to: v }; }
  if (leg.hr !== undefined) return { unit: 'hr', from: leg.hr, to: leg.hr };
  if (leg.bpm !== undefined) return { unit: 'bpm', from: leg.bpm, to: leg.bpm };
  throw new WorkoutError('A steady step needs a target: "power" (fraction of FTP), "watts", "pace", "secPerKm", "hr" or "bpm"');
}

function checkDuration(d: number): void {
  if (!Number.isFinite(d) || d <= 0) throw new WorkoutError(`Step duration must be positive, got ${d}`);
}

/** Expand author-facing specs into the flat step list the runner uses. */
export function buildWorkout(spec: WorkoutSpec): Workout {
  const steps: WorkoutStep[] = [];
  let setIndex = 0;
  for (const s of spec.steps) {
    switch (s.kind) {
      case 'steady':
        checkDuration(s.duration);
        steps.push({
          kind: 'steady', duration: s.duration, target: legTarget(s), cadence: s.cadence,
          erg: s.erg ?? true, label: s.label, intensity: s.intensity, texts: sortTexts(s.texts),
        });
        break;
      case 'ramp':
        checkDuration(s.duration);
        steps.push({
          kind: 'ramp', duration: s.duration, target: { unit: s.unit ?? (spec.sport === 'run' ? 'pace' : 'ftp'), from: s.from, to: s.to },
          cadence: s.cadence, erg: s.erg ?? true, label: s.label, intensity: s.intensity, texts: sortTexts(s.texts),
        });
        break;
      case 'free':
        checkDuration(s.duration);
        steps.push({
          kind: 'free', duration: s.duration, cadence: s.cadence, erg: false,
          label: s.label, intensity: s.intensity, texts: sortTexts(s.texts),
        });
        break;
      case 'intervals': {
        if (!Number.isInteger(s.repeat) || s.repeat < 1) throw new WorkoutError('Interval repeat must be a whole number of 1 or more');
        checkDuration(s.on.duration);
        checkDuration(s.off.duration);
        // Text offsets on a set are measured from the start of the whole set.
        const texts = sortTexts(s.texts);
        let setT = 0;
        for (let rep = 1; rep <= s.repeat; rep++) {
          for (const phase of ['on', 'off'] as const) {
            const leg = phase === 'on' ? s.on : s.off;
            const mine = texts
              .filter((t) => t.offset >= setT && t.offset < setT + leg.duration)
              .map((t) => ({ ...t, offset: t.offset - setT }));
            steps.push({
              kind: 'steady', duration: leg.duration, target: legTarget(leg), cadence: leg.cadence,
              erg: s.erg ?? true, label: leg.label, intensity: phase === 'on' ? 'interval' : 'recovery',
              texts: mine, set: { index: setIndex, rep, of: s.repeat, phase },
            });
            setT += leg.duration;
          }
        }
        setIndex++;
        break;
      }
    }
  }
  if (steps.length === 0) throw new WorkoutError('A workout needs at least one step');
  return { name: spec.name, description: spec.description, author: spec.author, sport: spec.sport ?? 'bike', steps };
}

function sortTexts(texts?: TextEvent[]): TextEvent[] {
  return texts ? [...texts].sort((a, b) => a.offset - b.offset) : [];
}

export function totalDuration(w: Workout): number {
  let t = 0;
  for (const s of w.steps) t += s.duration;
  return t;
}

/** Start time of each step, plus the total as the final element. */
export function stepStarts(w: Workout): number[] {
  const out: number[] = [0];
  for (const s of w.steps) out.push(out[out.length - 1] + s.duration);
  return out;
}

/** Target at `tInStep` seconds into a step, in the step's own unit. Undefined for free ride. */
export function targetAt(step: WorkoutStep, tInStep: number): number | undefined {
  if (!step.target) return undefined;
  const { from, to } = step.target;
  if (step.kind !== 'ramp' || step.duration <= 0) return from;
  const k = Math.min(1, Math.max(0, tInStep / step.duration));
  return from + (to - from) * k;
}

/** Convert a target value to watts for a rider's FTP. */
export function toWatts(value: number, unit: PowerUnit, ftp: number): number {
  return unit === 'watts' ? value : value * ftp;
}

/** Convert a target value to a fraction of FTP. */
export function toFtpFraction(value: number, unit: PowerUnit, ftp: number): number {
  return unit === 'ftp' ? value : value / ftp;
}

/** Peak target of a step as a fraction of its threshold (0 for free ride). Pass an FTP or full thresholds. */
export function stepPeakFraction(step: WorkoutStep, th: number | Thresholds): number {
  if (!step.target) return 0;
  const t = typeof th === 'number' ? { ftp: th } : th;
  const peak = toFraction(Math.max(step.target.from, step.target.to), step.target.unit, t);
  // Heart-rate targets reach "threshold" at about 90% of maximum.
  return targetKind(step.target.unit) === 'hr' ? peak / 0.9 : peak;
}

/** The kind of target a workout mostly uses: decides the hero number on the HUD. */
export function workoutKind(w: Workout): TargetKind {
  const time: Record<TargetKind, number> = { power: 0, pace: 0, hr: 0 };
  for (const s of w.steps) if (s.target) time[targetKind(s.target.unit)] += s.duration;
  if (time.pace === 0 && time.hr === 0 && time.power === 0) return w.sport === 'run' ? 'pace' : 'power';
  return time.pace >= time.power && time.pace >= time.hr ? (time.pace > 0 ? 'pace' : 'power') : time.power >= time.hr ? 'power' : 'hr';
}

/**
 * The same session for a runner: power targets become pace targets at the
 * same effort (see `effort.ts`): 50% of FTP maps to 80% of threshold speed,
 * 120% to 108%. Cadence targets are dropped (running cadence is not pedal
 * cadence), and every target step runs with the treadmill in control.
 */
export function asRun(w: Workout): Workout {
  const map = (f: number): number => Math.round(Math.max(0.5, effortToPace(f)) * 1000) / 1000;
  return {
    ...w, sport: 'run',
    steps: w.steps.map((s) => {
      if (!s.target || s.target.unit !== 'ftp') return { ...s, erg: false, cadence: undefined, texts: s.texts.map((t) => ({ ...t })) };
      return { ...s, erg: true, cadence: undefined, target: { unit: 'pace' as const, from: map(s.target.from), to: map(s.target.to) }, texts: s.texts.map((t) => ({ ...t })) };
    }),
  };
}
