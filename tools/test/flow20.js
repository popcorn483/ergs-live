// A sign-in look-up that gets no answer must not leave the app stuck (18 November 2026)
// usage: STUB3=1 node flow20.js
const { chromium } = require('playwright'); const { open } = require('./real.js');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const role = p => p.evaluate(() => window.__int && window.__int.Cloud.role), mode = p => p.evaluate(() => window.__int && window.__int.Cloud.mode);
(async () => { const b = await chromium.launch();
  // 1. a player whose look-up never answers: the check ends, with Try again
  { const p = await open(b, 'player', {ctx:await b.newContext({viewport:{width:420, height:900}})});
    await p.addInitScript(() => { window.__slowMs = 1500; window.__hangGet = /^(coaches|players)\//; });
    await p.goto('http://app.test/app/'); await p.waitForTimeout(6000);
    ok(await mode(p) !== 'pending', 'look-ups never answer: the app stops waiting (' + await mode(p) + ')');
    ok(/couldn’t check your access/.test(await p.evaluate(() => (document.querySelector('#rqForm h2') || {}).textContent || '')) && await p.$('#rqRetry'), '…and says it couldn’t check, with Try again');
    ok(/couldn’t reach its database/.test(await p.evaluate(() => (document.querySelector('#rqForm p') || {}).textContent || '')), '…as a connection problem, not a rules one');
    ok(!(await p.evaluate(() => window.ERGS_AUTH.getOne('requests', window.ERGS_AUTH.email).catch(() => null))), '…and no request is left for someone who may well be on a list'); }
  // 2. someone not on a list whose request is never confirmed: the app still opens the form
  { const p = await open(b, 'public', {ctx:await b.newContext({viewport:{width:420, height:900}})});
    await p.addInitScript(() => { window.__hangSet = /^requests\//; localStorage.setItem('ergs.joinAs', 'player'); });
    await p.goto('http://app.test/app/'); await p.waitForTimeout(5000);
    ok(await role(p) === 'public' && await mode(p) === 'db', 'request write never confirmed: the app carries on (' + await mode(p) + ')');
    ok(await p.$('#rqfN'), '…and shows the "who are you" form'); }
  // 3. nothing wrong: unchanged
  { const p = await open(b, 'player', {ctx:await b.newContext({viewport:{width:420, height:900}})});
    await p.goto('http://app.test/app/'); await p.waitForTimeout(4000); ok(await role(p) === 'player', 'normal sign-in: player'); }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
