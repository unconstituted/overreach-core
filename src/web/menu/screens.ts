import { entriesOf, findEntry, findRef, type CatalogueEntry, type MapDoc, type PlanDoc } from '../../core/content';
import {
  newPlanState, pausePlan, planView, resumePlan, schedule, skipSession, swapSession, weekSpan, type ScheduledSession,
} from '../../core/plan';
import { describeUnlock, hardFromCatalogue, leavePlan, startPlan } from '../../core/progress';
import {
  formatSetting, resetCategory, SETTING_CATEGORIES, SETTINGS, setValue, type SettingCategory, type SettingDef, type SettingValue,
} from '../../core/settings';
import { addDays, formatDate, WEEKDAY_NAMES, weekday } from '../../core/util/date';
import { POWER_ZONE_NAMES } from '../../core/record';
import { formatPace } from '../../core/workout';
import { mountDevicePanel } from '../devicePanel';
import type { MenuApp, Screen } from './app';
import {
  cardGrid, fact, fmtClimb, fmtClock, fmtDistance, fmtDuration, FOCUS_LABEL, profileGraph, saveFile, sessionLine, stat, tag, workoutGraph, zoneColour,
} from './components';
import { add, h } from './dom';

const LEVEL: Record<string, string> = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };
/** Seconds per kilometre as m:ss. */
const fmtPaceSetting = (secPerKm: number): string => `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, '0')}`;
const dots = (n: number): string => '●'.repeat(n) + '○'.repeat(Math.max(0, 5 - n));
const refHref = (ref: string): string => `#/ride/${encodeURIComponent(ref)}`;

function lockLine(app: MenuApp, e: CatalogueEntry): HTMLElement | null {
  return app.unlocked(e) ? null : h('p', { class: 'locked small' }, `Locked · ${describeUnlock(e.unlock, app.cat)}`);
}

function sessionCard(app: MenuApp, s: ScheduledSession, withRide: boolean): HTMLElement {
  const e = findRef(app.cat, s.ref);
  const alts = (s.session.alternatives ?? []).filter((a) => a !== s.ref);
  const original = s.ref !== s.session.ref ? s.session.ref : undefined;
  return h('div', { class: `session ${s.status}`, 'data-session': s.key },
    h('div', { class: 'grow' },
      h('h3', null, e?.title ?? s.ref),
      h('p', { class: 'dim small' }, [sessionLine(e), s.hard ? 'Hard day' : '', s.optional ? 'Optional' : '', s.moved ? `Moved from ${formatDate(s.plannedDate, true)}` : ''].filter(Boolean).join(' · ')),
      s.session.note ? h('p', { class: 'small' }, s.session.note) : null,
      e?.graph ? workoutGraph(e.graph, 'graph slim') : null,
      withRide && (alts.length || original) ? h('p', { class: 'small dim' }, 'Not today? ',
        [...(original ? [original] : []), ...alts].map((a) => h('button', {
          class: 'link', onclick: async () => {
            await app.update((p) => ({ ...p, progress: { ...p.progress, activePlan: swapSession(app.activePlan as PlanDoc, p.progress.activePlan!, s.key, a === s.session.ref ? undefined : a) } }));
            await app.render();
          },
        }, `Swap for ${findRef(app.cat, a)?.title ?? a}`))) : null),
    withRide ? h('a', { class: 'button primary', href: refHref(s.ref), 'data-ride': s.ref }, 'Ride') : null);
}

/* ------------------------------------------------------------------ */
/* Home                                                                */
/* ------------------------------------------------------------------ */

