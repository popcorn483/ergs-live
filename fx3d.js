/* ERGS Live: the score animations in real 3D (28 November 2026).
   A small pitch, a set of rugby posts with navy pads and a smooth white ball with gold bands, drawn with three.js. Six scenes:
     try-dive    the ball drops in over the try line and is grounded in the in-goal, seen from low beside the line
     try-posts   it comes in under the crossbar and is grounded between the posts, seen from in front of them
     try-chase   a kick ahead: two bounces down the pitch, then it is grounded over the line, seen from the side
     kick        a kick at goal from behind the kicker: off the tee, up, and over the bar between the uprights; the posts flash gold
     kick-miss   the same kick drifting wide of the right-hand upright; the posts flash red
   When a try is grounded the whole try line flashes gold.
   Every scene is a pure function of time (nothing is accumulated frame to frame), so it can be stepped to an exact moment.
   FX3D.play(holder, name) starts one and returns {impact, dur, stop()}; FX3D.can() says whether this device can draw it.
   One renderer and one set of models are built on first use and reused. */
(function(){
'use strict';
const FX3D = window.FX3D = {ok:null, cur:null};
const R = 0.62;                       // the ball's short radius; it is drawn large so it reads on a phone
const POST = {half:2.8, bar:3.0, top:10.5};
let G = null;                         // everything built once: renderer, scene, camera and the models

FX3D.can = function(){
  if (FX3D.ok !== null) return FX3D.ok;
  try { const c = document.createElement('canvas'); FX3D.ok = !!(window.THREE && (c.getContext('webgl2') || c.getContext('webgl'))); } catch(e){ FX3D.ok = false; }
  return FX3D.ok;
};

const clamp = (x, a, b) => Math.max(a, Math.min(b, x)), u01 = (t, a, b) => clamp((t - a)/(b - a), 0, 1);
const lerp = (a, b, u) => a + (b - a)*u, ease = u => u*u*(3 - 2*u), out = u => 1 - Math.pow(1 - u, 3);
// from a to b along a parabola that rises h above the straight line between them
const arc = (a, b, u, h) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u) + 4*h*u*(1 - u), lerp(a[2], b[2], u)];

function ballTexture(){
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, 512, 256);
  const band = (y0, y1) => { g.fillStyle = '#1C2342'; g.fillRect(0, y0 - 5, 512, y1 - y0 + 10); g.fillStyle = '#DCC08A'; g.fillRect(0, y0, 512, y1 - y0); };
  band(34, 62); band(194, 222);                       // a gold band at each end, edged in navy
  // no lacing: a rugby ball has none
  const t = new THREE.CanvasTexture(c); if ('colorSpace' in t) t.colorSpace = 'srgb'; else t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t;
}
// the navy post protector, with ERGS reading down it in white
function padTexture(){
  const c = document.createElement('canvas'); c.width = 128; c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#121a3d'; g.fillRect(0, 0, 128, 512); g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '800 104px "Big Shoulders Display","Barlow Condensed","Arial Narrow",Arial,sans-serif';
  'ERGS'.split('').forEach((ch, i) => g.fillText(ch, 64, 76 + i*120));
  const t = new THREE.CanvasTexture(c); if ('colorSpace' in t) t.colorSpace = 'srgb'; else t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; return t;
}
function pitchTexture(){
  const S = 1024, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), M = S/80;   // 80 m square, try line across the middle
  for (let i = 0; i < 16; i++){ g.fillStyle = i % 2 ? '#22853b' : '#1e7634'; g.fillRect(0, i*S/16, S, S/16); }          // mown stripes
  g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(0, 0, S, S/2);                                                       // the in-goal, a touch lighter
  g.fillStyle = '#fff'; const line = (z, w) => g.fillRect(0, S/2 + z*M - w/2, S, w);
  line(0, 5); line(22, 3); line(-10, 4);                                                                                 // try line, the 22, dead-ball line
  for (let x = 0; x < S; x += 60) g.fillRect(x, S/2 + 5*M - 1.5, 30, 3);                                                 // the dashed 5 m line
  const t = new THREE.CanvasTexture(c); if ('colorSpace' in t) t.colorSpace = 'srgb'; else t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; return t;
}

