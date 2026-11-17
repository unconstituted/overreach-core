/**
 * The ride: start screen, the frame loop that ties devices, chapter runtime,
 * feel layer, world, audio and recording together, and the end screen.
 *
 * Two clocks run here. Story time `T` advances with the wall clock whatever
 * the rider does, so dialogue, music and the workout stay in step. The rider's
 * effort changes what they see and hear on top of that: the speed read-out,
 * streaks, engine and wind all scale with `feel.speedFactor`. Stop pedalling
 * and the ship visibly sags, but the chapter does not wait.
 */
import { checkChapter, ChapterRuntime, loadChapterWorkout, type Chapter, type ChapterEvent, type ChapterState } from '../../core/chapter';
import { FreeRide, type MapDoc } from '../../core/content';
import { FEEL_PRESETS, FeelEngine, type FeelEvent, type FeelPresetName } from '../../core/feel';
import { encodeFitActivity, POWER_ZONE_NAMES, RideRecorder, summarise, type RideSummary } from '../../core/record';
import { defaultValues, rideConfig, setValue, type RideConfig } from '../../core/settings';
import { clamp } from '../../core/util/math';
import { ENGINE_NAME, ENGINE_VERSION } from '../../core/version';
import { asRun, effortToPace, formatPace, runEffort, workoutKind, type Workout } from '../../core/workout';
import { DeviceManager, type DeviceSport } from '../../devices';
import { mountDevicePanel } from '../devicePanel';
import { RideAudio } from './audio';
import { fmtClock, Stage, zoneColour } from './stage';
import { World } from './world';

/** What a finished ride hands back to whoever launched it. */
export interface RideResult {
  /** Rode to the end (of the chapter, workout or map). */
  complete: boolean;
  /** Unix seconds. */
  startTime: number;
  summary?: RideSummary;
  fit?: Uint8Array;
  /** Story flags at the end of a chapter. */
  flags: Record<string, boolean>;
  simulated: boolean;
  sport: DeviceSport;
}

/** A ride launched from the menus: everything is handed in, and the result is handed back. */
export interface RideSession {
  chapter: Chapter;
  /** Parsed workout, when the chapter refers to a workout file. */
  workout?: Workout;
  /** Folder the chapter's clips and images are relative to. */
  assetBase: string;
  config: RideConfig;
  devices: DeviceManager;
  initialFlags?: Record<string, boolean>;
  /** Present for a free ride: the map to ride. */
  map?: MapDoc;
  /** Ride or run. A cycling workout run as a run is converted with `asRun` at the same effort. */
  sport?: DeviceSport;
  onFinish(result: RideResult): void;
}

export interface RideOptions {
  /** Chapter id: loads `<id>.chapter.json` from the chapters folder. Ignored when `session` is given. */
  chapter: string;
  /** Start time in seconds (for testing a scene). */
  startAt?: number;
  /** Skip the start screen and ride with the simulated rider. */
  auto?: boolean;
  /** Time multiplier for soak tests. Sound events are skipped above 1. */
  rate?: number;
  mute?: boolean;
  /** Skip the 3D view (for tests on machines without WebGL). */
  noWorld?: boolean;
  /** Ride or run, when opened directly. */
  sport?: DeviceSport;
  session?: RideSession;
}

interface Settings { ftp: number; maxHr: number; feel: FeelPresetName; hudPos: 'top' | 'bot' }

