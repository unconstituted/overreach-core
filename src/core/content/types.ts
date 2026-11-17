import type { StepSpec } from '../workout';

/**
 * Content: what the game ships with, apart from chapters. Every type is a
 * JSON file in `content/` with a schema in `schemas/`. Adding content never
 * needs code. Player state lives elsewhere (`src/core/player`).
 */

export type Sport = 'bike' | 'run';

/** A reference to something rideable: "workout:<id>" or "chapter:<id>". */
export type SessionRef = string;

/**
 * When something becomes available. A small fixed vocabulary, on purpose:
 * rules are data, not scripts.
 */
export type UnlockRule =
  | { type: 'always' }
  | { type: 'chapterCompleted'; chapter: string }
  /** A story flag in a season has the given value (true unless stated). */
  | { type: 'flag'; season: string; flag: string; value?: boolean }
  /** Total distance ridden, kilometres. */
  | { type: 'totalDistance'; km: number }
  /** Total time ridden, hours. */
  | { type: 'totalTime'; hours: number }
  /** The player has reached this week (1-based) of a plan: the named one, or any. */
  | { type: 'planWeek'; week: number; plan?: string }
  | { type: 'all'; rules: UnlockRule[] }
  | { type: 'any'; rules: UnlockRule[] };

export type Focus = 'recovery' | 'endurance' | 'tempo' | 'sweetspot' | 'threshold' | 'vo2' | 'anaerobic' | 'sprint' | 'mixed' | 'test';

export interface WorkoutDoc {
  format: 1;
  id: string;
  title: string;
  description?: string;
  sport?: Sport;
  focus: Focus;
  /** 1 (very easy) to 5 (very hard). */
  difficulty: number;
  tags?: string[];
  /** Inline steps ... */
  steps?: StepSpec[];
  /** ... or a .zwo or .fit file next to this one. */
  file?: string;
}

export interface PlanSession {
  ref: SessionRef;
  /** Optional sessions are never rescheduled and do not hold the plan up. */
  optional?: boolean;
  /** Swaps the player may choose instead (shorter or easier). */
  alternatives?: SessionRef[];
  note?: string;
}

export interface PlanDay {
  /** Day of the plan week, 1 to 7. Day 1 is the day the plan starts. */
  day: number;
  sessions: PlanSession[];
}

export interface PlanWeek {
  title?: string;
  focus?: string;
  days: PlanDay[];
}

export interface PlanDoc {
  format: 1;
  id: string;
  title: string;
  description: string;
  sport: Sport;
  level: 'beginner' | 'intermediate' | 'advanced';
  goal: string;
  /** Typical weekly hours, [low, high]. */
  hoursPerWeek: [number, number];
  /** "calendar": a training block. "story": built around a season's chapters. */
  style: 'calendar' | 'story';
  /** For story plans: the season it follows. */
  season?: string;
  unlock?: UnlockRule;
  weeks: PlanWeek[];
}

export interface MapDoc {
  format: 1;
  id: string;
  title: string;
  description: string;
  /** What the map can be used for. */
  use: ('freeRide' | 'chapter')[];
  /** Length in metres (of real road, by the bike model). */
  length: number;
  /** Terrain: [distance in metres, grade in percent] keys, in distance order. */
  profile: [number, number][];
  /** Preview image, relative to the site root. */
  image?: string;
  scene: {
    /** Scene kit id, e.g. "ice", "space", "orbit". */
    id: string;
    /** How many metres of scenery pass per metre of road. Default 12. */
    speedScale?: number;
    camera?: string;
    env?: Record<string, number | number[]>;
    streaks?: Record<string, number | number[]>;
    /** Field of view at rest and at full speed, degrees. */
    fov?: [number, number];
  };
  unlock?: UnlockRule;
}

export interface SeasonDoc {
  format: 1;
  id: string;
  title: string;
  number?: number;
  description: string;
  chapters: {
    id: string;
    /** Defaults to "always" for the first chapter and "previous chapter completed" for the rest. */
    unlock?: UnlockRule;
  }[];
  /** Story flags carried from chapter to chapter within the season. */
  flags?: string[];
  unlock?: UnlockRule;
}

export type ContentType = 'chapter' | 'workout' | 'plan' | 'map' | 'season';

/** [duration s, from, to] as fractions of threshold; 0 for free ride. */
export type GraphBar = [number, number, number];

export interface CatalogueEntry {
  type: ContentType;
  id: string;
  title: string;
  /** File path relative to the site root. */
  path: string;
  description?: string;
  sport?: Sport;
  unlock?: UnlockRule;
  image?: string;

  /* workouts and chapters */
  /** Seconds. */
  duration?: number;
  /** Estimated intensity factor. */
  intensity?: number;
  /** Estimated training stress. */
  stress?: number;
  /** A hard day: do not put two of these back to back. */
  hard?: boolean;
  graph?: GraphBar[];
  focus?: Focus;
  difficulty?: number;
  tags?: string[];

  /* chapters */
  subtitle?: string;
  season?: string;
  number?: number;

  /* plans */
  level?: PlanDoc['level'];
  goal?: string;
  hoursPerWeek?: [number, number];
  weeks?: number;
  style?: PlanDoc['style'];
  sessions?: number;

  /* maps */
  scene?: string;
  /** Metres. */
  length?: number;
  /** Total climbing, metres. */
  climb?: number;
  use?: MapDoc['use'];

  /* seasons */
  chapters?: string[];
}

export interface Catalogue {
  version: 1;
  entries: CatalogueEntry[];
}

export function parseRef(ref: SessionRef): { type: 'workout' | 'chapter'; id: string } | undefined {
  const m = /^(workout|chapter):([a-z0-9][a-z0-9-]*)$/.exec(ref);
  return m ? { type: m[1] as 'workout' | 'chapter', id: m[2] } : undefined;
}

export function findEntry(cat: Catalogue, type: ContentType, id: string): CatalogueEntry | undefined {
  return cat.entries.find((e) => e.type === type && e.id === id);
}

export function findRef(cat: Catalogue, ref: SessionRef): CatalogueEntry | undefined {
  const r = parseRef(ref);
  return r ? findEntry(cat, r.type, r.id) : undefined;
}

export function entriesOf(cat: Catalogue, type: ContentType): CatalogueEntry[] {
  return cat.entries.filter((e) => e.type === type);
}
