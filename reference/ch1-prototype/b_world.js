/* ===== world: three.js scenes ===== */
const W3 = {}; window.W3 = W3;
const sTunEnd = S(497), sStart = S(668), sWarp = S(770), sCol1 = S(1322) + 900, sImp2 = S(1421), sBig = S(1548), sDown = S(1592), sWave = S(1620), sCrest = S(1862), sIce0 = S(990);
const IMPACTS = [[1232, .5], [1410, 1.2], [1534, 1.8], [770, 1.0], [772.5, 2.2], [1862, 1.3]];
const GLSL_NOISE = `
float h31(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float n3(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(mix(mix(h31(i),h31(i+vec3(1,0,0)),f.x),mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*n3(vec3(p,1.7));p=p*2.03+17.;a*=.5;}return s;}`;

/* environment keys: everything numeric, linearly blended */
const ENVK = [
  [300, { top: [.02, .03, .07], bot: [.03, .05, .1], fog: [.035, .055, .1], dens: .0042, stars: 1, pRad: .07, pDir: [.02, .015, -1], night: 0, haze: 0, sun: 1 }],
  [497, { top: [.02, .03, .07], bot: [.03, .05, .1], fog: [.035, .055, .1], dens: .0042, stars: 1, pRad: .08, pDir: [.02, .015, -1], night: 0, haze: 0, sun: 1 }],
  [506, { top: [.008, .01, .03], bot: [.02, .02, .06], fog: [0, 0, 0], dens: 0, stars: 1, pRad: .2, pDir: [.55, .2, -1], night: 0, haze: 0, sun: 1 }],
  [780, { top: [.008, .01, .03], bot: [.02, .02, .06], fog: [0, 0, 0], dens: 0, stars: 1, pRad: .2, pDir: [.55, .2, -1], night: 0, haze: 0, sun: 1 }],
  [985, { top: [.6, .67, .82], bot: [.85, .89, .96], fog: [.85, .89, .96], dens: .006, stars: 0, pRad: .5, pDir: [.18, .5, -1], night: 0, haze: 1, sun: .8 }],
  [1050, { top: [.6, .67, .82], bot: [.85, .89, .96], fog: [.85, .89, .96], dens: .004, stars: 0, pRad: .5, pDir: [.18, .5, -1], night: 0, haze: 1, sun: .8 }],
  [1110, { top: [.5, .6, .82], bot: [.84, .89, .97], fog: [.84, .89, .97], dens: .0011, stars: 0, pRad: .55, pDir: [.18, .5, -1], night: 0, haze: .85, sun: .9 }],
  [1172, { top: [.2, .3, .68], bot: [.78, .85, .98], fog: [.76, .83, .97], dens: .00011, stars: .15, pRad: .66, pDir: [.2, .52, -1], night: 0, haze: .3, sun: 1 }],
  [1316, { top: [.2, .3, .68], bot: [.78, .85, .98], fog: [.78, .84, .97], dens: .00013, stars: .15, pRad: .66, pDir: [.2, .52, -1], night: 0, haze: .3, sun: 1 }],
  [1323, { top: [.9, .91, .94], bot: [.94, .95, .97], fog: [.93, .94, .96], dens: .011, stars: 0, pRad: .66, pDir: [.2, .52, -1], night: 0, haze: 1, sun: .7 }],
  [1404, { top: [.9, .91, .94], bot: [.94, .95, .97], fog: [.93, .94, .96], dens: .011, stars: 0, pRad: .66, pDir: [.2, .52, -1], night: 0, haze: 1, sun: .7 }],
  [1411, { top: [.2, .3, .68], bot: [.8, .85, .98], fog: [.78, .84, .97], dens: .00014, stars: .15, pRad: .66, pDir: [.2, .52, -1], night: 0, haze: .3, sun: 1 }],
  [1530, { top: [.2, .3, .68], bot: [.8, .85, .98], fog: [.78, .84, .97], dens: .00014, stars: .15, pRad: .66, pDir: [.2, .52, -1], night: 0, haze: .3, sun: 1 }],
  [1540, { top: [.24, .28, .62], bot: [.9, .8, .9], fog: [.86, .8, .9], dens: .0005, stars: .1, pRad: .66, pDir: [.2, .52, -1], night: 0, haze: .5, sun: .9 }],
  [1620, { top: [.2, .26, .64], bot: [.92, .78, .88], fog: [.84, .8, .93], dens: .00016, stars: .2, pRad: .68, pDir: [.2, .52, -1], night: 0, haze: .35, sun: 1 }],
  [1858, { top: [.16, .22, .6], bot: [.9, .8, .92], fog: [.84, .82, .95], dens: .00018, stars: .25, pRad: .7, pDir: [.2, .5, -1], night: 0, haze: .35, sun: 1 }],
  [1866, { top: [.86, .86, .93], bot: [.92, .9, .96], fog: [.9, .89, .95], dens: .007, stars: 0, pRad: .7, pDir: [.2, .5, -1], night: 0, haze: 1, sun: .8 }],
  [1905, { top: [.7, .66, .88], bot: [.86, .8, .95], fog: [.8, .76, .93], dens: .004, stars: 0, pRad: .8, pDir: [.2, .1, -1], night: 0, haze: 1, sun: .8 }],
  [1936, { top: [.01, .012, .04], bot: [.05, .04, .14], fog: [.05, .04, .14], dens: 0, stars: 1, pRad: 1.0, pDir: [.25, -.9, -1], night: .6, haze: 0, sun: .6 }],
  [1956, { top: [.006, .008, .028], bot: [.02, .02, .07], fog: [0, 0, 0], dens: 0, stars: 1, pRad: 1.22, pDir: [.3, -1.25, -.7], night: 1, haze: 0, sun: .35 }],
  [2055, { top: [.006, .008, .028], bot: [.02, .02, .07], fog: [0, 0, 0], dens: 0, stars: 1, pRad: 1.2, pDir: [.5, -1.5, -.5], night: 1, haze: 0, sun: .35 }],
  [2100, { top: [.006, .008, .028], bot: [.03, .02, .08], fog: [0, 0, 0], dens: 0, stars: 1, pRad: 1.1, pDir: [.8, -2.2, -.3], night: 1, haze: 0, sun: .4 }]
];
function envAt(t) {
  let a = ENVK[0], b = ENVK[0]; for (let i = 0; i < ENVK.length; i++) { if (ENVK[i][0] <= t) { a = ENVK[i]; b = ENVK[Math.min(i + 1, ENVK.length - 1)]; } }
  const u = b[0] > a[0] ? clamp((t - a[0]) / (b[0] - a[0])) : 0, o = {};
  for (const k in a[1]) { const x = a[1][k], y = b[1][k]; o[k] = Array.isArray(x) ? x.map((v, i) => lerp(v, y[i], u)) : lerp(x, y, u); } return o;
}
const FOVK = [[300, 62], [478, 64], [500, 94], [540, 102], [570, 88], [655, 84], [661, 102], [680, 92], [701, 106], [720, 94], [741, 110], [770, 122], [772, 130], [990, 58], [1050, 60], [1110, 72], [1170, 80], [1290, 82], [1295, 102], [1320, 98], [1326, 84], [1410, 86], [1414, 106], [1440, 100], [1448, 86], [1530, 88], [1535, 110], [1560, 104], [1568, 66], [1612, 64], [1622, 84], [1860, 98], [1865, 118], [1890, 100], [1950, 74], [2055, 64], [2090, 52]];
const SHAKEK = [[300, 0], [478, .02], [490, .5], [540, .3], [570, .1], [655, .08], [660, .9], [680, .4], [700, 1], [720, .45], [740, 1.1], [770, 1.6], [776, .4], [780, 0], [1050, 0], [1110, .08], [1290, .12], [1295, .55], [1320, .4], [1410, .3], [1414, .9], [1440, .5], [1446, .2], [1530, .22], [1535, 1.1], [1560, .6], [1568, .05], [1618, .05], [1624, .45], [1800, .7], [1858, .9], [1864, 1.7], [1890, .5], [1930, .08], [2100, .03]];

