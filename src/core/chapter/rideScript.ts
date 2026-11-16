import type { StepSpec } from '../workout';
import type { Chapter, DialogueCue, GlassLine, HudItem } from './types';

/**
 * Ride script <-> chapter draft.
 *
 * A ride script is the writers' Markdown table (columns: Time, Workout, What
 * we see, What we hear, Dialogue, HUD / gameplay). `rideScriptToChapter`
 * turns it into a draft chapter: workout steps, beats, dialogue lines with
 * estimated timing, glass text, simple HUD notices and author notes. It flags
 * everything it could not map or had to guess. The draft is a starting point
 * for an author, not a finished chapter.
 */

export interface RideScriptRow {
  /** Seconds. */
  t: number;
  workout: string;
  see: string;
  hear: string;
  dialogue: string;
  hud: string;
}

export interface ConvertResult {
  chapter: Chapter;
  /** Things the converter guessed, skipped or could not map, each prefixed with the row time. */
  flags: string[];
  rows: RideScriptRow[];
}

export interface ConvertOptions {
  id?: string;
  title?: string;
}

const EMPTY = /^(—|-|–|none|n\/a)?$/i;

export function parseClock(s: string): number | undefined {
  const m = /^\s*(?:(\d+):)?(\d{1,3}):(\d{2})\s*$/.exec(s);
  if (!m) return undefined;
  return (m[1] ? Number(m[1]) * 3600 : 0) + Number(m[2]) * 60 + Number(m[3]);
}

export function formatClock(t: number): string {
  const s = Math.max(0, Math.round(t));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Split a Markdown table row into cells, honouring escaped pipes. */
function cells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').replace(/<br\s*\/?>/gi, ' / ').trim());
}

/** Extract every ride-script table row from a Markdown document (there may be several tables, one per act). */
export function parseRideScriptTable(markdown: string): RideScriptRow[] {
  const rows: RideScriptRow[] = [];
  let cols: Record<string, number> | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) { cols = undefined; continue; }
    const c = cells(line);
    if (c.every((x) => /^:?-{2,}:?$/.test(x))) continue; // separator row
    const lower = c.map((x) => x.toLowerCase());
    if (lower.includes('time') && lower.some((x) => x.startsWith('workout'))) {
      cols = {};
      lower.forEach((name, i) => {
        if (name === 'time') (cols as Record<string, number>).t = i;
        else if (name.startsWith('workout')) (cols as Record<string, number>).workout = i;
        else if (name.includes('see')) (cols as Record<string, number>).see = i;
        else if (name.includes('hear')) (cols as Record<string, number>).hear = i;
        else if (name.startsWith('dialogue')) (cols as Record<string, number>).dialogue = i;
        else if (name.startsWith('hud')) (cols as Record<string, number>).hud = i;
      });
      continue;
    }
    if (!cols) continue;
    const t = parseClock(c[cols.t] ?? '');
    if (t === undefined) continue;
    const get = (k: string) => (cols && cols[k] !== undefined ? c[cols[k]] ?? '' : '');
    rows.push({ t, workout: get('workout'), see: get('see'), hear: get('hear'), dialogue: get('dialogue'), hud: get('hud') });
  }
  return rows.sort((a, b) => a.t - b.t);
}

function seconds(text: string): number | undefined {
  const clock = /(\d+):(\d{2})/.exec(text);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const min = /(\d+(?:\.\d+)?)\s*min/.exec(text);
  if (min) return Number(min[1]) * 60;
  const sec = /(\d+(?:\.\d+)?)\s*s\b/.exec(text);
  if (sec) return Number(sec[1]);
  return undefined;
}

/**
 * Read a Workout cell into steps that fill `span` seconds. Understands:
 * "55%", "50%, free spin", "65% → 80% over 1:30", "85–90%", "45% for 2 min",
 * "30 s at 120%, ERG off", "2 × (20 s at 115%, 20 s at 75%), ERG off".
 */
