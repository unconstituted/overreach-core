import type { PlanDoc, PlanSession, SessionRef } from '../content';
import type { PlanState, RideRecord } from '../player';
import { addDays, dayNumber, daysBetween, weekday, type IsoDate } from '../util/date';

/**
 * Plan scheduling: turning "week 3, day 2" into a date, and deciding what
 * happens when life gets in the way. Pure: today's date is always passed in.
 *
 * The rules, in full:
 *  - Day 1 of week 1 is the plan's start date. Each plan week is seven days.
 *  - If the player picked training days, each week's sessions go on those
 *    weekdays in order. If they picked fewer days than a week needs, that
 *    week keeps the plan's own days.
 *  - A session not done by the end of its day is "missed".
 *  - Missed optional sessions are always dropped.
 *  - Policy "skip": missed sessions are dropped.
 *  - Policy "push": a missed session moves to the first day from today to the
 *    end of its plan week that has nothing else on it and, if the session is
 *    a hard one, has no hard session the day before or after. If there is no
 *    such day, it is dropped. Sessions never move into another week, so a bad
 *    week cannot snowball into the rest of the plan.
 *  - Pausing freezes the plan; resuming shifts everything not yet done by the
 *    number of days paused.
 */

export interface PlanSlot {
  /** Stable id of the session within the plan: "w3d2s0". */
  key: string;
  /** 1-based. */
  week: number;
  day: number;
  index: number;
  session: PlanSession;
}

export type SessionStatus = 'done' | 'skipped' | 'missed' | 'today' | 'upcoming';

export interface ScheduledSession extends PlanSlot {
  /** The date it is on now (after any move). */
  date: IsoDate;
  /** The date the plan first put it on. */
  plannedDate: IsoDate;
  /** What to ride: the session's own reference, or the alternative the player chose. */
  ref: SessionRef;
  status: SessionStatus;
  optional: boolean;
  hard: boolean;
  moved: boolean;
}

export type HardOf = (ref: SessionRef) => boolean;

export function planSlots(plan: PlanDoc): PlanSlot[] {
  const out: PlanSlot[] = [];
  plan.weeks.forEach((w, wi) => {
    [...w.days].sort((a, b) => a.day - b.day).forEach((d) => {
      d.sessions.forEach((session, index) => out.push({ key: `w${wi + 1}d${d.day}s${index}`, week: wi + 1, day: d.day, index, session }));
    });
  });
  return out;
}

