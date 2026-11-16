import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import {
  ChapterRuntime, chapterToRideScript, checkChapter, parseDialogueCell, parseRideScriptTable, parseWorkoutCell, rideScriptToChapter,
} from '../../src/core/chapter';
import { buildWorkout, totalDuration } from '../../src/core/workout';

const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('schemas/chapter.schema.json', 'utf8')));

const SAMPLE = `# Sample: the clamp

Some prose the converter ignores.

| Time | Workout | What we see | What we hear | Dialogue | HUD / gameplay |
| --- | --- | --- | --- | --- | --- |
| 00:00 | 55%, easy | Station arm below us: a sword in the ice | Wind over the hull | — | No HUD; title card |
| 01:00 | 60% → 80% | Descent through cloud | Engine note rising | **AI:** "Depth four thousand." **Crush:** "Copy." *(a beat)* "Keep going." | Depth read-out; notice "RE-ENTRY" |
| 02:30 | 2 × (20 s at 110%, 40 s at 60%), ERG off | Debris field | Impacts | *Glass: HOLD STILL. / NOW.* | Spin-up cue at 02:25; "DEBRIS" banner |
| 04:30 | 30 s at 100% | The clamp closes | Metal on metal | **Crush** *(strained)*: "Got it." A long groan from the hull | Clamp marker |
| 05:30 | 50% for 1 min | Tow line taut | — | — | — |
| 06:30 | Ride ends | Cut to black | — | — | Ride summary |
`;

describe('ride script table parsing', () => {
  it('reads rows from a Markdown table and ignores everything else', () => {
    const rows = parseRideScriptTable(SAMPLE);
    expect(rows.map((r) => r.t)).toEqual([0, 60, 150, 270, 330, 390]);
    expect(rows[1]).toMatchObject({ workout: '60% → 80%', see: 'Descent through cloud', hear: 'Engine note rising' });
  });

  it('reads several tables in one document (one per act)', () => {
    const real = readFileSync('test/fixtures/ch1-ride-script.md', 'utf8');
    const rows = parseRideScriptTable(real);
    expect(rows).toHaveLength(36);
    expect(rows[0].t).toBe(0);
    expect(rows[35]).toMatchObject({ t: 2100, workout: 'Ride ends' });
  });

  it('reads the workout cell forms writers use', () => {
    const flags: string[] = [];
    const f = (m: string) => flags.push(m);
    expect(parseWorkoutCell('55%', 60, 'A', f)).toEqual([{ kind: 'steady', duration: 60, power: 0.55, label: 'A' }]);
    expect(parseWorkoutCell('50%, free spin', 100, undefined, f)).toEqual([{ kind: 'steady', duration: 100, power: 0.5 }]);
    expect(parseWorkoutCell('65% → 80% over 1:30', 90, undefined, f)).toEqual([{ kind: 'ramp', duration: 90, from: 0.65, to: 0.8 }]);
    expect(parseWorkoutCell('85–90%', 90, undefined, f)).toEqual([{ kind: 'ramp', duration: 90, from: 0.85, to: 0.9 }]);
    expect(parseWorkoutCell('45% for 2 min', 120, undefined, f)).toEqual([{ kind: 'steady', duration: 120, power: 0.45 }]);
    expect(parseWorkoutCell('30 s at 120%, ERG off', 30, undefined, f)).toEqual([{ kind: 'steady', duration: 30, power: 1.2, erg: false }]);
    expect(parseWorkoutCell('2 × (20 s at 115%, 20 s at 75%), ERG off', 80, 'Surge', f)).toEqual([
      { kind: 'intervals', repeat: 2, on: { duration: 20, power: 1.15, label: 'Surge' }, off: { duration: 20, power: 0.75, label: 'Recover' }, erg: false },
    ]);
    expect(flags).toEqual([]);
    // A cell shorter than its row is padded, and says so.
    expect(parseWorkoutCell('30 s at 100%', 60, undefined, f)).toEqual([
      { kind: 'steady', duration: 30, power: 1 }, { kind: 'steady', duration: 30, power: 1 },
    ]);
    expect(flags[0]).toMatch(/covers 30 s of a 60 s row/);
    expect(parseWorkoutCell('as hard as you like', 60, undefined, f)).toEqual([{ kind: 'free', duration: 60 }]);
    expect(flags[1]).toMatch(/not understood/);
  });

  it('reads dialogue cells: speakers, stage directions, writer additions, glass and prose', () => {
    const d = parseDialogueCell('**Sarah:** "Vibe confirmed." *(tone shifts)* "Come back safe." **Crush:** "What could go wrong?"');
    expect(d.lines.map((l) => [l.speaker, l.text])).toEqual([['Sarah', 'Vibe confirmed.'], ['Sarah', 'Come back safe.'], ['Crush', 'What could go wrong?']]);
    expect(d.lines[1].direction).toBe('tone shifts');

    const s = parseDialogueCell('**Crush** *(strained)*: "Open main channel." A flood of confused voices');
    expect(s.lines).toEqual([{ speaker: 'Crush', text: 'Open main channel.', direction: 'strained', added: false }]);
    expect(s.other).toEqual(['A flood of confused voices']);

    const added = parseDialogueCell('*AI: "Hold on."*');
    expect(added.lines).toEqual([{ speaker: 'AI', text: 'Hold on.', added: true }]);

    const g = parseDialogueCell('**Glass:** STAY CALM. / DO NOT MAKE ANY NOISE. / *YOU HAVE BEEN UNCONSCIOUS FOR SIX HOURS.*');
    expect(g.glass).toEqual([
      { text: 'STAY CALM.', added: false }, { text: 'DO NOT MAKE ANY NOISE.', added: false },
      { text: 'YOU HAVE BEEN UNCONSCIOUS FOR SIX HOURS.', added: true },
    ]);
    expect(parseDialogueCell('*Glass: GO.*').glass).toEqual([{ text: 'GO.', added: true }]);
    expect(parseDialogueCell('—')).toEqual({ lines: [], glass: [], other: [] });
  });
});

