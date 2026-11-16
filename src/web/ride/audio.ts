/**
 * Ride audio: dialogue clips, procedural sound design and a step sequencer
 * for the score, ported from reference/ch1-prototype/c_audio.js.
 *
 * Everything time-based comes from the chapter: dialogue cues, `sfx` cues
 * (looked up by id in the sound bank below), music sections and the
 * `ambience` curves. The engine and wind follow the rider's real effort.
 */
import type { ChapterEvent, ChapterRuntime, ChapterState, DialogueCue, MusicState } from '../../core/chapter';
import type { FeelConfig, FeelEvent, FeelState } from '../../core/feel';
import { clamp } from '../../core/util/math';

type Out = AudioNode;

const CHORDS: Record<string, number[][]> = {
  main: [[0, 3, 7, 12], [-4, 0, 3, 8], [-9, -5, 0, 3], [-2, 2, 5, 10]],
  dark: [[0, 3, 7, 10], [0, 3, 6, 10], [-4, 0, 3, 7], [-5, -1, 2, 7]],
  tense: [[0, 1, 6, 12], [0, 1, 6, 12], [0, 1, 7, 13], [0, 1, 6, 11]],
  hope: [[0, 4, 7, 11], [-3, 0, 4, 9], [-7, -3, 0, 5], [-5, -1, 2, 7]],
};
const noteFreq = (n: number, oct = 0): number => 146.83 * Math.pow(2, n / 12 + oct);

export interface AudioFrame {
  state: ChapterState;
  events: ChapterEvent[];
  seeked: boolean;
  playing: boolean;
  /** Rider power over FTP. */
  effort: number;
  /** Speed the rider sees, m/s. */
  speed: number;
  /** World shake this frame. */
  shake: number;
  feel: FeelState;
  feelConfig: FeelConfig;
}

export class RideAudio {
  readonly ctx: AudioContext;
  muted = false;
  /** Stream of the final mix, for capture in tests. */
  tap?: MediaStreamAudioDestinationNode;
  private readonly master: GainNode;
  private readonly sfx: GainNode;
  private readonly mus: GainNode;
  private readonly musF: BiquadFilterNode;
  private readonly musRev: GainNode;
  private readonly dlg: GainNode;
  private readonly conv: ConvolverNode;
  private readonly white: AudioBuffer;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loops = new Map<string, { gain: GainNode; filter: BiquadFilterNode }>();
  private live: AudioBufferSourceNode[] = [];
  private seqNext: number | null = null;
  private readonly stepLen: number;
  private readonly L: {
    engG: GainNode; engF: BiquadFilterNode; osc: OscillatorNode[]; whG: GainNode; whF: BiquadFilterNode;
    windG: GainNode; windF: BiquadFilterNode; rumG: GainNode; hissG: GainNode; ringG: GainNode; droneG: GainNode;
    shG: GainNode; shF: BiquadFilterNode; shO: OscillatorNode;
  };

  constructor(private readonly rt: ChapterRuntime, private readonly clipBase: string, opts: { tap?: boolean } = {}) {
    const ctx = this.ctx = new AudioContext();
    this.stepLen = 60 / (rt.chapter.music?.bpm ?? 90) / 4;
    const master = this.master = ctx.createGain();
    master.gain.value = 0.72;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.25;
    master.connect(comp); comp.connect(ctx.destination);
    if (opts.tap) { this.tap = ctx.createMediaStreamDestination(); comp.connect(this.tap); }
    const G = (v: number, to: Out = master) => { const g = ctx.createGain(); g.gain.value = v; g.connect(to); return g; };

    // Reverb: a generated impulse response.
    const ir = ctx.createBuffer(2, Math.floor(ctx.sampleRate * 3.4), ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.6);
    }
    const conv = this.conv = ctx.createConvolver();
    conv.buffer = ir; conv.connect(G(0.55));
    this.dlg = G(1.25); this.sfx = G(0.9); this.mus = G(0.8);
    this.musF = ctx.createBiquadFilter(); this.musF.type = 'lowpass'; this.musF.frequency.value = 18000; this.musF.connect(this.mus);
    this.musRev = G(0.35, conv); this.musF.connect(this.musRev);

