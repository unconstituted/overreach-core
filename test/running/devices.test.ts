import { describe, expect, it } from 'vitest';
import {
  connectFootpod, connectTreadmill, DeviceManager, FtmsTreadmill, SimTreadmill, SimTreadmillPeripheral,
  type Bt, type BtDevice, type RunData, type TreadmillTransport,
} from '../../src/devices';
import { encodeCyclingPowerMeasurement } from '../../src/devices/protocol/cps';
import { parseControlPointCommand, parseMachineFeatures, parseMachineStatus } from '../../src/devices/protocol/ftms';
import { encodeRscMeasurement, parseRscMeasurement } from '../../src/devices/protocol/rsc';
import {
  encodeSetTargetInclination, encodeSetTargetSpeed, encodeTreadmillData, parseSupportedInclinationRange,
  parseSupportedSpeedRange, parseTreadmillData,
} from '../../src/devices/protocol/treadmill';
import { FakeCharacteristic, FakeDevice } from '../devices/fakeBluetooth';

const hex = (s: string) => new Uint8Array(s.trim().split(/\s+/).map((b) => parseInt(b, 16)));
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

describe('FTMS Treadmill Data (0x2ACD), byte fixtures', () => {
  it('parses speed only (flags 0x0000)', () => {
    // 12.00 km/h = 1200 = 0x04B0
    expect(parseTreadmillData(hex('00 00 B0 04'))).toEqual({ speedKmh: 12 });
  });
  it('parses speed, distance, incline and elapsed time', () => {
    // flags: total distance (bit 2) + inclination (bit 3) + elapsed time (bit 10) = 0x040C
    // speed 10.50 km/h = 0x041A; distance 2,345 m = 0x000929; incline 3.5% = 35, ramp 2.0° = 20; elapsed 600 s = 0x0258
    expect(parseTreadmillData(hex('0C 04 1A 04 29 09 00 23 00 14 00 58 02'))).toEqual({
      speedKmh: 10.5, totalDistance: 2345, inclination: 3.5, rampAngle: 2, elapsedTime: 600,
    });
  });
  it('reads negative incline, heart rate, and power with force on belt', () => {
    // flags: inclination (bit 3) + heart rate (bit 8) + force and power (bit 12) = 0x1108
    // speed 8.00 km/h; incline -1.5% = -15 = 0xFFF1, ramp -0.9° = -9 = 0xFFF7; HR 152; force 60 N; power 280 W
    expect(parseTreadmillData(hex('08 11 20 03 F1 FF F7 FF 98 3C 00 18 01'))).toEqual({
      speedKmh: 8, inclination: -1.5, rampAngle: -0.9, heartRate: 152, forceOnBelt: 60, power: 280,
    });
  });
  it('skips the speed when the "more data" bit is set', () => {
    // flags: more data (bit 0) + elapsed time (bit 10) = 0x0401
    expect(parseTreadmillData(hex('01 04 2C 01'))).toEqual({ elapsedTime: 300 });
  });
  it('reads every optional field in order', () => {
    // flags 0x0FFE: avg speed, distance, inclination, elevation, pace, avg pace, energy, HR, MET, elapsed, remaining
    const b = hex('FE 0F 10 27 E8 03 64 00 00 0A 00 05 00 32 00 0A 00 02 02 2C 01 58 02 0A 9B 51 0A 00 3C 00');
    expect(parseTreadmillData(b)).toEqual({
      speedKmh: 100, avgSpeedKmh: 10, totalDistance: 100, inclination: 1, rampAngle: 0.5, elevationGainPositive: 5,
      elevationGainNegative: 1, pace: 0.2, avgPace: 0.2, totalEnergyKcal: 300, energyPerHourKcal: 600, energyPerMinuteKcal: 10,
      heartRate: 155, metabolicEquivalent: 8.1, elapsedTime: 10, remainingTime: 60,
    });
  });
  it('round-trips through the encoder', () => {
    const d = { speedKmh: 13.4, totalDistance: 5123, inclination: 2.5, elapsedTime: 1234, heartRate: 160, power: 301, forceOnBelt: 0 };
    expect(parseTreadmillData(encodeTreadmillData(d))).toMatchObject(d);
  });
  it('rejects a packet too short to hold flags', () => {
    expect(() => parseTreadmillData(hex('00'))).toThrow();
  });
});