function build(){
  const T = THREE, r = new T.WebGLRenderer({alpha:true, antialias:true, powerPreference:'low-power'});
  r.setClearColor(0x000000, 0); if ('outputColorSpace' in r) r.outputColorSpace = 'srgb'; else r.outputEncoding = T.sRGBEncoding;
  const scene = new T.Scene(), cam = new T.PerspectiveCamera(40, 1.4, 0.1, 300);
  scene.add(new T.HemisphereLight(0xffffff, 0x1c4a2a, 0.95)); const sun = new T.DirectionalLight(0xffffff, 0.9); sun.position.set(-6, 14, 10); scene.add(sun);
  // the pitch fades out at its edges, so it sits on the page without a hard border
  const pm = new T.MeshLambertMaterial({map:pitchTexture(), transparent:true});
  { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 50, 128, 128, 128); gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); pm.alphaMap = new T.CanvasTexture(c); }
  const pitch = new T.Mesh(new T.PlaneGeometry(80, 80), pm); pitch.rotation.x = -Math.PI/2; scene.add(pitch);
  // the try line again, as a strip of its own lying on the painted one: it flashes gold from touchline to touchline when a try is scored
  const tline = new T.Mesh(new T.PlaneGeometry(80, .5), new T.MeshBasicMaterial({color:0xF2B31F, transparent:true, opacity:0, depthWrite:false})); tline.rotation.x = -Math.PI/2; tline.position.set(0, .035, 0); scene.add(tline);
  // rugby posts: an H, with a navy pad round the foot of each upright
  const posts = new T.Group(), white = new T.MeshStandardMaterial({color:0xffffff, roughness:.45, emissive:0xffe9b0, emissiveIntensity:0});
  const cyl = (rad, len) => new T.Mesh(new T.CylinderGeometry(rad, rad, len, 14), white), padTex = padTexture(), side = new T.MeshLambertMaterial({map:padTex, emissive:0x1a2140, emissiveMap:padTex, emissiveIntensity:.55}), cap = new T.MeshLambertMaterial({color:0x0e1433});
  [-1, 1].forEach(s => { const up = cyl(.12, POST.top); up.position.set(s*POST.half, POST.top/2, 0); posts.add(up);
    const pad = new T.Mesh(new T.BoxGeometry(.62, 2.2, .62), [side, side, cap, cap, side, side]); pad.position.set(s*POST.half, 1.1, 0); posts.add(pad); });   // ERGS on all four sides, plain top and bottom
  const bar = cyl(.11, POST.half*2); bar.rotation.z = Math.PI/2; bar.position.set(0, POST.bar, 0); posts.add(bar); scene.add(posts);
  // the ball: a sphere stretched along one axis, smooth, white with gold bands
  const ball = new T.Mesh(new T.SphereGeometry(R, 40, 28), new T.MeshStandardMaterial({map:ballTexture(), roughness:.5, metalness:.02})); ball.scale.set(1, 1.55, 1);
  const spin = new T.Group(); spin.add(ball); scene.add(spin);
  const shadow = new T.Mesh(new T.CircleGeometry(.8, 24), new T.MeshBasicMaterial({color:0x000000, transparent:true, opacity:.35, depthWrite:false})); shadow.rotation.x = -Math.PI/2; shadow.position.y = .02; scene.add(shadow);
  const tee = new T.Mesh(new T.CylinderGeometry(.22, .34, .22, 14), new T.MeshStandardMaterial({color:0xDCC08A, roughness:.6})); scene.add(tee);
  const ring = new T.Mesh(new T.RingGeometry(.86, 1, 40), new T.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:0, side:T.DoubleSide, depthWrite:false})); ring.rotation.x = -Math.PI/2; ring.position.y = .04; scene.add(ring);
  const ring2 = ring.clone(); ring2.material = ring.material.clone(); ring2.material.color.set(0xDCC08A); scene.add(ring2);
  // bits of turf thrown up where the ball is grounded
  const N = 46, pos = new Float32Array(N*3), seed = []; for (let i = 0; i < N; i++){ const a = Math.random()*Math.PI*2, v = 1.6 + Math.random()*3.2; seed.push([Math.cos(a)*v, 3 + Math.random()*4.5, Math.sin(a)*v]); }
  const pg = new T.BufferGeometry(); pg.setAttribute('position', new T.BufferAttribute(pos, 3));
  const turf = new T.Points(pg, new T.PointsMaterial({color:0x8fe3a3, size:.2, transparent:true, opacity:0, depthWrite:false})); scene.add(turf);
  return G = {T, r, scene, cam, posts, white, tline, tint:new T.Color(), ball, spin, shadow, tee, ring, ring2, turf, seed, N, look:new T.Vector3()};
}

