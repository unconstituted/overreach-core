import { readFileSync } from 'node:fs';
import FitParser from 'fit-file-parser';
import { describe, expect, it } from 'vitest';
import { BaseType, decodeFit, FitWriter, Mesg, messagesOf } from '../../src/core/fit';
import { FEEL_PRESETS, FeelEngine } from '../../src/core/feel';
import { encodeFitActivity, RideRecorder, summarise } from '../../src/core/record';
import {
  asRun, buildWorkout, effortToPace, formatPace, hrToEffort, paceToEffort, paceToSpeed, parseFitWorkout, parseZwo, runEffort,
  speedToPace, stepPeakFraction, totalDuration, workoutKind, WorkoutRunner, writeFitWorkout, writeZwo,
} from '../../src/core/workout';

const TH = { ftp: 250, thresholdSpeed: 4, maxHr: 190 };

describe('effort mapping between running pace and cycling intensity', () => {
  it('hits the anchor points', () => {
    expect(paceToEffort(0)).toBe(0);
    expect(paceToEffort(0.8)).toBeCloseTo(0.5, 10);
    expect(paceToEffort(1)).toBeCloseTo(1, 10);
    expect(paceToEffort(1.08)).toBeCloseTo(1.2, 10);
    expect(paceToEffort(1.2)).toBeCloseTo(1.5, 10);
  });
  it('is continuous, increasing and inverted by effortToPace', () => {
    let prev = -1;
    for (let f = 0; f <= 1.4; f += 0.01) {
      const e = paceToEffort(f);
      expect(e).toBeGreaterThan(prev);
      expect(effortToPace(e)).toBeCloseTo(f, 9);
      prev = e;
    }
  });
  it('makes incline cost effort, and treats standing still as no effort', () => {
    expect(runEffort(4, 0, 4)).toBeCloseTo(1, 10);
    expect(runEffort(4, 5, 4)).toBeGreaterThan(1.4);
    expect(runEffort(4, -5, 4)).toBeCloseTo(1, 10);
    expect(runEffort(0, 10, 4)).toBe(0);
  });
  it('maps heart rate: 60% of max is easy, 90% is threshold', () => {
    expect(hrToEffort(0.6)).toBeCloseTo(0.5, 10);
    expect(hrToEffort(0.9)).toBeCloseTo(1, 10);
  });
});

describe('pace helpers', () => {
  it('converts and formats pace', () => {
    expect(paceToSpeed(300)).toBeCloseTo(3.3333, 4);
    expect(speedToPace(4)).toBe(250);
    expect(formatPace(4)).toBe('4:10');
    expect(formatPace(4, 'imperial')).toBe('6:42');
    expect(formatPace(0)).toBe('–:––');
  });
});

describe('pace and heart-rate targets in the model and runner', () => {
  const w = buildWorkout({
    name: 'Run', sport: 'run',
    steps: [
      { kind: 'steady', duration: 300, pace: 0.8, label: 'Easy' },
      { kind: 'ramp', duration: 100, from: 0.8, to: 0.95 },
      { kind: 'intervals', repeat: 2, on: { duration: 60, pace: 1.1 }, off: { duration: 60, secPerKm: 360 } },
      { kind: 'steady', duration: 120, hr: 0.7 },
      { kind: 'steady', duration: 60, bpm: 150 },
    ],
  });
  const r = new WorkoutRunner(w, TH);

  it('reports pace targets as a speed and a fraction', () => {
    const s = r.stateAt(10);
    expect(s.targetKind).toBe('pace');
    expect(s.targetSpeed).toBeCloseTo(3.2, 10);
    expect(s.targetFraction).toBeCloseTo(0.8, 10);
    expect(s.targetWatts).toBeUndefined();
    const ramp = r.stateAt(350);
    expect(ramp.targetFraction).toBeCloseTo(0.875, 10);
    expect(ramp.targetSpeed).toBeCloseTo(3.5, 10);
  });
  it('turns an absolute pace into a speed', () => {
    const s = r.stateAt(400 + 60 + 5);
    expect(s.targetSpeed).toBeCloseTo(1000 / 360, 10);
    expect(s.targetFraction).toBeCloseTo(1000 / 360 / 4, 10);
  });
  it('reports heart-rate targets in bpm', () => {
    expect(r.stateAt(640 + 10)).toMatchObject({ targetKind: 'hr', targetHr: 133 });
    expect(r.stateAt(640 + 130).targetHr).toBe(150);
  });
  it('cues a runner before steps at threshold pace or faster', () => {
    expect(r.cues.map((c) => c.at)).toEqual([400, 520]);
    expect(r.stateAt(397).cues[0].message).toBe('Pick it up in 3');
    expect(stepPeakFraction(w.steps[7], TH)).toBeLessThan(1); // 150 bpm of 190 is below threshold heart rate
  });
  it('knows a pace workout from a power one', () => {
    expect(workoutKind(w)).toBe('pace');
    expect(workoutKind(buildWorkout({ name: 'b', steps: [{ kind: 'steady', duration: 60, power: 0.7 }] }))).toBe('power');
  });
});

