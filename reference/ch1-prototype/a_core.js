'use strict';
/* ===== OVERREACH · Chapter 1 ride · core, data, HUD ===== */
const Q = new URLSearchParams(location.search);
const DUR = 2100;
const $ = id => document.getElementById(id);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const win = (t, a, b, fi = 1, fo = fi) => ss(a, a + fi, t) * (1 - ss(b - fo, b, t));
function kf(t, K) {
  if (t <= K[0][0]) return K[0][1];
  for (let i = 1; i < K.length; i++) if (t < K[i][0]) { const a = K[i - 1], b = K[i]; return lerp(a[1], b[1], (t - a[0]) / (b[0] - a[0])); }
  return K[K.length - 1][1];
}
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const h2 = (a, b) => hash(a * 57.31 + b * 113.7 + 0.5);
const noise1 = x => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash(i), hash(i + 1), u) * 2 - 1; };
const fmtT = s => { s = Math.max(0, Math.floor(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };

/* ---------- workout: [t0, t1, %from, %to, label, ergOff] ---------- */
const IV = [
  [0, 100, 50, 50, 'Free spin'], [100, 150, 50, 50, 'Warm-up'], [150, 210, 52, 52, 'Warm-up'], [210, 330, 55, 55, 'Warm-up'],
  [330, 420, 58, 58, 'Roll to the rails'], [420, 480, 60, 60, 'Bay doors'], [480, 570, 65, 80, 'Launch · tempo ramp'], [570, 660, 70, 70, 'To the start line'],
  [660, 680, 115, 115, 'ESCAPE SURGE 1', 1], [680, 700, 75, 75, 'Recover', 1], [700, 720, 115, 115, 'ESCAPE SURGE 2', 1], [720, 740, 75, 75, 'Recover', 1],
  [740, 770, 120, 120, 'WARP RING · MAX', 1], [770, 780, 70, 70, 'Shockwave'], [780, 900, 45, 45, 'Blackout · easy'], [900, 990, 48, 48, 'Stay calm'],
  [990, 1050, 55, 55, 'Spin the turbines up'], [1050, 1110, 62, 62, 'Hover'], [1110, 1170, 68, 68, 'Glide'], [1170, 1230, 74, 74, 'Terror opens up'],
  [1230, 1290, 70, 70, 'Impact one'], [1290, 1320, 100, 100, 'DASH FOR COVER'], [1320, 1410, 82, 82, 'Inside the steam'], [1410, 1440, 115, 115, 'IMPACT TWO · MOVE', 1],
  [1440, 1530, 70, 70, 'Weave the craters'], [1530, 1560, 120, 120, 'THE BIG ONE', 1], [1560, 1620, 65, 65, 'One of ours'],
  [1620, 1680, 75, 75, 'Frozen wave · climb'], [1680, 1740, 80, 80, 'Climb'], [1740, 1800, 85, 85, 'Climb'], [1800, 1860, 90, 90, 'Climb · hold'],
  [1860, 1890, 118, 118, 'LAUNCH OFF THE CREST', 1], [1890, 1950, 60, 60, 'Into the dark'], [1950, 2010, 55, 55, 'Slingshot'], [2010, 2055, 52, 52, 'Cool-down'], [2055, 2100, 45, 45, 'The gate']
];
function ivAt(t) { for (const v of IV) if (t < v[1]) return v; return IV[IV.length - 1]; }
function targetPct(t) { const v = ivAt(t); return lerp(v[2], v[3], clamp((t - v[0]) / (v[1] - v[0]))); }
const SURGES = IV.filter(v => v[2] >= 100).map(v => v[0]);
const zoneCol = p => p >= 115 ? '#ff4d6d' : p >= 100 ? '#ff9f43' : p >= 85 ? '#ffd166' : p >= 70 ? '#6fe3b4' : p >= 56 ? '#6ec8ff' : '#8b95b5';

/* ---------- speed (m/s) and distance ---------- */
const SPD = [[0, 1.3], [100, 1.3], [150, .4], [210, 1.2], [270, .3], [300, 0], [330, 2], [420, 6], [478, 14], [510, 120], [540, 480], [570, 900], [600, 1100], [655, 1200],
  [660, 1500], [680, 2600], [700, 3400], [720, 4200], [740, 5200], [770, 12000], [772, 30000], [780, 0], [1050, 0], [1065, 4], [1110, 45], [1170, 90], [1230, 150], [1290, 165],
  [1293, 300], [1320, 330], [1325, 230], [1410, 240], [1414, 420], [1440, 430], [1446, 270], [1530, 290], [1534, 520], [1560, 540], [1566, 150], [1580, 60], [1612, 60],
  [1620, 180], [1680, 220], [1740, 260], [1800, 310], [1860, 360], [1864, 900], [1890, 1500], [1950, 4000], [2010, 9000], [2055, 6000], [2090, 1500], [2100, 800]];
const speedAt = t => kf(t, SPD);
const DT_TAB = 0.05, STAB = new Float64Array(Math.ceil(DUR / DT_TAB) + 2);
for (let i = 1; i < STAB.length; i++) STAB[i] = STAB[i - 1] + speedAt((i - .5) * DT_TAB) * DT_TAB;
function S(t) { const x = clamp(t, 0, DUR) / DT_TAB, i = Math.floor(x); return lerp(STAB[i], STAB[i + 1], x - i); }

/* ---------- beats (jump list) ---------- */
const BEATS = [[0, 'The corridor'], [100, 'Hangar doors open'], [150, 'Holt and the helmet'], [180, 'Helmet on · visor boot'], [270, 'The craft'], [330, 'Sarah’s call'], [420, 'Bay doors open'],
  [480, 'Launch'], [570, 'The Meridian'], [630, '“Something’s wrong”'], [660, 'AI takes control'], [740, 'Warp ring'], [780, 'Blackout'], [900, 'Waking on the Ice'], [990, 'Turbines up'],
  [1110, 'Glide'], [1170, 'Terror opens up'], [1230, 'Impact one'], [1290, 'Dash for cover'], [1320, 'Inside the steam'], [1410, 'Impact two'], [1440, 'Weaving craters'], [1530, 'The big one'],
  [1560, 'One of ours'], [1620, 'The frozen wave'], [1770, 'New ship modes'], [1860, 'Off the crest'], [1950, 'Slingshot · the AI speaks'], [2010, '“They’re gone”'], [2055, 'The gate']];

/* ---------- dialogue cues: t, clip, gain, subs [off, dur, who, text] ---------- */
const CUES = [
  { t: 106, c: 'pa', g: .5, subs: [[0, 6, 'PA', 'Welcome to championship day on the Meridian! Pilots, launch rails open in five minutes.']] },
  { t: 126, c: 'influencer', g: .55, subs: [[0, 7.6, 'FEED', 'Hi besties! I’m live from the Meridian hangar, where statistically somebody dies today. Smash that follow.']] },
  { t: 151, c: 'helmet', g: 1, subs: [[0, 5.8, 'HOLT', 'Your lid. Fresh paint. Updated the firmware while I was in there.'], [6, 1.5, 'CRUSH', 'Updated how?'], [8, 3.4, 'HOLT', 'Safety stuff. Just wear it, Crush.']] },
  { t: 214, c: 'tech', g: 1, subs: [[0, 2, 'TECH', 'Pre-flight’s clean. She’s yours.']] },
  { t: 334, c: 'call', g: 1, subs: [[.2, 1, 'SARAH', 'Comms check.'], [1.4, 1.1, 'CRUSH', 'Loud and clear.'], [2.9, .9, 'SARAH', 'How’s the head?'], [4, .9, 'CRUSH', 'Steady.'], [4.95, 1.3, 'SARAH', 'Come back in one piece.'],
    [6.55, 1.3, 'CRUSH', 'What could go wrong?'], [8.15, 7, 'AI', 'The most common causes of death during racing are engine failure, collision, debris acting as shrapnel.'], [15.6, 3.3, 'AI', 'Cardiac arrest. And brain haemorrhaging.'],
    [19.2, 1.3, 'CRUSH', 'Rhetorical question.'], [21, .8, 'AI', 'I know.']] },
  { t: 421, c: 'sendoff', g: 1, subs: [[.2, 1, 'CRUSH', 'Clearing the bay.'], [1.4, 4.3, 'SARAH', 'Reach over and grab it. I’ll be on Observation Deck 4.']] },
  { t: 546, c: 'racecontrol', g: .8, subs: [[0, 5.8, 'RACE CONTROL', 'Race control to all pilots. Grid forms at marker one. Warp rings are live. Fly clean.']] },
  { t: 574, c: 'beautiful', g: 1, subs: [[.2, 1.8, 'AI', 'Beautiful, isn’t it?'], [2.4, 2.9, 'CRUSH', 'Never gets old. Moving to the start line.']] },
  { t: 633, c: 'wrong', g: 1, subs: [[.2, 1.7, 'AI', 'Crush. Something’s wrong.'], [2.3, .6, 'CRUSH', 'Say again?'], [3.2, 1.1, 'AI', 'I’m taking the controls.'], [4.75, 1.2, 'CRUSH', 'Negative, I have—']] },
  { t: 657.15, c: 'thrust', g: 1.1, subs: [[0, 2.85, 'AI', 'Thrust in three. Two. One.']] },
  { t: 663.5, c: 'openmain', g: 1.1, subs: [[0, 1.4, 'CRUSH', 'Open main channel.']] },
  { t: 665.5, c: 'panic1', g: 1.1, subs: [[0, 3.6, 'OPEN CHANNEL', 'My AI’s locked me out! I’ve got no stick, I’ve got nothing!']] },
  { t: 668.2, c: 'panic2', g: 1, subs: [[1.2, 2.8, 'OPEN CHANNEL', 'Race control, what the hell is going on? Race control, respond!']] },
  { t: 672.4, c: 'panic3', g: 1.05, subs: [[0, 3.1, 'OPEN CHANNEL', 'It’s pulling me off the course! Why is it running?']] },
  { t: 676, c: 'panic1', g: .35, rate: 1.12 }, { t: 679, c: 'panic2', g: .4, rate: .92 }, { t: 684, c: 'panic3', g: .35, rate: 1.08 }, { t: 690, c: 'panic1', g: .3, rate: .9 },
  { t: 697, c: 'panic2', g: .4, rate: 1.1 }, { t: 704, c: 'panic3', g: .4, rate: .94 }, { t: 712, c: 'panic1', g: .35, rate: 1.05 },
  { t: 722, c: 'panic4', g: 1.2, subs: [[0, 3.4, 'OPEN CHANNEL', 'Oh god. Look behind us. Look behind us!']] },
  { t: 738.5, c: 'holdon', g: 1.2, subs: [[0, 1.2, 'AI', 'Hold on.']] },
  { t: 1601, c: 'oneofours', g: 1.3, subs: [[0, 2.2, 'CRUSH', '…That’s one of ours.']] },
  { t: 1952, c: 'talknow', g: 1, subs: [[0, 2.2, 'AI', 'We should be able to talk now.']] },
  { t: 1963, c: 'ninehours', g: 1, subs: [[0, 3.5, 'AI', 'Nine hours to our destination. Rest.']] },
  { t: 2031, c: 'gone', g: 1.3, subs: [[0, 2.4, 'CRUSH', 'They’re gone, aren’t they?']] },
  { t: 2062, c: 'allgone', g: 1.1, subs: [[0, 3, 'AI', 'Yes, Crush. They’re all gone.']] }
];

/* ---------- Glass (AI writing in condensation): t, text, hold ---------- */
const GLASS = [[905, 'STAY CALM.', 9], [918, 'DO NOT MAKE ANY NOISE.', 10], [932, 'IT CAN DETECT OUR COMMS.', 11], [948, 'YOU HAVE BEEN UNCONSCIOUS\nFOR SIX HOURS.', 14],
  [993, 'SPIN THE TURBINES UP.\nGENTLY.', 13], [1053, 'COLD HIDES US.\nNOTHING HERE TRANSMITS.', 12], [1113, 'STAY IN THE RANGE.\nHEAT GIVES US AWAY.', 12],
  [1238, 'STATION DEBRIS.', 7], [1248, 'SOMETHING IS READING OUR EMISSIONS.\nI DON’T KNOW WHAT.', 12], [1264, 'USE THE IMPACTS AS COVER.', 12], [1288.5, 'GO.', 6],
  [1323, 'HIDDEN. PUSH.', 9], [1408.5, 'MOVE.', 5], [1565, 'THE LIGHTS ARE A MESSAGE.', 8], [1575, 'PILOT ALIVE. SEDATED.', 8], [1585, 'FLIGHT INOPERABLE.\nSEND HELP.', 10], [1858.5, 'NOW.', 6],
  [1894, 'THEY CAN’T HEAR US UP HERE.', 12]];

/* ---------- stills: img, t0, t1, fadeIn, fadeOut, [scale,x%,y%] from → to, opts ---------- */
const STILLS = [
  { i: 's01', a: 0, b: 102, fi: 4, fo: 2, f: [1.04, 0, 0], t: [2.1, 0, 3], o: '50% 38%' },
  { i: 's02', a: 100, b: 152, fi: 2, fo: 1.5, f: [1.3, -5, 2], t: [1.08, 3, -1] },
  { i: 's03', a: 150, b: 183, fi: 1.5, fo: 1.5, f: [1.02, 0, 2], t: [1.22, 0, -2], o: '50% 35%' },
  { i: 's02', a: 181, b: 272, fi: 2, fo: 2, f: [1.5, 8, -4], t: [2.0, -6, -8], visor: 1 },
  { i: 's04', a: 270, b: 318, fi: 2, fo: 5, f: [1.02, 2, 0], t: [1.55, -6, 6], o: '55% 40%', visor: 1 },
  { i: 's05', a: 571, b: 580.5, fi: 1, fo: 1.2, f: [1.12, 2, 0], t: [1.02, -1, 0], ins: 1 },
  { i: 's07', a: 771.6, b: 774.2, fi: .15, fo: .8, f: [1.3, 0, 0], t: [1.0, 0, 0], ins: 1 },
  { i: 's08', a: 897, b: 1048, fi: 7, fo: 12, f: [1.16, 0, 0], t: [1.24, -1, 1], rot: -7 },
  { i: 's09', a: 1173, b: 1180, fi: 1, fo: 1.2, f: [1.1, 0, 0], t: [1.0, 0, 0], ins: 1 },
  { i: 's10', a: 1234.5, b: 1240.5, fi: 1, fo: 1.2, f: [1.0, 0, 0], t: [1.1, 2, -2], ins: 1 },
  { i: 's11', a: 1589, b: 1597, fi: 1, fo: 1.2, f: [1.0, 0, 0], t: [1.1, 0, 0], ins: 1 },
  { i: 's12', a: 1623, b: 1629.5, fi: 1, fo: 1.2, f: [1.12, 0, 0], t: [1.0, 0, 0], ins: 1 },
  { i: 's13', a: 1903, b: 1910, fi: 1.2, fo: 1.5, f: [1.0, 0, 0], t: [1.1, 0, -2], ins: 1 },
  { i: 's14', a: 2086, b: 2098.4, fi: 3.5, fo: .1, f: [1.18, 0, 0], t: [1.0, 0, 0] }
];

/* ---------- state ---------- */
const ST = { T: Math.min(DUR - 1, parseFloat(Q.get('t') || '0')), playing: false, still: Q.has('still'), camOverride: null, inserts: !Q.has('noins'), muted: false, ftp: 250, started: false, kj: 0, pw: 0 };
window.ST = ST;

/* ---------- camera mode by time ---------- */
function camMode(t) {
  if (ST.camOverride) return ST.camOverride;
  if ((t >= 570 && t < 626) || (t >= 1176 && t < 1228) || (t >= 1446 && t < 1524) || (t >= 1684 && t < 1736) || (t >= 1808 && t < 1850)) return 'chase';
  return 'cockpit';
}

/* ===================== HUD ===================== */
const HUD = {};
function hudInit() {
  // stills
  const sl = $('stills');
  STILLS.forEach((s, k) => { const d = document.createElement('div'); d.className = 'still'; const im = document.createElement('img'); im.src = IMG[s.i]; im.alt = ''; d.appendChild(im);
    if (s.ins) { const l = document.createElement('span'); l.className = 'sblabel'; l.textContent = 'STORYBOARD'; d.appendChild(l); } sl.appendChild(d); s.el = d; s.im = im; });
  // weird flashes
  const wl = $('weird'); HUD.weird = ['thin-2', 'thin-4', 'gate-2', 's14', 's06'].map(n => { const im = document.createElement('img'); im.src = IMG[n]; im.alt = ''; wl.appendChild(im); return im; });
  // graph
  HUD.g = $('graph'); HUD.gx = HUD.g.getContext('2d'); drawGraph();
  HUD.g.addEventListener('click', e => { const r = HUD.g.getBoundingClientRect(); seek((e.clientX - r.left) / r.width * DUR); });
  // jump list
  const jl = $('jumplist'); BEATS.forEach(b => { const a = document.createElement('button'); a.innerHTML = '<i>' + fmtT(b[0]) + '</i>' + b[1]; a.onclick = () => { seek(b[0]); $('jump').hidden = true; }; jl.appendChild(a); });
  // notifications content
  HUD.notes = ['PILOT INPUT REJECTED', 'COURSE DEVIATION 14°', 'RACE CONTROL: NO RESPONSE', 'AI OVERRIDE · UPDATE 76.90', 'OPEN CHANNEL: 3 VOICES', 'COURSE DEVIATION 41°', 'OPEN CHANNEL: 5 VOICES', 'THRUST LIMITER REMOVED',
    'GATE TELEMETRY SYNC ▲▲▲', 'OPEN CHANNEL: 12 VOICES', 'MERIDIAN TRAFFIC: OFFLINE', 'HULL STRESS 91%', 'WARP RING 7 RETARGETED', 'GATE TELEMETRY: OUT OF RANGE', 'BRACE'];
  HUD.fog = $('fog'); HUD.fx = HUD.fog.getContext('2d');
  // fog noise tile
  const n = document.createElement('canvas'); n.width = n.height = 256; const nx = n.getContext('2d'); const id = nx.createImageData(256, 256);
  for (let i = 0; i < 65536; i++) { const x = i & 255, y = i >> 8; const k = Math.PI * 2 / 256, v = 214 + 16 * Math.sin(x * k * 2 + 2 * Math.sin(y * k * 3)) * Math.sin(y * k * 3 + 1.5 * Math.sin(x * k)) + 10 * Math.sin(x * k * 5 + y * k * 4) + 12 * hash(i); id.data[i * 4] = v * .92; id.data[i * 4 + 1] = v * .96; id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
  nx.putImageData(id, 0, 0); HUD.fogTile = n;
}
function drawGraph() {
  const c = HUD.g, x = HUD.gx, W = c.width = c.clientWidth * 2, H = c.height = c.clientHeight * 2; x.clearRect(0, 0, W, H);
  for (const v of IV) { const x0 = v[0] / DUR * W, x1 = v[1] / DUR * W; const p0 = v[2], p1 = v[3]; x.fillStyle = zoneCol(Math.max(p0, p1)); x.globalAlpha = .85;
    x.beginPath(); x.moveTo(x0 + .5, H); x.lineTo(x0 + .5, H - p0 / 130 * H); x.lineTo(x1 - .5, H - p1 / 130 * H); x.lineTo(x1 - .5, H); x.fill(); }
  x.globalAlpha = 1; x.fillStyle = 'rgba(255,255,255,.5)'; for (const tt of [990, 1890]) x.fillRect(tt / DUR * W, 0, 2, H);
}
const speedFmt = v => v < 0.05 ? ['0', 'KM/H'] : v < 1000 ? [Math.round(v * 3.6).toLocaleString('en-GB'), 'KM/H'] : [(v / 1000).toFixed(1), 'KM/S'];
let lastSub = '', lastNote = -1, simP = 0, simC = 85;
function hudUpdate(t, dt) {
  const W = innerWidth, H = innerHeight, cam = camMode(t);
  // ----- stills
  let stillTop = 0;
  for (const s of STILLS) {
    let o = (t >= s.a && t <= s.b) ? Math.min(clamp((t - s.a) / s.fi), clamp((s.b - t) / s.fo)) : 0; if (s.ins && !ST.inserts) o = 0;
    if (o > 0) { const u = clamp((t - s.a) / (s.b - s.a)), e = u * u * (3 - 2 * u) * .5 + u * .5; const sc = lerp(s.f[0], s.t[0], e), px = lerp(s.f[1], s.t[1], e), py = lerp(s.f[2], s.t[2], e);
      const bob = s.a < 320 ? Math.sin(t * 5.6) * .35 * clamp(speedAt(t)) : 0; // footstep bob while walking
      s.el.style.display = 'block'; s.el.style.opacity = o; s.im.style.transformOrigin = s.o || '50% 50%';
      s.im.style.transform = `translate(${px + Math.sin(t * .31) * .3}%,${py + bob + Math.cos(t * .23) * .25}%) scale(${sc}) rotate(${s.rot || 0}deg)`;
      s.el.classList.toggle('visor', !!s.visor && t > 183); stillTop = Math.max(stillTop, o); } else if (s.el.style.display !== 'none') s.el.style.display = 'none';
  }
  HUD.stillTop = stillTop;
  // ----- blackout weirdness
  const wk = win(t, 786, 896, 3, 4);
  HUD.weird.forEach((im, k) => { const ph = t * (.11 + k * .017) + k * 1.7, cyc = Math.floor(ph), fr = ph - cyc; const o = wk * Math.pow(Math.max(0, Math.sin(fr * Math.PI)), 6) * (h2(cyc, k) > .45 ? .55 : 0);
    if (o > .01) { const side = h2(cyc, k + 9) > .5; im.style.display = 'block'; im.style.opacity = o; im.style.left = (side ? 58 + h2(cyc, k + 3) * 22 : -12 + h2(cyc, k + 3) * 22) + '%'; im.style.top = (h2(cyc, k + 5) * 60 - 5) + '%';
      im.style.transform = `scale(${1 + fr * .25}) rotate(${(h2(cyc, k + 7) - .5) * 30}deg)`; } else im.style.display = 'none'; });
  // ----- title cards
  const tc = $('titlecard'); let ttl = '';
  if (t < 16) ttl = `<small>OVERREACH · SEASON 1</small><b>CHAPTER 1</b><em>The Disaster</em>`; else if (t > 1978 && t < 2006) ttl = `<em>Nine hours later</em>`;
  const to = t < 16 ? win(t, 1.5, 15, 2.5) : win(t, 1979, 2005, 3);
  if (HUD.ttl !== ttl) { tc.innerHTML = ttl; HUD.ttl = ttl; } tc.style.opacity = ttl ? to : 0;
  // ----- canopy + cockpit overlay
  const cockpitOn = t >= 306 && t < 2098 && cam === 'cockpit' && !(t >= 780 && t < 897);
  $('canopy').style.opacity = cockpitOn ? clamp((t - 306) / 6) * (1 - stillTop * (t > 890 && t < 1050 ? 1 : .0)) : 0;
  // ----- HUD visibility by story state
  const hudDead = t >= 776 && t < 990, visorOn = t >= 183;
  const hudOp = !visorOn ? 0 : hudDead ? 0 : t < 190 ? (Math.sin(t * 40) > 0 ? .9 : .3) : 1;
  const hud = $('hud'); hud.style.opacity = hudOp; hud.classList.toggle('alt', t >= 1770 && t < 2100); hud.classList.toggle('tear', t >= 770 && t < 776);
  const v = speedAt(t), sf = speedFmt(v);
  $('spdv').textContent = sf[0]; $('spdu').textContent = sf[1];
  $('spd').style.opacity = (t >= 300 && (t < 990 || t >= 1110)) ? 1 : 0;
  $('zw').textContent = v > 12 ? '×' + Math.round(v * 3.6 / 35).toLocaleString('en-GB') + ' a fast bike' : '';
  // boot
  const boot = $('boot'); if (t >= 183 && t < 214) { const L = ['VISOR OS · COLD START', 'OPTICS ......... OK', 'BIOMETRICS ..... OK', 'UPDATE 76.90 · AS 0812 <b>(EARTH 2826)</b>', 'CHANGELOG:', '· Gate telemetry sync', '· <u>Pilot override (emergency)</u>', '· Minor fixes', 'SHIP 07 “DIVERS” MARKED ▸'];
    const n = Math.floor((t - 183.5) * 1.1); boot.innerHTML = L.slice(0, clamp(n, 0, L.length)).join('<br>'); boot.style.opacity = 1 - ss(208, 214, t); } else boot.style.opacity = 0;
  // waypoint
  const way = $('way'); let wl = '', wx = 50, wy = 42;
  if (t >= 214 && t < 300) { wl = 'SHIP 07 · ' + Math.max(4, Math.round(140 - (t - 214) * 1.6)) + ' m'; wx = 58 + Math.sin(t * .2) * 3; wy = 44; }
  else if (t >= 584 && t < 660) { wl = 'START LINE · ' + Math.max(0, (S(668) - S(t)) / 1000).toFixed(0) + ' km'; wx = 50; wy = 47; }
  else if (t >= 1242 && t < 1320) { wl = 'COVER · ' + ((S(1322) - S(t)) / 1000).toFixed(1) + ' km'; wx = 50; wy = 46; }
  else if (t >= 1446 && t < 1530) { wl = 'FROZEN WAVE · ' + ((S(1620) - S(t)) / 1000).toFixed(0) + ' km'; wx = 50; wy = 45; }
  else if (t >= 1640 && t < 1858) { wl = 'CREST · ' + ((S(1862) - S(t)) / 1000).toFixed(1) + ' km · GRADIENT ' + Math.round(kf(t, [[1620, 6], [1700, 11], [1800, 14], [1860, 19]])) + '%'; wx = 50; wy = 40; }
  else if (t >= 2066 && t < 2090) { wl = 'DESTINATION · THE GATE'; wx = 50; wy = lerp(70, 40, ss(2060, 2084, t)); }
  way.style.opacity = wl ? 1 : 0; if (wl) { $('wayl').textContent = wl; way.style.left = wx + '%'; way.style.top = wy + '%'; }
  // call overlay
  const call = $('call'); const co = win(t, 330, 428, .6, .4); call.style.opacity = co; if (co > 0) { $('callst').textContent = t < 334 ? 'INCOMING…' : t < 425.5 ? 'SECURE · ' + fmtT(t - 334) : 'FEED LOST'; call.classList.toggle('lost', t >= 425.5);
    const bars = $('callw').children, talk = subAt(t); for (let i = 0; i < bars.length; i++) bars[i].style.height = (talk && talk[2] === 'SARAH' ? 20 + 70 * Math.abs(noise1(t * 9 + i * 3.3)) : 8) + '%'; }
  // AI control banner + notification spam
  $('banner').style.opacity = (t >= 657 && t < 776) ? (Math.sin(t * 9) > -.3 ? 1 : .35) : 0;
  const nn = t >= 661 && t < 776 ? Math.min(HUD.notes.length, Math.floor(kf(t, [[661, 0], [680, 3], [700, 5], [740, 12], [770, 15]]))) : 0;
  if (nn !== lastNote) { lastNote = nn; $('notes').innerHTML = HUD.notes.slice(Math.max(0, nn - 6), nn).map(s => '<div>' + s + '</div>').join(''); if (nn > 0 && ST.playing && window.AU && AU.ready) AU.ping(880 + nn * 40); }
  $('boost').style.opacity = (t >= 736 && t < 772) ? 1 : 0; $('boostf').style.width = clamp((t - 740) / 28) * 100 + '%';
  // heat gauge (ice) + restore sequence
  const p = targetPct(t), iv = ivAt(t);
  const heatOn = t >= 900 && t < 1895; $('heat').style.opacity = heatOn ? (t < 906 ? (Math.sin(t * 30) > 0 ? 1 : .2) : 1) : 0;
  const masked = t >= 1320 && t < 1410, heat = clamp((simP / ST.ftp * 100 - 30) / 100 * (masked ? .5 : 1) + .08 * noise1(t * .7));
  $('heatf').style.height = heat * 100 + '%'; $('heatt').textContent = masked ? 'MASKED' : heat > .8 ? 'EXPOSED' : 'HEAT';
  $('heat').classList.toggle('hot', heat > .8 && !masked);
  $('mapbox').style.opacity = (t >= 1170 && t < 1895) || (t >= 214 && t < 776) ? 1 : 0;
  $('hdg').textContent = 'HDG ' + String(Math.round((212 + 20 * noise1(t * .02) + 360) % 360)).padStart(3, '0') + '° · ALT ' + (t > 990 && t < 1860 ? Math.round(4 + 2 * noise1(t * .4)) + ' m' : t < 497 ? 'DOCK' : 'VAC');
  // gate overlay flash (new ship modes)
  const go = (t >= 1771 && t < 1773.2) ? (Math.sin(t * 47) > -.2 ? .9 : .2) : (t >= 1782 && t < 1782.5 ? .6 : 0); $('gateov').style.opacity = go; if (go) $('gateov').style.transform = `translate(-50%,-50%) rotate(${t * 40}deg) scale(${1 + (t - 1771) * .08})`;
  $('modes').style.opacity = win(t, 1766, 1800, 1, 3);
  // rescue tag
  const tag = $('tag'); if (window.W3 && W3.tagPos && t >= 1574 && t < 1616) { tag.style.opacity = 1; tag.style.left = W3.tagPos.x + 'px'; tag.style.top = W3.tagPos.y + 'px'; $('tagl').innerHTML = t < 1600 ? 'RACER · LIFE SIGNS 1<br>TAGGED FOR RESCUE' : 'DIVERS 04 · FROBISHER<br>TEAM-MATE MARKER SAVED'; } else tag.style.opacity = 0;
  // ----- workout strip (always on)
  const tw = Math.round(p / 100 * ST.ftp);
  // simulated rider follows target
  const lag = 1 - Math.exp(-dt * 1.4); simP = lerp(simP, tw * (1 + .03 * noise1(t * .9)) + 4 * noise1(t * 3.1), lag); simC = lerp(simC, (p >= 100 ? 102 : p >= 80 ? 92 : p < 50 ? 80 : 87) + 2 * noise1(t * .5), lag);
  if (ST.playing) { ST.kj += simP * dt / 1000; ST.pw += Math.pow(simP, 4) * dt; }
  $('tgw').textContent = tw; $('tgp').textContent = Math.round(p) + '% FTP'; $('tgl').textContent = iv[4]; $('tgc').textContent = fmtT(iv[1] - t + .99);
  $('tgt').style.setProperty('--z', zoneCol(p)); $('erg').style.opacity = iv[5] ? 1 : 0;
  const nxt = IV[IV.indexOf(iv) + 1]; $('nxt').textContent = nxt ? 'NEXT ' + nxt[4].toUpperCase() + ' · ' + Math.round(nxt[2]) + '%' : 'RIDE ENDS';
  const showPw = t < 776 || t >= 1110, showCad = t < 776 || t >= 1050;
  $('pwv').textContent = showPw ? Math.round(simP) : '—'; $('cdv').textContent = showCad ? Math.round(simC) : '—';
  $('clock').textContent = fmtT(t) + ' / 35:00'; $('ph').style.left = t / DUR * 100 + '%';
  // spin-up cue
  const cue = $('cue'); let cu = ''; for (const st of SURGES) { if (t >= st - 5 && t < st) cu = 'SPIN UP · ' + Math.ceil(st - t); else if (t >= st && t < st + 1.5) cu = 'GO'; }
  if (cue.textContent !== cu) cue.textContent = cu; cue.style.opacity = cu ? 1 : 0; cue.classList.toggle('go', cu === 'GO');
  // ----- subtitles
  const sub = subAt(t), sh = sub ? `<b>${sub[2]}</b> ${sub[3]}` : ''; if (sh !== lastSub) { lastSub = sh; $('subs').innerHTML = sh; } $('subs').style.opacity = sh ? 1 : 0;
  // ----- canopy fog + Glass
  drawFog(t, W, H);
  // ----- end card
  const end = $('endcard'); if (t >= 2098.5) { end.style.opacity = 1; const np = ST.pw > 0 ? Math.pow(ST.pw / Math.max(1, t), .25) : 0;
    $('endstats').innerHTML = `<span><b>35:00</b>duration</span><span><b>${Math.round(ST.kj)}</b>kJ (simulated)</span><span><b>${Math.round(np) || '—'}</b>W normalised</span><span><b>7</b>surges</span>`; } else end.style.opacity = 0;
}
function subAt(t) { for (const c of CUES) if (c.subs && t >= c.t && t < c.t + 30) for (const s of c.subs) if (t >= c.t + s[0] && t < c.t + s[0] + s[1] + .25) return s; return null; }
function drawFog(t, W, H) {
  const c = HUD.fog, x = HUD.fx; const need = t >= 895 && t < 1912; if (!need) { if (c.style.display !== 'none') c.style.display = 'none'; return; }
  c.style.display = 'block'; if (c.width !== (W >> 1) || c.height !== (H >> 1)) { c.width = W >> 1; c.height = H >> 1; } const w = c.width, h = c.height; x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, w, h);
  // overall condensation
  const fogA = kf(t, [[895, 0], [902, .84], [990, .84], [1050, .55], [1110, .14], [1170, 0]]);
  if (fogA > 0) { x.globalAlpha = fogA; x.fillStyle = x.createPattern(HUD.fogTile, 'repeat'); x.fillRect(0, 0, w, h); x.globalAlpha = 1;
    const th = ss(988, 1050, t); if (th > 0) { x.globalCompositeOperation = 'destination-out'; const g = x.createRadialGradient(w * .82, h * .3, 0, w * .82, h * .3, w * (.15 + th * 1.1)); g.addColorStop(0, 'rgba(0,0,0,' + th + ')'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h); x.globalCompositeOperation = 'source-over'; }
    // drips
    x.globalCompositeOperation = 'destination-out'; x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 2; for (let i = 0; i < 9; i++) { const dx = w * hash(i * 3.3), len = h * (.2 + .6 * hash(i + 40)) * clamp((t - 900 - i * 6) / 60); x.beginPath(); x.moveTo(dx, h * hash(i + 9) * .3); x.lineTo(dx + 3 * Math.sin(i), h * hash(i + 9) * .3 + len); x.stroke(); } x.globalCompositeOperation = 'source-over'; }
  // Glass writing
  for (const g of GLASS) { const a = g[0], hold = g[2], txt = g[1]; if (t < a || t > a + hold + 3) continue; const fade = 1 - ss(a + hold, a + hold + 3, t), shown = Math.floor((t - a) * 16);
    const fs = Math.round(h * (txt.length > 30 ? .062 : .078)); x.font = `600 ${fs}px "Bradley Hand","Marker Felt","Segoe Print","Comic Sans MS",cursive`; x.textBaseline = 'middle'; x.textAlign = 'left';
    const lines = txt.split('\n'); const cx = w * .27, cy = h * .3; let wmax = 0; for (const l of lines) wmax = Math.max(wmax, x.measureText(l).width);
    if (fogA < .5) { // local breath patch so the writing has something to live in
      const pg = x.createRadialGradient(cx + wmax / 2, cy + (lines.length - 1) * fs * .6, fs, cx + wmax / 2, cy + (lines.length - 1) * fs * .6, wmax * .75 + fs * 2); pg.addColorStop(0, `rgba(232,240,250,${.9 * fade * (1 - fogA)})`); pg.addColorStop(.6, `rgba(232,240,250,${.7 * fade * (1 - fogA)})`); pg.addColorStop(1, 'rgba(228,236,248,0)'); x.fillStyle = pg; x.fillRect(0, 0, w, h); }
    let n = shown; lines.forEach((l, k) => { const part = l.slice(0, Math.max(0, n)); n -= l.length; if (!part) return; const yy = cy + k * fs * 1.25 + Math.sin(k + a) * 3;
      x.save(); x.translate(cx, yy); x.rotate(-.035 + .01 * Math.sin(a)); x.globalCompositeOperation = 'destination-out'; x.globalAlpha = fade; x.lineWidth = fs * .13; x.lineJoin = 'round'; x.strokeStyle = '#000'; x.strokeText(part, 0, 0); x.fillStyle = '#000'; x.fillText(part, 0, 0);
      x.globalCompositeOperation = 'source-over'; x.globalAlpha = .85 * fade; x.fillStyle = 'rgba(10,22,44,1)'; x.fillText(part, 0, 0); x.restore(); }); x.globalAlpha = 1; }
}
