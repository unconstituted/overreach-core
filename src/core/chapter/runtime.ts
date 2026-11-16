import { buildWorkout, parseFitWorkout, parseZwo, totalDuration, WorkoutRunner, type RunnerState, type Workout } from '../workout';
import { DistanceTable, evalCurve, evalEnv, evalKeys, evalStep } from './curves';
import type {
  Branch, Challenge, Chapter, DialogueCue, Gated, GlassLine, HudItem, Impact, NoticeKind, RiderData, SfxCue, Still,
} from './types';

export interface RuntimeOptions {
  ftp: number;
  maxHr?: number;
  /** The parsed workout, required when the chapter references a workout file. */
  workout?: Workout;
  /** Real clip lengths in seconds (from the audio layer), for exact mid-clip resume. */
  clipDurations?: Record<string, number>;
  /** A time jump larger than this (or any backwards step) is treated as a seek. Seconds. */
  maxStep?: number;
}

export interface ActiveDialogue {
  cue: DialogueCue;
  /** Seconds into the clip's audio (already scaled by playback rate). */
  offset: number;
  /** Seconds of chapter time until the clip ends. */
  remaining: number;
}
export interface ActiveGlass { line: GlassLine; age: number; shownChars: number; fade: number }
export interface ActiveStill { still: Still; opacity: number; scale: number; x: number; y: number; progress: number }
export interface ActiveNotice { text: string; kind: NoticeKind; t: number; age: number; hold: number }
export interface ActiveWidget { id: string; from: number; to: number; age: number; params: Record<string, unknown> }

export interface HudState {
  /** Standard elements currently hidden. Contains "all" when the whole HUD is off. */
  hidden: string[];
  title?: { small?: string; big?: string; em?: string; opacity: number };
  banner?: { text: string; tone: 'warning' | 'info'; blink: boolean };
  /** Live pop-up notices, oldest first. */
  notices: ActiveNotice[];
  waypoint?: { label: string; text: string; x: number; y: number };
  widgets: ActiveWidget[];
  effects: string[];
}

export interface SceneState {
  id: string;
  segmentStart: number;
  camera: string;
  /** Story speed, m/s. */
  speed: number;
  /** Distance along the route, metres. */
  distance: number;
  env: Record<string, number | number[]>;
  /** Every named curve evaluated at the current time. */
  curves: Record<string, number>;
  /** Extra shake from recent impacts (add to the "shake" curve). */
  impactShake: number;
  /** Screen flash from recent impacts, 0 to about 1.3. */
  impactFlash: number;
  streaks?: Record<string, number | number[]>;
}

export interface MusicState {
  level: number; kick: number; hat: number; bass: number; arp: number; pad: number; bright: number;
  mode: string; party: boolean; fast: boolean;
  ambience: Record<string, number>;
}

export type ChallengeStatus = 'pending' | 'active' | 'succeeded' | 'failed' | 'skipped';
export interface ChallengeState {
  id: string;
  status: ChallengeStatus;
  prompt?: string;
  /** 0 to 1: held time over the required hold. */
  progress: number;
  held: number;
  inRange: boolean;
  /** Seconds until the window closes (0 when not active). */
  timeLeft: number;
}

export interface ChapterState {
  t: number;
  finished: boolean;
  beat?: { index: number; t: number; title: string };
  workout: RunnerState;
  scene: SceneState;
  dialogue: { active: ActiveDialogue[]; subtitle?: { speaker: string; text: string } };
  glass: ActiveGlass[];
  stills: ActiveStill[];
  hud: HudState;
  music: MusicState;
  challenges: ChallengeState[];
  flags: Record<string, boolean>;
}

export type ChapterEvent =
  | { type: 'dialogue'; cue: DialogueCue }
  | { type: 'sfx'; cue: SfxCue }
  | { type: 'notice'; text: string; kind: NoticeKind }
  | { type: 'glass'; line: GlassLine }
  | { type: 'impact'; impact: Impact }
  | { type: 'beat'; index: number; title: string }
  | { type: 'step'; stepIndex: number }
  | { type: 'cue'; kind: 'spin-up' | 'go'; stepIndex: number }
  | { type: 'challenge'; id: string; outcome: 'started' | 'succeeded' | 'failed' };

