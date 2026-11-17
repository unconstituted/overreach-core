import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findEntry, type PlanDoc, type UnlockRule } from '../../src/core/content';
import { newPlanState, pausePlan } from '../../src/core/plan';
import { emptyProgress, newPlayer, type PlayerData, type RideRecord } from '../../src/core/player';
import {
  applyRide, describeUnlock, evaluateUnlock, isUnlocked, leavePlan, startPlan, syncUnlocks, unlockContext,
} from '../../src/core/progress';
import { loadContent } from '../../tools/content';

const cat = loadContent('.').catalogue;
const planDoc = (id: string) => JSON.parse(readFileSync(`content/plans/${id}.plan.json`, 'utf8')) as PlanDoc;
const shakedown = planDoc('shakedown-week');
const START = '2026-11-16';
const ride = (id: string, extra: Partial<RideRecord> = {}): RideRecord => ({
  id, date: '2026-11-16T18:00', sport: 'bike', kind: 'workout', ref: 'workout:dock-spin', title: 'Dock Spin', complete: true, ftp: 250,
  duration: 1800, distance: 12000, kilojoules: 240, avgPower: 133, normalisedPower: 135, intensity: 0.53, stress: 14, hasFit: true, ...extra,
});
const withPlan = (): PlayerData => {
  const d = newPlayer();
  d.progress = startPlan(d.progress, newPlanState(shakedown, START), START);
  return d;
};

describe('unlock rules', () => {
  const p = emptyProgress();
  const ctx = (over: Partial<typeof p> = {}, planWeek?: { plan: string; week: number }) => ({ progress: { ...p, ...over }, planWeek });
  it('evaluates each rule type', () => {
    expect(evaluateUnlock(undefined, ctx())).toBe(true);
    expect(evaluateUnlock({ type: 'always' }, ctx())).toBe(true);
    const ch: UnlockRule = { type: 'chapterCompleted', chapter: 'ch1' };
    expect(evaluateUnlock(ch, ctx())).toBe(false);
    expect(evaluateUnlock(ch, ctx({ chapters: { ch1: { completedOn: START, count: 1 } } }))).toBe(true);
    const flag: UnlockRule = { type: 'flag', season: 'season-1', flag: 'clampLocked' };
    expect(evaluateUnlock(flag, ctx())).toBe(false);
    expect(evaluateUnlock(flag, ctx({ flags: { 'season-1': { clampLocked: true } } }))).toBe(true);
    expect(evaluateUnlock({ ...flag, value: false }, ctx())).toBe(true);
    expect(evaluateUnlock({ type: 'totalDistance', km: 50 }, ctx({ totals: { rides: 3, time: 0, distance: 49999, kilojoules: 0 } }))).toBe(false);
    expect(evaluateUnlock({ type: 'totalDistance', km: 50 }, ctx({ totals: { rides: 3, time: 0, distance: 50000, kilojoules: 0 } }))).toBe(true);
    expect(evaluateUnlock({ type: 'totalTime', hours: 2 }, ctx({ totals: { rides: 3, time: 7200, distance: 0, kilojoules: 0 } }))).toBe(true);
    expect(evaluateUnlock({ type: 'planWeek', week: 3 }, ctx({}, { plan: 'x', week: 2 }))).toBe(false);
    expect(evaluateUnlock({ type: 'planWeek', week: 3 }, ctx({}, { plan: 'x', week: 3 }))).toBe(true);
    expect(evaluateUnlock({ type: 'planWeek', week: 3, plan: 'y' }, ctx({}, { plan: 'x', week: 5 }))).toBe(false);
    expect(evaluateUnlock({ type: 'planWeek', week: 3, plan: 'y' }, ctx({ pastPlans: [{ plan: 'y', startDate: START, endedOn: START, completed: 9, finished: true }] }))).toBe(true);
    expect(evaluateUnlock({ type: 'all', rules: [{ type: 'always' }, ch] }, ctx())).toBe(false);
    expect(evaluateUnlock({ type: 'any', rules: [{ type: 'always' }, ch] }, ctx())).toBe(true);
  });
  it('describes rules for the player', () => {
    expect(describeUnlock({ type: 'chapterCompleted', chapter: 'ch1' }, cat)).toBe('Complete The Disaster');
    expect(describeUnlock({ type: 'totalDistance', km: 50 }, cat)).toBe('Ride 50 km in total');
    expect(describeUnlock({ type: 'planWeek', week: 2, plan: 'base-builder' }, cat)).toBe('Reach week 2 of Base Builder');
    expect(describeUnlock({ type: 'all', rules: [{ type: 'totalTime', hours: 1 }, { type: 'totalDistance', km: 5 }] }, cat)).toBe('Ride 1 hour in total, and Ride 5 km in total');
    expect(describeUnlock({ type: 'always' }, cat)).toBe('');
  });
  it('unlocks stick once earned, and are reported once', () => {
    const map = findEntry(cat, 'map', 'terror-flats')!;
    expect(isUnlocked(map, ctx())).toBe(false);
    const done = ctx({ chapters: { ch1: { completedOn: START, count: 1 } } });
    const first = syncUnlocks(cat, done, START);
    expect(first.unlocked.map((e) => `${e.type}:${e.id}`).sort()).toEqual(['chapter:test-clamp', 'map:terror-flats']);
    expect(first.progress.unlocked['map:terror-flats']).toBe(START);
    expect(syncUnlocks(cat, { progress: first.progress }, '2026-11-20').unlocked).toEqual([]);
    // Even if the condition stopped holding, it stays unlocked.
    expect(isUnlocked(map, { progress: { ...first.progress, chapters: {} } })).toBe(true);
    expect(isUnlocked(findEntry(cat, 'map', 'meridian-approach')!, ctx())).toBe(true);
  });
});

