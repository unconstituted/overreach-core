import type { Chapter, HudItem } from '../chapter';
import { stepStarts, totalDuration, type StepSpec, type Workout, type WorkoutStep } from '../workout';
import type { MapDoc } from './types';

/**
 * Chapters made on the fly, so plain workouts and free rides on a map play
 * through the same runtime, HUD and recorder as story chapters.
 */

/** The default look for a plain workout: open space. */
const SPACE_ENV = { top: [0.008, 0.01, 0.03], bot: [0.02, 0.02, 0.06], fog: [0, 0, 0], density: 0, stars: 1, planetRadius: 0.2, planetDir: [0.55, 0.2, -1], night: 0, haze: 0, sun: 1 };
const SPACE_STREAKS = { length: 9000, spreadX: 1500, spreadY: 900, y0: 0, stretch: 0.06, maxStretch: 5000, alpha: 0.9, alphaSpeedRef: 0, color: [0.7, 0.85, 1] };
const AMBIENCE = { engine: [[0, 1]], enginePitchSpeed: [[0, 22]], windBase: [[0, 0.02]], windSpeed: [[0, 0.3]], windSpeedRef: [[0, 4000]], windEffort: [[0, 0.25]], windFreqRef: [[0, 9000]] } as Record<string, [number, number][]>;

function stepSpec(s: WorkoutStep): StepSpec {
  if (s.kind === 'free' || !s.target) return { kind: 'free', duration: s.duration, cadence: s.cadence, label: s.label, intensity: s.intensity, texts: s.texts };
  // A ramp spec carries any unit, so it can represent every kind of targeted step exactly.
  return {
    kind: 'ramp', duration: s.duration, from: s.target.from, to: s.target.to, unit: s.target.unit,
    cadence: s.cadence, erg: s.erg, label: s.label, intensity: s.intensity, texts: s.texts,
  };
}

const frac = (s: WorkoutStep, end: boolean, reference: number): number => {
  if (!s.target) return 0.6;
  const v = end ? s.target.to : s.target.from;
  return (s.target.unit as string) === 'watts' ? v / reference : v;
};

/**
 * A chapter for a standalone workout: no story, the ship cruising through
 * open space at a speed that follows the workout's targets, and the workout's
 * own text events shown on the visor.
 */
export function chapterFromWorkout(id: string, title: string, w: Workout, reference = 250): Chapter {
  const duration = totalDuration(w);
  const starts = stepStarts(w);
  const speed: [number, number][] = [];
  const fov: [number, number][] = [];
  const level: [number, number][] = [];
  const push = (keys: [number, number][], t: number, v: number) => {
    // Keys must strictly increase; a step change becomes a half-second blend.
    const last = keys[keys.length - 1];
    if (last && t <= last[0]) t = Math.min(duration, last[0] + 0.5);
    if (!last || t > last[0]) keys.push([t, v]);
  };
  w.steps.forEach((s, i) => {
    for (const end of [false, true]) {
      const f = Math.max(0.3, frac(s, end, reference));
      const t = end ? starts[i + 1] - 0.5 : starts[i];
      if (end && s.duration <= 1) continue;
      push(speed, t, 250 + 1100 * f * f);
      push(fov, t, 66 + 26 * Math.min(1.3, f));
      push(level, t, f >= 0.95 ? 1 : 0.55 + 0.4 * f);
    }
  });
  const hud: HudItem[] = [
    { type: 'title', from: 1, to: 8, fadeIn: 1.5, fadeOut: 1.5, small: 'WORKOUT', big: title.toUpperCase() },
    { type: 'widget', id: 'canopy', from: 0, to: duration },
    { type: 'widget', id: 'map', from: 0, to: duration },
  ];
  return {
    format: 1, id, title, duration,
    workout: { name: w.name, steps: w.steps.map(stepSpec) },
    beats: w.steps.map((s, i) => ({ t: starts[i], title: s.label ?? s.kind })).filter((b, i, a) => i === 0 || b.title !== a[i - 1].title).slice(0, 40),
    hud,
    scene: {
      segments: [{ from: 0, id: 'space' }], defaultCamera: 'cockpit', speed,
      curves: { fov, fade: [[0, 0], [2, 1], [Math.max(3, duration - 3), 1], [duration, 0]], shake: [[0, 0.05]], blur: [[0, 1]] },
      env: [{ t: 0, values: SPACE_ENV }], streaks: [{ from: 0, values: SPACE_STREAKS }],
    },
    music: {
      bpm: 90,
      sections: [{ from: 0, to: duration, mode: 'main', level, kick: 0.8, hat: 0.6, bass: 0.8, arp: 0.5, pad: 0.7, bright: 0.5 }],
      ambience: AMBIENCE,
    },
  } as Chapter;
}

/** Longest a free ride is allowed to run, seconds. The ride ends sooner, when the map is finished. */
export const FREE_RIDE_LIMIT = 4 * 3600;

/**
 * A chapter for a free ride on a map. Speed and distance are driven by the
 * rider at run time (see `FreeRide` below); the chapter supplies the scene.
 */
export function chapterFromMap(map: MapDoc): Chapter {
  const duration = FREE_RIDE_LIMIT;
  const sc = map.scene;
  return {
    format: 1, id: `map-${map.id}`, title: map.title, subtitle: 'Free ride', duration,
    workout: { name: map.title, steps: [{ kind: 'free', duration, label: 'Free ride' }] },
    hud: [
      { type: 'title', from: 1, to: 8, fadeIn: 1.5, fadeOut: 1.5, small: 'FREE RIDE', big: map.title.toUpperCase() },
      { type: 'widget', id: 'canopy', from: 0, to: duration },
    ],
    scene: {
      segments: [{ from: 0, id: sc.id }], defaultCamera: sc.camera ?? 'cockpit', speed: [[0, 100], [duration, 100]],
      curves: { fov: [[0, sc.fov?.[0] ?? 70]], fade: [[0, 0], [2, 1]], shake: [[0, 0.05]], blur: [[0, 1]] },
      env: sc.env ? [{ t: 0, values: sc.env }] : undefined,
      streaks: sc.streaks ? [{ from: 0, values: sc.streaks }] : undefined,
    },
    music: {
      bpm: 90,
      sections: [{ from: 0, to: duration, mode: 'main', level: 0.7, kick: 0.5, hat: 0.4, bass: 0.7, arp: 0.4, pad: 0.8, bright: 0.45 }],
      ambience: { ...AMBIENCE, windBase: [[0, sc.id === 'ice' ? 0.12 : 0.02]], windSpeedRef: [[0, 200 * (sc.speedScale ?? 12)]] },
    },
  } as Chapter;
}
