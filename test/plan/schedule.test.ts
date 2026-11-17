import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PlanDoc } from '../../src/core/content';
import {
  currentWeek, endDate, handleMissed, matchRide, newPlanState, pausePlan, planSlots, planView, resumePlan, schedule, skipSession, swapSession,
  weekSpan, type ScheduledSession,
} from '../../src/core/plan';
import type { PlanState } from '../../src/core/player';
import { weekday } from '../../src/core/util/date';

const day = (d: number, ...refs: string[]) => ({ day: d, sessions: refs.map((r) => (r.endsWith('?') ? { ref: r.slice(0, -1), optional: true } : { ref: r })) });
const plan: PlanDoc = {
  format: 1, id: 'p', title: 'P', description: '', sport: 'bike', level: 'beginner', goal: '', hoursPerWeek: [3, 4], style: 'calendar',
  weeks: [
    { days: [day(1, 'workout:easy'), day(3, 'workout:hard'), day(5, 'workout:spin?'), day(6, 'workout:long')] },
    { days: [day(1, 'workout:hard'), day(3, 'workout:easy'), day(4, 'workout:hard2'), day(6, 'workout:long')] },
  ],
};
plan.weeks[0].days[1].sessions[0].alternatives = ['workout:easy'];
const hardOf = (ref: string) => ref.startsWith('workout:hard');
const START = '2026-11-16'; // a Monday
const st = (extra: Partial<PlanState> = {}): PlanState => ({ ...newPlanState(plan, START), ...extra });
const dates = (s: ScheduledSession[]) => s.map((x) => `${x.key}@${x.date.slice(5)}:${x.status}`);

describe('schedule', () => {
  it('gives every session a stable key and a date from the start date', () => {
    expect(planSlots(plan).map((s) => s.key)).toEqual(['w1d1s0', 'w1d3s0', 'w1d5s0', 'w1d6s0', 'w2d1s0', 'w2d3s0', 'w2d4s0', 'w2d6s0']);
    expect(dates(schedule(plan, st(), '2026-11-18', hardOf))).toEqual([
      'w1d1s0@11-16:missed', 'w1d3s0@11-18:today', 'w1d5s0@11-20:upcoming', 'w1d6s0@11-21:upcoming',
      'w2d1s0@11-23:upcoming', 'w2d3s0@11-25:upcoming', 'w2d4s0@11-26:upcoming', 'w2d6s0@11-28:upcoming',
    ]);
  });
  it('starts on whatever day the player starts, not on Mondays', () => {
    const s = schedule(plan, newPlanState(plan, '2026-11-19'), '2026-11-19');
    expect(s[0].date).toBe('2026-11-19');
    expect(s[1].date).toBe('2026-11-21');
    expect(endDate(plan, newPlanState(plan, '2026-11-19'))).toBe('2026-12-02');
  });
  it('puts sessions on the player\'s chosen training days, in order', () => {
    const s = schedule(plan, newPlanState(plan, START, [2, 4, 6, 7]), START); // Tue Thu Sat Sun
    expect(s.filter((x) => x.week === 1).map((x) => weekday(x.date))).toEqual([2, 4, 6, 7]);
    expect(s.filter((x) => x.week === 2).map((x) => weekday(x.date))).toEqual([2, 4, 6, 7]);
    expect(s[0].date).toBe('2026-11-17');
  });
  it('wraps chosen days around a mid-week start', () => {
    const s = schedule(plan, newPlanState(plan, '2026-11-19', [1, 3, 5, 6]), '2026-11-19'); // start Thursday
    // Offsets from Thursday: Fri +1, Sat +2, Mon +4, Wed +6.
    expect(s.filter((x) => x.week === 1).map((x) => x.date)).toEqual(['2026-11-20', '2026-11-21', '2026-11-23', '2026-11-25']);
  });
  it('keeps the plan\'s own days when too few training days were chosen', () => {
    const s = schedule(plan, newPlanState(plan, START, [3, 6]), START);
    expect(s.filter((x) => x.week === 1).map((x) => x.date)).toEqual(['2026-11-16', '2026-11-18', '2026-11-20', '2026-11-21']);
  });
  it('marks hard sessions, optional ones and swaps', () => {
    const state = swapSession(plan, st(), 'w1d3s0', 'workout:easy');
    const s = schedule(plan, state, START, hardOf);
    expect(s.find((x) => x.key === 'w1d3s0')).toMatchObject({ ref: 'workout:easy', hard: false });
    expect(schedule(plan, st(), START, hardOf).find((x) => x.key === 'w1d3s0')).toMatchObject({ ref: 'workout:hard', hard: true });
    expect(s.find((x) => x.key === 'w1d5s0')?.optional).toBe(true);
    expect(() => swapSession(plan, st(), 'w1d3s0', 'workout:long')).toThrow('not an alternative');
    expect(swapSession(plan, state, 'w1d3s0', undefined).swaps).toEqual({});
  });
  it('uses the completion date for done sessions', () => {
    const s = schedule(plan, st({ completed: { w1d3s0: { ride: 'r', date: '2026-11-17' } } }), '2026-11-19', hardOf);
    expect(s.find((x) => x.key === 'w1d3s0')).toMatchObject({ status: 'done', date: '2026-11-17', plannedDate: '2026-11-18' });
  });
});

