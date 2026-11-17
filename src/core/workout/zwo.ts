import { DEFAULT_MAX_HR, DEFAULT_THRESHOLD_SPEED, type TargetUnit, type TextEvent, type Workout, type WorkoutStep, WorkoutError } from './model';
import { child, encodeEntities, parseXml, type XmlNode } from './xml';

function num(node: XmlNode, ...names: string[]): number | undefined {
  for (const name of names) {
    const v = node.attrs[name];
    if (v !== undefined && v !== '') {
      const f = Number(v);
      if (Number.isFinite(f)) return f;
    }
  }
  return undefined;
}

function need(node: XmlNode, ...names: string[]): number {
  const v = num(node, ...names);
  if (v === undefined) throw new WorkoutError(`<${node.name}> is missing ${names[0]}`);
  return v;
}

function texts(node: XmlNode): TextEvent[] {
  const out: TextEvent[] = [];
  for (const c of node.children) {
    if (c.name.toLowerCase() !== 'textevent') continue;
    const message = c.attrs.message ?? c.attrs.Message ?? '';
    if (!message) continue;
    const ev: TextEvent = { offset: num(c, 'timeoffset', 'TimeOffset') ?? 0, message };
    const d = num(c, 'duration', 'Duration');
    if (d !== undefined) ev.duration = d;
    out.push(ev);
  }
  return out.sort((a, b) => a.offset - b.offset);
}

/**
 * Parse a Zwift .zwo workout. Supports Warmup, Cooldown, Ramp, SteadyState,
 * IntervalsT, FreeRide (and MaxEffort, treated as free ride) with `textevent`
 * children. Power values are fractions of FTP, as Zwift writes them.
 */
export function parseZwo(xml: string): Workout {
  const doc = parseXml(xml);
  const file = child(doc, 'workout_file');
  if (!file) throw new WorkoutError('Not a .zwo file: no <workout_file> element');
  const body = child(file, 'workout');
  if (!body) throw new WorkoutError('Not a .zwo file: no <workout> element');
  const sportText = (child(file, 'sportType')?.text ?? 'bike').trim().toLowerCase();
  // In Zwift run workouts the "Power" attributes are fractions of threshold pace.
  const U: TargetUnit = sportText === 'run' ? 'pace' : 'ftp';

  const steps: WorkoutStep[] = [];
  let setIndex = 0;
  for (const el of body.children) {
    const cadence = num(el, 'Cadence');
    switch (el.name) {
      case 'SteadyState': {
        const p = need(el, 'Power', 'PowerLow');
        steps.push({
          kind: 'steady', duration: need(el, 'Duration'), target: { unit: U, from: p, to: p },
          cadence, erg: true, texts: texts(el),
        });
        break;
      }
      case 'Warmup':
      case 'Cooldown':
      case 'Ramp': {
        const from = need(el, 'PowerLow', 'Power');
        const to = num(el, 'PowerHigh') ?? from;
        steps.push({
          kind: from === to ? 'steady' : 'ramp', duration: need(el, 'Duration'),
          target: { unit: U, from, to }, cadence, erg: true,
          intensity: el.name === 'Warmup' ? 'warmup' : el.name === 'Cooldown' ? 'cooldown' : undefined,
          texts: texts(el),
        });
        break;
      }
      case 'IntervalsT': {
        const repeat = Math.max(1, Math.round(need(el, 'Repeat')));
        const onD = need(el, 'OnDuration');
        const offD = need(el, 'OffDuration');
        const onP = need(el, 'OnPower', 'PowerOnHigh', 'PowerOnLow');
        const offP = need(el, 'OffPower', 'PowerOffHigh', 'PowerOffLow');
        const onCad = num(el, 'Cadence');
        const offCad = num(el, 'CadenceResting');
        const all = texts(el);
        let setT = 0;
        for (let rep = 1; rep <= repeat; rep++) {
          for (const phase of ['on', 'off'] as const) {
            const d = phase === 'on' ? onD : offD;
            const p = phase === 'on' ? onP : offP;
            if (d > 0) {
              steps.push({
                kind: 'steady', duration: d, target: { unit: U, from: p, to: p },
                cadence: phase === 'on' ? onCad : offCad, erg: true,
                intensity: phase === 'on' ? 'interval' : 'recovery',
                texts: all.filter((t) => t.offset >= setT && t.offset < setT + d).map((t) => ({ ...t, offset: t.offset - setT })),
                set: { index: setIndex, rep, of: repeat, phase },
              });
            }
            setT += d;
          }
        }
        setIndex++;
        break;
      }
      case 'FreeRide':
      case 'MaxEffort':
        steps.push({ kind: 'free', duration: need(el, 'Duration'), cadence, erg: false, texts: texts(el) });
        break;
      default:
        // Unknown elements (e.g. future Zwift additions) are skipped rather than failing the whole file.
        break;
    }
  }
  if (steps.length === 0) throw new WorkoutError('The .zwo file has no workout steps');
  return {
    name: (child(file, 'name')?.text ?? 'Untitled').trim(),
    description: child(file, 'description')?.text.trim() || undefined,
    author: child(file, 'author')?.text.trim() || undefined,
    sport: sportText === 'run' ? 'run' : 'bike',
    steps,
  };
}