export const home: Screen = (app) => {
  const today = app.today();
  const p = app.player;
  const out = h('div', { class: 'stack' },
    h('div', null, h('p', { class: 'kicker' }, formatDate(today)), h('h1', null, `Welcome back, ${p.profile.name}`)));

  // Today's session.
  const plan = app.activePlan;
  const ap = p.progress.activePlan;
  const box = h('section', { class: 'panel stack', id: 'today' }, h('h2', null, 'Today'));
  if (plan && ap) {
    const v = planView(plan, ap, today, hardFromCatalogue(app.cat));
    const planEntry = findEntry(app.cat, 'plan', plan.id);
    box.append(h('p', { class: 'dim small' }, h('a', { href: `#/plans/${plan.id}` }, planEntry?.title ?? plan.id), ` · week ${Math.max(1, v.week)} of ${plan.weeks.length} · ${v.done} of ${v.total} sessions done`));
    if (app.missedChanges.length) {
      const all = schedule(plan, ap, today);
      box.append(h('div', { class: 'note', id: 'missed-note' }, app.missedChanges.map((c) => {
        const s = all.find((x) => x.key === c.key);
        const title = s ? findRef(app.cat, s.ref)?.title ?? s.ref : c.key;
        return h('p', { class: 'small' }, c.action === 'moved' ? `You missed ${title} on ${formatDate(c.from, true)}. It has moved to ${formatDate(c.to as string, true)}.` : `You missed ${title} on ${formatDate(c.from, true)}. It has been dropped; carry on from here.`);
      })));
      app.missedChanges = [];
    }
    if (ap.pausedOn) box.append(h('p', null, `Plan paused since ${formatDate(ap.pausedOn, true)}.`), h('p', null, h('a', { href: `#/plans/${plan.id}` }, 'Resume it from the plan page')));
    else if (v.today.length) v.today.forEach((s) => box.append(sessionCard(app, s, true)));
    else if (v.over) box.append(h('p', null, 'The plan\'s calendar has run out with sessions still open.'), h('p', null, h('a', { href: `#/plans/${plan.id}` }, 'Review the plan')));
    else add(box, h('p', null, 'Rest day. Nothing planned.'), v.next ? h('p', { class: 'dim small' }, `Next: ${findRef(app.cat, v.next.ref)?.title ?? v.next.ref} on ${formatDate(v.next.date)}`) : null);
  } else {
    box.append(h('p', null, 'No plan running.'), h('p', { class: 'dim small' }, 'A plan puts a session here each training day and keeps count for you.'), h('p', null, h('a', { class: 'button', href: '#/plans' }, 'Choose a plan')));
  }
  out.append(box);

  // Continue the season.
  const next = entriesOf(app.cat, 'chapter').filter((c) => c.season).find((c) => app.unlocked(c) && !p.progress.chapters[c.id]);
  const seasonBox = h('section', { class: 'panel stack', id: 'continue' }, h('h2', null, 'Continue the season'));
  if (next) {
    seasonBox.append(h('div', { class: 'session' }, h('div', { class: 'grow' }, h('h3', null, next.title), h('p', { class: 'dim small' }, [next.subtitle, next.duration ? fmtDuration(next.duration) : ''].filter(Boolean).join(' · ')), workoutGraph(next.graph, 'graph slim')),
      h('a', { class: 'button primary', href: refHref(`chapter:${next.id}`) }, 'Ride')));
  } else seasonBox.append(h('p', null, 'You are up to date.'), h('p', null, h('a', { href: '#/season' }, 'Ride a chapter again')));
  out.append(seasonBox);

  // Quick ride.
  const quick = entriesOf(app.cat, 'workout').filter((w) => (w.duration ?? 0) <= 2700 && !w.hard).slice(0, 3);
  out.append(h('section', { class: 'panel stack' }, h('h2', null, 'Quick ride'),
    h('div', { class: 'row' }, quick.map((w) => h('a', { class: 'button', href: refHref(`workout:${w.id}`) }, `${w.title} · ${fmtDuration(w.duration ?? 0)}`)),
      h('a', { class: 'button', href: '#/maps' }, 'Free ride on a map'), h('a', { class: 'button', href: '#/workouts' }, 'All workouts'))));

  // Recent rides.
  const recent = p.history.slice(0, 3);
  out.append(h('section', { class: 'panel stack' }, h('h2', null, 'Recent rides'),
    recent.length ? rideTable(app, recent) : h('p', { class: 'dim' }, 'Nothing yet. Your rides will appear here.'),
    p.history.length > 3 ? h('p', null, h('a', { href: '#/profile' }, `All ${p.history.length} rides`)) : null));
  return out;
};

/* ------------------------------------------------------------------ */
/* Season                                                              */
/* ------------------------------------------------------------------ */

export const season: Screen = (app) => {
  const out = h('div', { class: 'stack' }, h('h1', null, 'Season'));
  for (const s of entriesOf(app.cat, 'season')) {
    const chapters = (s.chapters ?? []).map((id) => findEntry(app.cat, 'chapter', id)).filter((c): c is CatalogueEntry => !!c);
    const done = chapters.filter((c) => app.player.progress.chapters[c.id]).length;
    out.append(h('section', { class: 'panel stack' },
      h('div', null, h('p', { class: 'kicker' }, `Season ${s.number ?? ''} · ${done} of ${chapters.length} complete`), h('h1', null, s.title)),
      h('p', { class: 'measure' }, s.description),
      h('ol', { class: 'chapters' }, chapters.map((c, i) => {
        const open = app.unlocked(c);
        const prog = app.player.progress.chapters[c.id];
        return h('li', { class: `session ${open ? '' : 'is-locked'} ${prog ? 'done' : ''}`, 'data-chapter': c.id },
          h('span', { class: 'num' }, String(i + 1).padStart(2, '0')),
          h('div', { class: 'grow' }, h('h3', null, c.title),
            h('p', { class: 'dim small' }, [c.duration ? fmtDuration(c.duration) : '', c.intensity ? `Intensity ${c.intensity.toFixed(2)}` : '', prog ? `Completed ${formatDate(prog.completedOn, true)}${prog.count > 1 ? ` · ridden ${prog.count} times` : ''}` : ''].filter(Boolean).join(' · ')),
            open ? workoutGraph(c.graph, 'graph slim') : lockLine(app, c)),
          open ? h('a', { class: `button ${prog ? '' : 'primary'}`, href: refHref(`chapter:${c.id}`) }, prog ? 'Ride again' : 'Ride') : tag('Locked', 'lock'));
      }))));
  }
  return out;
};

