/* ===== audio: dialogue clips, procedural sound design, cadence-locked score ===== */
const AU = { ready: false }; window.AU = AU;
const BPM = 90, STEP = 60 / BPM / 4;
async function audioInit(progress) {
  const ctx = AU.ctx = new (window.AudioContext || window.webkitAudioContext)();
  const master = AU.master = ctx.createGain(); master.gain.value = .72; const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 5; comp.attack.value = .004; comp.release.value = .25; master.connect(comp); comp.connect(ctx.destination);
  if (window.__tap) { AU.tap = ctx.createMediaStreamDestination(); comp.connect(AU.tap); }
  const G = (v, to) => { const g = ctx.createGain(); g.gain.value = v; g.connect(to || master); return g; };
  // reverb
  const ir = ctx.createBuffer(2, ctx.sampleRate * 3.4, ctx.sampleRate); for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.6); }
  const conv = ctx.createConvolver(); conv.buffer = ir; conv.connect(G(.55)); AU.rev = conv;
  AU.dlg = G(1.25); AU.sfx = G(.9); AU.mus = G(.8); AU.musF = ctx.createBiquadFilter(); AU.musF.type = 'lowpass'; AU.musF.frequency.value = 18000; AU.musF.connect(AU.mus); AU.musRev = G(.35, conv); AU.musF.connect(AU.musRev);
  AU.dlgRev = G(0, conv);
  // noise buffers
  const mk = (len, fn) => { const b = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate), d = b.getChannelData(0); fn(d); return b; };
  AU.white = mk(2, d => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; });
  AU.brown = mk(4, d => { let l = 0; for (let i = 0; i < d.length; i++) { l = (l + .02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.5; } });
  const loop = (buf, to) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.connect(to); s.start(); return s; };
  const filt = (type, f, q, to) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q || .7; b.connect(to); return b; };
  // continuous layers
  const L = AU.L = {};
  L.engG = G(0, AU.sfx); L.engF = filt('lowpass', 300, 1.2, L.engG); L.osc = [0, 0, 0].map((_, i) => { const o = ctx.createOscillator(); o.type = i === 2 ? 'square' : 'sawtooth'; const g = G(i === 2 ? .35 : .5, L.engF); o.connect(g); o.start(); return o; });
  L.whG = G(0, AU.sfx); L.whF = filt('bandpass', 2000, 9, L.whG); loop(AU.white, L.whF);
  L.windG = G(0, AU.sfx); L.windF = filt('bandpass', 500, .6, L.windG); loop(AU.white, L.windF);
  L.rumG = G(0, AU.sfx); loop(AU.brown, filt('lowpass', 110, .7, L.rumG));
  L.hissG = G(0, AU.sfx); loop(AU.white, filt('highpass', 3500, .7, L.hissG));
  L.ringG = G(0, AU.sfx); [2950, 2957, 5900].forEach((f, i) => { const o = ctx.createOscillator(); o.frequency.value = f; o.connect(G(i === 2 ? .15 : .5, L.ringG)); o.start(); });
  L.droneG = G(0, AU.sfx); [48, 72.3].forEach(f => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(L.droneG); o.start(); }); L.droneG.connect(conv);
  L.shG = G(0, AU.sfx); L.shF = filt('bandpass', 400, 6, L.shG); L.shO = ctx.createOscillator(); L.shO.type = 'sawtooth'; L.shO.connect(L.shF); L.shO.start(); L.shG.connect(conv);
  L.hangG = G(0, master); L.hangF = filt('lowpass', 18000, .7, L.hangG);
  L.mumG = G(0, conv); L.mumF = filt('lowpass', 600, 1, L.mumG);
  // decode clips
  const names = Object.keys(CLIPS); AU.buf = {}; let n = 0;
  for (const k of names) { const bin = atob(CLIPS[k]), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    AU.buf[k] = await new Promise((res, rej) => ctx.decodeAudioData(u8.buffer, res, rej)); progress && progress(++n / names.length); }
  loop(AU.buf.hangar, L.hangF);
  // reversed call for blackout murmurs
  { const src = AU.buf.call, r = ctx.createBuffer(1, src.length, src.sampleRate), a = src.getChannelData(0), b = r.getChannelData(0); for (let i = 0; i < a.length; i++) b[i] = a[a.length - 1 - i]; const s = loop(r, L.mumF); s.playbackRate.value = .62; }
  AU.live = []; AU.seqNext = null; AU.ready = true;

  const env = (g, when, a, peak, d) => { g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(Math.max(.0002, peak), when + a); g.gain.exponentialRampToValueAtTime(.0001, when + a + d); };
  const noiseHit = (when, type, f0, f1, dur, peak, to, q) => { const s = ctx.createBufferSource(); s.buffer = AU.white; s.loop = true; const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q || .8; f.frequency.setValueAtTime(f0, when); f.frequency.exponentialRampToValueAtTime(f1, when + dur); const g = ctx.createGain(); env(g, when, .01, peak, dur); s.connect(f); f.connect(g); g.connect(to || AU.sfx); s.start(when, Math.random()); s.stop(when + dur + .1); return g; };
  const tone = (when, type, f0, f1, dur, peak, to, a) => { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, when); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, when + dur); const g = ctx.createGain(); env(g, when, a || .005, peak, dur); o.connect(g); g.connect(to || AU.sfx); o.start(when); o.stop(when + dur + .1); return g; };
  AU.boom = (size = 1, delay = 0) => { const w = ctx.currentTime + delay; noiseHit(w, 'lowpass', 900 * size + 200, 50, 2.2 + size * 2, .9 * Math.min(1.4, size), AU.sfx); tone(w, 'sine', 90, 26, 1.6 + size, 1.0 * Math.min(1.3, size)); noiseHit(w + .05, 'bandpass', 2500, 400, 1.2, .25 * size, conv); noiseHit(w + .3, 'lowpass', 300, 40, 5 + size * 3, .5 * size, conv); };
  AU.chime = (f = 880) => { const w = ctx.currentTime; tone(w, 'sine', f, f, .5, .18); tone(w + .12, 'sine', f * 1.5, f * 1.5, .7, .14); tone(w + .12, 'sine', f * 1.5, f * 1.5, .9, .1, conv); };
  AU.ping = (f = 1200) => { const w = ctx.currentTime; tone(w, 'square', f, f, .07, .05); tone(w + .08, 'square', f * 1.26, f * 1.26, .09, .05); };
  AU.callTone = () => { const w = ctx.currentTime; for (let i = 0; i < 3; i++) { tone(w + i * 1.1, 'sine', 660, 660, .28, .12); tone(w + i * 1.1 + .3, 'sine', 830, 830, .32, .12); } };
  AU.hissSeal = () => { const w = ctx.currentTime; noiseHit(w, 'highpass', 6000, 1200, 1.3, .3); tone(w + 1.1, 'sine', 70, 40, .3, .5); };
  AU.whoosh = (k = 1) => { const w = ctx.currentTime; const g = noiseHit(w, 'bandpass', 300, 1800 + 1500 * k, .22, .22 + .25 * k, AU.sfx, 1.5); noiseHit(w + .2, 'bandpass', 2400, 250, .35, .18 + .2 * k, AU.sfx, 1.5); };
  AU.crack = (k = 1) => { const w = ctx.currentTime; noiseHit(w, 'highpass', 2500, 700, .12, .5 * k); noiseHit(w + .04, 'bandpass', 900, 200, .4, .4 * k, conv); tone(w, 'sine', 160, 50, .25, .4 * k); };
  AU.creak = () => { const w = ctx.currentTime, f = 90 + Math.random() * 120; tone(w, 'sawtooth', f, f * (.7 + Math.random() * .5), .5 + Math.random() * .6, .05, conv, .15); };
  AU.tick = () => { const w = ctx.currentTime; noiseHit(w, 'bandpass', 3800, 3000, .03, .12, AU.sfx, 6); };
  AU.step = () => { const w = ctx.currentTime; tone(w, 'sine', 95, 55, .09, .22); noiseHit(w, 'lowpass', 900, 300, .06, .1); };
  AU.alarm = () => { const w = ctx.currentTime; tone(w, 'square', 740, 740, .16, .07); tone(w + .22, 'square', 740, 740, .16, .07); };
  AU.riser = (dur = 5) => { const w = ctx.currentTime; noiseHit(w, 'bandpass', 300, 6000, dur, .02, AU.sfx, 2).gain.exponentialRampToValueAtTime(.35, w + dur * .98); };
  AU.boot = () => { const w = ctx.currentTime;[523, 659, 784, 1047].forEach((f, i) => tone(w + i * .09, 'triangle', f, f, .25, .09)); };
  AU.glitch = () => { const w = ctx.currentTime; for (let i = 0; i < 8; i++) noiseHit(w + i * .07 * Math.random() * 3, 'bandpass', 500 + Math.random() * 5000, 800, .05, .3, AU.sfx, 4); };
  AU.swell = (dur = 6, root = 110) => { const w = ctx.currentTime;[1, 1.5, 2, 3].forEach((m, i) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = root * m * (1 + (i - 1.5) * .003); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(200, w); f.frequency.exponentialRampToValueAtTime(2600, w + dur * .8); const g = ctx.createGain(); g.gain.setValueAtTime(.0001, w); g.gain.exponentialRampToValueAtTime(.09, w + dur * .8); g.gain.exponentialRampToValueAtTime(.0001, w + dur + 2.5); o.connect(f); f.connect(g); g.connect(AU.mus); g.connect(conv); o.start(w); o.stop(w + dur + 3); }); };

  /* ----- score ----- */
  const CH = { main: [[0, 3, 7, 12], [-4, 0, 3, 8], [-9, -5, 0, 3], [-2, 2, 5, 10]], dark: [[0, 3, 7, 10], [0, 3, 6, 10], [-4, 0, 3, 7], [-5, -1, 2, 7]], tense: [[0, 1, 6, 12], [0, 1, 6, 12], [0, 1, 7, 13], [0, 1, 6, 11]], hope: [[0, 4, 7, 11], [-3, 0, 4, 9], [-7, -3, 0, 5], [-5, -1, 2, 7]] };
  const nf = (n, oct = 0) => 146.83 * Math.pow(2, n / 12 + oct);
  AU.playStep = (i, st, when) => {
    const m = musicAt(st); if (m.level <= 0.001) return; const bar = Math.floor(i / 16), stp = ((i % 16) + 16) % 16, ch = CH[m.mode][bar % 4], out = AU.musF;
    const hit = (p, v) => p.includes(stp) && v > 0;
    if (m.kick > 0 && hit(m.party ? [0, 6, 10] : m.fast ? [0, 4, 8, 12, 14] : [0, 4, 8, 12], 1)) { tone(when, 'sine', 150, 42, .22, .7 * m.kick * m.level, out); noiseHit(when, 'lowpass', 2000, 200, .03, .25 * m.kick * m.level, out); }
    if (m.party && (stp === 4 || stp === 12)) noiseHit(when, 'bandpass', 1800, 900, .14, .35 * m.level, out, 1);
    if (m.hat > 0 && (stp % 2 === 1 || (m.fast && stp % 2 === 0)) ) noiseHit(when, 'highpass', 8000, 7000, .035, .1 * m.hat * m.level * (stp % 4 === 2 ? 1.5 : 1), out);
    if (m.bass > 0 && (stp % 2 === 0)) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = nf(ch[0], -2 + ((stp === 6 || stp === 14) ? 1 : 0)); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(140 + 900 * m.bright, when); f.frequency.exponentialRampToValueAtTime(90, when + .22); const g = ctx.createGain(); env(g, when, .005, .5 * m.bass * m.level, .24); o.connect(f); f.connect(g); g.connect(out); o.start(when); o.stop(when + .35); }
    if (m.arp > 0) { const seq = [0, 1, 2, 3, 2, 1, 3, 2], n = ch[seq[(stp + bar) % 8]]; const g = tone(when, 'triangle', nf(n, 1), nf(n, 1), .16, .13 * m.arp * m.level, out); tone(when + STEP * 3, 'triangle', nf(n, 1), nf(n, 1), .16, .04 * m.arp * m.level, AU.musRev); if (m.fast) tone(when, 'square', nf(n, 2), nf(n, 2), .06, .03 * m.arp * m.level, out); }
    if (m.pad > 0 && stp === 0) { const dur = STEP * 16; ch.forEach((n, k) => { for (const det of [-6, 7]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = nf(n, k === 0 ? -1 : 0); o.detune.value = det; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 350 + 1700 * m.bright; const g = ctx.createGain(); g.gain.setValueAtTime(.0001, when); g.gain.linearRampToValueAtTime(.035 * m.pad * m.level, when + dur * .35); g.gain.linearRampToValueAtTime(.0001, when + dur * 1.25); o.connect(f); f.connect(g); g.connect(out); o.start(when); o.stop(when + dur * 1.3); } }); }
  };
}
/* music direction by time */
function musicAt(t) {
  const m = { level: 0, kick: 0, hat: 0, bass: 0, arp: 0, pad: 0, bright: .4, mode: 'main', party: false, fast: false };
  if (t >= 100 && t < 430) { m.level = kf(t, [[100, 0], [102, 1], [296, 1], [304, .55], [420, .3], [430, 0]]); m.party = true; m.kick = 1; m.hat = 1; m.bass = 1; m.arp = .8; m.pad = .3; m.bright = .7; m.mode = 'main'; }
  else if (t >= 478 && t < 630) { m.level = kf(t, [[478, 0], [486, .7], [566, .8], [572, 1], [622, 1], [630, 0]]); m.pad = 1; m.arp = t > 500 ? .8 : .3; m.bass = t > 520 ? .6 : 0; m.kick = t > 540 && t < 570 ? .5 : 0; m.bright = kf(t, [[478, .2], [570, .8], [630, .5]]); m.mode = t >= 568 ? 'hope' : 'main'; }
  else if (t >= 630 && t < 660) { m.level = .8; m.pad = 1; m.mode = 'tense'; m.bright = .25; m.bass = .5; }
  else if (t >= 660 && t < 771) { m.level = 1; m.kick = 1; m.hat = 1; m.bass = 1; m.arp = 1; m.pad = .6; m.fast = true; m.mode = 'dark'; m.bright = kf(t, [[660, .5], [770, 1]]); }
  else if (t >= 1168 && t < 1290) { m.level = kf(t, [[1168, 0], [1180, .5], [1290, .55]]); m.pad = 1; m.arp = .25; m.mode = 'dark'; m.bright = .3; }
  else if (t >= 1290 && t < 1440) { m.level = .75; m.pad = .8; m.bass = 1; m.kick = (t < 1320 || t >= 1410) ? 1 : .4; m.hat = (t < 1320 || t >= 1410) ? 1 : 0; m.arp = (t < 1320 || t >= 1410) ? .9 : .2; m.fast = t >= 1410; m.mode = 'dark'; m.bright = (t >= 1320 && t < 1410) ? .15 : .7; }
  else if (t >= 1440 && t < 1534.3) { m.level = kf(t, [[1440, .5], [1525, .95], [1534, 1]]); m.pad = 1; m.bass = 1; m.arp = 1; m.kick = t > 1470 ? 1 : 0; m.hat = t > 1500 ? 1 : 0; m.fast = t >= 1530; m.mode = 'main'; m.bright = kf(t, [[1440, .3], [1534, .9]]); }
  else if (t >= 1620 && t < 1891) { m.level = kf(t, [[1620, 0], [1632, .6], [1860, 1], [1888, 1], [1891, 0]]); m.kick = 1; m.bass = 1; m.pad = .8; m.arp = t > 1680 ? 1 : .4; m.hat = t > 1740 ? 1 : 0; m.fast = t >= 1860; m.mode = t >= 1770 ? 'hope' : 'main'; m.bright = kf(t, [[1620, .3], [1860, .8], [1865, 1]]); }
  else if (t >= 1946 && t < 2094) { m.level = kf(t, [[1946, 0], [1960, .55], [1974, .2], [2008, .2], [2030, .45], [2058, .8], [2076, 1], [2086, .7], [2094, 0]]); m.pad = 1; m.arp = (t > 2056 && t < 2086) ? .6 : .12; m.bass = t > 2056 && t < 2084 ? .5 : 0; m.mode = t > 2056 ? 'tense' : 'dark'; m.bright = kf(t, [[1946, .3], [2056, .4], [2076, .9], [2094, .2]]); }
  return m;
}
/* one-shot sound events (fire when crossed in normal play) */
const SFX = [];
(function () {
  const E = (t, f) => SFX.push([t, f]);
  for (let t = 1; t < 98; t += .62) E(t, () => AU.step()); for (let t = 103; t < 150; t += .66) E(t, () => AU.step()); for (let t = 212; t < 268; t += .64) E(t, () => AU.step());
  E(100, () => { AU.boom(.35); AU.hissSeal(); }); E(180.5, () => AU.hissSeal()); E(184, () => AU.boot()); E(296, () => AU.hissSeal()); E(300, () => AU.boom(.3)); E(330, () => AU.callTone()); E(333.6, () => AU.chime()); E(425.5, () => AU.glitch());
  E(420, () => AU.boom(.5)); E(478, () => AU.riser(6)); E(497, () => { AU.whoosh(1); AU.boom(.5); }); E(568, () => AU.swell(8, 110)); E(630, () => AU.alarm()); E(655, () => AU.riser(5)); E(660, () => { AU.boom(1); AU.glitch(); });
  E(695, () => AU.riser(5)); E(700, () => AU.boom(.8)); E(735, () => AU.riser(5)); E(740, () => AU.boom(.9)); E(770, () => { AU.boom(1.3); AU.whoosh(1); }); E(772.5, () => { AU.boom(1.6); AU.glitch(); });
  for (const t of [662, 664, 667, 671, 676, 683, 688, 694, 703, 709, 716, 724, 731, 745, 752, 758, 763, 767]) E(t, () => AU.alarm());
  for (let i = 0; i < 46; i++) { const t = 902 + i * 3.7 + hash(i) * 2.5; if (t < 1062) E(t, () => hash(i * 3) > .55 ? AU.creak() : AU.tick()); }
  for (let i = 0; i < 30; i++) E(905 + i * 1.9 + hash(i + 50), () => AU.tick());
  E(1232, () => AU.swell(3, 55)); E(1241, () => AU.boom(1.1)); E(1285, () => AU.riser(5)); E(1405, () => AU.riser(5)); E(1410, () => { AU.boom(1.5); AU.crack(1); }); E(1411.2, () => AU.crack(.8)); E(1412.5, () => AU.crack(.6));
  E(1524, () => AU.riser(10)); E(1534, () => { AU.boom(1.8); AU.crack(1); }); E(1855, () => AU.riser(5)); E(1862, () => { AU.boom(1.4); AU.crack(1); }); E(1771, () => { AU.boot(); AU.glitch(); }); E(1782, () => AU.glitch());
  for (let i = 0; i < 80; i++) { const t = 1626 + i * 2.9 + hash(i + 7) * 2; if (t < 1860) E(t, () => AU.crack(.3 + .5 * hash(i))); }
  E(1574, () => AU.chime(660)); E(1600, () => AU.chime(990)); E(2056, () => AU.swell(18, 73.4)); E(1950.5, () => AU.chime(523));
  SFX.sort((a, b) => a[0] - b[0]);
})();
function audioStopClips() { if (!AU.ready) return; for (const s of AU.live) { try { s.stop(); } catch (e) { } } AU.live = []; AU.seqNext = null; }
function audioStartClips(t) { // resume any dialogue that should be mid-flight at t
  if (!AU.ready) return; for (const c of CUES) { const b = AU.buf[c.c], dur = b.duration / (c.rate || 1); if (t > c.t && t < c.t + dur - .15) playClip(c, (t - c.t) * (c.rate || 1), 0); }
}
function playClip(c, offset, delay) { const ctx = AU.ctx, s = ctx.createBufferSource(); s.buffer = AU.buf[c.c]; s.playbackRate.value = c.rate || 1; const g = ctx.createGain(); g.gain.value = c.g || 1; s.connect(g); g.connect(AU.dlg); if (c.t > 660 && c.t < 740) g.connect(AU.dlgRev);
  s.start(ctx.currentTime + Math.max(0, delay), offset); AU.live.push(s); s.onended = () => { const i = AU.live.indexOf(s); if (i >= 0) AU.live.splice(i, 1); }; }
