import type { StepSpec } from '../workout';

/**
 * The chapter file format (`chapters/*.chapter.json`).
 * A chapter is pure data: a workout plus timed tracks. The matching JSON
 * schema is `schemas/chapter.schema.json`; `docs/AUTHORING.md` explains it.
 * All times are seconds from the start of the chapter.
 */

/** Linear keyframes: [time, value] pairs in time order. */
export type Keys = [number, number][];
/** A value that is constant, or follows keyframes. */
export type Curve = number | Keys;

/** Optional gating on story flags (set by challenge branches). */
export interface Gated {
  /** Only active when this flag is true. */
  if?: string;
  /** Only active when this flag is not true. */
  unless?: string;
}

export interface SubtitleLine {
  /** Seconds from the start of the clip. */
  offset: number;
  duration: number;
  speaker: string;
  text: string;
}

export interface DialogueCue extends Gated {
  t: number;
  /** Clip id: the file name in the chapter's clip folder, without extension. */
  clip: string;
  gain?: number;
  /** Playback rate (1 = normal). */
  rate?: number;
  /** Radio treatment: band-limited with a touch of grit. */
  radio?: boolean;
  /** Send to the reverb (a voice heard in a big space or over an open channel). */
  reverb?: boolean;
  /** Clip length in seconds, for resuming mid-clip after a seek. */
  duration?: number;
  subs?: SubtitleLine[];
}

/** Text the AI writes in the canopy condensation. */
export interface GlassLine extends Gated {
  t: number;
  text: string;
  /** Seconds the text stays before fading. */
  hold: number;
}

/** A storyboard still, shown full screen with a slow move. */
export interface Still extends Gated {
  image: string;
  from: number;
  to: number;
  fadeIn: number;
  fadeOut: number;
  /** [scale, x %, y %] at the start and end of the move. */
  start: [number, number, number];
  end: [number, number, number];
  /** CSS transform origin, e.g. "50% 38%". */
  origin?: string;
  rotate?: number;
  /** Seen through the visor (HUD drawn over it). */
  visor?: boolean;
  /** A short storyboard cut-away the player can switch off. */
  insert?: boolean;
}

export type NoticeKind = 'location' | 'distance' | 'ai' | 'surge' | 'warning' | 'info';

export type HudItem = Gated & (
  | { type: 'title'; from: number; to: number; fadeIn?: number; fadeOut?: number; small?: string; big?: string; em?: string }
  | { type: 'banner'; from: number; to: number; text: string; tone?: 'warning' | 'info'; blink?: boolean }
  | { type: 'notice'; t: number; hold: number; kind: NoticeKind; text: string }
  | {
      type: 'waypoint'; from: number; to: number; label: string;
      /** Show the distance to where the ship will be at this time. */
      distanceTo?: number;
      /** Or show a value that follows keyframes. */
      value?: Keys;
      unit?: string;
      decimals?: number;
      /** A second read-out, e.g. gradient. */
      extra?: { label: string; value: Keys; unit?: string };
      /** Screen position in percent. */
      x?: Curve;
      y?: Curve;
    }
  /** Hide standard HUD elements for a while ("all", "speed", "power", "cadence", "heartRate", "target"). */
  | { type: 'hide'; from: number; to: number; elements: string[] }
  /** Show a story-specific widget (e.g. "boot", "call", "heat", "map", "boost", "modes", "tag"). */
  | { type: 'widget'; id: string; from: number; to: number; params?: Record<string, unknown> }
  /** A visual treatment of the whole HUD (e.g. "flicker", "tear", "alt"). */
  | { type: 'effect'; id: string; from: number; to: number }
);

export interface SceneSegment {
  from: number;
  /** Scene kit id, e.g. "stills", "tunnel", "space", "blackout", "ice", "ascent", "orbit". */
  id: string;
}

export interface CameraSpan {
  from: number;
  to: number;
  mode: string;
}

export interface EnvKey {
  t: number;
  /** Numbers and number arrays, blended linearly between keys. */
  values: Record<string, number | number[]>;
}

