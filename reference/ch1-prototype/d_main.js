/* ===== main loop, controls ===== */
let lastNow = 0, prevT = ST.T, uiTimer = 0;
function seek(t) { ST.T = clamp(t, 0, DUR - .01); prevT = ST.T; audioStopClips(); if (ST.playing) audioStartClips(ST.T); }
function setPlaying(p) { ST.playing = p; if (AU.ready) { if (p) { AU.ctx.resume(); audioStartClips(ST.T); } else { audioStopClips(); AU.ctx.suspend(); } } $('bplay').textContent = p ? 'Pause' : 'Play'; $('paused').style.opacity = (!p && ST.started && ST.T < DUR - 2) ? 1 : 0; }
function tick(now) {
  requestAnimationFrame(tick); const dt = Math.min(.1, (now - lastNow) / 1000 || 0); lastNow = now; prevT = ST.T;
  if (ST.playing) { ST.T += dt; if (ST.T >= DUR - .02) { ST.T = DUR - .02; setPlaying(false); } }
  try { W3.frame(ST.T); hudUpdate(ST.T, dt); audioUpdate(ST.T, prevT); } catch (e) { if (!window.__err) { window.__err = e; console.error(e); } }
}
function camCycle() { ST.camOverride = ST.camOverride === null ? 'cockpit' : ST.camOverride === 'cockpit' ? 'chase' : null; $('bcam').textContent = 'Camera: ' + (ST.camOverride || 'auto'); }
function fullscreen() { const el = document.documentElement; try { if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document); else { const p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el); if (p && p.catch) p.catch(() => { }); } } catch (e) { } }
function wake() { document.body.classList.remove('idle'); clearTimeout(uiTimer); uiTimer = setTimeout(() => { if (ST.playing) document.body.classList.add('idle'); }, 2600); }
async function start() {
  const b = $('bstart'); if (b.disabled) return; b.disabled = true; ST.ftp = clamp(parseInt($('ftp').value, 10) || 250, 80, 600); try { localStorage.setItem('or_ftp', ST.ftp); } catch (e) { }
  try { await audioInit(p => { b.textContent = 'Loading sound ' + Math.round(p * 100) + '%'; }); } catch (e) { console.error(e); }
  $('start').style.display = 'none'; ST.started = true; setPlaying(true); wake();
  if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => { });
}
function boot() {
  try { const f = localStorage.getItem('or_ftp'); if (f) $('ftp').value = f; } catch (e) { }
  hudInit(); worldInit();
  $('bstart').onclick = start; $('bplay').onclick = () => setPlaying(!ST.playing); $('bcam').onclick = camCycle; $('bfull').onclick = fullscreen; $('bjump').onclick = () => { $('jump').hidden = !$('jump').hidden; };
  $('bmute').onclick = () => { ST.muted = !ST.muted; $('bmute').textContent = ST.muted ? 'Sound off' : 'Sound on'; }; $('bins').onclick = () => { ST.inserts = !ST.inserts; $('bins').textContent = 'Storyboard cuts: ' + (ST.inserts ? 'on' : 'off'); };
  $('bback').onclick = () => seek(ST.T - 10); $('bfwd').onclick = () => seek(ST.T + 10); $('bagain').onclick = () => { ST.kj = 0; ST.pw = 0; seek(0); setPlaying(true); };
  addEventListener('mousemove', wake); addEventListener('touchstart', wake);
  addEventListener('keydown', e => { if (!ST.started || e.target.tagName === 'INPUT') return; const k = e.key.toLowerCase(); wake();
    if (k === ' ') { e.preventDefault(); setPlaying(!ST.playing); } else if (k === 'arrowright') seek(ST.T + (e.shiftKey ? 60 : 10)); else if (k === 'arrowleft') seek(ST.T - (e.shiftKey ? 60 : 10));
    else if (k === 'c') camCycle(); else if (k === 'f') fullscreen(); else if (k === 'm') $('bmute').click(); else if (k === 's') $('bins').click(); else if (k === 'j') $('bjump').click(); else if (k === 'escape') $('jump').hidden = true; });
  if (ST.still) { $('start').style.display = 'none'; ST.started = true; }
  if (Q.has('auto')) start();
  requestAnimationFrame(tick);
}
boot();
