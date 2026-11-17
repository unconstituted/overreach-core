import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ChapterRuntime, checkChapter, loadChapterWorkout } from '../../src/core/chapter';
import { chapterFromMap, chapterFromWorkout, FREE_RIDE_LIMIT, FreeRide, loadWorkoutDoc, type MapDoc, type WorkoutDoc } from '../../src/core/content';
import { RideRecorder, steadyBikeSpeed } from '../../src/core/record';
import { totalDuration } from '../../src/core/workout';

const validate = new Ajv2020({ allErrors: true, allowUnionTypes: true }).compile(JSON.parse(readFileSync('schemas/chapter.schema.json', 'utf8')));
const workoutDoc = (id: string) => JSON.parse(readFileSync(`content/workouts/${id}.workout.json`, 'utf8')) as WorkoutDoc;
const mapDoc = (id: string) => JSON.parse(readFileSync(`content/maps/${id}.map.json`, 'utf8')) as MapDoc;
const read = (f: string) => readFileSync(`content/workouts/${f}`, 'utf8');

describe('a chapter generated from a workout', () => {
  for (const id of ['burn-windows', 'systems-check', 'storm-front', 'ring-runs']) {
    it(`${id}: is a valid chapter that plays the same workout`, () => {
      const w = loadWorkoutDoc(workoutDoc(id), read);
      const ch = chapterFromWorkout(`workout-${id}`, w.name, w);
      expect(validate(ch), JSON.stringify(validate.errors?.slice(0, 3))).toBe(true);
      expect(checkChapter(ch, { workout: loadChapterWorkout(ch) })).toEqual([]);
      const again = loadChapterWorkout(ch);
      expect(totalDuration(again)).toBe(totalDuration(w));
      expect(again.steps.map((s) => [s.kind === 'free' ? 'free' : 'target', s.duration, s.target?.from, s.target?.to, s.erg, s.label]))
        .toEqual(w.steps.map((s) => [s.kind === 'free' ? 'free' : 'target', s.duration, s.target?.from, s.target?.to, s.erg, s.label]));
      const rt = new ChapterRuntime(ch, { ftp: 250 });
      const mid = rt.stateAt(ch.duration / 2);
      expect(mid.scene.id).toBe('space');
      expect(mid.scene.speed).toBeGreaterThan(200);
      expect(rt.stateAt(ch.duration - 0.01).workout.finished).toBe(false);
    });
  }
  it('makes the ship faster and the view wider when the target is higher', () => {
    const w = loadWorkoutDoc(workoutDoc('burn-windows'));
    const rt = new ChapterRuntime(chapterFromWorkout('x', 'X', w), { ftp: 250 });
    const hard = w.steps.findIndex((s) => (s.target?.from ?? 0) >= 1.15);
    const tHard = rt.runner.starts[hard] + 60;
    const tEasy = rt.runner.starts[hard + 1] + 60;
    expect(rt.stateAt(tHard).scene.speed).toBeGreaterThan(rt.stateAt(tEasy).scene.speed * 2);
    expect(rt.stateAt(tHard).scene.curves.fov).toBeGreaterThan(rt.stateAt(tEasy).scene.curves.fov + 10);
  });
  it('carries the workout\'s text events through', () => {
    const w = loadWorkoutDoc(workoutDoc('systems-check'));
    const rt = new ChapterRuntime(chapterFromWorkout('x', 'X', w), { ftp: 250 });
    expect(rt.stateAt(302).workout.texts.map((t) => t.message)).toEqual(['Hold on as long as you can. Stop when the cadence falls apart.']);
  });
});

