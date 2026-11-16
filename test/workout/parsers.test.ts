import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeFit } from '../../src/core/fit';
import { parseFitWorkout, parseZwo, totalDuration, writeFitWorkout, writeZwo } from '../../src/core/workout';

const zwoText = readFileSync('reference/workouts/Rubicon_Storm_Front.zwo', 'utf8');
const fitBytes = new Uint8Array(readFileSync('reference/workouts/CrushCh1.fit'));

describe('.zwo parser', () => {
  it('parses the Storm Front reference workout', () => {
    const w = parseZwo(zwoText);
    expect(w.name).toBe('Rubicon: Storm Front');
    expect(w.author).toBe('Rubicon concept');
    expect(w.sport).toBe('bike');
    expect(w.description).toMatch(/^Chapter test mission/);
    // Count the source elements independently of the parser.
    const expectedSteps = (zwoText.match(/<(SteadyState|Cooldown)\b/g) ?? []).length;
    expect(w.steps).toHaveLength(expectedSteps);
    const expectedDuration = [...zwoText.matchAll(/<(?:SteadyState|Cooldown) Duration="(\d+)"/g)].reduce((a, m) => a + Number(m[1]), 0);
    expect(w.steps[w.steps.length - 1]).toMatchObject({ kind: 'ramp', intensity: 'cooldown', duration: 390, target: { from: 0.58, to: 0.45 } });
    expect(totalDuration(w)).toBe(expectedDuration);
    expect(totalDuration(w)).toBe(3600);
    expect(w.steps[0]).toMatchObject({ kind: 'steady', duration: 180, erg: true, target: { unit: 'ftp', from: 0.55, to: 0.55 } });
    expect(w.steps[0].texts).toEqual([
      { offset: 10, message: 'AI: Dropping through the cloud deck. Easy for now.' },
      { offset: 120, message: 'AI: Sea state is climbing. Stay low and let the swell carry us.' },
    ]);
    const gust = w.steps.find((s) => s.target?.from === 1.4);
    expect(gust).toMatchObject({ duration: 15, cadence: 100 });
    const texts = w.steps.reduce((a, s) => a + s.texts.length, 0);
    expect(texts).toBe((zwoText.match(/<textevent\b/g) ?? []).length);
  });

  it('parses every Zwift element type', () => {
    const w = parseZwo(`<?xml version="1.0"?>
      <workout_file><name>All &amp; sundry</name><sportType>bike</sportType><workout>
        <!-- a comment -->
        <Warmup Duration="300" PowerLow="0.4" PowerHigh="0.75"><textevent timeoffset="5" message="Easy &quot;spin&quot;"/></Warmup>
        <SteadyState Duration="120" Power="0.9" Cadence="95"/>
        <IntervalsT Repeat="3" OnDuration="30" OffDuration="45" OnPower="1.3" OffPower="0.5" Cadence="105" CadenceResting="85">
          <textevent timeoffset="0" message="Go"/><textevent timeoffset="80" message="Again" duration="4"/>
        </IntervalsT>
        <Ramp Duration="60" PowerLow="0.8" PowerHigh="1.1"/>
        <FreeRide Duration="90" FlatRoad="1"/>
        <Cooldown Duration="200" PowerLow="0.7" PowerHigh="0.4"/>
      </workout></workout_file>`);
    expect(w.name).toBe('All & sundry');
    expect(w.steps.map((s) => s.kind)).toEqual(['ramp', 'steady', 'steady', 'steady', 'steady', 'steady', 'steady', 'steady', 'ramp', 'free', 'ramp']);
    expect(w.steps[0]).toMatchObject({ intensity: 'warmup', target: { from: 0.4, to: 0.75 } });
    expect(w.steps[0].texts[0].message).toBe('Easy "spin"');
    expect(w.steps[2]).toMatchObject({ duration: 30, cadence: 105, set: { rep: 1, of: 3, phase: 'on' } });
    expect(w.steps[3]).toMatchObject({ duration: 45, cadence: 85, set: { rep: 1, of: 3, phase: 'off' } });
    expect(w.steps[2].texts).toEqual([{ offset: 0, message: 'Go' }]);
    expect(w.steps[4].texts).toEqual([{ offset: 5, message: 'Again', duration: 4 }]);
    expect(w.steps[9]).toMatchObject({ kind: 'free', erg: false });
    expect(w.steps[9].target).toBeUndefined();
    expect(w.steps[10]).toMatchObject({ intensity: 'cooldown', target: { from: 0.7, to: 0.4 } });
    expect(totalDuration(w)).toBe(300 + 120 + 3 * 75 + 60 + 90 + 200);
  });

  it('round-trips through the writer', () => {
    const a = parseZwo(zwoText);
    const b = parseZwo(writeZwo(a));
    expect(b.steps).toEqual(a.steps);
    expect(b.name).toBe(a.name);
  });

  it('gives a clear error for something that is not a workout', () => {
    expect(() => parseZwo('<gpx></gpx>')).toThrow(/workout_file/);
    expect(() => parseZwo('<workout_file><workout></workout></workout_file>')).toThrow(/no workout steps/);
  });
});