/* ------------------------------------------------------------------ */
/* Plans                                                               */
/* ------------------------------------------------------------------ */

export const plans: Screen = async (app, params) => {
  if (params[0]) return planDetail(app, params[0]);
  const active = app.player.progress.activePlan?.plan;
  return h('div', { class: 'stack' }, h('h1', null, 'Plans'),
    h('p', { class: 'dim measure' }, 'A plan is a set of weeks. Start one and its sessions appear on Home each training day.'),
    cardGrid({
      id: 'plans', items: entriesOf(app.cat, 'plan'), empty: 'No plans match those filters.',
      filters: [
        { key: 'sport', label: 'Sport', options: [{ value: 'bike', label: 'Cycling' }, { value: 'run', label: 'Running' }] },
        { key: 'level', label: 'Level', options: Object.entries(LEVEL).map(([value, label]) => ({ value, label })) },
        { key: 'hours', label: 'Hours a week', options: [{ value: '3', label: 'Up to 3' }, { value: '5', label: '3 to 5' }, { value: '99', label: 'Over 5' }] },
        { key: 'weeks', label: 'Length', options: [{ value: '2', label: '1 to 2 weeks' }, { value: '6', label: '3 to 6 weeks' }, { value: '99', label: '7 weeks or more' }] },
      ],
      match: (e, key, v) => {
        if (key === 'hours') { const hi = e.hoursPerWeek?.[1] ?? 0; return v === '3' ? hi <= 3 : v === '5' ? hi > 3 && hi <= 5 : hi > 5; }
        if (key === 'weeks') { const w = e.weeks ?? 0; return v === '2' ? w <= 2 : v === '6' ? w >= 3 && w <= 6 : w >= 7; }
        return String((e as unknown as Record<string, unknown>)[key]) === v;
      },
      card: (e) => h('a', { class: `card ${app.unlocked(e) ? '' : 'is-locked'}`, href: `#/plans/${e.id}`, 'data-id': e.id },
        h('div', { class: 'row' }, tag(e.style === 'story' ? 'Story' : 'Training block'), tag(LEVEL[e.level ?? ''] ?? ''), active === e.id ? tag('Your plan', 'on') : null),
        h('h3', null, e.title), h('p', { class: 'dim small clamp' }, e.description),
        h('p', { class: 'facts' }, fact(e.weeks === 1 ? 'week' : 'weeks', e.weeks), fact('sessions', e.sessions), fact('h a week', e.hoursPerWeek ? `${e.hoursPerWeek[0]}–${e.hoursPerWeek[1]}` : undefined)),
        lockLine(app, e)),
    }));
};