function f(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/**
 * Write a workout as .zwo. Absolute targets are converted to fractions with
 * the given references. Zwift has no heart-rate targets, so those are written
 * as a fraction of threshold heart rate (about 90% of maximum), which is the
 * nearest equivalent effort.
 */
export function writeZwo(w: Workout, ftp = 250, thresholdSpeed = DEFAULT_THRESHOLD_SPEED, maxHr = DEFAULT_MAX_HR): string {
  const frac = (v: number, unit: TargetUnit) => f(
    unit === 'ftp' || unit === 'pace' ? v
      : unit === 'watts' ? v / ftp
        : unit === 'speed' ? v / thresholdSpeed
          : unit === 'hr' ? v / 0.9
            : v / maxHr / 0.9,
  );
  const lines: string[] = ['<workout_file>'];
  if (w.author) lines.push(`  <author>${encodeEntities(w.author)}</author>`);
  lines.push(`  <name>${encodeEntities(w.name)}</name>`);
  if (w.description) lines.push(`  <description>${encodeEntities(w.description)}</description>`);
  lines.push(`  <sportType>${w.sport}</sportType>`, '  <workout>');
  for (const s of w.steps) {
    const cad = s.cadence !== undefined ? ` Cadence="${f(s.cadence)}"` : '';
    let open: string;
    let tag: string;
    if (s.kind === 'free' || !s.target) {
      tag = 'FreeRide';
      open = `<FreeRide Duration="${f(s.duration)}"${cad}`;
    } else if (s.kind === 'ramp') {
      tag = s.intensity === 'warmup' ? 'Warmup' : s.intensity === 'cooldown' ? 'Cooldown' : 'Ramp';
      open = `<${tag} Duration="${f(s.duration)}" PowerLow="${frac(s.target.from, s.target.unit)}" PowerHigh="${frac(s.target.to, s.target.unit)}"${cad}`;
    } else {
      tag = 'SteadyState';
      open = `<SteadyState Duration="${f(s.duration)}" Power="${frac(s.target.from, s.target.unit)}"${cad}`;
    }
    if (s.texts.length === 0) lines.push(`    ${open}/>`);
    else {
      lines.push(`    ${open}>`);
      for (const t of s.texts) {
        const d = t.duration !== undefined ? ` duration="${f(t.duration)}"` : '';
        lines.push(`      <textevent timeoffset="${f(t.offset)}"${d} message="${encodeEntities(t.message)}"/>`);
      }
      lines.push(`    </${tag}>`);
    }
  }
  lines.push('  </workout>', '</workout_file>', '');
  return lines.join('\n');
}
