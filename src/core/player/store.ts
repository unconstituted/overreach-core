import { sanitise, setValue } from '../settings';
import { fromBase64, toBase64 } from '../util/base64';
import { PLAYER_VERSION, type PlayerData, type PlayerExport, type Progress, type RideRecord } from './types';

/**
 * Where bytes actually go. The browser adapter (IndexedDB, or localStorage as
 * a fallback) lives in src/web; tests and tools use `MemoryBackend`.
 */
export interface StorageBackend {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export class MemoryBackend implements StorageBackend {
  readonly map = new Map<string, string>();
  async get(key: string): Promise<string | undefined> { return this.map.get(key); }
  async set(key: string, value: string): Promise<void> { this.map.set(key, value); }
  async delete(key: string): Promise<void> { this.map.delete(key); }
  async keys(): Promise<string[]> { return [...this.map.keys()]; }
}

export function emptyProgress(): Progress {
  return { pastPlans: [], chapters: {}, flags: {}, unlocked: {}, totals: { rides: 0, time: 0, distance: 0, kilojoules: 0 } };
}

export function newPlayer(): PlayerData {
  return { version: PLAYER_VERSION, profile: sanitise('profile', undefined), settings: sanitise('settings', undefined), progress: emptyProgress(), history: [] };
}

export class PlayerDataError extends Error {}

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Migrations, oldest first. Each takes the document at version N and returns
 * it at N + 1. Never edit a shipped migration: add a new one.
 */
const MIGRATIONS: Record<number, (d: Loose) => Loose> = {
  // v1 was the Stage 5 start-screen settings: { ftp, maxHr, feel, hudPos } and nothing else.
  1: (d) => ({
    version: 2,
    profile: { ftp: d.ftp, maxHr: d.maxHr },
    settings: { feel: d.feel, hudPos: d.hudPos },
    history: [],
  }),
  // v2 kept two settings under short names and had no progress. v3 uses the settings table's keys.
  2: (d) => {
    const old = isObj(d.settings) ? d.settings : {};
    let settings: Record<string, unknown> = sanitise('settings', undefined);
    if (typeof old.feel === 'string') settings = setValue(settings as never, 'feel.preset', old.feel);
    if (old.hudPos === 'bot' || old.hudPos === 'top') settings['hud.position'] = old.hudPos;
    return { ...d, version: 3, settings, progress: emptyProgress() };
  },
};

/**
 * Bring any saved document up to the current version and make it safe to use:
 * unknown settings dropped, out-of-range values coerced, missing parts filled.
 */
export function migrate(input: unknown): PlayerData {
  if (!isObj(input)) throw new PlayerDataError('Saved data is not an object');
  let d: Loose = input;
  // A document with no version but an FTP is the Stage 5 shape.
  let version = typeof d.version === 'number' ? d.version : 'ftp' in d ? 1 : NaN;
  if (!Number.isInteger(version) || version < 1) throw new PlayerDataError('Saved data has no recognisable version');
  if (version > PLAYER_VERSION) throw new PlayerDataError(`Saved data is from a newer version of the game (${version}); this one understands up to ${PLAYER_VERSION}`);
  while (version < PLAYER_VERSION) {
    d = MIGRATIONS[version](d);
    version++;
  }
  const p = isObj(d.progress) ? d.progress : {};
  const base = emptyProgress();
  const totals = isObj(p.totals) ? p.totals : {};
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const progress: Progress = {
    activePlan: isObj(p.activePlan) && typeof p.activePlan.plan === 'string' && typeof p.activePlan.startDate === 'string'
      ? {
        plan: p.activePlan.plan, startDate: p.activePlan.startDate,
        trainingDays: Array.isArray(p.activePlan.trainingDays) ? (p.activePlan.trainingDays as number[]).filter((n) => n >= 1 && n <= 7) : undefined,
        completed: (isObj(p.activePlan.completed) ? p.activePlan.completed : {}) as never,
        skipped: (isObj(p.activePlan.skipped) ? p.activePlan.skipped : {}) as never,
        moved: (isObj(p.activePlan.moved) ? p.activePlan.moved : {}) as never,
        swaps: (isObj(p.activePlan.swaps) ? p.activePlan.swaps : {}) as never,
        pausedOn: typeof p.activePlan.pausedOn === 'string' ? p.activePlan.pausedOn : undefined,
      }
      : undefined,
    pastPlans: Array.isArray(p.pastPlans) ? (p.pastPlans as Progress['pastPlans']) : base.pastPlans,
    chapters: (isObj(p.chapters) ? p.chapters : {}) as Progress['chapters'],
    flags: (isObj(p.flags) ? p.flags : {}) as Progress['flags'],
    unlocked: (isObj(p.unlocked) ? p.unlocked : {}) as Progress['unlocked'],
    totals: { rides: num(totals.rides), time: num(totals.time), distance: num(totals.distance), kilojoules: num(totals.kilojoules) },
  };
  const history = (Array.isArray(d.history) ? d.history : []).filter((r): r is RideRecord => isObj(r) && typeof r.id === 'string' && typeof r.date === 'string');
  return {
    version: PLAYER_VERSION,
    profile: sanitise('profile', isObj(d.profile) ? d.profile : undefined),
    settings: sanitise('settings', isObj(d.settings) ? d.settings : undefined),
    progress, history,
  };
}

const DATA_KEY = 'player';
const FIT_PREFIX = 'fit:';

/**
 * Load, save, export and import the player. Ride files are stored one per
 * key beside the main document so saving after a settings change stays cheap.
 */
export class PlayerStore {
  constructor(private readonly backend: StorageBackend) {}

