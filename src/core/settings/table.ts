import { FEEL_PRESETS, type FeelConfig } from '../feel';

/**
 * Every setting, declared once. The options menu is generated from this
 * table, the player store validates against it, and the ride reads its
 * configuration through `rideConfig`. Adding an option is adding a row.
 */

export type SettingValue = boolean | number | string;
export type SettingCategory = 'Rider' | 'Training' | 'Display' | 'HUD' | 'Feel' | 'Audio' | 'Devices' | 'Accessibility';
export const SETTING_CATEGORIES: SettingCategory[] = ['Rider', 'Training', 'Display', 'HUD', 'Feel', 'Audio', 'Devices', 'Accessibility'];

interface Base {
  key: string;
  label: string;
  help?: string;
  category: SettingCategory;
  /** Whether a change takes effect during a ride (otherwise from the next ride). */
  midRide: boolean;
  /** Where the value lives: the rider profile, or general settings. */
  store: 'profile' | 'settings';
}
export interface ToggleSetting extends Base { type: 'toggle'; default: boolean }
export interface ChoiceSetting extends Base {
  type: 'choice';
  default: string;
  options: { value: string; label: string }[];
  /** Choosing an option also sets these other settings (used for presets). */
  applies?: Record<string, Record<string, SettingValue>>;
}
export interface NumberSetting extends Base {
  /** "number" is a typed field; "slider" is a drag control. */
  type: 'number' | 'slider';
  default: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  /** Show the value as a duration (m:ss) rather than a plain number. */
  format?: 'pace';
}
export interface TextSetting extends Base { type: 'text'; default: string; maxLength: number }
export type SettingDef = ToggleSetting | ChoiceSetting | NumberSetting | TextSetting;

const FEEL_KEYS: (keyof FeelConfig)[] = ['master', 'onset', 'punch', 'load', 'twitch', 'stopMs', 'tick', 'clack', 'engine'];
const feelPreset = (name: keyof typeof FEEL_PRESETS): Record<string, SettingValue> => {
  const out: Record<string, SettingValue> = {};
  for (const k of FEEL_KEYS) out[`feel.${k}`] = FEEL_PRESETS[name][k] as number;
  return out;
};
const feelParam = (key: keyof FeelConfig, label: string, help: string, min: number, max: number, step: number, unit?: string): NumberSetting => ({
  key: `feel.${key}`, label, help, category: 'Feel', midRide: true, store: 'settings', type: 'slider',
  default: FEEL_PRESETS.standard[key] as number, min, max, step, unit,
});

