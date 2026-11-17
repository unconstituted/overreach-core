import { describe, expect, it } from 'vitest';
import {
  encodeControlPointResponse, encodeIndoorBikeData, encodeRequestControl, encodeReset, encodeSetSimulation,
  encodeSetTargetPower, encodeSetTargetResistance, encodeStop, parseControlPointCommand, parseControlPointResponse,
  parseIndoorBikeData, parseMachineFeatures, parseMachineStatus, parseSupportedPowerRange,
} from '../../src/devices/protocol/ftms';
import { CrankCadence, encodeCyclingPowerMeasurement, parseCyclingPowerMeasurement } from '../../src/devices/protocol/cps';
import { encodeHeartRateMeasurement, parseHeartRateMeasurement } from '../../src/devices/protocol/hrs';

const hex = (s: string) => new Uint8Array(s.trim().split(/\s+/).map((b) => parseInt(b, 16)));

describe('FTMS Indoor Bike Data (0x2AD2)', () => {
  it('parses speed, cadence and power (flags 0x0044)', () => {
    // flags 44 00 | speed 0x0BB8 = 3000 -> 30.00 km/h | cadence 0x00B4 = 180 -> 90 rpm | power 0x00FA = 250 W
    expect(parseIndoorBikeData(hex('44 00 B8 0B B4 00 FA 00'))).toEqual({ speedKmh: 30, cadence: 90, power: 250 });
  });

  it('treats bit 0 as "more data": speed is absent when it is set', () => {
    // flags 45 00: bit0 set (no speed), cadence, power
    expect(parseIndoorBikeData(hex('45 00 A0 00 2C 01'))).toEqual({ cadence: 80, power: 300 });
  });

  it('parses a full packet with every field, in specification order', () => {
    // flags 0x1FFE: everything present including instantaneous speed
    const p = parseIndoorBikeData(hex(
      'FE 1F ' +
      '10 0E ' +      // speed 3600 -> 36.00 km/h
      '7C 0D ' +      // avg speed 3452 -> 34.52
      'BE 00 ' +      // cadence 190 -> 95
      'B8 00 ' +      // avg cadence 184 -> 92
      '40 E2 01 ' +   // total distance 0x01E240 = 123456 m
      '0A 00 ' +      // resistance 10
      '13 01 ' +      // power 275
      'FF 00 ' +      // avg power 255
      '2C 01 58 02 0A ' + // energy 300 kcal, 600 /h, 10 /min
      '96 ' +         // heart rate 150
      '55 ' +         // MET 8.5
      '10 0E ' +      // elapsed 3600 s
      '2C 01'));      // remaining 300 s
    expect(p).toEqual({
      speedKmh: 36, avgSpeedKmh: 34.52, cadence: 95, avgCadence: 92, totalDistance: 123456, resistanceLevel: 10,
      power: 275, avgPower: 255, totalEnergyKcal: 300, energyPerHourKcal: 600, energyPerMinuteKcal: 10,
      heartRate: 150, metabolicEquivalent: 8.5, elapsedTime: 3600, remainingTime: 300,
    });
  });

  it('reads negative power as signed', () => {
    expect(parseIndoorBikeData(hex('41 00 FB FF')).power).toBe(-5);
  });

  it('survives a truncated packet without throwing', () => {
    expect(parseIndoorBikeData(hex('44 00 B8 0B B4'))).toEqual({ speedKmh: 30 });
    expect(() => parseIndoorBikeData(hex('44'))).toThrow();
  });

  it('round-trips through the encoder', () => {
    const d = { speedKmh: 32.5, cadence: 87.5, totalDistance: 70000, power: 312, elapsedTime: 1234 };
    expect(parseIndoorBikeData(encodeIndoorBikeData(d))).toEqual(d);
  });
});

