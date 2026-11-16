import { existsSync, readdirSync, readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { ChapterRuntime, checkChapter, type Chapter } from '../../src/core/chapter';
import { loadPrototype } from '../../tools/lib/prototype';

const schema = JSON.parse(readFileSync('schemas/chapter.schema.json', 'utf8'));
const load = (name: string) => JSON.parse(readFileSync(`chapters/${name}.chapter.json`, 'utf8')) as Chapter;
const ch1 = load('ch1');
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

describe('chapter files', () => {
  const files = readdirSync('chapters').filter((f) => f.endsWith('.chapter.json'));

  it.each(files)('%s validates against the schema', (file) => {
    const ok = validate(JSON.parse(readFileSync(`chapters/${file}`, 'utf8')));
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it.each(files)('%s passes the semantic checks, including assets on disk', (file) => {
    const ch = JSON.parse(readFileSync(`chapters/${file}`, 'utf8')) as Chapter;
    const clips = readdirSync(`chapters/${ch.assets?.clips}`).map((f) => f.replace(/\.mp3$/, ''));
    const images = readdirSync(`chapters/${ch.assets?.images}`).map((f) => f.replace(/\.jpg$/, ''));
    expect(checkChapter(ch, { clips, images })).toEqual([]);
  });

  it('the schema rejects malformed chapters', () => {
    expect(validate({ ...ch1, format: 2 })).toBe(false);
    expect(validate({ ...ch1, dialogue: [{ t: 5 }] })).toBe(false);
    expect(validate({ ...ch1, hud: [{ type: 'notice', t: 5, hold: 2, kind: 'shouting', text: 'x' }] })).toBe(false);
    expect(validate({ ...ch1, surprise: true })).toBe(false);
    expect(validate({ ...ch1, workout: { steps: [{ kind: 'steady', power: 1 }] } })).toBe(false);
  });

  it('the semantic checks catch real mistakes', () => {
    const bad: Chapter = JSON.parse(JSON.stringify(ch1));
    bad.duration = 2000;
    bad.dialogue![0].clip = 'missing';
    bad.dialogue![1].if = 'neverSet';
    bad.scene.curves!.fov = [[10, 60], [5, 70]];
    bad.challenges = [{ id: 'x', from: 100, to: 110, condition: { metric: 'power', hold: 30 } }];
    const problems = checkChapter(bad, { clips: ['pa'] }).join('\n');
    expect(problems).toMatch(/workout: lasts 2100 s but the chapter duration is 2000 s/);
    expect(problems).toMatch(/clip "missing" not found/);
    expect(problems).toMatch(/flag "neverSet"/);
    expect(problems).toMatch(/scene\.curves\.fov: keyframes out of order/);
    expect(problems).toMatch(/needs 30 s in range but the window is only 10 s/);
    expect(problems).toMatch(/neither min nor max/);
  });
});

describe('ch1.chapter.json reproduces the prototype timeline (reference/ch1-prototype)', () => {
  const P = loadPrototype();
  const rt = new ChapterRuntime(ch1, { ftp: 250 });
  // Sample times across the ride, avoiding exact step boundaries where the two differ only in rounding.
  const times: number[] = [];
  for (let t = 0.137; t < 2100; t += 0.731) times.push(t);

  it('has the same duration', () => {
    expect(ch1.duration).toBe(P.DUR);
    expect(rt.runner.total).toBe(P.DUR);
  });

  it('intervals: same steps, labels, targets and ERG flags', () => {
    expect(rt.workout.steps).toHaveLength(P.IV.length);
    P.IV.forEach((iv, i) => {
      const s = rt.workout.steps[i];
      expect(rt.runner.starts[i]).toBe(iv[0]);
      expect(s.duration).toBe(iv[1] - iv[0]);
      expect(s.label).toBe(iv[4]);
      expect(s.erg).toBe(!iv[5]);
    });
    for (const t of times) {
      const st = rt.runner.stateAt(t);
      expect((st.targetFraction ?? 0) * 100).toBeCloseTo(P.targetPct(t), 6);
      expect(st.step.label).toBe(P.ivAt(t)[4]);
    }
  });

  it('spin-up cues fall five seconds before each of the prototype\'s surges', () => {
    const surges = P.IV.filter((v) => v[2] >= 100).map((v) => v[0]);
    expect(rt.runner.cues.map((c) => c.at)).toEqual(surges);
    expect(rt.runner.cues.every((c) => c.at - c.from === 5)).toBe(true);
  });

  it('speed and distance along the route', () => {
    for (const t of times) {
      expect(rt.speedAt(t)).toBeCloseTo(P.speedAt(t), 6);
      const s = P.S(t);
      expect(Math.abs(rt.distanceAt(t) - s)).toBeLessThanOrEqual(1e-6 * Math.max(1, s));
    }
  });

  it('camera mode, field of view, shake and environment', () => {
    const rename: Record<string, string> = { dens: 'density', pRad: 'planetRadius', pDir: 'planetDir' };
    for (const t of times) {
      const s = rt.stateAt(t).scene;
      expect(s.camera).toBe(P.camMode(t));
      expect(s.curves.fov).toBeCloseTo(P.kf(t, P.FOVK), 6);
      expect(s.curves.shake).toBeCloseTo(P.kf(t, P.SHAKEK), 6);
      if (t >= 300) {
        const env = P.envAt(t);
        for (const k of Object.keys(env)) {
          const mine = s.env[rename[k] ?? k];
          const theirs = env[k];
          if (Array.isArray(theirs)) theirs.forEach((v, i) => expect((mine as number[])[i]).toBeCloseTo(v, 6));
          else expect(mine as number).toBeCloseTo(theirs, 6);
        }
      }
    }
  });

  it('impact shake matches the prototype\'s decaying impacts', () => {
    for (const t of [770.5, 773, 1232.4, 1242, 1411, 1535, 1863]) {
      const theirs = P.IMPACTS.reduce((a, im) => a + (t >= im[0] ? im[1] * Math.exp(-(t - im[0]) * 1.1) : 0), 0)
        + (t > 1241 && t < 1246 ? 0.25 * Math.exp(-(t - 1241)) : 0);
      expect(rt.stateAt(t).scene.impactShake).toBeCloseTo(theirs, 1);
    }
  });

  it('dialogue cues: same clips, times, gains, rates and subtitles', () => {
    expect(ch1.dialogue).toHaveLength(P.CUES.length);
    P.CUES.forEach((c, i) => {
      const d = ch1.dialogue![i];
      expect(d.t).toBe(c.t);
      expect(d.clip).toBe(c.c);
      expect(d.gain ?? 1).toBe(c.g ?? 1);
      expect(d.rate ?? 1).toBe(c.rate ?? 1);
      expect((d.subs ?? []).map((s) => [s.offset, s.duration, s.speaker, s.text])).toEqual(c.subs ?? []);
      expect(existsSync(`chapters/ch1/clips/${d.clip}.mp3`)).toBe(true);
    });
  });

  it('the subtitle on screen matches at every sampled moment', () => {
    let shown = 0;
    for (let t = 100; t < 2100; t += 0.173) {
      const theirs = P.subAt(t);
      const mine = rt.stateAt(t).dialogue.subtitle;
      if (theirs) { shown++; expect(mine).toEqual({ speaker: theirs[2], text: theirs[3] }); }
      else expect(mine).toBeUndefined();
    }
    expect(shown).toBeGreaterThan(400);
  });

  it('glass text: same lines, times and holds, written at 16 characters a second', () => {
    expect((ch1.glass ?? []).map((g) => [g.t, g.text, g.hold])).toEqual(P.GLASS);
    const g = rt.stateAt(905 + 0.5).glass[0];
    expect(g.line.text).toBe('STAY CALM.');
    expect(g.shownChars).toBe(8);
    expect(g.fade).toBe(1);
    expect(rt.stateAt(905 + 9 + 1.5).glass[0].fade).toBeCloseTo(0.5, 6);
    expect(rt.stateAt(905 + 9 + 3.1).glass).toHaveLength(0);
  });

  it('stills: same images, windows, fades and camera moves', () => {
    expect(ch1.stills).toHaveLength(P.STILLS.length);
    for (const t of times) {
      const mine = rt.stateAt(t).stills;
      const theirs = P.STILLS
        .map((s) => ({ s, o: t >= s.a && t <= s.b ? Math.min(Math.min(1, Math.max(0, (t - s.a) / s.fi)), Math.min(1, Math.max(0, (s.b - t) / s.fo))) : 0 }))
        .filter((x) => x.o > 0);
      expect(mine.map((m) => m.still.image)).toEqual(theirs.map((x) => x.s.i));
      mine.forEach((m, i) => {
        const { s, o } = theirs[i];
        expect(m.opacity).toBeCloseTo(o, 9);
        const u = Math.min(1, Math.max(0, (t - s.a) / (s.b - s.a)));
        const e = u * u * (3 - 2 * u) * 0.5 + u * 0.5;
        expect(m.scale).toBeCloseTo(s.f[0] + (s.t[0] - s.f[0]) * e, 9);
        expect(m.x).toBeCloseTo(s.f[1] + (s.t[1] - s.f[1]) * e, 9);
      });
    }
    for (const s of ch1.stills!) expect(existsSync(`chapters/ch1/images/${s.image}.jpg`)).toBe(true);
  });

  it('beats (the jump list) match', () => {
    expect((ch1.beats ?? []).map((b) => [b.t, b.title])).toEqual(P.BEATS);
  });

  it('one-shot sounds: same sounds at the same times', () => {
    const order = (a: { t: number; id: string }, b: { t: number; id: string }) => a.t - b.t || a.id.localeCompare(b.id);
    const mine = [...(ch1.sfx ?? [])].sort(order);
    const theirs = [...P.sfx].sort(order);
    expect(mine.length).toBe(theirs.length);
    expect(mine.length).toBeGreaterThan(500);
    mine.forEach((m, i) => {
      expect(m.id).toBe(theirs[i].id);
      expect(Math.abs(m.t - theirs[i].t)).toBeLessThan(0.001);
      (theirs[i].args ?? []).forEach((a, k) => expect(m.args?.[k]).toBeCloseTo(a, 2));
    });
  });

  it('music direction matches at every sampled moment', () => {
    for (const t of times) {
      // Skip the instants where the prototype switches a layer on or off between two frames.
      const theirs = P.musicAt(t);
      const near = P.musicAt(t + 0.02);
      const before = P.musicAt(t - 0.02);
      const stable = (['kick', 'hat', 'bass', 'arp'] as const).every((k) => theirs[k] === near[k] && theirs[k] === before[k])
        && theirs.mode === near.mode && theirs.mode === before.mode && theirs.fast === near.fast && theirs.fast === before.fast;
      if (!stable) continue;
      const mine = rt.stateAt(t).music;
      expect(mine.level, `level at ${t}`).toBeCloseTo(theirs.level, 5);
      if (theirs.level > 0.001) {
        for (const k of ['kick', 'hat', 'bass', 'arp', 'pad', 'bright'] as const) expect(mine[k], `${k} at ${t}`).toBeCloseTo(theirs[k], 5);
        expect(mine.mode, `mode at ${t}`).toBe(theirs.mode);
        expect(mine.party).toBe(theirs.party);
        expect(mine.fast, `fast at ${t}`).toBe(theirs.fast);
      }
    }
  });

  it('HUD story state matches the prototype\'s rules at key moments', () => {
    const hud = (t: number) => rt.stateAt(t).hud;
    expect(hud(100).hidden).toContain('all'); // no visor yet
    expect(hud(185).effects).toContain('flicker');
    expect(hud(190).widgets.map((w) => w.id)).toContain('boot');
    expect(hud(250).waypoint?.text).toMatch(/^SHIP 07 · \d+ m$/);
    expect(hud(400).widgets.map((w) => w.id)).toEqual(expect.arrayContaining(['call', 'map', 'canopy']));
    expect(hud(600).waypoint?.text).toMatch(/^START LINE · \d+ km$/);
    expect(hud(700).banner).toEqual({ text: 'AI CONTROL', tone: 'warning', blink: true });
    // Notification spam: the prototype shows floor(kf(t)) notes.
    for (const t of [665, 690, 720, 750, 775]) {
      const n = Math.min(15, Math.floor(P.kf(t, [[661, 0], [680, 3], [700, 5], [740, 12], [770, 15]])));
      expect(hud(t).notices).toHaveLength(n);
    }
    expect(hud(775).notices[14].text).toBe('BRACE');
    expect(hud(800).hidden).toContain('all'); // dead after the warp
    expect(hud(1000).hidden).toEqual(expect.arrayContaining(['speed', 'power', 'cadence']));
    expect(hud(1060).hidden).toEqual(['power', 'speed']);
    expect(hud(1200).hidden).toEqual([]);
    expect(hud(1300).waypoint?.text).toMatch(/^COVER · \d+\.\d km$/);
    expect(hud(1700).waypoint?.text).toMatch(/^CREST · \d+\.\d km · GRADIENT 11%$/);
    expect(hud(1780).effects).toContain('alt');
    expect(hud(2080).waypoint?.label).toBe('DESTINATION · THE GATE');
    expect(hud(5).title).toMatchObject({ big: 'CHAPTER 1', em: 'The Disaster' });
    expect(hud(1990).title).toMatchObject({ em: 'Nine hours later', opacity: 1 });
  });

  it('the start line waypoint counts down the prototype\'s distance', () => {
    const t = 620;
    const km = Math.max(0, (P.S(668) - P.S(t)) / 1000).toFixed(0);
    expect(rt.stateAt(t).hud.waypoint?.text).toBe(`START LINE · ${km} km`);
  });
});
