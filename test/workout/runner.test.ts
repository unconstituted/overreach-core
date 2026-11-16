import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildWorkout, parseFitWorkout, WorkoutRunner } from '../../src/core/workout';

const w = buildWorkout({
  name: 'Runner',
  steps: [
    { kind: 'steady', duration: 60, power: 0.5, label: 'Easy', texts: [{ offset: 10, message: 'Settle in' }] },
    { kind: 'ramp', duration: 60, from: 0.6, to: 0.9, label: 'Build' },
    { kind: 'steady', duration: 20, power: 1.15, label: 'Surge', erg: false, cadence: 100 },
    { kind: 'free', duration: 30, label: 'Free' },
    { kind: 'steady', duration: 30, watts: 250, label: 'At FTP in watts' },
    { kind: 'steady', duration: 30, power: 0.99, label: 'Just under' },
  ],
});

describe('workout runner', () => {
  const r = new WorkoutRunner(w, 250);

  it('reports the current step, target watts and time left', () => {
    const s = r.stateAt(30);
    expect(s.stepIndex).toBe(0);
    expect(s.step.label).toBe('Easy');
    expect(s.targetWatts).toBe(125);
    expect(s.targetFraction).toBe(0.5);
    expect(s.timeInStep).toBe(30);
    expect(s.timeLeftInStep).toBe(30);
    expect(s.erg).toBe(true);
    expect(s.next).toMatchObject({ stepIndex: 1, startsIn: 30, targetWatts: 150 });
    expect(s.timeLeft).toBe(200);
  });

  it('follows a ramp', () => {
    expect(r.stateAt(60).targetWatts).toBeCloseTo(150, 9);
    expect(r.stateAt(90).targetWatts).toBeCloseTo(187.5, 9);
    expect(r.stateAt(119.999).targetWatts).toBeCloseTo(225, 2);
  });

  it('moves to the next step exactly on the boundary', () => {
    expect(r.stateAt(119.999).stepIndex).toBe(1);
    const s = r.stateAt(120);
    expect(s.stepIndex).toBe(2);
    expect(s.targetWatts).toBeCloseTo(287.5, 9);
    expect(s.erg).toBe(false);
    expect(s.cadence).toBe(100);
  });

  it('has no target in free ride', () => {
    const s = r.stateAt(150);
    expect(s.step.kind).toBe('free');
    expect(s.targetWatts).toBeUndefined();
    expect(s.erg).toBe(false);
  });

  it('cues "spin up" five seconds before every step at 100% FTP or more', () => {
    expect(r.cues.map((c) => [c.stepIndex, c.from, c.at])).toEqual([[2, 115, 120], [4, 165, 170]]);
    expect(r.stateAt(114.9).cues).toEqual([]);
    expect(r.stateAt(115).cues[0]).toMatchObject({ kind: 'spin-up', inSeconds: 5, message: 'Spin up in 5' });
    expect(r.stateAt(116.2).cues[0].inSeconds).toBe(4);
    expect(r.stateAt(119.5).cues[0].inSeconds).toBe(1);
    expect(r.stateAt(120).cues).toEqual([]);
    // The watts step at exactly FTP is cued; the 99% step is not.
    expect(r.stateAt(167).cues[0]).toMatchObject({ stepIndex: 4, inSeconds: 3 });
    expect(r.stateAt(197).cues).toEqual([]);
  });

  it('cue threshold depends on the rider when targets are in watts', () => {
    expect(new WorkoutRunner(w, 300).cues.map((c) => c.stepIndex)).toEqual([2]);
  });

  it('shows text events for their hold time and reports them once when playing forwards', () => {
    expect(r.stateAt(9).texts).toEqual([]);
    expect(r.stateAt(12).texts[0]).toMatchObject({ message: 'Settle in', at: 10 });
    expect(r.stateAt(18.5).texts).toEqual([]);
    expect(r.textsBetween(9, 10).map((t) => t.message)).toEqual(['Settle in']);
    expect(r.textsBetween(10, 11)).toEqual([]);
  });

  it('clamps before the start and after the end', () => {
    expect(r.stateAt(-5).stepIndex).toBe(0);
    const end = r.stateAt(9999);
    expect(end.finished).toBe(true);
    expect(end.stepIndex).toBe(5);
    expect(end.timeLeft).toBe(0);
    expect(end.erg).toBe(false);
    expect(end.next).toBeUndefined();
  });

  it('reports step boundaries crossed, for lap markers', () => {
    expect(r.stepsStartedBetween(59, 61)).toEqual([1]);
    expect(r.stepsStartedBetween(0, 500)).toEqual([1, 2, 3, 4, 5]);
  });

  it('cues the seven hard efforts of Chapter 1', () => {
    const ch1 = parseFitWorkout(new Uint8Array(readFileSync('reference/workouts/CrushCh1.fit')));
    const run = new WorkoutRunner(ch1, 260);
    expect(run.total).toBe(2100);
    expect(run.cues).toHaveLength(7);
    expect(run.cues.every((c) => c.at - c.from === 5)).toBe(true);
    expect(run.stateAt(run.cues[0].at).targetWatts).toBeCloseTo(1.15 * 260, 6);
  });
});