export interface Frame {
  state: ChapterState;
  /** One-shot events crossed since the previous frame. Empty after a seek. */
  events: ChapterEvent[];
  /** True when this frame was a jump: audio should stop and resume from `state.dialogue.active`. */
  seeked: boolean;
}

interface ChallengeRecord {
  status: ChallengeStatus;
  held: number;
  outOfRange: number;
  inRange: boolean;
  resolvedAt?: number;
}

type Injected<T> = T & { __from?: string };

/** Build the chapter's workout. Chapters that reference a file need `readFile` to load it. */
export function loadChapterWorkout(chapter: Chapter, readFile?: (path: string) => string | Uint8Array): Workout {
  if ('steps' in chapter.workout) {
    return buildWorkout({ name: chapter.workout.name ?? chapter.title, steps: chapter.workout.steps });
  }
  const path = chapter.workout.file;
  if (!readFile) throw new Error(`Chapter "${chapter.id}" references the workout file ${path}; pass a file reader`);
  const data = readFile(path);
  if (/\.zwo$/i.test(path)) {
    if (typeof data !== 'string') throw new Error(`${path} must be read as text`);
    return parseZwo(data);
  }
  if (/\.fit$/i.test(path)) {
    if (typeof data === 'string') throw new Error(`${path} must be read as bytes`);
    return parseFitWorkout(data);
  }
  throw new Error(`Unsupported workout file type: ${path}`);
}

const SUB_TAIL = 0.25;
const GLASS_FADE = 3;
const GLASS_CHARS_PER_SECOND = 16;

/**
 * Plays a chapter. `stateAt(t)` is a pure function of time (plus the flags
 * and challenge results so far), so any moment can be shown directly.
 * `advance(t, rider)` is the per-frame call: it detects seeks, emits one-shot
 * events exactly once when playing forwards, and evaluates challenges.
 */
export class ChapterRuntime {
  readonly workout: Workout;
  readonly runner: WorkoutRunner;
  readonly distance: DistanceTable;
  readonly duration: number;
  private readonly maxStep: number;
  private readonly clipDurations: Record<string, number>;
  private last: number | undefined;
  private flags: Record<string, boolean> = {};
  private readonly records = new Map<string, ChallengeRecord>();
  private dialogue: Injected<DialogueCue>[];
  private glass: Injected<GlassLine>[];
  private hud: Injected<HudItem>[];
  private sfx: Injected<SfxCue>[];
  private readonly curveNames: string[];
  private readonly ambienceNames: string[];

  constructor(readonly chapter: Chapter, private readonly opts: RuntimeOptions) {
    this.workout = opts.workout ?? loadChapterWorkout(chapter);
    this.runner = new WorkoutRunner(this.workout, opts.ftp);
    this.duration = chapter.duration;
    this.distance = new DistanceTable(chapter.scene.speed, chapter.duration);
    this.maxStep = opts.maxStep ?? 1.5;
    this.clipDurations = { ...(opts.clipDurations ?? {}) };
    this.dialogue = [...(chapter.dialogue ?? [])];
    this.glass = [...(chapter.glass ?? [])];
    this.hud = [...(chapter.hud ?? [])];
    this.sfx = [...(chapter.sfx ?? [])].sort((a, b) => a.t - b.t);
    this.curveNames = Object.keys(chapter.scene.curves ?? {});
    this.ambienceNames = Object.keys(chapter.music?.ambience ?? {});
    for (const c of chapter.challenges ?? []) this.records.set(c.id, { status: 'pending', held: 0, outOfRange: 0, inRange: false });
  }

  /** Tell the runtime how long a clip really is, once the audio layer has decoded it. */
  setClipDuration(clip: string, seconds: number): void {
    this.clipDurations[clip] = seconds;
  }

