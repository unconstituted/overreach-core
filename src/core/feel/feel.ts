import { approach, clamp, lerp, smoothstep } from '../util/math';

/**
 * The feel layer: the maths that turns raw rider data into "strikes", a
 * peak-hold line and a twitchy speed response. Pure and deterministic, so it
 * can be tuned in tests and ported as-is. Rendering and sound live elsewhere
 * and read `FeelState`.
 *
 * Ported from reference/hud/peak-hold-feel.html.
 */
export interface FeelConfig {
  /** Master switch. When false the HUD shows plain numbers and speed follows effort smoothly. */
  enabled: boolean;
  /** Overall intensity, 0 to 1.5. */
  master: number;
  /** Fraction of FTP at which the HUD "wakes up" (0.76 = 76%). */
  onset: number;
  /** How hard each pedal stroke lands, 0 to 2. */
  punch: number;
  /** How much the numbers gain weight under load, 0 to 1.5. */
  load: number;
  /** Speed kick, overshoot and lean at VO2 and above, 0 to 2. */
  twitch: number;
  /** Held frame when the rider breaks the peak line, milliseconds. */
  stopMs: number;
  /** Stroke sound level. */
  tick: number;
  /** Peak-break sound level. */
  clack: number;
  /** Engine sound level. */
  engine: number;
}

export type FeelPresetName = 'off' | 'restrained' | 'standard' | 'aggressive';

export const FEEL_PRESETS: Record<FeelPresetName, FeelConfig> = {
  off: { enabled: false, master: 0, onset: 0.76, punch: 0, load: 0, twitch: 0, stopMs: 0, tick: 0, clack: 0, engine: 0.6 },
  restrained: { enabled: true, master: 0.7, onset: 0.86, punch: 0.6, load: 0.7, twitch: 0.6, stopMs: 40, tick: 0.45, clack: 0.7, engine: 0.4 },
  standard: { enabled: true, master: 1, onset: 0.76, punch: 1, load: 1, twitch: 1, stopMs: 70, tick: 0.8, clack: 1, engine: 0.6 },
  aggressive: { enabled: true, master: 1.35, onset: 0.68, punch: 1.6, load: 1.3, twitch: 1.7, stopMs: 110, tick: 1.1, clack: 1.3, engine: 0.9 },
};

export interface FeelInput {
  /** Watts. */
  power: number;
  /** rpm. */
  cadence: number;
  /** Current workout target in watts, if any. Speed is judged against it. */
  targetWatts?: number;
}

export interface StrokeEvent {
  type: 'stroke';
  /** Watts on this stroke. */
  watts: number;
  /** Stroke power over the 10 s average. */
  ratio: number;
  /** Strike strength, 0 to about 1.6. */
  pulse: number;
  /** -1, 0, 1, 2 or 3: how far above (or below) the 10 s average, for a trend chevron. */
  trend: number;
}
export interface PeakBreakEvent {
  type: 'peakBreak';
  watts: number;
  /** True when this is also the best of the whole ride. */
  ridePeak: boolean;
}
export interface HoldLostEvent { type: 'holdLost'; strokes: number }
export type FeelEvent = StrokeEvent | PeakBreakEvent | HoldLostEvent;

export interface FeelState {
  /** Power as a fraction of FTP. */
  pct: number;
  /** Intensity: 0 below the onset, rising to 1 (and beyond with a high master) by about 122% FTP. */
  intensity: number;
  /** Last stroke's watts (what the hero number shows). */
  strokeWatts: number;
  /** 10 s rolling average, watts. */
  avg10: number;
  /** Best stroke of the last 30 s, eased, watts. This is the peak-hold line. */
  peak30: number;
  /** Best stroke of the ride, watts. */
  peakRide: number;
  /** True while the rider is at or above the line they just broke. */
  carrying: boolean;
  /** Strike pulse, decays quickly after each stroke. */
  pulse: number;
  /** Whole-HUD jolt, decays after each stroke; spikes on a peak break. */
  jolt: number;
  /** Consecutive strokes at or above the 10 s average. */
  hold: number;
  /** Seconds of hit-stop remaining. */
  freeze: number;
  /** Seconds since the last peak break (large when there has been none). */
  sinceBreak: number;
  /** Seconds of "inverted number" flash remaining after a peak break. */
  invert: number;
  /** Seconds of "RIDE PEAK" label remaining. */
  ridePeakLabel: number;
  /**
   * Speed factor: 1 when the rider is on target, falling towards `idleSpeed`
   * when they stop, a little above 1 when they push over. Multiply the story
   * speed by this for what the rider sees.
   */
  speedFactor: number;
  /** Rate of change of the speed factor per second (drives lean and smear). */
  speedRate: number;
  /** Normalised acceleration, -1 to 1. */
  accel: number;
  /** True at 150% FTP and above: the rev limiter. */
  redline: boolean;
}

interface Stroke { t: number; w: number }

/** Speed factor for a rider who has stopped pedalling. */
export const IDLE_SPEED = 0.12;

/** Where the speed factor settles for a given effort relative to target. */
export function speedTarget(ratio: number): number {
  const r = clamp(ratio, 0, 2);
  const under = IDLE_SPEED + (1 - IDLE_SPEED) * Math.pow(Math.min(1, r), 0.8);
  return under + 0.45 * Math.max(0, Math.min(r, 1.6) - 1);
}

export class FeelEngine {
  readonly state: FeelState;
  private strokes: Stroke[] = [];
  private phase = 0;
  private now = 0;
  private lastBreak = -9;

