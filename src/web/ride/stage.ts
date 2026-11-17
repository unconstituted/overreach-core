/**
 * Everything drawn over the 3D view: the visor HUD (reference/hud/visor-hud.html),
 * the feel layer on its numbers (reference/hud/peak-hold-feel.html), and the
 * story overlays (stills, canopy, condensation and Glass writing, subtitles,
 * title cards, story widgets). All of it is driven by `ChapterState`, live
 * rider data and `FeelState`; nothing here knows about a specific chapter.
 */
import type { ActiveWidget, Chapter, ChapterRuntime, ChapterState, Still } from '../../core/chapter';
import type { FeelConfig, FeelState } from '../../core/feel';
import { powerZone, POWER_ZONE_NAMES } from '../../core/record';
import { effortOf, formatPace, hrToEffort, paceToEffort, type TargetKind } from '../../core/workout';
import { clamp, lerp, smoothstep as ss } from '../../core/util/math';
import { hash, hash2, noise1 } from '../../core/util/noise';

export interface StageFrame {
  state: ChapterState;
  dt: number;
  /** Wall-clock seconds, for animation that should not follow story time. */
  now: number;
  rider: { power: number; cadence: number; heartRate: number };
  ftp: number;
  maxHr: number;
  feel: FeelState;
  feelConfig: FeelConfig;
  /** Speed shown to the rider, m/s. */
  speed: number;
  /** Screen anchors from the world, for tags. */
  anchors: Record<string, { x: number; y: number } | null>;
  showInserts: boolean;
  /** Replaces the heading read-out on the right (free rides show grade and distance to go). */
  nav?: string;
  showSubtitles: boolean;
  /** Transient centre notice from the app (step changes and the like). */
  flash?: { title: string; text: string; tone?: 'alert' | 'danger' };
  /** Present when running: pace replaces power as the hero number. */
  run?: {
    /** Runner's speed, m/s. */
    speed: number;
    /** FTP-equivalent effort (see `workout/effort.ts`). */
    effort: number;
    units: 'metric' | 'imperial';
    /** False when the runner sets the belt themselves. */
    control: boolean;
  };
}

const ZONE_COLOURS = ['#8b95b5', '#6ec8ff', '#6fe3b4', '#ffd166', '#ff9f43', '#ff4d6d', '#ff4d6d'];
export const zoneColour = (fraction: number): string => ZONE_COLOURS[powerZone(fraction * 100, 100) - 1];

