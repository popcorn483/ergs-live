// Automatic "New photos" posts are from ERGS Rugby, not from whichever coach's app made them (24 November 2026)
// usage: STUB3=1 node flow32.js
const { chromium } = require('playwright'); const { open } = require('./real.js');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
(async () => { const b = await chromium.launch(); const p = await open(b, 'admin', {ctx:await b.newContext({viewport:{width:420, height:900}})});
  await p.addInitScript(() => { localStorage.setItem('ergs.pwNo', '1'); const t = Date.now();
    window.__fsSeed['posts/albOLD1'] = {at:t - 1000, u:t, del:false, by:'coach0@example.com', byName:'Patrick Example', team:'*', text:'📸 New photos: Foyle\n108 photos are in the app.', links:[], pin:false, album:'OLD1'};
    window.__fsSeed['posts/nHAND1'] = {at:t - 2000, u:t, del:false, by:'coach0@example.com', byName:'Patrick Example', team:'*', text:'Training is at 3.30 on Thursday, boots and gumshields.', links:[], pin:false}; });
  await p.goto('http://app.test/app/'); await p.waitForTimeout(5000); await p.evaluate(() => window.__int.go('news')); await p.waitForTimeout(3000);
  const by = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.nw-av')].map(a => { const c = a.closest('article, li, .nw-post, section') || a.parentElement.parentElement; return [/New photos: Foyle/.test(c.textContent) ? 'album' : /gumshields/.test(c.textContent) ? 'hand' : '', a.textContent + ' / ' + a.parentElement.querySelector('b').textContent]; })));
  ok(by.album === 'ER / ERGS Rugby', 'a photo post already made under a coach’s name now shows as ' + by.album);
  ok(by.hand === 'PE / Patrick Example', 'a post a coach wrote keeps their name: ' + by.hand);
  ok(/byName:NW_AUTO, auto:true, team, text:`📸 New photos/.test(require('fs').readFileSync(__dirname + '/../../app/index.html', 'utf8')), 'new photo posts are saved as from ERGS Rugby');
  ok(!p.errs.filter(x => !/reading 'set'|sandboxed/.test(x)).length, 'no page errors ' + p.errs.join(' | '));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