export interface Impact {
  t: number;
  /** Shake strength; decays over about a second. */
  strength: number;
  /** Whether the screen flashes white. Defaults to true. */
  flash?: boolean;
}

export interface SceneProp {
  type: string;
  from?: number;
  to?: number;
  /** A time whose ship position places the prop along the route. */
  at?: number;
  params?: Record<string, unknown>;
}

export interface StepKey {
  from: number;
  values: Record<string, number | number[]>;
}

export interface SceneTrack {
  segments: SceneSegment[];
  /** Camera mode spans; the default mode applies elsewhere. */
  camera?: CameraSpan[];
  defaultCamera?: string;
  /** Story speed in m/s. Integrated to place the ship along the route. */
  speed: Keys;
  env?: EnvKey[];
  /** Named numeric curves the scene kits read (fov, shake, roll, yaw, climb, fade ...). */
  curves?: Record<string, Keys>;
  impacts?: Impact[];
  props?: SceneProp[];
  /** Named times, used by scene kits to place set pieces. */
  markers?: Record<string, number>;
  /** Speed-streak settings, held from each `from` until the next. */
  streaks?: StepKey[];
}

export interface SfxCue extends Gated {
  t: number;
  /** Sound id understood by the audio layer, e.g. "boom", "riser", "chime". */
  id: string;
  args?: number[];
}

export interface MusicSection {
  from: number;
  to: number;
  /** Harmonic mode: "main", "dark", "tense", "hope". */
  mode: string;
  party?: boolean;
  fast?: boolean;
  level: Curve;
  kick?: Curve;
  hat?: Curve;
  bass?: Curve;
  arp?: Curve;
  pad?: Curve;
  bright?: Curve;
}

export interface MusicTrack {
  bpm?: number;
  sections: MusicSection[];
  /** Named curves for continuous sound layers (drone, ring, hangar ...). */
  ambience?: Record<string, Keys>;
  /**
   * Looping clips. The ambience curve with the same name sets the gain, and
   * `<name>Cutoff`, if present, a low-pass filter frequency.
   */
  loops?: Record<string, { clip: string; reverse?: boolean; rate?: number; lowpass?: number; reverb?: boolean }>;
}

export type Metric = 'power' | 'powerFtp' | 'powerTarget' | 'cadence' | 'heartRate' | 'heartRateMax';

export interface Condition {
  /**
   * What to measure: watts, fraction of FTP, fraction of the current workout
   * target, rpm, bpm, or fraction of max heart rate.
   */
  metric: Metric;
  min?: number;
  max?: number;
  /** Seconds the rider must stay in range, continuously. */
  hold: number;
  /** Seconds out of range that are forgiven before the hold resets. */
  grace?: number;
}

/** What happens when a challenge resolves. Times inside are relative to that moment. */
export interface Branch {
  setFlags?: Record<string, boolean>;
  dialogue?: DialogueCue[];
  glass?: GlassLine[];
  hud?: HudItem[];
  sfx?: SfxCue[];
}

export interface Challenge extends Gated {
  id: string;
  from: number;
  to: number;
  /** Shown to the rider while the challenge is live. */
  prompt?: string;
  condition: Condition;
  onSuccess?: Branch;
  onFail?: Branch;
}

export interface Chapter {
  format: 1;
  id: string;
  title: string;
  subtitle?: string;
  season?: number;
  number?: number;
  /** Seconds. Must match the workout's total duration. */
  duration: number;
  assets?: { clips?: string; images?: string };
  workout: { file: string } | { name?: string; steps: StepSpec[] };
  beats?: { t: number; title: string }[];
  dialogue?: DialogueCue[];
  glass?: GlassLine[];
  stills?: Still[];
  hud?: HudItem[];
  scene: SceneTrack;
  sfx?: SfxCue[];
  music?: MusicTrack;
  challenges?: Challenge[];
  /** Author notes pinned to the clock (what we see, what we hear, things to do). Ignored by the runtime. */
  notes?: { t: number; kind?: 'see' | 'hear' | 'todo'; text: string }[];
}

/** Live rider data fed to the runtime each frame. */
export interface RiderData {
  power: number;
  cadence?: number;
  heartRate?: number;
}
