import type { Curve, EnvKey, Keys, StepKey } from './types';

/** Evaluate linear keyframes at `t`, clamped at both ends. */
export function evalKeys(keys: Keys, t: number): number {
  const n = keys.length;
  if (n === 0) return 0;
  if (t <= keys[0][0]) return keys[0][1];
  if (t >= keys[n - 1][0]) return keys[n - 1][1];
  // Binary search for the segment containing t.
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid][0] <= t) lo = mid;
    else hi = mid;
  }
  const a = keys[lo];
  const b = keys[hi];
  const span = b[0] - a[0];
  return span <= 0 ? b[1] : a[1] + ((b[1] - a[1]) * (t - a[0])) / span;
}

export function evalCurve(curve: Curve | undefined, t: number, fallback = 0): number {
  if (curve === undefined) return fallback;
  return typeof curve === 'number' ? curve : evalKeys(curve, t);
}

/** Blend environment keys: numbers and arrays are interpolated linearly between neighbouring keys. */
export function evalEnv(keys: EnvKey[], t: number): Record<string, number | number[]> {
  if (keys.length === 0) return {};
  let i = 0;
  for (let k = 0; k < keys.length; k++) if (keys[k].t <= t) i = k;
  const a = keys[i];
  const b = keys[Math.min(i + 1, keys.length - 1)];
  const u = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
  const out: Record<string, number | number[]> = {};
  for (const key of Object.keys(a.values)) {
    const x = a.values[key];
    const y = b.values[key] ?? x;
    if (Array.isArray(x)) {
      const ya = Array.isArray(y) ? y : x;
      out[key] = x.map((v, j) => v + ((ya[j] ?? v) - v) * u);
    } else {
      out[key] = x + ((typeof y === 'number' ? y : x) - x) * u;
    }
  }
  return out;
}

/** The step key in force at `t` (the last one with `from <= t`). */
export function evalStep(keys: StepKey[] | undefined, t: number): Record<string, number | number[]> | undefined {
  if (!keys || keys.length === 0) return undefined;
  let cur = keys[0];
  for (const k of keys) if (k.from <= t) cur = k;
  return cur.values;
}

/**
 * Distance along the route: the integral of the speed keyframes, tabulated
 * so that position is a pure function of time (which is what makes the
 * chapter seekable).
 */
export class DistanceTable {
  private readonly table: Float64Array;
  constructor(private readonly speed: Keys, readonly duration: number, private readonly step = 0.05) {
    const n = Math.ceil(duration / step) + 2;
    this.table = new Float64Array(n);
    for (let i = 1; i < n; i++) this.table[i] = this.table[i - 1] + evalKeys(speed, (i - 0.5) * step) * step;
  }
  speedAt(t: number): number {
    return evalKeys(this.speed, t);
  }
  at(t: number): number {
    const x = Math.min(this.duration, Math.max(0, t)) / this.step;
    const i = Math.floor(x);
    const a = this.table[i];
    const b = this.table[Math.min(i + 1, this.table.length - 1)];
    return a + (b - a) * (x - i);
  }
}