async function planDetail(app: MenuApp, id: string): Promise<HTMLElement> {
  const entry = findEntry(app.cat, 'plan', id);
  if (!entry) throw new Error(`There is no plan called "${id}"`);
  const plan = await app.doc<PlanDoc>(entry);
  const today = app.today();
  const ap = app.player.progress.activePlan;
  const mine = ap?.plan === id ? ap : undefined;
  const hardOf = hardFromCatalogue(app.cat);
  // An inactive plan is previewed as if it started today.
  const preview = mine ?? newPlanState(plan, today);
  const all = schedule(plan, preview, today, hardOf);
  const out = h('div', { class: 'stack' },
    h('p', null, h('a', { href: '#/plans' }, '← Plans')),
    h('div', null, h('p', { class: 'kicker' }, `${entry.style === 'story' ? 'Story plan' : 'Training block'} · ${LEVEL[plan.level]}`), h('h1', null, plan.title)),
    h('p', { class: 'measure' }, plan.description),
    h('p', { class: 'facts' }, fact(plan.weeks.length === 1 ? 'week' : 'weeks', plan.weeks.length), fact('sessions', entry.sessions), fact('hours a week', `${plan.hoursPerWeek[0]}–${plan.hoursPerWeek[1]}`), fact('', plan.goal)));

  const setPlan = async (state: typeof ap) => {
    await app.update((p) => ({ ...p, progress: { ...p.progress, activePlan: state } }));
    await app.refreshPlan();
    await app.render();
  };
  const controls = h('section', { class: 'panel stack', id: 'plan-controls' });
  if (!app.unlocked(entry)) controls.append(lockLine(app, entry) as HTMLElement);
  else if (mine) {
    const v = planView(plan, mine, today, hardOf);
    controls.append(h('h2', null, 'Your plan'),
      h('p', null, mine.pausedOn ? `Paused since ${formatDate(mine.pausedOn, true)}. Resuming moves everything left by the days you were away.` : `Started ${formatDate(mine.startDate)} · week ${Math.max(1, v.week)} of ${plan.weeks.length} · ${v.done} of ${v.total} sessions done`),
      h('div', { class: 'row' },
        mine.pausedOn
          ? h('button', { class: 'primary', id: 'plan-resume', onclick: () => setPlan(resumePlan(mine, today)) }, 'Resume plan')
          : h('button', { id: 'plan-pause', onclick: () => setPlan(pausePlan(mine, today)) }, 'Pause plan'),
        h('button', { id: 'plan-leave', onclick: async () => { await app.update((p) => ({ ...p, progress: leavePlan(p.progress, today) })); await app.refreshPlan(); await app.render(); } }, 'Leave plan')));
  } else {
    const days = new Set<number>();
    const startInput = h('input', { type: 'date', value: today, id: 'plan-start' });
    add(controls, h('h2', null, 'Start this plan'),
      ap ? h('p', { class: 'small dim' }, `Starting it will end ${findEntry(app.cat, 'plan', ap.plan)?.title ?? 'your current plan'}.`) : null,
      h('div', { class: 'row' }, h('label', null, 'Start date', startInput),
        h('fieldset', { class: 'days' }, h('legend', null, 'Training days (optional)'),
          WEEKDAY_NAMES.map((name, i) => h('label', { class: 'check' }, h('input', { type: 'checkbox', 'data-day': i + 1, onchange: (e: Event) => { if ((e.target as HTMLInputElement).checked) days.add(i + 1); else days.delete(i + 1); } }), name.slice(0, 3))))),
      h('p', { class: 'small dim' }, 'Leave the days blank to use the plan\'s own. Pick at least as many days as the busiest week needs, or they are ignored.'),
      h('div', null, h('button', {
        class: 'primary', id: 'plan-start-btn', onclick: async () => {
          const start = /^\d{4}-\d{2}-\d{2}$/.test(startInput.value) ? startInput.value : today;
          await app.update((p) => ({ ...p, progress: startPlan(p.progress, newPlanState(plan, start, [...days]), today) }));
          await app.refreshPlan();
          await app.render();
        },
      }, 'Start plan')));
  }
  out.append(controls);

  // Week-by-week calendar.
  const cal = h('section', { class: 'stack', id: 'calendar' }, h('h2', null, mine ? 'Calendar' : 'What it looks like, starting today'));
  plan.weeks.forEach((w, wi) => {
    const span = weekSpan(preview, wi + 1);
    const cells: HTMLElement[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(span.from, d);
      const sessions = all.filter((s) => s.date === date && s.status !== 'skipped');
      cells.push(h('div', { class: `day ${date === today ? 'is-today' : ''}` },
        h('span', { class: 'date' }, `${WEEKDAY_NAMES[weekday(date) - 1].slice(0, 3)} ${parseInt(date.slice(8), 10)}`),
        sessions.map((s) => {
          const e = findRef(app.cat, s.ref);
          return h('a', { class: `chip ${s.status} ${s.hard ? 'hard' : ''} ${s.optional ? 'optional' : ''}`, href: refHref(s.ref), title: sessionLine(e), 'data-key': s.key },
            h('b', null, e?.title ?? s.ref), h('span', null, [e?.duration ? fmtDuration(e.duration) : '', s.status === 'done' ? 'Done' : s.status === 'missed' ? 'Missed' : s.optional ? 'Optional' : ''].filter(Boolean).join(' · ')),
            mine && (s.status === 'today' || s.status === 'upcoming' || s.status === 'missed') ? h('button', {
              class: 'link', 'data-skip': s.key, onclick: async (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); await setPlan(skipSession(mine, s.key, today)); },
            }, 'Skip') : null);
        })));
    }
    const dropped = all.filter((s) => s.week === wi + 1 && s.status === 'skipped');
    cal.append(h('div', { class: 'week' },
      h('div', { class: 'weekhead' }, h('h3', null, w.title ?? `Week ${wi + 1}`), h('span', { class: 'dim small' }, [w.focus, `${formatDate(span.from, true)} to ${formatDate(span.to, true)}`].filter(Boolean).join(' · '))),
      h('div', { class: 'days7' }, cells),
      dropped.length ? h('p', { class: 'small dim' }, `Dropped: ${dropped.map((s) => findRef(app.cat, s.ref)?.title ?? s.ref).join(', ')}`) : null));
  });
  out.append(cal);
  return out;
}

/* ------------------------------------------------------------------ */
/* Workouts                                                            */
/* ------------------------------------------------------------------ */