describe('Zwift run workouts', () => {
  const xml = `<workout_file><name>Tempo run</name><sportType>run</sportType><workout>
    <Warmup Duration="600" PowerLow="0.7" PowerHigh="0.85"/>
    <IntervalsT Repeat="3" OnDuration="240" OffDuration="120" OnPower="1.02" OffPower="0.8"/>
    <SteadyState Duration="300" Power="0.9"><textevent timeoffset="10" message="Hold it"/></SteadyState>
    <FreeRide Duration="300"/>
  </workout></workout_file>`;
  const w = parseZwo(xml);
  it('reads "Power" as a fraction of threshold pace', () => {
    expect(w.sport).toBe('run');
    expect(w.steps[0].target).toEqual({ unit: 'pace', from: 0.7, to: 0.85 });
    expect(w.steps[1].target?.unit).toBe('pace');
    expect(w.steps[1].target?.from).toBe(1.02);
    expect(totalDuration(w)).toBe(600 + 3 * 360 + 300 + 300);
  });
  it('round-trips through the writer (interval sets come back as plain steps)', () => {
    const again = parseZwo(writeZwo(w));
    expect(again.sport).toBe('run');
    expect(again.steps.map((s) => [s.kind, s.duration, s.target, s.texts])).toEqual(w.steps.map((s) => [s.kind, s.duration, s.target, s.texts]));
  });
  it('writes absolute speeds as fractions of the given threshold', () => {
    const abs = buildWorkout({ name: 'a', sport: 'run', steps: [{ kind: 'steady', duration: 60, secPerKm: 250 }] });
    expect(parseZwo(writeZwo(abs, 250, 4)).steps[0].target).toEqual({ unit: 'pace', from: 1, to: 1 });
  });
});

describe('FIT run workouts', () => {
  it('reads speed and heart-rate targets from hand-built bytes', () => {
    const wr = new FitWriter();
    wr.define(0, Mesg.workout, [{ num: 4, type: BaseType.enum }, { num: 8, type: BaseType.string, size: 16 }]);
    wr.write(0, [1, 'Garmin run']);
    wr.define(1, Mesg.workoutStep, [
      { num: 254, type: BaseType.uint16 }, { num: 1, type: BaseType.enum }, { num: 2, type: BaseType.uint32 },
      { num: 3, type: BaseType.enum }, { num: 4, type: BaseType.uint32 }, { num: 5, type: BaseType.uint32 }, { num: 6, type: BaseType.uint32 },
    ]);
    wr.write(1, [0, 0, 600000, 0, 0, 2900, 3100]); // speed 2.9 to 3.1 m/s
    wr.write(1, [1, 0, 300000, 1, 2, undefined, undefined]); // heart-rate zone 2
    wr.write(1, [2, 0, 300000, 1, 0, 255, 265]); // 155 to 165 bpm
    wr.write(1, [3, 0, 300000, 1, 0, 80, 85]); // 80 to 85% of max
    const w = parseFitWorkout(wr.finish());
    expect(w.sport).toBe('run');
    expect(w.steps[0].target).toMatchObject({ unit: 'speed', low: 2.9, high: 3.1 });
    expect(w.steps[0].target?.from).toBeCloseTo(3, 10);
    expect(w.steps[1].target).toMatchObject({ unit: 'hr', low: 0.6, high: 0.7 });
    expect(w.steps[2].target).toMatchObject({ unit: 'bpm', from: 160, low: 155, high: 165 });
    expect(w.steps[3].target).toMatchObject({ unit: 'hr', low: 0.8, high: 0.85 });
  });
  it('round-trips pace and heart-rate targets through the writer', () => {
    const w = buildWorkout({
      name: 'Rt', sport: 'run',
      steps: [{ kind: 'steady', duration: 120, pace: 1 }, { kind: 'steady', duration: 60, bpm: 150 }, { kind: 'steady', duration: 60, hr: 0.75 }],
    });
    const again = parseFitWorkout(writeFitWorkout(w, { thresholdSpeed: 4 }));
    expect(again.sport).toBe('run');
    expect(again.steps[0].target?.unit).toBe('speed');
    expect(again.steps[0].target?.from).toBeCloseTo(4, 3);
    expect(again.steps[1].target).toMatchObject({ unit: 'bpm' });
    expect(again.steps[1].target?.from).toBeCloseTo(150, 5);
    expect(again.steps[2].target?.unit).toBe('hr');
    expect(again.steps[2].target?.from).toBeCloseTo(0.75, 5);
  });
});

describe('Chapter 1 as a run', () => {
  const ride = parseFitWorkout(new Uint8Array(readFileSync('reference/workouts/CrushCh1.fit')));
  const run = asRun(ride);
  it('keeps the timing and maps every power target to pace at the same effort', () => {
    expect(run.sport).toBe('run');
    expect(totalDuration(run)).toBe(totalDuration(ride));
    run.steps.forEach((s, i) => {
      const src = ride.steps[i];
      expect(s.duration).toBe(src.duration);
      if (!src.target) return;
      expect(s.target?.unit).toBe('pace');
      expect(paceToEffort(s.target?.from as number)).toBeCloseTo(Math.max(src.target.from, paceToEffort(0.5)), 2);
      expect(s.cadence).toBeUndefined();
    });
  });
  it('still cues the hard steps', () => {
    const a = new WorkoutRunner(ride, TH).cues.map((c) => c.at);
    const b = new WorkoutRunner(run, TH).cues.map((c) => c.at);
    expect(b).toEqual(a);
  });
});