  constructor(public config: FeelConfig, private readonly ftp: number) {
    this.state = {
      pct: 0, intensity: 0, strokeWatts: 0, avg10: 0, peak30: 0, peakRide: 0, carrying: false, pulse: 0, jolt: 0, hold: 0,
      freeze: 0, sinceBreak: 99, invert: 0, ridePeakLabel: 0, speedFactor: IDLE_SPEED, speedRate: 0, accel: 0, redline: false,
    };
  }

  /** Forget history (after a seek, or when the ride restarts). */
  reset(): void {
    this.strokes = [];
    this.phase = 0;
    this.lastBreak = -9;
    Object.assign(this.state, { avg10: 0, peak30: 0, peakRide: 0, carrying: false, pulse: 0, jolt: 0, hold: 0, freeze: 0, sinceBreak: 99, invert: 0, ridePeakLabel: 0, speedRate: 0, accel: 0 });
  }

  /** Advance by `dt` seconds of ride time. Returns the strokes and peak breaks that happened. */
  update(dt: number, input: FeelInput): FeelEvent[] {
    const events: FeelEvent[] = [];
    const s = this.state;
    const c = this.config;
    this.now += dt;
    const pct = Math.max(0, input.power) / this.ftp;
    s.pct = pct;
    s.redline = pct > 1.5;
    s.intensity = c.enabled ? clamp(smoothstep(c.onset, 1.22, pct) * c.master, 0, 1.5) : 0;
    const I = Math.min(1, s.intensity);

    s.pulse *= Math.exp(-dt * 15);
    s.jolt *= Math.exp(-dt * 11);
    s.invert = Math.max(0, s.invert - dt);
    s.freeze = Math.max(0, s.freeze - dt);
    s.ridePeakLabel = Math.max(0, s.ridePeakLabel - dt);
    s.sinceBreak += dt;

    // Each crank revolution is two strokes.
    this.phase += (Math.max(0, input.cadence) / 60) * 2 * dt;
    let guard = 0;
    while (this.phase >= 1 && guard++ < 8) {
      this.phase -= 1;
      this.stroke(Math.max(0, input.power), events);
    }
    if (this.phase >= 1) this.phase = 0;
    if (input.cadence < 1) this.phase = 0;

    // Speed: a spring towards the effort-based target. Critically damped at
    // low effort; stiffer and underdamped above VO2, so it kicks and overshoots.
    const ratio = input.targetWatts && input.targetWatts > 0 ? input.power / input.targetWatts : pct / 0.6;
    const want = speedTarget(ratio);
    const tw = clamp(I * c.twitch);
    const w0 = lerp(1.3, 8.5, tw);
    const zeta = lerp(1, 0.24, tw);
    const sub = Math.max(1, Math.ceil(dt / 0.02));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) {
      s.speedRate += (w0 * w0 * (want - s.speedFactor) - 2 * zeta * w0 * s.speedRate) * h;
      s.speedFactor = Math.max(0, s.speedFactor + s.speedRate * h);
    }
    s.accel = clamp(s.speedRate / 2.6, -1, 1);

    // The 30 s line snaps up but eases back down as the window moves on.
    let p30 = 0;
    for (const k of this.strokes) if (this.now - k.t <= 30 && k.w > p30) p30 = k.w;
    s.peak30 += (p30 - s.peak30) * approach(dt, p30 > s.peak30 ? 1 / 40 : 1 / 2.5);
    return events;
  }

  private stroke(w: number, events: FeelEvent[]): void {
    const s = this.state;
    const c = this.config;
    const now = this.now;
    const I = s.intensity;
    let sum = 0;
    let n = 0;
    let prev30 = 0;
    for (const k of this.strokes) {
      const age = now - k.t;
      if (age <= 10) { sum += k.w; n++; }
      if (age <= 30 && k.w > prev30) prev30 = k.w;
    }
    const avg = n > 2 ? sum / n : w;
    const ratio = w / Math.max(1, avg);
    this.strokes.push({ t: now, w });
    while (this.strokes.length && now - this.strokes[0].t > 40) this.strokes.shift();
    s.avg10 = avg;
    s.strokeWatts = w;

    // Strike: harder when the stroke beats the rolling average.
    s.pulse = c.enabled ? Math.min(1.6, (0.3 + 0.7 * clamp((ratio - 1) * 8)) * I * c.punch + 0.08) : 0;
    s.jolt = s.pulse * I;
    // A stroke above the average kicks the speed; one below drags it.
    s.speedRate += ((w - avg) / this.ftp) * 1.3 * I * c.twitch;
    const trend = ratio > 1.1 ? 3 : ratio > 1.05 ? 2 : ratio > 1.02 ? 1 : ratio < 0.95 ? -1 : 0;
    events.push({ type: 'stroke', watts: w, ratio, pulse: s.pulse, trend });

    if (I > 0.15 && ratio >= 0.985) s.hold++;
    else {
      if (s.hold >= 8) events.push({ type: 'holdLost', strokes: s.hold });
      s.hold = 0;
    }

    // Peak break: one event when the rider first pushes through the line, then they carry it quietly.
    const over = w > prev30 * 1.012 && this.strokes.length > 14 && I > 0.12;
    if (over && !s.carrying && now - this.lastBreak > 2.5) {
      this.lastBreak = now;
      s.carrying = true;
      const ridePeak = w > s.peakRide && now > 15;
      s.freeze = c.stopMs / 1000;
      s.invert = 0.13;
      s.sinceBreak = 0;
      s.jolt = 1.5;
      if (ridePeak) s.ridePeakLabel = 1.6;
      events.push({ type: 'peakBreak', watts: w, ridePeak });
    } else if (!over) {
      s.carrying = false;
    }
    if (w > s.peakRide) s.peakRide = w;
    s.peak30 = Math.max(prev30, w);
  }
}
