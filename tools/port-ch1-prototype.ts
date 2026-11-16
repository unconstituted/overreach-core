/**
 * One-off port: turns the Chapter 1 browser prototype's tables into
 * `chapters/ch1.chapter.json`, and copies its clips and images next to it.
 *
 * Tables that exist as data in the prototype (intervals, speed, cues, glass,
 * stills, environment, field of view, shake, sounds) are read straight from
 * it. Timings that were written inline in the prototype's code (camera roll,
 * HUD windows, music direction) are transcribed by hand below.
 *
 * Run: npx tsx tools/port-ch1-prototype.ts
 * After this, the chapter file is the source of truth: edit it directly.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import type { Chapter, HudItem, Keys, MusicSection } from '../src/core/chapter';
import type { StepSpec } from '../src/core/workout';
import { loadPrototype } from './lib/prototype';

const P = loadPrototype();
const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
/** A step change at `t` from `before` to `after`, as two tight keyframes. */
const stepAt = (t: number, before: number, after: number): Keys => [[round(t - 0.001), before], [t, after]];

/* ---------- workout ---------- */
const steps: StepSpec[] = P.IV.map(([t0, t1, from, to, label, ergOff]) => {
  const base = { duration: t1 - t0, label, ...(ergOff ? { erg: false } : {}) };
  return from === to
    ? { kind: 'steady' as const, power: from / 100, ...base }
    : { kind: 'ramp' as const, from: from / 100, to: to / 100, ...base };
});

/* ---------- dialogue ---------- */
function clipSeconds(clip: string): number | undefined {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0',
      `reference/ch1-prototype/clips/${clip}.mp3`], { encoding: 'utf8' });
    return round(parseFloat(out), 2);
  } catch {
    return undefined; // ffprobe not installed: the runtime falls back to subtitle timing
  }
}
const lengths = new Map<string, number | undefined>();
const dialogue: Chapter['dialogue'] = P.CUES.map((c) => {
  if (!lengths.has(c.c)) lengths.set(c.c, clipSeconds(c.c));
  const duration = lengths.get(c.c);
  return {
    t: c.t, clip: c.c,
    ...(c.g !== undefined && c.g !== 1 ? { gain: c.g } : {}),
    ...(c.rate ? { rate: c.rate } : {}),
    // The prototype sent open-channel chatter during the AI takeover to the reverb.
    ...(c.t > 660 && c.t < 740 ? { reverb: true } : {}),
    ...(duration !== undefined ? { duration } : {}),
    ...(c.subs ? { subs: c.subs.map(([offset, dur, speaker, text]) => ({ offset, duration: dur, speaker, text })) } : {}),
  };
});

/* ---------- HUD (transcribed from hudUpdate) ---------- */
const notes = ['PILOT INPUT REJECTED', 'COURSE DEVIATION 14°', 'RACE CONTROL: NO RESPONSE', 'AI OVERRIDE · UPDATE 76.90', 'OPEN CHANNEL: 3 VOICES', 'COURSE DEVIATION 41°',
  'OPEN CHANNEL: 5 VOICES', 'THRUST LIMITER REMOVED', 'GATE TELEMETRY SYNC ▲▲▲', 'OPEN CHANNEL: 12 VOICES', 'MERIDIAN TRAFFIC: OFFLINE', 'HULL STRESS 91%',
  'WARP RING 7 RETARGETED', 'GATE TELEMETRY: OUT OF RANGE', 'BRACE'];
const noteCurve: Keys = [[661, 0], [680, 3], [700, 5], [740, 12], [770, 15]];
/** The time at which the prototype's notification counter reaches n. */
function noteTime(n: number): number {
  for (let i = 1; i < noteCurve.length; i++) {
    const [t0, v0] = noteCurve[i - 1];
    const [t1, v1] = noteCurve[i];
    if (n <= v1) return round(t0 + ((n - v0) / (v1 - v0)) * (t1 - t0), 2);
  }
  return 770;
}

