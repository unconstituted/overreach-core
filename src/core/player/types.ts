import type { SessionRef, Sport } from '../content';
import type { SettingValue } from '../settings';
import type { IsoDate } from '../util/date';

/**
 * Player state: everything that belongs to the player rather than the game.
 * Kept strictly apart from content, and saved as one versioned document.
 */
export const PLAYER_VERSION = 3;

export interface PlanState {
  plan: string;
  startDate: IsoDate;
  /** ISO weekdays (1 = Monday) the player trains on, if they chose. */
  trainingDays?: number[];
  /** Session key → the ride that completed it. */
  completed: Record<string, { ride: string; date: IsoDate }>;
  /** Sessions dropped (missed and not pushed, or skipped by choice). */
  skipped: Record<string, IsoDate>;
  /** Sessions moved off their planned date. */
  moved: Record<string, IsoDate>;
  /** Sessions where the player chose one of the alternatives. */
  swaps: Record<string, SessionRef>;
  /** Set while the plan is paused; resuming shifts the plan by the days paused. */
  pausedOn?: IsoDate;
}

export interface RideRecord {
  id: string;
  /** Start of the ride, ISO date-time in local time ("2026-11-17T18:05"). */
  date: string;
  sport: Sport;
  kind: 'chapter' | 'workout' | 'freeRide';
  /** "chapter:<id>", "workout:<id>" or "map:<id>". */
  ref?: string;
  title: string;
  /** Rode to the end. */
  complete: boolean;
  /** The FTP the ride was scaled to. Kept so history survives later FTP changes. */
  ftp: number;
  /** Seconds. */
  duration: number;
  /** Metres (from the bike model, not the game). */
  distance: number;
  kilojoules: number;
  avgPower: number;
  normalisedPower: number;
  intensity: number;
  stress: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  /** Whether the .fit bytes are in the store. */
  hasFit: boolean;
  /** The plan session this ride counted for. */
  session?: { plan: string; key: string };
}

export interface Progress {
  activePlan?: PlanState;
  pastPlans: { plan: string; startDate: IsoDate; endedOn: IsoDate; completed: number; finished: boolean }[];
  chapters: Record<string, { completedOn: IsoDate; count: number }>;
  /** Story flags, per season. */
  flags: Record<string, Record<string, boolean>>;
  /** "type:id" → date first unlocked. */
  unlocked: Record<string, IsoDate>;
  totals: { rides: number; time: number; distance: number; kilojoules: number };
}

export interface PlayerData {
  version: number;
  profile: Record<string, SettingValue>;
  settings: Record<string, SettingValue>;
  progress: Progress;
  /** Newest first. */
  history: RideRecord[];
}

/** A whole player in one file: the data plus every ride's .fit as base64. */
export interface PlayerExport {
  app: 'overreach';
  version: number;
  exportedOn?: string;
  data: PlayerData;
  fits: Record<string, string>;
}
