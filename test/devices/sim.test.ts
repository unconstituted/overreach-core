import { describe, expect, it } from 'vitest';
import { buildWorkout, WorkoutRunner } from '../../src/core/workout';
import { DeviceManager, SimHeartRate, SimTrainer, type PowerData } from '../../src/devices';
import { parseControlPointCommand } from '../../src/devices/protocol/ftms';

/** Run a simulated trainer for `seconds`, collecting power packets. */
function run(sim: SimTrainer, seconds: number, dt = 0.05): PowerData[] {
  const out: PowerData[] = [];
  const off = sim.onPower((d) => out.push(d));
  for (let t = 0; t < seconds - 1e-9; t += dt) sim.tick(dt);
  off();
  return out;
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('SimTrainer: ERG end to end over FTMS bytes', () => {
  it('requests control, sends the target and settles on it', async () => {
    const sim = new SimTrainer({ seed: 1 });
    await sim.setTargetPower(220);
    const ops = sim.peripheral.writes.map((w) => parseControlPointCommand(w));
    expect(ops).toEqual([{ op: 'requestControl' }, { op: 'setTargetPower', watts: 220 }]);
    expect(sim.peripheral.mode).toBe('erg');

    const early = run(sim, 1);
    expect(early[early.length - 1].power).toBeLessThan(150); // lag: not there after one second
    run(sim, 12);
    const settled = run(sim, 20);
    expect(settled.length).toBeGreaterThanOrEqual(78); // about 4 packets per second
    const avg = mean(settled.map((d) => d.power));
    expect(avg).toBeGreaterThan(214);
    expect(avg).toBeLessThan(226);
    // Noise is present but small in ERG.
    const spread = Math.max(...settled.map((d) => d.power)) - Math.min(...settled.map((d) => d.power));
    expect(spread).toBeGreaterThan(0);
    expect(spread).toBeLessThan(30);
    expect(settled[settled.length - 1].cadence).toBeGreaterThan(75);
    expect(settled[settled.length - 1].speed).toBeGreaterThan(5);
  });

  it('follows a change of target with lag, and does not resend an unchanged target', async () => {
    const sim = new SimTrainer({ seed: 2 });
    await sim.setTargetPower(150);
    run(sim, 20);
    await sim.setTargetPower(150);
    expect(sim.peripheral.writes).toHaveLength(2);
    await sim.setTargetPower(300);
    expect(sim.peripheral.writes).toHaveLength(3);
    const p1 = run(sim, 1).pop()!.power;
    expect(p1).toBeGreaterThan(160);
    expect(p1).toBeLessThan(260);
    run(sim, 10);
    expect(mean(run(sim, 10).map((d) => d.power))).toBeGreaterThan(290);
  });

  it('drives a whole workout through the runner', async () => {
    const workout = buildWorkout({ name: 'ERG test', steps: [
      { kind: 'steady', duration: 60, power: 0.5 },
      { kind: 'ramp', duration: 60, from: 0.6, to: 0.9 },
      { kind: 'steady', duration: 40, power: 1.1 },
      { kind: 'steady', duration: 40, power: 0.5 },
    ] });
    const ftp = 250;
    const runner = new WorkoutRunner(workout, ftp);
    const devices = new DeviceManager({ seed: 3, ftp });
    await devices.useSimTrainer();
    const dt = 0.1;
    const errAt: Record<number, number> = {};
    for (let i = 0; i <= runner.total / dt; i++) {
      const t = i * dt;
      const st = runner.stateAt(t);
      devices.applyTarget(st.targetWatts, st.erg, st.cadence);
      await Promise.resolve(); // let the queued control point write complete
      await Promise.resolve();
      devices.tick(dt);
      if (Number.isInteger(Math.round(t * 10) / 10)) errAt[Math.round(t)] = devices.live.power - (st.targetWatts ?? 0);
    }
    // Late in each steady block the rider is on target.
    expect(Math.abs(errAt[55])).toBeLessThan(12);
    expect(Math.abs(errAt[155])).toBeLessThan(18);
    expect(Math.abs(errAt[195])).toBeLessThan(12);
    // During the ramp the trainer trails the moving target slightly but stays close.
    expect(Math.abs(errAt[100])).toBeLessThan(15);
    // Right after the 50 W jump to 110% the power is still catching up.
    expect(errAt[121]).toBeLessThan(-15);
    expect(devices.live.cadence).toBeGreaterThan(70);
    expect(devices.live.heartRate).toBeGreaterThan(90);
  });

  it('follows the rider target when the trainer is not in ERG', async () => {
    const sim = new SimTrainer({ seed: 4 });
    sim.setRiderTarget(280);
    await sim.setSimulation({ grade: 0 });
    run(sim, 20);
    const p = run(sim, 20).map((d) => d.power);
    expect(mean(p)).toBeGreaterThan(260);
    expect(mean(p)).toBeLessThan(300);
  });

  it('drops to zero when the rider stops pedalling, and recovers', async () => {
    const sim = new SimTrainer({ seed: 5 });
    await sim.setTargetPower(200);
    run(sim, 20);
    sim.setPedalling(false);
    const coast = run(sim, 8);
    expect(coast[coast.length - 1].power).toBeLessThan(5);
    expect(coast[coast.length - 1].cadence).toBeLessThan(5);
    sim.setPedalling(true);
    run(sim, 15);
    expect(run(sim, 5).pop()!.power).toBeGreaterThan(180);
  });

  it('lets a manual override replace the workout', async () => {
    const sim = new SimTrainer({ seed: 6 });
    await sim.setTargetPower(150);
    sim.setOverride(400);
    run(sim, 20);
    expect(mean(run(sim, 10).map((d) => d.power))).toBeGreaterThan(370);
    sim.setOverride(null);
    run(sim, 20);
    expect(mean(run(sim, 10).map((d) => d.power))).toBeLessThan(165);
  });

  it('refuses commands without control, as a real trainer does, and the client recovers', async () => {
    const sim = new SimTrainer({ seed: 7 });
    await sim.setTargetPower(200);
    sim.peripheral.dropControl();
    await sim.setTargetPower(240); // must re-request control internally
    expect(sim.peripheral.targetPower).toBe(240);
    const ops = sim.peripheral.writes.map((w) => parseControlPointCommand(w).op);
    expect(ops).toEqual(['requestControl', 'setTargetPower', 'requestControl', 'setTargetPower']);
  });

  it('clamps targets to the supported power range and releases cleanly', async () => {
    const sim = new SimTrainer({ seed: 8 });
    await sim.setTargetPower(5000);
    expect(sim.peripheral.targetPower).toBe(2000);
    await sim.release();
    expect(sim.peripheral.mode).toBe('none');
    expect(sim.peripheral.hasControl).toBe(false);
    expect(sim.targetPower).toBeUndefined();
  });

  it('is deterministic for a given seed', async () => {
    const a = new SimTrainer({ seed: 42 });
    const b = new SimTrainer({ seed: 42 });
    await a.setTargetPower(250);
    await b.setTargetPower(250);
    expect(run(a, 30).map((d) => d.power)).toEqual(run(b, 30).map((d) => d.power));
  });
});

describe('SimHeartRate', () => {
  /** Seconds for heart rate to cover 63% of a step change in power. */
  function riseTime(tauUp: number): number {
    const hr = new SimHeartRate({ tauUp, seed: 1 });
    hr.setPower(100);
    for (let i = 0; i < 600; i++) hr.tick(1);
    const from = hr.bpm;
    const to = hr.steadyState(250);
    hr.setPower(250);
    for (let s = 1; s <= 300; s++) {
      hr.tick(1);
      if (hr.bpm >= from + 0.632 * (to - from)) return s;
    }
    return Infinity;
  }

  it('lags power by 20 to 60 seconds', () => {
    const t = riseTime(32);
    expect(t).toBeGreaterThanOrEqual(20);
    expect(t).toBeLessThanOrEqual(60);
    expect(riseTime(20)).toBeLessThan(riseTime(55));
  });

  it('barely moves in the first few seconds of a surge', () => {
    const hr = new SimHeartRate({ seed: 2 });
    hr.setPower(120);
    for (let i = 0; i < 400; i++) hr.tick(1);
    const before = hr.bpm;
    hr.setPower(350);
    for (let i = 0; i < 3; i++) hr.tick(1);
    expect(hr.bpm - before).toBeLessThan(8);
  });

  it('recovers more slowly than it rises and stays within physiological limits', () => {
    const hr = new SimHeartRate({ seed: 3, maxHr: 185, restHr: 55 });
    hr.setPower(400);
    for (let i = 0; i < 600; i++) hr.tick(1);
    expect(hr.bpm).toBeLessThanOrEqual(185);
    expect(hr.bpm).toBeGreaterThan(170);
    const peak = hr.bpm;
    hr.setPower(0);
    for (let i = 0; i < 32; i++) hr.tick(1);
    const drop32 = peak - hr.bpm;
    const settle = peak - hr.steadyState(0);
    expect(drop32 / settle).toBeLessThan(0.632); // one rise-time-constant is not enough to recover 63%
    for (let i = 0; i < 900; i++) hr.tick(1);
    expect(hr.bpm).toBeGreaterThan(55);
    expect(hr.bpm).toBeLessThan(80);
  });

  it('emits one real Heart Rate Measurement packet per second', () => {
    const hr = new SimHeartRate({ seed: 4 });
    const got: number[] = [];
    hr.onHeartRate((d) => got.push(d.bpm));
    hr.setPower(200);
    for (let i = 0; i < 100; i++) hr.tick(0.1);
    expect(got).toHaveLength(10);
    expect(hr.lastPacket![0] & 0x16).toBe(0x16); // contact detected + RR present
    expect(hr.lastPacket![1]).toBe(got[got.length - 1]);
  });

  it('follows a power source when bound to one', async () => {
    const sim = new SimTrainer({ seed: 9 });
    const hr = new SimHeartRate({ seed: 9 }, sim);
    await sim.setTargetPower(260);
    for (let i = 0; i < 3000; i++) { sim.tick(0.1); hr.tick(0.1); }
    expect(hr.bpm).toBeGreaterThan(150);
  });
});
