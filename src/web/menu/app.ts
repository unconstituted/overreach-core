/**
 * The menu shell: loads the catalogue and the player, routes between screens
 * and launches rides. Screens are plain functions of this object. This is a
 * functional prototype of the flows; Unreal will rebuild the look.
 */
import type { Chapter } from '../../core/chapter';
import {
  chapterFromMap, chapterFromWorkout, findEntry, loadWorkoutDoc, type Catalogue, type CatalogueEntry, type MapDoc, type PlanDoc, type WorkoutDoc,
} from '../../core/content';
import { loadChapterWorkout } from '../../core/chapter';
import { handleMissed, type MissedChange } from '../../core/plan';
import { PlayerStore, type PlayerData, type RideRecord } from '../../core/player';
import { applyRide, hardFromCatalogue, isUnlocked, syncUnlocks, unlockContext, type RideOutcome } from '../../core/progress';
import { rideConfig } from '../../core/settings';
import type { IsoDate } from '../../core/util/date';
import type { Workout } from '../../core/workout';
import { DeviceManager } from '../../devices';
import { RideApp, type RideResult } from '../ride/app';
import { h } from './dom';
import { browserBackend } from './storage';

export type Screen = (app: MenuApp, params: string[]) => HTMLElement | Promise<HTMLElement>;

export interface MenuOptions {
  /** Pretend it is this date (tests, and trying out a plan's later weeks). */
  today?: IsoDate;
  /** Passed through to rides. */
  rate?: number;
  mute?: boolean;
  noWorld?: boolean;
}

const NAV: [string, string][] = [['home', 'Home'], ['season', 'Season'], ['plans', 'Plans'], ['workouts', 'Workouts'], ['maps', 'Maps'], ['profile', 'Profile'], ['settings', 'Settings']];

export class MenuApp {
  cat!: Catalogue;
  player!: PlayerData;
  store!: PlayerStore;
  readonly devices = new DeviceManager();
  /** Ride or run, as chosen on the screen before the session. */
  rideSport: 'bike' | 'run' = 'bike';
  /** The document of the active plan, kept loaded. */
  activePlan?: PlanDoc;
  /** What the last ride changed, for the post-ride screen. */
  last?: { outcome: RideOutcome; result: RideResult; entry?: CatalogueEntry };
  /** Sessions moved or dropped since the player last looked. */
  missedChanges: MissedChange[] = [];
  storageKind = '';
  notice = '';
  riding?: RideApp;
  private readonly docs = new Map<string, unknown>();
  private readonly main = h('main', { class: 'wrap', id: 'screen', tabindex: '-1' });
  private readonly nav = h('nav', { class: 'nav', 'aria-label': 'Main' });
  private readonly shell: HTMLElement;
  private readonly rideRoot = h('div', null);
  private cleanup?: () => void;
  private renderToken = 0;

  constructor(root: HTMLElement, private readonly screens: Record<string, Screen>, readonly opts: MenuOptions = {}) {
    this.shell = h('div', { class: 'menu' }, h('header', { class: 'top' }, h('a', { class: 'brand', href: '#/home' }, 'OVERREACH'), this.nav), this.main);
    root.append(this.shell, this.rideRoot);
  }

  /* ---------- time ---------- */

