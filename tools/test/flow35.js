// Squads: short one-line rows, and who has no email at a glance (24 November 2026)
// usage: STUB3=1 node flow35.js
const { chromium } = require('playwright'); const { open } = require('./real.js');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
(async () => { const b = await chromium.launch(); const p = await open(b, 'admin', {ctx:await b.newContext({viewport:{width:400, height:860}})});
  await p.addInitScript(() => localStorage.setItem('ergs.pwNo', '1')); await p.goto('http://app.test/app/'); await p.waitForTimeout(7000);
  await p.evaluate(() => { window.__ev("SQ.team = '*'"); window.__int.go('squads'); }); await p.waitForTimeout(3500);
  const tabs = await p.$$eval('#squads .sq-tabs [data-sqv]', e => e.filter(x => x.offsetParent).map(x => x.textContent.trim()));
  ok(tabs.join() === 'Squads,Coaches', 'the tabs are ' + tabs.join(' · ') + ' (no Team sheets)');
  const r = await p.evaluate(() => { const vis = e => !!e && !!e.offsetParent; const rows = [...document.querySelectorAll('#sqList .sq-row')].filter(vis); const h = rows.map(x => x.getBoundingClientRect().height);
    return {n:rows.length, max:Math.max(...h), grip:rows.filter(x => vis(x.querySelector('.sq-grip'))).length, pen:rows.filter(x => vis(x.querySelector('.sq-ed'))).length, nopos:rows.filter(x => vis(x.querySelector('.sq-chip.none'))).length, no:rows.filter(x => x.classList.contains('noacc')).map(x => x.querySelector('.sq-login').textContent.trim()), wide:rows.some(x => x.scrollWidth > x.clientWidth + 1)}; });
  ok(r.max <= 40, 'each player is one short line (' + r.max + 'px; it was 57px), so about ' + Math.floor(700 / r.max) + ' fit on a phone screen instead of 12');
  ok(!r.grip && !r.pen && !r.nopos && !r.wide, 'no drag handle, pencil or “No position” on a closed row, and nothing runs off the side');
  ok(r.no.length > 0 && r.no.every(t => t === 'No email'), 'players with no sign-in are marked “No email” (' + r.no.length + ')');
  const bar = await p.$$eval('#sqCleanBar button', e => e.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  ok(bar.length === 2 && bar[0] === 'All ' + r.n && bar[1] === 'No email yet ' + r.no.length, 'above the list: ' + bar.join(' | '));
  await p.click('#sqCleanBar [data-sqc="1"]'); await p.waitForTimeout(300);
  const f = await p.evaluate(() => { const vis = e => !!e && !!e.offsetParent; return {rows:[...document.querySelectorAll('#sqList .sq-row')].filter(vis).length, heads:[...document.querySelectorAll('#sqList .sq-gh')].filter(vis).length, allHeads:document.querySelectorAll('#sqList .sq-gh').length}; });
  ok(f.rows === r.no.length && f.heads > 0 && f.heads < f.allHeads, '“No email yet” shows only those ' + f.rows + ', under just their squads (' + f.heads + ' of ' + f.allHeads + ' headings)');
  await p.evaluate(() => [...document.querySelectorAll('#sqList .sq-row')].find(x => x.offsetParent).querySelector('.sq-login').click()); await p.waitForTimeout(600);
  ok(await p.$eval('#naE', e => !!e.offsetParent), 'tapping “No email” asks for their email'); await p.evaluate(() => window.__ev('tagModalClose()'));
  await p.click('#sqCleanBar [data-sqc=""]'); await p.waitForTimeout(300);
  await p.evaluate(() => [...document.querySelectorAll('#sqList .sq-row')].find(x => x.offsetParent).querySelector('.sq-sum').click()); await p.waitForTimeout(400);
  ok(await p.evaluate(() => { const e = document.querySelector('#sqList .sq-row.editing'); const vis = x => !!x && !!x.offsetParent; return !!e && vis(e.querySelector('.sq-grip')) && vis(e.querySelector('input[data-k="f"]')) && vis(e.querySelector('.sq-ts')); }), 'tapping a name still opens the player to edit, with the drag handle, name, position and squad');
  ok(!p.errs.filter(x => !/reading 'set'|sandboxed/.test(x)).length, 'no page errors ' + p.errs.join(' | '));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