describe('FIT workout parser', () => {
  it('parses the Chapter 1 reference workout', () => {
    expect(decodeFit(fitBytes).crcOk).toBe(true);
    const w = parseFitWorkout(fitBytes);
    expect(w.name).toBe('Crush Ch1 The Disaster');
    expect(w.sport).toBe('bike');
    expect(w.steps).toHaveLength(37);
    expect(totalDuration(w)).toBe(2100); // 35 minutes
    expect(w.steps[0]).toMatchObject({
      kind: 'steady', duration: 120, label: 'Corridor', intensity: 'warmup', erg: true,
      target: { unit: 'ftp', from: 0.5, to: 0.5, low: 0.46, high: 0.54 },
    });
    expect(w.steps[0].texts).toEqual([{ offset: 0, message: 'Easy spin. Hangar ahead' }]);
    const surge = w.steps[10];
    expect(surge.label).toBe('ESCAPE SURGE');
    expect(surge.duration).toBe(20);
    expect(surge.target?.from).toBeCloseTo(1.15, 10);
    expect(w.steps[36]).toMatchObject({ label: 'The gate', intensity: 'cooldown' });
    expect(w.steps.filter((s) => (s.target?.from ?? 0) >= 1).length).toBe(7);
  });

  it('round-trips through the FIT workout writer', () => {
    const a = parseFitWorkout(fitBytes);
    const b = parseFitWorkout(writeFitWorkout(a));
    expect(b.name).toBe(a.name);
    expect(b.steps.length).toBe(a.steps.length);
    b.steps.forEach((s, i) => {
      expect(s.duration).toBe(a.steps[i].duration);
      expect(s.label).toBe(a.steps[i].label);
      expect(s.target?.from).toBeCloseTo(a.steps[i].target?.from ?? -1, 6);
      expect(s.intensity).toBe(a.steps[i].intensity);
    });
  });

  it('reads absolute watt targets and expands repeat steps', async () => {
    const { FitWriter, BaseType } = await import('../../src/core/fit');
    const wr = new FitWriter();
    wr.define(0, 26, [{ num: 4, type: BaseType.enum }, { num: 6, type: BaseType.uint16 }, { num: 8, type: BaseType.string, size: 16 }]);
    wr.write(0, [2, 4, 'Repeats']);
    wr.define(1, 27, [
      { num: 254, type: BaseType.uint16 }, { num: 1, type: BaseType.enum }, { num: 2, type: BaseType.uint32 },
      { num: 3, type: BaseType.enum }, { num: 4, type: BaseType.uint32 }, { num: 5, type: BaseType.uint32 }, { num: 6, type: BaseType.uint32 },
    ]);
    wr.write(1, [0, 0, 60000, 4, 0, 1150, 1170]); // 150 to 170 W
    wr.write(1, [1, 0, 30000, 4, 0, 1290, 1310]); // on: 290 to 310 W
    wr.write(1, [2, 0, 45000, 2, 0, undefined, undefined]); // off: open target
    wr.write(1, [3, 6, 1, undefined, 4, undefined, undefined]); // repeat steps 1..2 four times
    const w = parseFitWorkout(wr.finish());
    expect(w.steps).toHaveLength(1 + 4 * 2);
    expect(w.steps[0].target).toMatchObject({ unit: 'watts', from: 160, low: 150, high: 170 });
    expect(w.steps[1].target).toMatchObject({ unit: 'watts', from: 300 });
    expect(w.steps[2]).toMatchObject({ kind: 'free', erg: false, duration: 45 });
    expect(w.steps[7].set).toMatchObject({ rep: 4, of: 4, phase: 'on' });
    expect(totalDuration(w)).toBe(60 + 4 * 75);
  });
});