describe('plan view', () => {
  it('reports today, this week, next and progress', () => {
    const v = planView(plan, st({ completed: { w1d1s0: { ride: 'r', date: START } } }), '2026-11-18', hardOf);
    expect(v.week).toBe(1);
    expect(v.today.map((s) => s.key)).toEqual(['w1d3s0']);
    expect(v.thisWeek).toHaveLength(4);
    expect(v.next?.key).toBe('w1d3s0');
    expect(v).toMatchObject({ done: 1, total: 8, finished: false, over: false });
  });
  it('knows the week and when the plan is over', () => {
    expect(currentWeek(plan, st(), '2026-11-15')).toBe(0);
    expect(currentWeek(plan, st(), '2026-11-22')).toBe(1);
    expect(currentWeek(plan, st(), '2026-11-23')).toBe(2);
    expect(currentWeek(plan, st(), '2027-01-01')).toBe(2);
    expect(weekSpan(st(), 2)).toEqual({ from: '2026-11-23', to: '2026-11-29' });
    expect(planView(plan, st(), '2026-11-30').over).toBe(true);
  });
  it('is finished when every required session is done or dropped', () => {
    const completed: PlanState['completed'] = {};
    for (const s of planSlots(plan)) if (!s.session.optional) completed[s.key] = { ride: 'r', date: START };
    expect(planView(plan, st({ completed }), '2026-11-20').finished).toBe(true);
    delete completed.w2d6s0;
    expect(planView(plan, st({ completed }), '2026-11-20').finished).toBe(false);
    expect(planView(plan, skipSession(st({ completed }), 'w2d6s0', '2026-11-29'), '2026-11-29').finished).toBe(true);
  });
});