describe('FTMS treadmill control point, status and ranges', () => {
  it('encodes target speed and incline per the spec', () => {
    expect(encodeSetTargetSpeed(12)).toEqual(hex('02 B0 04'));
    expect(encodeSetTargetSpeed(8.25)).toEqual(hex('02 39 03'));
    expect(encodeSetTargetInclination(2.5)).toEqual(hex('03 19 00'));
    expect(encodeSetTargetInclination(-3)).toEqual(hex('03 E2 FF'));
  });
  it('parses those commands as a treadmill would', () => {
    expect(parseControlPointCommand(hex('02 B0 04'))).toEqual({ op: 'setTargetSpeed', kmh: 12 });
    expect(parseControlPointCommand(hex('03 E2 FF'))).toEqual({ op: 'setTargetInclination', percent: -3 });
  });
  it('parses speed and incline status changes', () => {
    expect(parseMachineStatus(hex('05 B0 04'))).toEqual({ kind: 'targetSpeedChanged', kmh: 12 });
    expect(parseMachineStatus(hex('06 E2 FF'))).toEqual({ kind: 'targetInclinationChanged', percent: -3 });
    expect(parseMachineStatus(hex('03'))).toEqual({ kind: 'stoppedBySafetyKey' });
  });
  it('parses supported speed and inclination ranges', () => {
    // 0.80 to 20.00 km/h in 0.10 steps; -3.0 to 15.0% in 0.5 steps
    expect(parseSupportedSpeedRange(hex('50 00 D0 07 0A 00'))).toEqual({ min: 0.8, max: 20, increment: 0.1 });
    expect(parseSupportedInclinationRange(hex('E2 FF 96 00 05 00'))).toEqual({ min: -3, max: 15, increment: 0.5 });
  });
  it('reads the treadmill feature bits', () => {
    // features: total distance (bit 2) + inclination (bit 3) = 0x0C; targets: speed (bit 0) + inclination (bit 1) = 0x03
    expect(parseMachineFeatures(hex('0C 00 00 00 03 00 00 00'))).toMatchObject({
      inclination: true, speedTarget: true, inclinationTarget: true, powerTarget: false, simulation: false,
    });
  });
});

describe('Running Speed and Cadence Measurement (0x2A53), byte fixtures', () => {
  it('parses speed and cadence only', () => {
    // 3.5 m/s = 896/256 = 0x0380; 172 steps per minute
    expect(parseRscMeasurement(hex('00 80 03 AC'))).toEqual({ speed: 3.5, cadence: 172, running: false });
  });
  it('parses stride length, total distance and the running bit', () => {
    // flags 0x07; 4.0 m/s = 0x0400; 180 spm; stride 1.33 m = 133 cm; distance 1234.5 m = 12345 dm
    expect(parseRscMeasurement(hex('07 00 04 B4 85 00 39 30 00 00'))).toEqual({
      speed: 4, cadence: 180, strideLength: 1.33, totalDistance: 1234.5, running: true,
    });
  });
  it('reads a pod that sends strides per minute as steps', () => {
    // 3.5 m/s, 86 strides per minute → 172 steps
    expect(parseRscMeasurement(hex('04 80 03 56')).cadence).toBe(172);
    // Walking slowly with a genuinely low step rate is left alone.
    expect(parseRscMeasurement(hex('00 80 01 6E')).cadence).toBe(110);
  });
  it('round-trips through the encoder', () => {
    const m = { speed: 3.25, cadence: 176, strideLength: 1.11, totalDistance: 777.7, running: true };
    expect(parseRscMeasurement(encodeRscMeasurement(m))).toEqual(m);
  });
});

/** Treadmill control logic against the simulated treadmill. */
function simTreadmill() {
  const sim = new SimTreadmillPeripheral({ seed: 3 });
  const t = new FtmsTreadmill({ name: 'Sim', kind: 'sim', protocol: 'FTMS' }, sim);
  const data: RunData[] = [];
  t.onRun((d) => data.push(d));
  return { sim, t, data };
}