const SETTINGS_KEY = 'overreach.settings';
function loadSettings(): Settings {
  const d: Settings = { ftp: 250, maxHr: 185, feel: 'standard', hudPos: 'top' };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) Object.assign(d, JSON.parse(raw));
  } catch { /* storage may be unavailable; defaults are fine */ }
  d.ftp = clamp(Math.round(Number(d.ftp)) || 250, 60, 600);
  d.maxHr = clamp(Math.round(Number(d.maxHr)) || 185, 100, 230);
  if (!(d.feel in FEEL_PRESETS)) d.feel = 'standard';
  if (d.hudPos !== 'bot') d.hudPos = 'top';
  return d;
}
function saveSettings(s: Settings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
function configFrom(s: Settings): RideConfig {
  let v = setValue(defaultValues('settings'), 'feel.preset', s.feel);
  v = setValue(v, 'hud.position', s.hudPos);
  return rideConfig({ ftp: s.ftp, maxHr: s.maxHr }, v);
}

const FEEL_LABEL: Record<FeelPresetName, string> = { off: 'Off', restrained: 'Restrained', standard: 'Standard', aggressive: 'Aggressive' };
const FEEL_ORDER: FeelPresetName[] = ['off', 'restrained', 'standard', 'aggressive'];

export class RideApp {
  readonly devices: DeviceManager;
  /** Start-screen settings, used only when the ride is opened directly (not from the menus). */
  settings: Settings;
  cfg: RideConfig;
  chapter!: Chapter;
  freeRide?: FreeRide;
  rt!: ChapterRuntime;
  feel!: FeelEngine;
  recorder!: RideRecorder;
  stage?: Stage;
  world?: World;
  audio?: RideAudio;
  /** Story time, seconds. */
  T = 0;
  /** Seconds actually ridden (the recording clock). */
  rideClock = 0;
  playing = false;
  started = false;
  finished = false;
  state?: ChapterState;
  /** Errors caught in the frame loop, for tests. */
  readonly errors: string[] = [];
  private rate: number;
  private lastNow = 0;
  private raf = 0;
  private cameraOverride: string | null = null;
  private showInserts = true;
  private flash?: { title: string; text: string; tone?: 'alert' | 'danger'; until: number };
  private idleTimer = 0;
  private effortScale = 1;
  private pedalling = true;
  /** Ride or run. */
  sport: DeviceSport = 'bike';
  private unsubStopped?: () => void;
  private lastFit?: Uint8Array;
  private complete = false;
  private summary?: RideSummary;
  private chapterBase = '.';
  private readonly session?: RideSession;
  private startTime = 0;
  private disposed = false;
  private readonly onVisible = (): void => { this.lastNow = performance.now(); };

  constructor(private readonly root: HTMLElement, private readonly opts: RideOptions) {
    this.settings = loadSettings();
    this.session = opts.session;
    if (!this.session) this.feelName = this.settings.feel;
    this.cfg = this.session?.config ?? configFrom(this.settings);
    this.devices = this.session?.devices ?? new DeviceManager({ ftp: this.cfg.ftp });
    this.sport = this.session?.sport ?? opts.sport ?? (this.session ? this.cfg.sport : 'bike');
    if (this.session) this.chapterBase = this.session.assetBase;
    this.showInserts = this.cfg.storyboard;
    this.cameraOverride = this.cfg.camera === 'auto' ? null : this.cfg.camera;
    this.rate = Math.max(0.1, opts.rate ?? 1);
  }

  /* ------------------------------------------------------------------ */
  /* Loading                                                             */
  /* ------------------------------------------------------------------ */

  async init(): Promise<void> {
    if (this.session) {
      this.chapter = this.session.chapter;
      await this.ensureDevices();
      await this.start();
      return;
    }
    const res = await fetch(`${this.chapterBase}/${this.opts.chapter}.chapter.json`);
    if (!res.ok) throw new Error(`Chapter "${this.opts.chapter}" not found (HTTP ${res.status})`);
    this.chapter = (await res.json()) as Chapter;
    const problems = checkChapter(this.chapter);
    if (problems.length) console.warn(`Chapter "${this.chapter.id}" has problems:\n  ${problems.join('\n  ')}`);
    await this.ensureDevices();
    if (this.opts.auto) await this.start();
    else this.showStart();
  }

  /** Make sure there is something to ride (or run) with: the simulated twin unless a device is connected. */
  private async ensureDevices(): Promise<void> {
    if (this.sport === 'run') {
      if (this.devices.sport !== 'run' || (!this.devices.belt && !this.devices.pod)) await this.devices.useSimTreadmill();
    } else if (this.devices.sport !== 'bike' || !this.devices.power) await this.devices.useSimTrainer();
  }

  private async buildRuntime(): Promise<void> {
    const ch = this.chapter;
    let workout = this.session?.workout;
    if (!workout && 'file' in ch.workout) {
      const path = ch.workout.file;
      const res = await fetch(`${this.chapterBase}/${path}`);
      if (!res.ok) throw new Error(`Workout file ${path} not found`);
      const data = /\.zwo$/i.test(path) ? await res.text() : new Uint8Array(await res.arrayBuffer());
      workout = loadChapterWorkout(ch, () => data);
    }
    workout ??= loadChapterWorkout(ch);
    // A pace workout can only be run; a power workout can be run at the same effort.
    if (workoutKind(workout) === 'pace') this.sport = 'run';
    if (this.sport === 'run' && workoutKind(workout) === 'power') workout = asRun(workout);
    this.rt = new ChapterRuntime(ch, {
      ftp: this.cfg.ftp, maxHr: this.cfg.maxHr, thresholdSpeed: this.cfg.thresholdSpeed, workout, initialFlags: this.session?.initialFlags,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Start screen                                                        */
  /* ------------------------------------------------------------------ */

  private showStart(): void {
    const ch = this.chapter; const s = this.settings;
    const first = ch.stills?.find((x) => !x.insert) ?? ch.stills?.[0];
    const el = document.createElement('div');
    el.className = 'screen';
    if (first && ch.assets?.images) el.style.setProperty('--backdrop', `url("${this.chapterBase}/${ch.assets.images}/${first.image}.jpg")`);
    el.innerHTML = `<div class="inner">
      <div class="kicker">${ch.subtitle ?? 'Overreach'}</div>
      <div><h1>${ch.title}</h1></div>
      <p class="dim">${Math.round(ch.duration / 60)} minutes. The story keeps its pace; your legs decide how fast the ship looks and feels.</p>
      <div class="panel">
        <h2>Rider</h2>
        <div class="fields">
          <label>FTP (watts)<input id="s-ftp" type="number" min="60" max="600" step="5" value="${s.ftp}"></label>
          <label>Max heart rate (bpm)<input id="s-hr" type="number" min="100" max="230" value="${s.maxHr}"></label>
          <label>Feel<select id="s-feel">${FEEL_ORDER.map((k) => `<option value="${k}"${k === s.feel ? ' selected' : ''}>${FEEL_LABEL[k]}</option>`).join('')}</select></label>
          <label>HUD position<select id="s-pos"><option value="top"${s.hudPos === 'top' ? ' selected' : ''}>Top of visor</option><option value="bot"${s.hudPos === 'bot' ? ' selected' : ''}>Bottom of visor</option></select></label>
        </div>
        <p class="small dim">Feel is the stroke-by-stroke response of the HUD and the ship: off shows plain numbers; aggressive hits hardest.</p>
      </div>
      <div class="panel" id="s-dev"></div>
      <button class="primary go" id="s-go">Start ride</button>
      <p class="small dim"><kbd>Space</kbd> pause · <kbd>←</kbd> <kbd>→</kbd> skip 10 s · <kbd>J</kbd> jump to a scene · <kbd>C</kbd> camera · <kbd>H</kbd> HUD top or bottom · <kbd>F</kbd> full screen · <kbd>M</kbd> sound · <kbd>P</kbd> stop pedalling (simulated rider) · ${ENGINE_NAME} ${ENGINE_VERSION}</p>
    </div>`;
    document.body.appendChild(el);
    const unmount = mountDevicePanel(el.querySelector('#s-dev') as HTMLElement, this.devices, {
      onSport: (sp) => { this.sport = sp; },
    });
    const go = el.querySelector('#s-go') as HTMLButtonElement;
    go.onclick = async () => {
      if (go.disabled) return;
      go.disabled = true;
      s.ftp = clamp(parseInt((el.querySelector('#s-ftp') as HTMLInputElement).value, 10) || 250, 60, 600);
      s.maxHr = clamp(parseInt((el.querySelector('#s-hr') as HTMLInputElement).value, 10) || 185, 100, 230);
      s.feel = (el.querySelector('#s-feel') as HTMLSelectElement).value as FeelPresetName;
      s.hudPos = (el.querySelector('#s-pos') as HTMLSelectElement).value as 'top' | 'bot';
      saveSettings(s);
      this.cfg = configFrom(s);
      try {
        await this.start((p) => { go.textContent = `Loading sound ${Math.round(p * 100)}%`; });
        unmount();
        el.remove();
      } catch (e) {
        go.disabled = false;
        go.textContent = 'Start ride';
        console.error(e);
        this.fail(e);
      }
    };
  }

  private fail(e: unknown): void {
    const msg = e instanceof Error ? e.message : String(e);
    this.errors.push(msg);
    let box = document.getElementById('fatal');
    if (!box) { box = document.createElement('p'); box.id = 'fatal'; box.className = 'error'; box.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:50;background:#200;padding:10px 14px;border-radius:4px;max-width:80vw'; document.body.appendChild(box); }
    box.textContent = msg;
  }

  /* ------------------------------------------------------------------ */
  /* Ride                                                                */
  /* ------------------------------------------------------------------ */

  async start(progress?: (fraction: number) => void): Promise<void> {
    const cfg = this.cfg;
    await this.buildRuntime();
    // The simulated athlete needs to know the thresholds the workout is scaled to.
    this.devices.setSimOptions({ ftp: cfg.ftp, maxHr: cfg.maxHr, thresholdSpeed: cfg.thresholdSpeed });
    if (this.sport === 'run') {
      if (this.devices.sport !== 'run' || this.devices.belt?.info.kind === 'sim' || (!this.devices.belt && !this.devices.pod)) {
        await this.devices.useSimTreadmill();
      }
      this.devices.treadmillControl = cfg.treadmillControl;
      this.devices.treadmillLimits.maxSpeed = cfg.treadmillMaxSpeed;
      this.unsubStopped?.();
      // The runner stopped the belt themselves: pause, and leave the belt alone until they press play.
      this.unsubStopped = this.devices.runnerStopped.on(() => {
        if (!this.playing || this.finished) return;
        void this.setPlaying(false, true);
        this.flash = { title: 'BELT STOPPED', text: 'PRESS PLAY WHEN YOU ARE READY', tone: 'alert', until: performance.now() / 1000 + 8 };
      });
    } else if (this.devices.sport !== 'bike' || this.devices.power?.info.kind === 'sim' || !this.devices.power) {
      await this.devices.useSimTrainer();
    }
    this.feel = new FeelEngine({ ...cfg.feel }, cfg.ftp);
    this.startTime = Date.now() / 1000;
    this.recorder = new RideRecorder(this.startTime);
    this.freeRide = this.session?.map ? new FreeRide(this.session.map, cfg.weight) : undefined;
    this.rideClock = 0; this.finished = false; this.lastFit = undefined; this.summary = undefined;
    this.T = clamp(this.opts.startAt ?? 0, 0, this.rt.duration - 1);

    this.root.id = 'ride';
    this.stage?.dispose(); this.world?.dispose();
    const assets = this.chapter.assets ?? {};
    this.stage = new Stage(this.root, this.rt, `${this.chapterBase}/${assets.images ?? '.'}`, (t) => this.seek(t));
    this.buildControls();
    if (!this.opts.noWorld) {
      try {
        this.world = new World(this.stage.canvas, this.rt, { onGatePass: (k) => { if (this.playing && this.rate === 1) this.audio?.play('whoosh', [k]); } });
      } catch (e) {
        console.warn('3D view unavailable; continuing without it.', e);
      }
    }
    if (!this.audio) {
      try {
        this.audio = new RideAudio(this.rt, `${this.chapterBase}/${assets.clips ?? '.'}`, { tap: !!(window as unknown as { __tap?: boolean }).__tap });
        await this.audio.load(progress);
      } catch (e) {
        console.warn('Audio unavailable; continuing in silence.', e);
        this.audio = undefined;
      }
    }
    if (this.audio) this.audio.muted = !!this.opts.mute;
    this.applyConfig(cfg);
    this.started = true;
    this.state = this.rt.seek(this.T);
    await this.setPlaying(true);
    this.wake();
    try { await (navigator as Navigator & { wakeLock?: { request(type: string): Promise<unknown> } }).wakeLock?.request('screen'); } catch { /* optional */ }
    if (!this.raf) {
      this.lastNow = performance.now();
      this.raf = requestAnimationFrame(this.frame);
      // Browsers stop drawing a hidden tab. Treat that as a pause rather than leaping ahead on return.
      document.addEventListener('visibilitychange', this.onVisible);
    }
  }

  /** Apply (or re-apply, mid-ride) the player's settings. */
  applyConfig(cfg: RideConfig): void {
    this.cfg = cfg;
    if (this.feel) this.feel.config = { ...cfg.feel };
    this.stage?.setHudPosition(cfg.hudPosition);
    this.stage?.setSubtitleSize(cfg.subtitleSize);
    this.stage?.setWorkoutStrip(cfg.workoutStrip);
    if (this.audio) this.audio.volume = { ...cfg.volume };
  }

  /** `byRunner`: the treadmill was stopped by the runner, so there is no belt to stop. */
  async setPlaying(p: boolean, byRunner = false): Promise<void> {
    if (this.finished && p) return;
    if (this.sport === 'run' && this.started) {
      // Pausing a run stops the belt the game controls; carrying on lets it start again on the next target.
      if (p) this.devices.resumeBelt();
      else if (!byRunner) void this.devices.stopBelt(true);
    }
    this.playing = p;
    this.stage?.setPaused(!p && this.started && !this.finished);
    const b = this.root.querySelector('[data-act="play"]');
    if (b) b.textContent = p ? 'Pause' : 'Play';
    try { await this.audio?.setPlaying(p && this.rate === 1, this.state); } catch { /* context may be closed */ }
  }

  seek(t: number): void {
    if (!this.started || this.finished) return;
    this.T = clamp(t, 0, this.rt.duration - 0.05);
    this.feel.reset();
  }

  private readonly frame = (nowMs: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    // Story time follows the wall clock even at a poor frame rate (the slices in step() keep it exact).
    // Time spent with the tab hidden is not caught up: see the visibility handler in start().
    const wall = Math.min(5, Math.max(0, (nowMs - this.lastNow) / 1000));
    this.lastNow = nowMs;
    try {
      this.step(wall, nowMs / 1000);
    } catch (e) {
      const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
      if (this.errors.length < 5) { this.errors.push(msg); console.error(e); }
    }
  };

  /** One frame. `wall` is real seconds since the last frame. Public so tests can drive it. */
  step(wall: number, now: number): void {
    if (!this.started || !this.stage) return;
    const rt = this.rt; const live = this.devices.live;
    const events: ChapterEvent[] = []; const feelEvents: FeelEvent[] = [];
    let seeked = false; let dtStory = 0;

    if (this.playing && !this.finished) {
      // Advance in small slices so one-shots and recording stay exact even when time is accelerated.
      let left = wall * this.rate;
      while (left > 1e-6 && !this.finished) {
        const h = Math.min(left, 0.25);
        left -= h; dtStory += h;
        this.T = Math.min(rt.duration, this.T + h);
        this.rideClock += h;
        const wk = rt.runner.stateAt(this.T);
        const fr0 = this.freeRide;
        const running = this.sport === 'run';
        if (running) {
          this.applyRunnerControls();
          // On a map, the hills become treadmill incline (never downhill: most treadmills cannot).
          this.devices.applyRunTarget(fr0 ? undefined : wk.targetSpeed, fr0 ? Math.max(0, fr0.trainerGrade(this.cfg.gradeScale)) : 0);
        } else {
          this.applyRiderControls(wk.targetWatts);
          if (fr0) this.devices.applyGrade(fr0.trainerGrade(this.cfg.gradeScale));
          else this.devices.applyTarget(wk.targetWatts, wk.erg, wk.cadence);
        }
        this.devices.tick(h);
        if (running) fr0?.updateRun(h, live.speed);
        else fr0?.update(h, live.power);
        // A runner's effort, in FTP-equivalent watts, drives everything that cycling power drives.
        const effortW = running ? runEffort(live.speed, live.incline, this.cfg.thresholdSpeed) * this.cfg.ftp : live.power;
        const targetW = running ? (rt.runner.targetEffortAt(this.T) ?? 0) * this.cfg.ftp || undefined : wk.targetWatts;
        feelEvents.push(...this.feel.update(h, {
          power: effortW, cadence: running ? 0 : live.cadence, strikeRate: running ? live.cadence : undefined, targetWatts: targetW,
        }));
        const fr = rt.advance(this.T, { power: effortW, cadence: live.cadence, heartRate: live.heartRate || undefined });
        this.state = fr.state;
        if (fr.seeked) { seeked = true; events.length = 0; } else events.push(...fr.events);
        for (const e of fr.events) if (e.type === 'step') this.recorder.lap(this.rideClock, rt.workout.steps[e.stepIndex].label);
        this.recorder.update(this.rideClock, {
          power: live.power, cadence: live.cadence, heartRate: live.heartRate || undefined,
          gameSpeed: fr0 ? fr0.speed * fr0.sceneScale : fr.state.scene.speed * this.feel.state.speedFactor,
          roadSpeed: running ? live.speed : fr0?.speed,
        });
        if (fr0?.finished) { this.complete = true; this.finish(); }
        if (!this.finished && this.T >= rt.duration) { this.complete = !fr0; this.finish(); }
      }
    } else if (!this.finished) {
      // Paused: keep the picture and the devices alive, but not the story or the recording.
      this.devices.tick(wall);
      const fr = rt.advance(this.T);
      this.state = fr.state; seeked = fr.seeked;
    }
    if (this.disposed || !this.stage) return;
    const state = this.state ?? rt.stateAt(this.T);

    // Step announcements on the visor.
    for (const e of events) {
      if (e.type === 'step' && this.rate === 1) {
        const s = rt.workout.steps[e.stepIndex];
        const frac = state.workout.targetFraction;
        const w = state.workout;
        const run = this.sport === 'run';
        const what = run && w.targetKind === 'pace' && w.targetSpeed !== undefined
          ? `${formatPace(w.targetSpeed, this.cfg.units)} ${this.cfg.units === 'imperial' ? '/MI' : '/KM'}`
          : w.targetKind === 'hr' && w.targetHr !== undefined ? `${Math.round(w.targetHr)} BPM` : `${Math.round((frac ?? 0) * 100)}%`;
        this.flash = {
          title: (s.label ?? s.kind).toUpperCase(),
          text: frac !== undefined ? `${what} · ${fmtClock(s.duration)}${s.erg || run ? '' : ' · ERG OFF'}` : `${run ? 'FREE RUN' : 'FREE RIDE'} · ${fmtClock(s.duration)}`,
          tone: (rt.runner.targetEffortAt(this.T) ?? 0) >= 1.05 ? 'alert' : undefined, until: now + 4,
        };
      }
    }
    if (this.flash && now > this.flash.until) this.flash = undefined;

    const fs = this.feel.state; const cfg = this.feel.config;
    const free = this.freeRide;
    const sc = state.scene;
    let speed = sc.speed * fs.speedFactor;
    let speedFactor = fs.speedFactor;
    let nav: string | undefined;
    if (free) {
      // On a free ride the rider is the only thing moving the ship.
      sc.speed = free.speed * free.sceneScale;
      sc.distance = free.distance * free.sceneScale;
      sc.curves.fov = free.fov();
      speed = sc.speed;
      speedFactor = clamp(free.speed / 9, 0.1, 1.3);
      const g = free.grade;
      const km = this.cfg.units === 'imperial' ? `${(free.remaining / 1609.344).toFixed(1)} MI` : `${(free.remaining / 1000).toFixed(1)} KM`;
      nav = `${g >= 0 ? '+' : '−'}${Math.abs(g).toFixed(1)}% · ${km} TO GO`;
    }
    if (this.cfg.reducedMotion) { sc.curves.shake = 0; sc.impactShake = 0; sc.curves.roll = 0; }
    if (this.cfg.reduceFlashes) { sc.curves.flash = 0; sc.curves.glitch = 0; sc.impactFlash = 0; }
    const realtime = this.rate === 1;
    // Hit-stop: hold the picture for a few frames when the rider breaks their peak. The story clock is not held.
    const frozen = realtime && cfg.enabled && fs.freeze > 0 && this.playing;
    if (this.world && !frozen) {
      this.world.frame({
        t: state.t, dt: dtStory, scene: sc, cameraOverride: this.cameraOverride,
        speedFactor, thrust: clamp(fs.pct / 1.1, 0, 1.2), jolt: cfg.enabled ? fs.jolt * cfg.punch * 0.35 : 0,
      });
    }
    if (this.cameraOverride) sc.camera = this.cameraOverride;
    this.stage.update({
      state, dt: wall, now, rider: live, ftp: this.cfg.ftp, maxHr: this.cfg.maxHr, feel: fs, feelConfig: cfg, speed,
      anchors: this.world?.anchors ?? {}, showInserts: this.showInserts, flash: this.flash, nav, showSubtitles: this.cfg.subtitles,
      run: this.sport === 'run' ? {
        speed: live.speed, effort: fs.pct, units: this.cfg.units,
        control: !!this.devices.treadmill?.controllable && this.devices.treadmillControl,
      } : undefined,
    });
    if (this.audio && realtime) {
      this.audio.update({
        state, events, seeked, playing: this.playing, effort: fs.pct, speed, shake: this.world?.shake ?? 0, feel: fs, feelConfig: cfg,
      });
      if (this.playing) this.audio.feel(feelEvents, fs, cfg);
    }
  }

  /** Keyboard and slider control of the simulated runner. The effort slider scales effort, not speed. */
  private applyRunnerControls(): void {
    const sim = this.devices.simTreadmill;
    if (!sim) return;
    sim.setRunning(this.pedalling);
    const th = this.cfg.thresholdSpeed;
    if (this.freeRide) {
      // A steady run, easing up the hills.
      sim.setOverride(th * effortToPace(clamp(0.65 - this.freeRide.grade * 0.03, 0.4, 1) * this.effortScale));
      return;
    }
    if (this.effortScale === 1) { sim.setOverride(null); return; }
    const targetEffort = this.rt.runner.targetEffortAt(this.T) ?? 0.6;
    sim.setOverride(th * effortToPace(targetEffort * this.effortScale));
  }

  /** Keyboard and slider control of the simulated rider. */
  private applyRiderControls(targetWatts: number | undefined): void {
    const sim = this.devices.simTrainer;
    if (!sim) return;
    sim.setPedalling(this.pedalling);
    if (this.freeRide) {
      // With no target to follow, the simulated rider cruises at endurance pace and leans into the hills.
      sim.setOverride(this.cfg.ftp * clamp(0.65 + this.freeRide.grade * 0.05, 0.4, 1.05) * this.effortScale);
      return;
    }
    sim.setOverride(this.effortScale === 1 ? null : (targetWatts ?? this.cfg.ftp * 0.6) * this.effortScale);
  }

  /* ------------------------------------------------------------------ */
  /* Controls                                                            */
  /* ------------------------------------------------------------------ */

  private buildControls(): void {
    const bar = document.createElement('div');
    bar.id = 'bar';
    bar.innerHTML = `
      <button data-act="play">Pause</button><button data-act="back">−10 s</button><button data-act="fwd">+10 s</button>
      <button data-act="jump">Scenes</button><button data-act="cam">Camera: ${this.cameraOverride ?? 'auto'}</button><button data-act="mute">Sound on</button>
      <button data-act="ins">Storyboard cuts: ${this.showInserts ? 'on' : 'off'}</button><button data-act="pos">HUD: ${this.cfg.hudPosition === 'top' ? 'top' : 'bottom'}</button>
      <button data-act="feel">Feel: ${this.session ? 'yours' : FEEL_LABEL[this.settings.feel]}</button>
      <span data-sim><button data-act="pedal">Stop pedalling</button>
      <label>Effort <input data-effort type="range" min="40" max="160" value="100" aria-label="Simulated rider effort, percent of target"></label></span>
      <button data-act="full">Full screen</button><button data-act="end">End ride</button>`;
    this.root.appendChild(bar);
    const jump = document.createElement('div');
    jump.id = 'jump'; jump.hidden = true;
    for (const b of this.chapter.beats ?? []) {
      const a = document.createElement('button');
      a.innerHTML = `<i>${fmtClock(b.t)}</i>`; a.append(b.title);
      a.onclick = () => { this.seek(b.t); jump.hidden = true; };
      jump.appendChild(a);
    }
    this.root.appendChild(jump);
    const simBox = bar.querySelector('[data-sim]') as HTMLElement;
    simBox.hidden = this.sport === 'run' ? this.devices.belt?.info.kind !== 'sim' : this.devices.power?.info.kind !== 'sim';
    if (this.sport === 'run') (bar.querySelector('[data-act="pedal"]') as HTMLElement).textContent = 'Stop running';
    simBox.style.display = simBox.hidden ? 'none' : 'contents';
    const label = (act: string, text: string) => { (bar.querySelector(`[data-act="${act}"]`) as HTMLElement).textContent = text; };

    const actions: Record<string, () => void> = {
      play: () => void this.setPlaying(!this.playing),
      back: () => this.seek(this.T - 10),
      fwd: () => this.seek(this.T + 10),
      jump: () => { jump.hidden = !jump.hidden; },
      cam: () => {
        this.cameraOverride = this.cameraOverride === null ? 'cockpit' : this.cameraOverride === 'cockpit' ? 'chase' : null;
        label('cam', `Camera: ${this.cameraOverride ?? 'auto'}`);
      },
      mute: () => { if (this.audio) { this.audio.muted = !this.audio.muted; label('mute', this.audio.muted ? 'Sound off' : 'Sound on'); } },
      ins: () => { this.showInserts = !this.showInserts; label('ins', `Storyboard cuts: ${this.showInserts ? 'on' : 'off'}`); },
      pos: () => {
        this.cfg = { ...this.cfg, hudPosition: this.cfg.hudPosition === 'top' ? 'bot' : 'top' };
        this.stage?.setHudPosition(this.cfg.hudPosition);
        if (!this.session) { this.settings.hudPos = this.cfg.hudPosition; saveSettings(this.settings); }
        label('pos', `HUD: ${this.cfg.hudPosition === 'top' ? 'top' : 'bottom'}`);
      },
      feel: () => {
        const next = FEEL_ORDER[(FEEL_ORDER.indexOf(this.feelName as FeelPresetName) + 1) % FEEL_ORDER.length];
        this.setFeel(next);
        label('feel', `Feel: ${FEEL_LABEL[next]}`);
      },
      pedal: () => {
        this.pedalling = !this.pedalling;
        const verb = this.sport === 'run' ? 'running' : 'pedalling';
        label('pedal', this.pedalling ? `Stop ${verb}` : `Start ${verb}`);
        (bar.querySelector('[data-act="pedal"]') as HTMLElement).classList.toggle('on', !this.pedalling);
      },
      full: () => {
        try {
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen().catch(() => undefined);
        } catch { /* not available */ }
      },
      end: () => this.finish(),
    };
    bar.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest('button')?.dataset.act;
      if (act && actions[act]) actions[act]();
    });
    (bar.querySelector('[data-effort]') as HTMLInputElement).addEventListener('input', (e) => {
      this.effortScale = parseInt((e.target as HTMLInputElement).value, 10) / 100;
    });
    this.keyHandler = (e: KeyboardEvent) => {
      if (!this.started || this.finished || (e.target as HTMLElement).tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      this.wake();
      const map: Record<string, string> = { ' ': 'play', c: 'cam', f: 'full', m: 'mute', s: 'ins', j: 'jump', h: 'pos', p: 'pedal', g: 'feel' };
      if (k === 'arrowright') this.seek(this.T + (e.shiftKey ? 60 : 10));
      else if (k === 'arrowleft') this.seek(this.T - (e.shiftKey ? 60 : 10));
      else if (k === 'escape') jump.hidden = true;
      else if (map[k]) { e.preventDefault(); actions[map[k]](); }
    };
    removeEventListener('keydown', this.boundKey);
    addEventListener('keydown', this.boundKey);
    this.root.addEventListener('mousemove', this.wake);
    this.root.addEventListener('touchstart', this.wake, { passive: true });
  }

  private keyHandler: (e: KeyboardEvent) => void = () => undefined;
  private readonly boundKey = (e: KeyboardEvent): void => this.keyHandler(e);

  /** The preset last chosen from the control bar. A ride from the menus starts on the player's own settings. */
  private feelName: FeelPresetName | 'yours' = 'yours';

  setFeel(name: FeelPresetName): void {
    this.feelName = name;
    const feel = { ...FEEL_PRESETS[name] };
    if (this.cfg.reducedMotion) { feel.punch = 0; feel.twitch = 0; feel.stopMs = 0; }
    this.cfg = { ...this.cfg, feel };
    this.feel.config = { ...feel };
    if (!this.session) { this.settings.feel = name; saveSettings(this.settings); }
    this.stage?.toast(`Feel: ${FEEL_LABEL[name]}`);
  }

  private readonly wake = (): void => {
    this.root.classList.remove('idle');
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => { if (this.playing) this.root.classList.add('idle'); }, 2600);
  };

  /* ------------------------------------------------------------------ */
  /* End screen and export                                               */
  /* ------------------------------------------------------------------ */

  /** The recorded ride as a FIT activity file, or undefined if nothing was recorded. */
  fitBytes(): Uint8Array | undefined {
    if (this.lastFit) return this.lastFit;
    const ride = this.recorder.ride();
    if (ride.samples.length === 0) return undefined;
    this.lastFit = encodeFitActivity(ride, {
      ftp: this.cfg.ftp, maxHr: this.cfg.maxHr, productName: ENGINE_NAME, sport: this.sport, thresholdSpeed: this.cfg.thresholdSpeed,
      utcOffsetSeconds: -new Date().getTimezoneOffset() * 60,
    });
    return this.lastFit;
  }

  finish(): void {
    if (this.finished || !this.started) return;
    this.finished = true;
    this.playing = false;
    void this.audio?.setPlaying(false).catch(() => undefined);
    if (this.sport === 'run') void this.devices.treadmill?.release().catch(() => undefined);
    else void this.devices.trainer?.release().catch(() => undefined);
    this.unsubStopped?.();
    const samples = this.recorder.samples;
    this.summary = samples.length
      ? summarise(samples, this.cfg.ftp, this.cfg.maxHr, { sport: this.sport, thresholdSpeed: this.cfg.thresholdSpeed, mass: this.cfg.weight })
      : undefined;
    if (this.session) {
      const result: RideResult = {
        complete: this.complete, startTime: this.startTime, summary: this.summary, fit: this.fitBytes(),
        flags: { ...(this.state?.flags ?? {}) }, sport: this.sport,
        simulated: this.sport === 'run' ? (this.devices.belt ?? this.devices.pod)?.info.kind === 'sim' : this.devices.power?.info.kind === 'sim',
      };
      const done = this.session.onFinish;
      this.dispose();
      done(result);
      return;
    }
    this.showEnd();
  }

  /** Stop drawing, release the audio device and remove everything the ride put on the page. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.started = false;
    clearTimeout(this.idleTimer);
    removeEventListener('keydown', this.boundKey);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.root.removeEventListener('mousemove', this.wake);
    this.root.removeEventListener('touchstart', this.wake);
    void this.audio?.dispose();
    this.audio = undefined;
    this.world?.dispose();
    this.world = undefined;
    this.stage?.dispose();
    this.stage = undefined;
    this.root.classList.remove('idle');
    this.root.removeAttribute('id');
    this.root.innerHTML = '';
  }

  private showEnd(): void {
    const ch = this.chapter; const sm = this.summary;
    const el = document.createElement('div');
    el.className = 'screen'; el.id = 'end';
    const last = [...(ch.stills ?? [])].reverse().find((x) => !x.insert);
    if (last && ch.assets?.images) el.style.setProperty('--backdrop', `url("${this.chapterBase}/${ch.assets.images}/${last.image}.jpg")`);
    const stat = (v: string, label: string) => `<div class="stat"><div class="big">${v}</div><div class="unit">${label}</div></div>`;
    const complete = this.T >= this.rt.duration - 1;
    let body: string;
    if (sm) {
      const total = sm.timeInPowerZones.reduce((a, b) => a + b, 0) || 1;
      const run = sm.sport === 'run';
      const sim = run ? (this.devices.belt ?? this.devices.pod)?.info.kind === 'sim' : this.devices.power?.info.kind === 'sim';
      const imperial = this.cfg.units === 'imperial';
      const main = run
        ? stat(imperial ? (sm.distance / 1609.344).toFixed(2) : (sm.distance / 1000).toFixed(2), imperial ? 'Distance · mi' : 'Distance · km')
          + stat(formatPace(sm.avgSpeed, this.cfg.units), `Average pace · ${imperial ? '/mi' : '/km'}`)
          + (sm.hasPower ? stat(String(Math.round(sm.avgPower)), 'Average running power · W') : '')
          + (sm.avgCadence ? stat(String(Math.round(sm.avgCadence)), 'Average cadence · spm') : '')
        : stat(String(Math.round(sm.normalisedPower)), 'Normalised power · W') + stat(String(Math.round(sm.avgPower)), 'Average power · W')
          + stat(String(Math.round(sm.kilojoules)), 'Work · kJ');
      body = `<div class="panel"><h2>${run ? 'Run' : 'Ride'} summary${sim ? (run ? ' · simulated runner' : ' · simulated rider') : ''}</h2><div class="stats">
          ${stat(fmtClock(sm.duration), 'Duration')}${main}
          ${sm.avgHeartRate ? stat(String(Math.round(sm.avgHeartRate)), 'Average heart rate') + stat(String(Math.round(sm.maxHeartRate ?? 0)), 'Max heart rate') : ''}
          ${stat(sm.intensityFactor.toFixed(2), 'Intensity factor')}${stat(String(Math.round(sm.trainingStress)), 'Training stress')}
        </div></div>
        <div class="panel"><h2>Time in ${run ? 'effort' : 'power'} zones</h2>
          <div class="zones">${sm.timeInPowerZones.map((s, i) => `<i style="width:${(s / total) * 100}%;background:${zoneColour([0.5, 0.65, 0.8, 0.95, 1.1, 1.3, 1.6][i])}"></i>`).join('')}</div>
          <div class="zonekey">${sm.timeInPowerZones.map((s, i) => `<span><i style="background:${zoneColour([0.5, 0.65, 0.8, 0.95, 1.1, 1.3, 1.6][i])}"></i>Z${i + 1} ${POWER_ZONE_NAMES[i]} · ${fmtClock(s)}</span>`).join('')}</div>
        </div>
        <div class="row"><button class="primary go" id="e-fit">Download .fit</button><button id="e-again">Ride again</button></div>
        <p class="small dim">The .fit file is a standard activity file. Upload it to Garmin Connect, Strava or any training log.</p>`;
    } else {
      body = `<p class="dim">Nothing was recorded.</p><div class="row"><button id="e-again">Ride again</button></div>`;
    }
    el.innerHTML = `<div class="inner">
      <div class="kicker">${complete ? 'Chapter complete' : 'Ride ended early'}</div>
      <div><h1>${ch.title}</h1></div>${body}</div>`;
    document.body.appendChild(el);
    (el.querySelector('#e-fit') as HTMLButtonElement | null)?.addEventListener('click', () => this.downloadFit());
    (el.querySelector('#e-again') as HTMLButtonElement).addEventListener('click', () => {
      el.remove();
      this.opts.startAt = 0;
      void this.start().catch((e) => this.fail(e));
    });
  }

  downloadFit(): void {
    const bytes = this.fitBytes();
    if (!bytes) return;
    const d = new Date(this.recorder.startTime * 1000);
    const p = (n: number) => String(n).padStart(2, '0');
    const name = `overreach-${this.chapter.id}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.fit`;
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.ant.fit' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}
