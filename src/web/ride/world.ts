/**
 * The ride view: Three.js scene kits ported from the Chapter 1 prototype
 * (reference/ch1-prototype/b_world.js).
 *
 * What comes from the chapter file: which kit is on (scene segments), camera
 * mode, speed and distance, environment, every curve (field of view, shake,
 * roll, yaw, climb, fade ...), impacts, markers, props (warp ring, meteors,
 * steam columns, downed ship, gate) and streak settings.
 *
 * What stays in code: the kits themselves (geometry, shaders, how a tunnel or
 * an ice field is scattered). A kit is selected by scene id, so a new chapter
 * can reuse "tunnel", "space", "ice" and friends without touching this file;
 * a new kind of place needs a new kit. This is placeholder art by design.
 */
import * as THREE from 'three';
import type { Chapter, ChapterRuntime, SceneProp, SceneState } from '../../core/chapter';
import { clamp, lerp, smoothstep as ss } from '../../core/util/math';
import { hash, hash2 as h2, noise1 } from '../../core/util/noise';

export interface WorldFrame {
  t: number;
  dt: number;
  scene: SceneState;
  /** Camera mode forced by the player, or null to follow the chapter. */
  cameraOverride: string | null;
  /** Rider speed factor from the feel layer: 1 on target, near 0 when stopped. */
  speedFactor: number;
  /** Rider effort, 0 to about 1.2 (power over 110% of FTP), for engine glow. */
  thrust: number;
  /** Extra shake from the feel layer (pedal strikes). */
  jolt: number;
}

export interface WorldEvents {
  /** The ship flew through an ice gate; k is 0 to 1 by speed. */
  onGatePass?: (k: number) => void;
}

const GLSL_NOISE = `
float h31(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float n3(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(mix(mix(h31(i),h31(i+vec3(1,0,0)),f.x),mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*n3(vec3(p,1.7));p=p*2.03+17.;a*=.5;}return s;}`;

type Ship = THREE.Group & { glows: THREE.Sprite[]; exh: THREE.Mesh[]; lamps?: THREE.Sprite[] };
const num = (v: unknown, d = 0): number => (typeof v === 'number' ? v : d);
const vec = (v: unknown, d: number[]): number[] => (Array.isArray(v) ? (v as number[]) : d);

export class World {
  /** Screen positions of named things, for HUD tags. Null when off screen. */
  readonly anchors: Record<string, { x: number; y: number } | null> = {};
  /** Total shake this frame (for sound). */
  shake = 0;
  private readonly R: THREE.WebGLRenderer;
  private readonly frameFn: (f: WorldFrame) => void;
  private readonly resizeFn: () => void;

