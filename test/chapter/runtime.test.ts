import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ChapterRuntime, DistanceTable, evalEnv, evalKeys, loadChapterWorkout, type Chapter, type ChapterEvent, type RiderData } from '../../src/core/chapter';

const load = (name: string) => JSON.parse(readFileSync(`chapters/${name}.chapter.json`, 'utf8')) as Chapter;
const ch1 = load('ch1');
const clamp = load('test-clamp');

/** Play from `from` to `to` in steps, collecting events. */
function play(rt: ChapterRuntime, from: number, to: number, rider: (t: number) => RiderData | undefined = () => undefined, dt = 0.1): ChapterEvent[] {
  const events: ChapterEvent[] = [];
  const n = Math.round((to - from) / dt);
  for (let i = 0; i <= n; i++) {
    const t = from + i * dt;
    events.push(...rt.advance(t, rider(t)).events);
  }
  return events;
}
const types = (ev: ChapterEvent[], type: ChapterEvent['type']) => ev.filter((e) => e.type === type);

describe('curves', () => {
  it('evaluates keyframes with clamping at both ends', () => {
    const k: [number, number][] = [[10, 0], [20, 100], [30, 50]];
    expect(evalKeys(k, 0)).toBe(0);
    expect(evalKeys(k, 15)).toBe(50);
    expect(evalKeys(k, 25)).toBe(75);
    expect(evalKeys(k, 99)).toBe(50);
  });

  it('blends environment keys, including arrays', () => {
    const env = evalEnv([{ t: 0, values: { a: 0, c: [0, 10] } }, { t: 10, values: { a: 4, c: [10, 30] } }], 5);
    expect(env).toEqual({ a: 2, c: [5, 20] });
  });

  it('integrates speed into distance', () => {
    const d = new DistanceTable([[0, 10], [100, 10]], 100);
    expect(d.at(50)).toBeCloseTo(500, 6);
    const ramp = new DistanceTable([[0, 0], [10, 20]], 10);
    expect(ramp.at(10)).toBeCloseTo(100, 3); // triangle: half of 10 s * 20 m/s
  });
});

describe('chapter runtime: playing forwards', () => {
  it('fires each one-shot exactly once', () => {
    const rt = new ChapterRuntime(ch1, { ftp: 250 });
    const ev = play(rt, 0, 340);
    const clips = types(ev, 'dialogue').map((e) => (e as { cue: { clip: string } }).cue.clip);
    expect(clips).toEqual(['pa', 'influencer', 'helmet', 'tech', 'call']);
    const sounds = types(ev, 'sfx');
    expect(sounds.length).toBe(ch1.sfx!.filter((s) => s.t <= 340).length);
    expect(types(ev, 'beat').map((e) => (e as { title: string }).title)).toEqual(ch1.beats!.filter((b) => b.t <= 340).map((b) => b.title));
    expect(types(ev, 'step')).toHaveLength(5); // steps starting at 0, 100, 150, 210, 330
  });

  it('gives the same events whatever the frame rate', () => {
    const key = (e: ChapterEvent) => JSON.stringify(e);
    const a = play(new ChapterRuntime(ch1, { ftp: 250 }), 600, 800, undefined, 1 / 60).map(key).sort();
    const b = play(new ChapterRuntime(ch1, { ftp: 250 }), 600, 800, undefined, 0.25).map(key).sort();
    const c = play(new ChapterRuntime(ch1, { ftp: 250 }), 600, 800, undefined, 1).map(key).sort();
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(a.length).toBeGreaterThan(60);
  });

  it('emits spin-up and go cues around a surge, and impacts', () => {
    const ev = play(new ChapterRuntime(ch1, { ftp: 250 }), 650, 665);
    expect(types(ev, 'cue')).toEqual([
      { type: 'cue', kind: 'spin-up', stepIndex: 8 },
      { type: 'cue', kind: 'go', stepIndex: 8 },
    ]);
    const ev2 = play(new ChapterRuntime(ch1, { ftp: 250 }), 1230, 1243);
    expect(types(ev2, 'impact').map((e) => (e as { impact: { t: number } }).impact.t)).toEqual([1232, 1241]);
  });

  it('reports workout state alongside the story', () => {
    const rt = new ChapterRuntime(ch1, { ftp: 280 });
    const s = rt.advance(0).state;
    expect(s.workout.targetWatts).toBeCloseTo(140, 6);
    expect(s.scene.id).toBe('stills');
    const mid = rt.seek(1300);
    expect(mid.scene.id).toBe('ice');
    expect(mid.beat?.title).toBe('Dash for cover');
    expect(mid.workout.step.label).toBe('DASH FOR COVER');
    expect(mid.workout.targetWatts).toBeCloseTo(280, 6);
  });

  it('finishes at the end', () => {
    const rt = new ChapterRuntime(ch1, { ftp: 250 });
    rt.seek(2099);
    const f = rt.advance(2100);
    expect(f.state.finished).toBe(true);
    expect(rt.advance(2500).state.t).toBe(2100);
  });
});

