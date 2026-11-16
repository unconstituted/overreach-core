/**
 * Loads the Chapter 1 browser prototype (reference/ch1-prototype) into a
 * sandbox and exposes its data tables and timeline functions. Used by the
 * port tool and by the tests that prove the chapter file reproduces it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

type Kf = [number, number][];

export interface Prototype {
  DUR: number;
  IV: [number, number, number, number, string, number?][];
  SPD: Kf;
  BEATS: [number, string][];
  CUES: { t: number; c: string; g?: number; rate?: number; subs?: [number, number, string, string][] }[];
  GLASS: [number, string, number][];
  STILLS: { i: string; a: number; b: number; fi: number; fo: number; f: [number, number, number]; t: [number, number, number]; o?: string; rot?: number; visor?: number; ins?: number }[];
  ENVK: [number, Record<string, number | number[]>][];
  FOVK: Kf;
  SHAKEK: Kf;
  IMPACTS: [number, number][];
  /** One-shot sounds, expanded: each prototype closure is run against a recorder. */
  sfx: { t: number; id: string; args: number[] }[];
  targetPct(t: number): number;
  ivAt(t: number): [number, number, number, number, string, number?];
  speedAt(t: number): number;
  S(t: number): number;
  camMode(t: number): string;
  envAt(t: number): Record<string, number | number[]>;
  subAt(t: number): [number, number, string, string] | null;
  musicAt(t: number): { level: number; kick: number; hat: number; bass: number; arp: number; pad: number; bright: number; mode: string; party: boolean; fast: boolean };
  kf(t: number, keys: Kf): number;
}

const SOUND_IDS = ['step', 'boom', 'hissSeal', 'boot', 'callTone', 'chime', 'glitch', 'riser', 'whoosh', 'swell', 'alarm', 'creak', 'tick', 'crack', 'ping'];

export function loadPrototype(root = 'reference/ch1-prototype'): Prototype {
  const read = (f: string) => readFileSync(resolve(root, f), 'utf8');
  const src = [read('a_core.js'), read('b_world.js'), read('c_audio.js'),
    ';({DUR,IV,SPD,BEATS,CUES,GLASS,STILLS,ENVK,FOVK,SHAKEK,IMPACTS,SFX,AU,targetPct,ivAt,speedAt,S,camMode,envAt,subAt,musicAt,kf})'].join('\n');
  const sandbox = { location: { search: '' }, window: {} as Record<string, unknown>, URLSearchParams, Math, console };
  const out = vm.runInNewContext(src, sandbox, { filename: 'ch1-prototype.js' }) as Prototype & {
    SFX: [number, () => void][]; AU: Record<string, unknown>;
  };
  const sfx: Prototype['sfx'] = [];
  let now = 0;
  for (const id of SOUND_IDS) out.AU[id] = (...args: number[]) => { sfx.push({ t: now, id, args }); };
  for (const [t, fn] of out.SFX) { now = t; fn(); }
  return { ...out, sfx };
}
