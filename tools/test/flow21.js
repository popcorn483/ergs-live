// Team of the Week on a phone: dragging a shirt on the picture with a finger moves it (22 November 2026)
// usage: STUB3=1 node flow21.js
const { chromium } = require('playwright'); const { open } = require('./real.js');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
(async () => { const b = await chromium.launch();
  const ctx = await b.newContext({viewport:{width:412, height:900}, hasTouch:true, isMobile:true, deviceScaleFactor:2});
  const p = await open(b, 'admin', {ctx});
  await p.addInitScript(() => localStorage.setItem('ergs.pwNo', '1'));
  await p.goto('http://app.test/app/'); await p.waitForTimeout(4000);
  await p.evaluate(() => window.__int.go('totw')); await p.waitForTimeout(3000);
  ok(await p.$('#twCanvas'), 'Team of the Week open');
  const shirt = () => p.evaluate(() => { const c = document.querySelector('#twCanvas'); c.scrollIntoView({block:'center'}); const r = c.getBoundingClientRect(), k = r.width/c.width, h = (window.__int.TW.phits || []).find(Boolean); return h ? {x:r.left + (h.x + h.w/2)*k, y:r.top + (h.y + h.h/2)*k, i:window.__int.TW.phits.indexOf(h)} : null; });
  const adj = i => p.evaluate(i => { const T = window.__int; return JSON.stringify((T.twCur(T.TW.side).adj || {})[i] || {}); }, i);
  const cdp = await ctx.newCDPSession(p);
  const swipe = async (x, y, dx, dy) => { await cdp.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x, y}]});
    for (let s = 1; s <= 8; s++){ await cdp.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{x:x + dx*s/8, y:y + dy*s/8}]}); await p.waitForTimeout(30); }
    await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]}); await p.waitForTimeout(400); };
  let s = await shirt(); ok(s, 'a shirt is on the picture');
  // move mode off: a finger drag scrolls the page and moves nothing
  const y0 = await p.evaluate(() => scrollY); await swipe(s.x, s.y, 0, -90);
  ok(await adj(s.i) === '{}', 'move mode off: a finger drag leaves the shirt where it is');
  ok(await p.evaluate(() => { const t = document.querySelector('#twMoveTop'); return !!t && t.offsetParent !== null; }), 'a "Move players" switch sits under the picture');
  await p.evaluate(() => document.querySelector('#twMoveTop').click()); await p.waitForTimeout(400);
  ok(await p.evaluate(() => window.__int.TW.moveMode && document.querySelector('#twMove').checked && getComputedStyle(document.querySelector('#twCanvas')).touchAction === 'none'), 'switched on: the picture takes the finger (and the tick box below follows)');
  s = await shirt(); const y1 = await p.evaluate(() => scrollY); await swipe(s.x, s.y, 40, 70);
  const a = JSON.parse(await adj(s.i));
  ok(a.x > 0 && a.y > 0, 'finger drag moves the shirt ' + JSON.stringify(a));
  ok(await p.evaluate(() => scrollY) === y1, '…and the page stays still');
  await p.evaluate(() => document.querySelector('#twMoveTop').click()); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !window.__int.TW.moveMode && getComputedStyle(document.querySelector('#twCanvas')).touchAction !== 'none'), 'switched off: the page scrolls over the picture again');
  // names are one size, and the same share of the normal size whatever size the picture is drawn at (still, animation, GIF)
  { const r = await p.evaluate(() => { const ev = window.__ev, G = ev("GA_G.find(g => g.key === 'totw')"), fx = ev("Object.keys(GA_ELEM)[0]"), c = document.createElement('canvas'), out = [];
      const N = ['Sophie Johnston','Amber Ferguson','Lexi McElwaine','Charlotte Gould','Bethany Carty','Pippa Armstrong','Emily Balfour','Torin Sholes','Megan Stephenson','Kristen Fee','Lily Sayers','Ben Wallace','Christopher Montgomery','Al Wu','Jo Bloggs'];
      ev("twEdit")(x => { x.adj = {}; x.players = N.map(n => ({f:n.split(' ')[0], l:n.split(' ')[1], t:'1XV'})); });
      for (const [w, h] of [[512, 640], [720, 900], [1080, 1350]]){ c.width = w; c.height = h; ev("gaElemDraw")(G, c.getContext('2d'), w, h, fx, 0.9999); out.push([...new Set(window.__int.TW.labs.map(l => l.k.toFixed(3)))].join('/')); }
      return out; });
    ok(r.every(x => !/\//.test(x)), 'a full team of real names: every name the same size (' + r.join(' ') + ')');
    const t = await p.evaluate(() => { const L = window.__int.TW.labs; return {slid:L.filter(l => l.dx).length, n:L.length, touch:window.__int.TW.labTouch}; });
    ok(t.slid <= 3, 'the pack and backs are spaced so names sit centred; only a very long one slides along (' + t.slid + ' of ' + t.n + ' slid)');
    ok(await p.evaluate(() => window.__int.TW.labs.find(l => l.i === 8).dx === 0), 'the scrum-half’s name (Megan Stephenson) is centred under the 9 shirt');
    { const d9 = await p.evaluate(async () => { const ev = window.__ev; ev("twEdit")(x => { x.numX = 1; }); await new Promise(r => setTimeout(r, 400)); const v = window.__int.TW.labs.find(l => l.i === 8).dx; ev("twEdit")(x => { x.numX = 0; }); return v; });
      ok(d9 === 0, '…also when the numbers have been nudged by hand'); }
    ok(r.every(x => x === '1.000'), '…all at full size (' + r[0] + ')');
    ok(t.touch < 0.02, '…and nothing is left touching (' + t.touch + ')');
    ok(new Set(r).size === 1, '…and the same at GIF, animation and full size'); }
  await p.evaluate(() => document.querySelector('#twCanvas').scrollIntoView({block:'start'})); await p.locator('#twCanvas').screenshot({path:'/tmp/totw.png'});
  { const e = p.errs.filter(x => !/reading 'set'/.test(x)); ok(!e.length, 'no page errors (3D stub aside) ' + e.join(' | ')); }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