describe('ride script to chapter draft', () => {
  const { chapter, flags } = rideScriptToChapter(SAMPLE, { id: 'sample' });

  it('produces a valid, playable chapter', () => {
    expect(validate(chapter)).toBe(true);
    expect(checkChapter(chapter)).toEqual([]);
    expect(chapter.duration).toBe(390);
    const rt = new ChapterRuntime(chapter, { ftp: 250 });
    expect(rt.runner.total).toBe(390);
    expect(rt.stateAt(100).workout.targetFraction).toBeCloseTo(0.6 + 0.2 * (40 / 90), 6);
    expect(rt.stateAt(155).workout.targetFraction).toBe(1.1);
    expect(rt.stateAt(155).workout.erg).toBe(false);
  });

  it('maps beats, dialogue, glass and simple HUD items', () => {
    expect(chapter.title).toBe('Sample: the clamp');
    expect(chapter.beats!.map((b) => [b.t, b.title])).toEqual([
      [0, 'Station arm below us'], [60, 'Descent through cloud'], [150, 'Debris field'], [270, 'The clamp closes'], [330, 'Tow line taut'], [390, 'Cut to black'],
    ]);
    expect(chapter.dialogue!.map((d) => [d.subs![0].speaker, d.subs![0].text])).toEqual([
      ['AI', 'Depth four thousand.'], ['CRUSH', 'Copy.'], ['CRUSH', 'Keep going.'], ['CRUSH', 'Got it.'],
    ]);
    // Lines are laid out in order inside their row, without overlapping.
    const [a, b, c] = chapter.dialogue!;
    expect(a.t).toBe(61);
    expect(b.t).toBeGreaterThanOrEqual(a.t + a.subs![0].duration);
    expect(c.t).toBeGreaterThanOrEqual(b.t + b.subs![0].duration);
    expect(chapter.dialogue!.every((d) => d.clip.startsWith('todo-'))).toBe(true);
    expect(chapter.glass!.map((g) => g.text)).toEqual(['HOLD STILL.', 'NOW.']);
    expect(chapter.hud).toEqual([
      { type: 'hide', from: 0, to: 60, elements: ['all'] },
      { type: 'notice', t: 61, hold: 8, kind: 'info', text: 'RE-ENTRY' },
      { type: 'banner', from: 150, to: 270, text: 'DEBRIS', tone: 'warning' },
      { type: 'notice', t: 271, hold: 8, kind: 'location', text: 'Clamp marker' },
    ]);
  });

  it('flags what it guessed or could not map', () => {
    const all = flags.join('\n');
    expect(all).toMatch(/01:00 3 dialogue lines: timing is estimated and clips are placeholders/);
    expect(all).toMatch(/04:30 dialogue "A long groan from the hull": not a spoken line; kept as a note/);
    expect(all).toMatch(/00:00 HUD "title card": no automatic mapping; kept as a note/);
    expect(all).toMatch(/04:30 workout "30 s at 100%": covers 30 s of a 60 s row/);
    expect(all).toMatch(/04:30 HUD "Clamp marker": added as a location notice; replace with a waypoint/);
    expect(all).toMatch(/00:00 sound "Wind over the hull": kept as a note/);
    expect(all).toMatch(/scene: placeholder only/);
    // Spin-up cues come from the workout, so the note about one is dropped silently.
    expect(all).not.toMatch(/Spin-up cue/);
    expect(chapter.notes).toContainEqual({ t: 270, kind: 'todo', text: 'Dialogue note: A long groan from the hull' });
    expect(chapter.notes).toContainEqual({ t: 0, kind: 'see', text: 'Station arm below us: a sword in the ice' });
  });

  it('round-trips: chapter -> table -> chapter gives the same draft', () => {
    const table = chapterToRideScript(chapter);
    expect(parseRideScriptTable(table)).toHaveLength(parseRideScriptTable(SAMPLE).length);
    const again = rideScriptToChapter(table, { id: 'sample' }).chapter;
    const flat = (c: typeof chapter) => buildWorkout({ name: 'w', steps: 'steps' in c.workout ? c.workout.steps : [] }).steps
      .map((s) => [s.duration, s.kind, s.target?.from, s.target?.to, s.erg]);
    expect(flat(again)).toEqual(flat(chapter));
    expect(again.duration).toBe(chapter.duration);
    expect(again.beats!.map((b) => b.t)).toEqual(chapter.beats!.map((b) => b.t));
    expect(again.dialogue).toEqual(chapter.dialogue);
    expect(again.glass).toEqual(chapter.glass);
    expect(again.hud).toEqual(chapter.hud);
    expect(again.notes!.filter((n) => n.kind !== 'todo')).toEqual(chapter.notes!.filter((n) => n.kind !== 'todo'));
    // And a second pass is stable.
    expect(chapterToRideScript(again)).toBe(chapterToRideScript(rideScriptToChapter(chapterToRideScript(again), { id: 'sample' }).chapter));
  });
});