export const SETTINGS: SettingDef[] = [
  /* ---- Rider (the profile) ---- */
  { key: 'name', label: 'Name', category: 'Rider', midRide: false, store: 'profile', type: 'text', default: 'Pilot', maxLength: 40 },
  { key: 'ftp', label: 'FTP', help: 'Functional threshold power: what you can hold for about an hour. Every workout target is a fraction of this.', category: 'Rider', midRide: false, store: 'profile', type: 'number', default: 250, min: 60, max: 600, step: 1, unit: 'W' },
  { key: 'maxHr', label: 'Max heart rate', category: 'Rider', midRide: false, store: 'profile', type: 'number', default: 185, min: 100, max: 230, step: 1, unit: 'bpm' },
  { key: 'restingHr', label: 'Resting heart rate', category: 'Rider', midRide: false, store: 'profile', type: 'number', default: 55, min: 30, max: 110, step: 1, unit: 'bpm' },
  { key: 'thresholdPace', label: 'Threshold pace', help: 'The running pace you can hold for about an hour. Running targets are a fraction of this.', category: 'Rider', midRide: false, store: 'profile', type: 'number', default: 300, min: 150, max: 600, step: 1, unit: '/km', format: 'pace' },
  { key: 'weight', label: 'Weight', help: 'Used to work out a realistic speed and distance for your ride file.', category: 'Rider', midRide: false, store: 'profile', type: 'number', default: 75, min: 35, max: 200, step: 0.5, unit: 'kg' },
  { key: 'sport', label: 'Usual session', help: 'Whether the screen before a session starts on the bike or on the treadmill. You can switch for any session.', category: 'Rider', midRide: false, store: 'profile', type: 'choice', default: 'bike', options: [{ value: 'bike', label: 'Ride' }, { value: 'run', label: 'Run' }] },
  { key: 'units', label: 'Units', category: 'Rider', midRide: true, store: 'profile', type: 'choice', default: 'metric', options: [{ value: 'metric', label: 'Metric (km, kg)' }, { value: 'imperial', label: 'Imperial (miles, lb)' }] },

  /* ---- Training ---- */
  { key: 'plan.missed', label: 'When you miss a session', help: 'Push: move it to the next free day that week, if there is one that does not put two hard days together. Skip: drop it and carry on.', category: 'Training', midRide: false, store: 'settings', type: 'choice', default: 'push', options: [{ value: 'push', label: 'Push it back' }, { value: 'skip', label: 'Skip it' }] },

  /* ---- Display ---- */
  { key: 'display.camera', label: 'Camera', help: 'Auto follows the chapter. The others hold one view whenever the ship is on screen.', category: 'Display', midRide: true, store: 'settings', type: 'choice', default: 'auto', options: [{ value: 'auto', label: 'Auto' }, { value: 'cockpit', label: 'Cockpit' }, { value: 'chase', label: 'Chase' }] },
  { key: 'display.storyboard', label: 'Storyboard cut-aways', help: 'Short still frames cut into the ride at story moments.', category: 'Display', midRide: true, store: 'settings', type: 'toggle', default: true },

  /* ---- HUD ---- */
  { key: 'hud.position', label: 'HUD position', help: 'Where the numbers sit on the visor.', category: 'HUD', midRide: true, store: 'settings', type: 'choice', default: 'top', options: [{ value: 'top', label: 'Top of visor' }, { value: 'bot', label: 'Bottom of visor' }] },
  { key: 'hud.workoutStrip', label: 'Workout strip', help: 'The workout graph along the bottom of the screen.', category: 'HUD', midRide: true, store: 'settings', type: 'toggle', default: true },

  /* ---- Feel ---- */
  {
    key: 'feel.preset', label: 'Feel', help: 'How strongly the HUD and the ship respond to each pedal stroke. Off shows plain numbers.', category: 'Feel', midRide: true, store: 'settings', type: 'choice', default: 'standard',
    options: [{ value: 'off', label: 'Off' }, { value: 'restrained', label: 'Restrained' }, { value: 'standard', label: 'Standard' }, { value: 'aggressive', label: 'Aggressive' }, { value: 'custom', label: 'Custom' }],
    applies: { off: feelPreset('off'), restrained: feelPreset('restrained'), standard: feelPreset('standard'), aggressive: feelPreset('aggressive') },
  },
  feelParam('master', 'Overall intensity', 'Scales everything below.', 0, 1.5, 0.05),
  feelParam('onset', 'Wakes up at', 'The effort at which the HUD starts to respond, as a fraction of FTP.', 0.5, 1, 0.01, '× FTP'),
  feelParam('punch', 'Stroke punch', 'How hard each pedal stroke lands on the numbers.', 0, 2, 0.05),
  feelParam('load', 'Weight under load', 'How much the numbers thicken as effort rises.', 0, 1.5, 0.05),
  feelParam('twitch', 'Speed twitch', 'Kick, overshoot and lean in the speed at VO2 and above.', 0, 2, 0.05),
  feelParam('stopMs', 'Peak-break hold', 'The held frame when you beat your best of the last 30 seconds.', 0, 150, 5, 'ms'),
  feelParam('tick', 'Stroke sound', '', 0, 1.5, 0.05),
  feelParam('clack', 'Peak-break sound', '', 0, 1.5, 0.05),
  feelParam('engine', 'Engine response', 'How much the engine note follows your effort.', 0, 1.5, 0.05),

  /* ---- Audio ---- */
  { key: 'audio.master', label: 'Master volume', category: 'Audio', midRide: true, store: 'settings', type: 'slider', default: 100, min: 0, max: 100, step: 1, unit: '%' },
  { key: 'audio.dialogue', label: 'Dialogue', category: 'Audio', midRide: true, store: 'settings', type: 'slider', default: 100, min: 0, max: 100, step: 1, unit: '%' },
  { key: 'audio.music', label: 'Music', category: 'Audio', midRide: true, store: 'settings', type: 'slider', default: 100, min: 0, max: 100, step: 1, unit: '%' },
  { key: 'audio.effects', label: 'Effects', category: 'Audio', midRide: true, store: 'settings', type: 'slider', default: 100, min: 0, max: 100, step: 1, unit: '%' },

  /* ---- Devices ---- */
  { key: 'devices.gradeScale', label: 'Trainer difficulty', help: 'How much of a map\'s gradient the trainer feels on free rides. 100% is the true slope; 50% halves every hill.', category: 'Devices', midRide: true, store: 'settings', type: 'slider', default: 50, min: 0, max: 100, step: 5, unit: '%' },

  { key: 'devices.treadmillControl', label: 'Treadmill control', help: 'Let the workout set the treadmill\'s speed and incline. Off: the visor shows the target pace and you set the belt yourself.', category: 'Devices', midRide: true, store: 'settings', type: 'toggle', default: true },
  { key: 'devices.treadmillMaxSpeed', label: 'Treadmill top speed', help: 'The fastest the game will ever set the belt, whatever the workout says. The game never restarts a belt you have stopped.', category: 'Devices', midRide: true, store: 'settings', type: 'number', default: 18, min: 6, max: 25, step: 0.5, unit: 'km/h' },

  /* ---- Accessibility ---- */
  { key: 'access.subtitles', label: 'Subtitles', category: 'Accessibility', midRide: true, store: 'settings', type: 'toggle', default: true },
  { key: 'access.subtitleSize', label: 'Subtitle size', category: 'Accessibility', midRide: true, store: 'settings', type: 'choice', default: 'medium', options: [{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }] },
  { key: 'access.reducedMotion', label: 'Reduce motion', help: 'Turns off screen shake, stroke strikes and the peak-break hold.', category: 'Accessibility', midRide: true, store: 'settings', type: 'toggle', default: false },
  { key: 'access.reduceFlashes', label: 'Reduce flashes', help: 'Removes full-screen flashes and glitch effects.', category: 'Accessibility', midRide: true, store: 'settings', type: 'toggle', default: false },
];

