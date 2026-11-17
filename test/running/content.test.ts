import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCatalogue, entriesOf, findEntry, loadWorkoutDoc, workoutStats, type ContentSources, type PlanDoc, type WorkoutDoc } from '../../src/core/content';
import type { Chapter } from '../../src/core/chapter';
import { defaultValues, rideConfig, SETTINGS } from '../../src/core/settings';
import { buildWorkout, paceToEffort, workoutKind, WorkoutRunner } from '../../src/core/workout';
import { loadContent } from '../../tools/content';

const report = loadContent('.');
const schema = (name: string) => new Ajv2020({ allErrors: true }).compile(JSON.parse(readFileSync(`schemas/${name}.schema.json`, 'utf8')));

describe('running content', () => {
  const c = report.catalogue;
  it('ships a running plan and running workouts', () => {
    const runs = entriesOf(c, 'workout').filter((w) => w.sport === 'run');
    expect(runs.map((w) => w.id).sort()).toEqual(['deck-run', 'heartline', 'long-haul-on-foot', 'relay-threshold']);
    expect(findEntry(c, 'plan', 'ground-crew')).toMatchObject({ sport: 'run', weeks: 4, level: 'beginner' });
  });
  it('scores running workouts by effort, so they compare with rides', () => {
    expect(findEntry(c, 'workout', 'relay-threshold')).toMatchObject({ hard: true });
    expect(findEntry(c, 'workout', 'deck-run')?.hard).toBe(false);
    const easy = findEntry(c, 'workout', 'deck-run')?.intensity as number;
    expect(easy).toBeGreaterThan(0.45);
    expect(easy).toBeLessThan(0.75);
    // The graph is in effort: a block at threshold pace draws at 1.0, as FTP does on a ride.
    expect(findEntry(c, 'workout', 'relay-threshold')?.graph?.some((b) => b[1] === 1)).toBe(true);
  });
  it('loads each running workout with the right kind of target', () => {
    const doc = (id: string) => JSON.parse(readFileSync(`content/workouts/${id}.workout.json`, 'utf8')) as WorkoutDoc;
    expect(workoutKind(loadWorkoutDoc(doc('deck-run')))).toBe('pace');
    expect(workoutKind(loadWorkoutDoc(doc('heartline')))).toBe('hr');
    const r = new WorkoutRunner(loadWorkoutDoc(doc('relay-threshold')), { ftp: 250, thresholdSpeed: 4 });
    expect(r.stateAt(800).targetSpeed).toBeCloseTo(4, 10);
  });
  it('the story week runs Chapter 1', () => {
    const p = JSON.parse(readFileSync('content/plans/ground-crew.plan.json', 'utf8')) as PlanDoc;
    expect(p.weeks[3].days.some((d) => d.sessions.some((s) => s.ref === 'chapter:ch1'))).toBe(true);
  });
});

describe('content rules for sports', () => {
  const chapter = JSON.parse(readFileSync('chapters/test-clamp.chapter.json', 'utf8')) as Chapter;
  const runW: WorkoutDoc = { format: 1, id: 'r', title: 'r', sport: 'run', focus: 'endurance', difficulty: 2, steps: [{ kind: 'steady', duration: 600, pace: 0.8 }] };
  const bikeW: WorkoutDoc = { format: 1, id: 'b', title: 'b', focus: 'endurance', difficulty: 2, steps: [{ kind: 'steady', duration: 600, power: 0.7 }] };
  const plan = (sport: 'bike' | 'run', refs: string[]): PlanDoc => ({
    format: 1, id: 'p', title: 'p', description: '', sport, level: 'beginner', goal: '', hoursPerWeek: [1, 2], style: 'calendar',
    weeks: [{ days: refs.map((ref, i) => ({ day: i + 1, sessions: [{ ref }] })) }],
  });
  const src = (p: PlanDoc): ContentSources => ({
    chapters: { 'c.chapter.json': chapter }, workouts: { 'r.workout.json': runW, 'b.workout.json': bikeW }, plans: { 'p.plan.json': p }, maps: {}, seasons: {},
  });
  it('lets a running plan include rides and chapters (they are run at the same effort)', () => {
    expect(buildCatalogue(src(plan('run', ['workout:r', 'workout:b', 'chapter:test-clamp']))).problems).toEqual([]);
  });
  it('stops a cycling plan from scheduling a running workout', () => {
    expect(buildCatalogue(src(plan('bike', ['workout:b', 'workout:r']))).problems).toEqual(['p.plan.json week 1 day 2: "r" is a running workout in a cycling plan']);
  });
  it('schemas accept pace and heart-rate targets', () => {
    expect(schema('workout')(runW)).toBe(true);
    expect(schema('workout')({ ...runW, steps: [{ kind: 'steady', duration: 60, secPerKm: 300 }, { kind: 'steady', duration: 60, bpm: 150 }, { kind: 'ramp', duration: 60, from: 0.6, to: 0.7, unit: 'hr' }] })).toBe(true);
    expect(schema('workout')({ ...runW, steps: [{ kind: 'ramp', duration: 60, from: 0.6, to: 0.7, unit: 'furlongs' }] })).toBe(false);
    expect(schema('workout')({ ...runW, steps: [{ kind: 'steady', duration: 60, hr: 3 }] })).toBe(false);
  });
});

describe('running settings', () => {
  it('has treadmill control, a top-speed limit and a usual sport', () => {
    const keys = SETTINGS.map((d) => d.key);
    expect(keys).toEqual(expect.arrayContaining(['sport', 'devices.treadmillControl', 'devices.treadmillMaxSpeed']));
    const cfg = rideConfig(defaultValues('profile'), defaultValues('settings'));
    expect(cfg).toMatchObject({ sport: 'bike', treadmillControl: true });
    expect(cfg.treadmillMaxSpeed * 3.6).toBeCloseTo(18, 6);
    expect(cfg.thresholdSpeed).toBeCloseTo(1000 / 300, 6);
  });
  it('turns a threshold pace into the speed the runner uses', () => {
    const cfg = rideConfig({ ...defaultValues('profile'), thresholdPace: 250 }, defaultValues('settings'));
    expect(cfg.thresholdSpeed).toBe(4);
    const r = new WorkoutRunner(buildWorkout({ name: 'x', sport: 'run', steps: [{ kind: 'steady', duration: 60, pace: 1 }] }), cfg);
    expect(r.stateAt(10).targetSpeed).toBe(4);
    expect(r.targetEffortAt(10)).toBeCloseTo(paceToEffort(1), 10);
  });
});

describe('workout stats for runs', () => {
  it('scores an hour at threshold pace like an hour at FTP', () => {
    const run = workoutStats(buildWorkout({ name: 'r', sport: 'run', steps: [{ kind: 'steady', duration: 3600, pace: 1 }] }));
    expect(run).toMatchObject({ intensity: 1, stress: 100, hard: true });
  });
});