const hud: HudItem[] = [
  { type: 'title', from: 1.5, to: 15, fadeIn: 2.5, small: 'OVERREACH · SEASON 1', big: 'CHAPTER 1', em: 'The Disaster' },
  { type: 'title', from: 1979, to: 2005, fadeIn: 3, em: 'Nine hours later' },
  // The visor is not on until Holt hands over the helmet; it dies in the warp and reboots on the ice.
  { type: 'hide', from: 0, to: 183, elements: ['all'] },
  { type: 'effect', id: 'flicker', from: 183, to: 190 },
  { type: 'widget', id: 'boot', from: 183, to: 214, params: { fadeFrom: 208, rate: 1.1, lines: [
    'VISOR OS · COLD START', 'OPTICS ......... OK', 'BIOMETRICS ..... OK', 'UPDATE 76.90 · AS 0812 (EARTH 2826)', 'CHANGELOG:',
    '· Gate telemetry sync', '· Pilot override (emergency)', '· Minor fixes', 'SHIP 07 “DIVERS” MARKED ▸'] } },
  { type: 'hide', from: 0, to: 300, elements: ['speed'] },
  { type: 'waypoint', from: 214, to: 300, label: 'SHIP 07', value: [[214, 140], [299, 4]], unit: 'm', x: 58, y: 44 },
  { type: 'widget', id: 'map', from: 214, to: 776 },
  { type: 'widget', id: 'canopy', from: 306, to: 780 },
  { type: 'widget', id: 'call', from: 330, to: 428, params: { name: 'SARAH', detail: 'OBS DECK 4 · ENGINEERING', connectAt: 334, lostAt: 425.5 } },
  { type: 'waypoint', from: 584, to: 660, label: 'START LINE', distanceTo: 668, unit: 'km', x: 50, y: 47 },
  { type: 'banner', from: 657, to: 776, text: 'AI CONTROL', tone: 'warning', blink: true },
  ...notes.map((text, i): HudItem => ({ type: 'notice', t: noteTime(i + 1), hold: round(776 - noteTime(i + 1), 2), kind: 'warning', text })),
  { type: 'widget', id: 'boost', from: 736, to: 772, params: { fillFrom: 740, fillTo: 768 } },
  { type: 'effect', id: 'tear', from: 770, to: 776 },
  { type: 'hide', from: 776, to: 990, elements: ['all'] },
  { type: 'hide', from: 776, to: 1050, elements: ['cadence'] },
  { type: 'hide', from: 776, to: 1110, elements: ['power'] },
  { type: 'widget', id: 'weird', from: 786, to: 896, params: { images: ['thin-2', 'thin-4', 'gate-2', 's14', 's06'], fadeIn: 3, fadeOut: 4 } },
  { type: 'widget', id: 'fog', from: 895, to: 1912 },
  { type: 'widget', id: 'canopy', from: 897, to: 2098 },
  { type: 'widget', id: 'heat', from: 900, to: 1895, params: { maskedFrom: 1320, maskedTo: 1410 } },
  { type: 'hide', from: 990, to: 1110, elements: ['speed'] },
  { type: 'widget', id: 'map', from: 1170, to: 1895 },
  { type: 'waypoint', from: 1242, to: 1320, label: 'COVER', distanceTo: 1322, unit: 'km', decimals: 1, x: 50, y: 46 },
  { type: 'waypoint', from: 1446, to: 1530, label: 'FROZEN WAVE', distanceTo: 1620, unit: 'km', x: 50, y: 45 },
  { type: 'widget', id: 'tag', from: 1574, to: 1616, params: { anchor: 'downedShip', lines: [
    { until: 1600, text: 'RACER · LIFE SIGNS 1\nTAGGED FOR RESCUE' }, { text: 'DIVERS 04 · FROBISHER\nTEAM-MATE MARKER SAVED' }] } },
  { type: 'waypoint', from: 1640, to: 1858, label: 'CREST', distanceTo: 1862, unit: 'km', decimals: 1,
    extra: { label: 'GRADIENT', value: [[1620, 6], [1700, 11], [1800, 14], [1860, 19]], unit: '%' }, x: 50, y: 40 },
  { type: 'widget', id: 'modes', from: 1766, to: 1800, params: { fadeIn: 1, fadeOut: 3,
    lines: ['◬ NEW FLIGHT MODES INITIALISED ◬', 'ASCENT · VACUUM BURN · ⟟⏃⏁⟒ ⌰⟟⋏☍'] } },
  { type: 'effect', id: 'alt', from: 1770, to: 2100 },
  { type: 'effect', id: 'gate-flash', from: 1771, to: 1773.2 },
  { type: 'effect', id: 'gate-flash', from: 1782, to: 1782.5 },
  { type: 'waypoint', from: 2066, to: 2090, label: 'DESTINATION · THE GATE', x: 50, y: [[2060, 70], [2084, 40]] },
];