describe('missed sessions', () => {
  it('skip policy drops them', () => {
    const r = handleMissed(plan, st(), '2026-11-19', 'skip', hardOf);
    expect(r.changes).toEqual([{ key: 'w1d1s0', action: 'skipped', from: '2026-11-16' }, { key: 'w1d3s0', action: 'skipped', from: '2026-11-18' }]);
    expect(planView(plan, r.state, '2026-11-19', hardOf).missed).toEqual([]);
  });
  it('push policy moves a missed session to the next free day in its week', () => {
    const r = handleMissed(plan, st(), '2026-11-17', 'push', hardOf);
    expect(r.changes).toEqual([{ key: 'w1d1s0', action: 'moved', from: '2026-11-16', to: '2026-11-17' }]);
    const s = schedule(plan, r.state, '2026-11-17', hardOf).find((x) => x.key === 'w1d1s0');
    expect(s).toMatchObject({ date: '2026-11-17', status: 'today', moved: true, plannedDate: '2026-11-16' });
  });
  it('never puts two hard days back to back', () => {
    // Week 2: hard Mon 23, easy Wed 25, hard2 Thu 26, long Sat 28. Miss Monday's hard session.
    const done = { w1d1s0: 1, w1d3s0: 1, w1d5s0: 1, w1d6s0: 1 };
    const completed = Object.fromEntries(Object.keys(done).map((k) => [k, { ride: 'r', date: START }]));
    const r = handleMissed(plan, st({ completed }), '2026-11-24', 'push', hardOf);
    // Tue 24 is free and not next to a hard day (Wed is easy), so it goes there.
    expect(r.changes).toEqual([{ key: 'w2d1s0', action: 'moved', from: '2026-11-23', to: '2026-11-24' }]);
    // A day later, Wed 25 is taken, Thu 26 is taken, Fri 27 is next to Thursday's hard session, Sat 28 taken, Sun 29 is clear.
    const r2 = handleMissed(plan, st({ completed }), '2026-11-25', 'push', hardOf);
    expect(r2.changes).toEqual([{ key: 'w2d1s0', action: 'moved', from: '2026-11-23', to: '2026-11-29' }]);
  });
  it('drops a hard session rather than stack it, when the week has no clear day left', () => {
    const p2: PlanDoc = { ...plan, weeks: [{ days: [day(1, 'workout:hard'), day(5, 'workout:hard2'), day(7, 'workout:hard3')] }] };
    const r = handleMissed(p2, newPlanState(p2, START), '2026-11-19', 'push', hardOf);
    // Thu 19 and Sat 21 are both beside a hard day; Fri and Sun are taken.
    expect(r.changes).toEqual([{ key: 'w1d1s0', action: 'skipped', from: '2026-11-16' }]);
  });
  it('an easy session can go beside a hard one', () => {
    const p2: PlanDoc = { ...plan, weeks: [{ days: [day(1, 'workout:easy'), day(3, 'workout:hard')] }] };
    const r = handleMissed(p2, newPlanState(p2, START), '2026-11-17', 'push', hardOf);
    expect(r.changes[0]).toMatchObject({ action: 'moved', to: '2026-11-17' });
  });
  it('never carries a session into the next week, and always drops optional ones', () => {
    const r = handleMissed(plan, st(), '2026-11-23', 'push', hardOf);
    expect(r.changes.map((c) => `${c.key}:${c.action}`)).toEqual(['w1d1s0:skipped', 'w1d3s0:skipped', 'w1d5s0:skipped', 'w1d6s0:skipped']);
    const r2 = handleMissed(plan, st(), '2026-11-21', 'push', hardOf);
    expect(r2.changes.find((c) => c.key === 'w1d5s0')?.action).toBe('skipped');
  });
  it('two missed sessions do not land on the same day', () => {
    const r = handleMissed(plan, st(), '2026-11-19', 'push', hardOf);
    // Easy goes to Thu 19. Hard cannot go to Thu (now taken), Fri 20 (optional spin) or Sat 21 (long),
    // and Sun 22 is the day before next Monday's hard session, so it is dropped.
    expect(r.changes).toEqual([
      { key: 'w1d1s0', action: 'moved', from: '2026-11-16', to: '2026-11-19' },
      { key: 'w1d3s0', action: 'skipped', from: '2026-11-18' },
    ]);
    // With Monday's session swapped for nothing hard, Sunday is clear.
    const easyMonday: PlanDoc = { ...plan, weeks: [plan.weeks[0], { days: [day(1, 'workout:easy')] }] };
    expect(handleMissed(easyMonday, newPlanState(easyMonday, START), '2026-11-19', 'push', hardOf).changes[1]).toEqual({ key: 'w1d3s0', action: 'moved', from: '2026-11-18', to: '2026-11-22' });
  });
  it('does not modify its input and is idempotent', () => {
    const s0 = st();
    const r = handleMissed(plan, s0, '2026-11-19', 'push', hardOf);
    expect(s0.moved).toEqual({});
    expect(handleMissed(plan, r.state, '2026-11-19', 'push', hardOf).changes).toEqual([]);
  });
});

describe('pausing', () => {
  it('freezes the plan and shifts what is left on resume', () => {
    const completed = { w1d1s0: { ride: 'r', date: START } };
    const paused = pausePlan(st({ completed }), '2026-11-17');
    const during = schedule(plan, paused, '2026-11-27', hardOf);
    expect(during.find((s) => s.key === 'w1d3s0')).toMatchObject({ status: 'upcoming', date: '2026-11-28' });
    expect(planView(plan, paused, '2026-11-27').today).toEqual([]);
    expect(handleMissed(plan, paused, '2026-11-27', 'push').changes).toEqual([]);
    const resumed = resumePlan(paused, '2026-11-27');
    expect(resumed.pausedOn).toBeUndefined();
    expect(resumed.startDate).toBe('2026-11-26');
    const after = schedule(plan, resumed, '2026-11-27', hardOf);
    expect(after.find((s) => s.key === 'w1d1s0')).toMatchObject({ status: 'done', date: START });
    expect(after.find((s) => s.key === 'w1d3s0')).toMatchObject({ status: 'upcoming', date: '2026-11-28' });
    expect(resumePlan(resumed, '2026-12-25')).toBe(resumed);
  });
});

