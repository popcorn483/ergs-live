// "Open the album" in Team news: pressing it inside the app opens the album there (it used to be followed like a web link, which
// in the installed app lands on ERGS Live or does nothing). Google Drive is stood in for here.
const { chromium } = require('playwright'); const { open } = require('./real.js');
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => { const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:420, height:900}}); const P = await open(b, 'player', {ctx});
  await P.route('https://www.googleapis.com/drive/**', r => { const u = new URL(r.request().url()); const m = /\/files\/([^/?]+)/.exec(u.pathname);
    // as Google answers a request made with only the app's key: the folder's name, but not which folder it is in
    if (m) return r.fulfill({contentType:'application/json', body:JSON.stringify({id:m[1], name:m[1] === 'ALBUMFOLDER1' ? 'Dungannon 14 11 26' : 'Season'})});
    const q = decodeURIComponent(u.searchParams.get('q') || ''), F = 'application/vnd.google-apps.folder';
    return r.fulfill({contentType:'application/json', body:JSON.stringify({files:/'SEASONFOLDER1' in parents/.test(q) ? [{id:'OTHERALBUM', name:'Coleraine 07 11 26', mimeType:F}, {id:'ALBUMFOLDER1', name:'Dungannon 14 11 26', mimeType:F}] : []})}); });
  await P.addInitScript(() => { const S = window.__fsSeed, now = Date.now(); if (!S) return; S['team/photos'] = {j:JSON.stringify({seasons:[{folder:'SEASONFOLDER1', label:'2026-27'}], hidden:{}, links:{abc:'ALBUMFOLDER1'}, updated:now}), u:now};
    S['posts/albTEST1'] = {at:now, u:now, del:false, by:'coach0@example.com', byName:'Coach', team:'*', text:'📸 New photos: Dungannon 14 11 26\n82 photos are in the app.', links:[{u:'http://app.test/#pabc', t:'Open the album'}], pin:false, album:'ALBUMFOLDER1'};
    S['posts/albTEST2'] = {at:now - 1000, u:now, del:false, by:'coach0@example.com', byName:'Coach', team:'*', text:'📸 New photos: older link', links:[{u:'http://app.test/app/#a=ALBUMFOLDER1', t:'Open the album'}], pin:false}; });
  await P.goto('http://app.test/app/'); await P.settle(2500); await P.nav('news'); await P.settle(2000);
  for (const [i, what] of [[0, 'a short link (…/#pabc)'], [1, 'a long link (…/app/#a=…)']]){
    if (i){ await P.nav('news'); await P.waitForTimeout(1200); }
    const n = await P.evaluate(() => [...document.querySelectorAll('a.nw-link')].filter(a => /album/i.test(a.textContent)).length);
    const pages = ctx.pages().length; await P.evaluate(i => [...document.querySelectorAll('a.nw-link')].filter(a => /album/i.test(a.textContent))[i].click(), i); await P.waitForTimeout(2000);
    const st = await P.evaluate(() => ({screen:window.__int.S.screen, path:(window.__ev('PH').path || []).map(x => x.name).join(' / '), season:window.__ev('PH').season, url:location.href}));
    ok(n >= 2 && ctx.pages().length === pages && st.screen === 'photos' && /Dungannon/.test(st.path) && st.season === 'SEASONFOLDER1' && !/#/.test(st.url), `${what} opens the album in the app, with no new tab: ${JSON.stringify(st)}`); }
  console.log('     errors', P.errs.filter(e => !/reading 'set'/.test(e)).slice(0, 4));
  // ERGS Live already open when an album link arrives: it passes it on
  const L = await open(b, 'player', {ctx}); await L.addInitScript(() => { try { sessionStorage.setItem('ergs.liveOK', '1'); } catch(e){} }); await L.goto('http://app.test/?live'); await L.waitForTimeout(4000);
  await L.evaluate(() => { location.hash = '#pabc'; }); await L.waitForTimeout(3000);
  ok(/\/app\//.test(L.url()), 'ERGS Live, already open, passes an album link on to the team app: ' + L.url());
  await b.close(); })();