describe('the real Chapter 1 ride script', () => {
  const real = readFileSync('test/fixtures/ch1-ride-script.md', 'utf8');
  const { chapter, flags } = rideScriptToChapter(real, { id: 'ch1-draft' });

  it('converts to a valid 35-minute draft', () => {
    expect(validate(chapter)).toBe(true);
    expect(checkChapter(chapter)).toEqual([]);
    expect(chapter.duration).toBe(2100);
    expect(totalDuration(buildWorkout({ name: 'w', steps: 'steps' in chapter.workout ? chapter.workout.steps : [] }))).toBe(2100);
    expect(chapter.title).toBe('Chapter 1: The Disaster · Ride Script');
  });

  it('finds the seven surges and their ERG-off flags', () => {
    const rt = new ChapterRuntime(chapter, { ftp: 250 });
    expect(rt.runner.cues.map((c) => c.at)).toEqual([660, 700, 740, 1290, 1410, 1530, 1860]);
    expect(rt.stateAt(745).workout).toMatchObject({ targetFraction: 1.2, erg: false });
  });

  it('extracts the spoken lines and the glass text', () => {
    const speakers = new Set(chapter.dialogue!.map((d) => d.subs![0].speaker));
    expect([...speakers].sort()).toEqual(['AI', 'CRUSH', 'DAX', 'SARAH', 'TECH']);
    expect(chapter.dialogue).toHaveLength(28);
    expect(chapter.dialogue!.find((d) => d.t >= 2050)!.subs![0].text).toBe("Yes, Crush. They're all gone.");
    expect(chapter.glass!.map((g) => g.text)).toContain('STAY CALM.');
    expect(chapter.glass!.map((g) => g.text)).toContain("THEY CAN'T HEAR US UP HERE.");
    expect(chapter.hud).toContainEqual({ type: 'banner', from: 660, to: 740, text: 'AI CONTROL', tone: 'warning' });
    expect(flags.length).toBeGreaterThan(50); // a draft: plenty left for an author
  });
});
