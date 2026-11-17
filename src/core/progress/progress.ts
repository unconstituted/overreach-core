import { findEntry, findRef, parseRef, type Catalogue, type CatalogueEntry, type PlanDoc, type UnlockRule } from '../content';
import { currentWeek, matchRide, planView, schedule, type HardOf, type ScheduledSession } from '../plan';
import type { PlayerData, Progress, RideRecord } from '../player';
import type { IsoDate } from '../util/date';

/** What unlock rules are judged against. */
export interface UnlockContext {
  progress: Progress;
  /** The active plan's id and current week, if there is one. */
  planWeek?: { plan: string; week: number };
}

export function evaluateUnlock(rule: UnlockRule | undefined, ctx: UnlockContext): boolean {
  if (!rule) return true;
  const p = ctx.progress;
  switch (rule.type) {
    case 'always': return true;
    case 'chapterCompleted': return !!p.chapters[rule.chapter];
    case 'flag': return (p.flags[rule.season]?.[rule.flag] ?? false) === (rule.value ?? true);
    case 'totalDistance': return p.totals.distance / 1000 >= rule.km;
    case 'totalTime': return p.totals.time / 3600 >= rule.hours;
    case 'planWeek': {
      if (ctx.planWeek && (rule.plan === undefined || rule.plan === ctx.planWeek.plan) && ctx.planWeek.week >= rule.week) return true;
      // Finishing (or leaving) a plan after reaching the week also counts.
      return p.pastPlans.some((pp) => (rule.plan === undefined || rule.plan === pp.plan) && pp.finished);
    }
    case 'all': return rule.rules.every((r) => evaluateUnlock(r, ctx));
    case 'any': return rule.rules.some((r) => evaluateUnlock(r, ctx));
  }
}

/** A short sentence telling the player how to unlock something. */
export function describeUnlock(rule: UnlockRule | undefined, cat: Catalogue): string {
  if (!rule) return '';
  switch (rule.type) {
    case 'always': return '';
    case 'chapterCompleted': return `Complete ${findEntry(cat, 'chapter', rule.chapter)?.title ?? rule.chapter}`;
    case 'flag': return 'Depends on a choice in the story';
    case 'totalDistance': return `Ride ${rule.km} km in total`;
    case 'totalTime': return `Ride ${rule.hours} ${rule.hours === 1 ? 'hour' : 'hours'} in total`;
    case 'planWeek': return `Reach week ${rule.week} of ${rule.plan ? findEntry(cat, 'plan', rule.plan)?.title ?? rule.plan : 'a plan'}`;
    case 'all': return rule.rules.map((r) => describeUnlock(r, cat)).filter(Boolean).join(', and ');
    case 'any': return rule.rules.map((r) => describeUnlock(r, cat)).filter(Boolean).join(', or ');
  }
}

const unlockKey = (e: CatalogueEntry): string => `${e.type}:${e.id}`;

/** Unlocked now, or at any time before (unlocks never lapse). */
export function isUnlocked(entry: CatalogueEntry, ctx: UnlockContext): boolean {
  if (!entry.unlock || entry.unlock.type === 'always') return true;
  return !!ctx.progress.unlocked[unlockKey(entry)] || evaluateUnlock(entry.unlock, ctx);
}

/**
 * Record anything that has become unlocked. Returns the new progress and the
 * entries unlocked by this call, for the post-ride screen.
 */
export function syncUnlocks(cat: Catalogue, ctx: UnlockContext, today: IsoDate): { progress: Progress; unlocked: CatalogueEntry[] } {
  const unlocked: CatalogueEntry[] = [];
  const map = { ...ctx.progress.unlocked };
  for (const e of cat.entries) {
    if (!e.unlock || e.unlock.type === 'always' || map[unlockKey(e)]) continue;
    if (evaluateUnlock(e.unlock, ctx)) { map[unlockKey(e)] = today; unlocked.push(e); }
  }
  return { progress: unlocked.length ? { ...ctx.progress, unlocked: map } : ctx.progress, unlocked };
}

export function unlockContext(progress: Progress, plan: PlanDoc | undefined, today: IsoDate): UnlockContext {
  const ap = progress.activePlan;
  return { progress, planWeek: ap && plan && plan.id === ap.plan ? { plan: ap.plan, week: currentWeek(plan, ap, today) } : undefined };
}