export function newPlanState(plan: PlanDoc, startDate: IsoDate, trainingDays?: number[]): PlanState {
  const days = trainingDays ? [...new Set(trainingDays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b) : undefined;
  return { plan: plan.id, startDate, trainingDays: days && days.length ? days : undefined, completed: {}, skipped: {}, moved: {}, swaps: {} };
}

/** Day offsets (0 to 6 from the week's first day) for each plan day in a week. */
function weekOffsets(planDays: number[], startDate: IsoDate, trainingDays?: number[]): Map<number, number> {
  const out = new Map<number, number>();
  const distinct = [...new Set(planDays)].sort((a, b) => a - b);
  if (trainingDays && trainingDays.length >= distinct.length) {
    const startWd = weekday(startDate);
    const offsets = trainingDays.map((wd) => (wd - startWd + 7) % 7).sort((a, b) => a - b);
    // Spread the week's sessions across the chosen days, keeping their order.
    distinct.forEach((d, i) => out.set(d, offsets[Math.floor((i * offsets.length) / distinct.length)]));
  } else {
    distinct.forEach((d) => out.set(d, d - 1));
  }
  return out;
}

/** Every session of the plan with its date and status as of `today`. In date order. */
export function schedule(plan: PlanDoc, state: PlanState, today: IsoDate, hardOf: HardOf = () => false): ScheduledSession[] {
  const slots = planSlots(plan);
  const pausedDays = state.pausedOn ? Math.max(0, daysBetween(state.pausedOn, today)) : 0;
  const out: ScheduledSession[] = [];
  for (let w = 1; w <= plan.weeks.length; w++) {
    const inWeek = slots.filter((s) => s.week === w);
    const offsets = weekOffsets(inWeek.map((s) => s.day), state.startDate, state.trainingDays);
    for (const slot of inWeek) {
      const plannedDate = addDays(state.startDate, (w - 1) * 7 + (offsets.get(slot.day) ?? slot.day - 1));
      let date = state.moved[slot.key] ?? plannedDate;
      const done = state.completed[slot.key];
      const ref = state.swaps[slot.key] ?? slot.session.ref;
      let status: SessionStatus;
      if (done) { status = 'done'; date = done.date; }
      else if (state.skipped[slot.key]) status = 'skipped';
      else {
        // While paused, anything not yet due on the day of pausing floats forward with today.
        if (state.pausedOn && dayNumber(date) >= dayNumber(state.pausedOn)) date = addDays(date, pausedDays);
        const diff = daysBetween(today, date);
        status = diff < 0 ? 'missed' : diff === 0 && !state.pausedOn ? 'today' : 'upcoming';
      }
      out.push({
        ...slot, date, plannedDate, ref, status, optional: !!slot.session.optional, hard: hardOf(ref),
        moved: !!state.moved[slot.key] && state.moved[slot.key] !== plannedDate,
      });
    }
  }
  return out.sort((a, b) => dayNumber(a.date) - dayNumber(b.date) || a.week - b.week || a.day - b.day || a.index - b.index);
}

/** The plan week (1-based) that `today` falls in, clamped to the plan. 0 before the plan starts. */
export function currentWeek(plan: PlanDoc, state: PlanState, today: IsoDate): number {
  const ref = state.pausedOn ?? today;
  const d = daysBetween(state.startDate, ref);
  if (d < 0) return 0;
  return Math.min(plan.weeks.length, Math.floor(d / 7) + 1);
}

/** First and last date of a plan week. */
export function weekSpan(state: PlanState, week: number): { from: IsoDate; to: IsoDate } {
  const from = addDays(state.startDate, (week - 1) * 7);
  return { from, to: addDays(from, 6) };
}

export function endDate(plan: PlanDoc, state: PlanState): IsoDate {
  return addDays(state.startDate, plan.weeks.length * 7 - 1);
}

export interface PlanView {
  week: number;
  today: ScheduledSession[];
  thisWeek: ScheduledSession[];
  /** The next session still to do (today's first, then upcoming). */
  next?: ScheduledSession;
  missed: ScheduledSession[];
  done: number;
  /** Sessions that count: everything except skipped optional ones. */
  total: number;
  /** Every required session is done or dropped. */
  finished: boolean;
  /** The calendar has run past the last week. */
  over: boolean;
}

export function planView(plan: PlanDoc, state: PlanState, today: IsoDate, hardOf?: HardOf): PlanView {
  const all = schedule(plan, state, today, hardOf);
  const week = currentWeek(plan, state, today);
  const open = all.filter((s) => s.status === 'today' || s.status === 'upcoming');
  const required = all.filter((s) => !s.optional);
  return {
    week,
    today: all.filter((s) => s.status === 'today'),
    thisWeek: all.filter((s) => s.week === Math.max(1, week)),
    next: open[0],
    missed: all.filter((s) => s.status === 'missed'),
    done: all.filter((s) => s.status === 'done').length,
    total: all.filter((s) => !(s.optional && s.status === 'skipped')).length,
    finished: required.every((s) => s.status === 'done' || s.status === 'skipped'),
    over: daysBetween(endDate(plan, state), state.pausedOn ?? today) > 0,
  };
}

export interface MissedChange { key: string; action: 'moved' | 'skipped'; from: IsoDate; to?: IsoDate }

/**
 * Deal with missed sessions as of `today`. Returns the new state (the input
 * is not modified) and what was done, so the player can be told.
 */
export function handleMissed(
  plan: PlanDoc, state: PlanState, today: IsoDate, policy: 'push' | 'skip', hardOf: HardOf = () => false,
): { state: PlanState; changes: MissedChange[] } {
  if (state.pausedOn) return { state, changes: [] };
  const next: PlanState = { ...state, skipped: { ...state.skipped }, moved: { ...state.moved } };
  const changes: MissedChange[] = [];
  const all = schedule(plan, next, today, hardOf);
  // Days already spoken for, and which of them are hard.
  const taken = new Map<number, boolean>();
  for (const s of all) {
    if (s.status === 'skipped' || s.status === 'missed') continue;
    const n = dayNumber(s.date);
    taken.set(n, (taken.get(n) ?? false) || s.hard);
  }
  for (const s of all) {
    if (s.status !== 'missed') continue;
    if (policy === 'skip' || s.optional) {
      next.skipped[s.key] = today;
      changes.push({ key: s.key, action: 'skipped', from: s.date });
      continue;
    }
    const last = dayNumber(weekSpan(next, s.week).to);
    let placed: number | undefined;
    for (let n = dayNumber(today); n <= last; n++) {
      if (taken.has(n)) continue;
      if (s.hard && (taken.get(n - 1) || taken.get(n + 1))) continue;
      placed = n;
      break;
    }
    if (placed === undefined) {
      next.skipped[s.key] = today;
      changes.push({ key: s.key, action: 'skipped', from: s.date });
    } else {
      const to = addDays(today, placed - dayNumber(today));
      next.moved[s.key] = to;
      taken.set(placed, s.hard);
      changes.push({ key: s.key, action: 'moved', from: s.date, to });
    }
  }
  return { state: next, changes };
}

/** Choose one of a session's alternatives (or go back to the original with `undefined`). */
export function swapSession(plan: PlanDoc, state: PlanState, key: string, ref: SessionRef | undefined): PlanState {
  const slot = planSlots(plan).find((s) => s.key === key);
  if (!slot) throw new Error(`No session "${key}" in plan "${plan.id}"`);
  const swaps = { ...state.swaps };
  if (ref === undefined || ref === slot.session.ref) delete swaps[key];
  else if ((slot.session.alternatives ?? []).includes(ref)) swaps[key] = ref;
  else throw new Error(`"${ref}" is not an alternative for session "${key}"`);
  return { ...state, swaps };
}

export function skipSession(state: PlanState, key: string, today: IsoDate): PlanState {
  return { ...state, skipped: { ...state.skipped, [key]: today } };
}

export function pausePlan(state: PlanState, today: IsoDate): PlanState {
  return state.pausedOn ? state : { ...state, pausedOn: today };
}

/** Resume a paused plan: everything not yet done moves later by the days paused. */
export function resumePlan(state: PlanState, today: IsoDate): PlanState {
  if (!state.pausedOn) return state;
  const days = Math.max(0, daysBetween(state.pausedOn, today));
  const moved: Record<string, IsoDate> = {};
  for (const [k, d] of Object.entries(state.moved)) moved[k] = dayNumber(d) >= dayNumber(state.pausedOn) ? addDays(d, days) : d;
  const next: PlanState = { ...state, startDate: addDays(state.startDate, days), moved };
  delete next.pausedOn;
  return next;
}

export interface PlannedLoad { duration: number; intensity: number }

/**
 * Which session, if any, a ride counts for.
 *  1. Free rides never count.
 *  2. The same workout or chapter counts if at least 90% of it was ridden:
 *     today's session first, then a missed one, then one later this plan week
 *     (riding Thursday's session on Wednesday is fine).
 *  3. Otherwise a ride counts for one of today's sessions if its duration is
 *     within 15% and its intensity within 0.07 of the plan's.
 */
export function matchRide(
  sessions: ScheduledSession[], today: IsoDate, ride: Pick<RideRecord, 'kind' | 'ref' | 'duration' | 'intensity' | 'complete'>,
  planned: (ref: SessionRef) => PlannedLoad | undefined, week?: number,
): ScheduledSession | undefined {
  if (ride.kind === 'freeRide') return undefined;
  const open = sessions.filter((s) => s.status === 'today' || s.status === 'upcoming' || s.status === 'missed');
  const sameRef = open.filter((s) => {
    if (s.ref !== ride.ref) return false;
    const p = planned(s.ref);
    return ride.complete || (p !== undefined && ride.duration >= p.duration * 0.9);
  });
  const todayNum = dayNumber(today);
  const exact = sameRef.find((s) => s.status === 'today')
    ?? sameRef.find((s) => s.status === 'missed')
    ?? sameRef.find((s) => (week === undefined || s.week === week) && dayNumber(s.date) - todayNum <= 6);
  if (exact) return exact;
  let best: ScheduledSession | undefined;
  let bestScore = Infinity;
  for (const s of open) {
    if (s.status !== 'today') continue;
    const p = planned(s.ref);
    if (!p || p.duration <= 0) continue;
    const dDur = Math.abs(ride.duration / p.duration - 1);
    const dInt = Math.abs(ride.intensity - p.intensity);
    if (dDur > 0.15 || dInt > 0.07) continue;
    const score = dDur / 0.15 + dInt / 0.07;
    if (score < bestScore) { best = s; bestScore = score; }
  }
  return best;
}