export const workouts: Screen = (app) => {
  const items = entriesOf(app.cat, 'workout');
  const focuses = [...new Set(items.map((w) => w.focus ?? 'mixed'))];
  return h('div', { class: 'stack' }, h('h1', null, 'Workouts'),
    cardGrid({
      id: 'workouts', items, empty: 'No workouts match those filters.',
      filters: [
        { key: 'sport', label: 'Sport', options: [{ value: 'bike', label: 'Cycling' }, { value: 'run', label: 'Running' }] },
        { key: 'focus', label: 'Focus', options: Object.keys(FOCUS_LABEL).filter((f) => focuses.includes(f as never)).map((f) => ({ value: f, label: FOCUS_LABEL[f] })) },
        { key: 'duration', label: 'Duration', options: [{ value: '45', label: 'Up to 45 min' }, { value: '60', label: '45 to 60 min' }, { value: '999', label: 'Over an hour' }] },
        { key: 'difficulty', label: 'Difficulty', options: [{ value: '2', label: 'Easy (1–2)' }, { value: '3', label: 'Moderate (3)' }, { value: '5', label: 'Hard (4–5)' }] },
      ],
      match: (e, key, v) => {
        const m = (e.duration ?? 0) / 60; const d = e.difficulty ?? 3;
        if (key === 'duration') return v === '45' ? m <= 45 : v === '60' ? m > 45 && m <= 60 : m > 60;
        if (key === 'difficulty') return v === '2' ? d <= 2 : v === '3' ? d === 3 : d >= 4;
        return String((e as unknown as Record<string, unknown>)[key]) === v;
      },
      card: (e) => h('a', { class: 'card', href: refHref(`workout:${e.id}`), 'data-id': e.id },
        h('div', { class: 'row' }, tag(FOCUS_LABEL[e.focus ?? 'mixed']), e.sport === 'run' ? tag('Run') : null, h('span', { class: 'dots', title: `Difficulty ${e.difficulty} of 5` }, dots(e.difficulty ?? 3))),
        h('h3', null, e.title), workoutGraph(e.graph),
        h('p', { class: 'facts' }, fact('', fmtDuration(e.duration ?? 0)), fact('intensity', e.intensity?.toFixed(2)), fact('stress', e.stress)),
        h('p', { class: 'dim small clamp' }, e.description ?? '')),
    }));
};

/* ------------------------------------------------------------------ */
/* Maps                                                                */
/* ------------------------------------------------------------------ */

export const maps: Screen = async (app) => {
  const items = entriesOf(app.cat, 'map');
  const docs = new Map<string, MapDoc>();
  await Promise.all(items.map(async (e) => docs.set(e.id, await app.doc<MapDoc>(e))));
  return h('div', { class: 'stack' }, h('h1', null, 'Maps'),
    h('p', { class: 'dim measure' }, 'Free ride: no targets, no story. Your power moves the ship, and the trainer follows the terrain.'),
    h('div', { class: 'cards wide' }, items.map((e) => {
      const open = app.unlocked(e);
      const doc = docs.get(e.id) as MapDoc;
      const body = [
        e.image ? h('div', { class: 'thumb', style: { backgroundImage: `url("${e.image}")` } }) : null,
        h('h3', null, e.title), h('p', { class: 'dim small' }, e.description ?? ''),
        profileGraph(doc.profile, doc.length),
        h('p', { class: 'facts' }, fact('', fmtDistance(e.length ?? 0, app.units)), fact('climbing', fmtClimb(e.climb ?? 0, app.units))),
        lockLine(app, e),
      ];
      return open ? h('a', { class: 'card', href: refHref(`map:${e.id}`), 'data-id': e.id }, body) : h('div', { class: 'card is-locked', 'data-id': e.id }, body);
    })));
};

/* ------------------------------------------------------------------ */
/* Pre-ride                                                            */
/* ------------------------------------------------------------------ */

export const ride: Screen = async (app, params) => {
  const ref = params[0] ?? '';
  const [type, id] = ref.split(':');
  const entry = findEntry(app.cat, type as CatalogueEntry['type'], id);
  if (!entry) throw new Error(`"${ref}" is not something you can ride`);
  const back = type === 'chapter' ? ['#/season', 'Season'] : type === 'map' ? ['#/maps', 'Maps'] : ['#/workouts', 'Workouts'];
  const out = h('div', { class: 'stack' }, h('p', null, h('a', { href: back[0] }, `← ${back[1]}`)),
    h('div', null, h('p', { class: 'kicker' }, type === 'chapter' ? entry.subtitle ?? 'Chapter' : type === 'map' ? 'Free ride' : `Workout · ${FOCUS_LABEL[entry.focus ?? 'mixed']}`), h('h1', null, entry.title)),
    entry.description ? h('p', { class: 'measure' }, entry.description) : null);
  if (!app.unlocked(entry)) { out.append(lockLine(app, entry) as HTMLElement); return out; }

  const ftp = Number(app.player.profile.ftp);
  if (type === 'map') {
    const doc = await app.doc<MapDoc>(entry);
    out.append(h('section', { class: 'panel stack' }, profileGraph(doc.profile, doc.length, 'graph tall'),
      h('p', { class: 'facts' }, fact('', fmtDistance(entry.length ?? 0, app.units)), fact('climbing', fmtClimb(entry.climb ?? 0, app.units)), fact('trainer difficulty', `${app.player.settings['devices.gradeScale']}%`)),
      h('p', { class: 'small dim' }, 'The ride ends when you reach the end of the map, or when you choose End ride.')));
  } else {
    out.append(h('section', { class: 'panel stack' }, workoutGraph(entry.graph, 'graph tall'),
      h('p', { class: 'facts' }, fact('', fmtDuration(entry.duration ?? 0)), fact('intensity', entry.intensity?.toFixed(2)), fact('training stress', entry.stress),
        entry.sport === 'run' ? fact('threshold pace', `${fmtPaceSetting(Number(app.player.profile.thresholdPace))} /km`) : fact('W is your FTP', ftp)),
      h('p', { class: 'small dim' }, entry.sport === 'run'
        ? 'The dashed line is your threshold pace. Targets are set from it; change it in Settings if the easy parts are not easy.'
        : 'The dashed line is your FTP. Targets are set from it; change it in Settings if the easy parts are not easy.')));
  }
  const go = h('button', { class: 'primary go', id: 'ride-start' }, 'Start ride');
  // A pace workout is run-only; anything else can be ridden, or run at the same effort.
  const runOnly = entry.sport === 'run';
  const dev = h('section', { class: 'panel', id: 'pre-devices' });
  app.onLeave(mountDevicePanel(dev, app.devices, {
    sports: runOnly ? ['run'] : ['bike', 'run'],
    initial: runOnly ? 'run' : (app.player.profile.sport as 'bike' | 'run' | undefined) ?? 'bike',
    onSport: (sp) => {
      app.rideSport = sp;
      go.textContent = sp === 'run' ? 'Start run' : 'Start ride';
      const note = out.querySelector('#pre-sport-note');
      if (note) note.textContent = sp === 'run' && !runOnly && type !== 'map'
        ? 'Running it: every power target becomes a pace at the same effort, from your threshold pace in Settings.'
        : sp === 'run' && type === 'map' ? 'Running it: the hills become treadmill incline (uphill only), and your own pace moves you along.' : '';
    },
  }));
  out.append(dev, h('p', { class: 'small dim', id: 'pre-sport-note' }));

  const feelDef = SETTINGS.find((d) => d.key === 'feel.preset') as SettingDef & { type: 'choice' };
  go.onclick = async () => { go.disabled = true; go.textContent = 'Loading…'; await app.startRide(ref); };
  out.append(h('div', { class: 'row' }, go,
    h('label', null, 'Feel', h('select', {
      id: 'pre-feel', onchange: async (e: Event) => { const v = (e.target as HTMLSelectElement).value; await app.update((p) => ({ ...p, settings: setValue(p.settings, 'feel.preset', v) })); },
    }, feelDef.options.map((o) => h('option', { value: o.value, selected: app.player.settings['feel.preset'] === o.value }, o.label))))));
  return out;
};