export const hardFromCatalogue = (cat: Catalogue): HardOf => (ref) => !!findRef(cat, ref)?.hard;

export interface RideOutcome {
  record: RideRecord;
  /** The plan session this ride completed, if any. */
  session?: ScheduledSession;
  /** Plan progress before and after, when a plan is active. */
  plan?: { id: string; doneBefore: number; done: number; total: number; week: number; finished: boolean };
  /** First time this chapter was completed. */
  firstCompletion: boolean;
  /** Content newly unlocked by this ride. */
  unlocked: CatalogueEntry[];
}

/**
 * Fold a finished ride into the player's data: history, totals, chapter
 * completion, story flags, plan progress and unlocks. Pure: returns new data.
 *
 * `plan` is the document for the active plan (if any); `flags` are the story
 * flags at the end of a chapter ride.
 */
export function applyRide(
  data: PlayerData, cat: Catalogue, ride: RideRecord, today: IsoDate,
  opts: { plan?: PlanDoc; flags?: Record<string, boolean> } = {},
): { data: PlayerData; outcome: RideOutcome } {
  const before = data.progress;
  const record: RideRecord = { ...ride };
  const progress: Progress = {
    ...before,
    chapters: { ...before.chapters },
    flags: { ...before.flags },
    pastPlans: [...before.pastPlans],
    totals: {
      rides: before.totals.rides + 1, time: before.totals.time + ride.duration,
      distance: before.totals.distance + ride.distance, kilojoules: before.totals.kilojoules + ride.kilojoules,
    },
  };

  let firstCompletion = false;
  const ref = ride.ref ? parseRef(ride.ref) : undefined;
  if (ride.kind === 'chapter' && ref?.type === 'chapter' && ride.complete) {
    const prev = progress.chapters[ref.id];
    firstCompletion = !prev;
    progress.chapters[ref.id] = { completedOn: prev?.completedOn ?? today, count: (prev?.count ?? 0) + 1 };
    const season = findEntry(cat, 'chapter', ref.id)?.season;
    if (season && opts.flags) progress.flags[season] = { ...(progress.flags[season] ?? {}), ...opts.flags };
  }

  const outcome: RideOutcome = { record, firstCompletion, unlocked: [] };
  const ap = before.activePlan;
  if (ap && opts.plan && opts.plan.id === ap.plan && !ap.pausedOn) {
    const hardOf = hardFromCatalogue(cat);
    const sessions = schedule(opts.plan, ap, today, hardOf);
    const doneBefore = sessions.filter((s) => s.status === 'done').length;
    const hit = matchRide(sessions, today, ride, (r) => {
      const e = findRef(cat, r);
      return e?.duration !== undefined ? { duration: e.duration, intensity: e.intensity ?? 0 } : undefined;
    }, currentWeek(opts.plan, ap, today));
    let state = ap;
    if (hit) {
      state = { ...ap, completed: { ...ap.completed, [hit.key]: { ride: ride.id, date: today } } };
      record.session = { plan: ap.plan, key: hit.key };
      outcome.session = { ...hit, status: 'done', date: today };
    }
    const view = planView(opts.plan, state, today, hardOf);
    outcome.plan = { id: ap.plan, doneBefore, done: view.done, total: view.total, week: view.week, finished: view.finished };
    if (view.finished) {
      progress.pastPlans.push({ plan: ap.plan, startDate: ap.startDate, endedOn: today, completed: view.done, finished: true });
      progress.activePlan = undefined;
    } else progress.activePlan = state;
  }

  const synced = syncUnlocks(cat, unlockContext(progress, opts.plan, today), today);
  outcome.unlocked = synced.unlocked;
  return { data: { ...data, progress: synced.progress, history: [record, ...data.history] }, outcome };
}

/** Start a plan, filing any current one under past plans. */
export function startPlan(progress: Progress, state: NonNullable<Progress['activePlan']>, today: IsoDate): Progress {
  return { ...leavePlan(progress, today), activePlan: state };
}

export function leavePlan(progress: Progress, today: IsoDate): Progress {
  const ap = progress.activePlan;
  if (!ap) return progress;
  return {
    ...progress, activePlan: undefined,
    pastPlans: [...progress.pastPlans, { plan: ap.plan, startDate: ap.startDate, endedOn: today, completed: Object.keys(ap.completed).length, finished: false }],
  };
}
