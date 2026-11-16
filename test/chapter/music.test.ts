import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ChapterRuntime, type Chapter } from '../../src/core/chapter';

const ch1 = JSON.parse(readFileSync('chapters/ch1.chapter.json', 'utf8')) as Chapter;

describe('music direction', () => {
  const rt = new ChapterRuntime(ch1, { ftp: 250 });
  it('musicAt agrees with the full state at any time', () => {
    for (const t of [0, 101, 300, 480, 569, 640, 700, 900, 1200, 1300, 1415, 1500, 1700, 1800, 1870, 2000, 2070, 2099]) {
      expect(rt.musicAt(t)).toEqual(rt.stateAt(t).music);
    }
  });
  it('is silent between sections and has loops for every looping clip', () => {
    expect(rt.musicAt(50).level).toBe(0);
    expect(rt.musicAt(700)).toMatchObject({ mode: 'dark', fast: true, level: 1 });
    for (const [name, loop] of Object.entries(ch1.music?.loops ?? {})) {
      expect(ch1.music?.ambience?.[name], `ambience curve for loop "${name}"`).toBeDefined();
      expect(typeof loop.clip).toBe('string');
    }
  });
});