function worldInit() {
  const canvas = $('gl');
  const R = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' }); W3.R = R;
  W3.dpr = Math.min(window.devicePixelRatio || 1, parseFloat(Q.get('dpr') || '1.5'));
  const scene = W3.scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x000000, 0);
  const cam = W3.cam = new THREE.PerspectiveCamera(70, 1, .5, 400000);
  const hemi = W3.hemi = new THREE.HemisphereLight(0xcfe0ff, 0x3a3a5a, .85); scene.add(hemi);
  const sun = W3.sun = new THREE.DirectionalLight(0xfff2e0, 1); sun.position.set(.5, .7, -.3); scene.add(sun);
  const phong = (c, o = {}) => new THREE.MeshPhongMaterial(Object.assign({ color: c, flatShading: true, shininess: 30 }, o));
  const basic = (c, o = {}) => new THREE.MeshBasicMaterial(Object.assign({ color: c }, o));
  const D = new THREE.Object3D();
  const put = (m, i, x, y, z, sx, sy, sz, rx, ry, rz) => { D.position.set(x, y, z); D.scale.set(sx, sy, sz); D.rotation.set(rx || 0, ry || 0, rz || 0); D.updateMatrix(); m.setMatrixAt(i, D.matrix); };
  const inst = (geo, mat, n) => { const m = new THREE.InstancedMesh(geo, mat, n); m.frustumCulled = false; m.count = 0; scene.add(m); return m; };
  const done = m => { m.instanceMatrix.needsUpdate = true; };

  /* ---------- sky ---------- */
  const skyU = W3.skyU = { uTop: { value: new THREE.Color() }, uBot: { value: new THREE.Color() }, uPDir: { value: new THREE.Vector3(0, 0, -1) }, uSun: { value: new THREE.Vector3(.6, .5, .6).normalize() },
    uStars: { value: 1 }, uPRad: { value: .3 }, uTime: { value: 0 }, uNight: { value: 0 }, uHaze: { value: 0 }, uLight: { value: 0 } };
  const sky = W3.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({ uniforms: skyU, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    vertexShader: `varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `precision highp float;varying vec3 vDir;uniform vec3 uTop,uBot,uPDir,uSun;uniform float uStars,uPRad,uTime,uNight,uHaze,uLight;${GLSL_NOISE}
    void main(){vec3 d=normalize(vDir);vec3 col=mix(uBot,uTop,smoothstep(-.04,.55,d.y));
      vec3 sp=d*190.;vec3 ip=floor(sp);float st=h31(ip);float star=smoothstep(.985,1.,st)*smoothstep(.5,.05,length(fract(sp)-.5));col+=uStars*star*mix(vec3(.8,.85,1.),vec3(1.,.85,.9),h31(ip+3.))*1.8;
      col+=uStars*vec3(.16,.08,.3)*pow(fbm(d.xy*3.+d.z*2.),3.)*1.4;
      float ca=dot(d,uPDir);float ang=acos(clamp(ca,-1.,1.));
      if(ang<uPRad*1.1){float r=ang/uPRad;
        if(r<1.){vec3 ax=normalize(cross(vec3(0.,1.,0.),uPDir)+vec3(1e-4,0.,0.));vec3 ay=cross(uPDir,ax);vec3 off=d-uPDir*ca;float sr=sin(uPRad);float px=dot(off,ax)/sr,py=dot(off,ay)/sr;float pz=sqrt(max(0.,1.-px*px-py*py));
          vec3 n=ax*px+ay*py-uPDir*pz;float lat=py*.95+px*.26;
          float b=n3(vec3(lat*8.,px*1.2+uTime*.004,3.))*.5+n3(vec3(lat*24.,px*3.,7.))*.3+sin(lat*34.+n3(vec3(px*5.,lat*5.,1.))*3.)*.14;
          vec3 pc=mix(vec3(.26,.17,.5),vec3(.72,.56,.93),smoothstep(.15,.75,b));pc=mix(pc,vec3(.96,.82,.92),smoothstep(.7,.95,b)*.55);
          float lit=clamp(dot(n,uSun)*.55+.78,0.,1.2);lit=mix(lit,.035,uNight);vec3 c=pc*lit;
          c+=uLight*uNight*vec3(.75,.65,1.)*smoothstep(.8,1.,n3(vec3(px*7.,py*7.,floor(uTime*6.))))*smoothstep(.72,.9,n3(vec3(floor(uTime*2.5),px*2.,py*2.)));
          float rim=pow(r,7.);c+=vec3(.55,.36,.95)*rim*(.3+.5*clamp(dot(n,uSun)+.7,0.,1.));
          c=mix(c,uTop*.6+vec3(.45,.4,.6),uHaze*.45*(1.-uNight));col=mix(col,c,mix(1.,.6,uHaze)*smoothstep(1.,.985,r));}
        else col+=vec3(.5,.32,.95)*(1.-smoothstep(1.,1.1,r))*.4*(1.-uHaze*.7);}
      col=mix(col,uBot,uHaze*.8*exp(-abs(d.y)*5.));gl_FragColor=vec4(col,1.);}` }));
  sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);

  /* ---------- streaks (speed lines) ---------- */
  const NS = 2600, sp = new Float32Array(NS * 6), se = new Float32Array(NS * 2), sr = new Float32Array(NS * 2);
  for (let i = 0; i < NS; i++) { const x = hash(i * 1.1) * 2 - 1, y = hash(i * 2.3 + 9) * 2 - 1, z = hash(i * 3.7 + 5); for (let k = 0; k < 2; k++) { sp.set([x, y, z], i * 6 + k * 3); se[i * 2 + k] = k; sr[i * 2 + k] = hash(i * 5.1); } }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('aEnd', new THREE.BufferAttribute(se, 1)); sg.setAttribute('aRnd', new THREE.BufferAttribute(sr, 1));
  const stU = W3.stU = { uS: { value: 0 }, uL: { value: 1000 }, uLen: { value: 1 }, uSX: { value: 100 }, uSY: { value: 100 }, uY0: { value: 0 }, uCol: { value: new THREE.Color(1, 1, 1) }, uA: { value: 1 }, uCX: { value: 0 } };
  const streaks = W3.streaks = new THREE.LineSegments(sg, new THREE.ShaderMaterial({ uniforms: stU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: `attribute float aEnd,aRnd;uniform float uS,uL,uLen,uSX,uSY,uY0,uCX;varying float vA;void main(){float z=mod(position.z*uL-uS,uL);float zz=z+aEnd*uLen*(.4+aRnd);
      vec3 w=vec3(position.x*uSX+uCX,uY0+position.y*uSY,-zz);vA=(1.-aEnd*.9)*smoothstep(uL,uL*.55,z)*smoothstep(0.,uL*.02,z)*(.35+.65*aRnd);gl_Position=projectionMatrix*viewMatrix*vec4(w,1.);}`,
    fragmentShader: `precision mediump float;uniform vec3 uCol;uniform float uA;varying float vA;void main(){gl_FragColor=vec4(uCol,vA*uA);}` }));
  streaks.frustumCulled = false; scene.add(streaks);

  /* ---------- soft sprite texture ---------- */
  const softTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.35, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
  const sprite = (color, add, fog = true) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color, transparent: true, depthWrite: false, fog, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending })); s.visible = false; scene.add(s); return s; };

  /* ---------- ship ---------- */
  function makeShip() {
    const g = new THREE.Group(), white = phong(0xe6ebf5, { shininess: 70 }), pink = phong(0xcf2a82, { shininess: 60 }), dark = phong(0x151a26, { shininess: 90 });
    const add = (geo, mat, x, y, z, rx, ry, rz, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, rz || 0); m.scale.set(sx, sy, sz); g.add(m); return m; };
    add(new THREE.CylinderGeometry(.85, 1.25, 7, 8), white, 0, 0, 0, Math.PI / 2); add(new THREE.ConeGeometry(.85, 4.2, 8), white, 0, 0, -5.6, -Math.PI / 2);
    add(new THREE.SphereGeometry(.8, 10, 8), dark, 0, .7, -2.2, 0, 0, 0, 1, .7, 2.3); add(new THREE.BoxGeometry(7.6, .16, 2.6), white, 0, -.15, 1.3);
    add(new THREE.BoxGeometry(1.2, .2, 3.4), pink, 0, .92, .8);
    for (const sx of [-1, 1]) { add(new THREE.CylinderGeometry(.72, .95, 4.6, 10), pink, sx * 2.5, 0, 1.6, Math.PI / 2); add(new THREE.BoxGeometry(.16, 1.7, 1.9), pink, sx * 2.5, 1.0, 2.9, .25); add(new THREE.BoxGeometry(2.2, .12, 1.2), pink, sx * 4.6, -.1, 1.8, 0, sx * -.25, 0); }
    g.glows = [-1, 1].map(sx => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: 0x9fd8ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); s.position.set(sx * 2.5, 0, 4.2); g.add(s); return s; });
    g.exh = [-1, 1].map(sx => add(new THREE.ConeGeometry(.6, 1, 8, 1, true), basic(0x8fd0ff, { transparent: true, opacity: .5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }), sx * 2.5, 0, 4, Math.PI / 2));
    return g;
  }
  const ship = W3.ship = makeShip(); scene.add(ship);
  const downed = W3.downed = makeShip(); downed.glows.forEach(s => s.visible = false); downed.exh.forEach(s => s.visible = false); scene.add(downed);
  const decalTex = (() => { const c = document.createElement('canvas'); c.width = 512; c.height = 512; const x = c.getContext('2d'); x.fillStyle = '#10141f'; x.fillRect(0, 0, 512, 512); x.strokeStyle = '#ff4da0'; x.lineWidth = 16; x.lineJoin = 'round';
    x.beginPath(); x.arc(256, 230, 130, Math.PI * 1.02, Math.PI * 1.98); x.lineTo(386, 300); x.lineTo(126, 300); x.closePath(); x.stroke(); x.beginPath(); x.rect(196, 210, 120, 56); x.stroke();
    x.lineWidth = 9; x.beginPath(); x.moveTo(250, 100); x.lineTo(232, 150); x.lineTo(268, 176); x.lineTo(240, 215); x.stroke(); x.fillStyle = '#ff4da0'; x.font = '700 58px "DIN Condensed","Avenir Next Condensed",Impact,sans-serif'; x.textAlign = 'center'; x.fillText('SAFETY LAST', 256, 384); x.font = '600 34px "DIN Condensed","Avenir Next Condensed",Impact,sans-serif'; x.fillText('· DIVERS ·', 256, 440); return new THREE.CanvasTexture(c); })();
  const wingDecal = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), basic(0xffffff, { map: decalTex })); wingDecal.rotation.x = -Math.PI / 2; wingDecal.position.set(-2.2, -.04, 1.3); downed.add(wingDecal);
  downed.lamps = [[0, 1.3, -2], [-3.6, .1, 1.4], [3.6, .1, 1.4]].map(p => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: 0xffb060, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); s.position.set(p[0], p[1], p[2]); downed.add(s); return s; });

  /* ---------- tunnel (launch rails) ---------- */
  const box = new THREE.BoxGeometry(1, 1, 1);
  const tWall = inst(box, phong(0x161d2b), 420), tRib = inst(box, phong(0x2b3650), 420), tLight = inst(box, basic(0xbfeaff), 420), tGuide = inst(box, basic(0xff3d9a), 220);
  const doorL = new THREE.Mesh(box, phong(0x1a2233)), doorR = new THREE.Mesh(box, phong(0x1a2233)); scene.add(doorL, doorR);
  const TC = 20;
  function tunnelUpdate(t, s) {
    const on = t >= 300 && s < sTunEnd + 200; tWall.visible = tRib.visible = tLight.visible = tGuide.visible = doorL.visible = doorR.visible = on; if (!on) return;
    let nw = 0, nr = 0, nl = 0, ng = 0; const i0 = Math.floor(s / TC) - 1, i1 = Math.min(Math.floor(sTunEnd / TC), i0 + 60);
    for (let i = i0; i <= i1; i++) { const z = -(i * TC - s) - TC / 2;
      put(tWall, nw++, -20, 9, z, .8, 24, TC, 0, 0, 0); put(tWall, nw++, 20, 9, z, .8, 24, TC); put(tWall, nw++, 0, 21, z, 40, .8, TC); put(tWall, nw++, 0, -3, z, 40, .8, TC);
      const zr = -(i * TC - s); put(tRib, nr++, -19, 9, zr, 2, 24, 1.6); put(tRib, nr++, 19, 9, zr, 2, 24, 1.6); put(tRib, nr++, 0, 20, zr, 40, 2, 1.6);
      put(tLight, nl++, -18.4, 15, zr, .3, .5, 6); put(tLight, nl++, 18.4, 15, zr, .3, .5, 6); if (i % 3 === 0) put(tLight, nl++, 0, 19.2, zr, 14, .25, .6);
      put(tGuide, ng++, -5, -2.5, zr, .35, .15, 9); put(tGuide, ng++, 5, -2.5, zr, .35, .15, 9); }
    tWall.count = nw; tRib.count = nr; tLight.count = nl; tGuide.count = ng; done(tWall); done(tRib); done(tLight); done(tGuide);
    const open = ss(420, 436, t), zd = Math.max(-(sTunEnd - s), -1150); doorL.position.set(-10 - 20.5 * open, 9, zd); doorR.position.set(10 + 20.5 * open, 9, zd); doorL.scale.set(20, 24, 2); doorR.scale.set(20, 24, 2); doorL.visible = doorR.visible = on && zd < 2;
  }

  /* ---------- space: station, rings, racers, start line, warp ring ---------- */
  const station = W3.station = new THREE.Group(); scene.add(station);
  { const hull = phong(0x39445e, { shininess: 20 }), hull2 = phong(0x56617d);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(700, 700, 9000, 14), hull); core.rotation.z = Math.PI / 2; station.add(core);
    for (const [x, r] of [[-2600, 4200], [0, 5200], [2600, 4200]]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 330, 8, 72), hull2); ring.rotation.y = Math.PI / 2; ring.position.x = x; station.add(ring);
      for (let k = 0; k < 6; k++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(160, r * 2, 160), hull); sp.rotation.x = k * Math.PI / 6; sp.position.x = x; station.add(sp); } }
    for (let k = 0; k < 40; k++) { const b = new THREE.Mesh(box, k % 3 ? hull : hull2); b.scale.set(300 + 900 * hash(k), 200 + 600 * hash(k + 9), 300 + 900 * hash(k + 4)); const a = hash(k + 20) * 6.28; b.position.set((hash(k + 30) - .5) * 8600, Math.cos(a) * 820, Math.sin(a) * 820); station.add(b); }
    const lp = new Float32Array(4200 * 3); for (let i = 0; i < 4200; i++) { const ringI = i % 3, r = [4200, 5200, 4200][ringI], a = hash(i * 1.3) * 6.283, tt = hash(i * 2.7) * 6.283; const rr = r + Math.cos(tt) * 345; lp[i * 3] = [-2600, 0, 2600][ringI] + Math.sin(tt) * 345; lp[i * 3 + 1] = Math.cos(a) * rr; lp[i * 3 + 2] = Math.sin(a) * rr; }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lp, 3)); station.add(new THREE.Points(lg, new THREE.PointsMaterial({ color: 0xffe2b0, size: 2.2, sizeAttenuation: false, fog: false }))); }
  const cRing = inst(new THREE.TorusGeometry(1, .035, 6, 40), basic(0xff4da8, { fog: false }), 60), cRing2 = inst(new THREE.TorusGeometry(1, .035, 6, 40), basic(0x7fe6ff, { fog: false }), 60);
  const NR = 40, racer = inst(new THREE.ConeGeometry(1, 1, 5), phong(0xb9c2d6), NR), rTrail = inst(box, basic(0x9fd4ff, { transparent: true, opacity: .75, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), NR);
  const startLine = new THREE.Group(); scene.add(startLine);
  { const pts = []; const Wd = 3600, Hd = 1800; for (let i = 0; i <= 12; i++) { const x = -Wd / 2 + i * Wd / 12; pts.push(x, -Hd / 2, 0, x, Hd / 2, 0); } for (let j = 0; j <= 6; j++) { const y = -Hd / 2 + j * Hd / 6; pts.push(-Wd / 2, y, 0, Wd / 2, y, 0); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); startLine.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xff5db1, transparent: true, opacity: .8, blending: THREE.AdditiveBlending, fog: false })));
    const c = document.createElement('canvas'); c.width = 1024; c.height = 128; const x = c.getContext('2d'); x.fillStyle = '#ff7cc2'; x.font = '700 92px "DIN Condensed","Avenir Next Condensed",Impact,sans-serif'; x.textAlign = 'center'; x.fillText('MERIDIAN CHAMPIONSHIP · GRID', 512, 96);
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(3600, 450), basic(0xffffff, { map: new THREE.CanvasTexture(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); lab.position.y = 1250; startLine.add(lab); }
  const warp = new THREE.Group(); scene.add(warp);
  const warpU = { uT: { value: 0 }, uK: { value: 0 } };
  { warp.add(new THREE.Mesh(new THREE.TorusGeometry(260, 16, 10, 64), basic(0xe9d8ff, { fog: false }))); warp.add(new THREE.Mesh(new THREE.TorusGeometry(300, 6, 8, 64), basic(0xb070ff, { fog: false })));
    warp.add(new THREE.Mesh(new THREE.CircleGeometry(258, 48), new THREE.ShaderMaterial({ uniforms: warpU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
      vertexShader: `varying vec2 vP;void main(){vP=position.xy/258.;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `precision highp float;varying vec2 vP;uniform float uT,uK;${GLSL_NOISE}void main(){float r=length(vP),a=atan(vP.y,vP.x);float sw=fbm(vec2(a*2.+r*5.-uT*2.,r*4.-uT*3.));vec3 c=mix(vec3(.35,.15,.8),vec3(.8,.9,1.),sw)*(.25+.9*pow(r,3.))+vec3(1.)*uK*(1.-r)*1.5;gl_FragColor=vec4(c,(.35+.65*uK)*smoothstep(1.,.9,r));}` }))); }

  function spaceUpdate(t, s) {
    const on = t >= 496 && t < 780; station.visible = on; cRing.visible = cRing2.visible = racer.visible = rTrail.visible = startLine.visible = on; warp.visible = on && t > 728 && t < 770.05; if (!on) return;
    const bx = t > 660 ? Math.pow(t - 660, 2) * 700 : 0;
    station.position.set(-5200 - (s - sTunEnd) * .0035, 900, 4300 + (s - sTunEnd) * .03); station.rotation.set(.25, .5, t * .004);
    let n1 = 0, n2 = 0; const C = 1500, i0 = Math.max(Math.floor(s / C), Math.ceil((sTunEnd + 1800) / C)), i1 = Math.min(i0 + 26, Math.floor((sStart - 500) / C));
    for (let i = i0; i <= i1; i++) { const z = -(i * C - s); const m = i % 2 ? cRing : cRing2; const k = i % 2 ? n1++ : n2++; put(m, k, -bx + 30 * Math.sin(i * 1.3), 18 * Math.cos(i * .9), z, 95, 95, 95, 0, 0, i); }
    cRing.count = n1; cRing2.count = n2; done(cRing); done(cRing2);
    const vv = speedAt(t);
    for (let i = 0; i < NR; i++) { const side = hash(i * 3.1) > .5 ? 1 : -1; let x = side * (70 + hash(i * 1.7) * 900), y = (hash(i * 2.9) - .5) * 500, z = -(200 + hash(i * 4.3) * 7000) + (t - 540) * (hash(i * 6.1) - .55) * 60;
      if (t > 660) { const q = Math.pow(t - 660, 1.7) * (30 + 60 * hash(i * 7.7)); const a = hash(i * 8.3) * 6.283; x += Math.cos(a) * q - bx * .25; y += Math.sin(a) * q * .6; z -= q * (hash(i * 9.1) - .3) * 2; }
      put(racer, i, x, y, z, 2.2, 9, 2.2, -Math.PI / 2, 0, 0); const tl = 30 + vv * .05; put(rTrail, i, x, y, z + 5 + tl / 2, .5, .5, tl); }
    racer.count = rTrail.count = NR; done(racer); done(rTrail);
    startLine.position.set(-bx, 0, -(sStart - s)); startLine.visible = on && s < sStart;
    if (warp.visible) { const wx = Math.pow(Math.max(0, 769 - t), 2) * 55; warp.position.set(wx, 0, -(sWarp - s)); warp.rotation.z = t * .6; warp.scale.setScalar(9); warpU.uT.value = t; warpU.uK.value = ss(762, 770, t); }
  }

  /* ---------- ice moon ---------- */
  const gU = W3.gU = { uS: { value: 0 }, uFogC: { value: new THREE.Color() }, uFogD: { value: 0 }, uSkyRef: { value: new THREE.Color() }, uCrack: { value: 0 }, uSun: { value: 1 }, uCX: { value: 0 } };
  const iceFrag = `precision highp float;varying vec3 vW;uniform float uS,uFogD,uCrack,uSun;uniform vec3 uFogC,uSkyRef;${GLSL_NOISE}
    void main(){vec2 p=vec2(vW.x,vW.z-uS);float d=length(vW-cameraPosition);float lod=smoothstep(4000.,300.,d);
      float n=fbm(p*.0035),n2=n3(vec3(p*.028,3.));vec3 ice=mix(vec3(.58,.68,.84),vec3(.94,.97,1.),n*.65+n2*.35*lod);
      float cr=1.-abs(n3(vec3(p*.012,5.))*2.-1.);cr=smoothstep(.94,1.,cr);float cr2=1.-abs(n3(vec3(p*.07,9.))*2.-1.);cr2=smoothstep(.95,1.,cr2)*lod;
      ice=mix(ice,vec3(.2,.42,.72),cr*.75);ice=mix(ice,vec3(.35,.55,.8),cr2*.5);
      float melt=smoothstep(.56,.62,fbm(p*.0011+9.));ice=mix(ice,uSkyRef*1.05,melt*.8);
      float stl=n3(vec3(p.x*.7,p.y*.035,2.))*lod;ice*=.82+.36*stl;
      float seam=smoothstep(.75,0.,abs(p.x-7.*sin(p.y*.011)-3.*sin(p.y*.037)))*uCrack;ice=mix(ice,vec3(.04,.1,.2),seam);
      float seam2=smoothstep(.5,0.,abs(abs(p.x)-14.-9.*n3(vec3(p.y*.02,1.,1.))))*uCrack*.7;ice=mix(ice,vec3(.06,.14,.26),seam2);
      ice*=.72+.28*uSun;float f=1.-exp(-d*uFogD);gl_FragColor=vec4(mix(ice,uFogC,f),1.);}`;
  const iceMat = new THREE.ShaderMaterial({ uniforms: gU, fog: false, vertexShader: `varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`, fragmentShader: iceFrag });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1).rotateX(-Math.PI / 2), iceMat); ground.frustumCulled = false; scene.add(ground);
  // frozen wave
  const wave = (() => { const prof = [[0, 0], [-3000, 250], [-6000, 900], [-8500, 2100], [-10200, 3900], [-10900, 5600], [-10700, 6900], [-9900, 7700], [-8800, 8000]], Wd = 90000, pos = [], idx = [];
    const colr = []; prof.forEach((p, i) => { pos.push(-Wd / 2, p[1], p[0], Wd / 2, p[1], p[0]); const c = i / (prof.length - 1), sh = i % 2 ? .93 : 1; colr.push((.5 + .45 * c) * sh, (.62 + .35 * c) * sh, (.85 + .15 * c) * sh, (.5 + .45 * c) * sh, (.62 + .35 * c) * sh, (.85 + .15 * c) * sh); if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false })); m.frustumCulled = false; scene.add(m); return m; })();
  const iceShardMat = phong(0xcfe2fa, { shininess: 90, specular: 0x99aadd });
  const shard = inst(new THREE.ConeGeometry(1, 1, 5).translate(0, .5, 0), iceShardMat, 900), ridge = inst(new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0), phong(0xb9d0ee), 200), gatep = inst(new THREE.ConeGeometry(1, 1, 4).translate(0, .5, 0), phong(0xa8c4ea, { shininess: 100 }), 80);
  const crater = inst(new THREE.TorusGeometry(1, .16, 5, 28).rotateX(Math.PI / 2), phong(0xbcd2ef), 30), wreck = inst(box, basic(0xff7a2a), 60), wreck2 = inst(box, phong(0x2a2f3c), 60);
  const steam = []; for (let i = 0; i < 54; i++) steam.push(sprite(0xf2f4fa, false));
  const glow = []; for (let i = 0; i < 16; i++) glow.push(sprite(0xffa050, true, false));
  const hangarChunk = new THREE.Group(); scene.add(hangarChunk);
  { const m = new THREE.Mesh(box, phong(0x2c3446)); m.scale.set(620, 300, 900); hangarChunk.add(m); const d = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), basic(0xffffff, { map: decalTex, fog: false })); d.position.set(311, 0, 200); d.rotation.y = Math.PI / 2; hangarChunk.add(d);
    for (let k = 0; k < 9; k++) { const b = new THREE.Mesh(box, phong(0x3a445c)); b.scale.set(80 + hash(k) * 240, 60 + hash(k + 3) * 160, 100 + hash(k + 5) * 300); b.position.set((hash(k + 7) - .5) * 640, (hash(k + 8) - .5) * 320, (hash(k + 9) - .5) * 900); hangarChunk.add(b); } }
  const METEORS = [{ a: 1224, b: 1232, s: sCol1, x: 0, size: 420, from: [5200, 9000, 2000] }, { a: 1403, b: 1410, s: sImp2, x: 330, size: 150, from: [-2600, 5200, 3000] }, { a: 1519, b: 1534, s: sBig, x: -1900, size: 1, from: [1600, 5200, 2500], big: 1 }];
  const mBody = METEORS.map(m => { const b = new THREE.Mesh(box, phong(0x2a2f3a)); b.visible = false; scene.add(b); return b; });
  const COLS = [{ s: sCol1, x: 0, t0: 1232, r: 1700, h: 8000, n: 22 }, { s: sImp2, x: 330, t0: 1410, r: 330, h: 1700, n: 14 }, { s: sBig, x: -1900, t0: 1534, r: 400, h: 3600, n: 18 }];
  const CELL = 40;
  function iceUpdate(t, s, env, camX) {
    const on = t >= 984 && t < 1866; ground.visible = on; shard.visible = ridge.visible = gatep.visible = on; crater.visible = on && t > 1380 && t < 1560; wreck.visible = wreck2.visible = on && t > 1300 && t < 1420; wave.visible = on && t >= 1300 && s < sWave + 400 && env.dens < .002; hangarChunk.visible = false;
    if (!on) { steam.forEach(q => q.visible = false); glow.forEach(q => q.visible = false); mBody.forEach(q => q.visible = false); downed.visible = false; return; }
    gU.uS.value = s % 16384; gU.uFogC.value.setRGB(env.fog[0], env.fog[1], env.fog[2]); gU.uFogD.value = env.dens; gU.uSkyRef.value.setRGB(lerp(env.top[0], .6, .4), lerp(env.top[1], .5, .4), lerp(env.top[2], .9, .3)); gU.uSun.value = env.sun;
    gU.uCrack.value = t > 1640 ? clamp((t - 1640) / 60) * (.6 + .4 * Math.sin(t * 3)) : 0;
    const far = t > 1620 ? Math.max(60, sCrest - s) : 60000; ground.scale.set(120000, 1, far + 400); ground.position.set(0, 0, -(far - 400) / 2);
    // scatter
    const weave = t > 1436 && t < 1534, minX = weave ? 70 : 11; let ns = 0, nr = 0, ng = 0; const i0 = Math.floor(s / CELL) - 1, range = Math.min(5200, 2.5 / Math.max(env.dens, .0004)), i1 = i0 + Math.ceil(range / CELL);
    for (let i = i0; i <= i1; i++) { const sw = i * CELL, z = -(sw - s); if (sw < sIce0 + 60 || sw > sCrest - 40) continue; if (sw > sDown - 160 && sw < sDown + 160) continue;
      for (let k = 0; k < 3; k++) { const r = h2(i, k), side = h2(i, k + 5) > .5 ? 1 : -1, x = side * (minX + Math.pow(r, 2.6) * 1300), hgt = 4 + Math.pow(h2(i, k + 9), 3) * 70 * (1 + r * 2), wd = .8 + h2(i, k + 12) * 2.6 + hgt * .04;
        put(shard, ns++, x, -.5, z - h2(i, k + 3) * CELL, wd, hgt, wd, (h2(i, k + 14) - .5) * .5, h2(i, k + 15) * 6, (h2(i, k + 16) - .5) * .6); }
      if (i % 4 === 0 && hash(i * .77) > .35) { const side = hash(i * 1.9) > .5 ? 1 : -1; put(ridge, nr++, side * (minX + 30 + hash(i * 2.3) * 500), -.3, z, 60 + hash(i * 3.1) * 240, 2 + hash(i * 4.7) * 9, 5 + hash(i * 5.3) * 14, 0, (hash(i * 6.1) - .5) * 1.2, 0); }
      if (!weave && i % 7 === 0 && hash(i * .31) > .4) { const gap = 13 + hash(i * .9) * 10, hh = 40 + hash(i * 1.1) * 90; put(gatep, ng++, -gap, -.5, z, 5, hh, 5, 0, 0, .12); put(gatep, ng++, gap, -.5, z, 5, hh * (.6 + hash(i) * .6), 5, 0, .7, -.12);
        if (ST.playing && window.AU && AU.ready && W3.lastS !== undefined && sw >= W3.lastS && sw < s && s - W3.lastS < 400) AU.whoosh(clamp(speedAt(t) / 400)); } }
    shard.count = ns; ridge.count = nr; gatep.count = ng; done(shard); done(ridge); done(gatep);
    // craters (weaving section)
    if (crater.visible) { let nc = 0; const s0 = S(1440), k0 = Math.floor((s - s0) / 500) - 1; for (let k = Math.max(0, k0); k < k0 + 14; k++) { const sc = s0 + (k + .5) * 500; if (sc > S(1530)) break; const Rr = 120 + h2(k, 3) * 70, side = k % 2 ? 1 : -1; put(crater, nc++, side * Rr * .92, -2, -(sc - s), Rr, Rr * .3, Rr); } crater.count = nc; done(crater); }
    // wreckage inside the steam
    if (wreck.visible) { let nw = 0; const c0 = Math.floor(s / 260) - 1; for (let i = c0; i < c0 + 9; i++) { const sw = i * 260; if (sw < S(1322) || sw > S(1406)) continue; const side = hash(i * 2.1) > .5 ? 1 : -1, x = side * (26 + hash(i * 3.3) * 110), sc = 14 + hash(i * 4.1) * 50, y = hash(i * 5.7) * 30;
        put(wreck, nw, x, y, -(sw - s), sc * .5, sc, sc * .3, hash(i) * 3, hash(i + 1) * 3, hash(i + 2) * 3); put(wreck2, nw, x + 3, y + 2, -(sw - s) - 4, sc * 1.4, sc * .8, sc * 1.2, hash(i) * 3 + .3, hash(i + 1) * 3, hash(i + 2) * 3); nw++; } wreck.count = wreck2.count = nw; done(wreck); done(wreck2); }
    wave.position.set(0, -20, -(sWave - s)); { const k = clamp(1.15 - (sWave - s) / 45000, .14, 1); wave.material.color.setRGB(lerp(env.fog[0] * 1.6, 1, k), lerp(env.fog[1] * 1.45, 1, k), lerp(env.fog[2] * 1.1, 1, k)); }
    // meteors
    let gi = 0; METEORS.forEach((m, k) => { const b = mBody[k]; const vis = t >= m.a && t < m.b; b.visible = vis && !m.big; if (m.big) hangarChunk.visible = t >= m.a && t < m.b + 40;
      const u = clamp((t - m.a) / (m.b - m.a)), ex = m.x, ez = -(m.s - s), px = ex + m.from[0] * (1 - u), py = m.from[1] * (1 - u) * (1 - u * .15) + (m.big ? 110 : 0), pz = ez - m.from[2] * (1 - u);
      if (m.big) { hangarChunk.position.set(px, t >= m.b ? 60 : py, t >= m.b ? ez : pz); hangarChunk.rotation.set(t >= m.b ? .5 : u * 1.2 - .7, .5 + (t >= m.b ? 0 : (1 - u) * .8), t >= m.b ? .35 : (1 - u) * .9); }
      else if (vis) { b.position.set(px, py, pz); b.scale.set(m.size, m.size * .6, m.size * 1.4); b.rotation.set(t, t * .7, 0); }
      if (vis) for (let j = 0; j < 5 && gi < glow.length; j++) { const g = glow[gi++], back = j * .035; g.visible = true; const sz = (m.big ? 1100 : m.size * 5) * (1 - j * .15); g.scale.set(sz, sz, 1);
        g.position.set(px + m.from[0] * back, py + m.from[1] * back * 1.1, pz - m.from[2] * back); g.material.opacity = .9 - j * .16; g.material.color.setHex(j === 0 ? 0xfff0c8 : 0xff8a3a); } });
    for (; gi < glow.length; gi++) glow[gi].visible = false;
    // steam columns
    let si = 0; COLS.forEach((c, ci) => { const age = t - c.t0; if (age < 0) return; const grow = 1 - Math.exp(-age / (ci === 0 ? 14 : 5)), z0 = -(c.s - s); if (z0 > 3000) return;
      for (let j = 0; j < c.n && si < steam.length; j++) { const q = steam[si++], u = j / c.n, hgt = u * c.h * grow, rr = c.r * (.55 + u * 1.3) * (.6 + .4 * grow); q.visible = true; q.position.set(c.x + Math.sin(j * 2.4 + t * .05) * rr * .35 + u * c.h * .12, hgt + rr * .3, z0 + Math.cos(j * 1.7) * rr * .3);
        q.scale.set(rr * 2.3, rr * 2.3, 1); q.material.opacity = .78 * clamp(age / 2) * (1 - u * .35); q.material.color.setRGB(.96 - ci * .02, .96 - u * .04, .99); q.material.rotation = j + t * .01; } });
    for (; si < steam.length; si++) steam[si].visible = false;
    // downed ship
    downed.visible = s > sDown - 3000 && s < sDown + 400; if (downed.visible) { downed.position.set(30, 1.5, -(sDown - s)); downed.rotation.set(.1, 2.2, .34); downed.scale.setScalar(1.6);
      const seq = '1010100011101110111000101010000000', bit = seq[Math.floor(t * 3.2) % seq.length] === '1'; downed.lamps.forEach((l, k) => { l.scale.setScalar(bit ? 4.5 : .6); l.material.opacity = bit ? 1 : .25; });
      const p = new THREE.Vector3(30, 5, -(sDown - s)).project(cam); W3.tagPos = (p.z < 1 && Math.abs(p.x) < 1.1) ? { x: (p.x * .5 + .5) * innerWidth, y: (-p.y * .5 + .5) * innerHeight } : null; } else W3.tagPos = null;
  }

  /* ---------- the gate ---------- */
  const gate = new THREE.Group(); scene.add(gate); const gateU = { uT: { value: 0 } };
  { gate.add(new THREE.Mesh(new THREE.TorusGeometry(4300, 420, 10, 90), phong(0x59648e, { shininess: 60, specular: 0x8877cc })));
    for (let k = 0; k < 36; k++) { const a = k / 36 * 6.283, b = new THREE.Mesh(box, phong(k % 2 ? 0x6a76a4 : 0x434c70)); b.scale.set(260 + 300 * hash(k), 500 + 700 * hash(k + 5), 700 + 500 * hash(k + 8)); b.position.set(Math.cos(a) * 4500, Math.sin(a) * 4500, 0); b.rotation.z = a; gate.add(b); }
    const lp = []; for (let i = 0; i < 700; i++) { const a = hash(i * 1.9) * 6.283, r = 4300 + (hash(i * 2.3) - .5) * 900; lp.push(Math.cos(a) * r, Math.sin(a) * r, 430 * (hash(i * 3.3) - .2)); }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); gate.add(new THREE.Points(lg, new THREE.PointsMaterial({ color: 0xd9b8ff, size: 2, sizeAttenuation: false, fog: false })));
    gate.add(new THREE.Mesh(new THREE.CircleGeometry(4000, 64), new THREE.ShaderMaterial({ uniforms: gateU, fog: false, transparent: true, depthWrite: false,
      vertexShader: `varying vec2 vP;void main(){vP=position.xy/4000.;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `precision highp float;varying vec2 vP;uniform float uT;${GLSL_NOISE}void main(){float r=length(vP),a=atan(vP.y,vP.x);
        float cl=fbm(vec2(cos(a),sin(a))*2.2+r*3.-uT*.06)+.5*fbm(vP*6.+uT*.03);vec3 c=mix(vec3(.16,.06,.34),vec3(.78,.55,1.),smoothstep(.35,.95,cl))*(.35+.8*smoothstep(.3,1.,r));
        c+=vec3(.9,.8,1.)*exp(-pow((r-.47)*11.,2.))*1.3;c+=vec3(.5,.7,1.)*exp(-pow((r-.52)*26.,2.))*.7;
        float eye=smoothstep(.45,.4,r);vec3 pup=vec3(.01,.012,.03)+vec3(.25,.3,.6)*pow(max(0.,1.-length(vP-vec2(-.12,.14))*4.2),2.)+vec3(.9)*pow(max(0.,1.-length(vP-vec2(-.15,.17))*11.),3.);
        c=mix(c,pup,eye);gl_FragColor=vec4(c,smoothstep(1.,.97,r));}` }))); }

  /* ---------- post ---------- */
  const rt = W3.rt = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true });
  const pU = W3.pU = { tD: { value: rt.texture }, uBlur: { value: 0 }, uCA: { value: 0 }, uVig: { value: .5 }, uFlash: { value: 0 }, uFade: { value: 1 }, uGlitch: { value: 0 }, uTime: { value: 0 }, uGrain: { value: .04 }, uC: { value: new THREE.Vector2(.5, .5) }, uTint: { value: new THREE.Color(1, 1, 1) } };
  const pScene = new THREE.Scene(), pCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  pScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: pU, depthTest: false, depthWrite: false,
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader: `precision highp float;varying vec2 vUv;uniform sampler2D tD;uniform float uBlur,uCA,uVig,uFlash,uFade,uGlitch,uTime,uGrain;uniform vec2 uC;uniform vec3 uTint;
    void main(){vec2 uv=vUv;if(uGlitch>0.){float band=floor(uv.y*26.+uTime*13.);float r=fract(sin(band*91.7+floor(uTime*17.)*3.1)*4375.5);uv.x+=(r-.5)*.3*uGlitch*step(.55,r);}
      vec2 d=uv-uC;float l=length(d);vec3 c=vec3(0.);float tot=0.;float jit=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
      for(int i=0;i<10;i++){float k=(float(i)+jit)/10.;float sc=1.-uBlur*.5*k*smoothstep(.02,.75,l);vec2 u2=uC+d*sc;float ca=uCA*l*.03;
        c+=vec3(texture2D(tD,u2+d*ca).r,texture2D(tD,u2).g,texture2D(tD,u2-d*ca).b);tot+=1.;}
      c/=tot;c*=1.-uVig*l*l*1.5;c*=uTint;c+=uFlash;c+=(fract(sin(dot(uv+fract(uTime),vec2(12.9898,78.233)))*43758.5)-.5)*uGrain;gl_FragColor=vec4(c*uFade,1.);}` })));

  function resize() { const w = innerWidth, h = innerHeight; R.setPixelRatio(W3.dpr); R.setSize(w, h, false); rt.setSize(Math.floor(w * W3.dpr), Math.floor(h * W3.dpr)); cam.aspect = w / h; cam.updateProjectionMatrix(); if (HUD.g) drawGraph(); }
  addEventListener('resize', resize); resize();

  const col = new THREE.Color();
  W3.frame = function (t) {
    const s = S(t), v = speedAt(t), env = envAt(Math.max(300, t)), mode = camMode(t), tp = targetPct(t);
    const render3d = t >= 300 && !(t >= 780 && t < 984) && t < 2099;
    if (!render3d) { R.setRenderTarget(null); R.setClearColor(0x000000, 1); R.clear(); W3.lastS = s; return; }
    // env
    skyU.uTop.value.setRGB(env.top[0], env.top[1], env.top[2]); skyU.uBot.value.setRGB(env.bot[0], env.bot[1], env.bot[2]); skyU.uStars.value = env.stars; skyU.uPRad.value = env.pRad; skyU.uPDir.value.set(env.pDir[0], env.pDir[1], env.pDir[2]).normalize();
    skyU.uNight.value = env.night; skyU.uHaze.value = env.haze; skyU.uTime.value = t; skyU.uLight.value = t > 1940 ? 1 : 0;
    scene.fog.color.setRGB(env.fog[0], env.fog[1], env.fog[2]); scene.fog.density = env.dens; hemi.intensity = .55 + .4 * env.sun; sun.intensity = env.sun * (t < 500 ? .5 : 1);
    // camera path
    let camX = 0, roll = 0, pitch = 0, camY = 0;
    if (t >= 984 && t < 1866) { camY = 3.4 + .5 * noise1(t * .6) + kf(t, [[984, -1.8], [1050, -1.8], [1066, 3], [1110, 0]]) ; if (t > 1436 && t < 1534) { const u = (s - S(1440)) / 500, k = win(t, 1438, 1532, 3); camX = 44 * Math.sin(Math.PI * u) * k; roll = -.38 * Math.cos(Math.PI * u) * k; } else { camX = 5 * noise1(t * .13); roll = .05 * noise1(t * .21); } }
    if (t >= 900 && t < 1066) roll += kf(t, [[984, .14], [1050, .14], [1066, 0]]);
    if (t >= 497 && t < 660) { roll += kf(t, [[560, 0], [572, .5], [590, .1], [600, 0]]) + .03 * noise1(t * .3); }
    if (t >= 655 && t < 780) roll += kf(t, [[657, 0], [662, 1.0], [680, .55], [700, -.7], [720, -.3], [738, .9], [760, .25], [770, 0]]);
    const climb = kf(t, [[1612, 0], [1640, .1], [1800, .17], [1858, .24], [1866, .55], [1900, .8], [1936, .25], [1950, 0]]);
    const shakeA = kf(t, SHAKEK) + IMPACTS.reduce((a, im) => a + (t >= im[0] ? im[1] * Math.exp(-(t - im[0]) * 1.1) : 0), 0) + (t > 1241 && t < 1246 ? .25 * Math.exp(-(t - 1241)) : 0);
    const shx = shakeA * (noise1(t * 31) * .5 + noise1(t * 13.7) * .5), shy = shakeA * (noise1(t * 27 + 9) * .5 + noise1(t * 11.3 + 4) * .5);
    let fov = kf(t, FOVK); const fs = Math.sin(t * .9) * .6; W3.shake = shakeA;
    ship.visible = mode === 'chase' && t >= 497;
    if (mode === 'chase') {
      const bob = .25 * noise1(t * .8); ship.position.set(camX, camY - .6 + bob, -4); ship.rotation.set(-.02 + climb * .1, 0, -roll * 1.3 + .08 * noise1(t * .5));
      const thr = clamp(tp / 110); ship.glows.forEach(g => g.scale.setScalar(2.5 + thr * 4 + Math.random() * .6)); ship.exh.forEach(e => { e.scale.set(1, 4 + thr * 18 + Math.random() * 2, 1); e.position.z = 4 + e.scale.y / 2; });
      const orb = (t >= 570 && t < 626 && !ST.camOverride) ? kf(t, [[570, 0], [580, 1.9], [600, 2.35], [616, 1.2], [626, 0]]) : .12 * Math.sin(t * .17), rad = (t >= 570 && t < 626 && !ST.camOverride) ? kf(t, [[570, 9], [582, 46], [606, 60], [626, 9]]) : 15 + 3 * Math.sin(t * .23);
      cam.position.set(camX * .82 + Math.sin(orb) * rad + shx * .5, camY + 2.2 + rad * .13 + shy * .5, -4 + Math.cos(orb) * rad); cam.up.set(Math.sin(roll * .5), Math.cos(roll * .5), 0); cam.lookAt(camX, camY, -4 - 30 * Math.max(0, Math.cos(orb))); fov = fov * .86 + 4;
    } else { cam.position.set(camX + shx * .25, camY + shy * .25, 0); cam.rotation.set(shy * .012 + .01 * fs * 0, shx * .01, roll + shx * .012, 'YXZ'); }
    cam.fov = fov; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    // sky: follows camera; rotation fakes pitch / yaw
    const yaw = t > 655 && t < 780 ? kf(t, [[660, 0], [680, .8], [700, 1.0], [720, 1.9], [740, 2.2], [770, 3.0]]) : (t >= 497 && t < 655 ? kf(t, [[560, 0], [580, -.5], [640, -.6]]) : 0);
    sky.position.copy(cam.position); sky.scale.setScalar(200000); sky.rotation.set(-climb, yaw, 0, 'YXZ');
    // streaks
    let L, sx, sy, y0, len, a, add = true; stU.uCol.value.setRGB(.7, .85, 1);
    if (t < 498) { L = 500; sx = 17; sy = 9; y0 = 8; len = v * .04; a = .5 * clamp(v / 20); }
    else if (t < 545) { L = 2500; sx = 380; sy = 240; y0 = 0; len = v * .07; a = .9; }
    else if (t < 780) { L = 9000; sx = 1500; sy = 900; y0 = 0; len = Math.min(5000, v * .06); a = .9; }
    else if (t < 1866) { L = 1800; sx = 420; sy = 60; y0 = 62; len = v * .045; a = .5 * clamp(v / 60); stU.uCol.value.setRGB(.9, .95, 1); if (t > 1620) { a = .9; stU.uCol.value.setRGB(1, 1, 1); sy = 30; y0 = 30; } }
    else if (t < 1940) { L = 2500; sx = 700; sy = 500; y0 = 0; len = v * .05; a = .8; stU.uCol.value.setRGB(1, 1, 1); }
    else { L = 20000; sx = 4000; sy = 2500; y0 = 0; len = v * .02; a = .35; }
    stU.uL.value = L; stU.uS.value = s % L; stU.uSX.value = sx; stU.uSY.value = sy; stU.uY0.value = y0; stU.uLen.value = Math.max(.5, len); stU.uA.value = a; stU.uCX.value = camX;
    tunnelUpdate(t, s); spaceUpdate(t, s); iceUpdate(t, s, env, camX);
    // gate
    gate.visible = t >= 2052; if (gate.visible) { const u = ss(2056, 2083, t); gate.position.set(1500 - 1500 * u, lerp(-16000, 300, u), lerp(-26000, -12500, u)); gate.rotation.set(-.25 + .2 * u, -.35 + .3 * u, t * .01); gateU.uT.value = t; }
    // post
    const sp01 = clamp((fov - 64) / 56);
    pU.uBlur.value = Math.max(0, sp01 * 1.15 * (mode === 'chase' ? .75 : 1) * (t < 498 ? clamp(v / 60) : 1)) * (t >= 780 && t < 1066 ? 0 : 1); pU.uCA.value = .25 + sp01 * 1.6 + shakeA * .5; pU.uVig.value = .55 + sp01 * .35; pU.uTime.value = t; pU.uC.value.set(.5 - shx * .004, .5 + (mode === 'chase' ? .02 : 0) + climb * .1);
    let flash = IMPACTS.reduce((a2, im) => a2 + (t >= im[0] && im[0] !== 1862 ? Math.min(1.3, im[1]) * Math.exp(-(t - im[0]) * 2.6) : 0), 0); if (t >= 772 && t < 780) flash = Math.max(flash, ss(772, 774.5, t) * 1.6);
    pU.uFlash.value = flash; pU.uGlitch.value = (t >= 770 && t < 780) ? 1 : (t >= 1770 && t < 1772.6 ? .5 : (t >= 660 && t < 661 ? .6 : 0));
    let fade = clamp((t - 300) / 8) * (1 - ss(2096, 2098.5, t)); if (t >= 1974 && t < 2010) fade *= 1 - win(t, 1974, 2010, 5, 5); if (t >= 984 && t < 1050) fade *= 1; pU.uFade.value = fade;
    const alt = ss(1768, 1772, t) * (1 - ss(1890, 1900, t)); pU.uTint.value.setRGB(1, 1 - alt * .04, 1 + alt * .06); pU.uGrain.value = .035 + shakeA * .03;
    R.setRenderTarget(rt); R.setClearColor(0x000000, 1); R.clear(); R.render(scene, cam); R.setRenderTarget(null); R.render(pScene, pCam); W3.lastS = s;
  };
}
