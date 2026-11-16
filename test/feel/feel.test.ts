import { describe, expect, it } from 'vitest';
import { FEEL_PRESETS, FeelEngine, IDLE_SPEED, speedTarget, type FeelEvent } from '../../src/core/feel';

const FTP = 250;
function run(f: FeelEngine, seconds: number, power: number | ((t: number) => number), cadence = 90, target?: number, dt = 1 / 60): FeelEvent[] {
  const ev: FeelEvent[] = [];
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) ev.push(...f.update(dt, { power: typeof power === 'number' ? power : power(i * dt), cadence, targetWatts: target }));
  return ev;
}

describe('feel: strokes', () => {
  it('lands two strikes per crank revolution', () => {
    const f = new FeelEngine(FEEL_PRESETS.standard, FTP);
    const strokes = run(f, 10, 250, 90).filter((e) => e.type === 'stroke');
    expect(strokes.length).toBeGreaterThanOrEqual(29); // 90 rpm = 3 strokes a second
    expect(strokes.length).toBeLessThanOrEqual(30);
    expect(run(f, 5, 250, 0).filter((e) => e.type === 'stroke')).toHaveLength(0);
  });

  it('is the same at any frame rate', () => {
    const a = new FeelEngine(FEEL_PRESETS.standard, FTP);
    const b = new FeelEngine(FEEL_PRESETS.standard, FTP);
    const na = run(a, 20, 280, 95, 280, 1 / 120).filter((e) => e.type === 'stroke').length;
    const nb = run(b, 20, 280, 95, 280, 1 / 20).filter((e) => e.type === 'stroke').length;
    expect(Math.abs(na - nb)).toBeLessThanOrEqual(1);
    expect(a.state.speedFactor).toBeCloseTo(b.state.speedFactor, 2);
  });

  it('strikes harder when a stroke beats the 10 second average', () => {
    const f = new FeelEngine(FEEL_PRESETS.standard, FTP);
    const steady = run(f, 15, 275).filter((e) => e.type === 'stroke').pop() as { pulse: number; trend: number };
    const surge = run(f, 0.5, 330).filter((e) => e.type === 'stroke').pop() as { pulse: number; trend: number; ratio: number };
    expect(surge.pulse).toBeGreaterThan(steady.pulse * 1.5);
    expect(steady.trend).toBe(0);
    expect(surge.trend).toBe(3);
    expect(surge.ratio).toBeGreaterThan(1.15);
  });
});

describe('feel: intensity scales with zone', () => {
  it('is asleep below the onset and fully awake by about 122% FTP', () => {
    const f = new FeelEngine(FEEL_PRESETS.standard, FTP);
    run(f, 1, 0.6 * FTP);
    expect(f.state.intensity).toBe(0);
    run(f, 1, 0.76 * FTP);
    expect(f.state.intensity).toBeCloseTo(0, 6);
    run(f, 1, 1.0 * FTP);
    expect(f.state.intensity).toBeGreaterThan(0.45);
    expect(f.state.intensity).toBeLessThan(0.65);
    run(f, 1, 1.25 * FTP);
    expect(f.state.intensity).toBe(1);
    run(f, 1, 1.6 * FTP);
    expect(f.state.redline).toBe(true);
  });

  it('presets order: restrained < standard < aggressive at the same effort', () => {
    const at = (name: 'restrained' | 'standard' | 'aggressive') => {
      const f = new FeelEngine(FEEL_PRESETS[name], FTP);
      const ev = run(f, 12, 1.05 * FTP);
      return { I: f.state.intensity, pulse: (ev.filter((e) => e.type === 'stroke').pop() as { pulse: number }).pulse };
    };
    const r = at('restrained');
    const s = at('standard');
    const a = at('aggressive');
    expect(r.I).toBeLessThan(s.I);
    expect(s.I).toBeLessThan(a.I);
    expect(r.pulse).toBeLessThan(s.pulse);
    expect(s.pulse).toBeLessThan(a.pulse);
  });

  it('the off preset produces no strikes, no hit-stop and no intensity', () => {
    const f = new FeelEngine(FEEL_PRESETS.off, FTP);
    const ev = run(f, 20, (t) => (t < 16 ? 200 : 400));
    expect(f.state.intensity).toBe(0);
    expect(ev.filter((e) => e.type === 'peakBreak')).toEqual([]);
    expect(ev.filter((e) => e.type === 'stroke').every((e) => (e as { pulse: number }).pulse === 0)).toBe(true);
    expect(f.state.freeze).toBe(0);
  });
});