  /** The saved player, migrated to the current version; a new player if there is none or it is unreadable. */
  async load(): Promise<{ data: PlayerData; fresh: boolean; problem?: string }> {
    let raw: string | undefined;
    try {
      raw = await this.backend.get(DATA_KEY);
    } catch (e) {
      return { data: newPlayer(), fresh: true, problem: `Storage is unavailable: ${(e as Error).message}` };
    }
    if (raw === undefined) return { data: newPlayer(), fresh: true };
    try {
      return { data: migrate(JSON.parse(raw)), fresh: false };
    } catch (e) {
      // Keep the unreadable copy rather than silently overwriting someone's history.
      try { await this.backend.set(`${DATA_KEY}.unreadable`, raw); } catch { /* best effort */ }
      return { data: newPlayer(), fresh: true, problem: `Saved data could not be read (${(e as Error).message}). A copy was kept and a new profile started.` };
    }
  }

  async save(data: PlayerData): Promise<void> {
    await this.backend.set(DATA_KEY, JSON.stringify({ ...data, version: PLAYER_VERSION }));
  }

  async putFit(rideId: string, bytes: Uint8Array): Promise<void> {
    await this.backend.set(FIT_PREFIX + rideId, toBase64(bytes));
  }

  async getFit(rideId: string): Promise<Uint8Array | undefined> {
    const b64 = await this.backend.get(FIT_PREFIX + rideId);
    return b64 === undefined ? undefined : fromBase64(b64);
  }

  /** Everything in one JSON document. `exportedOn` is stamped by the caller (the core has no clock). */
  async exportAll(data: PlayerData, exportedOn?: string): Promise<string> {
    const fits: Record<string, string> = {};
    for (const r of data.history) {
      if (!r.hasFit) continue;
      const b64 = await this.backend.get(FIT_PREFIX + r.id);
      if (b64 !== undefined) fits[r.id] = b64;
    }
    const doc: PlayerExport = { app: 'overreach', version: PLAYER_VERSION, exportedOn, data: { ...data, version: PLAYER_VERSION }, fits };
    return JSON.stringify(doc);
  }

  /** Replace the saved player with an exported one (of this or an older version). Returns the loaded data. */
  async importAll(json: string): Promise<PlayerData> {
    let doc: unknown;
    try {
      doc = JSON.parse(json);
    } catch {
      throw new PlayerDataError('That file is not valid JSON');
    }
    if (!isObj(doc) || doc.app !== 'overreach' || !isObj(doc.data)) throw new PlayerDataError('That file is not an Overreach export');
    const data = migrate(doc.data);
    const fits = isObj(doc.fits) ? doc.fits : {};
    for (const key of await this.backend.keys()) if (key.startsWith(FIT_PREFIX)) await this.backend.delete(key);
    for (const r of data.history) {
      const b64 = fits[r.id];
      r.hasFit = typeof b64 === 'string';
      if (typeof b64 === 'string') await this.backend.set(FIT_PREFIX + r.id, b64);
    }
    await this.save(data);
    return data;
  }

  /** Remove everything. */
  async clear(): Promise<void> {
    for (const key of await this.backend.keys()) await this.backend.delete(key);
  }
}