const BY_KEY = new Map(SETTINGS.map((d) => [d.key, d]));

export function settingDef(key: string): SettingDef | undefined {
  return BY_KEY.get(key);
}

/** Default values for one store. */
export function defaultValues(store: 'profile' | 'settings'): Record<string, SettingValue> {
  const out: Record<string, SettingValue> = {};
  for (const d of SETTINGS) if (d.store === store) out[d.key] = d.default;
  return out;
}

/** Force a value into the range and type its definition allows. Returns the default if it cannot. */
export function coerce(def: SettingDef, value: unknown): SettingValue {
  switch (def.type) {
    case 'toggle':
      return typeof value === 'boolean' ? value : def.default;
    case 'choice':
      return typeof value === 'string' && def.options.some((o) => o.value === value) ? value : def.default;
    case 'text':
      return typeof value === 'string' && value.trim() ? value.trim().slice(0, def.maxLength) : def.default;
    case 'number':
    case 'slider': {
      const n = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN;
      if (!Number.isFinite(n)) return def.default;
      const stepped = Math.round((n - def.min) / def.step) * def.step + def.min;
      // Trim floating-point fuzz from the step arithmetic.
      return Math.min(def.max, Math.max(def.min, Math.round(stepped * 1e6) / 1e6));
    }
  }
}

/** A complete, valid set of values for one store: known keys only, each coerced, gaps filled with defaults. */
export function sanitise(store: 'profile' | 'settings', values: Record<string, unknown> | undefined): Record<string, SettingValue> {
  const out: Record<string, SettingValue> = {};
  for (const d of SETTINGS) if (d.store === store) out[d.key] = values && d.key in values ? coerce(d, values[d.key]) : d.default;
  return out;
}

/**
 * Change one setting. Returns the new values (the input is not modified).
 * Handles presets: choosing a preset writes its parameters, and touching a
 * parameter that a preset controls flips that preset to "custom".
 */