  /** Length of a dialogue cue in chapter time. */
  cueLength(cue: DialogueCue): number {
    const rate = cue.rate ?? 1;
    const known = this.clipDurations[cue.clip] ?? cue.duration;
    if (known !== undefined) return known / rate;
    // Without a real length, assume the clip ends shortly after its last subtitle.
    let end = 0;
    for (const s of cue.subs ?? []) end = Math.max(end, s.offset + s.duration);
    return (end > 0 ? end + 0.5 : 4) / rate;
  }

  private ok(item: Gated): boolean {
    if (item.if !== undefined && !this.flags[item.if]) return false;
    if (item.unless !== undefined && this.flags[item.unless]) return false;
    return true;
  }

  speedAt(t: number): number { return this.distance.speedAt(t); }
  distanceAt(t: number): number { return this.distance.at(t); }
  get time(): number { return this.last ?? 0; }

  /* ------------------------------------------------------------------ */
  /* Pure state                                                          */
  /* ------------------------------------------------------------------ */

  stateAt(time: number): ChapterState {
    const ch = this.chapter;
    const t = Math.min(this.duration, Math.max(0, time));

    // Beat
    let beat: ChapterState['beat'];
    (ch.beats ?? []).forEach((b, index) => { if (b.t <= t) beat = { index, t: b.t, title: b.title }; });

    // Scene
    const sc = ch.scene;
    let seg = sc.segments[0];
    for (const s of sc.segments) if (s.from <= t) seg = s;
    let camera = sc.defaultCamera ?? 'cockpit';
    for (const c of sc.camera ?? []) if (t >= c.from && t < c.to) camera = c.mode;
    const curves: Record<string, number> = {};
    for (const name of this.curveNames) curves[name] = evalKeys((sc.curves as Record<string, [number, number][]>)[name], t);
    let impactShake = 0;
    let impactFlash = 0;
    for (const im of sc.impacts ?? []) {
      if (t < im.t) continue;
      const age = t - im.t;
      if (age > 12) continue;
      impactShake += im.strength * Math.exp(-age * 1.1);
      if (im.flash !== false) impactFlash += Math.min(1.3, im.strength) * Math.exp(-age * 2.6);
    }
    const scene: SceneState = {
      id: seg.id, segmentStart: seg.from, camera, speed: this.distance.speedAt(t), distance: this.distance.at(t),
      env: evalEnv(sc.env ?? [], t), curves, impactShake, impactFlash, streaks: evalStep(sc.streaks, t),
    };

    // Dialogue
    const active: ActiveDialogue[] = [];
    let subtitle: { speaker: string; text: string } | undefined;
    for (const cue of this.dialogue) {
      if (t < cue.t || !this.ok(cue)) continue;
      const len = this.cueLength(cue);
      if (t < cue.t + len) active.push({ cue, offset: (t - cue.t) * (cue.rate ?? 1), remaining: cue.t + len - t });
      if (!subtitle && cue.subs && t < cue.t + 60) {
        for (const s of cue.subs) {
          if (t >= cue.t + s.offset && t < cue.t + s.offset + s.duration + SUB_TAIL) { subtitle = { speaker: s.speaker, text: s.text }; break; }
        }
      }
    }

    // Glass
    const glass: ActiveGlass[] = [];
    for (const line of this.glass) {
      if (t < line.t || t > line.t + line.hold + GLASS_FADE || !this.ok(line)) continue;
      const age = t - line.t;
      const k = Math.min(1, Math.max(0, (age - line.hold) / GLASS_FADE));
      glass.push({ line, age, shownChars: Math.floor(age * GLASS_CHARS_PER_SECOND), fade: 1 - k * k * (3 - 2 * k) });
    }

    // Stills
    const stills: ActiveStill[] = [];
    for (const s of ch.stills ?? []) {
      if (t < s.from || t > s.to || !this.ok(s)) continue;
      const opacity = Math.min(clamp01((t - s.from) / s.fadeIn), clamp01((s.to - t) / s.fadeOut));
      if (opacity <= 0) continue;
      const u = clamp01((t - s.from) / (s.to - s.from));
      const e = u * u * (3 - 2 * u) * 0.5 + u * 0.5;
      stills.push({
        still: s, opacity, progress: u,
        scale: s.start[0] + (s.end[0] - s.start[0]) * e,
        x: s.start[1] + (s.end[1] - s.start[1]) * e,
        y: s.start[2] + (s.end[2] - s.start[2]) * e,
      });
    }

    // HUD
    const hud: HudState = { hidden: [], notices: [], widgets: [], effects: [] };
    for (const item of this.hud) {
      if (!this.ok(item)) continue;
      if (item.type === 'notice') {
        if (t >= item.t && t < item.t + item.hold) hud.notices.push({ text: item.text, kind: item.kind, t: item.t, age: t - item.t, hold: item.hold });
        continue;
      }
      if (t < item.from || t >= item.to) continue;
      switch (item.type) {
        case 'title': {
          const fi = item.fadeIn ?? 1;
          const fo = item.fadeOut ?? fi;
          hud.title = { small: item.small, big: item.big, em: item.em, opacity: smooth(item.from, item.from + fi, t) * (1 - smooth(item.to - fo, item.to, t)) };
          break;
        }
        case 'banner':
          hud.banner = { text: item.text, tone: item.tone ?? 'warning', blink: item.blink ?? false };
          break;
        case 'waypoint': {
          let text = item.label;
          const unit = item.unit ?? '';
          if (item.distanceTo !== undefined) {
            const metres = Math.max(0, this.distance.at(item.distanceTo) - this.distance.at(t));
            const v = unit === 'km' ? metres / 1000 : metres;
            text += ` · ${v.toFixed(item.decimals ?? 0)} ${unit || 'm'}`;
          } else if (item.value) {
            text += ` · ${evalKeys(item.value, t).toFixed(item.decimals ?? 0)}${unit ? ' ' + unit : ''}`;
          }
          if (item.extra) text += ` · ${item.extra.label} ${Math.round(evalKeys(item.extra.value, t))}${item.extra.unit ?? ''}`;
          hud.waypoint = { label: item.label, text, x: evalCurve(item.x, t, 50), y: evalCurve(item.y, t, 42) };
          break;
        }
        case 'hide':
          for (const e of item.elements) if (!hud.hidden.includes(e)) hud.hidden.push(e);
          break;
        case 'widget':
          hud.widgets.push({ id: item.id, from: item.from, to: item.to, age: t - item.from, params: item.params ?? {} });
          break;
        case 'effect':
          if (!hud.effects.includes(item.id)) hud.effects.push(item.id);
          break;
      }
    }
    hud.notices.sort((a, b) => a.t - b.t);

    // Music
    const music: MusicState = { level: 0, kick: 0, hat: 0, bass: 0, arp: 0, pad: 0, bright: 0.4, mode: 'main', party: false, fast: false, ambience: {} };
    for (const m of ch.music?.sections ?? []) {
      if (t < m.from || t >= m.to) continue;
      music.level = evalCurve(m.level, t);
      music.kick = evalCurve(m.kick, t);
      music.hat = evalCurve(m.hat, t);
      music.bass = evalCurve(m.bass, t);
      music.arp = evalCurve(m.arp, t);
      music.pad = evalCurve(m.pad, t);
      music.bright = evalCurve(m.bright, t, 0.4);
      music.mode = m.mode;
      music.party = !!m.party;
      music.fast = !!m.fast;
      break;
    }
    for (const name of this.ambienceNames) music.ambience[name] = evalKeys((ch.music?.ambience as Record<string, [number, number][]>)[name], t);

    // Challenges
    const challenges: ChallengeState[] = (ch.challenges ?? []).map((c) => {
      const r = this.records.get(c.id) as ChallengeRecord;
      return {
        id: c.id, status: r.status, prompt: c.prompt, held: r.held, inRange: r.inRange,
        progress: r.status === 'succeeded' ? 1 : clamp01(r.held / c.condition.hold),
        timeLeft: r.status === 'active' ? Math.max(0, c.to - t) : 0,
      };
    });

    return {
      t, finished: t >= this.duration, beat, workout: this.runner.stateAt(t), scene,
      dialogue: { active, subtitle }, glass, stills, hud, music, challenges, flags: { ...this.flags },
    };
  }

