import { describe, expect, it } from 'vitest';
import { MemoryBackend, migrate, newPlayer, PLAYER_VERSION, PlayerStore, type RideRecord } from '../../src/core/player';
import { setValue } from '../../src/core/settings';
import { fromBase64, toBase64 } from '../../src/core/util/base64';
import { addDays, dayNumber, daysBetween, formatDate, fromDayNumber, weekday } from '../../src/core/util/date';

const ride = (id: string, extra: Partial<RideRecord> = {}): RideRecord => ({
  id, date: '2026-11-17T18:00', sport: 'bike', kind: 'workout', ref: 'workout:long-haul', title: 'Long Haul', complete: true, ftp: 250,
  duration: 2700, distance: 21000, kilojoules: 450, avgPower: 166, normalisedPower: 170, intensity: 0.68, stress: 35, hasFit: true, ...extra,
});

describe('dates', () => {
  it('round-trips day numbers, including leap days and year ends', () => {
    expect(dayNumber('1970-01-01')).toBe(0);
    expect(dayNumber('2000-03-01')).toBe(11017);
    for (const d of ['2024-02-29', '2026-11-17', '2026-12-31', '2027-01-01', '1999-12-31', '2100-03-01']) expect(fromDayNumber(dayNumber(d))).toBe(d);
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
    expect(addDays('2026-12-30', 5)).toBe('2027-01-04');
    expect(daysBetween('2026-11-17', '2026-12-01')).toBe(14);
  });
  it('knows the weekday', () => {
    expect(weekday('2026-11-17')).toBe(2); // a Tuesday
    expect(weekday('2026-11-22')).toBe(7);
    expect(weekday('1970-01-01')).toBe(4);
    expect(formatDate('2026-11-17')).toBe('Tuesday 17 November');
    expect(formatDate('2026-11-17', true)).toBe('Tue 17 Nov');
  });
});

describe('base64', () => {
  it('round-trips every length and byte value', () => {
    for (let n = 0; n < 70; n++) {
      const b = new Uint8Array(n).map((_, i) => (i * 37 + n * 11) & 255);
      expect([...fromBase64(toBase64(b))]).toEqual([...b]);
    }
    expect(toBase64(new Uint8Array([77, 97, 110]))).toBe('TWFu');
    expect(toBase64(new Uint8Array([77]))).toBe('TQ==');
  });
});

describe('player store', () => {
  it('starts a new player with defaults when nothing is saved', async () => {
    const r = await new PlayerStore(new MemoryBackend()).load();
    expect(r.fresh).toBe(true);
    expect(r.data).toEqual(newPlayer());
    expect(r.data.profile.ftp).toBe(250);
  });
  it('saves and loads', async () => {
    const store = new PlayerStore(new MemoryBackend());
    const data = newPlayer();
    data.profile.ftp = 285;
    data.settings = setValue(data.settings, 'feel.preset', 'aggressive');
    data.history.push(ride('r1'));
    data.progress.chapters.ch1 = { completedOn: '2026-11-17', count: 1 };
    await store.save(data);
    const back = await store.load();
    expect(back.fresh).toBe(false);
    expect(back.data).toEqual(data);
  });
  it('round-trips everything through export and import, ride files included', async () => {
    const a = new PlayerStore(new MemoryBackend());
    const data = newPlayer();
    data.profile.name = 'Crush';
    data.progress.totals = { rides: 2, time: 5400, distance: 42000, kilojoules: 900 };
    data.progress.flags['season-1'] = { clampLocked: true };
    data.progress.activePlan = { plan: 'base-builder', startDate: '2026-11-16', trainingDays: [2, 4, 6], completed: { w1d1s0: { ride: 'r1', date: '2026-11-17' } }, skipped: {}, moved: {}, swaps: {} };
    data.history = [ride('r2', { hasFit: false }), ride('r1')];
    const fit = new Uint8Array(5000).map((_, i) => (i * 7) & 255);
    await a.putFit('r1', fit);
    await a.save(data);
    const json = await a.exportAll(data, '2026-11-17T19:00');

    const b = new PlayerStore(new MemoryBackend());
    await b.putFit('stale', new Uint8Array([1]));
    const imported = await b.importAll(json);
    expect(imported).toEqual(data);
    expect((await b.load()).data).toEqual(data);
    expect([...(await b.getFit('r1') as Uint8Array)]).toEqual([...fit]);
    expect(await b.getFit('stale')).toBeUndefined();
    expect(await b.getFit('r2')).toBeUndefined();
    // And the export of the import is the same document.
    expect(JSON.parse(await b.exportAll(imported, '2026-11-17T19:00'))).toEqual(JSON.parse(json));
  });
  it('refuses files that are not exports', async () => {
    const s = new PlayerStore(new MemoryBackend());
    await expect(s.importAll('not json')).rejects.toThrow('not valid JSON');
    await expect(s.importAll('{"app":"zwift"}')).rejects.toThrow('not an Overreach export');
  });
  it('keeps an unreadable save aside rather than overwriting it', async () => {
    const backend = new MemoryBackend();
    backend.map.set('player', '{broken');
    const r = await new PlayerStore(backend).load();
    expect(r.fresh).toBe(true);
    expect(r.problem).toContain('could not be read');
    expect(backend.map.get('player.unreadable')).toBe('{broken');
  });
  it('reports storage that throws', async () => {
    const backend = new MemoryBackend();
    backend.get = async () => { throw new Error('denied'); };
    const r = await new PlayerStore(backend).load();
    expect(r.problem).toContain('denied');
    expect(r.data.profile.ftp).toBe(250);
  });
});

