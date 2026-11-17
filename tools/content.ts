/**
 * Reads every content file from disk, validates it and builds the catalogue.
 * Used by `npm run catalogue`, `npm run validate` and the Vite plugin.
 */
import Ajv2020 from 'ajv/dist/2020';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import type { Chapter } from '../src/core/chapter';
import { buildCatalogue, type Catalogue, type ContentSources } from '../src/core/content';

export const CATALOGUE_FILE = 'content/catalogue.json';

const KINDS = [
  { key: 'workouts', dir: 'content/workouts', suffix: '.workout.json', schema: 'schemas/workout.schema.json' },
  { key: 'plans', dir: 'content/plans', suffix: '.plan.json', schema: 'schemas/plan.schema.json' },
  { key: 'maps', dir: 'content/maps', suffix: '.map.json', schema: 'schemas/map.schema.json' },
  { key: 'seasons', dir: 'content/seasons', suffix: '.season.json', schema: 'schemas/season.schema.json' },
] as const;

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const web = (p: string): string => p.split(sep).join('/');

export interface ContentReport {
  catalogue: Catalogue;
  /** file → problems. Files with no problems are listed with an empty array. */
  files: Record<string, string[]>;
  /** Cross-reference problems that belong to no single file's schema. */
  problems: string[];
}

/** Load and check all content under `root` (the repository root). */
export function loadContent(root = '.'): ContentReport {
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
  const files: Record<string, string[]> = {};
  const src: ContentSources = { chapters: {}, workouts: {}, plans: {}, maps: {}, seasons: {}, images: [] };

  // Chapters are served from the site root, so their catalogue path has no folder.
  const chapterDir = join(root, 'chapters');
  for (const f of existsSync(chapterDir) ? readdirSync(chapterDir).sort() : []) {
    if (!f.endsWith('.chapter.json')) continue;
    try {
      src.chapters[f] = JSON.parse(readFileSync(join(chapterDir, f), 'utf8')) as Chapter;
    } catch (e) {
      files[`chapters/${f}`] = [`not valid JSON: ${(e as Error).message}`];
    }
  }
  for (const p of walk(chapterDir)) if (/\.(jpe?g|png|webp)$/i.test(p)) src.images?.push(web(relative(chapterDir, p)));
  for (const p of walk(join(root, 'content'))) if (/\.(jpe?g|png|webp)$/i.test(p)) src.images?.push(web(relative(root, p)));

  for (const kind of KINDS) {
    const validate = ajv.compile(JSON.parse(readFileSync(join(root, kind.schema), 'utf8')));
    for (const p of walk(join(root, kind.dir))) {
      if (!p.endsWith(kind.suffix)) continue;
      const rel = web(relative(root, p));
      files[rel] = [];
      let doc: unknown;
      try {
        doc = JSON.parse(readFileSync(p, 'utf8'));
      } catch (e) {
        files[rel].push(`not valid JSON: ${(e as Error).message}`);
        continue;
      }
      if (!validate(doc)) {
        for (const err of validate.errors ?? []) files[rel].push(`schema: ${err.instancePath || '/'} ${err.message}`);
        continue;
      }
      (src[kind.key] as Record<string, unknown>)[rel] = doc;
    }
  }

  src.readFile = (docPath, file) => {
    const base = docPath.includes('/') ? join(root, dirname(docPath)) : chapterDir;
    const full = join(base, file);
    return /\.zwo$/i.test(file) ? readFileSync(full, 'utf8') : new Uint8Array(readFileSync(full));
  };
  const { catalogue, problems } = buildCatalogue(src);
  // Attribute problems to their file where the message names one.
  const loose: string[] = [];
  for (const msg of problems) {
    const file = Object.keys(files).find((f) => msg.startsWith(f));
    if (file) files[file].push(msg.slice(file.length).replace(/^[: ]+/, ''));
    else loose.push(msg);
  }
  return { catalogue, files, problems: loose };
}

export function countProblems(r: ContentReport): number {
  return r.problems.length + Object.values(r.files).reduce((a, p) => a + p.length, 0);
}

export function formatProblems(r: ContentReport): string {
  const lines: string[] = [];
  for (const [f, p] of Object.entries(r.files)) if (p.length) lines.push(`✗ ${f}`, ...p.map((x) => `    ${x}`));
  for (const p of r.problems) lines.push(`✗ ${p}`);
  return lines.join('\n');
}

/** Build and write the catalogue. Throws if the content has problems. */
export function writeCatalogue(root = '.'): Catalogue {
  const report = loadContent(root);
  if (countProblems(report)) throw new Error(`Content has problems:\n${formatProblems(report)}`);
  const text = `${JSON.stringify(report.catalogue, null, 1)}\n`;
  const out = join(root, CATALOGUE_FILE);
  if (!existsSync(out) || readFileSync(out, 'utf8') !== text) writeFileSync(out, text);
  return report.catalogue;
}
