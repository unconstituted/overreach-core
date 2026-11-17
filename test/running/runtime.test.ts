import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ChapterRuntime, loadChapterWorkout, type Chapter } from '../../src/core/chapter';
import { asRun, runEffort } from '../../src/core/workout';

const base = JSON.parse(readFileSync('chapters/test-clamp.chapter.json', 'utf8')) as Chapter;
const FTP = 250;
const TH = 4; // threshold speed, m/s

/** The test chapter with its clamp challenge judged against the workout target rather than FTP. */
function chapterOnTarget(): Chapter {
  const c = structuredClone(base);
  const ch = c.challenges?.find((x) => x.id === 'clamp');
  if (!ch) throw new Error('clamp challenge missing');
  ch.condition = { ...ch.condition, metric: 'powerTarget', min: 0.95, max: 1.05 };
  return c;
}

/** Ride a chapter as a run at `speedAt(t)`, handing the runtime the runner's effort as power, as the game does. */
function run(c: Chapter, speedAt: (t: number) => number) {
  const workout = asRun(loadChapterWorkout(c));
  const rt = new ChapterRuntime(c, { ftp: FTP, thresholdSpeed: TH, workout });
  for (let t = 0; t <= c.duration; t += 0.5) {
    rt.advance(t, { power: runEffort(speedAt(t), 0, TH) * FTP, cadence: 172 });
  }
  return rt;
}

describe('chapter challenges for a runner', () => {
  it('locks the clamp when the runner holds the target pace', () => {
    const c = chapterOnTarget();
    const workout = asRun(loadChapterWorkout(c));
    const probe = new ChapterRuntime(c, { ftp: FTP, thresholdSpeed: TH, workout });
    const rt = run(c, (t) => probe.runner.stateAt(t).targetSpeed ?? TH * 0.8);
    expect(rt.stateAt(c.duration - 1).flags.clampLocked).toBe(true);
  });
  it('fails the clamp when the runner jogs well under the target', () => {
    const c = chapterOnTarget();
    const workout = asRun(loadChapterWorkout(c));
    const probe = new ChapterRuntime(c, { ftp: FTP, thresholdSpeed: TH, workout });
    const rt = run(c, (t) => (probe.runner.stateAt(t).targetSpeed ?? TH * 0.8) * 0.85);
    expect(rt.stateAt(c.duration - 1).flags.clampLocked).toBe(false);
  });
  it('judges "fraction of FTP" conditions on a runner by their effort', () => {
    // The shipped chapter asks for 95 to 105% of FTP: threshold pace is exactly that effort.
    const rt = run(base, (t) => (t >= 60 && t < 120 ? TH : TH * 0.8));
    expect(rt.stateAt(base.duration - 1).flags.clampLocked).toBe(true);
  });
});
