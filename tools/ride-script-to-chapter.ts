/**
 * Convert a ride script (the writers' Markdown table) into a draft chapter.
 *
 * Usage: npx tsx tools/ride-script-to-chapter.ts <ride-script.md> [out.chapter.json] [--id ch2] [--title "The Descent"]
 *
 * Export the ride script from Claude Docs as Markdown first. The draft is a
 * starting point: the tool prints everything it guessed or could not map.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { checkChapter, rideScriptToChapter } from '../src/core/chapter';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const id = opt('id');
const title = opt('title');
const [input, output] = args;
if (!input) {
  console.error('Usage: npx tsx tools/ride-script-to-chapter.ts <ride-script.md> [out.chapter.json] [--id ch2] [--title "..."]');
  process.exit(2);
}
const { chapter, flags, rows } = rideScriptToChapter(readFileSync(input, 'utf8'), { id, title });
const out = output ?? `chapters/${chapter.id}.draft.chapter.json`;
writeFileSync(out, JSON.stringify({ $schema: '../schemas/chapter.schema.json', ...chapter }, null, 2) + '\n');
console.log(`Read ${rows.length} rows. Wrote ${out}:`);
console.log(`  ${'steps' in chapter.workout ? chapter.workout.steps.length : 0} workout steps, ${chapter.dialogue?.length ?? 0} dialogue lines, ${chapter.glass?.length ?? 0} glass lines, ${chapter.hud?.length ?? 0} HUD items, ${chapter.notes?.length ?? 0} notes`);
const problems = checkChapter(chapter);
if (problems.length) console.log(`\nProblems to fix (${problems.length}):\n${problems.map((p) => `  ! ${p}`).join('\n')}`);
console.log(`\nFlagged for an author (${flags.length}):\n${flags.map((f) => `  - ${f}`).join('\n')}`);