/* ---------- scene ---------- */
const ENV_RENAME: Record<string, string> = { dens: 'density', pRad: 'planetRadius', pDir: 'planetDir' };
const env = P.ENVK.map(([t, v]) => ({ t, values: Object.fromEntries(Object.entries(v).map(([k, x]) => [ENV_RENAME[k] ?? k, x])) }));

const scene: Chapter['scene'] = {
  segments: [
    { from: 0, id: 'stills' }, { from: 300, id: 'tunnel' }, { from: 497, id: 'space' }, { from: 780, id: 'blackout' },
    { from: 984, id: 'ice' }, { from: 1866, id: 'ascent' }, { from: 1940, id: 'orbit' }, { from: 2099, id: 'end' },
  ],
  defaultCamera: 'cockpit',
  camera: [
    { from: 570, to: 626, mode: 'chase' }, { from: 1176, to: 1228, mode: 'chase' }, { from: 1446, to: 1524, mode: 'chase' },
    { from: 1684, to: 1736, mode: 'chase' }, { from: 1808, to: 1850, mode: 'chase' },
  ],
  speed: P.SPD,
  env,
  curves: {
    fov: P.FOVK,
    shake: P.SHAKEK,
    roll: [[560, 0], [572, 0.5], [590, 0.1], [600, 0], [657, 0], [662, 1.0], [680, 0.55], [700, -0.7], [720, -0.3], [738, 0.9], [760, 0.25], [770, 0],
      [983.99, 0], [984, 0.14], [1050, 0.14], [1066, 0]],
    yaw: [[560, 0], [580, -0.5], [640, -0.6], [655, -0.6], [655.01, 0], [660, 0], [680, 0.8], [700, 1.0], [720, 1.9], [740, 2.2], [770, 3.0], [780, 3.0], [780.01, 0]],
    climb: [[1612, 0], [1640, 0.1], [1800, 0.17], [1858, 0.24], [1866, 0.55], [1900, 0.8], [1936, 0.25], [1950, 0]],
    camLift: [[984, -1.8], [1050, -1.8], [1066, 3], [1110, 0]],
    weave: [[1438, 0], [1441, 1], [1529, 1], [1532, 0]],
    orbit: [[570, 0], [580, 1.9], [600, 2.35], [616, 1.2], [626, 0]],
    orbitRadius: [[569.99, 0], [570, 9], [582, 46], [606, 60], [626, 9], [626.01, 0]],
    fade: [[300, 0], [308, 1], [1974, 1], [1979, 0], [2005, 0], [2010, 1], [2096, 1], [2098.5, 0]],
    glitch: [[659.99, 0], [660, 0.6], [661, 0.6], [661.01, 0], [769.99, 0], [770, 1], [780, 1], [780.01, 0], [1769.99, 0], [1770, 0.5], [1772.6, 0.5], [1772.61, 0]],
    flash: [[772, 0], [774.5, 1.6], [780, 1.6], [780.01, 0]],
    blur: [[330, 0.03], [420, 0.1], [478, 0.23], [492, 1], [780, 1], [780.01, 0], [1066, 0], [1066.01, 1]],
    alt: [[1768, 0], [1772, 1], [1890, 1], [1900, 0]],
    crack: [[1640, 0], [1700, 1]],
    skyLights: [[1940, 0], [1940.01, 1]],
    doors: [[420, 0], [436, 1]],
    glassFog: [[895, 0], [902, 0.84], [990, 0.84], [1050, 0.55], [1110, 0.14], [1170, 0]],
    glassThaw: [[988, 0], [1050, 1]],
  },
  impacts: P.IMPACTS.map(([t, strength]) => ({ t, strength, ...(t === 1862 ? { flash: false } : {}) }))
    .concat([{ t: 1241, strength: 0.25, flash: false }])
    .sort((a, b) => a.t - b.t),
  markers: {
    tunnelEnd: 497, startLine: 668, aiOverride: 660, racersFrom: 540, warpRing: 770, iceStart: 990, wreckStart: 1322, wreckEnd: 1406,
    weaveStart: 1436, cratersStart: 1440, cratersEnd: 1530, weaveEnd: 1534, downedShip: 1592, frozenWave: 1620, crest: 1862,
  },
  props: [
    { type: 'warpRing', from: 728, to: 770.05, at: 770, params: { igniteFrom: 762, igniteTo: 770 } },
    { type: 'meteor', from: 1224, to: 1232, at: 1322, params: { offset: 900, x: 0, size: 420, origin: [5200, 9000, 2000] } },
    { type: 'meteor', from: 1403, to: 1410, at: 1421, params: { x: 330, size: 150, origin: [-2600, 5200, 3000] } },
    { type: 'hangarChunk', from: 1519, to: 1534, at: 1548, params: { x: -1900, origin: [1600, 5200, 2500], linger: 40 } },
    { type: 'steamColumn', from: 1232, at: 1322, params: { offset: 900, x: 0, radius: 1700, height: 8000, count: 22, growth: 14 } },
    { type: 'steamColumn', from: 1410, at: 1421, params: { x: 330, radius: 330, height: 1700, count: 14, growth: 5 } },
    { type: 'steamColumn', from: 1534, at: 1548, params: { x: -1900, radius: 400, height: 3600, count: 18, growth: 5 } },
    { type: 'downedShip', at: 1592, params: { x: 30, signal: '1010100011101110111000101010000000', signalRate: 3.2 } },
    { type: 'gate', from: 2052, params: { approachFrom: 2056, approachTo: 2083 } },
  ],
  streaks: [
    { from: 300, values: { length: 500, spreadX: 17, spreadY: 9, y0: 8, stretch: 0.04, alpha: 0.5, alphaSpeedRef: 20, color: [0.7, 0.85, 1] } },
    { from: 498, values: { length: 2500, spreadX: 380, spreadY: 240, y0: 0, stretch: 0.07, alpha: 0.9, alphaSpeedRef: 0, color: [0.7, 0.85, 1] } },
    { from: 545, values: { length: 9000, spreadX: 1500, spreadY: 900, y0: 0, stretch: 0.06, maxStretch: 5000, alpha: 0.9, alphaSpeedRef: 0, color: [0.7, 0.85, 1] } },
    { from: 780, values: { length: 1800, spreadX: 420, spreadY: 60, y0: 62, stretch: 0.045, alpha: 0.5, alphaSpeedRef: 60, color: [0.9, 0.95, 1] } },
    { from: 1620, values: { length: 1800, spreadX: 420, spreadY: 30, y0: 30, stretch: 0.045, alpha: 0.9, alphaSpeedRef: 0, color: [1, 1, 1] } },
    { from: 1866, values: { length: 2500, spreadX: 700, spreadY: 500, y0: 0, stretch: 0.05, alpha: 0.8, alphaSpeedRef: 0, color: [1, 1, 1] } },
    { from: 1940, values: { length: 20000, spreadX: 4000, spreadY: 2500, y0: 0, stretch: 0.02, alpha: 0.35, alphaSpeedRef: 0, color: [0.7, 0.85, 1] } },
  ],
};