describe('chapter runtime: seeking', () => {
  it('a forward seek fires no one-shots and reports that it jumped', () => {
    const rt = new ChapterRuntime(ch1, { ftp: 250 });
    play(rt, 0, 10);
    const f = rt.advance(700);
    expect(f.seeked).toBe(true);
    expect(f.events).toEqual([]);
    // Play resumes normally afterwards: only events after the seek point fire.
    const ev = play(rt, 700.1, 706);
    expect(types(ev, 'dialogue').map((e) => (e as { cue: { t: number } }).cue.t)).toEqual([704]);
    expect(types(ev, 'sfx').every((e) => (e as { cue: { t: number } }).cue.t > 700)).toBe(true);
  });

  it('seeking backwards does not refire effects, but replaying the stretch fires them once more', () => {
    const rt = new ChapterRuntime(ch1, { ftp: 250 });
    const first = play(rt, 650, 670);
    expect(types(first, 'sfx').length).toBeGreaterThan(3);
    const back = rt.advance(655);
    expect(back.seeked).toBe(true);
    expect(back.events).toEqual([]);
    const again = play(rt, 655.1, 670);
    const t0 = (e: ChapterEvent) => (e as { cue: { t: number } }).cue.t;
    expect(types(again, 'sfx').map(t0)).toEqual(types(first, 'sfx').map(t0).filter((t) => t > 655));
    expect(types(again, 'sfx').map(t0).every((t) => t > 655)).toBe(true);
  });

  it('dialogue resumes mid-clip after a seek', () => {
    const rt = new ChapterRuntime(ch1, { ftp: 250 });
    // The call with Sarah starts at 334 and runs for about 22 s.
    const call = ch1.dialogue!.find((d) => d.clip === 'call')!;
    const f = rt.advance(call.t + 9.5);
    expect(f.seeked).toBe(true);
    expect(f.events).toEqual([]);
    const active = f.state.dialogue.active;
    expect(active).toHaveLength(1);
    expect(active[0].cue.clip).toBe('call');
    expect(active[0].offset).toBeCloseTo(9.5, 9);
    expect(active[0].remaining).toBeCloseTo(call.duration! - 9.5, 6);
    expect(f.state.dialogue.subtitle).toEqual({ speaker: 'AI', text: 'The most common causes of death during racing are engine failure, collision, debris acting as shrapnel.' });
    // Continuing to play does not start the clip a second time.
    expect(types(play(rt, call.t + 9.6, call.t + 15), 'dialogue')).toEqual([]);
  });

  it('scales the resume offset by playback rate', () => {
    const rt = new ChapterRuntime(ch1, { ftp: 250 });
    const cue = ch1.dialogue!.find((d) => d.rate === 1.12)!;
    const st = rt.seek(cue.t + 1);
    const a = st.dialogue.active.find((x) => x.cue === cue)!;
    expect(a.offset).toBeCloseTo(1.12, 9);
    expect(a.remaining).toBeCloseTo(cue.duration! / 1.12 - 1, 6);
  });

  it('nothing is playing once a clip has ended, and real clip lengths can be supplied later', () => {
    const rt = new ChapterRuntime(ch1, { ftp: 250 });
    const tech = ch1.dialogue!.find((d) => d.clip === 'tech')!;
    expect(rt.seek(tech.t + tech.duration! + 0.1).dialogue.active).toEqual([]);
    rt.setClipDuration('tech', 10);
    expect(rt.seek(tech.t + 5).dialogue.active[0].remaining).toBeCloseTo(5, 9);
  });

  it('falls back to subtitle timing when a clip length is unknown', () => {
    const copy: Chapter = JSON.parse(JSON.stringify(ch1));
    for (const d of copy.dialogue!) delete d.duration;
    const rt = new ChapterRuntime(copy, { ftp: 250 });
    const helmet = copy.dialogue!.find((d) => d.clip === 'helmet')!;
    expect(rt.cueLength(helmet)).toBeCloseTo(8 + 3.4 + 0.5, 9);
  });

  it('state is a pure function of time: the same after any path', () => {
    const a = new ChapterRuntime(ch1, { ftp: 250 });
    const b = new ChapterRuntime(ch1, { ftp: 250 });
    play(a, 0, 30);
    a.advance(1900);
    a.advance(400);
    play(a, 400.1, 410);
    const viaJumps = a.advance(1250.3).state;
    const direct = b.seek(1250.3);
    expect(viaJumps).toEqual(direct);
  });

  it('a long stall (a frozen tab) is treated as a seek rather than a burst of sound', () => {
    const rt = new ChapterRuntime(ch1, { ftp: 250 });
    play(rt, 0, 5);
    const f = rt.advance(60);
    expect(f.seeked).toBe(true);
    expect(f.events).toEqual([]);
  });
});