export function parseWorkoutCell(cell: string, span: number, label: string | undefined, flag: (msg: string) => void): StepSpec[] {
  const text = cell.trim();
  const ergOff = /erg\s*off/i.test(text);
  const erg = ergOff ? { erg: false } : {};
  const named = label ? { label } : {};
  const steps: StepSpec[] = [];
  let used: number;

  const sets = /(\d+)\s*[×x]\s*\(\s*(\d+)\s*s\s+at\s+(\d+(?:\.\d+)?)%\s*,\s*(\d+)\s*s\s+at\s+(\d+(?:\.\d+)?)%\s*\)/i.exec(text);
  const ramp = /(\d+(?:\.\d+)?)%?\s*(?:→|->|–|-|to)\s*(\d+(?:\.\d+)?)%/.exec(text);
  const timed = /(\d+(?:\.\d+)?)\s*(s|min)\s+at\s+(\d+(?:\.\d+)?)%/i.exec(text);
  const plain = /(\d+(?:\.\d+)?)%/.exec(text);

  if (sets) {
    const repeat = Number(sets[1]);
    const on = { duration: Number(sets[2]), power: Number(sets[3]) / 100, ...named };
    const off = { duration: Number(sets[4]), power: Number(sets[5]) / 100, label: 'Recover' };
    steps.push({ kind: 'intervals', repeat, on, off, ...erg });
    used = repeat * (on.duration + off.duration);
  } else if (ramp && !timed) {
    const explicit = /over\s+([\d:.]+\s*(?:min|s)?)/i.exec(text);
    const d = explicit ? seconds(explicit[1]) ?? span : span;
    steps.push({ kind: 'ramp', duration: d, from: Number(ramp[1]) / 100, to: Number(ramp[2]) / 100, ...named, ...erg });
    used = d;
    if (/\+\s*\d+%\s*a\s*minute/i.test(text)) flag(`workout "${text}": stepped climb read as a smooth ramp`);
  } else if (timed) {
    const d = Number(timed[1]) * (timed[2].toLowerCase() === 'min' ? 60 : 1);
    steps.push({ kind: 'steady', duration: d, power: Number(timed[3]) / 100, ...named, ...erg });
    used = d;
  } else if (plain) {
    const explicit = /for\s+([\d:.]+\s*(?:min|s)?)/i.exec(text);
    const d = explicit ? seconds(explicit[1]) ?? span : span;
    steps.push({ kind: 'steady', duration: d, power: Number(plain[1]) / 100, ...named, ...erg });
    used = d;
  } else {
    if (span > 0) {
      flag(`workout "${text}": not understood; filled with free ride`);
      steps.push({ kind: 'free', duration: span, ...named });
    }
    return steps;
  }

  if (span > 0 && Math.abs(used - span) > 0.5) {
    if (used < span) {
      // The cell covers less than the row: hold the last target for the remainder.
      const last = steps[steps.length - 1];
      const power = last.kind === 'steady' ? last.power : last.kind === 'ramp' ? last.to : last.kind === 'intervals' ? last.off.power : undefined;
      flag(`workout "${text}": covers ${used} s of a ${span} s row; the rest is filled at ${power !== undefined ? Math.round(power * 100) + '%' : 'free ride'}`);
      steps.push(power !== undefined ? { kind: 'steady', duration: span - used, power, ...erg } : { kind: 'free', duration: span - used });
    } else {
      flag(`workout "${text}": lasts ${used} s but the row is only ${span} s; later rows will start late`);
    }
  }
  return steps;
}

interface Line { speaker: string; text: string; direction?: string; added: boolean }