describe('treadmill control (FtmsTreadmill against the simulated treadmill)', () => {
  it('takes control, starts the belt and sets the speed, in that order', async () => {
    const { sim, t } = simTreadmill();
    await t.setTargetSpeed(3);
    expect(sim.writes.map((w) => parseControlPointCommand(w).op)).toEqual(['requestControl', 'start', 'setTargetSpeed']);
    expect(sim.targetSpeed).toBeCloseTo(3, 2);
    expect(t.targetSpeed).toBeCloseTo(3, 2);
  });
  it('ramps the belt at treadmill rates and reports it', async () => {
    const { sim, t, data } = simTreadmill();
    await t.setTargetSpeed(3);
    sim.tick(2);
    expect(sim.speed).toBeLessThan(1); // about 1.5 km/h per second
    sim.tick(10);
    expect(sim.speed).toBeCloseTo(3, 2);
    const last = data[data.length - 1];
    expect(last.speed).toBeCloseTo(3, 1);
    expect(last.distance).toBeGreaterThan(15);
  });
  it('sends nothing when the speed has not changed', async () => {
    const { sim, t } = simTreadmill();
    await t.setTargetSpeed(3);
    const n = sim.writes.length;
    await t.setTargetSpeed(3.001);
    expect(sim.writes.length).toBe(n);
  });
  it('clamps to the safety limit and to the treadmill range', async () => {
    const { sim, t } = simTreadmill();
    await t.setTargetSpeed(12); // 43 km/h asked for
    expect(sim.targetSpeed * 3.6).toBeCloseTo(20, 5);
    t.limits.maxSpeed = 30;
    await t.setTargetSpeed(12);
    expect(sim.targetSpeed * 3.6).toBeCloseTo(22, 5); // the treadmill's own maximum
    await t.setTargetIncline(40);
    expect(sim.targetIncline).toBe(10);
    await t.setTargetIncline(-5);
    expect(sim.targetIncline).toBe(0);
  });
  it('never restarts a belt the runner has stopped, until they choose to resume', async () => {
    const { sim, t } = simTreadmill();
    await t.setTargetSpeed(3);
    sim.tick(10);
    sim.running = false; // the runner hits stop
    sim.tick(0.5);
    await flush();
    expect(t.stoppedByRunner).toBe(true);
    sim.tick(10);
    expect(sim.speed).toBe(0);
    const n = sim.writes.length;
    await t.setTargetSpeed(3.5);
    await t.setTargetIncline(2);
    expect(sim.writes.length).toBe(n);
    sim.tick(10);
    expect(sim.speed).toBe(0);
    // They step back on and choose to carry on.
    sim.running = true;
    t.resume();
    await t.setTargetSpeed(3.5);
    sim.tick(15);
    expect(sim.speed).toBeCloseTo(3.5, 2);
  });
  it('does not mistake its own stop for the runner stopping', async () => {
    const { t } = simTreadmill();
    await t.setTargetSpeed(3);
    await t.stop(true);
    await flush();
    expect(t.stoppedByRunner).toBe(false);
  });
  it('releases by stopping the belt and resetting', async () => {
    const { sim, t } = simTreadmill();
    await t.setTargetSpeed(3);
    sim.tick(5);
    await t.release();
    expect(sim.writes.slice(-2).map((w) => parseControlPointCommand(w).op)).toEqual(['stop', 'reset']);
    sim.tick(10);
    expect(sim.speed).toBe(0);
    expect(t.stoppedByRunner).toBe(false);
  });
  it('treats a treadmill without a control point as read-only', async () => {
    const sim = new SimTreadmillPeripheral();
    const readOnly: TreadmillTransport = {
      onTreadmillData: (cb) => sim.onTreadmillData(cb), onControlPoint: (cb) => sim.onControlPoint(cb), onStatus: (cb) => sim.onStatus(cb),
    };
    const t = new FtmsTreadmill({ name: 'Old', kind: 'bluetooth', protocol: 'FTMS' }, readOnly);
    expect(t.controllable).toBe(false);
    await t.setTargetSpeed(3); // quietly does nothing
    expect(sim.writes).toHaveLength(0);
  });
});

