/**
 * Workout model.
 *
 * Authors write `StepSpec`s (which may include interval sets). The engine
 * runs a flat list of `WorkoutStep`s produced by `buildWorkout`. All power
 * targets are stored as either a fraction of FTP (1.0 = FTP) or absolute watts.
 */

export type PowerUnit = 'ftp' | 'watts';

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
  cadence?: number;
  label?: string;
}

export type StepSpec =
  | (LegSpec & { kind: 'steady'; erg?: boolean; intensity?: Intensity; texts?: TextEvent[] })
  | {
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
  throw new WorkoutError('A steady step needs either "power" (fraction of FTP) or "watts"');
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
          kind: 'ramp', duration: s.duration, target: { unit: s.unit ?? 'ftp', from: s.from, to: s.to },
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

/** Peak target of a step as a fraction of FTP (0 for free ride). */
export function stepPeakFraction(step: WorkoutStep, ftp: number): number {
  if (!step.target) return 0;
  return toFtpFraction(Math.max(step.target.from, step.target.to), step.target.unit, ftp);
}