/* ------------------------------------------------------------------ */
/* Post-ride                                                           */
/* ------------------------------------------------------------------ */

export const done: Screen = (app) => {
  const last = app.last;
  if (!last) return h('div', { class: 'stack' }, h('h1', null, 'No ride to show'), h('p', null, h('a', { href: '#/home' }, 'Back to Home')));
  const { outcome, result } = last;
  const r = outcome.record;
  const sm = result.summary;
  const run = result.sport === 'run';
  const out = h('div', { class: 'stack', id: 'post-ride' },
    h('div', null, h('p', { class: 'kicker' }, r.complete ? (r.kind === 'chapter' ? 'Chapter complete' : r.kind === 'freeRide' ? 'Map complete' : 'Workout complete') : 'Ride ended early'), h('h1', null, r.title)),
    h('section', { class: 'panel stack' }, h('h2', null, `${run ? 'Run' : 'Ride'} summary${result.simulated ? (run ? ' · simulated runner' : ' · simulated rider') : ''}`),
      h('div', { class: 'stats' }, stat(fmtClock(r.duration), 'Duration'),
        run
          ? [stat(fmtDistance(r.distance, app.units), 'Distance'),
            stat(sm ? formatPace(sm.avgSpeed, app.units === 'imperial' ? 'imperial' : 'metric') : '–', `Average pace · ${app.units === 'imperial' ? '/mi' : '/km'}`),
            sm?.avgCadence ? stat(String(Math.round(sm.avgCadence)), 'Average cadence · spm') : null,
            sm?.hasPower ? stat(String(r.avgPower), 'Average running power · W') : null]
          : [stat(String(r.normalisedPower), 'Normalised power · W'), stat(String(r.avgPower), 'Average power · W'),
            stat(String(r.kilojoules), 'Work · kJ'), stat(fmtDistance(r.distance, app.units), 'Distance')],
        r.avgHeartRate ? stat(String(r.avgHeartRate), 'Average heart rate') : null, r.maxHeartRate ? stat(String(r.maxHeartRate), 'Max heart rate') : null,
        stat(r.intensity.toFixed(2), 'Intensity factor'), stat(String(r.stress), 'Training stress'))));
  if (sm) {
    const total = sm.timeInPowerZones.reduce((a, b) => a + b, 0) || 1;
    const mid = [0.5, 0.65, 0.8, 0.95, 1.1, 1.3, 1.6];
    out.append(h('section', { class: 'panel stack' }, h('h2', null, run && !sm.hasPower ? 'Time in effort zones' : 'Time in power zones'),
      h('div', { class: 'zones' }, sm.timeInPowerZones.map((s, i) => h('i', { style: { width: `${(s / total) * 100}%`, background: zoneColour(mid[i]) } }))),
      h('div', { class: 'zonekey' }, sm.timeInPowerZones.map((s, i) => h('span', null, h('i', { style: { background: zoneColour(mid[i]) } }), `Z${i + 1} ${POWER_ZONE_NAMES[i]} · ${fmtClock(s)}`)))));
  }
  if (outcome.plan) {
    const pe = findEntry(app.cat, 'plan', outcome.plan.id);
    out.append(h('section', { class: 'panel stack', id: 'post-plan' }, h('h2', null, 'Plan'),
      outcome.session
        ? h('p', { id: 'post-session' }, `Session complete: ${findRef(app.cat, outcome.session.ref)?.title ?? outcome.session.ref}.`)
        : h('p', null, r.kind === 'freeRide' ? 'Free rides do not count towards plan sessions.' : 'This ride did not match a session in your plan.'),
      h('p', { class: 'dim', id: 'post-plan-progress' }, `${pe?.title ?? outcome.plan.id}: ${outcome.plan.done} of ${outcome.plan.total} sessions done${outcome.plan.finished ? '. Plan finished.' : ` · week ${Math.max(1, outcome.plan.week)}`}`),
      h('div', { class: 'bar' }, h('i', { style: { width: `${(outcome.plan.done / Math.max(1, outcome.plan.total)) * 100}%` } }))));
  }
  if (outcome.unlocked.length) {
    out.append(h('section', { class: 'panel stack', id: 'post-unlocked' }, h('h2', null, 'Unlocked'),
      outcome.unlocked.map((e) => h('p', null, tag(e.type === 'map' ? 'Map' : e.type === 'chapter' ? 'Chapter' : e.type === 'plan' ? 'Plan' : e.type, 'on'), ' ',
        h('a', { href: e.type === 'plan' ? `#/plans/${e.id}` : e.type === 'season' ? '#/season' : refHref(`${e.type}:${e.id}`) }, e.title)))));
  }
  out.append(h('div', { class: 'row' },
    result.fit ? h('button', { class: 'primary', id: 'post-fit', onclick: () => saveFile(`overreach-${r.id}.fit`, result.fit as BlobPart, 'application/vnd.ant.fit') }, 'Download .fit') : null,
    h('a', { class: 'button', href: '#/home', id: 'post-home' }, 'Home'), r.ref ? h('a', { class: 'button', href: refHref(r.ref) }, 'Ride it again') : null));
  return out;
};