describe('a chapter generated from a map', () => {
  it('is a valid free-ride chapter on the map\'s scene kit', () => {
    for (const id of ['meridian-approach', 'terror-flats', 'night-side']) {
      const map = mapDoc(id);
      const ch = chapterFromMap(map);
      expect(validate(ch), `${id} ${JSON.stringify(validate.errors?.slice(0, 3))}`).toBe(true);
      expect(checkChapter(ch, { workout: loadChapterWorkout(ch) })).toEqual([]);
      const rt = new ChapterRuntime(ch, { ftp: 250 });
      const s = rt.stateAt(600);
      expect(s.scene.id).toBe(map.scene.id);
      expect(s.workout.step.kind).toBe('free');
      expect(s.workout.targetWatts).toBeUndefined();
      expect(s.scene.env).toMatchObject(map.scene.env ?? {});
      expect(ch.duration).toBe(FREE_RIDE_LIMIT);
    }
  });
});

describe('free ride', () => {
  const flat = mapDoc('meridian-approach');
  const hilly = mapDoc('terror-flats');
  it('settles at the bike model\'s steady speed on the flat', () => {
    const r = new FreeRide(flat, 75);
    for (let i = 0; i < 600; i++) r.update(0.5, 200);
    expect(r.speed).toBeCloseTo(steadyBikeSpeed(200), 1);
    expect(r.grade).toBe(0);
    expect(r.distance).toBeGreaterThan(2500);
    expect(r.climbed).toBe(0);
  });
  it('slows on a climb, speeds up downhill, and counts the climbing', () => {
    const r = new FreeRide(hilly, 75);
    let onClimb = 0;
    let onDescent = 0;
    for (let i = 0; i < 20000 && !r.finished; i++) {
      r.update(0.5, 200);
      if (r.distance > 3300 && r.distance < 3700) onClimb = r.speed;
      if (r.distance > 4300 && r.distance < 4700) onDescent = r.speed;
    }
    expect(onClimb).toBeLessThan(steadyBikeSpeed(200) * 0.7);
    expect(onDescent).toBeGreaterThan(steadyBikeSpeed(200));
    expect(r.finished).toBe(true);
    expect(r.distance).toBeCloseTo(hilly.length, 6);
    expect(r.remaining).toBe(0);
    expect(r.climbed).toBeGreaterThan(150);
    const d = r.distance;
    r.update(1, 300);
    expect(r.distance).toBe(d);
  });
  it('scales the grade sent to the trainer by the difficulty setting', () => {
    const r = new FreeRide(hilly);
    r.distance = 3800;
    expect(r.grade).toBe(4.5);
    expect(r.trainerGrade(1)).toBe(4.5);
    expect(r.trainerGrade(0.5)).toBe(2.3);
    expect(r.trainerGrade(0)).toBe(0);
  });
  it('a heavier rider climbs more slowly', () => {
    const light = new FreeRide(hilly, 60);
    const heavy = new FreeRide(hilly, 95);
    light.distance = heavy.distance = 8200;
    for (let i = 0; i < 120; i++) { light.update(0.5, 220); heavy.update(0.5, 220); }
    expect(light.speed).toBeGreaterThan(heavy.speed * 1.2);
  });
  it('widens the view with speed and reports scenery scale', () => {
    const r = new FreeRide(flat);
    expect(r.fov()).toBe(70);
    r.speed = 14;
    expect(r.fov()).toBe(96);
    expect(r.sceneScale).toBe(40);
  });
});

describe('recorder with an outside road speed', () => {
  it('uses it for speed and distance instead of the flat-road model', () => {
    const rec = new RideRecorder(0);
    for (let t = 0.5; t <= 10; t += 0.5) rec.update(t, { power: 200, roadSpeed: 4 });
    const last = rec.samples[rec.samples.length - 1];
    expect(last.bikeSpeed).toBeCloseTo(4, 6);
    expect(last.distance).toBeCloseTo(4 * rec.samples.length, 6);
    const flatRec = new RideRecorder(0);
    for (let t = 0.5; t <= 10; t += 0.5) flatRec.update(t, { power: 200 });
    expect(flatRec.samples[flatRec.samples.length - 1].bikeSpeed).not.toBeCloseTo(4, 0);
  });
});
