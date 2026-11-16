import { describe, expect, it } from 'vitest';
import { buildWorkout, stepStarts, targetAt, totalDuration, type StepSpec, WorkoutRunner } from '../../src/core/workout';

/** Small deterministic PRNG so property tests are repeatable. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('workout model', () => {
  it('expands interval sets into alternating on and off steps', () => {
    const w = buildWorkout({
      name: 'Sets',
      steps: [
        { kind: 'steady', duration: 60, power: 0.5 },
        { kind: 'intervals', repeat: 3, on: { duration: 30, power: 1.2, cadence: 100 }, off: { duration: 60, power: 0.5 } },
      ],
    });
    expect(w.steps).toHaveLength(7);
    expect(w.steps.slice(1).map((s) => s.set?.phase)).toEqual(['on', 'off', 'on', 'off', 'on', 'off']);
    expect(w.steps.slice(1).map((s) => s.set?.rep)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(w.steps[1].target?.from).toBe(1.2);
    expect(w.steps[1].cadence).toBe(100);
    expect(w.steps[2].duration).toBe(60);
    expect(totalDuration(w)).toBe(60 + 3 * 90);
  });

  it('places set-level text events on the right repeat', () => {
    const w = buildWorkout({
      name: 'Texts',
      steps: [{ kind: 'intervals', repeat: 2, on: { duration: 20, power: 1.1 }, off: { duration: 40, power: 0.5 },
        texts: [{ offset: 5, message: 'first on' }, { offset: 65, message: 'second on' }, { offset: 30, message: 'first off' }] }],
    });
    expect(w.steps[0].texts).toEqual([{ offset: 5, message: 'first on' }]);
    expect(w.steps[1].texts).toEqual([{ offset: 10, message: 'first off' }]);
    expect(w.steps[2].texts).toEqual([{ offset: 5, message: 'second on' }]);
  });

  it('interpolates ramps linearly and holds steady steps', () => {
    const w = buildWorkout({ name: 'Ramp', steps: [
      { kind: 'ramp', duration: 100, from: 0.5, to: 1.0 },
      { kind: 'steady', duration: 10, watts: 180 },
      { kind: 'free', duration: 10 },
    ] });
    expect(targetAt(w.steps[0], 0)).toBe(0.5);
    expect(targetAt(w.steps[0], 25)).toBeCloseTo(0.625, 10);
    expect(targetAt(w.steps[0], 100)).toBe(1.0);
    expect(targetAt(w.steps[0], 500)).toBe(1.0);
    expect(targetAt(w.steps[1], 5)).toBe(180);
    expect(targetAt(w.steps[2], 5)).toBeUndefined();
  });

  it('rejects impossible steps', () => {
    expect(() => buildWorkout({ name: 'x', steps: [] })).toThrow();
    expect(() => buildWorkout({ name: 'x', steps: [{ kind: 'steady', duration: 0, power: 1 }] })).toThrow();
    expect(() => buildWorkout({ name: 'x', steps: [{ kind: 'steady', duration: 10 }] })).toThrow();
  });

  it('property: total duration equals the sum of steps, and every instant maps to exactly one step', () => {
    const r = rng(20261116);
    for (let trial = 0; trial < 200; trial++) {
      const specs: StepSpec[] = [];
      let expected = 0;
      const n = 1 + Math.floor(r() * 12);
      for (let i = 0; i < n; i++) {
        const d = 1 + Math.floor(r() * 600);
        const pick = r();
        if (pick < 0.4) { specs.push({ kind: 'steady', duration: d, power: 0.4 + r() }); expected += d; }
        else if (pick < 0.6) { specs.push({ kind: 'ramp', duration: d, from: 0.4 + r(), to: 0.4 + r() }); expected += d; }
        else if (pick < 0.7) { specs.push({ kind: 'free', duration: d }); expected += d; }
        else {
          const repeat = 1 + Math.floor(r() * 8);
          const off = 1 + Math.floor(r() * 120);
          specs.push({ kind: 'intervals', repeat, on: { duration: d, power: 1 + r() }, off: { duration: off, power: 0.5 } });
          expected += repeat * (d + off);
        }
      }
      const w = buildWorkout({ name: `trial ${trial}`, steps: specs });
      const sum = w.steps.reduce((a, s) => a + s.duration, 0);
      expect(totalDuration(w)).toBe(expected);
      expect(sum).toBe(expected);
      const starts = stepStarts(w);
      expect(starts[starts.length - 1]).toBe(expected);
      const runner = new WorkoutRunner(w, 250);
      for (let k = 0; k < 20; k++) {
        const t = r() * expected;
        const st = runner.stateAt(t);
        expect(st.stepStart).toBeLessThanOrEqual(t);
        expect(st.stepStart + st.step.duration).toBeGreaterThan(t);
        expect(st.timeInStep + st.timeLeftInStep).toBeCloseTo(st.step.duration, 9);
        expect(st.elapsed + st.timeLeft).toBeCloseTo(expected, 9);
      }
    }
  });
});
