import type { CatalogueEntry, GraphBar } from '../../core/content';
import { h, svg } from './dom';

const ZONES = ['#8b95b5', '#6ec8ff', '#6fe3b4', '#ffd166', '#ff9f43', '#ff4d6d', '#ff4d6d'];
const BOUNDS = [0.55, 0.75, 0.9, 1.05, 1.2, 1.5];
export const zoneColour = (f: number): string => ZONES[BOUNDS.findIndex((b) => f < b) < 0 ? 6 : BOUNDS.findIndex((b) => f < b)];

export function fmtDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function fmtClock(seconds: number): string {
  const v = Math.max(0, Math.round(seconds));
  const hh = Math.floor(v / 3600);
  const mm = Math.floor((v % 3600) / 60);
  const ss = String(v % 60).padStart(2, '0');
  return hh > 0 ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

export function fmtDistance(metres: number, units: string, digits = 1): string {
  return units === 'imperial' ? `${(metres / 1609.344).toFixed(digits)} mi` : `${(metres / 1000).toFixed(digits)} km`;
}

export function fmtClimb(metres: number, units: string): string {
  return units === 'imperial' ? `${Math.round(metres * 3.28084)} ft` : `${Math.round(metres)} m`;
}

export const FOCUS_LABEL: Record<string, string> = {
  recovery: 'Recovery', endurance: 'Endurance', tempo: 'Tempo', sweetspot: 'Sweet spot', threshold: 'Threshold',
  vo2: 'VO2 max', anaerobic: 'Anaerobic', sprint: 'Sprint', mixed: 'Mixed', test: 'Test',
};

/** The power graph of a workout: one bar per step, coloured by zone. */
export function workoutGraph(graph: GraphBar[] | undefined, cls = 'graph'): SVGSVGElement | HTMLElement {
  if (!graph || graph.length === 0) return h('div', { class: cls });
  const total = graph.reduce((a, b) => a + b[0], 0) || 1;
  const top = Math.max(1.3, ...graph.map((b) => Math.max(b[1], b[2])));
  let x = 0;
  let out = '';
  for (const [d, from, to] of graph) {
    const w = (d / total) * 1000;
    const y0 = 100 - (Math.max(from, 0.08) / top) * 100;
    const y1 = 100 - (Math.max(to, 0.08) / top) * 100;
    const free = from === 0 && to === 0;
    out += `<path d="M${x.toFixed(1)} 100V${y0.toFixed(1)}L${(x + w).toFixed(1)} ${y1.toFixed(1)}V100Z" fill="${free ? 'rgba(255,255,255,.22)' : zoneColour(Math.max(from, to))}"/>`;
    x += w;
  }
  const ftpY = 100 - (1 / top) * 100;
  return svg(`<svg viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" aria-label="Workout power graph">${out}<path d="M0 ${ftpY}H1000" stroke="rgba(255,255,255,.35)" stroke-dasharray="6 8" vector-effect="non-scaling-stroke"/></svg>`, cls);
}

/** A terrain profile: height against distance. */
export function profileGraph(profile: [number, number][], length: number, cls = 'graph'): SVGSVGElement {
  const pts: [number, number][] = [[0, 0]];
  let height = 0;
  const step = length / 200;
  const gradeAt = (d: number): number => {
    if (d <= profile[0][0]) return profile[0][1];
    for (let i = 1; i < profile.length; i++) {
      if (d <= profile[i][0]) return profile[i - 1][1] + ((profile[i][1] - profile[i - 1][1]) * (d - profile[i - 1][0])) / (profile[i][0] - profile[i - 1][0]);
    }
    return profile[profile.length - 1][1];
  };
  for (let d = 0; d < length; d += step) { height += (gradeAt(d + step / 2) / 100) * step; pts.push([d + step, height]); }
  const lo = Math.min(...pts.map((p) => p[1]));
  const hi = Math.max(lo + 20, ...pts.map((p) => p[1]));
  const y = (v: number) => 92 - ((v - lo) / (hi - lo)) * 80;
  const line = pts.map(([d, v], i) => `${i ? 'L' : 'M'}${((d / length) * 1000).toFixed(1)} ${y(v).toFixed(1)}`).join('');
  return svg(`<svg viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" aria-label="Terrain profile"><path d="${line}L1000 100L0 100Z" fill="rgba(127,233,255,.18)"/><path d="${line}" fill="none" stroke="#7fe9ff" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`, cls);
}

export function stat(value: string, label: string): HTMLElement {
  return h('div', { class: 'stat' }, h('div', { class: 'big' }, value), h('div', { class: 'unit' }, label));
}

export function fact(label: string, value: string | number | undefined): HTMLElement | null {
  return value === undefined || value === '' ? null : h('span', { class: 'fact' }, h('b', null, value), ` ${label}`);
}

export function tag(text: string, tone = ''): HTMLElement {
  return h('span', { class: `tag ${tone}` }, text);
}

export interface FilterDef { key: string; label: string; options: { value: string; label: string }[] }

/**
 * A grid of cards with a row of filters above it. Filters are remembered per
 * screen for the session (a convenience; nothing depends on it).
 */
export function cardGrid<T>(opts: {
  id: string; items: T[]; filters: FilterDef[]; match: (item: T, key: string, value: string) => boolean;
  card: (item: T) => HTMLElement; empty: string;
}): HTMLElement {
  const state: Record<string, string> = {};
  try { Object.assign(state, JSON.parse(sessionStorage.getItem(`overreach.filter.${opts.id}`) ?? '{}')); } catch { /* no memory, no matter */ }
  const grid = h('div', { class: 'cards' });
  const count = h('span', { class: 'dim small', 'aria-live': 'polite' });
  const draw = () => {
    const shown = opts.items.filter((it) => opts.filters.every((f) => !state[f.key] || opts.match(it, f.key, state[f.key])));
    grid.replaceChildren(...(shown.length ? shown.map(opts.card) : [h('p', { class: 'dim' }, opts.empty)]));
    count.textContent = `${shown.length} of ${opts.items.length}`;
    try { sessionStorage.setItem(`overreach.filter.${opts.id}`, JSON.stringify(state)); } catch { /* fine */ }
  };
  const bar = h('div', { class: 'filters' }, opts.filters.map((f) => h('label', null, f.label,
    h('select', {
      'data-filter': f.key,
      onchange: (e: Event) => { state[f.key] = (e.target as HTMLSelectElement).value; draw(); },
    }, h('option', { value: '' }, 'Any'), f.options.map((o) => h('option', { value: o.value, selected: state[f.key] === o.value }, o.label))))), count);
  draw();
  return h('div', { class: 'stack' }, bar, grid);
}

export function sessionLine(e: CatalogueEntry | undefined): string {
  if (!e) return '';
  const bits = [e.duration ? fmtDuration(e.duration) : '', e.type === 'chapter' ? 'Chapter' : e.focus ? FOCUS_LABEL[e.focus] : ''];
  return bits.filter(Boolean).join(' · ');
}

/** Offer a file to save. */
export function saveFile(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
