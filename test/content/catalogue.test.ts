import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildCatalogue, entriesOf, findEntry, findRef, gradeAt, loadWorkoutDoc, parseRef, workoutStats,
  type ContentSources, type MapDoc, type PlanDoc, type SeasonDoc, type WorkoutDoc,
} from '../../src/core/content';
import type { Chapter } from '../../src/core/chapter';
import { buildWorkout, totalDuration } from '../../src/core/workout';
import { countProblems, formatProblems, loadContent } from '../../tools/content';

const report = loadContent('.');
const schema = (name: string) => new Ajv2020({ allErrors: true }).compile(JSON.parse(readFileSync(`schemas/${name}.schema.json`, 'utf8')));

describe('shipped content', () => {
  it('validates with no problems', () => {
    expect(formatProblems(report)).toBe('');
    expect(countProblems(report)).toBe(0);
  });
  it('has the placeholder set the brief asks for', () => {
    const c = report.catalogue;
    expect(entriesOf(c, 'plan').length).toBeGreaterThanOrEqual(3);
    expect(entriesOf(c, 'workout').length).toBeGreaterThanOrEqual(12);
    expect(entriesOf(c, 'map').length).toBeGreaterThanOrEqual(3);
    expect(findEntry(c, 'season', 'season-1')?.chapters).toEqual(['ch1', 'test-clamp']);
    expect(entriesOf(c, 'plan').map((p) => p.style).sort()).toContain('story');
    expect(new Set(entriesOf(c, 'workout').map((w) => w.focus)).size).toBeGreaterThanOrEqual(8);
  });
  it('indexes summary fields for the menus', () => {
    const c = report.catalogue;
    expect(findEntry(c, 'chapter', 'ch1')).toMatchObject({ duration: 2100, season: 'season-1', unlock: { type: 'always' }, path: 'ch1.chapter.json' });
    expect(findEntry(c, 'chapter', 'test-clamp')?.unlock).toEqual({ type: 'chapterCompleted', chapter: 'ch1' });
    const w = findRef(c, 'workout:hold-the-line');
    expect(w).toMatchObject({ focus: 'threshold', hard: true, sport: 'bike', path: 'content/workouts/hold-the-line.workout.json' });
    expect(w?.graph?.reduce((a, b) => a + b[0], 0)).toBe(w?.duration);
    expect(findEntry(c, 'workout', 'storm-front')?.duration).toBe(3600);
    expect(findEntry(c, 'plan', 'base-builder')).toMatchObject({ weeks: 8, level: 'beginner', style: 'calendar' });
    expect(findEntry(c, 'map', 'terror-flats')?.climb).toBeGreaterThan(80);
    expect(findEntry(c, 'map', 'meridian-approach')?.climb).toBe(0);
  });
  it('is deterministic', () => {
    expect(JSON.stringify(loadContent('.').catalogue)).toBe(JSON.stringify(report.catalogue));
  });
});

const chapter = JSON.parse(readFileSync('chapters/test-clamp.chapter.json', 'utf8')) as Chapter;
const workout = (id: string, extra: Partial<WorkoutDoc> = {}): WorkoutDoc => ({
  format: 1, id, title: id, focus: 'endurance', difficulty: 2, steps: [{ kind: 'steady', duration: 600, power: 0.7 }], ...extra,
});
const plan = (id: string, refs: string[], extra: Partial<PlanDoc> = {}): PlanDoc => ({
  format: 1, id, title: id, description: '', sport: 'bike', level: 'beginner', goal: '', hoursPerWeek: [1, 2], style: 'calendar',
  weeks: [{ days: refs.map((ref, i) => ({ day: i + 1, sessions: [{ ref }] })) }], ...extra,
});
const sources = (over: Partial<ContentSources> = {}): ContentSources => ({
  chapters: { 'test-clamp.chapter.json': chapter },
  workouts: { 'content/workouts/a.workout.json': workout('a') },
  plans: { 'content/plans/p.plan.json': plan('p', ['workout:a', 'chapter:test-clamp']) },
  maps: {}, seasons: {}, ...over,
});

