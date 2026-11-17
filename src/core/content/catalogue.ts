import { loadChapterWorkout, type Chapter } from '../chapter';
import { buildWorkout, parseFitWorkout, parseZwo, targetAt, totalDuration, type Workout } from '../workout';
import {
  parseRef, type Catalogue, type CatalogueEntry, type GraphBar, type MapDoc, type PlanDoc, type SeasonDoc, type UnlockRule, type WorkoutDoc,
} from './types';

/** Reads a file next to a content file: text for .zwo, bytes for .fit. */
export type FileReader = (path: string) => string | Uint8Array;

/** Build the runnable workout for a workout document. */
export function loadWorkoutDoc(doc: WorkoutDoc, readFile?: FileReader): Workout {
  if (doc.steps) {
    const w = buildWorkout({ name: doc.title, description: doc.description, sport: doc.sport, steps: doc.steps });
    return w;
  }
  if (!doc.file) throw new Error(`Workout "${doc.id}" has neither steps nor a file`);
  if (!readFile) throw new Error(`Workout "${doc.id}" references ${doc.file}; pass a file reader`);
  const data = readFile(doc.file);
  let w: Workout;
  if (/\.zwo$/i.test(doc.file)) {
    if (typeof data !== 'string') throw new Error(`${doc.file} must be read as text`);
    w = parseZwo(data);
  } else if (/\.fit$/i.test(doc.file)) {
    if (typeof data === 'string') throw new Error(`${doc.file} must be read as bytes`);
    w = parseFitWorkout(data);
  } else throw new Error(`Unsupported workout file type: ${doc.file}`);
  return { ...w, name: doc.title, description: doc.description ?? w.description, sport: doc.sport ?? w.sport };
}

export interface WorkoutStats {
  duration: number;
  /** Estimated intensity factor, assuming the rider hits every target. */
  intensity: number;
  stress: number;
  hard: boolean;
  graph: GraphBar[];
}

/** Assumed effort for free-ride steps and for targets not expressed as a fraction of threshold. */
const FREE_EFFORT = 0.6;

/**
 * Planned load of a workout. Targets in absolute units (watts, m/s, bpm) are
 * scaled by `reference` (a nominal threshold in the same unit) when given.
 */
export function workoutStats(w: Workout, reference = 250): WorkoutStats {
  let sum4 = 0;
  let n = 0;
  let above = 0;
  const graph: GraphBar[] = [];
  for (const s of w.steps) {
    const rel = (v: number): number => {
      const unit = s.target?.unit as string | undefined;
      if (unit === 'watts') return v / reference;
      // Fractions of threshold (power or pace) and of max heart rate are used as they are.
      return unit === 'ftp' || unit === 'pace' || unit === 'hr' ? v : FREE_EFFORT;
    };
    const from = s.target ? rel(s.target.from) : 0;
    const to = s.target ? rel(s.target.to) : 0;
    graph.push([s.duration, round(from, 3), round(to, 3)]);
    const whole = Math.max(1, Math.round(s.duration));
    for (let i = 0; i < whole; i++) {
      const raw = targetAt(s, ((i + 0.5) / whole) * s.duration);
      const f = raw === undefined ? FREE_EFFORT : rel(raw);
      sum4 += f ** 4;
      n++;
      if (f >= 0.999) above++;
    }
  }
  const duration = totalDuration(w);
  const intensity = n ? (sum4 / n) ** 0.25 : 0;
  const stress = (duration / 3600) * intensity * intensity * 100;
  return {
    duration, intensity: round(intensity, 2), stress: Math.round(stress),
    hard: intensity >= 0.83 || above >= 240, graph,
  };
}

function round(v: number, d: number): number {
  const k = 10 ** d;
  return Math.round(v * k) / k;
}

export interface ContentSources {
  /** path (relative to the site root) → parsed document. */
  chapters: Record<string, Chapter>;
  workouts: Record<string, WorkoutDoc>;
  plans: Record<string, PlanDoc>;
  maps: Record<string, MapDoc>;
  seasons: Record<string, SeasonDoc>;
  /** Reads a file relative to the folder of the document at `docPath`. */
  readFile?: (docPath: string, file: string) => string | Uint8Array;
  /** Paths (relative to the site root) of every image available, to check previews. */
  images?: string[];
}

export interface CatalogueResult {
  catalogue: Catalogue;
  /** Anything listed here should fail the build. */
  problems: string[];
}