describe('migrations', () => {
  it('upgrades the Stage 5 settings (version 1, unversioned) to the current shape', () => {
    const d = migrate({ ftp: 301, maxHr: 178, feel: 'aggressive', hudPos: 'bot' });
    expect(d.version).toBe(PLAYER_VERSION);
    expect(d.profile).toMatchObject({ ftp: 301, maxHr: 178, name: 'Pilot', weight: 75 });
    expect(d.settings).toMatchObject({ 'feel.preset': 'aggressive', 'feel.punch': 1.6, 'hud.position': 'bot', 'audio.master': 100 });
    expect(d.progress.totals.rides).toBe(0);
    expect(d.history).toEqual([]);
  });
  it('upgrades version 2 and keeps its history', () => {
    const d = migrate({ version: 2, profile: { ftp: 220 }, settings: { feel: 'off', hudPos: 'top' }, history: [ride('old')] });
    expect(d.settings['feel.preset']).toBe('off');
    expect(d.settings['feel.punch']).toBe(0);
    expect(d.history).toHaveLength(1);
    expect(d.progress.pastPlans).toEqual([]);
  });
  it('repairs a current document with missing or damaged parts', () => {
    const d = migrate({ version: PLAYER_VERSION, profile: { ftp: 99999 }, settings: { 'hud.position': 'sideways' }, progress: { totals: { rides: -3 } }, history: [{ junk: 1 }, ride('ok')] });
    expect(d.profile.ftp).toBe(600);
    expect(d.settings['hud.position']).toBe('top');
    expect(d.progress.totals).toEqual({ rides: 0, time: 0, distance: 0, kilojoules: 0 });
    expect(d.history.map((r) => r.id)).toEqual(['ok']);
  });
  it('rejects data from a newer version or with no version', () => {
    expect(() => migrate({ version: PLAYER_VERSION + 1 })).toThrow('newer version');
    expect(() => migrate({ hello: 1 })).toThrow('no recognisable version');
    expect(() => migrate([])).toThrow();
  });
  it('an old export imports cleanly', async () => {
    const s = new PlayerStore(new MemoryBackend());
    const d = await s.importAll(JSON.stringify({ app: 'overreach', version: 1, data: { ftp: 240, maxHr: 190, feel: 'restrained', hudPos: 'top' }, fits: {} }));
    expect(d.version).toBe(PLAYER_VERSION);
    expect(d.profile.ftp).toBe(240);
    expect(d.settings['feel.preset']).toBe('restrained');
  });
});