describe('catalogue build', () => {
  it('accepts consistent content', () => {
    const r = buildCatalogue(sources());
    expect(r.problems).toEqual([]);
    expect(r.catalogue.entries.map((e) => `${e.type}:${e.id}`)).toEqual(['chapter:test-clamp', 'workout:a', 'plan:p']);
  });
  it('a new plan or workout dropped in as a file appears without any code change', () => {
    const before = buildCatalogue(sources()).catalogue;
    const after = buildCatalogue(sources({
      workouts: { 'content/workouts/a.workout.json': workout('a'), 'content/workouts/new-one.workout.json': workout('new-one', { focus: 'vo2' }) },
      plans: { 'content/plans/p.plan.json': plan('p', ['workout:a']), 'content/plans/fresh.plan.json': plan('fresh', ['workout:new-one']) },
    }));
    expect(after.problems).toEqual([]);
    expect(findEntry(before, 'plan', 'fresh')).toBeUndefined();
    expect(findEntry(after.catalogue, 'plan', 'fresh')).toMatchObject({ sessions: 1, weeks: 1 });
    expect(findEntry(after.catalogue, 'workout', 'new-one')).toMatchObject({ focus: 'vo2', duration: 600 });
  });
  it('fails on a plan that points at a missing workout or chapter', () => {
    const r = buildCatalogue(sources({ plans: { 'content/plans/p.plan.json': plan('p', ['workout:nope', 'chapter:ch9', 'rubbish']) } }));
    expect(r.problems).toEqual([
      'content/plans/p.plan.json week 1 day 1: workout "nope" not found',
      'content/plans/p.plan.json week 1 day 2: chapter "ch9" not found',
      'content/plans/p.plan.json week 1 day 3: "rubbish" is not a valid reference (use workout:<id> or chapter:<id>)',
    ]);
  });
  it('checks alternatives too', () => {
    const p = plan('p', ['workout:a']);
    p.weeks[0].days[0].sessions[0].alternatives = ['workout:gone'];
    expect(buildCatalogue(sources({ plans: { 'x.plan.json': p } })).problems).toEqual(['x.plan.json week 1 day 1: workout "gone" not found']);
  });
  it('fails on duplicate ids, repeated days and empty days', () => {
    const p = plan('p', ['workout:a']);
    p.weeks[0].days.push({ day: 1, sessions: [] });
    const r = buildCatalogue(sources({
      workouts: { 'one.workout.json': workout('a'), 'two.workout.json': workout('a') },
      plans: { 'p.plan.json': p },
    }));
    expect(r.problems).toContain('two.workout.json: duplicate workout id "a"');
    expect(r.problems).toContain('p.plan.json week 1 day 1: listed twice');
    expect(r.problems).toContain('p.plan.json week 1 day 1: has no sessions (leave rest days out)');
  });
  it('fails on a season listing a missing chapter, and on unlock rules that point nowhere', () => {
    const season: SeasonDoc = { format: 1, id: 's', title: 'S', description: '', chapters: [{ id: 'test-clamp' }, { id: 'ch404' }] };
    const map: MapDoc = {
      format: 1, id: 'm', title: 'M', description: '', use: ['freeRide'], length: 1000, profile: [[0, 0], [500, 30], [400, 0]], scene: { id: 'space' },
      image: 'nope.jpg', unlock: { type: 'all', rules: [{ type: 'chapterCompleted', chapter: 'zzz' }, { type: 'planWeek', week: 2, plan: 'no-plan' }] },
    };
    const r = buildCatalogue(sources({ seasons: { 's.season.json': season }, maps: { 'm.map.json': map }, images: ['real.jpg'] }));
    expect(r.problems).toEqual([
      's.season.json: chapter "ch404" not found',
      'm.map.json: grade 30% is beyond what a trainer can simulate',
      'm.map.json: profile keys out of order at 400 m',
      'm.map.json: image "nope.jpg" not found',
      'm.map.json: unlock.all[0] refers to missing chapter "zzz"',
      'm.map.json: unlock.all[1] refers to missing plan "no-plan"',
    ]);
  });
  it('gives chapters their season and a default unlock chain', () => {
    const ch2 = { ...chapter, id: 'second' };
    const season: SeasonDoc = { format: 1, id: 's', title: 'S', description: '', chapters: [{ id: 'test-clamp' }, { id: 'second' }] };
    const c = buildCatalogue(sources({ chapters: { 'a.chapter.json': chapter, 'b.chapter.json': ch2 }, seasons: { 's.season.json': season } })).catalogue;
    expect(findEntry(c, 'chapter', 'test-clamp')).toMatchObject({ season: 's', unlock: { type: 'always' } });
    expect(findEntry(c, 'chapter', 'second')?.unlock).toEqual({ type: 'chapterCompleted', chapter: 'test-clamp' });
  });
  it('reports a workout with neither steps nor file, or with a missing file', () => {
    const r = buildCatalogue(sources({
      workouts: { 'a.workout.json': workout('a', { steps: undefined }), 'b.workout.json': workout('b', { steps: undefined, file: 'gone.zwo' }) },
      plans: {}, readFile: () => { throw new Error('ENOENT gone.zwo'); },
    }));
    expect(r.problems).toEqual(['a.workout.json: Workout "a" has neither steps nor a file', 'b.workout.json: ENOENT gone.zwo']);
  });
});

