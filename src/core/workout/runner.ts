import {
  stepPeakFraction, stepStarts, targetAt, targetKind, toAbsolute, toFraction,
  type TargetKind, type TextEvent, type Thresholds, type Workout, type WorkoutStep,
} from './model';

export interface Cue {
  kind: 'spin-up';
  /** Index of the step the cue announces. */
  stepIndex: number;
  /** Absolute time the cue first shows. */
  from: number;
  /** Absolute time the hard step starts. */
  at: number;
}

export interface ActiveCue extends Cue {
  /** Whole seconds until the step starts (5, 4, 3, 2, 1). */
  inSeconds: number;
  message: string;
}

export interface TimedText extends TextEvent {
  /** Absolute time in the workout. */
  at: number;
  stepIndex: number;
}

export interface RunnerState {
  elapsed: number;
  finished: boolean;
  totalDuration: number;
  timeLeft: number;
  stepIndex: number;
  step: WorkoutStep;
  stepStart: number;
  timeInStep: number;
  timeLeftInStep: number;
  /** What the current target is expressed in. Undefined during free ride. */
  targetKind?: TargetKind;
  /** The target in absolute terms: watts, metres per second or beats per minute. */
  targetValue?: number;
  /** Power target in watts. Undefined during free ride and for pace or heart-rate steps. */
  targetWatts?: number;
  /** Pace target as a speed in metres per second. */
  targetSpeed?: number;
  /** Heart-rate target in beats per minute. */
  targetHr?: number;
  /** Target as a fraction of its threshold (FTP, threshold speed or max heart rate). Undefined during free ride. */
  targetFraction?: number;
  /** Acceptable band in watts, when the source defined one. */
  bandWatts?: { low: number; high: number };
  erg: boolean;
  cadence?: number;
  next?: { step: WorkoutStep; stepIndex: number; startsIn: number; targetWatts?: number; targetKind?: TargetKind; targetValue?: number };
  cues: ActiveCue[];
  /** Text events currently on screen. */
  texts: TimedText[];
}

export interface RunnerOptions {
  /** Seconds of warning before a hard step. */
  cueLead?: number;
  /** Fraction of FTP at or above which a step earns a spin-up cue. */
  cueThreshold?: number;
  /** Seconds a text event stays up when the file gives no duration. */
  textHold?: number;
}

/**
 * The workout runner. Stateless with respect to time: every query takes the
 * elapsed time, so the ride can be paused, scrubbed or replayed freely.
 */
export class WorkoutRunner {
  readonly starts: number[];
  readonly total: number;
  readonly cues: Cue[];
  readonly texts: TimedText[];
  private readonly lead: number;
  private readonly textHold: number;

  readonly ftp: number;
  readonly thresholds: Thresholds;

  /** `athlete` is an FTP in watts, or the full set of thresholds (needed for pace and heart-rate targets). */
  constructor(readonly workout: Workout, athlete: number | Thresholds, opts: RunnerOptions = {}) {
    this.thresholds = typeof athlete === 'number' ? { ftp: athlete } : { ...athlete };
    const ftp = this.ftp = this.thresholds.ftp;
    if (!(ftp > 0)) throw new Error('FTP must be positive');
    this.lead = opts.cueLead ?? 5;
    this.textHold = opts.textHold ?? 8;
    const threshold = opts.cueThreshold ?? 1.0;
    this.starts = stepStarts(workout);
    this.total = this.starts[this.starts.length - 1];
    this.cues = [];
    this.texts = [];
    workout.steps.forEach((s, i) => {
      const at = this.starts[i];
      // A small tolerance so 100% written as 0.999999 after unit conversion still counts.
      if (stepPeakFraction(s, this.thresholds) >= threshold - 1e-9 && at > 0) {
        this.cues.push({ kind: 'spin-up', stepIndex: i, from: Math.max(0, at - this.lead), at });
      }
      for (const t of s.texts) this.texts.push({ ...t, at: at + t.offset, stepIndex: i });
    });
    this.texts.sort((a, b) => a.at - b.at);
  }