const HTML = `
<canvas id="gl"></canvas>
<div id="stills"></div>
<div id="weird"></div>
<svg id="canopy" viewBox="0 0 1600 900" preserveAspectRatio="none" aria-hidden="true">
  <defs><linearGradient id="dg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a2233"/><stop offset=".12" stop-color="#0a0e18"/><stop offset="1" stop-color="#020308"/></linearGradient></defs>
  <path d="M-40 900 C40 560 200 190 400 -20 L428 -20 C236 200 90 570 20 900Z" fill="#070a12"/><path d="M1640 900 C1560 560 1400 190 1200 -20 L1172 -20 C1364 200 1510 570 1580 900Z" fill="#070a12"/>
  <path d="M20 900 C90 570 236 200 428 -20" fill="none" stroke="#3b4a6a" stroke-width="2"/><path d="M1580 900 C1510 570 1364 200 1172 -20" fill="none" stroke="#3b4a6a" stroke-width="2"/>
  <path d="M0 900 L0 838 C250 760 520 742 800 740 C1080 742 1350 760 1600 838 L1600 900Z" fill="url(#dg)"/><path d="M0 838 C250 760 520 742 800 740 C1080 742 1350 760 1600 838" fill="none" stroke="#46587c" stroke-width="2"/>
</svg>
<canvas id="fog"></canvas>
<div id="visor"></div>
<div id="hud" class="top">
  <svg id="arc" viewBox="0 0 1600 380" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="fade" x1="0" x2="1"><stop offset="0" stop-color="var(--holo)" stop-opacity="0"/><stop offset=".14" stop-color="var(--holo)" stop-opacity=".75"/><stop offset=".5" stop-color="var(--core)" stop-opacity=".95"/><stop offset=".86" stop-color="var(--holo)" stop-opacity=".75"/><stop offset="1" stop-color="var(--holo)" stop-opacity="0"/></linearGradient>
      <filter id="bloom" x="-5%" y="-50%" width="110%" height="200%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <path d="M80 34 Q800 150 1520 34" fill="none" stroke="url(#fade)" stroke-width="1.6" filter="url(#bloom)" vector-effect="non-scaling-stroke"/>
    <path d="M150 50 Q800 166 1450 50" fill="none" stroke="url(#fade)" stroke-width="1" opacity=".28" vector-effect="non-scaling-stroke"/>
    <path id="prog" d="M80 34 Q800 150 1520 34" fill="none" stroke="#f2feff" stroke-width="3.2" pathLength="1" stroke-dasharray="0 1" filter="url(#bloom)" vector-effect="non-scaling-stroke"/>
    <g id="ticks"></g>
  </svg>
  <div class="cl" id="L">
    <div class="lab holo wide" id="zl">ZONE 1 · RECOVERY</div>
    <div class="big holo wide" id="pwrow"><span id="pwn">0</span><i id="pwu">W</i><span id="chev"><i></i><i></i><i></i></span></div>
    <div class="rule" id="prule"><s style="left:52.6%"></s><b id="pbar" style="left:0;width:0"></b><em id="ptgt" style="left:40%"></em><u id="ppk" style="left:0"></u></div>
    <div class="row">
      <div class="mid holo wide" id="hrbox"><span id="hr">0</span><small>BPM</small></div>
      <div class="mid holo wide" id="cadbox"><span id="cad">0</span><small id="cadu">RPM</small></div>
      <div class="mid holo wide" id="tgbox" style="opacity:.75"><span id="tg">TGT 0</span></div>
    </div>
  </div>
  <div class="cl" id="R">
    <div class="lab holo wide" id="sl">VELOCITY · KM/H</div>
    <div class="big holo wide"><span id="spn">0</span></div>
    <div class="rule"><b id="abar" style="left:50%;width:0"></b><em style="left:50%;opacity:.5"></em></div>
    <div class="row">
      <div class="mid holo wide" id="navbox" style="opacity:.75"><span id="nav"></span></div>
      <div class="mid holo wide"><span id="stepleft">0:00</span><small>STEP</small></div>
      <div class="mid holo wide"><span id="clock">0:00</span><small>RIDE</small></div>
    </div>
  </div>
  <div id="C" class="off"><div id="ct" class="holo wide"></div><div id="cs" class="holo wide"></div>
    <svg id="wave" viewBox="0 0 320 44"><polyline id="wl" fill="none" stroke="#f2feff" stroke-width="1.4" points=""/></svg>
    <div id="cbar" hidden><b id="cbarf" style="width:0"></b></div></div>
  <div id="notes" class="holo wide"></div>
  <div id="way" class="holo wide"><i></i><span id="wayl"></span></div>
  <div id="boot" class="holo wide"></div>
  <div id="heat" class="holo wide"><em></em><b id="heatm"></b><span id="heatt">HEAT</span></div>
  <div id="tag" class="holo wide"><i></i><span id="tagl"></span></div>
  <div id="gateov"><svg viewBox="-100 -100 200 200" fill="none" stroke="currentColor" stroke-width="1.2"><circle r="92"/><circle r="70" stroke-dasharray="3 9"/><circle r="44"/><circle r="18" fill="currentColor" fill-opacity=".25"/><path d="M-92 0H-44M44 0H92M0 -92V-44M0 44V92M-65 -65L-31 -31M65 65L31 31M-65 65L-31 31M65 -65L31 -31"/><path d="M0 -70l6 10h-12zM0 70l6 -10h-12zM-70 0l10 6v-12zM70 0l-10 6v-12z" fill="currentColor"/></svg></div>
</div>
<div id="titlecard"></div>
<div id="subs"></div>
<div id="strip">
  <div id="stripinfo"><b id="steplab"></b><span id="steptgt"></span><span class="erg" id="ergoff" hidden>ERG OFF · RIDE IT YOURSELF</span><span class="sp"></span><span id="nextlab"></span></div>
  <div id="graphwrap"><canvas id="graph"></canvas><div id="ph"></div></div>
</div>
<div id="paused">PAUSED</div>
<div id="toast"></div>`;

