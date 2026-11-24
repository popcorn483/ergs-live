// Results graphic: a lead of more than 40 points is shown as 40 (24 November 2026)
// usage: STUB3=1 node flow24.js
const { chromium } = require('playwright'); const { open } = require('./real.js');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
(async () => { const b = await chromium.launch(); const p = await open(b, 'admin', {ctx:await b.newContext({viewport:{width:1100, height:900}})});
  await p.addInitScript(() => localStorage.setItem('ergs.pwNo', '1'));
  await p.goto('http://app.test/app/'); await p.waitForTimeout(4000);
  const rows = (cap) => p.evaluate(cap => { const ev = window.__ev; ev("RSG").cap = cap; const real = ev("rsgPicked");
    const mk = (id, h, a, us) => ({id, status:'FT', team:'1XV', home:us === 'H' ? 'ERGS' : 'Portora', away:us === 'H' ? 'Portora' : 'ERGS', final:[h, a], finalSet:true, date:'2026-11-21'});
    window.__ms = [mk('a', 62, 5, 'H'), mk('b', 45, 5, 'H'), mk('c', 0, 71, 'H'), mk('d', 7, 55, 'A'), mk('e', 19, 12, 'H')];
    return window.__ms.map(m => { const [h, a] = ev("mScore")(m); return h + '-' + a; }).join(' ') + ' | ' + ev("(() => { const keep = rsgPicked; rsgPicked = () => window.__ms; try { return rsgRows().map(r => r.key + ':' + r.us + '-' + r.them + ':' + r.res).sort().join(' ') + ' | ' + rsgCaption().split('\\\\n').filter(l => /–/.test(l)).length; } finally { rsgPicked = keep; } })()"); }, cap);
  let r = await rows(true); console.log('   ', r);
  ok(/a:45-5:W/.test(r), '62–5 is shown as 45–5');
  ok(/b:45-5:W/.test(r), 'exactly 40 ahead is left alone (45–5)');
  ok(/c:0-40:L/.test(r), 'a heavy defeat is capped too: 0–71 is shown as 0–40');
  ok(/d:47-7:W/.test(r), 'away from home: 7–55 to ERGS is shown as 47–7');
  ok(/e:19-12:W/.test(r), 'a close game is unchanged');
  r = await rows(false); ok(/a:62-5:W/.test(r) && /c:0-71:L/.test(r), 'switched off: the real scores');
  await p.evaluate(() => window.__int.go('rsg')); await p.waitForTimeout(1500);
  ok(await p.$eval('#rsgCap', e => e.checked === false), 'the tick box follows the setting');
  { const e = p.errs.filter(x => !/reading 'set'/.test(x)); ok(!e.length, 'no page errors ' + e.join(' | ')); }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