  /* ------------------------------------------------------------------ */
  /* Stateful playback                                                    */
  /* ------------------------------------------------------------------ */

  /** Jump to a time. No one-shot events fire; challenge results after `t` are forgotten. */
  seek(time: number): ChapterState {
    const t = Math.min(this.duration, Math.max(0, time));
    let changed = false;
    for (const c of this.chapter.challenges ?? []) {
      const r = this.records.get(c.id) as ChallengeRecord;
      if (r.resolvedAt !== undefined && r.resolvedAt > t) {
        // The rider has gone back to before this was decided: undo it.
        r.resolvedAt = undefined;
        r.status = 'pending';
        changed = true;
      }
      if (r.resolvedAt === undefined) {
        r.held = 0;
        r.outOfRange = 0;
        r.inRange = false;
        r.status = t >= c.to ? 'skipped' : t >= c.from ? 'active' : 'pending';
      }
    }
    if (changed) this.rebuild();
    this.last = t;
    return this.stateAt(t);
  }

  /** Recompute flags and injected items from the challenge results that still stand. */
  private rebuild(): void {
    const ch = this.chapter;
    this.flags = {};
    this.dialogue = [...(ch.dialogue ?? [])];
    this.glass = [...(ch.glass ?? [])];
    this.hud = [...(ch.hud ?? [])];
    this.sfx = [...(ch.sfx ?? [])];
    const resolved = (ch.challenges ?? [])
      .map((c) => ({ c, r: this.records.get(c.id) as ChallengeRecord }))
      .filter((x) => x.r.resolvedAt !== undefined && (x.r.status === 'succeeded' || x.r.status === 'failed'))
      .sort((a, b) => (a.r.resolvedAt as number) - (b.r.resolvedAt as number));
    for (const { c, r } of resolved) this.inject(c, r.status === 'succeeded' ? c.onSuccess : c.onFail, r.resolvedAt as number);
    this.sfx.sort((a, b) => a.t - b.t);
  }