/* what every scene sets, each frame: where the ball is and how it is turned, the camera, and the extras */
function apply(S){
  const g = G, b = S.ball;
  g.spin.position.set(b[0], b[1], b[2]); g.spin.rotation.set(S.rot[0], S.rot[1], S.rot[2]); g.ball.scale.set(S.sq[0], 1.55*S.sq[1], S.sq[0]);
  g.shadow.position.x = b[0]; g.shadow.position.z = b[2]; const h = Math.max(0, b[1] - R); g.shadow.scale.setScalar(1/(1 + h*.18)); g.shadow.material.opacity = .4/(1 + h*.35);
  g.cam.position.set(S.cam[0], S.cam[1], S.cam[2]); g.look.set(S.at[0], S.at[1], S.at[2]); g.cam.lookAt(g.look);
  g.tee.visible = !!S.tee; if (S.tee) g.tee.position.set(S.tee[0], .11, S.tee[2]);
  g.posts.visible = S.posts !== false;
  // the posts flash: gold when the kick is good or the try is scored under them, red when a kick is missed
  { const f = clamp(S.glow || 0, 0, 1), hue = S.red ? 0xE0160C : 0xE2A21C; g.white.color.set(0xffffff).lerp(g.tint.set(hue), Math.min(1, f*1.25)); g.white.emissive.set(hue); g.white.emissiveIntensity = f*(S.red ? .6 : .3); }
  g.tline.material.opacity = clamp(S.line || 0, 0, 1); g.tline.visible = (S.line || 0) > .01; g.tline.scale.y = 1 + (S.line || 0)*.9;
  const k = S.hit;   // seconds since the ball was grounded (or negative)
  [g.ring, g.ring2].forEach((rg, i) => { const u = u01(k, i*.12, .75 + i*.12); rg.visible = k > i*.12 && u < 1; rg.position.x = S.spot[0]; rg.position.z = S.spot[2]; rg.scale.setScalar(.6 + u*3.2); rg.material.opacity = (1 - u)*.9; });
  const P = g.turf.geometry.attributes.position; g.turf.visible = !S.noTurf && k > 0 && k < 1; g.turf.material.opacity = k > 0 ? clamp(1 - k, 0, 1) : 0;
  if (g.turf.visible){ for (let i = 0; i < g.N; i++){ const s = g.seed[i]; P.setXYZ(i, S.spot[0] + s[0]*k, Math.max(.03, s[1]*k - 6.5*k*k), S.spot[2] + s[2]*k); } P.needsUpdate = true; }
}
// the ball settling after it is grounded: a squash, then one small hop that dies away
// three quick flashes over about a second, each a little weaker than the last
const flash = k => k < 0 || k > 1.05 ? 0 : Math.abs(Math.sin(k/.35*Math.PI))*(1 - k/1.4);
const settle = k => k < 0 ? [1, 1] : k < .12 ? [1 + .22*(1 - k/.12)*1, 1 - .26*(1 - k/.12)] : [1, 1];
const hop = k => k > .12 && k < .5 ? .28*Math.sin((k - .12)/.38*Math.PI) : 0;

const SCENES = {
  /* low beside the try line: the ball drops in from up the pitch and is grounded just over the line */
  'try-dive': {impact:1.25, dur:4.3, at(t){ const I = 1.25, u = u01(t, .05, I), k = t - I, spot = [0, R, -1.6], p = u < 1 ? arc([-4.6, 2.2, 4.4], spot, u, 2.9) : [spot[0], R + hop(k), spot[2]];
    const c = ease(u01(t, 0, 2.4)); return {ball:p, rot:[u < 1 ? -u*9 : 1.35, .5, u < 1 ? u*2 : 1.35], sq:settle(k), spot, hit:k, line:flash(k), cam:[lerp(7.5, 5.2, c), lerp(2.3, 1.5, c), lerp(6.5, 3.6, c)], at:[-.4, .7, -1.2], posts:false}; }},
  /* in front of the posts: the ball comes in under the bar and is grounded between the uprights */
  'try-posts': {impact:1.25, dur:4.3, at(t){ const I = 1.25, u = u01(t, .1, I), k = t - I, spot = [0, R, -2.2], p = u < 1 ? arc([6.5, 2.6, 13], spot, u, 2.4) : [spot[0], R + hop(k), spot[2]];
    const c = ease(u01(t, 0, 2.4)); return {ball:p, rot:[u < 1 ? -u*8 : 1.35, 0, u < 1 ? .6 : 1.2], sq:settle(k), spot, hit:k, line:flash(k), glow:flash(k), cam:[lerp(-2.2, -1, c), lerp(2.2, 3.4, c), lerp(15, 11.5, c)], at:[0, lerp(2.4, 1.7, c), -1]}; }},   // high enough to see the try line run under the posts
  /* from the side: a kick ahead bounces twice and is grounded over the line */
  'try-chase': {impact:1.35, dur:4.4, at(t){ const I = 1.35, k = t - I, spot = [0, R, -1.8], A = [-1, 4.5, 13], B1 = [-.6, R, 7.2], B2 = [-.2, R, 2.6]; let p, sq = [1, 1];
    if (t < .55) p = arc(A, B1, Math.pow(u01(t, .05, .55), 1.5), .2); else if (t < 1) p = arc(B1, B2, u01(t, .55, 1), 1.9); else if (t < I) p = arc(B2, spot, u01(t, 1, I), .9); else p = [spot[0], R + hop(k), spot[2]];
    [.55, 1].forEach(b => { const d = t - b; if (d > 0 && d < .1) sq = [1.18, .8]; }); if (k >= 0) sq = settle(k);
    const c = ease(u01(t, 0, 2.6)); return {ball:p, rot:[t < I ? -t*7.5 : 1.35, 0, .25], sq, spot, hit:k, line:flash(k), cam:[lerp(11, 8.5, c), lerp(2.6, 1.9, c), lerp(6, 2.5, c)], at:[0, .9, lerp(4.5, -.6, c)], posts:false}; }},
  /* behind the kicker: off the tee, up, and over the bar between the uprights */
  'kick': {impact:1.35, dur:4, at(t){ return kick(t, 0); }},
  'kick-miss': {impact:1.35, dur:3.6, at(t){ return kick(t, 4.4); }}
};
function kick(t, wide){
  const K = .38, I = 1.35, tee = [0, 0, 15], u = u01(t, K, I), v = u01(t, I, 2.4); let p;
  if (t < K) p = [0, R*1.55 + .2, 15]; else if (u < 1) p = arc([0, R*1.55 + .2, 15], [wide, 5.6, 0], out(u)*.55 + u*.45, 2.6); else p = [wide + wide*.35*v, 5.6 - 1.0*v*v - .3*v, -11*v];   // it stays above the height of the bar as it drops away behind the posts
  const c = ease(u01(t, 0, 2)), over = flash(t - I);
  return {ball:p, rot:[t < K ? 0 : -(t - K)*11, 0, t < K ? .12 : .12], sq:t >= K && t < K + .09 ? [.86, 1.12] : [1, 1], spot:tee, hit:t >= K ? (t - K)*1.6 + .001 : -1, noTurf:true, tee, glow:over, red:!!wide,
    cam:[lerp(-1.4, -.5, c), lerp(1.4, 2.4, c), lerp(21, 19.5, c)], at:[wide*.2*u, lerp(3.4, 5, c), 0]};
}