describe('feel layer for a runner', () => {
  it('strikes once per step when given a step rate', () => {
    const f = new FeelEngine({ ...FEEL_PRESETS.standard }, 250);
    let strikes = 0;
    for (let i = 0; i < 600; i++) strikes += f.update(0.1, { power: 250, cadence: 0, strikeRate: 170 }).filter((e) => e.type === 'stroke').length;
    expect(strikes).toBeGreaterThanOrEqual(169);
    expect(strikes).toBeLessThanOrEqual(171);
  });
  it('still strikes twice per crank revolution for a rider', () => {
    const f = new FeelEngine({ ...FEEL_PRESETS.standard }, 250);
    let strikes = 0;
    for (let i = 0; i < 600; i++) strikes += f.update(0.1, { power: 250, cadence: 90 }).filter((e) => e.type === 'stroke').length;
    expect(strikes).toBeGreaterThanOrEqual(179);
    expect(strikes).toBeLessThanOrEqual(181);
  });
});

/** A 20-minute treadmill run: 10 min at 3.2 m/s, 10 min at 4 m/s, 170 then 180 steps per minute, no power. */
function makeRun(withPower = false) {
  const start = Date.UTC(2026, 10, 17, 7, 0, 0) / 1000;
  const rec = new RideRecorder(start);
  const at = (t: number) => (t < 600 ? 3.2 : 4);
  for (let t = 0; t <= 1200; t++) {
    if (t === 600) rec.lap(t);
    rec.update(t, { power: withPower ? (t < 600 ? 220 : 280) : 0, cadence: t < 600 ? 170 : 181, heartRate: 140 + t / 60, roadSpeed: at(t) });
  }
  return rec.ride();
}

describe('recording a run', () => {
  const ride = makeRun();
  const s = summarise(ride.samples, 250, 190, { sport: 'run', thresholdSpeed: 4, mass: 70 });
  it('takes distance from the treadmill speed', () => {
    expect(s.distance).toBeCloseTo(600 * 3.2 + 600 * 4, -1);
    expect(s.hasPower).toBe(false);
    expect(s.sport).toBe('run');
  });
  it('scores intensity from pace when there is no power', () => {
    // Half at 80% of threshold pace, half at threshold: normalised speed is about 92% of threshold,
    // which is an effort of about 0.8.
    expect(s.normalisedSpeed).toBeCloseTo(((3.2 ** 4 + 4 ** 4) / 2) ** 0.25, 1);
    expect(s.intensityFactor).toBeCloseTo(paceToEffort((s.normalisedSpeed as number) / 4), 10);
    expect(s.intensityFactor).toBeGreaterThan(0.75);
    expect(s.intensityFactor).toBeLessThan(0.85);
    expect(s.trainingStress).toBeCloseTo((1200 / 3600) * s.intensityFactor ** 2 * 100, 6);
    expect(s.calories).toBeCloseTo((s.distance / 1000) * 70, 6);
  });
});

describe('FIT activity for a run', () => {
  const bytes = encodeFitActivity(makeRun(), { ftp: 250, maxHr: 190, sport: 'run', thresholdSpeed: 4 });
  it('is written as a treadmill run with strides per minute and no power', () => {
    const f = decodeFit(bytes);
    expect(f.crcOk).toBe(true);
    const session = messagesOf(f, Mesg.session)[0].fields;
    expect(session[5]).toBe(1); // sport: running
    expect(session[6]).toBe(1); // sub-sport: treadmill
    expect(session[20]).toBeUndefined(); // no average power
    const rec = messagesOf(f, Mesg.record);
    expect(rec[0].fields[4]).toBe(85); // 170 steps per minute = 85 strides
    expect(rec[0].fields[53]).toBe(0);
    expect(rec[700].fields[4]).toBe(90); // 181 steps = 90.5 strides
    expect(rec[700].fields[53]).toBe(64);
    expect(rec[0].fields[7]).toBeUndefined();
  });
  it('decodes as a run with an independent decoder', async () => {
    const parser = new FitParser({ force: false, speedUnit: 'm/s', lengthUnit: 'm', mode: 'list' });
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const data = await parser.parseAsync(buf);
    const session = data.sessions![0];
    expect(session.sport).toBe('running');
    expect(session.sub_sport).toBe('treadmill');
    expect(session.total_distance as number).toBeCloseTo(4320, -1);
    expect(data.records).toHaveLength(1200);
    expect(data.laps).toHaveLength(2);
  });
  it('keeps running power when a footpod reports it', () => {
    const f = decodeFit(encodeFitActivity(makeRun(true), { ftp: 250, sport: 'run' }));
    expect(messagesOf(f, Mesg.session)[0].fields[20]).toBe(250);
    expect(messagesOf(f, Mesg.record)[5].fields[7]).toBe(220);
  });
});