describe('feel: 30 second peak hold', () => {
  it('fires once when the rider pushes through the line, then carries quietly', () => {
    const f = new FeelEngine(FEEL_PRESETS.standard, FTP);
    run(f, 20, 260);
    const ev = run(f, 6, 320);
    const breaks = ev.filter((e) => e.type === 'peakBreak');
    expect(breaks).toHaveLength(1);
    expect(breaks[0]).toMatchObject({ watts: 320, ridePeak: true });
    expect(f.state.carrying).toBe(false); // settled at the new level: nothing more to break
    expect(f.state.peak30).toBeCloseTo(320, 0);
    expect(f.state.peakRide).toBe(320);
  });

  it('holds a frame on the break (hit-stop) and flashes the number', () => {
    const f = new FeelEngine(FEEL_PRESETS.standard, FTP);
    run(f, 20, 260);
    let seen = 0;
    for (let i = 0; i < 120; i++) {
      const ev = f.update(1 / 60, { power: 320, cadence: 90 });
      if (ev.some((e) => e.type === 'peakBreak')) {
        expect(f.state.freeze).toBeCloseTo(0.07, 2);
        expect(f.state.invert).toBeGreaterThan(0.1);
        expect(f.state.jolt).toBeGreaterThan(1);
        seen++;
      }
    }
    expect(seen).toBe(1);
    expect(f.state.freeze).toBe(0);
  });

  it('the line eases back down once the peak leaves the 30 second window', () => {
    const f = new FeelEngine(FEEL_PRESETS.standard, FTP);
    run(f, 20, 260);
    run(f, 5, 330);
    run(f, 10, 250);
    expect(f.state.peak30).toBeCloseTo(330, 0); // still inside the window
    run(f, 25, 250);
    expect(f.state.peak30).toBeLessThan(262);
    expect(f.state.peakRide).toBe(330); // the ride best stays
  });

  it('does not fire at easy efforts, where the HUD is asleep', () => {
    const f = new FeelEngine(FEEL_PRESETS.standard, FTP);
    run(f, 20, 120);
    expect(run(f, 5, 160).filter((e) => e.type === 'peakBreak')).toEqual([]);
  });

  it('reports a lost hold after a long run at or above the average', () => {
    const f = new FeelEngine(FEEL_PRESETS.standard, FTP);
    run(f, 15, 270);
    expect(f.state.hold).toBeGreaterThan(8);
    const ev = run(f, 2, 200);
    expect(ev.some((e) => e.type === 'holdLost')).toBe(true);
    expect(f.state.hold).toBe(0);
  });
});

describe('feel: speed response', () => {
  it('maps effort against target to a speed factor', () => {
    expect(speedTarget(0)).toBe(IDLE_SPEED);
    expect(speedTarget(1)).toBeCloseTo(1, 9);
    expect(speedTarget(0.5)).toBeGreaterThan(0.55);
    expect(speedTarget(0.5)).toBeLessThan(0.7);
    expect(speedTarget(1.2)).toBeCloseTo(1.09, 2);
    expect(speedTarget(5)).toBeCloseTo(1.27, 2); // capped: no infinite speed from a sprint
  });

  it('a rider on target sees full speed; one who stops sees the ship slow right down', () => {
    const f = new FeelEngine(FEEL_PRESETS.standard, FTP);
    run(f, 15, 175, 88, 175);
    expect(f.state.speedFactor).toBeCloseTo(1, 2);
    run(f, 8, 0, 0, 175);
    expect(f.state.speedFactor).toBeLessThan(0.15);
    expect(f.state.speedFactor).toBeGreaterThan(0.1);
    run(f, 10, 175, 88, 175);
    expect(f.state.speedFactor).toBeCloseTo(1, 1);
  });

  it('is smooth at endurance pace but overshoots at VO2 and above', () => {
    const overshoot = (pct: number): number => {
      const f = new FeelEngine(FEEL_PRESETS.standard, FTP);
      const w = pct * FTP;
      run(f, 15, w * 0.6, 90, w);
      let max = 0;
      for (let i = 0; i < 600; i++) {
        f.update(1 / 60, { power: w, cadence: 95, targetWatts: w });
        max = Math.max(max, f.state.speedFactor);
      }
      return max - 1;
    };
    expect(overshoot(0.65)).toBeLessThan(0.005);
    expect(overshoot(1.2)).toBeGreaterThan(0.03);
    expect(overshoot(1.2)).toBeLessThan(0.3);
  });

  it('responds much faster above VO2 than at endurance pace', () => {
    const riseTime = (pct: number): number => {
      const f = new FeelEngine(FEEL_PRESETS.standard, FTP);
      const w = pct * FTP;
      run(f, 15, w * 0.5, 90, w);
      const from = f.state.speedFactor;
      for (let i = 1; i <= 600; i++) {
        f.update(1 / 60, { power: w, cadence: 95, targetWatts: w });
        if (f.state.speedFactor >= from + 0.9 * (1 - from)) return i / 60;
      }
      return Infinity;
    };
    expect(riseTime(1.2)).toBeLessThan(riseTime(0.65) / 3);
  });

  it('without a target, speed is judged against an endurance effort', () => {
    const f = new FeelEngine(FEEL_PRESETS.standard, FTP);
    run(f, 15, 0.6 * FTP, 88);
    expect(f.state.speedFactor).toBeCloseTo(1, 1);
  });

  it('reset clears history but keeps the config', () => {
    const f = new FeelEngine(FEEL_PRESETS.standard, FTP);
    run(f, 20, 300);
    f.reset();
    expect(f.state.peakRide).toBe(0);
    expect(f.state.hold).toBe(0);
    expect(f.config).toBe(FEEL_PRESETS.standard);
  });
});