describe('FTMS Control Point (0x2AD9)', () => {
  it('encodes commands to the bytes in the specification', () => {
    expect([...encodeRequestControl()]).toEqual([0x00]);
    expect([...encodeReset()]).toEqual([0x01]);
    expect([...encodeSetTargetPower(250)]).toEqual([0x05, 0xfa, 0x00]);
    expect([...encodeSetTargetPower(1000)]).toEqual([0x05, 0xe8, 0x03]);
    expect([...encodeSetTargetResistance(45.5)]).toEqual([0x04, 0xff]); // 455 clamps to 255
    expect([...encodeSetTargetResistance(12.3)]).toEqual([0x04, 123]);
    expect([...encodeStop()]).toEqual([0x08, 0x01]);
    expect([...encodeStop(true)]).toEqual([0x08, 0x02]);
    // wind 0, grade 5.00% -> 500 = 0x01F4, crr 0.004 -> 40 = 0x28, cw 0.51 -> 51 = 0x33
    expect([...encodeSetSimulation({ grade: 5 })]).toEqual([0x11, 0x00, 0x00, 0xf4, 0x01, 0x28, 0x33]);
    // wind -2.5 m/s -> -2500 = 0xF63C, grade -3.2% -> -320 = 0xFEC0
    expect([...encodeSetSimulation({ grade: -3.2, windSpeed: -2.5, crr: 0.005, cw: 0.6 })])
      .toEqual([0x11, 0x3c, 0xf6, 0xc0, 0xfe, 0x32, 0x3c]);
  });

  it('parses commands as a trainer would', () => {
    expect(parseControlPointCommand(hex('00'))).toEqual({ op: 'requestControl' });
    expect(parseControlPointCommand(hex('05 2C 01'))).toEqual({ op: 'setTargetPower', watts: 300 });
    expect(parseControlPointCommand(hex('11 00 00 F4 01 28 33'))).toEqual({ op: 'setSimulation', windSpeed: 0, grade: 5, crr: 0.004, cw: 0.51 });
    expect(parseControlPointCommand(hex('42'))).toEqual({ op: 'unknown', code: 0x42 });
    expect(parseControlPointCommand(hex('05 2C'))).toEqual({ op: 'unknown', code: 0x05 });
  });

  it('parses response indications', () => {
    expect(parseControlPointResponse(hex('80 05 01'))).toEqual({ requestOp: 5, result: 1, ok: true, text: 'success' });
    expect(parseControlPointResponse(hex('80 05 05'))).toMatchObject({ ok: false, text: 'control not permitted' });
    expect(parseControlPointResponse(hex('80 11 03'))).toMatchObject({ requestOp: 0x11, ok: false, text: 'invalid parameter' });
    expect(parseControlPointResponse(hex('05 FA 00'))).toBeUndefined();
    expect([...encodeControlPointResponse(0x05, 0x01)]).toEqual([0x80, 0x05, 0x01]);
  });
});

describe('FTMS status, power range and features', () => {
  it('parses status notifications', () => {
    expect(parseMachineStatus(hex('01'))).toEqual({ kind: 'reset' });
    expect(parseMachineStatus(hex('02 01'))).toEqual({ kind: 'stopped' });
    expect(parseMachineStatus(hex('02 02'))).toEqual({ kind: 'paused' });
    expect(parseMachineStatus(hex('04'))).toEqual({ kind: 'started' });
    expect(parseMachineStatus(hex('08 FA 00'))).toEqual({ kind: 'targetPowerChanged', watts: 250 });
    expect(parseMachineStatus(hex('07 32'))).toEqual({ kind: 'targetResistanceChanged', level: 5 });
    expect(parseMachineStatus(hex('12 00 00 F4 01 28 33'))).toEqual({ kind: 'simulationChanged', windSpeed: 0, grade: 5, crr: 0.004, cw: 0.51 });
    expect(parseMachineStatus(hex('FF'))).toEqual({ kind: 'controlPermissionLost' });
    expect(parseMachineStatus(hex('0A'))).toEqual({ kind: 'other', code: 10 });
  });

  it('parses the supported power range', () => {
    // min 0, max 2000 (0x07D0), increment 1
    expect(parseSupportedPowerRange(hex('00 00 D0 07 01 00'))).toEqual({ min: 0, max: 2000, increment: 1 });
    expect(parseSupportedPowerRange(hex('00 00'))).toBeUndefined();
  });

  it('parses the feature bits that matter for control', () => {
    // features: cadence (bit 1) + power measurement (bit 14) = 0x00004002
    // targets: resistance (bit 2) + power (bit 3) + simulation (bit 13) = 0x0000200C
    expect(parseMachineFeatures(hex('02 40 00 00 0C 20 00 00'))).toEqual({
      cadence: true, powerMeasurement: true, resistanceTarget: true, powerTarget: true, simulation: true,
      inclination: false, speedTarget: false, inclinationTarget: false,
    });
    expect(parseMachineFeatures(hex('00 00 00 00 00 00 00 00'))).toMatchObject({ powerTarget: false, simulation: false });
  });
});

