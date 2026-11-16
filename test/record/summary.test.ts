import { describe, expect, it } from 'vitest';
import { hrZone, normalisedPower, powerZone, RideRecorder, steadyBikeSpeed, stepBikeSpeed, summarise, type RideSample } from '../../src/core/record';

function samplesFrom(power: number[], hr?: number[]): RideSample[] {
  return power.map((p, i) => ({ t: i + 1, power: p, heartRate: hr?.[i], cadence: 90, gameSpeed: 0, bikeSpeed: 8, distance: 8 * (i + 1) }));
}

describe('normalised power', () => {
  it('equals average power for a constant effort', () => {
    expect(normalisedPower(new Array(600).fill(200))).toBeCloseTo(200, 9);
  });

  it('matches a hand-computed fixture: 60 s at 100 W then 60 s at 300 W', () => {
    // Rolling 30 s averages, one per second from second 30 to second 120 (91 values):
    //   31 windows entirely inside the 100 W block (ending at seconds 30..60)   -> 100
    //   29 mixed windows ending at second 60+k, k = 1..29                       -> 100 + 200k/30
    //   31 windows entirely inside the 300 W block (ending at seconds 90..120)  -> 300
    let acc = 31 * 100 ** 4 + 31 * 300 ** 4;
    for (let k = 1; k <= 29; k++) acc += (100 + (200 * k) / 30) ** 4;
    const expected = (acc / 91) ** 0.25;
    const power = [...new Array(60).fill(100), ...new Array(60).fill(300)];
    expect(normalisedPower(power)).toBeCloseTo(expected, 9);
    expect(expected).toBeCloseTo(244.04, 1); // well above the 200 W average, as NP should be
  });

  it('falls back to the mean for rides under 30 s', () => {
    expect(normalisedPower([100, 200, 300])).toBe(200);
    expect(normalisedPower([])).toBe(0);
  });
});

describe('ride summary', () => {
  it('computes kJ, averages, IF and TSS from a hand-computed fixture', () => {
    // One hour exactly at FTP: 250 W * 3600 s = 900 kJ, IF 1.0, TSS 100.
    const s = summarise(samplesFrom(new Array(3600).fill(250)), 250, 190);
    expect(s.duration).toBe(3600);
    expect(s.kilojoules).toBeCloseTo(900, 9);
    expect(s.avgPower).toBe(250);
    expect(s.normalisedPower).toBeCloseTo(250, 9);
    expect(s.intensityFactor).toBeCloseTo(1, 9);
    expect(s.trainingStress).toBeCloseTo(100, 9);
    expect(s.calories).toBeCloseTo(896.3, 0);
  });

  it('computes kJ for a mixed effort', () => {
    const s = summarise(samplesFrom([...new Array(60).fill(100), ...new Array(60).fill(300)]), 250);
    expect(s.kilojoules).toBeCloseTo((60 * 100 + 60 * 300) / 1000, 9); // 24 kJ
    expect(s.avgPower).toBe(200);
    expect(s.maxPower).toBe(300);
  });

  it('counts time in power and heart-rate zones', () => {
    const power = [...new Array(10).fill(100), ...new Array(20).fill(200), ...new Array(5).fill(400)];
    const hr = [...new Array(10).fill(100), ...new Array(20).fill(150), ...new Array(5).fill(185)];
    const s = summarise(samplesFrom(power, hr), 250, 190);
    // 100 W = 40% (Z1), 200 W = 80% (Z3), 400 W = 160% (Z7)
    expect(s.timeInPowerZones).toEqual([10, 0, 20, 0, 0, 0, 5]);
    // 100 bpm = 53% (Z1), 150 = 79% (Z3), 185 = 97% (Z5)
    expect(s.timeInHrZones).toEqual([10, 0, 20, 0, 5]);
    expect(s.avgHeartRate).toBeCloseTo((10 * 100 + 20 * 150 + 5 * 185) / 35, 9);
    expect(s.maxHeartRate).toBe(185);
  });

  it('places zone boundaries correctly', () => {
    expect(powerZone(137, 250)).toBe(1);
    expect(powerZone(137.5, 250)).toBe(2);
    expect(powerZone(262.5, 250)).toBe(5);
    expect(powerZone(1000, 250)).toBe(7);
    expect(hrZone(113, 190)).toBe(1);
    expect(hrZone(171, 190)).toBe(5);
  });

  it('leaves heart-rate fields empty when there was no strap', () => {
    const s = summarise(samplesFrom([200, 200, 200]), 250, 190);
    expect(s.avgHeartRate).toBeUndefined();
    expect(s.timeInHrZones).toEqual([]);
  });
});

describe('bike physics', () => {
  it('gives believable flat-road speeds', () => {
    const kmh = (w: number) => steadyBikeSpeed(w) * 3.6;
    expect(kmh(100)).toBeGreaterThan(22);
    expect(kmh(100)).toBeLessThan(28);
    expect(kmh(200)).toBeGreaterThan(30);
    expect(kmh(200)).toBeLessThan(35);
    expect(kmh(300)).toBeGreaterThan(35);
    expect(kmh(300)).toBeLessThan(41);
    expect(steadyBikeSpeed(0)).toBe(0);
  });

  it('accelerates towards the steady speed and coasts down when power stops', () => {
    let v = 0;
    for (let i = 0; i < 300; i++) v = stepBikeSpeed(v, 200, 1);
    expect(v).toBeCloseTo(steadyBikeSpeed(200), 1);
    const before = v;
    for (let i = 0; i < 30; i++) v = stepBikeSpeed(v, 0, 1);
    expect(v).toBeLessThan(before * 0.75);
    expect(v).toBeGreaterThan(0);
  });
});

describe('ride recorder', () => {
  it('emits one sample per second from data arriving at any rate', () => {
    const rec = new RideRecorder(1794830400);
    rec.update(0, { power: 200, cadence: 90, heartRate: 120, gameSpeed: 100 });
    for (let i = 1; i <= 100; i++) rec.update(i / 10, { power: 200, cadence: 90, heartRate: 120, gameSpeed: 100 });
    expect(rec.samples).toHaveLength(10);
    expect(rec.samples.map((s) => s.t)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(rec.samples[4]).toMatchObject({ power: 200, cadence: 90, heartRate: 120 });
    expect(rec.samples[4].gameSpeed).toBeCloseTo(100, 6);
    expect(rec.samples[9].distance).toBeGreaterThan(rec.samples[0].distance);
  });

  it('averages power within each second', () => {
    const rec = new RideRecorder(0);
    rec.update(0, { power: 100 });
    rec.update(0.5, { power: 300 });
    rec.update(1, { power: 300 });
    expect(rec.samples[0].power).toBe(200);
  });

  it('fills gaps when a frame is late, and ignores time running backwards', () => {
    const rec = new RideRecorder(0);
    rec.update(0, { power: 150 });
    rec.update(3.5, { power: 150 });
    expect(rec.samples.map((s) => s.t)).toEqual([1, 2, 3]);
    rec.update(2, { power: 999 });
    rec.update(4, { power: 150 });
    expect(rec.samples).toHaveLength(4);
    expect(rec.samples[3].power).toBe(150);
  });

  it('keeps lap markers ordered and unique', () => {
    const rec = new RideRecorder(0);
    rec.lap(0, 'start');
    rec.lap(60, 'one');
    rec.lap(60, 'dup');
    rec.lap(120.4, 'two');
    expect(rec.laps).toEqual([{ t: 60, label: 'one' }, { t: 120, label: 'two' }]);
  });
});
