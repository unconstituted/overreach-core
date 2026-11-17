import { describe, expect, it } from 'vitest';
import { FEEL_PRESETS } from '../../src/core/feel';
import {
  coerce, defaultValues, formatSetting, resetCategory, rideConfig, sanitise, SETTING_CATEGORIES, settingDef, SETTINGS, setValue,
  type NumberSetting,
} from '../../src/core/settings';

describe('settings table', () => {
  it('has unique keys, a known category and a valid default for every row', () => {
    const keys = new Set<string>();
    for (const d of SETTINGS) {
      expect(keys.has(d.key), d.key).toBe(false);
      keys.add(d.key);
      expect(SETTING_CATEGORIES).toContain(d.category);
      expect(coerce(d, d.default), d.key).toBe(d.default);
      expect(d.label.length).toBeGreaterThan(0);
    }
  });
  it('covers every category the brief lists', () => {
    for (const c of ['Rider', 'Display', 'HUD', 'Feel', 'Audio', 'Devices', 'Accessibility']) {
      expect(SETTINGS.some((d) => d.category === c), c).toBe(true);
    }
  });
  it('preset rows only refer to settings that exist, with values in range', () => {
    for (const d of SETTINGS) {
      if (d.type !== 'choice' || !d.applies) continue;
      for (const [option, set] of Object.entries(d.applies)) {
        expect(d.options.some((o) => o.value === option)).toBe(true);
        for (const [k, v] of Object.entries(set)) {
          const target = settingDef(k);
          expect(target, k).toBeDefined();
          expect(coerce(target as NumberSetting, v), `${option} ${k}`).toBe(v);
        }
      }
    }
  });
});

describe('coercion', () => {
  const ftp = settingDef('ftp') as NumberSetting;
  it('clamps and steps numbers, and falls back to the default for rubbish', () => {
    expect(coerce(ftp, 9999)).toBe(600);
    expect(coerce(ftp, 5)).toBe(60);
    expect(coerce(ftp, '262.4')).toBe(262);
    expect(coerce(ftp, 'abc')).toBe(250);
    expect(coerce(settingDef('weight') as NumberSetting, 70.26)).toBe(70.5);
    expect(coerce(settingDef('feel.onset') as NumberSetting, 0.8049)).toBe(0.8);
  });
  it('checks choices, toggles and text', () => {
    expect(coerce(settingDef('units')!, 'furlongs')).toBe('metric');
    expect(coerce(settingDef('units')!, 'imperial')).toBe('imperial');
    expect(coerce(settingDef('access.subtitles')!, 'yes')).toBe(true);
    expect(coerce(settingDef('access.subtitles')!, false)).toBe(false);
    expect(coerce(settingDef('name')!, '   ')).toBe('Pilot');
    expect(coerce(settingDef('name')!, `  ${'x'.repeat(80)}`)).toHaveLength(40);
  });
  it('sanitise drops unknown keys and fills gaps', () => {
    const s = sanitise('settings', { 'hud.position': 'bot', 'audio.music': 250, nonsense: 1 });
    expect(s['hud.position']).toBe('bot');
    expect(s['audio.music']).toBe(100);
    expect('nonsense' in s).toBe(false);
    expect(Object.keys(s).sort()).toEqual(Object.keys(defaultValues('settings')).sort());
    expect('ftp' in s).toBe(false);
  });
});

describe('changing settings', () => {
  const base = defaultValues('settings');
  it('a preset writes its parameters', () => {
    const s = setValue(base, 'feel.preset', 'aggressive');
    expect(s['feel.punch']).toBe(FEEL_PRESETS.aggressive.punch);
    expect(s['feel.stopMs']).toBe(FEEL_PRESETS.aggressive.stopMs);
    expect(base['feel.punch']).toBe(FEEL_PRESETS.standard.punch);
  });
  it('touching a parameter flips the preset to custom', () => {
    const s = setValue(base, 'feel.punch', 1.4);
    expect(s['feel.preset']).toBe('custom');
    expect(s['feel.punch']).toBe(1.4);
    expect(setValue(base, 'audio.music', 40)['feel.preset']).toBe('standard');
  });
  it('resets one category and leaves the rest', () => {
    let s = setValue(base, 'audio.music', 20);
    s = setValue(s, 'hud.position', 'bot');
    const r = resetCategory(s, 'settings', 'Audio');
    expect(r['audio.music']).toBe(100);
    expect(r['hud.position']).toBe('bot');
  });
  it('ignores unknown keys', () => {
    expect(setValue(base, 'no.such', 1)).toBe(base);
  });
  it('formats values for display', () => {
    expect(formatSetting(settingDef('thresholdPace')!, 285)).toBe('4:45 /km');
    expect(formatSetting(settingDef('ftp')!, 250)).toBe('250 W');
    expect(formatSetting(settingDef('units')!, 'imperial')).toBe('Imperial (miles, lb)');
    expect(formatSetting(settingDef('access.subtitles')!, false)).toBe('Off');
  });
});

describe('ride configuration', () => {
  it('builds the standard configuration from defaults', () => {
    const c = rideConfig(defaultValues('profile'), defaultValues('settings'));
    expect(c).toMatchObject({ ftp: 250, maxHr: 185, hudPosition: 'top', subtitles: true, camera: 'auto', gradeScale: 0.5 });
    expect(c.feel).toEqual(FEEL_PRESETS.standard);
    expect(c.volume).toEqual({ master: 1, dialogue: 1, music: 1, effects: 1 });
  });
  it('off disables the feel layer; reduced motion removes strikes, twitch and hit-stop', () => {
    expect(rideConfig({}, setValue(defaultValues('settings'), 'feel.preset', 'off')).feel.enabled).toBe(false);
    const c = rideConfig({}, setValue(defaultValues('settings'), 'access.reducedMotion', true));
    expect(c.reducedMotion).toBe(true);
    expect(c.feel).toMatchObject({ enabled: true, punch: 0, twitch: 0, stopMs: 0, load: 1 });
  });
  it('survives junk input', () => {
    const c = rideConfig({ ftp: 'lots' }, { 'audio.master': -5 } as never);
    expect(c.ftp).toBe(250);
    expect(c.volume.master).toBe(0);
  });
});
