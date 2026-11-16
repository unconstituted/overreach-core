/**
 * Validate every chapter file: JSON schema first, then the semantic checks
 * (timings, workout length, flags, clips and images on disk).
 *
 * Usage: npm run validate            (all of chapters/*.chapter.json)
 *        npx tsx tools/validate-chapters.ts chapters/ch2.chapter.json
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { checkChapter, loadChapterWorkout, type Chapter } from '../src/core/chapter';

const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('schemas/chapter.schema.json', 'utf8')));
const files = process.argv.length > 2
  ? process.argv.slice(2)
  : readdirSync('chapters').filter((f) => f.endsWith('.chapter.json')).map((f) => join('chapters', f));
let failed = 0;

for (const file of files) {
  const problems: string[] = [];
  let chapter: Chapter | undefined;
  try {
    chapter = JSON.parse(readFileSync(file, 'utf8')) as Chapter;
  } catch (e) {
    problems.push(`not valid JSON: ${(e as Error).message}`);
  }
  if (chapter) {
    if (!validate(chapter)) {
      for (const err of validate.errors ?? []) problems.push(`schema: ${err.instancePath || '/'} ${err.message}`);
    } else {
      const base = dirname(file);
      const list = (dir: string | undefined, ext: RegExp) =>
        dir && existsSync(join(base, dir)) ? readdirSync(join(base, dir)).map((f) => f.replace(ext, '')) : undefined;
      let workout;
      try {
        workout = loadChapterWorkout(chapter, (p) => (/\.zwo$/i.test(p) ? readFileSync(join(base, p), 'utf8') : new Uint8Array(readFileSync(join(base, p)))));
      } catch (e) {
        problems.push(`workout: ${(e as Error).message}`);
      }
      problems.push(...checkChapter(chapter, {
        workout, clips: list(chapter.assets?.clips, /\.(mp3|ogg|wav|m4a)$/i), images: list(chapter.assets?.images, /\.(jpe?g|png|webp)$/i),
      }));
    }
  }
  if (problems.length) {
    failed++;
    console.log(`✗ ${file}\n${problems.map((p) => `    ${p}`).join('\n')}`);
  } else {
    console.log(`✓ ${file}`);
  }
}
process.exit(failed ? 1 : 0);