describe('matching a ride to the plan', () => {
  const planned = (ref: string) => ({ 'workout:easy': { duration: 2700, intensity: 0.65 }, 'workout:hard': { duration: 3000, intensity: 0.88 }, 'workout:long': { duration: 3600, intensity: 0.68 }, 'workout:spin': { duration: 1800, intensity: 0.53 } }[ref]);
  const ride = (extra: object) => ({ kind: 'workout' as const, ref: 'workout:other', duration: 3000, intensity: 0.88, complete: true, ...extra });
  const on = (today: string, state = st()) => schedule(plan, state, today, hardOf);

  it('matches today\'s session by reference', () => {
    expect(matchRide(on('2026-11-18'), '2026-11-18', ride({ ref: 'workout:hard' }), planned, 1)?.key).toBe('w1d3s0');
  });
  it('does not count an abandoned ride, but does count one ridden 90% of the way', () => {
    expect(matchRide(on('2026-11-18'), '2026-11-18', ride({ ref: 'workout:hard', complete: false, duration: 1200 }), planned, 1)).toBeUndefined();
    expect(matchRide(on('2026-11-18'), '2026-11-18', ride({ ref: 'workout:hard', complete: false, duration: 2750 }), planned, 1)?.key).toBe('w1d3s0');
  });
  it('counts a different ride of similar length and intensity for today\'s session', () => {
    expect(matchRide(on('2026-11-18'), '2026-11-18', ride({ duration: 3200, intensity: 0.84 }), planned, 1)?.key).toBe('w1d3s0');
    expect(matchRide(on('2026-11-18'), '2026-11-18', ride({ duration: 3200, intensity: 0.7 }), planned, 1)).toBeUndefined();
    expect(matchRide(on('2026-11-18'), '2026-11-18', ride({ duration: 1500, intensity: 0.88 }), planned, 1)).toBeUndefined();
  });
  it('free rides never count', () => {
    expect(matchRide(on('2026-11-18'), '2026-11-18', ride({ kind: 'freeRide', ref: 'map:x' }), planned, 1)).toBeUndefined();
  });
  it('counts this week\'s session ridden early, and a missed one ridden late, by reference only', () => {
    expect(matchRide(on('2026-11-19'), '2026-11-19', ride({ ref: 'workout:long', duration: 3600, intensity: 0.68 }), planned, 1)?.key).toBe('w1d6s0');
    expect(matchRide(on('2026-11-17'), '2026-11-17', ride({ ref: 'workout:easy', duration: 2700, intensity: 0.65 }), planned, 1)?.key).toBe('w1d1s0');
    // A look-alike of a session that is not today's does not count.
    expect(matchRide(on('2026-11-19'), '2026-11-19', ride({ duration: 3600, intensity: 0.68 }), planned, 1)).toBeUndefined();
    // Next week's session is too far ahead.
    expect(matchRide(on('2026-11-16'), '2026-11-16', ride({ ref: 'workout:hard2' }), planned, 1)).toBeUndefined();
  });
  it('does not match sessions already done or skipped', () => {
    const state = st({ completed: { w1d3s0: { ride: 'r', date: '2026-11-18' } } });
    expect(matchRide(on('2026-11-18', state), '2026-11-18', ride({ ref: 'workout:hard' }), planned, 1)).toBeUndefined();
  });
});

describe('shipped plans', () => {
  it('schedule without two hard days back to back', async () => {
    const { loadContent } = await import('../../tools/content');
    const { hardFromCatalogue } = await import('../../src/core/progress');
    const cat = loadContent('.').catalogue;
    for (const e of cat.entries.filter((x) => x.type === 'plan')) {
      const doc = JSON.parse(readFileSync(e.path, 'utf8')) as PlanDoc;
      const s = schedule(doc, newPlanState(doc, START), START, hardFromCatalogue(cat));
      expect(s.length).toBe(e.sessions);
      const hardDays = new Set(s.filter((x) => x.hard).map((x) => x.date));
      for (const x of s) if (x.hard) expect(hardDays.has(new Date(Date.parse(x.date) + 86400000).toISOString().slice(0, 10)), `${e.id} ${x.key}`).toBe(false);
    }
  });
});
