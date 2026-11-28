// ERGS Live: tries and kicks drawn in real 3D, with the flat pictures as a stand-in (28 November 2026)
// usage: node flow40.js      (uses the real 3D library, so it is slow without a graphics card)
const { chromium } = require('playwright'); const { open } = require('./real.js');
const lv = (p, fn, arg) => p.evaluate(src => window.__lv(src), '(' + fn.toString() + ')(' + JSON.stringify(arg === undefined ? null : arg) + ')');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const M = k => ({id:'tvA', team:'1XV', home:'ERGS', away:'Portora', status:'1H', code:'union', events:[{id:'t1', k:'try', s:'H', p:'Gus Hart', m:4, ts:1}, {id:'c1', k:'con', s:'H', p:'Cal Weir', m:5, ts:2, miss:k === 'miss'}]});
(async () => { const b = await chromium.launch({args:['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
  const start = async () => { const p = await open(b, 'coach', {ctx:await b.newContext({viewport:{width:390, height:700}})}); await p.addInitScript(() => { try { sessionStorage.setItem('ergs.liveOK', '1'); } catch(e){} }); await p.goto('http://app.test/?live'); await p.waitForTimeout(5000); return p; };
  const p = await start();
  // before the 3D code has arrived, the flat picture is used
  if (!(await p.evaluate(() => !!window.FX3D))){ await lv(p, m => { Q.length = 0; Q.push([m, m.events[0]]); playFx(); }, M()); await p.waitForTimeout(300);
    ok(await p.evaluate(() => !document.querySelector('#fx').classList.contains('d3') && !!document.querySelector('#fx .fx-try .fx-tball') && !document.querySelector('#fx .fx-tball path[d*="h14"]')), 'until the 3D code arrives a try uses the flat picture (and its ball has no lacing)');
    await p.evaluate(() => document.querySelector('#fx').click()); await p.waitForTimeout(800); }
  ok(await lv(p, () => fx3dLoad()) === true && await lv(p, () => fx3dOK()), 'the 3D code loads and this browser can draw it');
  const order = await lv(p, () => { const ev = (i, k, s) => ({id:'t' + i, k, s, p:'Gus Hart', m:i, ts:i}), m = {id:'tvA', team:'1XV', home:'ERGS', away:'Portora', events:[ev(1, 'try', 'H'), ev(2, 'con', 'H'), ev(3, 'try', 'A'), ev(4, 'try', 'H'), ev(6, 'try', 'H'), ev(9, 'pt', 'H'), ev(10, 'try', 'A'), ev(11, 'try', 'H'), ev(12, 'try', 'H'), ev(13, 'try', 'H')]};
    return {tries:m.events.filter(e => e.k === 'try').map(e => tryVar(m, e)), again:m.events.filter(e => e.k === 'try').map(e => tryVar(m, e)), pt:tryVar(m, m.events[5]), all:TRY_VARS.slice()}; });
  ok(order.all.join() === 'dive,meteor,posts,flyround,carry,party' && new Set(order.tries.slice(0, 6)).size === 6 && order.tries[6] === order.tries[0] && order.tries.join() === order.again.join(), 'six 3D tries taken in turn, plain and show-off turn about (' + order.tries.slice(0, 6).join(' → ') + '): all six before any repeats, and the same for everyone');
  ok(order.pt === 'posts', 'a penalty try is always the one under the posts');
  const play = async (k, v) => { await lv(p, a => { TRY_FORCE = a[1]; const m = a[2]; Q.length = 0; Q.push([m, m.events[a[0] === 'try' ? 0 : 1]]); playFx(); }, [k, v, M(k)]);
    await p.waitForFunction(() => document.querySelector('#fx.on') && document.getAnimations().length > 5 && window.FX3D && FX3D.cur); await p.waitForTimeout(60); };
  const at = ms => p.evaluate(ms => { document.getAnimations().forEach(a => { a.pause(); a.currentTime = ms; }); FX3D.cur.seek(ms/1000); const w = FX3D.where(), cv = document.querySelector('#fx3dHost canvas'), g = cv.getContext('webgl2') || cv.getContext('webgl'), cs = e => getComputedStyle(e), q = s => document.querySelector(s);
    let lit = 0; try { const W = cv.width, H = cv.height, px = new Uint8Array(4), pts = [[.5, .15], [.5, .5], [.2, .2], [.8, .3], [.5, .08]]; pts.forEach(([x, y]) => { g.readPixels(Math.floor(W*x), Math.floor(H*y), 1, 1, g.RGBA, g.UNSIGNED_BYTE, px); if (px[3] > 0) lit++; }); } catch(e){ lit = -1; }
    return {w, lit, cvw:cv.clientWidth, cvh:cv.clientHeight, kind:q('#fxKind').textContent, kindOn:+cs(q('#fxKind span span') || q('#fxKind span')).opacity, who:q('#fxWho').textContent, crest:q('.fx-trycrest') ? +cs(q('.fx-trycrest')).opacity : null, d3:q('#fx').classList.contains('d3'), flat:!!q('#fx .fx-tball, #fx .fx-ball')}; }, ms);
  const done = async () => { await p.evaluate(() => { document.getAnimations().forEach(a => a.play()); document.querySelector('#fx').click(); }); await p.waitForTimeout(900); };
  const FXI = await p.evaluate(TRY_NAMES => Object.fromEntries(TRY_NAMES.map(v => [v, FX3D.info('try-' + v).impact])), order.all);
  for (const v of order.all){ await play('try', v); const a = await at(300), g = await at(1420), e = await at(2700);
    ok(a.d3 && !a.flat && a.cvw > 300 && (a.lit !== 0 || g.lit !== 0) && a.w.name === 'try-' + v, v + ': drawn in 3D on a ' + a.cvw + '×' + a.cvh + ' canvas' + (a.lit > 0 || g.lit > 0 ? ' (the picture has content)' : ''));
    ok(a.w.world[1] > 1 && g.w.world[1] < .95 && g.w.world[2] < 0 && a.kindOn < .1 && a.crest < .1, v + ': the ball is in the air at 0.3s and on the ground over the try line by 1.4s; the words wait for it');
    // no knock-on: it touches the ground once, where it is grounded, and never leaves it again
    { const I = Math.round(FXI[v]*1000), ys = []; for (let ms = 60; ms <= 3300; ms += 60) ys.push([ms, (await at(ms)).w.world]);
      const before = ys.filter(([ms]) => ms < I - 70), after = ys.filter(([ms]) => ms >= I), lowB = Math.min(...before.map(x => x[1][1])), hiA = Math.max(...after.map(x => x[1][1])), still = after.every(x => Math.abs(x[1][0] - after[0][1][0]) < .001 && Math.abs(x[1][2] - after[0][1][2]) < .001);
      ok(lowB > .8 && hiA <= .625 && still, v + ': no bounce. Before grounding the ball never comes lower than ' + lowB.toFixed(2) + ' m; once down it stays put and never rises (highest ' + hiA.toFixed(2) + ' m, resting on the turf)'); }
    const fl = (await at(Math.round(FXI[v]*1000) + 170)).w.line;
    ok(a.w.line === 0 && fl > .7 && e.w.line === 0, v + ': the try line is plain, flashes gold when the ball is grounded (' + fl + '), and goes back');
    if (v === 'meteor') ok((await at(900)).w.trail && (await at(1900)).w.fw, 'meteor: a streak of sparks on the way down, fireworks after');
    if (v === 'flyround'){ const c0 = (await at(200)).w.camx, c1 = (await at(1500)).w.camx, c2 = (await at(2800)).w.camx; ok(Math.abs(c0 - c1) > 3 && Math.abs(c1 - c2) > 2, 'flyround: the camera sweeps round the ball (' + [c0, c1, c2].join(' → ') + ')'); }
    if (v === 'party'){ const hs = []; for (let ms = 1300; ms <= 2700; ms += 40) hs.push((await at(ms)).w.py); ok(Math.max(...hs) > .5 && e.w.py === 0 && e.w.pr === 0, 'party: the posts hop for joy after the grounding (' + Math.max(...hs).toFixed(2) + ' m) and finish standing straight'); }
    ok(e.crest > .9 && /TRY!/.test(e.kind) && e.kindOn > .9 && /Gus Hart/.test(e.who), v + ': then the crest, TRY! and the scorer'); await done(); }
  await play('con', ''); { const a = await at(200), o = await at(1350), e = await at(2700);
    ok(a.d3 && !a.flat && a.w.name === 'kick' && a.w.world[2] > 10 && a.w.world[1] < 1.5, 'conversion: in 3D, starting with the ball on the tee in front of the posts');
    ok(Math.abs(o.w.world[2]) < .6 && o.w.world[1] > 3.6 && Math.abs(o.w.world[0]) < 2.4 && o.w.x > o.w.upL[0] && o.w.x < o.w.upR[0] && o.w.y < o.w.upL[1], 'conversion: at the posts the ball is ' + o.w.world[1].toFixed(1) + ' m up, over the 3 m bar and between the uprights');
    const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), f = rgb((await at(1520)).w.post), calm = rgb(a.w.post), end = rgb(e.w.post);
    ok(calm.join() === '255,255,255' && f[0] > 200 && f[1] > 150 && f[2] < 150 && f[0] > f[2] + 80 && end.join() === '255,255,255', 'conversion: the posts are white, flash gold as it goes over (' + (await at(1520)).w.post + '), and go back to white');
    ok((await at(1520)).w.ballc === '#ffffff', 'conversion: the ball stays white when the kick is good');
    ok(/CONVERTED/.test(e.kind) && e.kindOn > .9 && /Cal Weir/.test(e.who), 'conversion: then CONVERTED and the kicker'); await done(); }
  // conversions with some show: three more, taken in turn with the plain kick
  const kord = await lv(p, () => { const ev = (i, k, s, miss) => ({id:'e' + i, k, s, p:'Cal Weir', m:i, ts:i, miss:!!miss}), m = {id:'tvA', team:'1XV', home:'ERGS', away:'Portora', events:[ev(1, 'con', 'H'), ev(2, 'pen', 'A'), ev(3, 'con', 'H', true), ev(4, 'dg', 'H'), ev(5, 'con', 'H'), ev(6, 'con', 'A'), ev(7, 'pen', 'H'), ev(8, 'dg', 'H'), ev(9, 'con', 'H')]};
    const good = m.events.filter(e => !e.miss); return {cons:good.map(e => kickVar(m, e)), all:KICK_VARS.slice()}; });
  ok(kord.all.length === 6 && new Set(kord.cons.slice(0, 6)).size === 6 && kord.cons[6] === kord.cons[0], 'six kick animations taken in turn through a match, conversions, penalties and drop goals alike (' + kord.cons.slice(0, 6).map(x => x.replace('kick-', '')).join(' → ') + '), all six before any repeats');
  const rgbh = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  for (const v of ['kick-rocket', 'kick-hoops', 'kick-dance', 'kick-comet', 'kick-orbit']){ await lv(p, v => { KICK_FORCE = v; }, v); await play('con', ''); const a = await at(200), mid = await at(900), o = await at(1350), f = await at(1520), late = await at(1900), e = await at(3300), n = v.replace('kick-', '');
    ok(a.d3 && a.w.name === v && a.w.world[2] > 10 && a.w.world[1] < 1.5, n + ': starts with the ball on the tee');
    ok(Math.abs(o.w.world[2]) < .6 && o.w.world[1] > 3.6 && Math.abs(o.w.world[0]) < 2.4, n + ': at 1.35s the ball is ' + o.w.world[1].toFixed(1) + ' m up, over the bar and between the uprights');
    { const c = rgbh(f.w.post); ok(c[0] > 200 && c[1] > 130 && c[2] < 120 && f.w.ballc === '#ffffff', n + ': the posts flash gold (' + f.w.post + ') and the ball stays white'); }
    ok(late.w.fw && !a.w.fw && !(await at(3950)).w.fw, n + ': fireworks go off after it is over, and are gone by the end');
    if (n === 'rocket') ok(mid.w.trail && !a.w.trail && !e.w.trail, 'rocket: a streak of sparks follows the ball in flight');
    if (n === 'dance'){ const hops = []; for (let ms = 1380; ms <= 2700; ms += 40) hops.push((await at(ms)).w.py); ok(mid.w.psy > 1.05 && Math.max(...hops) > .5 && e.w.py === 0 && e.w.psy === 1 && e.w.pr === 0 && a.w.pr !== 0, 'dance: the posts sway while waiting, stretch up as the ball comes (' + mid.w.psy + '× tall), hop when it is over (' + Math.max(...hops).toFixed(2) + ' m off the ground) and finish standing straight'); }
    if (n === 'hoops'){ const h0 = a.w.hoops, hm = (await at(700)).w.hoops; ok(hm >= 3 && e.w.hoops === 0, 'hoops: gold hoops hang along the flight (' + hm + ' showing mid-flight) and have all popped by the end'); }
    if (n === 'comet') ok(mid.w.trail && a.w.camx > 9 && (await at(1500)).w.hoops >= 1, 'comet: seen from out to the side, with a tail of sparks and a ring bursting from the posts as it goes over');
    if (n === 'orbit') ok(a.w.camz > 15 && o.w.camz < 0, 'orbit: the camera starts behind the kicker and has swung right round to beyond the posts as the ball clears the bar');
    ok(/CONVERTED/.test(e.kind) && e.kindOn > .9, n + ': then CONVERTED'); await done(); }
  await lv(p, () => { KICK_FORCE = ''; });
  // a drop goal has no kicking tee; a conversion does
  { const tee = async k => { await lv(p, k => { KICK_FORCE = 'kick'; const m = {id:'tvA', team:'1XV', home:'ERGS', away:'Portora', status:'1H', code:'union', events:[{id:'k1', k, s:'H', p:'Cal Weir', m:5, ts:2}]}; Q.length = 0; Q.push([m, m.events[0]]); playFx(); }, k);
      await p.waitForFunction(() => document.querySelector('#fx.on') && window.FX3D && FX3D.cur); await p.waitForTimeout(60); const r = (await at(200)).w.tee; await done(); return r; };
    ok(await tee('con') === true && await tee('dg') === false, 'a conversion starts on a kicking tee; a drop goal has none'); await lv(p, () => { KICK_FORCE = ''; }); }
  await play('miss', ''); { const o = await at(1350), e = await at(2700);
    ok(o.w.name === 'kick-miss' && o.w.world[0] > 2.9 && o.w.x > o.w.upR[0], 'a missed conversion goes wide of the right-hand upright (' + o.w.world[0].toFixed(1) + ' m from the middle; the upright is at 2.8 m)');
    const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), fw = (await at(1520)).w.post, f = rgb(fw);
    ok(f[0] > 200 && f[1] < 110 && f[2] < 110, 'a missed conversion makes the posts flash red (' + fw + ')');
    const bw = (await at(1520)).w.ballc, bf = rgb(bw), b0 = (await at(600)).w.ballc, b1 = (await at(2700)).w.ballc;
    ok(b0 === '#ffffff' && bf[0] > 200 && bf[1] < 110 && bf[2] < 110 && b1 === '#ffffff', '…and the ball flashes red with them (' + bw + '), white before and after');
    ok(/CONVERSION\s*MISSED/.test(e.kind), '…and says CONVERSION MISSED'); await done(); }
  ok(await p.evaluate(() => !document.querySelector('#fx3dHost canvas') && !FX3D.cur), 'the 3D picture is cleared away when the animation closes');
  ok(!p.errs.length, 'no page errors ' + p.errs.join(' | ')); await p.close();
  // a phone set to reduce motion keeps the flat picture
  { const q = await open(b, 'coach', {ctx:await b.newContext({viewport:{width:390, height:700}, reducedMotion:'reduce'})}); await q.addInitScript(() => { try { sessionStorage.setItem('ergs.liveOK', '1'); } catch(e){} }); await q.goto('http://app.test/?live'); await q.waitForTimeout(5000);
    await lv(q, () => fx3dLoad()); await lv(q, m => { Q.length = 0; Q.push([m, m.events[0]]); playFx(); }, M()); await q.waitForTimeout(300);
    ok(await q.evaluate(() => !document.querySelector('#fx').classList.contains('d3') && !!document.querySelector('#fx .fx-try .fx-tball')), 'with “reduce motion” on, the flat picture is used'); await q.close(); }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