FX3D.scenes = Object.keys(SCENES);
FX3D.info = name => { const s = SCENES[name]; return s ? {impact:s.impact, dur:s.dur} : null; };

/* Start a scene inside holder (an element with a size). Returns null if it cannot be drawn here. */
FX3D.play = function(holder, name){
  const sc = SCENES[name]; if (!sc || !FX3D.can()) return null;
  try { if (!G) build(); } catch(e){ FX3D.ok = false; return null; }
  FX3D.stop();
  const g = G, cv = g.r.domElement, w = Math.max(120, holder.clientWidth || 320), h = Math.max(90, holder.clientHeight || 230);
  g.r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); g.r.setSize(w, h, false); cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'; cv.className = 'fx3d-cv';
  g.cam.aspect = w/h; g.cam.updateProjectionMatrix(); holder.appendChild(cv);
  const run = {name, t0:performance.now(), raf:0, fixed:null, impact:sc.impact, dur:sc.dur};
  const draw = t => { try { apply(sc.at(t)); g.r.render(g.scene, g.cam); } catch(e){ FX3D.stop(); } };
  const tick = () => { if (FX3D.cur !== run) return; const t = run.fixed !== null ? run.fixed : (performance.now() - run.t0)/1000; draw(Math.min(t, sc.dur)); run.t = t; if (run.fixed === null && t < sc.dur) run.raf = requestAnimationFrame(tick); };
  run.seek = t => { run.fixed = t; cancelAnimationFrame(run.raf); draw(t); run.t = t; };          // hold on one moment (for checks and captures)
  run.resume = () => { run.t0 = performance.now() - (run.t || 0)*1000; run.fixed = null; tick(); };
  run.stop = () => { if (FX3D.cur === run) FX3D.stop(); };
  FX3D.cur = run; draw(0); run.raf = requestAnimationFrame(tick); return run;
};
FX3D.stop = function(){ const run = FX3D.cur; FX3D.cur = null; if (run) cancelAnimationFrame(run.raf); if (G && G.r.domElement.parentNode) G.r.domElement.parentNode.removeChild(G.r.domElement); };
// where the ball is on screen right now, as fractions of the canvas (for checks)
FX3D.where = function(){ if (!G || !FX3D.cur) return null; const v = G.spin.position.clone().project(G.cam), pv = n => { const q = new THREE.Vector3(n[0], n[1], n[2]).project(G.cam); return [(q.x + 1)/2, (1 - q.y)/2]; };
  return {x:(v.x + 1)/2, y:(1 - v.y)/2, world:[G.spin.position.x, G.spin.position.y, G.spin.position.z], upL:pv([-POST.half, POST.bar, 0]), upR:pv([POST.half, POST.bar, 0]), top:pv([0, POST.top, 0]), line:+G.tline.material.opacity.toFixed(2), post:'#' + G.white.color.getHexString(), t:FX3D.cur.t, name:FX3D.cur.name}; };
})();