function audioUpdate(t, prevT) {
  if (!AU.ready) return; const ctx = AU.ctx, now = ctx.currentTime, L = AU.L, set = (p, v, tc = .08) => p.setTargetAtTime(v, now, tc);
  const v = speedAt(t), tp = targetPct(t), sh = (window.W3 && W3.shake) || 0;
  // events
  if (ST.playing && t > prevT && t - prevT < .5) { for (const c of CUES) if (c.t > prevT && c.t <= t) playClip(c, 0, 0); for (const e of SFX) { if (e[0] > t) break; if (e[0] > prevT) e[1](); }
    // sequencer
    if (AU.seqNext === null) AU.seqNext = Math.ceil(t / STEP); while (AU.seqNext * STEP < t + .18) { const st = AU.seqNext * STEP; AU.playStep(AU.seqNext, st, now + Math.max(0, st - t)); AU.seqNext++; } }
  // engine follows rider effort
  const engOn = (t >= 300 && t < 772) ? clamp((t - 300) / 20) : (t >= 992 && t < 2099) ? clamp((t - 992) / 40) : 0;
  const thr = clamp((tp - 35) / 90) * engOn, cabin = t >= 296;
  const f0 = 34 + 70 * thr + (t >= 478 && t < 772 ? 22 * clamp(v / 6000) : 0); L.osc[0].frequency.setTargetAtTime(f0, now, .15); L.osc[1].frequency.setTargetAtTime(f0 * 1.503, now, .15); L.osc[2].frequency.setTargetAtTime(f0 * .5, now, .15);
  set(L.engF.frequency, 160 + 1500 * thr * thr); set(L.engG.gain, engOn * (.05 + .2 * thr) * (t > 1936 ? .5 : 1)); set(L.whF.frequency, 700 + 5200 * thr); set(L.whG.gain, engOn * (.02 + .16 * thr * thr));
  const windK = t < 478 ? 0 : t < 780 ? .35 * clamp(v / 4000) + .25 * clamp((tp - 90) / 30) : t < 990 ? 0 : t < 1936 ? .12 + .55 * clamp(v / 450) : .05;
  set(L.windG.gain, windK * (t >= 990 && t < 1050 ? clamp((t - 990) / 30) : 1) * .5); set(L.windF.frequency, 250 + 1600 * clamp(t < 780 ? v / 9000 : v / 500));
  set(L.rumG.gain, clamp(sh * .5 + (t >= 480 && t < 500 ? .5 : 0) + (t >= 1620 && t < 1866 ? .25 : 0), 0, .9));
  set(L.hissG.gain, (t >= 1318 && t < 1410) ? .07 : 0, .5);
  set(L.ringG.gain, kf(t, [[772, 0], [774, .05], [790, .035], [860, .012], [900, .004], [990, 0]]), .3); set(L.droneG.gain, kf(t, [[772, 0], [782, .12], [890, .09], [905, .03], [990, 0], [1946, 0], [1960, .1], [2090, .14], [2098, 0]]), .4);
  const shr = win(t, 733, 770.2, 4, .2); set(L.shG.gain, shr * .22); L.shO.frequency.setTargetAtTime(kf(t, [[733, 70], [760, 300], [770, 1500]]), now, .1); set(L.shF.frequency, kf(t, [[733, 200], [770, 4200]]));
  set(L.hangG.gain, kf(t, [[40, 0], [96, .12], [100, .16], [101, .85], [296, .8], [299, .22], [420, .14], [470, .05], [490, 0]]), .15); set(L.hangF.frequency, t < 100 ? 500 : t < 296 ? 16000 : 480, .2);
  set(L.mumG.gain, win(t, 786, 895, 6, 6) * .28, .4);
  set(AU.musF.frequency, t < 100 ? 300 : t < 296 ? 9000 : t < 430 ? 420 : 16000, .2); const duck = subAt(t) ? .5 : 1; set(AU.mus.gain, .8 * duck * (t >= 660 && t < 771 ? .75 : 1), .12); set(AU.sfx.gain, .9 * (duck < 1 ? .65 : 1), .12); set(AU.master.gain, ST.muted ? 0 : .72, .05);
}