/* ---------- music (transcribed from musicAt and audioUpdate) ---------- */
const L2: Keys = [[478, 0], [486, 0.7], [566, 0.8], [572, 1], [622, 1], [630, 0]];
const B2: Keys = [[478, 0.2], [570, 0.8], [630, 0.5]];
const sec2 = { level: L2, pad: 1, arp: stepAt(500.001, 0.3, 0.8), bass: stepAt(520.001, 0, 0.6), kick: [[540, 0], [540.001, 0.5], [569.999, 0.5], [570, 0]] as Keys, bright: B2 };
const L7: Keys = [[1440, 0.5], [1525, 0.95], [1534, 1]];
const B7: Keys = [[1440, 0.3], [1534, 0.9]];
const sec7 = { level: L7, pad: 1, bass: 1, arp: 1, kick: stepAt(1470.001, 0, 1), hat: stepAt(1500.001, 0, 1), bright: B7 };
const L8: Keys = [[1620, 0], [1632, 0.6], [1860, 1], [1888, 1], [1891, 0]];
const B8: Keys = [[1620, 0.3], [1860, 0.8], [1865, 1]];
const sec8 = { level: L8, kick: 1, bass: 1, pad: 0.8, arp: stepAt(1680.001, 0.4, 1), hat: stepAt(1740.001, 0, 1), bright: B8 };
const L9: Keys = [[1946, 0], [1960, 0.55], [1974, 0.2], [2008, 0.2], [2030, 0.45], [2058, 0.8], [2076, 1], [2086, 0.7], [2094, 0]];
const B9: Keys = [[1946, 0.3], [2056, 0.4], [2076, 0.9], [2094, 0.2]];
const sections: MusicSection[] = [
  { from: 100, to: 430, mode: 'main', party: true, level: [[100, 0], [102, 1], [296, 1], [304, 0.55], [420, 0.3], [430, 0]], kick: 1, hat: 1, bass: 1, arp: 0.8, pad: 0.3, bright: 0.7 },
  { from: 478, to: 568, mode: 'main', ...sec2 },
  { from: 568, to: 630, mode: 'hope', ...sec2 },
  { from: 630, to: 660, mode: 'tense', level: 0.8, pad: 1, bass: 0.5, bright: 0.25 },
  { from: 660, to: 771, mode: 'dark', fast: true, level: 1, kick: 1, hat: 1, bass: 1, arp: 1, pad: 0.6, bright: [[660, 0.5], [770, 1]] },
  { from: 1168, to: 1290, mode: 'dark', level: [[1168, 0], [1180, 0.5], [1290, 0.55]], pad: 1, arp: 0.25, bright: 0.3 },
  { from: 1290, to: 1410, mode: 'dark', level: 0.75, pad: 0.8, bass: 1, kick: stepAt(1320, 1, 0.4), hat: stepAt(1320, 1, 0), arp: stepAt(1320, 0.9, 0.2), bright: stepAt(1320, 0.7, 0.15) },
  { from: 1410, to: 1440, mode: 'dark', fast: true, level: 0.75, pad: 0.8, bass: 1, kick: 1, hat: 1, arp: 0.9, bright: 0.7 },
  { from: 1440, to: 1530, mode: 'main', ...sec7 },
  { from: 1530, to: 1534.3, mode: 'main', fast: true, ...sec7 },
  { from: 1620, to: 1770, mode: 'main', ...sec8 },
  { from: 1770, to: 1860, mode: 'hope', ...sec8 },
  { from: 1860, to: 1891, mode: 'hope', fast: true, ...sec8 },
  { from: 1946, to: 2056.001, mode: 'dark', level: L9, pad: 1, arp: 0.12, bright: B9 },
  { from: 2056.001, to: 2094, mode: 'tense', level: L9, pad: 1, arp: [[2085.999, 0.6], [2086, 0.12]], bass: [[2083.999, 0.5], [2084, 0]], bright: B9 },
];