/* ------------------------------------------------------------------ */
/* Profile and history                                                 */
/* ------------------------------------------------------------------ */

function rideTable(app: MenuApp, rides: MenuApp['player']['history']): HTMLElement {
  return h('div', { class: 'tablewrap' }, h('table', { class: 'rides' },
    h('thead', null, h('tr', null, ['Date', 'Ride', 'Time', 'Distance', 'NP', 'IF', 'TSS', ''].map((c) => h('th', null, c)))),
    h('tbody', null, rides.map((r) => h('tr', { 'data-ride': r.id },
      h('td', null, formatDate(r.date.slice(0, 10), true)),
      h('td', null, r.sport === 'run' ? h('span', { class: 'dim' }, 'Run · ') : null, r.title, r.complete ? null : h('span', { class: 'dim' }, ' (part)'), r.session ? h('span', { class: 'dim' }, ' · plan') : null),
      h('td', null, fmtClock(r.duration)), h('td', null, fmtDistance(r.distance, app.units)), h('td', null, r.normalisedPower ? `${r.normalisedPower} W` : '–'), h('td', null, r.intensity.toFixed(2)), h('td', null, r.stress),
      h('td', null, r.hasFit ? h('button', {
        class: 'link', 'data-fit': r.id, onclick: async () => {
          const bytes = await app.store.getFit(r.id);
          if (bytes) saveFile(`overreach-${r.id}.fit`, bytes as BlobPart, 'application/vnd.ant.fit');
        },
      }, '.fit') : null))))));
}

