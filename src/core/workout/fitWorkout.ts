import { BaseType, decodeFit, FitWriter, Mesg, messagesOf } from '../fit';
import { type Intensity, type PowerTarget, type Workout, type WorkoutStep, WorkoutError } from './model';

const INTENSITY: Intensity[] = ['active', 'rest', 'warmup', 'cooldown', 'recovery', 'interval'];

const DURATION_TIME = 0;
const DURATION_OPEN = 5;
const DURATION_REPEAT = 6;
const TARGET_OPEN = 2;
const TARGET_CADENCE = 3;
const TARGET_POWER = 4;

/** Coggan zone midpoints, used when a FIT step names a power zone rather than a custom range. */
const ZONE_RANGES: [number, number][] = [
  [0.45, 0.55], [0.56, 0.75], [0.76, 0.9], [0.91, 1.05], [1.06, 1.2], [1.21, 1.5], [1.5, 2.0],
];

/** FIT custom power values: 0 to 1000 are % FTP; above 1000 are watts + 1000. */
function powerRange(low: number, high: number): PowerTarget {
  const isWatts = low > 1000 || high > 1000;
  const lo = isWatts ? low - 1000 : low / 100;
  const hi = isWatts ? high - 1000 : high / 100;
  const mid = (lo + hi) / 2;
  return { unit: isWatts ? 'watts' : 'ftp', from: mid, to: mid, low: lo, high: hi };
}

/**
 * Parse a FIT workout file (the `workout` and `workout_step` messages).
 * Time-based steps with power targets become steady steps; open targets become
 * free ride; repeat steps are expanded. A step's notes become a text event at
 * the start of the step, since that is how head units show them.
 */
export function parseFitWorkout(bytes: Uint8Array): Workout {
  const file = decodeFit(bytes);
  const wk = messagesOf(file, Mesg.workout)[0];
  const raw = messagesOf(file, Mesg.workoutStep);
  if (raw.length === 0) throw new WorkoutError('The FIT file has no workout steps');

  interface RawStep { step?: WorkoutStep; repeatTo?: number; repeatCount?: number }
  const parsed: RawStep[] = raw.map((m) => {
    const fld = m.fields;
    const durationType = (fld[1] as number | undefined) ?? DURATION_TIME;
    const durationValue = (fld[2] as number | undefined) ?? 0;
    const targetType = (fld[3] as number | undefined) ?? TARGET_OPEN;
    const targetValue = (fld[4] as number | undefined) ?? 0;
    const low = fld[5] as number | undefined;
    const high = fld[6] as number | undefined;

    if (durationType >= DURATION_REPEAT && durationType <= 13) {
      return { repeatTo: durationValue, repeatCount: Math.max(1, targetValue) };
    }
    if (durationType !== DURATION_TIME && durationType !== DURATION_OPEN) {
      throw new WorkoutError(`Unsupported FIT step duration type ${durationType} (only time-based steps are supported)`);
    }
    const duration = durationType === DURATION_TIME ? durationValue / 1000 : 0;
    const name = fld[0] as string | undefined;
    const notes = fld[8] as string | undefined;
    const intensity = INTENSITY[(fld[7] as number | undefined) ?? 0];
    const step: WorkoutStep = {
      kind: 'free', duration, erg: false, label: name, intensity,
      texts: notes ? [{ offset: 0, message: notes }] : [],
    };
    if (targetType === TARGET_POWER) {
      if (targetValue > 0 && targetValue <= ZONE_RANGES.length) {
        const [lo, hi] = ZONE_RANGES[targetValue - 1];
        step.target = { unit: 'ftp', from: (lo + hi) / 2, to: (lo + hi) / 2, low: lo, high: hi };
      } else if (low !== undefined && high !== undefined) {
        step.target = powerRange(low, high);
      }
      if (step.target) { step.kind = 'steady'; step.erg = true; }
    } else if (targetType === TARGET_CADENCE && low !== undefined && high !== undefined) {
      step.cadence = (low + high) / 2;
    }
    // Secondary cadence target, when present alongside a power target.
    if (fld[19] === TARGET_CADENCE && typeof fld[21] === 'number' && typeof fld[22] === 'number') {
      step.cadence = ((fld[21] as number) + (fld[22] as number)) / 2;
    }
    return { step };
  });

  const steps: WorkoutStep[] = [];
  /** Index into `steps` at which each raw step's output begins, so repeats can copy their block. */
  const emittedAt: number[] = [];
  let setIndex = 0;
  parsed.forEach((p, i) => {
    emittedAt[i] = steps.length;
    if (p.step) {
      if (p.step.duration > 0) steps.push({ ...p.step, texts: p.step.texts.map((t) => ({ ...t })) });
      return;
    }
    if (p.repeatTo === undefined || p.repeatCount === undefined) return;
    if (p.repeatTo < 0 || p.repeatTo >= i) throw new WorkoutError(`FIT repeat step ${i} points at an invalid step`);
    // The block has been emitted once already; add the remaining repeats.
    const block = steps.slice(emittedAt[p.repeatTo]);
    const total = p.repeatCount;
    const tag = (k: number, rep: number) => ({ index: setIndex, rep, of: total, phase: k % 2 === 0 ? 'on' as const : 'off' as const });
    block.forEach((s, k) => { if (!s.set) s.set = tag(k, 1); });
    for (let rep = 2; rep <= total; rep++) {
      block.forEach((s, k) => steps.push({ ...s, texts: s.texts.map((t) => ({ ...t })), set: tag(k, rep) }));
    }
    setIndex++;
  });
  if (steps.length === 0) throw new WorkoutError('The FIT workout has no time-based steps');

  const sport = wk?.fields[4];
  return {
    name: (wk?.fields[8] as string | undefined) ?? 'Untitled',
    sport: sport === 1 ? 'run' : 'bike',
    steps,
  };
}