  private inject(c: Challenge, branch: Branch | undefined, at: number): void {
    if (!branch) return;
    for (const [k, v] of Object.entries(branch.setFlags ?? {})) this.flags[k] = v;
    for (const d of branch.dialogue ?? []) this.dialogue.push({ ...d, t: at + d.t, __from: c.id });
    for (const g of branch.glass ?? []) this.glass.push({ ...g, t: at + g.t, __from: c.id });
    for (const s of branch.sfx ?? []) this.sfx.push({ ...s, t: at + s.t, __from: c.id });
    for (const h of branch.hud ?? []) {
      if (h.type === 'notice') this.hud.push({ ...h, t: at + h.t, __from: c.id });
      else this.hud.push({ ...h, from: at + h.from, to: at + h.to, __from: c.id });
    }
    this.sfx.sort((a, b) => a.t - b.t);
  }

  private measure(c: Challenge, t: number, rider: RiderData): number | undefined {
    switch (c.condition.metric) {
      case 'power': return rider.power;
      case 'powerFtp': return rider.power / this.opts.ftp;
      case 'powerTarget': {
        const target = this.runner.targetWattsAt(t);
        return target ? rider.power / target : undefined;
      }
      case 'cadence': return rider.cadence;
      case 'heartRate': return rider.heartRate;
      case 'heartRateMax': return rider.heartRate !== undefined && this.opts.maxHr ? rider.heartRate / this.opts.maxHr : undefined;
    }
  }