describe('running devices in the manager', () => {
  it('runs a simulated treadmill: belt speed, footpod cadence, and a heart that follows effort', async () => {
    const m = new DeviceManager({ ftp: 250, thresholdSpeed: 4, maxHr: 190, restHr: 55 });
    const sim = await m.useSimTreadmill();
    expect(m.sport).toBe('run');
    expect(m.power).toBeUndefined();
    expect(m.summary()).toMatchObject({ sport: 'run', belt: { kind: 'sim', controllable: true }, pod: { kind: 'sim' }, heart: { kind: 'sim' } });
    for (let i = 0; i < 1200; i++) { m.applyRunTarget(3.2); m.tick(0.25); await flush(); }
    expect(m.live.speed).toBeCloseTo(3.2, 1);
    expect(m.live.cadence).toBeGreaterThan(155);
    expect(m.live.cadence).toBeLessThan(175);
    const easyHr = m.live.heartRate;
    for (let i = 0; i < 1200; i++) { m.applyRunTarget(4.3); m.tick(0.25); await flush(); }
    expect(m.live.heartRate).toBeGreaterThan(easyHr + 15);
    expect(sim.peripheral.controlled).toBe(true);
  });
  it('tells the game when the runner stops the belt, and leaves it stopped', async () => {
    const m = new DeviceManager({ thresholdSpeed: 4 });
    const sim = await m.useSimTreadmill();
    let stops = 0;
    m.runnerStopped.on(() => { stops++; });
    for (let i = 0; i < 80; i++) { m.applyRunTarget(3); m.tick(0.25); await flush(); }
    sim.setRunning(false);
    for (let i = 0; i < 80; i++) { m.applyRunTarget(3); m.tick(0.25); await flush(); }
    expect(stops).toBe(1);
    expect(m.live.speed).toBe(0);
    expect(m.summary().belt?.stoppedByRunner).toBe(true);
    sim.setRunning(true);
    m.resumeBelt();
    for (let i = 0; i < 80; i++) { m.applyRunTarget(3); m.tick(0.25); await flush(); }
    expect(m.live.speed).toBeCloseTo(3, 1);
  });
  it('with treadmill control off, leaves the belt to the runner', async () => {
    const m = new DeviceManager({ thresholdSpeed: 4 });
    const sim = await m.useSimTreadmill();
    m.treadmillControl = false;
    for (let i = 0; i < 160; i++) { m.applyRunTarget(3.4); m.tick(0.25); await flush(); }
    expect(sim.peripheral.writes).toHaveLength(0);
    expect(m.live.speed).toBeCloseTo(3.4, 1); // the runner pressed the buttons themselves
  });
  it('switches back to the bike cleanly', async () => {
    const m = new DeviceManager();
    await m.useSimTreadmill();
    await m.useSimTrainer();
    expect(m.sport).toBe('bike');
    expect(m.belt).toBeUndefined();
    expect(m.pod).toBeUndefined();
    expect(m.trainer).toBeDefined();
    m.applyTarget(200, true);
    for (let i = 0; i < 80; i++) { m.tick(0.25); await flush(); }
    expect(m.live.power).toBeGreaterThan(150);
    expect(m.live.speed).toBe(0);
  });
});

/** A fake Bluetooth treadmill backed by the simulated one. */
function fakeTreadmill(withControl = true) {
  const sim = new SimTreadmillPeripheral({ seed: 2 });
  const dev = new FakeDevice('NordicTrack T6.5');
  const data = new FakeCharacteristic();
  const control = new FakeCharacteristic((b) => sim.writeControlPoint(b));
  const status = new FakeCharacteristic();
  const speedRange = new FakeCharacteristic(undefined, hex('50 00 98 08 0A 00')); // 0.8 to 22 km/h
  sim.onTreadmillData((b) => data.push(b));
  sim.onControlPoint((b) => control.push(b));
  sim.onStatus((b) => status.push(b));
  const chars = new Map([[0x2acd, data], [0x2ada, status], [0x2ad4, speedRange]]);
  if (withControl) chars.set(0x2ad9, control);
  dev.chars.set(0x1826, chars);
  return { sim, dev };
}
const btFor = (dev: BtDevice, seen?: unknown[]): Bt => ({ requestDevice: async (o) => { seen?.push(o); return dev; } });