/**
 * Write a workout as a FIT workout file for head units and training platforms.
 * Ramps are approximated by their midpoint, as FIT steps have a single range.
 */
export function writeFitWorkout(w: Workout, opts: { timeCreated?: number; band?: number } = {}): Uint8Array {
  const band = opts.band ?? 0.04;
  const wr = new FitWriter();
  wr.define(0, Mesg.fileId, [
    { num: 0, type: BaseType.enum }, { num: 1, type: BaseType.uint16 }, { num: 2, type: BaseType.uint16 },
    { num: 3, type: BaseType.uint32z }, { num: 4, type: BaseType.uint32 },
  ]);
  wr.write(0, [5, 255, 0, 1, opts.timeCreated ?? 0]);
  wr.define(1, Mesg.workout, [
    { num: 4, type: BaseType.enum }, { num: 6, type: BaseType.uint16 }, { num: 8, type: BaseType.string, size: 48 },
  ]);
  wr.write(1, [w.sport === 'run' ? 1 : 2, w.steps.length, w.name]);
  wr.define(2, Mesg.workoutStep, [
    { num: 254, type: BaseType.uint16 }, { num: 0, type: BaseType.string, size: 24 },
    { num: 1, type: BaseType.enum }, { num: 2, type: BaseType.uint32 }, { num: 3, type: BaseType.enum },
    { num: 4, type: BaseType.uint32 }, { num: 5, type: BaseType.uint32 }, { num: 6, type: BaseType.uint32 },
    { num: 7, type: BaseType.enum }, { num: 8, type: BaseType.string, size: 50 },
  ]);
  w.steps.forEach((s, i) => {
    let low: number | undefined;
    let high: number | undefined;
    if (s.target) {
      const mid = (s.target.from + s.target.to) / 2;
      const lo = s.target.low ?? Math.min(s.target.from, s.target.to, mid * (1 - band));
      const hi = s.target.high ?? Math.max(s.target.from, s.target.to, mid * (1 + band));
      if (s.target.unit === 'watts') { low = lo + 1000; high = hi + 1000; }
      else { low = lo * 100; high = hi * 100; }
    }
    const intensity = Math.max(0, INTENSITY.indexOf(s.intensity ?? 'active'));
    wr.write(2, [
      i, s.label ?? '', DURATION_TIME, s.duration * 1000, s.target ? TARGET_POWER : TARGET_OPEN,
      0, low, high, intensity, s.texts[0]?.message ?? '',
    ]);
  });
  return wr.finish();
}