export function setValue(values: Record<string, SettingValue>, key: string, value: unknown): Record<string, SettingValue> {
  const def = BY_KEY.get(key);
  if (!def) return values;
  const next = { ...values, [key]: coerce(def, value) };
  if (def.type === 'choice' && def.applies) {
    const extra = def.applies[next[key] as string];
    if (extra) for (const [k, v] of Object.entries(extra)) if (k in next) next[k] = v;
    return next;
  }
  for (const d of SETTINGS) {
    if (d.type !== 'choice' || !d.applies || d.store !== def.store || !(d.key in next)) continue;
    const controls = Object.values(d.applies).some((set) => key in set);
    if (controls && d.options.some((o) => o.value === 'custom')) next[d.key] = 'custom';
  }
  return next;
}

/** Reset every setting in a category to its default. */
export function resetCategory(values: Record<string, SettingValue>, store: 'profile' | 'settings', category: SettingCategory): Record<string, SettingValue> {
  const next = { ...values };
  for (const d of SETTINGS) if (d.category === category && d.store === store) next[d.key] = d.default;
  return next;
}

export function formatSetting(def: SettingDef, value: SettingValue): string {
  if (def.type === 'toggle') return value ? 'On' : 'Off';
  if (def.type === 'choice') return def.options.find((o) => o.value === value)?.label ?? String(value);
  if (def.type === 'text') return String(value);
  if (def.format === 'pace') {
    const s = Math.round(value as number);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} ${def.unit ?? ''}`.trim();
  }
  return `${value}${def.unit ? ` ${def.unit}` : ''}`;
}

/** Everything a ride needs from the player's profile and settings. */
export interface RideConfig {
  ftp: number;
  maxHr: number;
  weight: number;
  /** Threshold running pace, seconds per kilometre. */
  thresholdPace: number;
  /** The same, as a speed in m/s. */
  thresholdSpeed: number;
  /** The player's usual session. */
  sport: 'bike' | 'run';
  treadmillControl: boolean;
  /** Safety limit for the belt, m/s. */
  treadmillMaxSpeed: number;
  units: 'metric' | 'imperial';
  feel: FeelConfig;
  hudPosition: 'top' | 'bot';
  workoutStrip: boolean;
  camera: 'auto' | 'cockpit' | 'chase';
  storyboard: boolean;
  subtitles: boolean;
  subtitleSize: 'small' | 'medium' | 'large';
  reducedMotion: boolean;
  reduceFlashes: boolean;
  /** 0 to 1 each. */
  volume: { master: number; dialogue: number; music: number; effects: number };
  /** 0 to 1: fraction of a map's gradient sent to the trainer. */
  gradeScale: number;
}

export function rideConfig(profile: Record<string, SettingValue>, settings: Record<string, SettingValue>): RideConfig {
  const p = sanitise('profile', profile);
  const s = sanitise('settings', settings);
  const feel = { enabled: s['feel.preset'] !== 'off' } as FeelConfig;
  for (const k of FEEL_KEYS) (feel as unknown as Record<string, number>)[k] = s[`feel.${k}`] as number;
  if (s['access.reducedMotion']) { feel.punch = 0; feel.twitch = 0; feel.stopMs = 0; }
  return {
    ftp: p.ftp as number, maxHr: p.maxHr as number, weight: p.weight as number, thresholdPace: p.thresholdPace as number,
    thresholdSpeed: 1000 / (p.thresholdPace as number), sport: p.sport as RideConfig['sport'],
    treadmillControl: s['devices.treadmillControl'] as boolean, treadmillMaxSpeed: (s['devices.treadmillMaxSpeed'] as number) / 3.6,
    units: p.units as RideConfig['units'], feel,
    hudPosition: s['hud.position'] as RideConfig['hudPosition'], workoutStrip: s['hud.workoutStrip'] as boolean,
    camera: s['display.camera'] as RideConfig['camera'], storyboard: s['display.storyboard'] as boolean,
    subtitles: s['access.subtitles'] as boolean, subtitleSize: s['access.subtitleSize'] as RideConfig['subtitleSize'],
    reducedMotion: s['access.reducedMotion'] as boolean, reduceFlashes: s['access.reduceFlashes'] as boolean,
    volume: {
      master: (s['audio.master'] as number) / 100, dialogue: (s['audio.dialogue'] as number) / 100,
      music: (s['audio.music'] as number) / 100, effects: (s['audio.effects'] as number) / 100,
    },
    gradeScale: (s['devices.gradeScale'] as number) / 100,
  };
}