  today(): IsoDate {
    if (this.opts.today) return this.opts.today;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /* ---------- loading ---------- */

  async init(): Promise<void> {
    const res = await fetch('content/catalogue.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`The content catalogue could not be loaded (HTTP ${res.status}). Run "npm run catalogue".`);
    this.cat = (await res.json()) as Catalogue;
    const { backend, kind } = await browserBackend();
    this.storageKind = kind;
    this.store = new PlayerStore(backend);
    const loaded = await this.store.load();
    this.player = loaded.data;
    if (loaded.problem) this.notice = loaded.problem;
    await this.devices.useSimTrainer();
    await this.refreshPlan();
    // Record what is already unlocked without making a fuss about it.
    const synced = syncUnlocks(this.cat, unlockContext(this.player.progress, this.activePlan, this.today()), this.today());
    if (synced.unlocked.length) { this.player = { ...this.player, progress: synced.progress }; await this.save(); }
    addEventListener('hashchange', () => void this.render());
    if (!location.hash) location.replace('#/home');
    await this.render();
  }

  /** Fetch and cache a content document. */
  async doc<T>(entry: CatalogueEntry): Promise<T> {
    if (!this.docs.has(entry.path)) {
      const res = await fetch(entry.path, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${entry.path} could not be loaded (HTTP ${res.status})`);
      this.docs.set(entry.path, await res.json());
    }
    return this.docs.get(entry.path) as T;
  }

  /** Load the active plan's document and deal with any sessions missed since last time. */
  async refreshPlan(): Promise<void> {
    const ap = this.player.progress.activePlan;
    const entry = ap ? findEntry(this.cat, 'plan', ap.plan) : undefined;
    if (!ap || !entry) { this.activePlan = undefined; return; }
    this.activePlan = await this.doc<PlanDoc>(entry);
    const policy = this.player.settings['plan.missed'] === 'skip' ? 'skip' : 'push';
    const r = handleMissed(this.activePlan, ap, this.today(), policy, hardFromCatalogue(this.cat));
    if (r.changes.length) {
      this.missedChanges.push(...r.changes);
      this.player = { ...this.player, progress: { ...this.player.progress, activePlan: r.state } };
      await this.save();
    }
  }

  async save(): Promise<void> {
    try {
      await this.store.save(this.player);
    } catch (e) {
      this.notice = `Your progress could not be saved: ${(e as Error).message}`;
    }
  }

  /** Change the player and save. */
  async update(fn: (p: PlayerData) => PlayerData): Promise<void> {
    this.player = fn(this.player);
    await this.save();
  }

  unlocked(entry: CatalogueEntry): boolean {
    return isUnlocked(entry, unlockContext(this.player.progress, this.activePlan, this.today()));
  }

  get units(): string { return String(this.player.profile.units); }

  /* ---------- routing ---------- */

  go(hash: string): void {
    if (location.hash === hash) void this.render();
    else location.hash = hash;
  }

  async render(): Promise<void> {
    if (this.riding) return;
    const token = ++this.renderToken;
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const name = parts[0] in this.screens ? parts[0] : 'home';
    this.nav.replaceChildren(...NAV.map(([id, label]) => h('a', { href: `#/${id}`, 'aria-current': id === name ? 'page' : undefined }, label)));
    this.cleanup?.();
    this.cleanup = undefined;
    let el: HTMLElement;
    try {
      el = await this.screens[name](this, parts.slice(1));
    } catch (e) {
      console.error(e);
      el = h('div', { class: 'stack' }, h('h1', null, 'Something went wrong'), h('p', { class: 'error' }, (e as Error).message), h('p', null, h('a', { href: '#/home' }, 'Back to Home')));
    }
    if (token !== this.renderToken) return;
    this.main.replaceChildren(...(this.notice ? [h('p', { class: 'banner', role: 'status' }, this.notice)] : []), el);
    this.main.dataset.screen = name;
    document.title = `Overreach · ${NAV.find(([id]) => id === name)?.[1] ?? 'Ride'}`;
    scrollTo(0, 0);
  }

  /** A screen can register something to undo when it is left (listeners, device panels). */
  onLeave(fn: () => void): void {
    const prev = this.cleanup;
    this.cleanup = () => { prev?.(); fn(); };
  }

  /* ---------- riding ---------- */

  /** Everything needed to ride a "chapter:", "workout:" or "map:" reference. */
  async prepare(ref: string): Promise<{ entry: CatalogueEntry; chapter: Chapter; workout?: Workout; map?: MapDoc; assetBase: string; kind: RideRecord['kind'] }> {
    const [type, id] = ref.split(':');
    const entry = findEntry(this.cat, type as CatalogueEntry['type'], id);
    if (!entry) throw new Error(`"${ref}" is not in the catalogue`);
    const dir = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '.';
    const readFile = async (file: string): Promise<string | Uint8Array> => {
      const res = await fetch(`${dir}/${file}`);
      if (!res.ok) throw new Error(`${file} could not be loaded`);
      return /\.zwo$/i.test(file) ? res.text() : new Uint8Array(await res.arrayBuffer());
    };
    if (type === 'chapter') {
      const chapter = await this.doc<Chapter>(entry);
      let workout: Workout | undefined;
      if ('file' in chapter.workout) { const data = await readFile(chapter.workout.file); workout = loadChapterWorkout(chapter, () => data); }
      return { entry, chapter, workout, assetBase: dir, kind: 'chapter' };
    }
    if (type === 'workout') {
      const doc = await this.doc<WorkoutDoc>(entry);
      const data = doc.file ? await readFile(doc.file) : undefined;
      const workout = loadWorkoutDoc(doc, data === undefined ? undefined : () => data);
      const chapter = chapterFromWorkout(`workout-${id}`, doc.title, workout, Number(this.player.profile.ftp));
      return { entry, chapter, workout, assetBase: '.', kind: 'workout' };
    }
    if (type === 'map') {
      const map = await this.doc<MapDoc>(entry);
      return { entry, chapter: chapterFromMap(map), map, assetBase: '.', kind: 'freeRide' };
    }
    throw new Error(`"${ref}" cannot be ridden`);
  }

  async startRide(ref: string): Promise<void> {
    const p = await this.prepare(ref);
    const season = p.entry.season;
    this.shell.hidden = true;
    this.cleanup?.();
    this.cleanup = undefined;
    const ride = new RideApp(this.rideRoot, {
      chapter: p.chapter.id, rate: this.opts.rate, mute: this.opts.mute, noWorld: this.opts.noWorld,
      session: {
        chapter: p.chapter, workout: p.workout, assetBase: p.assetBase, map: p.map, devices: this.devices,
        sport: p.entry.sport === 'run' ? 'run' : this.rideSport,
        config: rideConfig(this.player.profile, this.player.settings),
        initialFlags: season ? this.player.progress.flags[season] : undefined,
        onFinish: (result) => void this.finishRide(ref, p.entry, p.kind, result),
      },
    });
    this.riding = ride;
    try {
      await ride.init();
    } catch (e) {
      ride.dispose();
      this.riding = undefined;
      this.shell.hidden = false;
      this.notice = `The ride could not start: ${(e as Error).message}`;
      await this.render();
    }
  }

  private async finishRide(ref: string, entry: CatalogueEntry, kind: RideRecord['kind'], result: RideResult): Promise<void> {
    this.riding = undefined;
    this.shell.hidden = false;
    const sm = result.summary;
    if (!sm || sm.duration < 60) {
      this.notice = 'That ride was under a minute, so it was not recorded.';
      this.go('#/home');
      setTimeout(() => { this.notice = ''; }, 0);
      return;
    }
    const start = new Date(result.startTime * 1000);
    const p2 = (n: number) => String(n).padStart(2, '0');
    const record: RideRecord = {
      id: `ride-${Math.round(result.startTime)}`,
      date: `${this.today()}T${p2(start.getHours())}:${p2(start.getMinutes())}`,
      sport: result.sport, kind, ref, title: entry.title, complete: result.complete, ftp: Number(this.player.profile.ftp),
      duration: sm.duration, distance: Math.round(sm.distance), kilojoules: Math.round(sm.kilojoules), avgPower: Math.round(sm.avgPower),
      normalisedPower: Math.round(sm.normalisedPower), intensity: Math.round(sm.intensityFactor * 100) / 100, stress: Math.round(sm.trainingStress),
      avgHeartRate: sm.avgHeartRate ? Math.round(sm.avgHeartRate) : undefined, maxHeartRate: sm.maxHeartRate ? Math.round(sm.maxHeartRate) : undefined,
      hasFit: false,
    };
    if (result.fit) {
      try { await this.store.putFit(record.id, result.fit); record.hasFit = true; } catch { /* the ride still counts without its file */ }
    }
    const applied = applyRide(this.player, this.cat, record, this.today(), { plan: this.activePlan, flags: kind === 'chapter' ? result.flags : undefined });
    this.player = applied.data;
    await this.save();
    await this.refreshPlan();
    this.last = { outcome: applied.outcome, result, entry };
    this.go('#/done');
  }
}