const ambience: Record<string, Keys> = {
  ring: [[772, 0], [774, 0.05], [790, 0.035], [860, 0.012], [900, 0.004], [990, 0]],
  drone: [[772, 0], [782, 0.12], [890, 0.09], [905, 0.03], [990, 0], [1946, 0], [1960, 0.1], [2090, 0.14], [2098, 0]],
  shepard: [[733, 0], [737, 0.22], [770, 0.22], [770.2, 0]],
  shepardFreq: [[733, 70], [760, 300], [770, 1500]],
  shepardCutoff: [[733, 200], [770, 4200]],
  hangar: [[40, 0], [96, 0.12], [100, 0.16], [101, 0.85], [296, 0.8], [299, 0.22], [420, 0.14], [470, 0.05], [490, 0]],
  hangarCutoff: [[99.99, 500], [100, 16000], [295.99, 16000], [296, 480]],
  murmur: [[786, 0], [792, 0.28], [889, 0.28], [895, 0]],
  hiss: [[1317.5, 0], [1318, 0.07], [1410, 0.07], [1410.5, 0]],
  musicCutoff: [[99.99, 300], [100, 9000], [295.99, 9000], [296, 420], [429.99, 420], [430, 16000]],
  musicTrim: [[659.99, 1], [660, 0.75], [771, 0.75], [771.01, 1]],
  engine: [[300, 0], [320, 1], [772, 1], [772.01, 0], [992, 0], [1032, 1], [2099, 1]],
  engineTrim: [[1936, 1], [1936.01, 0.5]],
  enginePitchSpeed: [[477.99, 0], [478, 22], [772, 22], [772.01, 0]],
  windBase: [[990, 0], [1020, 0.12], [1936, 0.12], [1936.01, 0.05]],
  windSpeed: [[477.99, 0], [478, 0.35], [779.99, 0.35], [780, 0], [990, 0], [1020, 0.55], [1936, 0.55], [1936.01, 0]],
  windSpeedRef: [[779.99, 4000], [780, 450]],
  windEffort: [[477.99, 0], [478, 0.25], [779.99, 0.25], [780, 0]],
  windFreqRef: [[779.99, 9000], [780, 500]],
  rumble: [[479.99, 0], [480, 0.5], [500, 0.5], [500.01, 0], [1619.99, 0], [1620, 0.25], [1866, 0.25], [1866.01, 0]],
};