/** Read a Dialogue cell into spoken lines, glass lines and leftover prose. */
export function parseDialogueCell(cell: string): { lines: Line[]; glass: { text: string; added: boolean }[]; other: string[] } {
  const lines: Line[] = [];
  const glass: { text: string; added: boolean }[] = [];
  const other: string[] = [];
  if (EMPTY.test(cell.trim())) return { lines, glass, other };

  // Glass cells: "**Glass:** A / B / C" (italic segments are writer additions).
  const g = /^\**\s*Glass:?\**:?\s*(.*)$/i.exec(cell.trim());
  if (g) {
    const wholeItalic = /^\*[^*]/.test(cell.trim()) && !/^\*\*/.test(cell.trim());
    for (const part of g[1].split(/\s+\/\s+/)) {
      const added = wholeItalic || /^\*.*\*$/.test(part.trim());
      const text = part.replace(/\*/g, '').trim();
      if (text) glass.push({ text, added });
    }
    return { lines, glass, other };
  }

  // Spoken lines. Track italics (single asterisks) to mark writer additions, then strip the markup.
  const tokens = /(\*\*|\*)|\(([^)]*)\)|["“]([^"”]*)["”]|([^*("“]+)/g;
  let speaker = '';
  let direction: string | undefined;
  let italic = false;
  let m: RegExpExecArray | null;
  while ((m = tokens.exec(cell))) {
    if (m[1] === '*') { italic = !italic; continue; }
    if (m[1] === '**') continue;
    if (m[2] !== undefined) { direction = m[2].trim(); continue; }
    if (m[3] !== undefined) {
      if (speaker) lines.push({ speaker, text: m[3].trim(), ...(direction ? { direction } : {}), added: italic });
      else other.push(`"${m[3].trim()}"`);
      direction = undefined;
      continue;
    }
    const chunk = (m[4] ?? '').trim();
    if (!chunk || chunk === ':') continue;
    const sp = /^([A-Z][\w' -]{0,24}?)\s*:?$/.exec(chunk.replace(/:$/, '').trim()) && /:$|^[A-Z][\w' -]{0,24}$/.test(chunk) ? chunk.replace(/:$/, '').trim() : undefined;
    if (sp && sp.split(' ').length <= 3) { speaker = sp; direction = undefined; }
    else other.push(chunk.replace(/^[:\s]+/, ''));
  }
  return { lines, glass, other: other.filter(Boolean) };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sayTime = (text: string) => Math.max(1.2, Math.round((text.split(/\s+/).length / 2.7 + 0.3) * 10) / 10);

function beatTitle(see: string, fallback: string): string {
  const first = see.replace(/\*/g, '').split(/[:;.]/)[0].trim();
  if (!first) return fallback;
  return first.length > 48 ? first.slice(0, 45).trimEnd() + '…' : first;
}

export function rideScriptToChapter(markdown: string, opts: ConvertOptions = {}): ConvertResult {
  const rows = parseRideScriptTable(markdown);
  const flags: string[] = [];
  if (rows.length === 0) throw new Error('No ride-script table found (expected columns: Time, Workout, What we see, What we hear, Dialogue, HUD / gameplay)');

  const heading = /^#\s+(.+)$/m.exec(markdown)?.[1].trim();
  const title = opts.title ?? heading ?? 'Untitled chapter';
  const steps: StepSpec[] = [];
  const beats: { t: number; title: string }[] = [];
  const dialogue: DialogueCue[] = [];
  const glass: GlassLine[] = [];
  const hud: HudItem[] = [];
  const notes: NonNullable<Chapter['notes']> = [];
  let clock = 0; // where the workout has got to

  rows.forEach((row, i) => {
    const next = rows[i + 1];
    const stamp = formatClock(row.t);
    const flag = (msg: string) => flags.push(`${stamp} ${msg}`);
    const ends = /^(ride ends|end|finish)/i.test(row.workout.trim());
    const span = next ? next.t - row.t : 0;
    const title0 = beatTitle(row.see, `Beat ${i + 1}`);
    beats.push({ t: row.t, title: title0 });

    if (!ends) {
      if (!next) flag('last row has a workout but no following row to give it a length; add a "Ride ends" row');
      if (Math.abs(clock - row.t) > 0.5) flag(`workout is at ${formatClock(clock)} when this row starts`);
      const made = parseWorkoutCell(row.workout, span, title0, flag);
      for (const s of made) clock += s.kind === 'intervals' ? s.repeat * (s.on.duration + s.off.duration) : s.duration;
      steps.push(...made);
    }

    if (!EMPTY.test(row.see)) notes.push({ t: row.t, kind: 'see', text: row.see });
    if (!EMPTY.test(row.hear)) {
      notes.push({ t: row.t, kind: 'hear', text: row.hear });
      flag(`sound "${row.hear}": kept as a note; add sfx and music by hand`);
    }

    // Dialogue: lines are laid out one after another from a second into the row.
    const d = parseDialogueCell(row.dialogue);
    let at = row.t + 1;
    d.lines.forEach((line, k) => {
      const dur = sayTime(line.text);
      const clip = `todo-${stamp.replace(':', '')}-${slug(line.speaker)}-${k + 1}`;
      dialogue.push({ t: Math.round(at * 10) / 10, clip, subs: [{ offset: 0, duration: dur, speaker: line.speaker.toUpperCase(), text: line.text }] });
      at += dur + 0.5;
    });
    if (d.lines.length) {
      flag(`${d.lines.length} dialogue line${d.lines.length > 1 ? 's' : ''}: timing is estimated and clips are placeholders ("todo-…"); record and retime`);
      if (span > 0 && at - row.t > span) flag(`dialogue runs ${Math.round(at - row.t)} s, longer than the ${span} s row`);
    }
    let gAt = row.t + 3;
    for (const gl of d.glass) {
      const hold = Math.max(6, Math.round(gl.text.length / 4));
      glass.push({ t: gAt, text: gl.text.toUpperCase(), hold });
      gAt += hold + 4;
    }
    if (d.glass.length && span > 0 && gAt - row.t > span + 4) flag(`glass text runs ${Math.round(gAt - row.t)} s, longer than the ${span} s row`);
    for (const o of d.other) {
      notes.push({ t: row.t, kind: 'todo', text: `Dialogue note: ${o}` });
      flag(`dialogue "${o}": not a spoken line; kept as a note`);
    }

    // HUD
    if (!EMPTY.test(row.hud)) {
      for (const raw of row.hud.split(';')) {
        const part = raw.trim();
        if (!part) continue;
        const quoted = /["“]([^"”]+)["”]/.exec(part)?.[1];
        const hold = Math.min(8, Math.max(4, span || 6));
        if (/^no hud\b/i.test(part)) {
          if (span > 0) hud.push({ type: 'hide', from: row.t, to: row.t + span, elements: ['all'] });
        } else if (/spin-?up cue/i.test(part)) {
          // Spin-up cues come from the workout automatically.
        } else if (/banner/i.test(part) && quoted) {
          hud.push({ type: 'banner', from: row.t, to: row.t + Math.max(span, 5), text: quoted.toUpperCase(), tone: 'warning' });
        } else if (/notice/i.test(part) && quoted) {
          hud.push({ type: 'notice', t: row.t + 1, hold, kind: 'info', text: quoted });
        } else if (/marker|waypoint|heading|destination/i.test(part)) {
          hud.push({ type: 'notice', t: row.t + 1, hold, kind: 'location', text: part });
          flag(`HUD "${part}": added as a location notice; replace with a waypoint`);
        } else {
          notes.push({ t: row.t, kind: 'todo', text: `HUD: ${part}` });
          flag(`HUD "${part}": no automatic mapping; kept as a note`);
        }
      }
    }
  });

  const last = rows[rows.length - 1];
  const duration = /^(ride ends|end|finish)/i.test(last.workout.trim()) ? last.t : clock;
  if (Math.abs(clock - duration) > 0.5) flags.push(`workout totals ${formatClock(clock)} but the script ends at ${formatClock(duration)}`);
  // Glass and notices must stay inside the chapter.
  for (const g of glass) if (g.t > duration) g.t = duration;

  const chapter: Chapter = {
    format: 1,
    id: opts.id ?? (slug(title) || 'draft'),
    title,
    duration,
    workout: { name: title, steps },
    beats,
    dialogue,
    glass,
    hud,
    // A placeholder scene so the draft is a valid chapter straight away.
    scene: { segments: [{ from: 0, id: 'stills' }], speed: [[0, 0], [duration, 0]] },
    notes,
  };
  flags.push('scene: placeholder only; add scene segments, a speed curve, sfx and music');
  return { chapter, flags, rows };
}

/**
 * Write a chapter draft back out as a ride-script table. With
 * `rideScriptToChapter` this round-trips the things the table can express:
 * times, workout targets, spoken lines, glass text, notes and simple notices.
 */
export function chapterToRideScript(chapter: Chapter): string {
  const beats = chapter.beats ?? [];
  const D = chapter.duration;
  const out: string[] = [`# ${chapter.title}`, '', '| Time | Workout | What we see | What we hear | Dialogue | HUD / gameplay |', '| --- | --- | --- | --- | --- | --- |'];
  const esc = (s: string) => s.replace(/\|/g, '\\|');
  const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
  const dur = (s: number) => (s % 60 === 0 && s >= 120 ? `${s / 60} min` : s >= 60 ? formatClock(s).replace(/^0/, '') : `${s} s`);
  // Lay the workout steps on the clock.
  const specs = 'steps' in chapter.workout ? chapter.workout.steps : [];
  const timeline: { t: number; end: number; spec: StepSpec }[] = [];
  let t = 0;
  for (const spec of specs) {
    const d = spec.kind === 'intervals' ? spec.repeat * (spec.on.duration + spec.off.duration) : spec.duration;
    timeline.push({ t, end: t + d, spec });
    t += d;
  }
  beats.forEach((b, i) => {
    const end = beats[i + 1]?.t ?? D;
    const mine = timeline.filter((x) => x.t >= b.t - 0.01 && x.t < end - 0.01);
    const span = end - b.t;
    let workout = b.t >= D - 0.01 ? 'Ride ends' : '—';
    const s = mine[0]?.spec;
    if (s) {
      const erg = 'erg' in s && s.erg === false ? ', ERG off' : '';
      const d = mine[0].end - mine[0].t;
      if (s.kind === 'intervals') workout = `${s.repeat} × (${s.on.duration} s at ${pct(s.on.power ?? 0)}, ${s.off.duration} s at ${pct(s.off.power ?? 0)})${erg}`;
      else if (s.kind === 'ramp') workout = `${pct(s.from)} → ${pct(s.to)}${Math.abs(d - span) > 0.5 ? ` over ${dur(d)}` : ''}${erg}`;
      else if (s.kind === 'steady') workout = Math.abs(d - span) > 0.5 || erg ? `${dur(d)} at ${pct(s.power ?? 0)}${erg}` : pct(s.power ?? 0);
      else workout = 'Free ride';
    }
    const note = (kind: string) => (chapter.notes ?? []).filter((n) => n.t === b.t && n.kind === kind).map((n) => n.text).join('; ') || '—';
    const spoken = (chapter.dialogue ?? []).filter((c) => c.t >= b.t && c.t < end)
      .flatMap((c) => (c.subs ?? []).map((sub) => `**${sub.speaker[0]}${sub.speaker.slice(1).toLowerCase()}:** "${sub.text}"`));
    const written = (chapter.glass ?? []).filter((g) => g.t >= b.t && g.t < end).map((g) => g.text);
    const todo = (chapter.notes ?? []).filter((n) => n.t === b.t && n.kind === 'todo' && n.text.startsWith('Dialogue note: ')).map((n) => n.text.slice(15));
    const dialogue = [...spoken, ...(written.length ? [`**Glass:** ${written.join(' / ')}`] : []), ...todo].join(' ') || '—';
    const hud = [
      ...(chapter.hud ?? []).filter((h) => ('t' in h ? h.t : h.from) >= b.t && ('t' in h ? h.t : h.from) < end).map((h) =>
        h.type === 'hide' ? 'No HUD' : h.type === 'banner' ? `"${h.text}" banner` : h.type === 'notice' ? (h.kind === 'location' ? h.text : `notice "${h.text}"`) : ''),
      ...(chapter.notes ?? []).filter((n) => n.t === b.t && n.kind === 'todo' && n.text.startsWith('HUD: ')).map((n) => n.text.slice(5)),
    ].filter(Boolean).join('; ') || '—';
    out.push(`| ${formatClock(b.t)} | ${esc(workout)} | ${esc(note('see'))} | ${esc(note('hear'))} | ${esc(dialogue)} | ${esc(hud)} |`);
  });
  if (!beats.some((b) => b.t >= D - 0.01)) out.push(`| ${formatClock(D)} | Ride ends | — | — | — | — |`);
  out.push('');
  return out.join('\n');
}