describe('workout documents and stats', () => {
  it('loads inline steps and files', () => {
    expect(totalDuration(loadWorkoutDoc(workout('a')))).toBe(600);
    const zwo = '<workout_file><name>Z</name><workout><SteadyState Duration="300" Power="0.8"/></workout></workout_file>';
    const w = loadWorkoutDoc(workout('z', { steps: undefined, file: 'z.zwo', title: 'From a file' }), () => zwo);
    expect(w.name).toBe('From a file');
    expect(totalDuration(w)).toBe(300);
  });
  it('estimates intensity and stress from the targets', () => {
    const hour = workoutStats(buildWorkout({ name: 'ftp', steps: [{ kind: 'steady', duration: 3600, power: 1 }] }));
    expect(hour).toMatchObject({ duration: 3600, intensity: 1, stress: 100, hard: true });
    const easy = workoutStats(buildWorkout({ name: 'e', steps: [{ kind: 'steady', duration: 1800, power: 0.6 }] }));
    expect(easy).toMatchObject({ intensity: 0.6, stress: 18, hard: false });
    const watts = workoutStats(buildWorkout({ name: 'w', steps: [{ kind: 'steady', duration: 600, watts: 200 }] }), 250);
    expect(watts.intensity).toBe(0.8);
    const ramp = workoutStats(buildWorkout({ name: 'r', steps: [{ kind: 'ramp', duration: 600, from: 0.5, to: 1 }, { kind: 'free', duration: 60 }] }));
    expect(ramp.graph).toEqual([[600, 0.5, 1], [60, 0, 0]]);
    expect(ramp.intensity).toBeGreaterThan(0.75);
  });
  it('interpolates grade along a profile', () => {
    const p: [number, number][] = [[0, 0], [1000, 4], [2000, -2]];
    expect(gradeAt(p, -5)).toBe(0);
    expect(gradeAt(p, 500)).toBe(2);
    expect(gradeAt(p, 1500)).toBe(1);
    expect(gradeAt(p, 9999)).toBe(-2);
    expect(gradeAt([], 10)).toBe(0);
  });
  it('parses references', () => {
    expect(parseRef('workout:long-haul')).toEqual({ type: 'workout', id: 'long-haul' });
    expect(parseRef('chapter:ch1')).toEqual({ type: 'chapter', id: 'ch1' });
    expect(parseRef('map:x')).toBeUndefined();
  });
});

describe('schemas', () => {
  it('reject malformed documents', () => {
    expect(schema('workout')({ format: 1, id: 'Bad Id', title: 'x', focus: 'endurance', difficulty: 2 })).toBe(false);
    expect(schema('workout')({ format: 1, id: 'ok', title: 'x', focus: 'fun', difficulty: 2 })).toBe(false);
    expect(schema('workout')(workout('ok'))).toBe(true);
    expect(schema('plan')(plan('ok', ['workout:a']))).toBe(true);
    expect(schema('plan')(plan('ok', ['nope']))).toBe(false);
    expect(schema('plan')({ ...plan('ok', ['workout:a']), weeks: [] })).toBe(false);
    expect(schema('map')({ format: 1, id: 'm', title: 'M', description: '', use: ['freeRide'], length: 0, profile: [[0, 0]], scene: { id: 'ice' } })).toBe(false);
    expect(schema('season')({ format: 1, id: 's', title: 'S', description: '', chapters: [] })).toBe(false);
    expect(schema('season')({ format: 1, id: 's', title: 'S', description: '', chapters: [{ id: 'a', unlock: { type: 'sometimes' } }] })).toBe(false);
    expect(schema('season')({ format: 1, id: 's', title: 'S', description: '', chapters: [{ id: 'a', unlock: { type: 'any', rules: [{ type: 'totalTime', hours: 2 }] } }] })).toBe(true);
  });
});
