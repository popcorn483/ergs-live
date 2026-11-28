// The intro animation when the team app opens: a boot kicks the ball off a tee and through the posts in 3D, then the crest spins in (28 November 2026)
// usage: STUB3=1 node flow39.js
const { chromium } = require('playwright'); const { open } = require('./real.js');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
(async () => { const b = await chromium.launch(); const p = await open(b, 'public', {ctx:await b.newContext({viewport:{width:390, height:780}})});
  await p.goto('http://app.test/app/?intro', {waitUntil:'commit'}); await p.waitForSelector('#intro', {timeout:15000}); const t0 = Date.now();
  const i = await p.evaluate(() => { const e = document.querySelector('#intro'), r = e.getBoundingClientRect(), cs = s => getComputedStyle(e.querySelector(s)); return {full:r.width >= innerWidth && r.height >= innerHeight, slices:e.querySelectorAll('.in-ball i').length, posts:e.querySelectorAll('.in-posts path').length, crest:(e.querySelector('.in-crest') || {}).src || '', word:e.querySelector('.in-word').textContent,
    persp:cs('.in-stage').perspective, p3:[cs('.in-world').transformStyle, cs('.in-ball').transformStyle, cs('.in-coin').transformStyle].join(), pitch:/matrix3d/.test(cs('.in-pitch').transform), edge:e.querySelectorAll('.in-coin .edge').length, back:!!e.querySelector('.in-coin .back')}; });
  ok(i.full && i.posts === 4 && /icon-512\.png$/.test(i.crest) && i.word === 'ERGS RUGBY', 'opening the app plays the intro full screen: posts, a rugby ball, the crest and “ERGS RUGBY”');
  ok(i.persp !== 'none' && i.p3 === 'preserve-3d,preserve-3d,preserve-3d' && i.pitch, 'it is real 3D: a perspective camera, and a pitch lying flat and running away to the posts');
  ok(i.slices === 12 && i.edge === 8 && i.back, 'the ball is solid (12 cross-sections) and the crest is a coin with an edge and a gold back');
  const at = ms => p.evaluate(ms => { document.getAnimations().forEach(a => { a.pause(); a.currentTime = ms; }); }, ms);
  const ball = () => p.evaluate(() => { const w = document.querySelector('#intro .in-ballw'), m = getComputedStyle(w).transform, v = /matrix3d/.test(m) ? m.slice(9, -1).split(',').map(Number) : null, r = w.getBoundingClientRect(), leg = document.querySelector('#intro .in-leg'); return {z:v ? v[14] : 0, y:Math.round(r.top + r.height / 2), size:Math.round(r.width), leg:+getComputedStyle(leg).opacity, tee:!!document.querySelector('#intro .in-tee')}; });
  await at(300); const still = await ball();
  ok(still.z > 100 && still.tee && still.y > 390, 'it starts with the ball sitting on a tee in front of you, not moving');
  await at(800); const swing = await ball();
  ok(swing.leg > .5 && Math.abs(swing.z - still.z) < 1 && Math.abs(swing.y - still.y) < 30, 'a boot swings in while the ball is still on the tee');
  await at(1500); const air = await ball();
  ok(air.y < still.y - 150 && air.z < still.z - 100 && air.size < still.size, 'the kick sends it up and away from you: higher, further back and smaller (' + still.size + 'px → ' + air.size + 'px)');
  await at(2100); const far = await ball();
  ok(far.z < -450 && far.size < air.size && far.leg < .05, 'it carries on down the pitch to the posts (' + Math.round(far.z) + 'px back), and the boot has gone');
  await at(3600);
  const mid = await p.evaluate(() => { const e = document.querySelector('#intro'); if (!e) return null; return {coin:+getComputedStyle(e.querySelector('.in-coin')).opacity, ball:+getComputedStyle(e.querySelector('.in-ballw')).opacity, posts:+getComputedStyle(e.querySelector('.in-posts')).opacity}; });
  ok(mid && mid.coin > .9 && mid.ball < .1 && mid.posts < .1, 'then it bursts over the bar and the crest has come back out and landed');
  await p.evaluate(() => document.getAnimations().forEach(a => a.play())); await p.waitForTimeout(3600);
  ok(!(await p.$('#intro')), 'it clears itself after about 5 seconds and the app is underneath');
  ok(!/intro/.test(p.url()), 'the ?intro used to replay it is taken off the address');
  await p.goto('http://app.test/app/?intro', {waitUntil:'commit'}); await p.waitForSelector('#intro'); await p.waitForTimeout(300); await p.click('#intro'); await p.waitForTimeout(500);
  ok(!(await p.$('#intro')), 'a tap skips it');
  await p.goto('http://app.test/app/'); await p.waitForTimeout(1500);
  ok(!(await p.$('#intro')), 'it is not played again in the same visit');
  ok(!p.errs.filter(x => !/reading 'set'|sandboxed/.test(x)).length, 'no page errors ' + p.errs.join(' | '));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