describe('applying a ride', () => {
  it('adds history and totals, and keeps the FTP the ride used', () => {
    const d0 = newPlayer();
    const { data, outcome } = applyRide(d0, cat, ride('r1', { ftp: 240 }), START);
    expect(data.history.map((r) => r.id)).toEqual(['r1']);
    expect(data.progress.totals).toEqual({ rides: 1, time: 1800, distance: 12000, kilojoules: 240 });
    expect(outcome).toMatchObject({ firstCompletion: false, unlocked: [] });
    expect(outcome.plan).toBeUndefined();
    expect(d0.history).toEqual([]);
    const changed = { ...data, profile: { ...data.profile, ftp: 300 } };
    expect(applyRide(changed, cat, ride('r2', { ftp: 300 }), START).data.history.map((r) => r.ftp)).toEqual([300, 240]);
  });
  it('completes today\'s plan session and advances the plan', () => {
    const { data, outcome } = applyRide(withPlan(), cat, ride('r1'), START, { plan: shakedown });
    expect(outcome.session).toMatchObject({ key: 'w1d1s0', status: 'done' });
    expect(outcome.plan).toMatchObject({ id: 'shakedown-week', doneBefore: 0, done: 1, total: 3, finished: false });
    expect(data.progress.activePlan?.completed.w1d1s0).toEqual({ ride: 'r1', date: START });
    expect(data.history[0].session).toEqual({ plan: 'shakedown-week', key: 'w1d1s0' });
  });
  it('a free ride does not count for the plan', () => {
    const { data, outcome } = applyRide(withPlan(), cat, ride('r1', { kind: 'freeRide', ref: 'map:meridian-approach' }), START, { plan: shakedown });
    expect(outcome.session).toBeUndefined();
    expect(outcome.plan).toMatchObject({ doneBefore: 0, done: 0 });
    expect(data.progress.activePlan?.completed).toEqual({});
  });
  it('a paused plan is left alone', () => {
    const d = withPlan();
    d.progress.activePlan = pausePlan(d.progress.activePlan!, START);
    const { outcome } = applyRide(d, cat, ride('r1'), START, { plan: shakedown });
    expect(outcome.plan).toBeUndefined();
  });
  it('completing a chapter records it, carries its flags and unlocks what depends on it', () => {
    const r = ride('c1', { kind: 'chapter', ref: 'chapter:ch1', title: 'The Disaster', duration: 2100, intensity: 0.76 });
    const { data, outcome } = applyRide(newPlayer(), cat, r, START, { flags: { sawTheGate: true } });
    expect(outcome.firstCompletion).toBe(true);
    expect(data.progress.chapters.ch1).toEqual({ completedOn: START, count: 1 });
    expect(data.progress.flags['season-1']).toEqual({ sawTheGate: true });
    expect(outcome.unlocked.map((e) => e.id).sort()).toEqual(['terror-flats', 'test-clamp']);
    const again = applyRide(data, cat, { ...r, id: 'c2' }, '2026-11-20', { flags: { clampLocked: false } });
    expect(again.outcome.firstCompletion).toBe(false);
    expect(again.outcome.unlocked).toEqual([]);
    expect(again.data.progress.chapters.ch1).toEqual({ completedOn: START, count: 2 });
    expect(again.data.progress.flags['season-1']).toEqual({ sawTheGate: true, clampLocked: false });
  });
  it('an unfinished chapter is history but not a completion', () => {
    const r = ride('c1', { kind: 'chapter', ref: 'chapter:ch1', complete: false, duration: 600 });
    const { data, outcome } = applyRide(newPlayer(), cat, r, START);
    expect(data.progress.chapters).toEqual({});
    expect(outcome.unlocked).toEqual([]);
    expect(data.history).toHaveLength(1);
  });
  it('distance unlocks arrive on the ride that crosses the line', () => {
    let d = newPlayer();
    d = applyRide(d, cat, ride('a', { distance: 30000 }), START).data;
    const second = applyRide(d, cat, ride('b', { distance: 21000 }), START);
    expect(second.outcome.unlocked.map((e) => e.id)).toEqual(['night-side']);
  });
  it('finishing the last session files the plan under past plans', () => {
    let d = withPlan();
    d = applyRide(d, cat, ride('r1'), START, { plan: shakedown }).data;
    d = applyRide(d, cat, ride('r2', { ref: 'workout:long-haul', duration: 2700, intensity: 0.66 }), '2026-11-18', { plan: shakedown }).data;
    const last = applyRide(d, cat, ride('r3', { kind: 'chapter', ref: 'chapter:ch1', duration: 2100, intensity: 0.76 }), '2026-11-21', { plan: shakedown });
    expect(last.outcome.plan).toMatchObject({ done: 3, total: 3, finished: true });
    expect(last.data.progress.activePlan).toBeUndefined();
    expect(last.data.progress.pastPlans).toEqual([{ plan: 'shakedown-week', startDate: START, endedOn: '2026-11-21', completed: 3, finished: true }]);
  });
});

describe('starting and leaving plans', () => {
  it('starting a new plan files the current one', () => {
    const d = withPlan();
    const p = startPlan(d.progress, newPlanState(planDoc('base-builder'), '2026-11-20'), '2026-11-20');
    expect(p.activePlan?.plan).toBe('base-builder');
    expect(p.pastPlans).toEqual([{ plan: 'shakedown-week', startDate: START, endedOn: '2026-11-20', completed: 0, finished: false }]);
    expect(leavePlan(emptyProgress(), START).pastPlans).toEqual([]);
  });
  it('the unlock context carries the active plan week', () => {
    const d = withPlan();
    expect(unlockContext(d.progress, shakedown, '2026-11-18').planWeek).toEqual({ plan: 'shakedown-week', week: 1 });
    expect(unlockContext(d.progress, undefined, START).planWeek).toBeUndefined();
  });
});