  /** Per-frame update. Pass the current chapter time and the latest rider data. */
  advance(time: number, rider?: RiderData): Frame {
    const t = Math.min(this.duration, Math.max(0, time));
    const prev = this.last;
    if (prev === undefined) {
      // First frame: start cleanly at t (events exactly at t = 0 still fire).
      if (t > 0) return { state: this.seek(t), events: [], seeked: true };
      this.last = 0;
      const first = this.collect(-1e-9, 0);
      return { state: this.stateAt(0), events: first, seeked: false };
    }
    if (t < prev || t - prev > this.maxStep) return { state: this.seek(t), events: [], seeked: true };
    const events: ChapterEvent[] = [];
    const dt = t - prev;

    // Challenges first, so branch items that start "now" are seen by the one-shot pass below.
    for (const c of this.chapter.challenges ?? []) {
      const r = this.records.get(c.id) as ChallengeRecord;
      if (!this.ok(c)) continue;
      if (r.status === 'pending' && t >= c.from) {
        r.status = 'active';
        events.push({ type: 'challenge', id: c.id, outcome: 'started' });
      }
      if (r.status !== 'active') continue;
      const v = rider ? this.measure(c, t, rider) : undefined;
      const inRange = v !== undefined && (c.condition.min === undefined || v >= c.condition.min) && (c.condition.max === undefined || v <= c.condition.max);
      r.inRange = inRange;
      if (inRange) {
        r.held += dt;
        r.outOfRange = 0;
      } else {
        r.outOfRange += dt;
        if (r.outOfRange > (c.condition.grace ?? 0)) r.held = 0;
      }
      if (r.held >= c.condition.hold) {
        r.status = 'succeeded';
        r.resolvedAt = t;
        this.inject(c, c.onSuccess, t);
        events.push({ type: 'challenge', id: c.id, outcome: 'succeeded' });
      } else if (t >= c.to) {
        r.status = 'failed';
        r.resolvedAt = t;
        this.inject(c, c.onFail, t);
        events.push({ type: 'challenge', id: c.id, outcome: 'failed' });
      }
    }

    events.push(...this.collect(prev, t));
    this.last = t;
    return { state: this.stateAt(t), events, seeked: false };
  }

  /** One-shot events with a start time in (prev, t]. */
  private collect(prev: number, t: number): ChapterEvent[] {
    const out: ChapterEvent[] = [];
    const hit = (x: number) => x > prev && x <= t;
    (this.chapter.beats ?? []).forEach((b, index) => { if (hit(b.t)) out.push({ type: 'beat', index, title: b.title }); });
    for (const i of this.runner.stepsStartedBetween(prev, t)) out.push({ type: 'step', stepIndex: i });
    for (const c of this.runner.cues) {
      if (hit(c.from)) out.push({ type: 'cue', kind: 'spin-up', stepIndex: c.stepIndex });
      if (hit(c.at)) out.push({ type: 'cue', kind: 'go', stepIndex: c.stepIndex });
    }
    for (const cue of this.dialogue) if (hit(cue.t) && this.ok(cue)) out.push({ type: 'dialogue', cue });
    for (const s of this.sfx) {
      if (s.t > t) break;
      if (hit(s.t) && this.ok(s)) out.push({ type: 'sfx', cue: s });
    }
    for (const g of this.glass) if (hit(g.t) && this.ok(g)) out.push({ type: 'glass', line: g });
    for (const h of this.hud) if (h.type === 'notice' && hit(h.t) && this.ok(h)) out.push({ type: 'notice', text: h.text, kind: h.kind });
    for (const im of this.chapter.scene.impacts ?? []) if (hit(im.t)) out.push({ type: 'impact', impact: im });
    return out;
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function smooth(a: number, b: number, x: number): number {
  if (b <= a) return x >= b ? 1 : 0;
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
}

/** Total length of a chapter's workout, for validation. */
export function chapterWorkoutDuration(chapter: Chapter, workout?: Workout): number {
  return totalDuration(workout ?? loadChapterWorkout(chapter));
}