describe('conditions on rider data (test-clamp chapter)', () => {
  const ftp = 250;
  const onTarget = (): RiderData => ({ power: 250, cadence: 95 });
  const tooEasy = (): RiderData => ({ power: 150, cadence: 80 });

  it('succeeds when the rider holds the band for long enough, and runs the success branch', () => {
    const rt = new ChapterRuntime(clamp, { ftp });
    const ev = play(rt, 0, 100, (t) => (t >= 60 ? onTarget() : tooEasy()));
    const ch = types(ev, 'challenge');
    expect(ch).toEqual([
      { type: 'challenge', id: 'clamp', outcome: 'started' },
      { type: 'challenge', id: 'clamp', outcome: 'succeeded' },
    ]);
    const st = rt.stateAt(rt.time);
    expect(st.flags).toEqual({ clampLocked: true });
    expect(st.challenges[0]).toMatchObject({ id: 'clamp', status: 'succeeded', progress: 1 });
    // Branch items fired at the moment of success (about t = 80): notice, chime, then the line a second later.
    expect(types(ev, 'notice')).toContainEqual({ type: 'notice', text: 'CLAMP LOCKED', kind: 'info' });
    expect(types(ev, 'sfx').map((e) => (e as { cue: { id: string } }).cue.id)).toEqual(['boom', 'chime']);
    const lines = types(ev, 'dialogue').map((e) => (e as { cue: { clip: string; t: number } }).cue);
    expect(lines.map((l) => l.clip)).toEqual(['holdon', 'beautiful']);
    expect(lines[1].t).toBeGreaterThan(80.8);
    expect(lines[1].t).toBeLessThan(81.3);
  });

  it('shows progress while the rider is holding', () => {
    const rt = new ChapterRuntime(clamp, { ftp });
    play(rt, 0, 70, (t) => (t >= 60 ? onTarget() : tooEasy()));
    const c = rt.stateAt(70).challenges[0];
    expect(c.status).toBe('active');
    expect(c.inRange).toBe(true);
    expect(c.progress).toBeCloseTo(0.5, 1);
    expect(c.timeLeft).toBeCloseTo(50, 6);
    expect(c.prompt).toMatch(/95 to 105%/);
  });

  it('fails at the end of the window and runs the fail branch', () => {
    const rt = new ChapterRuntime(clamp, { ftp });
    const ev = play(rt, 0, 130, tooEasy);
    expect(types(ev, 'challenge').map((e) => (e as { outcome: string }).outcome)).toEqual(['started', 'failed']);
    expect(rt.stateAt(130).flags).toEqual({ clampLocked: false });
    expect(types(ev, 'notice')).toContainEqual({ type: 'notice', text: 'CLAMP SLIPPED', kind: 'warning' });
    expect(types(ev, 'glass').map((e) => (e as { line: { text: string } }).line.text)).toEqual(['AGAIN. SLOWER.']);
    expect(rt.stateAt(125).glass[0].line.text).toBe('AGAIN. SLOWER.');
  });

  it('forgives a short lapse within the grace period but resets on a long one', () => {
    const lapse = (len: number) => (t: number): RiderData => {
      if (t < 60) return tooEasy();
      return t >= 70 && t < 70 + len ? { power: 300 } : onTarget();
    };
    const short = new ChapterRuntime(clamp, { ftp });
    play(short, 0, 82, lapse(1.5));
    // 10 s held, a forgiven 1.5 s lapse, then 10 s more: done at about 81.5 s.
    expect(short.stateAt(82).challenges[0].status).toBe('succeeded');

    const long = new ChapterRuntime(clamp, { ftp });
    play(long, 0, 82, lapse(4));
    const c = long.stateAt(82).challenges[0];
    expect(c.status).toBe('active');
    expect(c.held).toBeCloseTo(8, 0); // reset at the lapse; holding again since 74 s
  });

  it('with no rider data the challenge cannot be passed', () => {
    const rt = new ChapterRuntime(clamp, { ftp });
    play(rt, 0, 125);
    expect(rt.stateAt(125).challenges[0].status).toBe('failed');
  });

  it('branches change the rest of the chapter through flags', () => {
    const won = new ChapterRuntime(clamp, { ftp });
    const evWon = play(won, 0, 260, (t) => (t >= 60 && t < 120 ? onTarget() : tooEasy()));
    expect(won.stateAt(200).hud.banner?.text).toBe('TOWING');
    expect(types(evWon, 'dialogue').map((e) => (e as { cue: { clip: string } }).cue.clip)).toContain('talknow');
    expect(won.stateAt(250).glass).toEqual([]);

    const lost = new ChapterRuntime(clamp, { ftp });
    const evLost = play(lost, 0, 260, tooEasy);
    expect(lost.stateAt(200).hud.banner).toBeUndefined();
    expect(types(evLost, 'dialogue').map((e) => (e as { cue: { clip: string } }).cue.clip)).not.toContain('talknow');
    expect(lost.stateAt(250).glass[0].line.text).toBe('WE LOST IT.');
  });

  it('a challenge gated on a flag only runs on that branch', () => {
    const won = new ChapterRuntime(clamp, { ftp });
    const ev = play(won, 0, 230, (t) => (t >= 60 && t < 120 ? onTarget() : { power: 210, cadence: 96 }));
    expect(types(ev, 'challenge').filter((e) => (e as { id: string }).id === 'tow').map((e) => (e as { outcome: string }).outcome)).toEqual(['started', 'succeeded']);
    expect(won.stateAt(230).flags).toEqual({ clampLocked: true, capsuleFree: true });

    const lost = new ChapterRuntime(clamp, { ftp });
    const ev2 = play(lost, 0, 250, () => ({ power: 150, cadence: 96 }));
    expect(types(ev2, 'challenge').filter((e) => (e as { id: string }).id === 'tow')).toEqual([]);
    expect(lost.stateAt(250).challenges[1].status).toBe('pending');
  });

  it('supports the other metrics: fraction of target, heart rate and fraction of max heart rate', () => {
    const base: Chapter = JSON.parse(JSON.stringify(clamp));
    base.challenges = [
      { id: 'onTarget', from: 10, to: 40, condition: { metric: 'powerTarget', min: 0.95, max: 1.05, hold: 5 } },
      { id: 'hr', from: 10, to: 40, condition: { metric: 'heartRate', max: 120, hold: 5 } },
      { id: 'hrMax', from: 10, to: 40, condition: { metric: 'heartRateMax', min: 0.8, hold: 5 } },
      { id: 'watts', from: 10, to: 40, condition: { metric: 'power', min: 400, hold: 5 } },
    ];
    const rt = new ChapterRuntime(base, { ftp, maxHr: 190 });
    // Target in the first step is 60% of 250 = 150 W.
    play(rt, 0, 20, () => ({ power: 152, heartRate: 110 }));
    const by = Object.fromEntries(rt.stateAt(20).challenges.map((c) => [c.id, c.status]));
    expect(by).toEqual({ onTarget: 'succeeded', hr: 'succeeded', hrMax: 'active', watts: 'active' });
  });
});

