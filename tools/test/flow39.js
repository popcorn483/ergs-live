// The intro animation when the team app opens: a 3D kick through the posts, then the crest spins in (28 November 2026)
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
  await p.waitForTimeout(700 - (Date.now() - t0));
  const fly = await p.evaluate(() => { const m = getComputedStyle(document.querySelector('#intro .in-ballw')).transform, s = getComputedStyle(document.querySelector('#intro .in-ball')).transform; return {z:/matrix3d/.test(m) ? +m.slice(9, -1).split(',')[14] : null, spin:/matrix3d/.test(s)}; });
  ok(fly.z !== null && fly.z < -50 && fly.spin, 'mid-flight the ball is deep in the picture (' + Math.round(fly.z) + 'px back) and tumbling in 3D');
  await p.waitForTimeout(2350 - (Date.now() - t0));
  const mid = await p.evaluate(() => { const e = document.querySelector('#intro'); if (!e) return null; return {coin:+getComputedStyle(e.querySelector('.in-coin')).opacity, ball:+getComputedStyle(e.querySelector('.in-ballw')).opacity, posts:+getComputedStyle(e.querySelector('.in-posts')).opacity}; });
  ok(mid && mid.coin > .9 && mid.ball < .1 && mid.posts < .1, 'then the ball has gone through the posts and the crest has landed');
  await p.waitForTimeout(3900 - (Date.now() - t0));
  ok(!(await p.$('#intro')), 'it clears itself after about 3 seconds and the app is underneath');
  ok(!/intro/.test(p.url()), 'the ?intro used to replay it is taken off the address');
  await p.goto('http://app.test/app/?intro', {waitUntil:'commit'}); await p.waitForSelector('#intro'); await p.waitForTimeout(300); await p.click('#intro'); await p.waitForTimeout(500);
  ok(!(await p.$('#intro')), 'a tap skips it');
  await p.goto('http://app.test/app/'); await p.waitForTimeout(1500);
  ok(!(await p.$('#intro')), 'it is not played again in the same visit');
  ok(!p.errs.filter(x => !/reading 'set'|sandboxed/.test(x)).length, 'no page errors ' + p.errs.join(' | '));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