describe('Bluetooth treadmills and footpods (against a fake Web Bluetooth stack)', () => {
  it('connects a treadmill, reads the belt and controls the speed', async () => {
    const { sim, dev } = fakeTreadmill();
    const seen: unknown[] = [];
    const t = await connectTreadmill(btFor(dev, seen));
    expect(seen[0]).toEqual({ filters: [{ services: [0x1826] }] });
    expect(t.controllable).toBe(true);
    expect(t.info.protocol).toBe('FTMS treadmill (controllable)');
    const got: RunData[] = [];
    t.onRun((d) => got.push(d));
    await t.setTargetSpeed(3);
    sim.tick(12);
    expect(got[got.length - 1].speed).toBeCloseTo(3, 1);
  });
  it('connects a treadmill with no control point as read-only', async () => {
    const { dev } = fakeTreadmill(false);
    const t = await connectTreadmill(btFor(dev));
    expect(t.controllable).toBe(false);
    expect(t.info.protocol).toBe('FTMS treadmill (read-only)');
  });
  it('reconnects a dropped treadmill and restores its speed, but not a stopped belt', async () => {
    const { sim, dev } = fakeTreadmill();
    const t = await connectTreadmill(btFor(dev), { backoffMs: [0], wait: async () => undefined });
    await t.setTargetSpeed(3.2);
    sim.tick(15);
    sim.targetSpeed = 0; // the treadmill forgot everything on the drop
    sim.hasControl = false;
    dev.drop();
    await flush(); await flush();
    expect(t.state).toBe('connected');
    expect(sim.targetSpeed).toBeCloseTo(3.2, 2);
  });
  it('connects a footpod, with running power when it offers the Cycling Power Service', async () => {
    const dev = new FakeDevice('Stryd');
    const rsc = new FakeCharacteristic();
    const cps = new FakeCharacteristic();
    dev.chars.set(0x1814, new Map([[0x2a53, rsc]]));
    dev.chars.set(0x1818, new Map([[0x2a63, cps]]));
    const seen: unknown[] = [];
    const pod = await connectFootpod(btFor(dev, seen));
    expect(seen[0]).toEqual({ filters: [{ services: [0x1814] }], optionalServices: [0x1818] });
    expect(pod.hasPower).toBe(true);
    const got: RunData[] = [];
    pod.onRun((d) => got.push(d));
    rsc.push(encodeRscMeasurement({ speed: 3.5, cadence: 174 }));
    cps.push(encodeCyclingPowerMeasurement({ power: 265 }));
    expect(got).toEqual([{ speed: 3.5, cadence: 174, distance: undefined }, { power: 265 }]);
  });
  it('feeds a Bluetooth footpod into the manager alongside a treadmill', async () => {
    const m = new DeviceManager({ thresholdSpeed: 4 });
    const { sim, dev } = fakeTreadmill();
    await m.connectBluetoothTreadmill(btFor(dev));
    const pdev = new FakeDevice('Pod');
    const rsc = new FakeCharacteristic();
    pdev.chars.set(0x1814, new Map([[0x2a53, rsc]]));
    await m.connectBluetoothFootpod(btFor(pdev));
    m.applyRunTarget(3);
    await flush();
    sim.tick(12);
    rsc.push(encodeRscMeasurement({ speed: 2.9, cadence: 168 }));
    m.tick(0.1);
    expect(m.live.speed).toBeCloseTo(3, 1); // the belt wins over the pod for speed
    expect(m.live.cadence).toBe(168);
    expect(m.summary()).toMatchObject({ belt: { kind: 'bluetooth', controllable: true }, pod: { kind: 'bluetooth' } });
  });
});

describe('the simulated treadmill twin', () => {
  it('is a controllable treadmill with a footpod and a runner who can stop', async () => {
    const t = new SimTreadmill({ seed: 1 });
    expect(t.controllable).toBe(true);
    const cad: number[] = [];
    t.footpod.onRun((d) => { if (d.cadence !== undefined) cad.push(d.cadence); });
    await t.setTargetSpeed(4);
    t.tick(30);
    expect(cad[cad.length - 1]).toBeGreaterThan(165);
    t.setOverride(2.5);
    t.tick(10);
    expect(t.peripheral.speed).toBeCloseTo(2.5, 1);
  });
});