function checkUnlock(rule: UnlockRule | undefined, path: string, ids: Record<string, Set<string>>, problems: string[], at = 'unlock'): void {
  if (!rule) return;
  switch (rule.type) {
    case 'chapterCompleted':
      if (!ids.chapter.has(rule.chapter)) problems.push(`${path}: ${at} refers to missing chapter "${rule.chapter}"`);
      break;
    case 'flag':
      if (!ids.season.has(rule.season)) problems.push(`${path}: ${at} refers to missing season "${rule.season}"`);
      break;
    case 'planWeek':
      if (rule.plan !== undefined && !ids.plan.has(rule.plan)) problems.push(`${path}: ${at} refers to missing plan "${rule.plan}"`);
      if (!(rule.week >= 1)) problems.push(`${path}: ${at} planWeek must be 1 or more`);
      break;
    case 'totalDistance':
      if (!(rule.km > 0)) problems.push(`${path}: ${at} totalDistance needs a positive km`);
      break;
    case 'totalTime':
      if (!(rule.hours > 0)) problems.push(`${path}: ${at} totalTime needs positive hours`);
      break;
    case 'all':
    case 'any':
      if (rule.rules.length === 0) problems.push(`${path}: ${at} "${rule.type}" needs at least one rule`);
      rule.rules.forEach((r, i) => checkUnlock(r, path, ids, problems, `${at}.${rule.type}[${i}]`));
      break;
    case 'always':
      break;
  }
}

/**
 * Build the catalogue: one index of everything, with the summary fields the
 * menus filter on. Also the place where cross-references are checked: a plan
 * pointing at a missing workout, a season listing a missing chapter, a
 * duplicate id. Deterministic: the same content gives the same bytes.
 */