const chapter: Chapter = {
  format: 1,
  id: 'ch1',
  title: 'The Disaster',
  subtitle: 'Overreach · Season 1 · Chapter 1',
  season: 1,
  number: 1,
  duration: P.DUR,
  assets: { clips: 'ch1/clips', images: 'ch1/images' },
  workout: { name: 'Chapter 1 · The Disaster', steps },
  beats: P.BEATS.map(([t, title]) => ({ t, title })),
  dialogue,
  glass: P.GLASS.map(([t, text, hold]) => ({ t, text, hold })),
  stills: P.STILLS.map((s) => ({
    image: s.i, from: s.a, to: s.b, fadeIn: s.fi, fadeOut: s.fo, start: s.f, end: s.t,
    ...(s.o ? { origin: s.o } : {}), ...(s.rot ? { rotate: s.rot } : {}), ...(s.visor ? { visor: true } : {}), ...(s.ins ? { insert: true } : {}),
  })),
  hud,
  scene,
  sfx: P.sfx.map((s) => ({ t: round(s.t), id: s.id, ...(s.args.length ? { args: s.args.map((a) => round(a)) } : {}) })).sort((a, b) => a.t - b.t),
  music: { bpm: 90, sections, ambience },
};

/* ---------- write (compact arrays, one item per line) ---------- */
function fmt(v: unknown, indent = ''): string {
  if (Array.isArray(v)) {
    const flat = JSON.stringify(v);
    const simple = v.every((x) => typeof x !== 'object' || x === null || (Array.isArray(x) && x.every((y) => typeof y !== 'object')));
    if (simple && flat.length <= 140) return flat.replace(/,/g, ', ');
    return `[\n${v.map((x) => `${indent}  ${fmt(x, indent + '  ')}`).join(',\n')}\n${indent}]`;
  }
  if (v && typeof v === 'object') {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined);
    const flat = `{ ${entries.map(([k, x]) => `${JSON.stringify(k)}: ${JSON.stringify(x)}`).join(', ')} }`;
    const deep = entries.some(([, x]) => x && typeof x === 'object' && JSON.stringify(x).length > 90);
    if (!deep && flat.length <= 170) return flat;
    return `{\n${entries.map(([k, x]) => `${indent}  ${JSON.stringify(k)}: ${fmt(x, indent + '  ')}`).join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(v);
}

mkdirSync('chapters/ch1/clips', { recursive: true });
mkdirSync('chapters/ch1/images', { recursive: true });
for (const f of readdirSync('reference/ch1-prototype/clips')) copyFileSync(`reference/ch1-prototype/clips/${f}`, `chapters/ch1/clips/${f}`);
for (const f of readdirSync('reference/ch1-prototype/img')) copyFileSync(`reference/ch1-prototype/img/${f}`, `chapters/ch1/images/${f}`);
writeFileSync('chapters/ch1.chapter.json', fmt({ $schema: '../schemas/chapter.schema.json', ...chapter }) + '\n');
console.log(`Wrote chapters/ch1.chapter.json: ${steps.length} steps, ${dialogue.length} dialogue cues, ${chapter.sfx?.length} sounds, ${hud.length} HUD items.`);