const fmtClock = (s: number): string => {
  const v = Math.max(0, Math.floor(s));
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const sec = String(v % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};
export { fmtClock };

const speedFmt = (v: number): [string, string] =>
  v < 0.05 ? ['0', 'KM/H'] : v < 1000 ? [Math.round(v * 3.6).toLocaleString('en-GB'), 'KM/H'] : [(v / 1000).toFixed(1), 'KM/S'];

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class Stage {
  readonly canvas: HTMLCanvasElement;
  private readonly el: Record<string, HTMLElement> = {};
  private readonly stills = new Map<Still, { box: HTMLElement; img: HTMLImageElement }>();
  private readonly weird = new Map<string, HTMLImageElement>();
  private readonly fog: HTMLCanvasElement;
  private readonly fx: CanvasRenderingContext2D;
  private readonly fogTile: HTMLCanvasElement;
  private readonly text = new Map<string, string>();
  private lastNotes = '';
  private hudPos: 'top' | 'bot' = 'top';
  private toastTimer = 0;
  private dispPower = 0;
  private dispSpeed = 0;

  constructor(readonly root: HTMLElement, private readonly rt: ChapterRuntime, private readonly imageBase: string, onSeek: (t: number) => void) {
    root.innerHTML = HTML;
    root.querySelectorAll<HTMLElement>('[id]').forEach((e) => { this.el[e.id] = e; });
    this.canvas = this.el.gl as HTMLCanvasElement;
    const chapter: Chapter = rt.chapter;

    for (const s of chapter.stills ?? []) {
      const box = document.createElement('div');
      box.className = 'still';
      const img = document.createElement('img');
      img.src = this.image(s.image); img.alt = ''; img.decoding = 'async';
      box.appendChild(img);
      if (s.insert) { const l = document.createElement('span'); l.className = 'sblabel'; l.textContent = 'STORYBOARD'; box.appendChild(l); }
      this.el.stills.appendChild(box);
      this.stills.set(s, { box, img });
    }
    for (const h of chapter.hud ?? []) {
      if (h.type !== 'widget' || h.id !== 'weird') continue;
      for (const name of (h.params?.images as string[] | undefined) ?? []) {
        if (this.weird.has(name)) continue;
        const im = document.createElement('img');
        im.src = this.image(name); im.alt = '';
        this.el.weird.appendChild(im);
        this.weird.set(name, im);
      }
    }

    // Tick marks along the visor rim.
    const Q = (t: number): [number, number] => [(1 - t) * (1 - t) * 80 + 2 * (1 - t) * t * 800 + t * t * 1520, (1 - t) * (1 - t) * 34 + 2 * (1 - t) * t * 150 + t * t * 34];
    let ticks = '';
    for (let i = 1; i < 40; i++) {
      const t = i / 40; const [x, y] = Q(t); const maj = i % 5 === 0; const len = maj ? 14 : 6; const al = Math.sin(t * Math.PI);
      ticks += `<line x1="${x}" y1="${y + 3}" x2="${x}" y2="${y + 3 + len}" stroke="var(--holo)" stroke-opacity="${(maj ? 0.55 : 0.25) * al}" vector-effect="non-scaling-stroke"/>`;
    }
    this.el.ticks.innerHTML = ticks;

    // Condensation texture.
    this.fog = this.el.fog as HTMLCanvasElement;
    this.fx = this.fog.getContext('2d') as CanvasRenderingContext2D;
    const n = this.fogTile = document.createElement('canvas');
    n.width = n.height = 256;
    const nx = n.getContext('2d') as CanvasRenderingContext2D;
    const id = nx.createImageData(256, 256);
    for (let i = 0; i < 65536; i++) {
      const x = i & 255; const y = i >> 8; const k = (Math.PI * 2) / 256;
      const v = 214 + 16 * Math.sin(x * k * 2 + 2 * Math.sin(y * k * 3)) * Math.sin(y * k * 3 + 1.5 * Math.sin(x * k)) + 10 * Math.sin(x * k * 5 + y * k * 4) + 12 * hash(i);
      id.data[i * 4] = v * 0.92; id.data[i * 4 + 1] = v * 0.96; id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255;
    }
    nx.putImageData(id, 0, 0);

    this.el.graphwrap.addEventListener('click', (e) => {
      const r = this.el.graphwrap.getBoundingClientRect();
      onSeek(((e.clientX - r.left) / r.width) * rt.duration);
    });
    this.drawGraph();
    addEventListener('resize', this.drawGraph);
  }

  private image(name: string): string {
    return /\.\w+$/.test(name) ? `${this.imageBase}/${name}` : `${this.imageBase}/${name}.jpg`;
  }

  setHudPosition(pos: 'top' | 'bot'): void {
    this.hudPos = pos;
    this.el.hud.classList.toggle('top', pos === 'top');
    this.el.hud.classList.toggle('bot', pos === 'bot');
    this.el.visor.classList.toggle('bot', pos === 'bot');
  }

  setSubtitleSize(size: 'small' | 'medium' | 'large'): void {
    this.el.subs.style.fontSize = size === 'small' ? 'clamp(12px, 1.2vw, 17px)' : size === 'large' ? 'clamp(19px, 2.2vw, 30px)' : '';
  }

  setWorkoutStrip(show: boolean): void {
    this.el.strip.style.display = show ? '' : 'none';
  }

  setPaused(paused: boolean): void {
    this.el.paused.style.opacity = paused ? '1' : '0';
  }

  toast(message: string): void {
    this.el.toast.textContent = message;
    this.el.toast.style.opacity = '1';
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { this.el.toast.style.opacity = '0'; }, 1800);
  }

  private readonly drawGraph = (): void => {
    const c = this.el.graph as HTMLCanvasElement;
    const x = c.getContext('2d') as CanvasRenderingContext2D;
    const W = c.width = Math.max(2, c.clientWidth * 2); const H = c.height = Math.max(2, c.clientHeight * 2);
    x.clearRect(0, 0, W, H);
    const { runner } = this.rt; const total = runner.total;
    runner.workout.steps.forEach((s, i) => {
      const x0 = (runner.starts[i] / total) * W; const x1 = (runner.starts[i + 1] / total) * W;
      // Bars are drawn as effort, so a run and a ride of the same session look the same.
      const f = (v: number) => (s.target ? effortOf(v, s.target.unit, runner.thresholds) : v);
      const p0 = s.target ? f(s.target.from) : 0.35; const p1 = s.target ? f(s.target.to) : 0.35;
      x.fillStyle = s.target ? zoneColour(Math.max(p0, p1)) : 'rgba(255,255,255,.25)';
      x.globalAlpha = 0.85;
      x.beginPath(); x.moveTo(x0 + 0.5, H); x.lineTo(x0 + 0.5, H - (p0 / 1.3) * H); x.lineTo(x1 - 0.5, H - (p1 / 1.3) * H); x.lineTo(x1 - 0.5, H); x.fill();
    });
    x.globalAlpha = 1;
  };

  /** Set text only when it changed; optionally flicker like a refreshed projection. */
  private T(id: string, v: string): void {
    if (this.text.get(id) === v) return;
    this.text.set(id, v);
    this.el[id].textContent = v;
  }

  update(f: StageFrame): void {
    const { state, feel } = f; const t = state.t; const el = this.el; const hudS = state.hud;
    const hidden = (k: string) => hudS.hidden.includes(k);
    const widget = (id: string): ActiveWidget | undefined => hudS.widgets.find((w) => w.id === id);
    const fx = (id: string) => hudS.effects.includes(id);
    const cam = state.scene.camera;

    /* ----- stills ----- */
    let cover = 0;
    const live = new Set<Still>();
    for (const a of state.stills) {
      if (a.still.insert && !f.showInserts) continue;
      const e = this.stills.get(a.still);
      if (!e || a.opacity <= 0) continue;
      live.add(a.still);
      const walk = state.scene.id === 'stills' ? Math.sin(t * 5.6) * 0.35 * clamp(state.scene.speed) : 0;
      e.box.style.display = 'block'; e.box.style.opacity = String(a.opacity);
      e.img.style.transformOrigin = a.still.origin ?? '50% 50%';
      e.img.style.transform = `translate(${a.x + Math.sin(t * 0.31) * 0.3}%,${a.y + walk + Math.cos(t * 0.23) * 0.25}%) scale(${a.scale}) rotate(${a.still.rotate ?? 0}deg)`;
      e.box.classList.toggle('visor', !!a.still.visor && !hidden('all'));
      if (!a.still.visor) cover = Math.max(cover, a.opacity);
    }
    for (const [s, e] of this.stills) if (!live.has(s) && e.box.style.display !== 'none') e.box.style.display = 'none';

    /* ----- blackout apparitions ----- */
    const weird = widget('weird');
    const weirdK = weird ? Math.min(clamp(weird.age / Number(weird.params.fadeIn ?? 3)), clamp((weird.to - t) / Number(weird.params.fadeOut ?? 4))) : 0;
    let k = 0;
    for (const im of this.weird.values()) {
      const ph = t * (0.11 + k * 0.017) + k * 1.7; const cyc = Math.floor(ph); const fr = ph - cyc;
      const o = weirdK * Math.pow(Math.max(0, Math.sin(fr * Math.PI)), 6) * (hash2(cyc, k) > 0.45 ? 0.55 : 0);
      if (o > 0.01) {
        const side = hash2(cyc, k + 9) > 0.5;
        im.style.display = 'block'; im.style.opacity = String(o);
        im.style.left = `${side ? 58 + hash2(cyc, k + 3) * 22 : -12 + hash2(cyc, k + 3) * 22}%`; im.style.top = `${hash2(cyc, k + 5) * 60 - 5}%`;
        im.style.transform = `scale(${1 + fr * 0.25}) rotate(${(hash2(cyc, k + 7) - 0.5) * 30}deg)`;
      } else if (im.style.display !== 'none') im.style.display = 'none';
      k++;
    }

    /* ----- title card ----- */
    const title = hudS.title;
    const th = title ? `${title.small ? `<small>${esc(title.small)}</small>` : ''}${title.big ? `<b>${esc(title.big)}</b>` : ''}${title.em ? `<em>${esc(title.em)}</em>` : ''}` : '';
    if (this.text.get('titlecard') !== th) { this.text.set('titlecard', th); el.titlecard.innerHTML = th; }
    el.titlecard.style.opacity = String(title?.opacity ?? 0);

    /* ----- canopy ----- */
    const canopy = widget('canopy');
    el.canopy.style.opacity = String(canopy && cam === 'cockpit' ? clamp(canopy.age / 6) * (1 - cover) : 0);

    /* ----- visor and HUD visibility ----- */
    const helmet = !hidden('all');
    el.visor.style.opacity = helmet ? '1' : '0';
    const hud = el.hud;
    const I = Math.min(1, feel.intensity);
    const on = f.feelConfig.enabled;
    let hudOp = helmet ? 1 : 0;
    if (fx('flicker')) hudOp *= Math.sin(f.now * 40) > 0 ? 0.9 : 0.3;
    hud.style.opacity = String(hudOp);
    hud.classList.toggle('alt', fx('alt'));
    hud.classList.toggle('tear', fx('tear'));
    // Strikes jolt the whole projection a little.
    const j = on ? feel.jolt * f.feelConfig.punch : 0;
    hud.style.transform = fx('tear') ? '' : `translate(${(Math.random() - 0.5) * j * 2.2 + (feel.redline && on ? Math.sin(f.now * 70) * 1.2 : 0)}px,${(this.hudPos === 'top' ? 1 : -1) * j * 1.6}px)`;

    /* ----- left cluster: power, or pace when running ----- */
    const run = f.run;
    const pct = run ? run.effort : f.rider.power / f.ftp;
    const zone = powerZone(pct * 100, 100) - 1;
    const showPw = !hidden('power'); const showCad = !hidden('cadence'); const showHr = !hidden('heartRate');
    if (run) {
      // Belt speed is smooth already; a little more smoothing keeps the pace from flickering between seconds.
      this.dispSpeed += (run.speed - this.dispSpeed) * (1 - Math.exp(-f.dt / 0.6));
      this.T('pwn', showPw ? formatPace(this.dispSpeed, run.units) : '—');
      this.T('pwu', run.units === 'imperial' ? '/MI' : '/KM');
      this.T('cadu', 'SPM');
    } else {
      // With the feel layer on, the number shows each stroke; otherwise a lightly smoothed reading.
      this.dispPower += (f.rider.power - this.dispPower) * (1 - Math.exp(-f.dt / 0.25));
      const shownPower = on && f.rider.cadence > 20 ? feel.strokeWatts : this.dispPower;
      this.T('pwn', showPw ? String(Math.round(shownPower)) : '—');
      this.T('pwu', 'W');
      this.T('cadu', 'RPM');
    }
    this.T('zl', feel.ridePeakLabel > 0 ? 'RIDE PEAK' : `ZONE ${zone + 1} · ${POWER_ZONE_NAMES[zone].toUpperCase()}`);
    const pw = el.pwn; const load = clamp(I * f.feelConfig.load, 0, 1.2); const pu = on ? feel.pulse : 0; const split = pu * 2.2 * I;
    pw.style.setProperty('--w', String(Math.round(clamp(on ? 360 + 420 * load + 70 * pu : 520, 100, 900))));
    pw.style.setProperty('--wd', String(on ? lerp(125, 100, clamp(load)) : 125));
    pw.style.setProperty('--sc', String(1 + 0.055 * pu));
    pw.style.setProperty('--ty', `${pu * 2.5}px`);
    pw.style.textShadow = split > 0.15
      ? `0 0 1px rgba(255,255,255,.9),0 0 .12em rgba(var(--holo-rgb),.95),0 0 ${0.35 + 0.4 * I}em rgba(var(--holo-rgb),${0.6 + 0.3 * I}),${split}px 0 rgba(255,74,74,${0.55 * clamp(pu * I)}),${-split}px 0 rgba(80,210,255,${0.55 * clamp(pu * I)})`
      : '';
    pw.classList.toggle('inv', on && feel.invert > 0);
    const MAXP = 1.9;
    el.pbar.style.width = `${clamp(pct / MAXP) * 100}%`;
    const tf = this.targetEffort(state);
    el.ptgt.style.opacity = tf === undefined || hidden('target') ? '0' : '1';
    if (tf !== undefined) el.ptgt.style.left = `${clamp(tf / MAXP) * 100}%`;
    el.ppk.style.opacity = on && feel.peak30 > 0 && showPw ? String(feel.carrying ? 1 : 0.75) : '0';
    el.ppk.style.left = `${clamp(feel.peak30 / f.ftp / MAXP) * 100}%`;
    // Trend chevrons: how far this stroke is above the 10 s average.
    const ratio = feel.avg10 > 0 ? feel.strokeWatts / feel.avg10 : 1;
    const trend = !on || I < 0.1 ? 0 : ratio > 1.1 ? 3 : ratio > 1.05 ? 2 : ratio > 1.02 ? 1 : ratio < 0.95 ? -1 : 0;
    el.chev.classList.toggle('dn', trend < 0);
    for (let i = 0; i < 3; i++) (el.chev.children[i] as HTMLElement).classList.toggle('on', i < Math.abs(trend));
    this.T('hr', showHr && f.rider.heartRate > 0 ? String(Math.round(f.rider.heartRate)) : '—');
    this.T('cad', showCad ? String(Math.round(f.rider.cadence)) : '—');
    this.T('tg', this.targetText(state.workout, run?.units ?? 'metric', true) ?? (run ? 'FREE RUN' : 'FREE RIDE'));
    el.tgbox.style.opacity = hidden('target') ? '0' : '0.75';
    const hrFrac = f.maxHr > 0 ? f.rider.heartRate / f.maxHr : 0;
    el.hrbox.style.color = hrFrac > 0.93 ? '#ff7a6a' : '';

    /* ----- right cluster: speed ----- */
    const [sv, su] = speedFmt(f.speed);
    this.T('spn', sv); this.T('sl', `VELOCITY · ${su}`);
    el.R.style.opacity = hidden('speed') ? '0' : '1';
    const acc = on ? feel.accel : 0;
    el.spn.style.setProperty('--sk', `${(-acc * 9 * I * f.feelConfig.twitch).toFixed(2)}deg`);
    const a = feel.accel * 50;
    el.abar.style.left = `${a < 0 ? 50 + a : 50}%`; el.abar.style.width = `${Math.abs(a)}%`;
    const map = widget('map');
    if (f.nav !== undefined) this.T('nav', f.nav);
    else if (map) {
      const hdg = String(Math.round((212 + 20 * noise1(t * 0.02) + 360) % 360)).padStart(3, '0');
      const id = state.scene.id;
      this.T('nav', `${hdg}° · ${id === 'ice' ? `ALT ${Math.round(4 + 2 * noise1(t * 0.4))} M` : id === 'tunnel' || id === 'stills' ? 'DOCK' : 'VAC'}`);
    } else this.T('nav', '');
    this.T('stepleft', fmtClock(state.workout.timeLeftInStep + 0.99));
    this.T('clock', fmtClock(t));
    (el.prog as unknown as SVGPathElement).setAttribute('stroke-dasharray', `${t / this.rt.duration} 1`);

    /* ----- centre: one thing at a time, by priority ----- */
    let ct = ''; let cs = ''; let tone: '' | 'alert' | 'danger' = ''; let wave: 'off' | 'idle' | 'talk' = 'off'; let bar = -1; let cue = false; let blink = false;
    const sub = state.dialogue.subtitle;
    const challenge = state.challenges.find((c) => c.status === 'active');
    const spin = state.workout.cues[0];
    const call = widget('call'); const boost = widget('boost'); const modes = widget('modes');
    const sinceStep = state.workout.timeInStep;
    const stepPeak = state.workout.step.target ? Math.max(state.workout.step.target.from, state.workout.step.target.to) : 0;
    const hardStep = tf !== undefined && (tf >= 1 || (state.workout.step.target?.unit === 'ftp' && stepPeak >= 1));
    if (spin) { ct = `${(this.rt.workout.steps[spin.stepIndex].label ?? 'EFFORT').toUpperCase()}`; cs = `${run ? 'PICK IT UP' : 'SPIN UP'} · ${spin.inSeconds}`; tone = 'alert'; cue = true; }
    else if (hardStep && sinceStep < 1.5 && t > 1) { ct = (state.workout.step.label ?? '').toUpperCase(); cs = 'GO'; tone = 'danger'; cue = true; }
    else if (challenge) { ct = challenge.inRange ? 'HOLD' : 'CHALLENGE'; cs = challenge.prompt ?? ''; bar = challenge.progress; tone = challenge.inRange ? '' : 'alert'; }
    else if (boost) { ct = 'WARP BOOST'; cs = ''; bar = ss(Number(boost.params.fillFrom ?? boost.from), Number(boost.params.fillTo ?? boost.to), t); tone = 'alert'; }
    else if (sub && sub.speaker === 'AI') { ct = 'SHIP AI'; cs = sub.text; wave = 'talk'; }
    else if (hudS.banner) { ct = hudS.banner.tone === 'warning' ? 'WARNING' : 'NOTICE'; cs = hudS.banner.text; tone = hudS.banner.tone === 'warning' ? 'danger' : ''; blink = hudS.banner.blink; }
    else if (call) {
      const connectAt = Number(call.params.connectAt ?? call.from); const lostAt = Number(call.params.lostAt ?? Infinity);
      ct = `${String(call.params.name ?? 'CALL')} · ${String(call.params.detail ?? '')}`;
      cs = t < connectAt ? 'INCOMING…' : t < lostAt ? `SECURE · ${fmtClock(t - connectAt)}` : 'FEED LOST';
      if (t >= lostAt) tone = 'danger';
      wave = sub && sub.speaker === call.params.name ? 'talk' : 'idle';
    } else if (modes) { ct = String((modes.params.lines as string[] | undefined)?.[0] ?? ''); cs = String((modes.params.lines as string[] | undefined)?.slice(1).join('\n') ?? ''); }
    else if (state.workout.texts.length) { ct = 'CONTROL'; cs = state.workout.texts[state.workout.texts.length - 1].message; }
    else if (f.flash) { ct = f.flash.title; cs = f.flash.text; tone = f.flash.tone ?? ''; }
    else {
      const note = [...hudS.notices].reverse().find((n) => n.kind !== 'warning');
      if (note) { ct = note.kind === 'ai' ? 'SHIP AI' : note.kind.toUpperCase(); cs = note.text; tone = note.kind === 'surge' ? 'alert' : ''; }
    }
    const showC = !!(ct || cs);
    el.C.classList.toggle('off', !showC); el.C.classList.toggle('cue', cue); el.C.classList.toggle('blink', blink);
    if (showC) { this.T('ct', ct); this.T('cs', cs); }
    el.wave.style.display = wave === 'off' ? 'none' : 'block';
    if (wave !== 'off') {
      let w = '';
      for (let x = 0; x <= 320; x += 4) {
        const env = Math.sin((x / 320) * Math.PI);
        const amp = wave === 'talk' ? env * (6 + 14 * Math.abs(Math.sin(f.now * 7 + x * 0.05) * Math.sin(f.now * 2.3 + x * 0.013))) : env * 1.2;
        w += `${x},${(22 + Math.sin(x * 0.18 + f.now * (wave === 'talk' ? 14 : 3)) * amp).toFixed(1)} `;
      }
      el.wl.setAttribute('points', w);
    }
    el.cbar.hidden = bar < 0;
    if (bar >= 0) el.cbarf.style.width = `${clamp(bar) * 100}%`;

    // Tint: effort first, then whatever the centre is saying.
    const warn = hudS.notices.some((n) => n.kind === 'warning');
    hud.classList.toggle('alert', !fx('alt') && (tone === 'alert' || zone === 4) && tone !== 'danger' && zone < 5);
    hud.classList.toggle('danger', !fx('alt') && (tone === 'danger' || zone >= 5 || (warn && !!hudS.banner)));

    /* ----- warning notices stack ----- */
    const notes = hudS.notices.filter((n) => n.kind === 'warning').slice(-6).map((n) => n.text);
    const key = notes.join('|');
    if (key !== this.lastNotes) { this.lastNotes = key; el.notes.innerHTML = notes.map((s) => `<div>${esc(s)}</div>`).join(''); }

    /* ----- waypoint ----- */
    const way = hudS.waypoint;
    el.way.style.opacity = way ? '1' : '0';
    if (way) { this.T('wayl', way.text); el.way.style.left = `${way.x + Math.sin(t * 0.2) * 0.6}%`; el.way.style.top = `${way.y}%`; }

    /* ----- boot text ----- */
    const boot = widget('boot');
    if (boot) {
      const lines = (boot.params.lines as string[] | undefined) ?? [];
      const n = clamp(Math.floor((boot.age - 0.5) * Number(boot.params.rate ?? 1)), 0, lines.length);
      this.T('boot', lines.slice(0, n).join('\n'));
      el.boot.style.opacity = String(1 - ss(Number(boot.params.fadeFrom ?? boot.to - 1), boot.to, t));
    } else el.boot.style.opacity = '0';

    /* ----- heat gauge: the rider's real effort is what gives them away ----- */
    const heat = widget('heat');
    if (heat) {
      const masked = t >= Number(heat.params.maskedFrom ?? Infinity) && t < Number(heat.params.maskedTo ?? -Infinity);
      const h = clamp(((pct * 100 - 30) / 100) * (masked ? 0.5 : 1) + 0.08 * noise1(t * 0.7));
      el.heat.style.opacity = String(heat.age < 6 ? (Math.sin(f.now * 30) > 0 ? 1 : 0.2) : 1);
      el.heatm.style.top = `${(1 - h) * 100}%`;
      this.T('heatt', masked ? 'MASKED' : h > 0.8 ? 'EXPOSED' : 'HEAT');
      el.heat.classList.toggle('hot', h > 0.8 && !masked);
    } else el.heat.style.opacity = '0';

    /* ----- world tag ----- */
    const tag = widget('tag');
    const pos = tag ? f.anchors[String(tag.params.anchor)] : null;
    if (tag && pos) {
      const lines = (tag.params.lines as { until?: number; text: string }[] | undefined) ?? [];
      const line = lines.find((l) => l.until === undefined || t < l.until) ?? lines[lines.length - 1];
      el.tag.style.opacity = '1'; el.tag.style.left = `${pos.x}px`; el.tag.style.top = `${pos.y}px`;
      this.T('tagl', line?.text ?? '');
    } else el.tag.style.opacity = '0';

    /* ----- gate glyph flash ----- */
    if (fx('gate-flash')) {
      el.gateov.style.opacity = String(Math.sin(f.now * 47) > -0.2 ? 0.9 : 0.2);
      el.gateov.style.transform = `translate(-50%,-50%) rotate(${t * 40}deg) scale(${1 + (t % 10) * 0.02})`;
    } else el.gateov.style.opacity = '0';

    /* ----- subtitles (the AI speaks on the visor instead) ----- */
    const showSub = f.showSubtitles && sub && !(sub.speaker === 'AI' && helmet && ct === 'SHIP AI');
    const sh = showSub ? `<b>${esc(sub.speaker)}</b> ${esc(sub.text)}` : '';
    if (this.text.get('subs') !== sh) { this.text.set('subs', sh); el.subs.innerHTML = sh; }
    el.subs.style.opacity = sh ? '1' : '0';

    /* ----- workout strip ----- */
    const wk = state.workout; const step = wk.step;
    this.T('steplab', (step.label ?? step.kind).toUpperCase());
    const units = run?.units ?? 'metric';
    const tt = this.targetText(wk, units, false);
    this.T('steptgt', `${tt ?? (run ? 'FREE RUN' : 'FREE RIDE')} · ${fmtClock(wk.timeLeftInStep + 0.99)}`);
    if (run) {
      el.ergoff.hidden = run.control || step.kind === 'free';
      this.T('ergoff', 'YOU SET THE BELT');
    } else {
      el.ergoff.hidden = step.erg || step.kind === 'free';
      this.T('ergoff', 'ERG OFF · RIDE IT YOURSELF');
    }
    const nx = wk.next;
    const ntt = nx?.targetKind && nx.targetValue !== undefined ? this.valueText(nx.targetKind, nx.targetValue, units) : undefined;
    this.T('nextlab', nx ? `NEXT ${(nx.step.label ?? nx.step.kind).toUpperCase()}${ntt ? ` · ${ntt}` : ''}` : run ? 'RUN ENDS' : 'RIDE ENDS');
    el.ph.style.left = `${(t / this.rt.duration) * 100}%`;
    el.steplab.style.color = tf !== undefined ? zoneColour(tf) : '';

    this.drawFog(state, widget('fog'));
  }

  /** The current target as an FTP-equivalent effort, whatever it is expressed in. */
  private targetEffort(state: ChapterState): number | undefined {
    const w = state.workout;
    if (w.targetFraction === undefined || !w.targetKind) return undefined;
    return w.targetKind === 'power' ? w.targetFraction : w.targetKind === 'pace' ? paceToEffort(w.targetFraction) : hrToEffort(w.targetFraction);
  }

  private valueText(kind: TargetKind, value: number, units: 'metric' | 'imperial'): string {
    if (kind === 'power') return `${Math.round(value)} W`;
    if (kind === 'pace') return `${formatPace(value, units)} ${units === 'imperial' ? '/MI' : '/KM'}`;
    return `${Math.round(value)} BPM`;
  }

  /** "TGT 4:10" on the visor; "4:10 /KM · 100% THRESHOLD" on the strip. Undefined in free ride. */
  private targetText(w: ChapterState['workout'], units: 'metric' | 'imperial', short: boolean): string | undefined {
    if (!w.targetKind || w.targetFraction === undefined) return undefined;
    const value = w.targetKind === 'power' ? w.targetWatts : w.targetKind === 'pace' ? w.targetSpeed : w.targetHr;
    if (value === undefined) return undefined;
    if (short) return `TGT ${w.targetKind === 'pace' ? formatPace(value, units) : w.targetKind === 'hr' ? `${Math.round(value)} BPM` : Math.round(value)}`;
    const of = w.targetKind === 'power' ? 'FTP' : w.targetKind === 'pace' ? 'THRESHOLD' : 'MAX HR';
    return `${this.valueText(w.targetKind, value, units)} · ${Math.round(w.targetFraction * 100)}% ${of}`;
  }

  /** Canopy condensation and the Glass: the AI writing in it. */
  private drawFog(state: ChapterState, fog: ActiveWidget | undefined): void {
    const c = this.fog; const x = this.fx;
    if (!fog && state.glass.length === 0) { if (c.style.display !== 'none') c.style.display = 'none'; return; }
    c.style.display = 'block';
    const W = this.root.clientWidth; const H = this.root.clientHeight;
    if (c.width !== W >> 1 || c.height !== H >> 1) { c.width = Math.max(2, W >> 1); c.height = Math.max(2, H >> 1); }
    const w = c.width; const h = c.height;
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, w, h);
    const fogA = state.scene.curves.glassFog ?? 0;
    if (fogA > 0) {
      x.globalAlpha = fogA; x.fillStyle = x.createPattern(this.fogTile, 'repeat') as CanvasPattern; x.fillRect(0, 0, w, h); x.globalAlpha = 1;
      const th = state.scene.curves.glassThaw ?? 0;
      if (th > 0) {
        x.globalCompositeOperation = 'destination-out';
        const g = x.createRadialGradient(w * 0.82, h * 0.3, 0, w * 0.82, h * 0.3, w * (0.15 + th * 1.1));
        g.addColorStop(0, `rgba(0,0,0,${th})`); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h);
        x.globalCompositeOperation = 'source-over';
      }
      // Drips.
      const age = fog ? fog.age : 0;
      x.globalCompositeOperation = 'destination-out'; x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 2;
      for (let i = 0; i < 9; i++) {
        const dx = w * hash(i * 3.3); const len = h * (0.2 + 0.6 * hash(i + 40)) * clamp((age - 5 - i * 6) / 60);
        x.beginPath(); x.moveTo(dx, h * hash(i + 9) * 0.3); x.lineTo(dx + 3 * Math.sin(i), h * hash(i + 9) * 0.3 + len); x.stroke();
      }
      x.globalCompositeOperation = 'source-over';
    }
    for (const g of state.glass) {
      const txt = g.line.text; const a = g.line.t; const fade = g.fade;
      const fs = Math.round(h * (txt.length > 30 ? 0.062 : 0.078));
      x.font = `600 ${fs}px "Bradley Hand","Marker Felt","Segoe Print","Comic Sans MS",cursive`; x.textBaseline = 'middle'; x.textAlign = 'left';
      const lines = txt.split('\n'); const cx = w * 0.27; const cy = h * 0.3;
      let wmax = 0;
      for (const l of lines) wmax = Math.max(wmax, x.measureText(l).width);
      if (fogA < 0.5) {
        // A local patch of breath, so the writing has something to live in.
        const px = cx + wmax / 2; const py = cy + (lines.length - 1) * fs * 0.6;
        const pg = x.createRadialGradient(px, py, fs, px, py, wmax * 0.75 + fs * 2);
        pg.addColorStop(0, `rgba(232,240,250,${0.9 * fade * (1 - fogA)})`); pg.addColorStop(0.6, `rgba(232,240,250,${0.7 * fade * (1 - fogA)})`); pg.addColorStop(1, 'rgba(228,236,248,0)');
        x.fillStyle = pg; x.fillRect(0, 0, w, h);
      }
      let n = g.shownChars;
      lines.forEach((l, k) => {
        const part = l.slice(0, Math.max(0, n)); n -= l.length;
        if (!part) return;
        const yy = cy + k * fs * 1.25 + Math.sin(k + a) * 3;
        x.save(); x.translate(cx, yy); x.rotate(-0.035 + 0.01 * Math.sin(a));
        x.globalCompositeOperation = 'destination-out'; x.globalAlpha = fade; x.lineWidth = fs * 0.13; x.lineJoin = 'round'; x.strokeStyle = '#000'; x.strokeText(part, 0, 0); x.fillStyle = '#000'; x.fillText(part, 0, 0);
        x.globalCompositeOperation = 'source-over'; x.globalAlpha = 0.85 * fade; x.fillStyle = 'rgba(10,22,44,1)'; x.fillText(part, 0, 0);
        x.restore();
      });
      x.globalAlpha = 1;
    }
  }

  dispose(): void {
    removeEventListener('resize', this.drawGraph);
    clearTimeout(this.toastTimer);
    this.root.innerHTML = '';
  }
}