describe('conditions and seeking', () => {
  const ftp = 250;
  const rider = (t: number): RiderData => (t >= 60 && t < 120 ? { power: 250 } : { power: 150 });

  it('seeking back before a decided challenge undoes it, so it can be ridden again', () => {
    const rt = new ChapterRuntime(clamp, { ftp });
    play(rt, 0, 130, () => ({ power: 150 })); // fail it
    expect(rt.stateAt(130).flags).toEqual({ clampLocked: false });
    const st = rt.advance(50).state;
    expect(st.flags).toEqual({});
    expect(st.challenges[0].status).toBe('pending');
    expect(rt.stateAt(125).glass).toEqual([]); // the fail branch's glass line is gone
    const ev = play(rt, 50.1, 130, rider);
    expect(types(ev, 'challenge').map((e) => (e as { outcome: string }).outcome)).toEqual(['started', 'succeeded']);
    expect(rt.stateAt(130).flags).toEqual({ clampLocked: true });
  });

  it('seeking forward past an unridden challenge skips it without running either branch', () => {
    const rt = new ChapterRuntime(clamp, { ftp });
    play(rt, 0, 10);
    const st = rt.advance(200).state;
    expect(st.challenges[0].status).toBe('skipped');
    expect(st.flags).toEqual({});
    expect(st.hud.banner).toBeUndefined();
  });

  it('seeking forward keeps results that were earned', () => {
    const rt = new ChapterRuntime(clamp, { ftp });
    play(rt, 0, 100, rider);
    const st = rt.advance(200).state;
    expect(st.challenges[0].status).toBe('succeeded');
    expect(st.flags).toEqual({ clampLocked: true });
    expect(st.hud.banner?.text).toBe('TOWING');
  });

  it('seeking into the middle of a window restarts the hold', () => {
    const rt = new ChapterRuntime(clamp, { ftp });
    play(rt, 0, 75, rider);
    expect(rt.stateAt(75).challenges[0].held).toBeGreaterThan(14);
    const st = rt.advance(65).state;
    expect(st.challenges[0]).toMatchObject({ status: 'active', held: 0, progress: 0 });
  });

  it('branch dialogue resumes mid-clip after a seek, like any other', () => {
    const rt = new ChapterRuntime(clamp, { ftp });
    play(rt, 0, 100, rider); // success at about 80; the branch line starts a second later
    const st = rt.advance(82).state;
    const a = st.dialogue.active.find((x) => x.cue.clip === 'beautiful');
    expect(a).toBeDefined();
    expect(a!.offset).toBeGreaterThan(0.7);
    expect(a!.offset).toBeLessThan(1.2);
  });
});

describe('workout references', () => {
  it('loads a chapter workout from a .zwo or .fit file through a reader', () => {
    const zwo: Chapter = { ...clamp, workout: { file: 'x.zwo' } };
    const w = loadChapterWorkout(zwo, () => readFileSync('reference/workouts/Rubicon_Storm_Front.zwo', 'utf8'));
    expect(w.name).toBe('Rubicon: Storm Front');
    const fit: Chapter = { ...clamp, workout: { file: 'x.fit' } };
    expect(loadChapterWorkout(fit, () => new Uint8Array(readFileSync('reference/workouts/CrushCh1.fit'))).steps).toHaveLength(37);
    expect(() => loadChapterWorkout(zwo)).toThrow(/file reader/);
  });
});
