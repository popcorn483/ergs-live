// The 'Who is not on the app' report is reachable from Squads and Access (24 November 2026)
// usage: STUB3=1 node flow33.js
const { chromium } = require('playwright'); const { open } = require('./real.js');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
(async () => { const b = await chromium.launch(); const p = await open(b, 'admin', {ctx:await b.newContext({viewport:{width:420, height:900}})});
  await p.addInitScript(() => localStorage.setItem('ergs.pwNo', '1')); await p.goto('http://app.test/app/'); await p.waitForTimeout(6000);
  await p.evaluate(() => window.__int.go('squads')); await p.waitForTimeout(2500);
  ok(await p.$eval('#sqNsu', e => !!e.offsetParent && /not on the app/.test(e.textContent)), 'Squads has “Who’s not on the app”, on screen at phone width');
  await p.evaluate(() => window.__int.go('people')); await p.waitForTimeout(2500);
  await p.evaluate(() => [...document.querySelectorAll('#people button')].find(b => b.offsetParent && /^\s*Players/i.test(b.textContent)).click()); await p.waitForTimeout(2000);
  ok(await p.$eval('#naRep', e => !!e.offsetParent), 'Access › Players has the report button, on screen'); await p.click('#naRep'); await p.waitForTimeout(1500);
  const t = await p.evaluate(() => { const m = document.querySelector('#tagModal'); return !m.hidden ? m.textContent.replace(/\s+/g, ' ').slice(0, 260) : ''; });
  ok(/Who’s not on the app yet/.test(t) && /of \d+ players/.test(t), 'it opens the report: ' + t.slice(0, 150));
  ok(await p.$('#nsuCopy') && await p.$('#nsuCsv') && await p.$('#nsuNever'), 'with squad filter, never-opened option, Copy and Download spreadsheet');
await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