  /** Index of the step containing time `t` (clamped to the workout). */
  stepIndexAt(t: number): number {
    const n = this.workout.steps.length;
    if (t <= 0) return 0;
    if (t >= this.total) return n - 1;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Target watts at time `t`, or undefined in free ride. */
  targetWattsAt(t: number): number | undefined {
    const i = this.stepIndexAt(t);
    const step = this.workout.steps[i];
    const v = targetAt(step, t - this.starts[i]);
    return v === undefined || !step.target || targetKind(step.target.unit) !== 'power' ? undefined : toAbsolute(v, step.target.unit, this.thresholds);
  }

  stateAt(t: number): RunnerState {
    const elapsed = Math.max(0, t);
    const finished = elapsed >= this.total;
    const stepIndex = this.stepIndexAt(elapsed);
    const step = this.workout.steps[stepIndex];
    const stepStart = this.starts[stepIndex];
    const timeInStep = Math.min(step.duration, elapsed - stepStart);
    const raw = targetAt(step, timeInStep);
    const state: RunnerState = {
      elapsed, finished, totalDuration: this.total, timeLeft: Math.max(0, this.total - elapsed),
      stepIndex, step, stepStart, timeInStep, timeLeftInStep: Math.max(0, step.duration - timeInStep),
      erg: step.erg && !finished, cadence: step.cadence, cues: [], texts: [],
    };
    if (raw !== undefined && step.target) {
      const unit = step.target.unit;
      const kind = targetKind(unit);
      const value = toAbsolute(raw, unit, this.thresholds);
      state.targetKind = kind;
      state.targetValue = value;
      state.targetFraction = toFraction(raw, unit, this.thresholds);
      if (kind === 'power') state.targetWatts = value;
      else if (kind === 'pace') state.targetSpeed = value;
      else state.targetHr = value;
      if (kind === 'power' && step.target.low !== undefined && step.target.high !== undefined) {
        state.bandWatts = { low: toAbsolute(step.target.low, unit, this.thresholds), high: toAbsolute(step.target.high, unit, this.thresholds) };
      }
    }
    const nextIndex = stepIndex + 1;
    if (nextIndex < this.workout.steps.length) {
      const next = this.workout.steps[nextIndex];
      const nt = targetAt(next, 0);
      const nk = next.target ? targetKind(next.target.unit) : undefined;
      const nv = nt !== undefined && next.target ? toAbsolute(nt, next.target.unit, this.thresholds) : undefined;
      state.next = {
        step: next, stepIndex: nextIndex, startsIn: Math.max(0, this.starts[nextIndex] - elapsed),
        targetWatts: nk === 'power' ? nv : undefined, targetKind: nk, targetValue: nv,
      };
    }
    if (!finished) {
      for (const c of this.cues) {
        if (elapsed >= c.from && elapsed < c.at) {
          const inSeconds = Math.max(1, Math.ceil(c.at - elapsed));
          state.cues.push({ ...c, inSeconds, message: `${this.workout.sport === 'run' ? 'Pick it up' : 'Spin up'} in ${inSeconds}` });
        }
      }
      for (const x of this.texts) {
        if (x.at > elapsed) break;
        if (elapsed < x.at + (x.duration ?? this.textHold)) state.texts.push(x);
      }
    }
    return state;
  }

  /** Text events whose start falls in (prev, t]. Use for one-shot display when playing forwards. */
  textsBetween(prev: number, t: number): TimedText[] {
    return this.texts.filter((x) => x.at > prev && x.at <= t);
  }

  /** Step boundaries crossed in (prev, t], as step indices that began. */
  stepsStartedBetween(prev: number, t: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.workout.steps.length; i++) {
      if (this.starts[i] > prev && this.starts[i] <= t) out.push(i);
    }
    return out;
  }
}