    const mk = (len: number, fn: (d: Float32Array) => void) => {
      const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
      fn(b.getChannelData(0));
      return b;
    };
    this.white = mk(2, (d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; });
    const brown = mk(4, (d) => { let l = 0; for (let i = 0; i < d.length; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.5; } });
    const loop = (buf: AudioBuffer, to: Out) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.connect(to); s.start(); return s; };
    const filt = (type: BiquadFilterType, f: number, q: number, to: Out) => {
      const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.connect(to); return b;
    };

    // Continuous layers.
    const engG = G(0, this.sfx); const engF = filt('lowpass', 300, 1.2, engG);
    const osc = [0, 1, 2].map((i) => {
      const o = ctx.createOscillator(); o.type = i === 2 ? 'square' : 'sawtooth'; o.connect(G(i === 2 ? 0.35 : 0.5, engF)); o.start(); return o;
    });
    const whG = G(0, this.sfx); const whF = filt('bandpass', 2000, 9, whG); loop(this.white, whF);
    const windG = G(0, this.sfx); const windF = filt('bandpass', 500, 0.6, windG); loop(this.white, windF);
    const rumG = G(0, this.sfx); loop(brown, filt('lowpass', 110, 0.7, rumG));
    const hissG = G(0, this.sfx); loop(this.white, filt('highpass', 3500, 0.7, hissG));
    const ringG = G(0, this.sfx);
    [2950, 2957, 5900].forEach((f, i) => { const o = ctx.createOscillator(); o.frequency.value = f; o.connect(G(i === 2 ? 0.15 : 0.5, ringG)); o.start(); });
    const droneG = G(0, this.sfx);
    [48, 72.3].forEach((f) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(droneG); o.start(); });
    droneG.connect(conv);
    const shG = G(0, this.sfx); const shF = filt('bandpass', 400, 6, shG);
    const shO = ctx.createOscillator(); shO.type = 'sawtooth'; shO.connect(shF); shO.start(); shG.connect(conv);
    this.L = { engG, engF, osc, whG, whF, windG, windF, rumG, hissG, ringG, droneG, shG, shF, shO };
  }

  /** Fetch and decode every clip the chapter uses. Missing clips are skipped with a warning, not fatal. */
  async load(progress?: (fraction: number) => void): Promise<void> {
    const ch = this.rt.chapter;
    const names = new Set<string>();
    for (const c of ch.dialogue ?? []) names.add(c.clip);
    for (const c of ch.challenges ?? []) for (const b of [c.onSuccess, c.onFail]) for (const d of b?.dialogue ?? []) names.add(d.clip);
    for (const l of Object.values(ch.music?.loops ?? {})) names.add(l.clip);
    let done = 0;
    await Promise.all([...names].map(async (name) => {
      try {
        const res = await fetch(`${this.clipBase}/${name}.mp3`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
        this.buffers.set(name, buf);
        this.rt.setClipDuration(name, buf.duration);
      } catch (e) {
        console.warn(`Clip "${name}" could not be loaded:`, e);
      }
      progress?.(++done / names.size);
    }));
    // Looping beds declared by the chapter.
    for (const [name, spec] of Object.entries(ch.music?.loops ?? {})) {
      let buf = this.buffers.get(spec.clip);
      if (!buf) continue;
      if (spec.reverse) {
        const r = this.ctx.createBuffer(1, buf.length, buf.sampleRate);
        const a = buf.getChannelData(0); const b = r.getChannelData(0);
        for (let i = 0; i < a.length; i++) b[i] = a[a.length - 1 - i];
        buf = r;
      }
      const gain = this.ctx.createGain(); gain.gain.value = 0; gain.connect(spec.reverb ? this.conv : this.master);
      const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = spec.lowpass ?? 18000; filter.connect(gain);
      const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = spec.rate ?? 1; s.connect(filter); s.start();
      this.loops.set(name, { gain, filter });
    }
  }

  /* ---------- one-shot building blocks ---------- */

  private env(g: GainNode, when: number, a: number, peak: number, d: number): void {
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + a);
    g.gain.exponentialRampToValueAtTime(0.0001, when + a + d);
  }

  private noiseHit(when: number, type: BiquadFilterType, f0: number, f1: number, dur: number, peak: number, to: Out = this.sfx, q = 0.8): GainNode {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.white; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, when); f.frequency.exponentialRampToValueAtTime(f1, when + dur);
    const g = ctx.createGain(); this.env(g, when, 0.01, peak, dur);
    s.connect(f); f.connect(g); g.connect(to); s.start(when, Math.random()); s.stop(when + dur + 0.1);
    return g;
  }

  private tone(when: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, to: Out = this.sfx, a = 0.005): GainNode {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, when);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, when + dur);
    const g = ctx.createGain(); this.env(g, when, a, peak, dur);
    o.connect(g); g.connect(to); o.start(when); o.stop(when + dur + 0.1);
    return g;
  }

  /** The sound bank: ids a chapter's `sfx` track can use. */
  play(id: string, args: number[] = []): void {
    const w = this.ctx.currentTime;
    const { conv, sfx } = this;
    const a0 = args[0];
    switch (id) {
      case 'boom': {
        const size = a0 ?? 1;
        this.noiseHit(w, 'lowpass', 900 * size + 200, 50, 2.2 + size * 2, 0.9 * Math.min(1.4, size));
        this.tone(w, 'sine', 90, 26, 1.6 + size, Math.min(1.3, size));
        this.noiseHit(w + 0.05, 'bandpass', 2500, 400, 1.2, 0.25 * size, conv);
        this.noiseHit(w + 0.3, 'lowpass', 300, 40, 5 + size * 3, 0.5 * size, conv);
        break;
      }
      case 'chime': {
        const f = a0 ?? 880;
        this.tone(w, 'sine', f, f, 0.5, 0.18); this.tone(w + 0.12, 'sine', f * 1.5, f * 1.5, 0.7, 0.14); this.tone(w + 0.12, 'sine', f * 1.5, f * 1.5, 0.9, 0.1, conv);
        break;
      }
      case 'ping': {
        const f = a0 ?? 1200;
        this.tone(w, 'square', f, f, 0.07, 0.05); this.tone(w + 0.08, 'square', f * 1.26, f * 1.26, 0.09, 0.05);
        break;
      }
      case 'callTone':
        for (let i = 0; i < 3; i++) { this.tone(w + i * 1.1, 'sine', 660, 660, 0.28, 0.12); this.tone(w + i * 1.1 + 0.3, 'sine', 830, 830, 0.32, 0.12); }
        break;
      case 'hissSeal':
        this.noiseHit(w, 'highpass', 6000, 1200, 1.3, 0.3); this.tone(w + 1.1, 'sine', 70, 40, 0.3, 0.5);
        break;
      case 'whoosh': {
        const k = a0 ?? 1;
        this.noiseHit(w, 'bandpass', 300, 1800 + 1500 * k, 0.22, 0.22 + 0.25 * k, sfx, 1.5);
        this.noiseHit(w + 0.2, 'bandpass', 2400, 250, 0.35, 0.18 + 0.2 * k, sfx, 1.5);
        break;
      }
      case 'crack': {
        const k = a0 ?? 1;
        this.noiseHit(w, 'highpass', 2500, 700, 0.12, 0.5 * k); this.noiseHit(w + 0.04, 'bandpass', 900, 200, 0.4, 0.4 * k, conv); this.tone(w, 'sine', 160, 50, 0.25, 0.4 * k);
        break;
      }
      case 'creak': {
        const f = 90 + Math.random() * 120;
        this.tone(w, 'sawtooth', f, f * (0.7 + Math.random() * 0.5), 0.5 + Math.random() * 0.6, 0.05, conv, 0.15);
        break;
      }
      case 'tick':
        this.noiseHit(w, 'bandpass', 3800, 3000, 0.03, 0.12, sfx, 6);
        break;
      case 'step':
        this.tone(w, 'sine', 95, 55, 0.09, 0.22); this.noiseHit(w, 'lowpass', 900, 300, 0.06, 0.1);
        break;
      case 'alarm':
        this.tone(w, 'square', 740, 740, 0.16, 0.07); this.tone(w + 0.22, 'square', 740, 740, 0.16, 0.07);
        break;
      case 'riser': {
        const dur = a0 ?? 5;
        this.noiseHit(w, 'bandpass', 300, 6000, dur, 0.02, sfx, 2).gain.exponentialRampToValueAtTime(0.35, w + dur * 0.98);
        break;
      }
      case 'boot':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(w + i * 0.09, 'triangle', f, f, 0.25, 0.09));
        break;
      case 'glitch':
        for (let i = 0; i < 8; i++) this.noiseHit(w + i * 0.07 * Math.random() * 3, 'bandpass', 500 + Math.random() * 5000, 800, 0.05, 0.3, sfx, 4);
        break;
      case 'swell': {
        const dur = a0 ?? 6; const root = args[1] ?? 110; const ctx = this.ctx;
        [1, 1.5, 2, 3].forEach((m, i) => {
          const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = root * m * (1 + (i - 1.5) * 0.003);
          const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(200, w); f.frequency.exponentialRampToValueAtTime(2600, w + dur * 0.8);
          const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, w); g.gain.exponentialRampToValueAtTime(0.09, w + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, w + dur + 2.5);
          o.connect(f); f.connect(g); g.connect(this.mus); g.connect(conv); o.start(w); o.stop(w + dur + 3);
        });
        break;
      }
      default:
        console.warn(`Unknown sound id "${id}"`);
    }
  }

  /* ---------- score ---------- */

  private playStep(i: number, m: MusicState, when: number): void {
    if (m.level <= 0.001) return;
    const ctx = this.ctx; const out = this.musF; const STEP = this.stepLen;
    const bar = Math.floor(i / 16); const stp = ((i % 16) + 16) % 16;
    const ch = (CHORDS[m.mode] ?? CHORDS.main)[bar % 4];
    const kickPat = m.party ? [0, 6, 10] : m.fast ? [0, 4, 8, 12, 14] : [0, 4, 8, 12];
    if (m.kick > 0 && kickPat.includes(stp)) {
      this.tone(when, 'sine', 150, 42, 0.22, 0.7 * m.kick * m.level, out); this.noiseHit(when, 'lowpass', 2000, 200, 0.03, 0.25 * m.kick * m.level, out);
    }
    if (m.party && (stp === 4 || stp === 12)) this.noiseHit(when, 'bandpass', 1800, 900, 0.14, 0.35 * m.level, out, 1);
    if (m.hat > 0 && (stp % 2 === 1 || (m.fast && stp % 2 === 0))) this.noiseHit(when, 'highpass', 8000, 7000, 0.035, 0.1 * m.hat * m.level * (stp % 4 === 2 ? 1.5 : 1), out);
    if (m.bass > 0 && stp % 2 === 0) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = noteFreq(ch[0], -2 + (stp === 6 || stp === 14 ? 1 : 0));
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(140 + 900 * m.bright, when); f.frequency.exponentialRampToValueAtTime(90, when + 0.22);
      const g = ctx.createGain(); this.env(g, when, 0.005, 0.5 * m.bass * m.level, 0.24);
      o.connect(f); f.connect(g); g.connect(out); o.start(when); o.stop(when + 0.35);
    }
    if (m.arp > 0) {
      const seq = [0, 1, 2, 3, 2, 1, 3, 2]; const n = ch[seq[(stp + bar) % 8]];
      this.tone(when, 'triangle', noteFreq(n, 1), noteFreq(n, 1), 0.16, 0.13 * m.arp * m.level, out);
      this.tone(when + STEP * 3, 'triangle', noteFreq(n, 1), noteFreq(n, 1), 0.16, 0.04 * m.arp * m.level, this.musRev);
      if (m.fast) this.tone(when, 'square', noteFreq(n, 2), noteFreq(n, 2), 0.06, 0.03 * m.arp * m.level, out);
    }
    if (m.pad > 0 && stp === 0) {
      const dur = STEP * 16;
      ch.forEach((n, k) => {
        for (const det of [-6, 7]) {
          const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = noteFreq(n, k === 0 ? -1 : 0); o.detune.value = det;
          const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 350 + 1700 * m.bright;
          const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, when); g.gain.linearRampToValueAtTime(0.035 * m.pad * m.level, when + dur * 0.35); g.gain.linearRampToValueAtTime(0.0001, when + dur * 1.25);
          o.connect(f); f.connect(g); g.connect(out); o.start(when); o.stop(when + dur * 1.3);
        }
      });
    }
  }

  /* ---------- dialogue ---------- */

  private playClip(cue: DialogueCue, offset: number): void {
    const buf = this.buffers.get(cue.clip);
    if (!buf || offset >= buf.duration - 0.05) return;
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = cue.rate ?? 1;
    const g = ctx.createGain(); g.gain.value = cue.gain ?? 1;
    let head: AudioNode = s;
    if (cue.radio) {
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 420;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
      s.connect(hp); hp.connect(lp); head = lp;
    }
    head.connect(g); g.connect(this.dlg);
    if (cue.reverb) { const send = ctx.createGain(); send.gain.value = 0.45; g.connect(send); send.connect(this.conv); }
    s.start(ctx.currentTime, Math.max(0, offset));
    this.live.push(s);
    s.onended = () => { const i = this.live.indexOf(s); if (i >= 0) this.live.splice(i, 1); };
  }

  stopClips(): void {
    for (const s of this.live) { try { s.stop(); } catch { /* already stopped */ } }
    this.live = [];
    this.seqNext = null;
  }

  /** Resume any dialogue that should be mid-flight (after a seek or un-pause). */
  resumeClips(state: ChapterState): void {
    for (const a of state.dialogue.active) if (a.remaining > 0.15) this.playClip(a.cue, a.offset);
  }

  async setPlaying(playing: boolean, state?: ChapterState): Promise<void> {
    if (playing) { await this.ctx.resume(); if (state) this.resumeClips(state); } else { this.stopClips(); await this.ctx.suspend(); }
  }

  /* ---------- per-frame ---------- */

  update(f: AudioFrame): void {
    const ctx = this.ctx; const now = ctx.currentTime; const L = this.L;
    const set = (p: AudioParam, v: number, tc = 0.08) => p.setTargetAtTime(v, now, tc);
    const t = f.state.t; const A = f.state.music.ambience;
    const amb = (k: string, d = 0) => A[k] ?? d;

    if (f.seeked) { this.stopClips(); if (f.playing) this.resumeClips(f.state); }
    if (f.playing) {
      for (const e of f.events) {
        if (e.type === 'dialogue') this.playClip(e.cue, 0);
        else if (e.type === 'sfx') this.play(e.cue.id, e.cue.args);
        else if (e.type === 'notice' && e.kind === 'warning') this.play('ping', [880 + 40 * f.state.hud.notices.length]);
        else if (e.type === 'challenge' && e.outcome !== 'started') this.play('chime', [e.outcome === 'succeeded' ? 990 : 330]);
      }
      // Sequencer: schedule a little ahead of the clock so timing is tight.
      const STEP = this.stepLen;
      if (this.seqNext === null) this.seqNext = Math.ceil(t / STEP);
      while (this.seqNext * STEP < t + 0.18) {
        const st = this.seqNext * STEP;
        this.playStep(this.seqNext, this.rt.musicAt(st), now + Math.max(0, st - t));
        this.seqNext++;
      }
    }

    // Engine and wind follow the rider, not the script.
    const engOn = amb('engine');
    const thr = clamp((f.effort * 100 - 35) / 90) * engOn;
    const feelEng = f.feelConfig.enabled ? 0.7 + 0.5 * f.feelConfig.engine : 1;
    const f0 = 34 + 70 * thr + amb('enginePitchSpeed') * clamp(f.speed / 6000) + 10 * f.feel.accel * Math.min(1, f.feel.intensity);
    L.osc[0].frequency.setTargetAtTime(f0, now, 0.15); L.osc[1].frequency.setTargetAtTime(f0 * 1.503, now, 0.15); L.osc[2].frequency.setTargetAtTime(f0 * 0.5, now, 0.15);
    set(L.engF.frequency, 160 + 1500 * thr * thr);
    set(L.engG.gain, engOn * (0.05 + 0.2 * thr) * amb('engineTrim', 1) * feelEng);
    set(L.whF.frequency, 700 + 5200 * thr); set(L.whG.gain, engOn * (0.02 + 0.16 * thr * thr));
    const windK = amb('windBase') + amb('windSpeed') * clamp(f.speed / amb('windSpeedRef', 450)) + amb('windEffort') * clamp((f.effort * 100 - 90) / 30);
    set(L.windG.gain, windK * 0.5); set(L.windF.frequency, 250 + 1600 * clamp(f.speed / amb('windFreqRef', 500)));
    set(L.rumG.gain, clamp(f.shake * 0.5 + amb('rumble'), 0, 0.9));
    set(L.hissG.gain, amb('hiss'), 0.5);
    set(L.ringG.gain, amb('ring'), 0.3); set(L.droneG.gain, amb('drone'), 0.4);
    set(L.shG.gain, amb('shepard')); L.shO.frequency.setTargetAtTime(Math.max(20, amb('shepardFreq', 70)), now, 0.1); set(L.shF.frequency, Math.max(50, amb('shepardCutoff', 200)));
    for (const [name, l] of this.loops) {
      set(l.gain.gain, amb(name), name === 'murmur' ? 0.4 : 0.15);
      if (A[`${name}Cutoff`] !== undefined) set(l.filter.frequency, Math.max(50, A[`${name}Cutoff`]), 0.2);
    }
    set(this.musF.frequency, Math.max(50, amb('musicCutoff', 16000)), 0.2);
    const duck = f.state.dialogue.subtitle ? 0.5 : 1;
    set(this.mus.gain, 0.8 * duck * amb('musicTrim', 1), 0.12);
    set(this.sfx.gain, 0.9 * (duck < 1 ? 0.65 : 1), 0.12);
    set(this.master.gain, this.muted ? 0 : 0.72, 0.05);
  }

  /** Feel-layer sounds: the stroke tick and the peak-break clack. */
  feel(events: FeelEvent[], state: FeelState, c: FeelConfig): void {
    if (!c.enabled) return;
    const w = this.ctx.currentTime;
    for (const e of events) {
      if (e.type === 'stroke') {
        const I = Math.min(1, state.intensity);
        const peak = 0.22 * c.tick * (0.15 + I) * (I > 0.05 ? 1 : 0);
        if (peak > 0.001) this.click(peak, 1400 + 2600 * I + 700 * clamp((e.ratio - 1) * 6), 6, 0.022);
        if (I > 0.35) this.tone(w, 'sine', 110 + 50 * clamp((e.ratio - 1) * 6), 60, 0.07, 0.2 * c.tick * I, this.master);
      } else if (e.type === 'peakBreak') {
        this.click(0.5 * c.clack, 2600, 2, 0.05);
        this.tone(w, 'sine', 1180, 1180, 0.09, 0.16 * c.clack, this.master); this.tone(w, 'sine', 1830, 1830, 0.07, 0.1 * c.clack, this.master);
        this.tone(w, 'sine', 120, 42, 0.28, 0.5 * c.clack, this.master);
        if (e.ridePeak) { this.tone(w + 0.02, 'sine', 70, 34, 0.6, 0.5 * c.clack, this.master); this.click(0.3 * c.clack, 5200, 1.5, 0.14); }
      } else if (e.type === 'holdLost') {
        this.tone(w, 'sine', 220, 110, 0.16, 0.06 * c.tick, this.master);
      }
    }
  }

  private click(peak: number, freq: number, q: number, dur: number): void {
    const ctx = this.ctx; const w = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.white;
    const fl = ctx.createBiquadFilter(); fl.type = 'bandpass'; fl.Q.value = q; fl.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(peak, w); g.gain.exponentialRampToValueAtTime(0.0001, w + dur);
    s.connect(fl); fl.connect(g); g.connect(this.master); s.start(w, Math.random() * 0.5); s.stop(w + dur + 0.02);
  }
}