describe('Cycling Power Measurement (0x2A63)', () => {
  it('parses power only', () => {
    expect(parseCyclingPowerMeasurement(hex('00 00 2C 01'))).toEqual({ power: 300 });
  });

  it('parses crank revolution data', () => {
    // flags 0x0020 | power 210 | crank revs 0x0102 = 258 | event time 0x0400 = 1024
    expect(parseCyclingPowerMeasurement(hex('20 00 D2 00 02 01 00 04'))).toEqual({ power: 210, crankRevolutions: 258, crankEventTime: 1024 });
  });

  it('skips the optional fields before crank data in the right order', () => {
    // flags 0x0035: balance (bit0), torque (bit2), wheel (bit4), crank (bit5)
    const m = parseCyclingPowerMeasurement(hex('35 00 C8 00 64 40 01 10 27 00 00 00 08 0A 00 00 0C'));
    expect(m).toEqual({
      power: 200, pedalBalance: 50, accumulatedTorque: 10, wheelRevolutions: 10000, wheelEventTime: 2048,
      crankRevolutions: 10, crankEventTime: 3072,
    });
  });

  it('round-trips through the encoder', () => {
    const m = { power: 345, crankRevolutions: 777, crankEventTime: 12345 };
    expect(parseCyclingPowerMeasurement(encodeCyclingPowerMeasurement(m))).toEqual(m);
  });
});

describe('crank cadence maths', () => {
  it('computes rpm from revolution and time deltas', () => {
    const c = new CrankCadence();
    expect(c.update(100, 0)).toBe(0); // first packet only sets the baseline
    // 3 revolutions in 2048/1024 = 2 s -> 90 rpm
    expect(c.update(103, 2048)).toBeCloseTo(90, 9);
    // 1 revolution in 0.6 s -> 100 rpm
    expect(c.update(104, 2048 + 614)).toBeCloseTo(100.07, 1);
  });

  it('handles the 16-bit wrap of both counters', () => {
    const c = new CrankCadence();
    c.update(65535, 65000);
    // revs wrap 65535 -> 1 (2 revs); time wraps 65000 -> 488 (1024 ticks = 1 s) -> 120 rpm
    expect(c.update(1, 488)).toBeCloseTo(120, 9);
  });

  it('holds the last cadence briefly when no new revolution arrives, then drops to zero', () => {
    const c = new CrankCadence(3);
    c.update(10, 0);
    c.update(11, 683); // about 90 rpm
    expect(c.update(11, 683)).toBeGreaterThan(80);
    expect(c.update(11, 683)).toBeGreaterThan(80);
    expect(c.update(11, 683)).toBe(0);
    // Pedalling again recovers.
    expect(c.update(12, 683 + 1024)).toBeCloseTo(60, 9);
  });

  it('ignores impossible values', () => {
    const c = new CrankCadence();
    c.update(10, 0);
    c.update(11, 683);
    const before = c.update(11, 683);
    expect(c.update(500, 700)).toBe(before); // 489 revs in 17 ms is a glitch
  });
});

describe('Heart Rate Measurement (0x2A37)', () => {
  it('parses an 8-bit heart rate', () => {
    expect(parseHeartRateMeasurement(hex('00 48'))).toEqual({ bpm: 72, rr: [] });
  });

  it('parses a 16-bit heart rate', () => {
    expect(parseHeartRateMeasurement(hex('01 2C 01')).bpm).toBe(300);
  });

  it('parses contact status, energy expended and RR intervals', () => {
    // flags 0x1E: contact supported + detected, energy present, RR present
    const m = parseHeartRateMeasurement(hex('1E 96 64 00 00 02 9A 01'));
    expect(m.bpm).toBe(150);
    expect(m.contact).toBe(true);
    expect(m.energyExpended).toBe(100);
    expect(m.rr[0]).toBeCloseTo(0.5, 9); // 0x0200 = 512 / 1024
    expect(m.rr[1]).toBeCloseTo(410 / 1024, 9);
  });

  it('reports lost skin contact', () => {
    expect(parseHeartRateMeasurement(hex('04 00')).contact).toBe(false);
  });

  it('round-trips through the encoder', () => {
    const m = parseHeartRateMeasurement(encodeHeartRateMeasurement({ bpm: 143, contact: true, rr: [0.42] }));
    expect(m.bpm).toBe(143);
    expect(m.contact).toBe(true);
    expect(m.rr[0]).toBeCloseTo(0.42, 2);
  });
});