  constructor(canvas: HTMLCanvasElement, rt: ChapterRuntime, events: WorldEvents = {}, dprCap = 1.5) {
    const chapter: Chapter = rt.chapter;
    const S = (t: number) => rt.distanceAt(t);
    const markers = chapter.scene.markers ?? {};
    const M = (name: string, fallback = -1) => markers[name] ?? fallback;
    const SM = (name: string) => (markers[name] !== undefined ? S(markers[name]) : -1e12);
    const props = (type: string): SceneProp[] => (chapter.scene.props ?? []).filter((p) => p.type === type);
    const propS = (p: SceneProp) => S(p.at ?? 0) + num(p.params?.offset);

    // The prototype was tuned without colour management; keep its look exactly.
    THREE.ColorManagement.enabled = false;
    const R = this.R = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    R.outputColorSpace = THREE.LinearSRGBColorSpace;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const scene = new THREE.Scene();
    const fog = new THREE.FogExp2(0x000000, 0);
    scene.fog = fog;
    const cam = new THREE.PerspectiveCamera(70, 1, 0.5, 400000);
    // Light intensities are multiplied by pi to match the pre-r155 lighting model the prototype used.
    const LIGHT = Math.PI;
    const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x3a3a5a, 0.85 * LIGHT);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2e0, LIGHT);
    sun.position.set(0.5, 0.7, -0.3);
    scene.add(sun);
    const phong = (c: number, o: THREE.MeshPhongMaterialParameters = {}) => new THREE.MeshPhongMaterial({ color: c, flatShading: true, shininess: 30, ...o });
    const basic = (c: number, o: THREE.MeshBasicMaterialParameters = {}) => new THREE.MeshBasicMaterial({ color: c, ...o });
    const D = new THREE.Object3D();
    const put = (m: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0) => {
      D.position.set(x, y, z); D.scale.set(sx, sy, sz); D.rotation.set(rx, ry, rz); D.updateMatrix(); m.setMatrixAt(i, D.matrix);
    };
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number) => {
      const m = new THREE.InstancedMesh(geo, mat, n); m.frustumCulled = false; m.count = 0; scene.add(m); return m;
    };
    const done = (m: THREE.InstancedMesh) => { m.instanceMatrix.needsUpdate = true; };

    /* ---------- sky ---------- */
    const skyU = {
      uTop: { value: new THREE.Color() }, uBot: { value: new THREE.Color() }, uPDir: { value: new THREE.Vector3(0, 0, -1) },
      uSun: { value: new THREE.Vector3(0.6, 0.5, 0.6).normalize() }, uStars: { value: 1 }, uPRad: { value: 0.3 }, uTime: { value: 0 },
      uNight: { value: 0 }, uHaze: { value: 0 }, uLight: { value: 0 },
    };
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({
      uniforms: skyU, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
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
      col=mix(col,uBot,uHaze*.8*exp(-abs(d.y)*5.));gl_FragColor=vec4(col,1.);}`,
    }));
    sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);

    /* ---------- streaks (speed lines) ---------- */
    const NS = 2600;
    const sp = new Float32Array(NS * 6), se = new Float32Array(NS * 2), sr = new Float32Array(NS * 2);
    for (let i = 0; i < NS; i++) {
      const x = hash(i * 1.1) * 2 - 1, y = hash(i * 2.3 + 9) * 2 - 1, z = hash(i * 3.7 + 5);
      for (let k = 0; k < 2; k++) { sp.set([x, y, z], i * 6 + k * 3); se[i * 2 + k] = k; sr[i * 2 + k] = hash(i * 5.1); }
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('aEnd', new THREE.BufferAttribute(se, 1));
    sg.setAttribute('aRnd', new THREE.BufferAttribute(sr, 1));
    const stU = { uS: { value: 0 }, uL: { value: 1000 }, uLen: { value: 1 }, uSX: { value: 100 }, uSY: { value: 100 }, uY0: { value: 0 }, uCol: { value: new THREE.Color(1, 1, 1) }, uA: { value: 1 }, uCX: { value: 0 } };
    const streaks = new THREE.LineSegments(sg, new THREE.ShaderMaterial({
      uniforms: stU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: `attribute float aEnd,aRnd;uniform float uS,uL,uLen,uSX,uSY,uY0,uCX;varying float vA;void main(){float z=mod(position.z*uL-uS,uL);float zz=z+aEnd*uLen*(.4+aRnd);
      vec3 w=vec3(position.x*uSX+uCX,uY0+position.y*uSY,-zz);vA=(1.-aEnd*.9)*smoothstep(uL,uL*.55,z)*smoothstep(0.,uL*.02,z)*(.35+.65*aRnd);gl_Position=projectionMatrix*viewMatrix*vec4(w,1.);}`,
      fragmentShader: `precision mediump float;uniform vec3 uCol;uniform float uA;varying float vA;void main(){gl_FragColor=vec4(uCol,vA*uA);}`,
    }));
    streaks.frustumCulled = false; scene.add(streaks);

    /* ---------- soft sprite texture ---------- */
    const softTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const x = c.getContext('2d') as CanvasRenderingContext2D;
      const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    })();
    const sprite = (color: number, add: boolean, useFog = true) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color, transparent: true, depthWrite: false, fog: useFog, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending }));
      s.visible = false; scene.add(s); return s;
    };

    /* ---------- ship ---------- */
    const makeShip = (): Ship => {
      const g = new THREE.Group() as Ship;
      const white = phong(0xe6ebf5, { shininess: 70 }), pink = phong(0xcf2a82, { shininess: 60 }), dark = phong(0x151a26, { shininess: 90 });
      const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
        const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz); g.add(m); return m;
      };
      add(new THREE.CylinderGeometry(0.85, 1.25, 7, 8), white, 0, 0, 0, Math.PI / 2);
      add(new THREE.ConeGeometry(0.85, 4.2, 8), white, 0, 0, -5.6, -Math.PI / 2);
      add(new THREE.SphereGeometry(0.8, 10, 8), dark, 0, 0.7, -2.2, 0, 0, 0, 1, 0.7, 2.3);
      add(new THREE.BoxGeometry(7.6, 0.16, 2.6), white, 0, -0.15, 1.3);
      add(new THREE.BoxGeometry(1.2, 0.2, 3.4), pink, 0, 0.92, 0.8);
      for (const sx of [-1, 1]) {
        add(new THREE.CylinderGeometry(0.72, 0.95, 4.6, 10), pink, sx * 2.5, 0, 1.6, Math.PI / 2);
        add(new THREE.BoxGeometry(0.16, 1.7, 1.9), pink, sx * 2.5, 1.0, 2.9, 0.25);
        add(new THREE.BoxGeometry(2.2, 0.12, 1.2), pink, sx * 4.6, -0.1, 1.8, 0, sx * -0.25, 0);
      }
      g.glows = [-1, 1].map((sx) => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: 0x9fd8ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
        s.position.set(sx * 2.5, 0, 4.2); g.add(s); return s;
      });
      g.exh = [-1, 1].map((sx) => add(new THREE.ConeGeometry(0.6, 1, 8, 1, true),
        basic(0x8fd0ff, { transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }), sx * 2.5, 0, 4, Math.PI / 2));
      return g;
    };
    const ship = makeShip(); scene.add(ship);
    const downed = makeShip();
    downed.glows.forEach((s) => { s.visible = false; });
    downed.exh.forEach((s) => { s.visible = false; });
    scene.add(downed);
    const decalTex = (() => {
      const c = document.createElement('canvas'); c.width = 512; c.height = 512;
      const x = c.getContext('2d') as CanvasRenderingContext2D;
      x.fillStyle = '#10141f'; x.fillRect(0, 0, 512, 512); x.strokeStyle = '#ff4da0'; x.lineWidth = 16; x.lineJoin = 'round';
      x.beginPath(); x.arc(256, 230, 130, Math.PI * 1.02, Math.PI * 1.98); x.lineTo(386, 300); x.lineTo(126, 300); x.closePath(); x.stroke();
      x.beginPath(); x.rect(196, 210, 120, 56); x.stroke();
      x.lineWidth = 9; x.beginPath(); x.moveTo(250, 100); x.lineTo(232, 150); x.lineTo(268, 176); x.lineTo(240, 215); x.stroke();
      x.fillStyle = '#ff4da0'; x.font = '700 58px "DIN Condensed","Avenir Next Condensed",Impact,sans-serif'; x.textAlign = 'center'; x.fillText('SAFETY LAST', 256, 384);
      x.font = '600 34px "DIN Condensed","Avenir Next Condensed",Impact,sans-serif'; x.fillText('· DIVERS ·', 256, 440);
      return new THREE.CanvasTexture(c);
    })();
    const wingDecal = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), basic(0xffffff, { map: decalTex }));
    wingDecal.rotation.x = -Math.PI / 2; wingDecal.position.set(-2.2, -0.04, 1.3); downed.add(wingDecal);
    downed.lamps = [[0, 1.3, -2], [-3.6, 0.1, 1.4], [3.6, 0.1, 1.4]].map((p) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: 0xffb060, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      s.position.set(p[0], p[1], p[2]); downed.add(s); return s;
    });

    /* ---------- tunnel (launch rails) ---------- */
    const box = new THREE.BoxGeometry(1, 1, 1);
    const tWall = inst(box, phong(0x161d2b), 420), tRib = inst(box, phong(0x2b3650), 420), tLight = inst(box, basic(0xbfeaff), 420), tGuide = inst(box, basic(0xff3d9a), 220);
    const doorL = new THREE.Mesh(box, phong(0x1a2233)), doorR = new THREE.Mesh(box, phong(0x1a2233));
    scene.add(doorL, doorR);
    const TC = 20;
    const sTunEnd = SM('tunnelEnd');
    const tunnelUpdate = (id: string, s: number, doors: number) => {
      const on = id === 'tunnel' || (id === 'space' && s < sTunEnd + 200);
      tWall.visible = tRib.visible = tLight.visible = tGuide.visible = doorL.visible = doorR.visible = on;
      if (!on) return;
      let nw = 0, nr = 0, nl = 0, ng = 0;
      const i0 = Math.floor(s / TC) - 1, i1 = Math.min(Math.floor(sTunEnd / TC), i0 + 60);
      for (let i = i0; i <= i1; i++) {
        const z = -(i * TC - s) - TC / 2;
        put(tWall, nw++, -20, 9, z, 0.8, 24, TC); put(tWall, nw++, 20, 9, z, 0.8, 24, TC); put(tWall, nw++, 0, 21, z, 40, 0.8, TC); put(tWall, nw++, 0, -3, z, 40, 0.8, TC);
        const zr = -(i * TC - s);
        put(tRib, nr++, -19, 9, zr, 2, 24, 1.6); put(tRib, nr++, 19, 9, zr, 2, 24, 1.6); put(tRib, nr++, 0, 20, zr, 40, 2, 1.6);
        put(tLight, nl++, -18.4, 15, zr, 0.3, 0.5, 6); put(tLight, nl++, 18.4, 15, zr, 0.3, 0.5, 6);
        if (i % 3 === 0) put(tLight, nl++, 0, 19.2, zr, 14, 0.25, 0.6);
        put(tGuide, ng++, -5, -2.5, zr, 0.35, 0.15, 9); put(tGuide, ng++, 5, -2.5, zr, 0.35, 0.15, 9);
      }
      tWall.count = nw; tRib.count = nr; tLight.count = nl; tGuide.count = ng; done(tWall); done(tRib); done(tLight); done(tGuide);
      const open = ss(0, 1, doors), zd = Math.max(-(sTunEnd - s), -1150);
      doorL.position.set(-10 - 20.5 * open, 9, zd); doorR.position.set(10 + 20.5 * open, 9, zd);
      doorL.scale.set(20, 24, 2); doorR.scale.set(20, 24, 2);
      doorL.visible = doorR.visible = on && zd < 2;
    };

    /* ---------- space: station, rings, racers, start line, warp ring ---------- */
    const station = new THREE.Group(); scene.add(station);
    {
      const hull = phong(0x39445e, { shininess: 20 }), hull2 = phong(0x56617d);
      const core = new THREE.Mesh(new THREE.CylinderGeometry(700, 700, 9000, 14), hull); core.rotation.z = Math.PI / 2; station.add(core);
      for (const [x, r] of [[-2600, 4200], [0, 5200], [2600, 4200]]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 330, 8, 72), hull2); ring.rotation.y = Math.PI / 2; ring.position.x = x; station.add(ring);
        for (let k = 0; k < 6; k++) { const spoke = new THREE.Mesh(new THREE.BoxGeometry(160, r * 2, 160), hull); spoke.rotation.x = k * Math.PI / 6; spoke.position.x = x; station.add(spoke); }
      }
      for (let k = 0; k < 40; k++) {
        const b = new THREE.Mesh(box, k % 3 ? hull : hull2);
        b.scale.set(300 + 900 * hash(k), 200 + 600 * hash(k + 9), 300 + 900 * hash(k + 4));
        const a = hash(k + 20) * 6.28; b.position.set((hash(k + 30) - 0.5) * 8600, Math.cos(a) * 820, Math.sin(a) * 820); station.add(b);
      }
      const lp = new Float32Array(4200 * 3);
      for (let i = 0; i < 4200; i++) {
        const ringI = i % 3, r = [4200, 5200, 4200][ringI], a = hash(i * 1.3) * 6.283, tt = hash(i * 2.7) * 6.283;
        const rr = r + Math.cos(tt) * 345;
        lp[i * 3] = [-2600, 0, 2600][ringI] + Math.sin(tt) * 345; lp[i * 3 + 1] = Math.cos(a) * rr; lp[i * 3 + 2] = Math.sin(a) * rr;
      }
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
      station.add(new THREE.Points(lg, new THREE.PointsMaterial({ color: 0xffe2b0, size: 2.2, sizeAttenuation: false, fog: false })));
    }
    const cRing = inst(new THREE.TorusGeometry(1, 0.035, 6, 40), basic(0xff4da8, { fog: false }), 60), cRing2 = inst(new THREE.TorusGeometry(1, 0.035, 6, 40), basic(0x7fe6ff, { fog: false }), 60);
    const NR = 40, racer = inst(new THREE.ConeGeometry(1, 1, 5), phong(0xb9c2d6), NR);
    const rTrail = inst(box, basic(0x9fd4ff, { transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), NR);
    const startLine = new THREE.Group(); scene.add(startLine);
    {
      const pts: number[] = []; const Wd = 3600, Hd = 1800;
      for (let i = 0; i <= 12; i++) { const x = -Wd / 2 + i * Wd / 12; pts.push(x, -Hd / 2, 0, x, Hd / 2, 0); }
      for (let j = 0; j <= 6; j++) { const y = -Hd / 2 + j * Hd / 6; pts.push(-Wd / 2, y, 0, Wd / 2, y, 0); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      startLine.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xff5db1, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, fog: false })));
      const c = document.createElement('canvas'); c.width = 1024; c.height = 128;
      const x = c.getContext('2d') as CanvasRenderingContext2D;
      x.fillStyle = '#ff7cc2'; x.font = '700 92px "DIN Condensed","Avenir Next Condensed",Impact,sans-serif'; x.textAlign = 'center'; x.fillText('MERIDIAN CHAMPIONSHIP · GRID', 512, 96);
      const lab = new THREE.Mesh(new THREE.PlaneGeometry(3600, 450), basic(0xffffff, { map: new THREE.CanvasTexture(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      lab.position.y = 1250; startLine.add(lab);
    }
    const warp = new THREE.Group(); scene.add(warp);
    const warpU = { uT: { value: 0 }, uK: { value: 0 } };
    {
      warp.add(new THREE.Mesh(new THREE.TorusGeometry(260, 16, 10, 64), basic(0xe9d8ff, { fog: false })));
      warp.add(new THREE.Mesh(new THREE.TorusGeometry(300, 6, 8, 64), basic(0xb070ff, { fog: false })));
      warp.add(new THREE.Mesh(new THREE.CircleGeometry(258, 48), new THREE.ShaderMaterial({
        uniforms: warpU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
        vertexShader: `varying vec2 vP;void main(){vP=position.xy/258.;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader: `precision highp float;varying vec2 vP;uniform float uT,uK;${GLSL_NOISE}void main(){float r=length(vP),a=atan(vP.y,vP.x);float sw=fbm(vec2(a*2.+r*5.-uT*2.,r*4.-uT*3.));vec3 c=mix(vec3(.35,.15,.8),vec3(.8,.9,1.),sw)*(.25+.9*pow(r,3.))+vec3(1.)*uK*(1.-r)*1.5;gl_FragColor=vec4(c,(.35+.65*uK)*smoothstep(1.,.9,r));}`,
      })));
    }
    const sStart = SM('startLine');
    const tOverride = M('aiOverride', 1e9), tRacers = M('racersFrom', 0);
    const warpProp = props('warpRing')[0];
    const spaceUpdate = (id: string, t: number, s: number, v: number) => {
      const on = id === 'space';
      station.visible = on; cRing.visible = cRing2.visible = racer.visible = rTrail.visible = startLine.visible = on;
      warp.visible = on && !!warpProp && t > (warpProp.from ?? 0) && t < (warpProp.to ?? 1e9);
      if (!on) return;
      const bx = t > tOverride ? Math.pow(t - tOverride, 2) * 700 : 0;
      station.position.set(-5200 - (s - sTunEnd) * 0.0035, 900, 4300 + (s - sTunEnd) * 0.03); station.rotation.set(0.25, 0.5, t * 0.004);
      let n1 = 0, n2 = 0;
      const C = 1500, i0 = Math.max(Math.floor(s / C), Math.ceil((sTunEnd + 1800) / C)), i1 = Math.min(i0 + 26, Math.floor((sStart - 500) / C));
      for (let i = i0; i <= i1; i++) {
        const z = -(i * C - s); const m = i % 2 ? cRing : cRing2; const k = i % 2 ? n1++ : n2++;
        put(m, k, -bx + 30 * Math.sin(i * 1.3), 18 * Math.cos(i * 0.9), z, 95, 95, 95, 0, 0, i);
      }
      cRing.count = n1; cRing2.count = n2; done(cRing); done(cRing2);
      for (let i = 0; i < NR; i++) {
        const side = hash(i * 3.1) > 0.5 ? 1 : -1;
        let x = side * (70 + hash(i * 1.7) * 900), y = (hash(i * 2.9) - 0.5) * 500, z = -(200 + hash(i * 4.3) * 7000) + (t - tRacers) * (hash(i * 6.1) - 0.55) * 60;
        if (t > tOverride) {
          const q = Math.pow(t - tOverride, 1.7) * (30 + 60 * hash(i * 7.7)); const a = hash(i * 8.3) * 6.283;
          x += Math.cos(a) * q - bx * 0.25; y += Math.sin(a) * q * 0.6; z -= q * (hash(i * 9.1) - 0.3) * 2;
        }
        put(racer, i, x, y, z, 2.2, 9, 2.2, -Math.PI / 2, 0, 0);
        const tl = 30 + v * 0.05; put(rTrail, i, x, y, z + 5 + tl / 2, 0.5, 0.5, tl);
      }
      racer.count = rTrail.count = NR; done(racer); done(rTrail);
      startLine.position.set(-bx, 0, -(sStart - s)); startLine.visible = on && s < sStart;
      if (warp.visible && warpProp) {
        const through = warpProp.at ?? 0;
        const wx = Math.pow(Math.max(0, through - 1 - t), 2) * 55;
        warp.position.set(wx, 0, -(S(through) - s)); warp.rotation.z = t * 0.6; warp.scale.setScalar(9);
        warpU.uT.value = t; warpU.uK.value = ss(num(warpProp.params?.igniteFrom, through - 8), num(warpProp.params?.igniteTo, through), t);
      }
    };

    /* ---------- ice moon ---------- */
    const gU = { uS: { value: 0 }, uFogC: { value: new THREE.Color() }, uFogD: { value: 0 }, uSkyRef: { value: new THREE.Color() }, uCrack: { value: 0 }, uSun: { value: 1 }, uCX: { value: 0 } };
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
    const waveMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false });
    const wave = (() => {
      const prof = [[0, 0], [-3000, 250], [-6000, 900], [-8500, 2100], [-10200, 3900], [-10900, 5600], [-10700, 6900], [-9900, 7700], [-8800, 8000]], Wd = 90000;
      const pos: number[] = [], idx: number[] = [], colr: number[] = [];
      prof.forEach((p, i) => {
        pos.push(-Wd / 2, p[1], p[0], Wd / 2, p[1], p[0]);
        const c = i / (prof.length - 1), sh = i % 2 ? 0.93 : 1;
        colr.push((0.5 + 0.45 * c) * sh, (0.62 + 0.35 * c) * sh, (0.85 + 0.15 * c) * sh, (0.5 + 0.45 * c) * sh, (0.62 + 0.35 * c) * sh, (0.85 + 0.15 * c) * sh);
        if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
      const m = new THREE.Mesh(g, waveMat); m.frustumCulled = false; scene.add(m); return m;
    })();
    const shard = inst(new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0), phong(0xcfe2fa, { shininess: 90, specular: 0x99aadd }), 900);
    const ridge = inst(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), phong(0xb9d0ee), 200);
    const gatep = inst(new THREE.ConeGeometry(1, 1, 4).translate(0, 0.5, 0), phong(0xa8c4ea, { shininess: 100 }), 80);
    const crater = inst(new THREE.TorusGeometry(1, 0.16, 5, 28).rotateX(Math.PI / 2), phong(0xbcd2ef), 30);
    const wreck = inst(box, basic(0xff7a2a), 60), wreck2 = inst(box, phong(0x2a2f3c), 60);
    const steam: THREE.Sprite[] = []; for (let i = 0; i < 54; i++) steam.push(sprite(0xf2f4fa, false));
    const glow: THREE.Sprite[] = []; for (let i = 0; i < 16; i++) glow.push(sprite(0xffa050, true, false));
    const hangarChunk = new THREE.Group(); scene.add(hangarChunk);
    {
      const m = new THREE.Mesh(box, phong(0x2c3446)); m.scale.set(620, 300, 900); hangarChunk.add(m);
      const d = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), basic(0xffffff, { map: decalTex, fog: false })); d.position.set(311, 0, 200); d.rotation.y = Math.PI / 2; hangarChunk.add(d);
      for (let k = 0; k < 9; k++) {
        const b = new THREE.Mesh(box, phong(0x3a445c)); b.scale.set(80 + hash(k) * 240, 60 + hash(k + 3) * 160, 100 + hash(k + 5) * 300);
        b.position.set((hash(k + 7) - 0.5) * 640, (hash(k + 8) - 0.5) * 320, (hash(k + 9) - 0.5) * 900); hangarChunk.add(b);
      }
    }
    const meteors = [...props('meteor'), ...props('hangarChunk')].map((p) => ({
      a: p.from ?? 0, b: p.to ?? 0, s: propS(p), x: num(p.params?.x), size: num(p.params?.size, 1), from: vec(p.params?.origin, [0, 5000, 2000]),
      big: p.type === 'hangarChunk', linger: num(p.params?.linger, 40),
    }));
    const mBody = meteors.map(() => { const b = new THREE.Mesh(box, phong(0x2a2f3a)); b.visible = false; scene.add(b); return b; });
    const cols = props('steamColumn').map((p) => ({
      s: propS(p), x: num(p.params?.x), t0: p.from ?? 0, r: num(p.params?.radius, 400), h: num(p.params?.height, 2000), n: num(p.params?.count, 14), growth: num(p.params?.growth, 5),
    }));
    const downedProp = props('downedShip')[0];
    const sDown = downedProp ? propS(downedProp) : -1e12;
    const downX = num(downedProp?.params?.x, 30);
    const signal = String(downedProp?.params?.signal ?? '10'), signalRate = num(downedProp?.params?.signalRate, 3);
    const CELL = 40;
    const sIce0 = SM('iceStart'), sCrest = SM('crest'), sWave = SM('frozenWave');
    const tWave = M('frozenWave', 1e9), tWeave0 = M('weaveStart', 1e9), tWeave1 = M('weaveEnd', -1);
    const tCr0 = M('cratersStart', 1e9), tCr1 = M('cratersEnd', -1), tWr0 = M('wreckStart', 1e9), tWr1 = M('wreckEnd', -1);
    let lastS: number | undefined;
    const tmp = new THREE.Vector3();
    const iceUpdate = (id: string, t: number, s: number, v: number, env: Record<string, number | number[]>, crack: number) => {
      const on = id === 'ice';
      const dens = num(env.density);
      ground.visible = on; shard.visible = ridge.visible = gatep.visible = on;
      crater.visible = on && t > tCr0 - 60 && t < tCr1 + 30;
      wreck.visible = wreck2.visible = on && t > tWr0 - 22 && t < tWr1 + 14;
      wave.visible = on && s < sWave + 400 && dens < 0.002;
      hangarChunk.visible = false;
      if (!on) {
        steam.forEach((q) => { q.visible = false; }); glow.forEach((q) => { q.visible = false; }); mBody.forEach((q) => { q.visible = false; });
        downed.visible = false; this.anchors.downedShip = null; return;
      }
      const top = vec(env.top, [0, 0, 0]), fogC = vec(env.fog, [0, 0, 0]);
      gU.uS.value = s % 16384; gU.uFogC.value.setRGB(fogC[0], fogC[1], fogC[2]); gU.uFogD.value = dens;
      gU.uSkyRef.value.setRGB(lerp(top[0], 0.6, 0.4), lerp(top[1], 0.5, 0.4), lerp(top[2], 0.9, 0.3)); gU.uSun.value = num(env.sun, 1);
      gU.uCrack.value = crack * (0.6 + 0.4 * Math.sin(t * 3));
      const far = t > tWave ? Math.max(60, sCrest - s) : 60000;
      ground.scale.set(120000, 1, far + 400); ground.position.set(0, 0, -(far - 400) / 2);
      // scatter
      const weave = t > tWeave0 && t < tWeave1, minX = weave ? 70 : 11;
      let ns = 0, nr = 0, ng = 0;
      const i0 = Math.floor(s / CELL) - 1, range = Math.min(5200, 2.5 / Math.max(dens, 0.0004)), i1 = i0 + Math.ceil(range / CELL);
      for (let i = i0; i <= i1; i++) {
        const sw = i * CELL, z = -(sw - s);
        if (sw < sIce0 + 60 || sw > sCrest - 40) continue;
        if (sw > sDown - 160 && sw < sDown + 160) continue;
        for (let k = 0; k < 3; k++) {
          const r = h2(i, k), side = h2(i, k + 5) > 0.5 ? 1 : -1, x = side * (minX + Math.pow(r, 2.6) * 1300);
          const hgt = 4 + Math.pow(h2(i, k + 9), 3) * 70 * (1 + r * 2), wd = 0.8 + h2(i, k + 12) * 2.6 + hgt * 0.04;
          if (ns < 900) put(shard, ns++, x, -0.5, z - h2(i, k + 3) * CELL, wd, hgt, wd, (h2(i, k + 14) - 0.5) * 0.5, h2(i, k + 15) * 6, (h2(i, k + 16) - 0.5) * 0.6);
        }
        if (i % 4 === 0 && hash(i * 0.77) > 0.35 && nr < 200) {
          const side = hash(i * 1.9) > 0.5 ? 1 : -1;
          put(ridge, nr++, side * (minX + 30 + hash(i * 2.3) * 500), -0.3, z, 60 + hash(i * 3.1) * 240, 2 + hash(i * 4.7) * 9, 5 + hash(i * 5.3) * 14, 0, (hash(i * 6.1) - 0.5) * 1.2, 0);
        }
        if (!weave && i % 7 === 0 && hash(i * 0.31) > 0.4 && ng < 78) {
          const gap = 13 + hash(i * 0.9) * 10, hh = 40 + hash(i * 1.1) * 90;
          put(gatep, ng++, -gap, -0.5, z, 5, hh, 5, 0, 0, 0.12); put(gatep, ng++, gap, -0.5, z, 5, hh * (0.6 + hash(i) * 0.6), 5, 0, 0.7, -0.12);
          if (lastS !== undefined && sw >= lastS && sw < s && s - lastS < 400) events.onGatePass?.(clamp(v / 400));
        }
      }
      shard.count = ns; ridge.count = nr; gatep.count = ng; done(shard); done(ridge); done(gatep);
      // craters (weaving section)
      if (crater.visible) {
        let nc = 0; const s0 = S(tCr0), k0 = Math.floor((s - s0) / 500) - 1;
        for (let k = Math.max(0, k0); k < k0 + 14 && nc < 30; k++) {
          const sc = s0 + (k + 0.5) * 500; if (sc > S(tCr1)) break;
          const Rr = 120 + h2(k, 3) * 70, side = k % 2 ? 1 : -1; put(crater, nc++, side * Rr * 0.92, -2, -(sc - s), Rr, Rr * 0.3, Rr);
        }
        crater.count = nc; done(crater);
      }
      // wreckage inside the steam
      if (wreck.visible) {
        let nw = 0; const c0 = Math.floor(s / 260) - 1;
        for (let i = c0; i < c0 + 9; i++) {
          const sw = i * 260; if (sw < S(tWr0) || sw > S(tWr1)) continue;
          const side = hash(i * 2.1) > 0.5 ? 1 : -1, x = side * (26 + hash(i * 3.3) * 110), sc = 14 + hash(i * 4.1) * 50, y = hash(i * 5.7) * 30;
          put(wreck, nw, x, y, -(sw - s), sc * 0.5, sc, sc * 0.3, hash(i) * 3, hash(i + 1) * 3, hash(i + 2) * 3);
          put(wreck2, nw, x + 3, y + 2, -(sw - s) - 4, sc * 1.4, sc * 0.8, sc * 1.2, hash(i) * 3 + 0.3, hash(i + 1) * 3, hash(i + 2) * 3); nw++;
        }
        wreck.count = wreck2.count = nw; done(wreck); done(wreck2);
      }
      wave.position.set(0, -20, -(sWave - s));
      { const k = clamp(1.15 - (sWave - s) / 45000, 0.14, 1); waveMat.color.setRGB(lerp(fogC[0] * 1.6, 1, k), lerp(fogC[1] * 1.45, 1, k), lerp(fogC[2] * 1.1, 1, k)); }
      // meteors
      let gi = 0;
      meteors.forEach((m, k) => {
        const b = mBody[k]; const vis = t >= m.a && t < m.b; b.visible = vis && !m.big;
        if (m.big) hangarChunk.visible = t >= m.a && t < m.b + m.linger;
        const u = clamp((t - m.a) / (m.b - m.a)), ex = m.x, ez = -(m.s - s);
        const px = ex + m.from[0] * (1 - u), py = m.from[1] * (1 - u) * (1 - u * 0.15) + (m.big ? 110 : 0), pz = ez - m.from[2] * (1 - u);
        if (m.big) {
          hangarChunk.position.set(px, t >= m.b ? 60 : py, t >= m.b ? ez : pz);
          hangarChunk.rotation.set(t >= m.b ? 0.5 : u * 1.2 - 0.7, 0.5 + (t >= m.b ? 0 : (1 - u) * 0.8), t >= m.b ? 0.35 : (1 - u) * 0.9);
        } else if (vis) { b.position.set(px, py, pz); b.scale.set(m.size, m.size * 0.6, m.size * 1.4); b.rotation.set(t, t * 0.7, 0); }
        if (vis) {
          for (let j = 0; j < 5 && gi < glow.length; j++) {
            const g = glow[gi++], back = j * 0.035; g.visible = true;
            const sz = (m.big ? 1100 : m.size * 5) * (1 - j * 0.15); g.scale.set(sz, sz, 1);
            g.position.set(px + m.from[0] * back, py + m.from[1] * back * 1.1, pz - m.from[2] * back);
            g.material.opacity = 0.9 - j * 0.16; g.material.color.setHex(j === 0 ? 0xfff0c8 : 0xff8a3a);
          }
        }
      });
      for (; gi < glow.length; gi++) glow[gi].visible = false;
      // steam columns
      let si = 0;
      cols.forEach((c, ci) => {
        const age = t - c.t0; if (age < 0) return;
        const grow = 1 - Math.exp(-age / c.growth), z0 = -(c.s - s); if (z0 > 3000) return;
        for (let j = 0; j < c.n && si < steam.length; j++) {
          const q = steam[si++], u = j / c.n, hgt = u * c.h * grow, rr = c.r * (0.55 + u * 1.3) * (0.6 + 0.4 * grow); q.visible = true;
          q.position.set(c.x + Math.sin(j * 2.4 + t * 0.05) * rr * 0.35 + u * c.h * 0.12, hgt + rr * 0.3, z0 + Math.cos(j * 1.7) * rr * 0.3);
          q.scale.set(rr * 2.3, rr * 2.3, 1); q.material.opacity = 0.78 * clamp(age / 2) * (1 - u * 0.35);
          q.material.color.setRGB(0.96 - ci * 0.02, 0.96 - u * 0.04, 0.99); q.material.rotation = j + t * 0.01;
        }
      });
      for (; si < steam.length; si++) steam[si].visible = false;
      // downed ship
      downed.visible = s > sDown - 3000 && s < sDown + 400;
      if (downed.visible) {
        downed.position.set(downX, 1.5, -(sDown - s)); downed.rotation.set(0.1, 2.2, 0.34); downed.scale.setScalar(1.6);
        const bit = signal[Math.floor(t * signalRate) % signal.length] === '1';
        (downed.lamps ?? []).forEach((l) => { l.scale.setScalar(bit ? 4.5 : 0.6); l.material.opacity = bit ? 1 : 0.25; });
        const p = tmp.set(downX, 5, -(sDown - s)).project(cam);
        this.anchors.downedShip = p.z < 1 && Math.abs(p.x) < 1.1 ? { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight } : null;
      } else this.anchors.downedShip = null;
    };

    /* ---------- the gate ---------- */
    const gate = new THREE.Group(); scene.add(gate); const gateU = { uT: { value: 0 } };
    {
      gate.add(new THREE.Mesh(new THREE.TorusGeometry(4300, 420, 10, 90), phong(0x59648e, { shininess: 60, specular: 0x8877cc })));
      for (let k = 0; k < 36; k++) {
        const a = k / 36 * 6.283, b = new THREE.Mesh(box, phong(k % 2 ? 0x6a76a4 : 0x434c70));
        b.scale.set(260 + 300 * hash(k), 500 + 700 * hash(k + 5), 700 + 500 * hash(k + 8)); b.position.set(Math.cos(a) * 4500, Math.sin(a) * 4500, 0); b.rotation.z = a; gate.add(b);
      }
      const lp: number[] = [];
      for (let i = 0; i < 700; i++) { const a = hash(i * 1.9) * 6.283, r = 4300 + (hash(i * 2.3) - 0.5) * 900; lp.push(Math.cos(a) * r, Math.sin(a) * r, 430 * (hash(i * 3.3) - 0.2)); }
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
      gate.add(new THREE.Points(lg, new THREE.PointsMaterial({ color: 0xd9b8ff, size: 2, sizeAttenuation: false, fog: false })));
      gate.add(new THREE.Mesh(new THREE.CircleGeometry(4000, 64), new THREE.ShaderMaterial({
        uniforms: gateU, fog: false, transparent: true, depthWrite: false,
        vertexShader: `varying vec2 vP;void main(){vP=position.xy/4000.;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader: `precision highp float;varying vec2 vP;uniform float uT;${GLSL_NOISE}void main(){float r=length(vP),a=atan(vP.y,vP.x);
        float cl=fbm(vec2(cos(a),sin(a))*2.2+r*3.-uT*.06)+.5*fbm(vP*6.+uT*.03);vec3 c=mix(vec3(.16,.06,.34),vec3(.78,.55,1.),smoothstep(.35,.95,cl))*(.35+.8*smoothstep(.3,1.,r));
        c+=vec3(.9,.8,1.)*exp(-pow((r-.47)*11.,2.))*1.3;c+=vec3(.5,.7,1.)*exp(-pow((r-.52)*26.,2.))*.7;
        float eye=smoothstep(.45,.4,r);vec3 pup=vec3(.01,.012,.03)+vec3(.25,.3,.6)*pow(max(0.,1.-length(vP-vec2(-.12,.14))*4.2),2.)+vec3(.9)*pow(max(0.,1.-length(vP-vec2(-.15,.17))*11.),3.);
        c=mix(c,pup,eye);gl_FragColor=vec4(c,smoothstep(1.,.97,r));}`,
      })));
    }
    const gateProp = props('gate')[0];

    /* ---------- post ---------- */
    const rtg = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true });
    const pU = {
      tD: { value: rtg.texture }, uBlur: { value: 0 }, uCA: { value: 0 }, uVig: { value: 0.5 }, uFlash: { value: 0 }, uFade: { value: 1 }, uGlitch: { value: 0 },
      uTime: { value: 0 }, uGrain: { value: 0.04 }, uC: { value: new THREE.Vector2(0.5, 0.5) }, uTint: { value: new THREE.Color(1, 1, 1) },
    };
    const pScene = new THREE.Scene(), pCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    pScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: pU, depthTest: false, depthWrite: false,
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
      fragmentShader: `precision highp float;varying vec2 vUv;uniform sampler2D tD;uniform float uBlur,uCA,uVig,uFlash,uFade,uGlitch,uTime,uGrain;uniform vec2 uC;uniform vec3 uTint;
    void main(){vec2 uv=vUv;if(uGlitch>0.){float band=floor(uv.y*26.+uTime*13.);float r=fract(sin(band*91.7+floor(uTime*17.)*3.1)*4375.5);uv.x+=(r-.5)*.3*uGlitch*step(.55,r);}
      vec2 d=uv-uC;float l=length(d);vec3 c=vec3(0.);float tot=0.;float jit=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
      for(int i=0;i<10;i++){float k=(float(i)+jit)/10.;float sc=1.-uBlur*.5*k*smoothstep(.02,.75,l);vec2 u2=uC+d*sc;float ca=uCA*l*.03;
        c+=vec3(texture2D(tD,u2+d*ca).r,texture2D(tD,u2).g,texture2D(tD,u2-d*ca).b);tot+=1.;}
      c/=tot;c*=1.-uVig*l*l*1.5;c*=uTint;c+=uFlash;c+=(fract(sin(dot(uv+fract(uTime),vec2(12.9898,78.233)))*43758.5)-.5)*uGrain;gl_FragColor=vec4(c*uFade,1.);}`,
    })));

    this.resizeFn = () => {
      const w = innerWidth, h = innerHeight;
      R.setPixelRatio(dpr); R.setSize(w, h, false); rtg.setSize(Math.floor(w * dpr), Math.floor(h * dpr)); cam.aspect = w / h; cam.updateProjectionMatrix();
    };
    addEventListener('resize', this.resizeFn);
    this.resizeFn();

    const NO_3D = new Set(['stills', 'blackout', 'end']);
    let streakS = 0;
    const sCr0 = S(tCr0 > 1e8 ? 0 : tCr0);

    this.frameFn = (f: WorldFrame) => {
      const t = f.t, sc = f.scene, id = sc.id, s = sc.distance, v = sc.speed, env = sc.env, cv = sc.curves;
      const C = (name: string, d = 0) => cv[name] ?? d;
      const mode = f.cameraOverride ?? sc.camera;
      const sf = clamp(f.speedFactor, 0, 1.4);
      if (NO_3D.has(id)) {
        R.setRenderTarget(null); R.setClearColor(0x000000, 1); R.clear(); lastS = s; this.shake = 0; this.anchors.downedShip = null; return;
      }
      // env
      const top = vec(env.top, [0, 0, 0]), bot = vec(env.bot, [0, 0, 0]), fogC = vec(env.fog, [0, 0, 0]), pDir = vec(env.planetDir, [0, 0, -1]);
      skyU.uTop.value.setRGB(top[0], top[1], top[2]); skyU.uBot.value.setRGB(bot[0], bot[1], bot[2]); skyU.uStars.value = num(env.stars, 1);
      skyU.uPRad.value = num(env.planetRadius, 0.2); skyU.uPDir.value.set(pDir[0], pDir[1], pDir[2]).normalize();
      skyU.uNight.value = num(env.night); skyU.uHaze.value = num(env.haze); skyU.uTime.value = t; skyU.uLight.value = C('skyLights');
      const sunK = num(env.sun, 1);
      fog.color.setRGB(fogC[0], fogC[1], fogC[2]); fog.density = num(env.density);
      hemi.intensity = (0.55 + 0.4 * sunK) * LIGHT; sun.intensity = sunK * (id === 'tunnel' ? 0.5 : 1) * LIGHT;
      // camera path
      let camX = 0, roll = 0, camY = 0;
      const weaving = id === 'ice' && t > tWeave0 && t < tWeave1;
      if (id === 'ice') {
        camY = 3.4 + 0.5 * noise1(t * 0.6) + C('camLift');
        if (weaving) { const u = (s - sCr0) / 500, k = C('weave'); camX = 44 * Math.sin(Math.PI * u) * k; roll = -0.38 * Math.cos(Math.PI * u) * k; }
        else { camX = 5 * noise1(t * 0.13); roll = 0.05 * noise1(t * 0.21); }
      }
      roll += C('roll');
      if (id === 'space' && t < tOverride) roll += 0.03 * noise1(t * 0.3);
      const climb = C('climb');
      // Shake: the story's shake eases off when the rider eases off; impacts and pedal strikes do not.
      const shakeA = C('shake') * (0.35 + 0.65 * Math.min(1, sf)) + sc.impactShake + f.jolt * 0.12;
      this.shake = shakeA;
      const shx = shakeA * (noise1(t * 31) * 0.5 + noise1(t * 13.7) * 0.5), shy = shakeA * (noise1(t * 27 + 9) * 0.5 + noise1(t * 11.3 + 4) * 0.5);
      // Field of view widens with speed; a rider who backs off loses most of the widening.
      const baseFov = 58;
      let fov = baseFov + (C('fov', 70) - baseFov) * (0.3 + 0.7 * sf);
      ship.visible = mode === 'chase' && id !== 'tunnel';
      if (mode === 'chase') {
        const bob = 0.25 * noise1(t * 0.8);
        // The ship drops back towards the camera when the rider eases off, and pulls ahead on a surge.
        const lag = clamp((1 - sf) * 5, -2.5, 4);
        ship.position.set(camX, camY - 0.6 + bob, -4 + lag); ship.rotation.set(-0.02 + climb * 0.1, 0, -roll * 1.3 + 0.08 * noise1(t * 0.5));
        const thr = clamp(f.thrust);
        ship.glows.forEach((g) => g.scale.setScalar(2.5 + thr * 4 + Math.random() * 0.6));
        ship.exh.forEach((e) => { e.scale.set(1, 4 + thr * 18 + Math.random() * 2, 1); e.position.z = 4 + e.scale.y / 2; });
        const scripted = C('orbitRadius') > 0 && !f.cameraOverride;
        const orb = scripted ? C('orbit') : 0.12 * Math.sin(t * 0.17), rad = scripted ? C('orbitRadius') : 15 + 3 * Math.sin(t * 0.23);
        cam.position.set(camX * 0.82 + Math.sin(orb) * rad + shx * 0.5, camY + 2.2 + rad * 0.13 + shy * 0.5, -4 + Math.cos(orb) * rad);
        cam.up.set(Math.sin(roll * 0.5), Math.cos(roll * 0.5), 0); cam.lookAt(camX, camY, -4 - 30 * Math.max(0, Math.cos(orb))); fov = fov * 0.86 + 4;
      } else {
        cam.up.set(0, 1, 0);
        cam.position.set(camX + shx * 0.25, camY + shy * 0.25, 0); cam.rotation.set(shy * 0.012, shx * 0.01, roll + shx * 0.012, 'YXZ');
      }
      cam.fov = fov; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      // sky: follows camera; rotation fakes pitch and yaw
      sky.position.copy(cam.position); sky.scale.setScalar(200000); sky.rotation.set(-climb, C('yaw'), 0, 'YXZ');
      // streaks: these carry most of the sense of speed, so they follow the rider's effort directly
      const st = sc.streaks ?? {};
      const L = num(st.length, 2000), col = vec(st.color, [0.7, 0.85, 1]);
      const ref = num(st.alphaSpeedRef);
      const stretch = Math.min(num(st.maxStretch, 1e9), v * num(st.stretch, 0.05)) * sf;
      streakS = (streakS + v * sf * f.dt) % L;
      stU.uCol.value.setRGB(col[0], col[1], col[2]);
      stU.uL.value = L; stU.uS.value = streakS; stU.uSX.value = num(st.spreadX, 400); stU.uSY.value = num(st.spreadY, 200); stU.uY0.value = num(st.y0);
      stU.uLen.value = Math.max(0.5, stretch); stU.uA.value = num(st.alpha, 0.8) * (ref > 0 ? clamp((v * sf) / ref) : 1) * (0.25 + 0.75 * Math.min(1, sf)); stU.uCX.value = camX;
      tunnelUpdate(id, s, C('doors'));
      spaceUpdate(id, t, s, v);
      iceUpdate(id, t, s, v, env, C('crack'));
      // gate
      gate.visible = !!gateProp && t >= (gateProp.from ?? 0);
      if (gate.visible && gateProp) {
        const u = ss(num(gateProp.params?.approachFrom, t), num(gateProp.params?.approachTo, t + 1), t);
        gate.position.set(1500 - 1500 * u, lerp(-16000, 300, u), lerp(-26000, -12500, u)); gate.rotation.set(-0.25 + 0.2 * u, -0.35 + 0.3 * u, t * 0.01); gateU.uT.value = t;
      }
      // post
      const sp01 = clamp((fov - 64) / 56);
      pU.uBlur.value = Math.max(0, sp01 * 1.15 * (mode === 'chase' ? 0.75 : 1) * C('blur', 1));
      pU.uCA.value = 0.25 + sp01 * 1.6 + shakeA * 0.5; pU.uVig.value = 0.55 + sp01 * 0.35; pU.uTime.value = t;
      pU.uC.value.set(0.5 - shx * 0.004, 0.5 + (mode === 'chase' ? 0.02 : 0) + climb * 0.1);
      pU.uFlash.value = sc.impactFlash + C('flash'); pU.uGlitch.value = C('glitch'); pU.uFade.value = C('fade', 1);
      const alt = C('alt'); pU.uTint.value.setRGB(1, 1 - alt * 0.04, 1 + alt * 0.06); pU.uGrain.value = 0.035 + shakeA * 0.03;
      R.setRenderTarget(rtg); R.setClearColor(0x000000, 1); R.clear(); R.render(scene, cam); R.setRenderTarget(null); R.render(pScene, pCam);
      lastS = s;
    };
  }

  frame(f: WorldFrame): void {
    this.frameFn(f);
  }

  dispose(): void {
    removeEventListener('resize', this.resizeFn);
    this.R.dispose();
  }
}