export function buildCatalogue(src: ContentSources): CatalogueResult {
  const problems: string[] = [];
  const entries: CatalogueEntry[] = [];
  const ids: Record<string, Set<string>> = { chapter: new Set(), workout: new Set(), plan: new Set(), map: new Set(), season: new Set() };
  const claim = (type: string, id: string, path: string) => {
    if (ids[type].has(id)) problems.push(`${path}: duplicate ${type} id "${id}"`);
    ids[type].add(id);
  };
  const sorted = <T>(o: Record<string, T>): [string, T][] => Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const images = src.images ? new Set(src.images) : undefined;
  const checkImage = (image: string | undefined, path: string) => {
    if (image && images && !images.has(image)) problems.push(`${path}: image "${image}" not found`);
  };

  // Ids first, so references can point forwards.
  for (const [path, c] of sorted(src.chapters)) claim('chapter', c.id, path);
  for (const [path, w] of sorted(src.workouts)) claim('workout', w.id, path);
  for (const [path, p] of sorted(src.plans)) claim('plan', p.id, path);
  for (const [path, m] of sorted(src.maps)) claim('map', m.id, path);
  for (const [path, s] of sorted(src.seasons)) claim('season', s.id, path);

  // Seasons decide chapter order and unlocks.
  const chapterSeason = new Map<string, { season: string; unlock: UnlockRule }>();
  for (const [path, s] of sorted(src.seasons)) {
    s.chapters.forEach((c, i) => {
      if (!ids.chapter.has(c.id)) { problems.push(`${path}: chapter "${c.id}" not found`); return; }
      if (chapterSeason.has(c.id)) problems.push(`${path}: chapter "${c.id}" is already in season "${chapterSeason.get(c.id)?.season}"`);
      const unlock: UnlockRule = c.unlock ?? (i === 0 ? { type: 'always' } : { type: 'chapterCompleted', chapter: s.chapters[i - 1].id });
      checkUnlock(unlock, path, ids, problems, `chapters[${i}].unlock`);
      chapterSeason.set(c.id, { season: s.id, unlock });
    });
    checkUnlock(s.unlock, path, ids, problems);
    entries.push({
      type: 'season', id: s.id, title: s.title, path, description: s.description, number: s.number,
      chapters: s.chapters.map((c) => c.id), unlock: s.unlock,
    });
  }

  for (const [path, c] of sorted(src.chapters)) {
    const e: CatalogueEntry = { type: 'chapter', id: c.id, title: c.title, path, subtitle: c.subtitle, number: c.number, duration: c.duration };
    try {
      const w = loadChapterWorkout(c, src.readFile ? (f) => (src.readFile as NonNullable<ContentSources['readFile']>)(path, f) : undefined);
      const st = workoutStats(w);
      Object.assign(e, { sport: w.sport, intensity: st.intensity, stress: st.stress, hard: st.hard, graph: st.graph });
    } catch (err) {
      problems.push(`${path}: workout: ${(err as Error).message}`);
    }
    const first = c.stills?.find((s) => !s.insert) ?? c.stills?.[0];
    if (first && c.assets?.images) e.image = `${c.assets.images}/${first.image}.jpg`;
    const inSeason = chapterSeason.get(c.id);
    if (inSeason) { e.season = inSeason.season; e.unlock = inSeason.unlock; }
    entries.push(e);
  }

  for (const [path, d] of sorted(src.workouts)) {
    const e: CatalogueEntry = {
      type: 'workout', id: d.id, title: d.title, path, description: d.description, focus: d.focus, difficulty: d.difficulty, tags: d.tags,
    };
    if (d.steps && d.file) problems.push(`${path}: give either "steps" or "file", not both`);
    try {
      const w = loadWorkoutDoc(d, src.readFile ? (f) => (src.readFile as NonNullable<ContentSources['readFile']>)(path, f) : undefined);
      const st = workoutStats(w);
      Object.assign(e, { sport: w.sport, duration: st.duration, intensity: st.intensity, stress: st.stress, hard: st.hard, graph: st.graph });
    } catch (err) {
      problems.push(`${path}: ${(err as Error).message}`);
    }
    entries.push(e);
  }

  for (const [path, p] of sorted(src.plans)) {
    let sessions = 0;
    if (p.weeks.length === 0) problems.push(`${path}: a plan needs at least one week`);
    if (p.hoursPerWeek[0] > p.hoursPerWeek[1]) problems.push(`${path}: hoursPerWeek must be [low, high]`);
    if (p.season !== undefined && !ids.season.has(p.season)) problems.push(`${path}: season "${p.season}" not found`);
    p.weeks.forEach((w, wi) => {
      const seen = new Set<number>();
      w.days.forEach((d, di) => {
        const what = `${path} week ${wi + 1} day ${d.day}`;
        if (!(Number.isInteger(d.day) && d.day >= 1 && d.day <= 7)) problems.push(`${path} weeks[${wi}].days[${di}]: day must be 1 to 7`);
        if (seen.has(d.day)) problems.push(`${what}: listed twice`);
        seen.add(d.day);
        if (d.sessions.length === 0) problems.push(`${what}: has no sessions (leave rest days out)`);
        for (const s of d.sessions) {
          sessions++;
          for (const ref of [s.ref, ...(s.alternatives ?? [])]) {
            const r = parseRef(ref);
            if (!r) problems.push(`${what}: "${ref}" is not a valid reference (use workout:<id> or chapter:<id>)`);
            else if (!ids[r.type].has(r.id)) problems.push(`${what}: ${r.type} "${r.id}" not found`);
          }
        }
      });
    });
    checkUnlock(p.unlock, path, ids, problems);
    entries.push({
      type: 'plan', id: p.id, title: p.title, path, description: p.description, sport: p.sport, level: p.level, goal: p.goal,
      hoursPerWeek: p.hoursPerWeek, weeks: p.weeks.length, style: p.style, season: p.season, sessions, unlock: p.unlock,
    });
  }

  for (const [path, m] of sorted(src.maps)) {
    if (!(m.length > 0)) problems.push(`${path}: length must be positive`);
    if (m.profile.length === 0) problems.push(`${path}: profile needs at least one key`);
    let climb = 0;
    m.profile.forEach((k, i) => {
      if (i > 0 && k[0] <= m.profile[i - 1][0]) problems.push(`${path}: profile keys out of order at ${k[0]} m`);
      if (k[0] < 0 || k[0] > m.length) problems.push(`${path}: profile key at ${k[0]} m is outside the map`);
      if (Math.abs(k[1]) > 25) problems.push(`${path}: grade ${k[1]}% is beyond what a trainer can simulate`);
    });
    for (let d = 0; d < m.length; d += 10) climb += Math.max(0, gradeAt(m.profile, d + 5)) * 0.1;
    checkImage(m.image, path);
    checkUnlock(m.unlock, path, ids, problems);
    entries.push({
      type: 'map', id: m.id, title: m.title, path, description: m.description, scene: m.scene.id, length: m.length, climb: Math.round(climb),
      use: m.use, image: m.image, unlock: m.unlock,
    });
  }

  // Drop undefined fields so the JSON is tidy and stable.
  const clean = entries.map((e) => JSON.parse(JSON.stringify(e)) as CatalogueEntry);
  return { catalogue: { version: 1, entries: clean }, problems };
}

/** Grade in percent at a distance along a profile (linear between keys, flat beyond the ends). */
export function gradeAt(profile: [number, number][], distance: number): number {
  if (profile.length === 0) return 0;
  if (distance <= profile[0][0]) return profile[0][1];
  for (let i = 1; i < profile.length; i++) {
    if (distance <= profile[i][0]) {
      const [d0, g0] = profile[i - 1];
      const [d1, g1] = profile[i];
      return g0 + ((g1 - g0) * (distance - d0)) / (d1 - d0);
    }
  }
  return profile[profile.length - 1][1];
}