export const profile: Screen = (app) => {
  const p = app.player;
  const t = p.progress.totals;
  const importInput = h('input', { type: 'file', accept: 'application/json,.json', id: 'import-file', hidden: true });
  const msg = h('p', { class: 'small', role: 'status', id: 'profile-msg' });
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      app.player = await app.store.importAll(await file.text());
      await app.refreshPlan();
      await app.render();
    } catch (e) {
      msg.textContent = (e as Error).message;
      msg.className = 'error';
    }
  });
  let armed = false;
  const reset = h('button', { id: 'reset-all' }, 'Erase everything');
  reset.onclick = async () => {
    // Two presses rather than a browser dialog, which some viewers never show.
    if (!armed) { armed = true; reset.textContent = 'Press again to erase all rides and progress'; reset.classList.add('danger'); return; }
    await app.store.clear();
    location.hash = '#/home';
    location.reload();
  };
  return h('div', { class: 'stack' },
    h('div', null, h('p', { class: 'kicker' }, 'Profile'), h('h1', null, String(p.profile.name))),
    h('section', { class: 'panel stack' }, h('h2', null, 'Totals'),
      h('div', { class: 'stats' }, stat(String(t.rides), 'Rides'), stat((t.time / 3600).toFixed(1), 'Hours'), stat(fmtDistance(t.distance, app.units, 0), 'Distance'), stat(String(Math.round(t.kilojoules)), 'Work · kJ'),
        stat(String(Object.keys(p.progress.chapters).length), 'Chapters complete'), stat(String(p.profile.ftp), 'FTP · W')),
      h('p', { class: 'small dim' }, h('a', { href: '#/settings' }, 'Change your name, FTP, heart rate, weight and units in Settings'))),
    h('section', { class: 'panel stack' }, h('h2', null, `Ride history · ${p.history.length}`),
      p.history.length ? rideTable(app, p.history) : h('p', { class: 'dim' }, 'No rides yet.')),
    h('section', { class: 'panel stack' }, h('h2', null, 'Your data'),
      h('p', { class: 'small dim measure' }, `Everything is kept in this browser (${app.storageKind === 'indexeddb' ? 'IndexedDB' : 'local storage, which is small: export often'}). Export makes one file with your profile, progress, settings and every ride; import it on another device to carry on there.`),
      h('div', { class: 'row' },
        h('button', {
          id: 'export-all', onclick: async () => {
            const json = await app.store.exportAll(app.player, new Date().toISOString());
            saveFile(`overreach-player-${app.today()}.json`, json, 'application/json');
          },
        }, 'Export'),
        h('button', { id: 'import-all', onclick: () => importInput.click() }, 'Import'), importInput, reset),
      msg));
};

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

function control(def: SettingDef, value: SettingValue, change: (v: unknown) => void): HTMLElement {
  const id = `set-${def.key.replace(/\W/g, '-')}`;
  switch (def.type) {
    case 'toggle':
      return h('input', { type: 'checkbox', id, checked: value === true, onchange: (e: Event) => change((e.target as HTMLInputElement).checked) });
    case 'choice':
      return h('select', { id, onchange: (e: Event) => change((e.target as HTMLSelectElement).value) }, def.options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
    case 'text':
      return h('input', { type: 'text', id, value, maxlength: def.maxLength, onchange: (e: Event) => change((e.target as HTMLInputElement).value) });
    case 'slider': {
      const read = h('output', { for: id }, formatSetting(def, value));
      return h('span', { class: 'slider' }, h('input', {
        type: 'range', id, min: def.min, max: def.max, step: def.step, value,
        oninput: (e: Event) => { read.textContent = formatSetting(def, parseFloat((e.target as HTMLInputElement).value)); },
        onchange: (e: Event) => change(parseFloat((e.target as HTMLInputElement).value)),
      }), read);
    }
    case 'number':
      if (def.format === 'pace') {
        const s = Math.round(value as number);
        return h('span', { class: 'slider' }, h('input', {
          type: 'text', id, inputmode: 'numeric', value: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, size: 6,
          onchange: (e: Event) => { const m = /^(\d+)[:.](\d{1,2})$/.exec((e.target as HTMLInputElement).value.trim()); change(m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : value); },
        }), h('span', { class: 'dim' }, `min:sec ${def.unit ?? ''}`));
      }
      return h('span', { class: 'slider' }, h('input', { type: 'number', id, min: def.min, max: def.max, step: def.step, value, onchange: (e: Event) => change((e.target as HTMLInputElement).value) }), def.unit ? h('span', { class: 'dim' }, def.unit) : null);
  }
}

export const settings: Screen = (app) => {
  const out = h('div', { class: 'stack' }, h('h1', null, 'Settings'));
  const change = async (def: SettingDef, v: unknown) => {
    await app.update((p) => (def.store === 'profile' ? { ...p, profile: setValue(p.profile, def.key, v) } : { ...p, settings: setValue(p.settings, def.key, v) }));
    if (def.key === 'plan.missed') await app.refreshPlan();
    await app.render();
  };
  const section = (cat: SettingCategory) => {
    const defs = SETTINGS.filter((d) => d.category === cat);
    if (defs.length === 0) return null;
    return h('section', { class: 'panel stack', 'data-category': cat },
      h('div', { class: 'row' }, h('h2', { class: 'grow' }, cat), h('button', {
        class: 'link', 'data-reset': cat, onclick: async () => {
          await app.update((p) => ({ ...p, profile: resetCategory(p.profile, 'profile', cat), settings: resetCategory(p.settings, 'settings', cat) }));
          await app.render();
        },
      }, 'Reset to defaults')),
      defs.map((def) => {
        const value = (def.store === 'profile' ? app.player.profile : app.player.settings)[def.key];
        return h('div', { class: 'setting', 'data-key': def.key },
          h('label', { for: `set-${def.key.replace(/\W/g, '-')}`, class: 'grow' }, h('span', null, def.label), def.help ? h('small', null, def.help) : null,
            def.midRide ? null : h('small', { class: 'dim' }, 'Applies from your next ride.')),
          control(def, value, (v) => void change(def, v)));
      }));
  };
  for (const cat of SETTING_CATEGORIES) { const s = section(cat); if (s) out.append(s); }
  return out;
};

export const SCREENS: Record<string, Screen> = { home, season, plans, workouts, maps, ride, done, profile, settings };
