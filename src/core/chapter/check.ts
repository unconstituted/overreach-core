import { totalDuration, type Workout } from '../workout';
import { loadChapterWorkout } from './runtime';
import type { Branch, Chapter, Gated, HudItem, Keys } from './types';

export interface CheckOptions {
  workout?: Workout;
  /** Clip ids that exist on disk. When given, unknown clips are reported. */
  clips?: string[];
  /** Image ids that exist on disk. */
  images?: string[];
}

/**
 * Semantic checks the JSON schema cannot express: times inside the chapter,
 * keyframes in order, workout length matching, flags that are never set, and
 * missing assets. Returns a list of problems; empty means the chapter is sound.
 */
export function checkChapter(chapter: Chapter, opts: CheckOptions = {}): string[] {
  const problems: string[] = [];
  const D = chapter.duration;
  const inRange = (t: number, what: string) => {
    if (!(t >= 0 && t <= D)) problems.push(`${what}: time ${t} is outside the chapter (0 to ${D})`);
  };
  const span = (from: number, to: number, what: string) => {
    inRange(from, what);
    inRange(to, what);
    if (!(to > from)) problems.push(`${what}: "to" (${to}) must be after "from" (${from})`);
  };
  const keys = (k: Keys | undefined, what: string) => {
    if (!k) return;
    if (k.length === 0) problems.push(`${what}: has no keyframes`);
    for (let i = 1; i < k.length; i++) if (k[i][0] < k[i - 1][0]) problems.push(`${what}: keyframes out of order at ${k[i][0]}`);
  };

  // Workout
  try {
    const w = opts.workout ?? loadChapterWorkout(chapter);
    const total = totalDuration(w);
    if (Math.abs(total - D) > 0.5) problems.push(`workout: lasts ${total} s but the chapter duration is ${D} s`);
  } catch (e) {
    if ('file' in chapter.workout && !opts.workout) {
      // A file reference cannot be checked here without the file; the caller should pass the parsed workout.
      problems.push(`workout: references ${chapter.workout.file}; pass the parsed workout to check its length`);
    } else problems.push(`workout: ${(e as Error).message}`);
  }

  // Flags
  const setFlags = new Set<string>();
  const collectFlags = (b?: Branch) => Object.keys(b?.setFlags ?? {}).forEach((f) => setFlags.add(f));
  for (const c of chapter.challenges ?? []) { collectFlags(c.onSuccess); collectFlags(c.onFail); }
  const gate = (g: Gated, what: string) => {
    for (const f of [g.if, g.unless]) if (f !== undefined && !setFlags.has(f)) problems.push(`${what}: uses flag "${f}", which no challenge sets`);
  };

  const hudItem = (h: HudItem, what: string, relative: boolean) => {
    gate(h, what);
    if (relative) return;
    if (h.type === 'notice') inRange(h.t, what);
    else span(h.from, h.to, what);
    if (h.type === 'waypoint') {
      if (h.distanceTo !== undefined) inRange(h.distanceTo, `${what} distanceTo`);
      keys(h.value, `${what} value`);
    }
  };

  const clipSet = opts.clips ? new Set(opts.clips) : undefined;
  const imageSet = opts.images ? new Set(opts.images) : undefined;

  (chapter.beats ?? []).forEach((b, i) => {
    inRange(b.t, `beats[${i}]`);
    if (i > 0 && b.t < (chapter.beats as { t: number }[])[i - 1].t) problems.push(`beats[${i}]: out of order`);
  });
  (chapter.dialogue ?? []).forEach((d, i) => {
    inRange(d.t, `dialogue[${i}] (${d.clip})`);
    gate(d, `dialogue[${i}]`);
    if (clipSet && !clipSet.has(d.clip)) problems.push(`dialogue[${i}]: clip "${d.clip}" not found`);
  });
  (chapter.glass ?? []).forEach((g, i) => { inRange(g.t, `glass[${i}]`); gate(g, `glass[${i}]`); });
  (chapter.stills ?? []).forEach((s, i) => {
    span(s.from, s.to, `stills[${i}] (${s.image})`);
    if (imageSet && !imageSet.has(s.image)) problems.push(`stills[${i}]: image "${s.image}" not found`);
  });
  (chapter.hud ?? []).forEach((h, i) => hudItem(h, `hud[${i}] (${h.type})`, false));
  (chapter.sfx ?? []).forEach((s, i) => { inRange(s.t, `sfx[${i}] (${s.id})`); gate(s, `sfx[${i}]`); });

  // Scene
  const sc = chapter.scene;
  if (sc.segments.length === 0) problems.push('scene.segments: at least one segment is needed');
  else if (sc.segments[0].from > 0) problems.push('scene.segments: the first segment must start at 0');
  sc.segments.forEach((s, i) => {
    inRange(s.from, `scene.segments[${i}]`);
    if (i > 0 && s.from <= sc.segments[i - 1].from) problems.push(`scene.segments[${i}]: out of order`);
  });
  (sc.camera ?? []).forEach((c, i) => span(c.from, c.to, `scene.camera[${i}]`));
  keys(sc.speed, 'scene.speed');
  for (const [name, k] of Object.entries(sc.curves ?? {})) keys(k, `scene.curves.${name}`);
  (sc.env ?? []).forEach((e, i) => { if (i > 0 && e.t < (sc.env as { t: number }[])[i - 1].t) problems.push(`scene.env[${i}]: out of order`); });
  (sc.impacts ?? []).forEach((im, i) => inRange(im.t, `scene.impacts[${i}]`));
  for (const [name, t] of Object.entries(sc.markers ?? {})) inRange(t, `scene.markers.${name}`);

  // Music
  (chapter.music?.sections ?? []).forEach((m, i) => {
    span(m.from, m.to, `music.sections[${i}]`);
    const prev = chapter.music?.sections[i - 1];
    if (prev && m.from < prev.to) problems.push(`music.sections[${i}]: overlaps the previous section`);
  });
  for (const [name, k] of Object.entries(chapter.music?.ambience ?? {})) keys(k, `music.ambience.${name}`);

  // Challenges
  const ids = new Set<string>();
  (chapter.challenges ?? []).forEach((c, i) => {
    const what = `challenges[${i}] (${c.id})`;
    span(c.from, c.to, what);
    gate(c, what);
    if (ids.has(c.id)) problems.push(`${what}: duplicate id`);
    ids.add(c.id);
    if (c.condition.hold > c.to - c.from) problems.push(`${what}: needs ${c.condition.hold} s in range but the window is only ${c.to - c.from} s`);
    if (c.condition.min === undefined && c.condition.max === undefined) problems.push(`${what}: condition has neither min nor max`);
    for (const [name, b] of [['onSuccess', c.onSuccess], ['onFail', c.onFail]] as const) {
      (b?.hud ?? []).forEach((h, k) => hudItem(h, `${what}.${name}.hud[${k}]`, true));
      (b?.dialogue ?? []).forEach((d, k) => { if (clipSet && !clipSet.has(d.clip)) problems.push(`${what}.${name}.dialogue[${k}]: clip "${d.clip}" not found`); });
    }
  });

  return problems;
}
