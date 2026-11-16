// Match videos in Video analysis: every match with a video link, filtered by season and team, with the result; coach notes shared with ERGS Live.
const { chromium } = require('playwright'); const { open } = require('./real.js');
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => { const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1200, height:1000}});
  const P = await open(b, 'coach', {ctx}); await P.goto('http://app.test/app/'); await P.settle(3000);
  let r = await P.evaluate(async () => { const ev = window.__ev, C = ev('Cloud'), us = ev('usOf'), ms = C.matches.filter(m => us(m)), ft = ms.filter(m => m.status === 'FT').slice(0, 5), pre = ms.find(m => m.status === 'pre');
    const by = {}; ft.forEach((m, i) => by[m.id] = i % 2 ? 'https://youtu.be/dQw4w9WgXcQ' : 'https://app.veo.co/matches/' + m.id + '/'); if (pre) by[pre.id] = 'https://app.veo.co/matches/pre/';
    await C.set('team/veo', {byMatch:by, updated:Date.now()}); return {n:Object.keys(by).length, ids:ft.map(m => m.id), teams:[...new Set(ft.map(m => m.team))], total:ms.length}; });
  const ids = r.ids; console.log('     seeded', JSON.stringify(r));
  await P.nav('anl'); await P.waitForTimeout(2500);
  let v = await P.evaluate(() => { const b = document.querySelector('#mvBox'); return b ? {cards:b.querySelectorAll('.mv-card').length, first:b.querySelector('.mv-card').innerText.replace(/\s+/g, ' ').slice(0, 170), seasons:[...b.querySelectorAll('#mvSeason option')].map(o => o.textContent), teams:[...b.querySelectorAll('#mvTeam option')].map(o => o.textContent), n:b.querySelector('.mv-n').textContent} : null; });
  ok(v && v.cards >= 1 && /v .+ (Home|Away)/.test(v.first) && /(Won|Lost|Drew) \d+–\d+|Not played/.test(v.first) && /(Watch|Analyse) on (VEO|YouTube)/i.test(v.first), 'coach sees the match videos with opposition and result: ' + JSON.stringify(v).slice(0, 420));
  r = await P.evaluate(() => { const s = document.querySelector('#mvSeason'); s.value = 'all'; s.onchange({target:s}); const all = document.querySelectorAll('#mvBox .mv-card').length; const t = document.querySelector('#mvTeam'), pick = t.options[1].value; t.value = pick; t.onchange({target:t});
    const cards = [...document.querySelectorAll('#mvBox .mv-card')]; return {all, pick, n:cards.length, ok:cards.every(c => c.querySelector('.mv-t small').textContent.includes(pick))}; });
  ok(r.all === 6 && r.n >= 1 && r.n <= r.all && r.ok, 'filters: all seasons shows every video, picking a team shows only that team: ' + JSON.stringify(r));
  await P.evaluate(() => { const t = document.querySelector('#mvTeam'); t.value = ''; t.onchange({target:t}); document.querySelector('#mvBox [data-mvnote]').click(); }); await P.waitForTimeout(300);
  const mid = await P.evaluate(() => { const f = document.querySelector('#mvBox [data-mvsave]'); f.querySelector('textarea').value = 'Lineout was excellent. Work on exits.'; f.requestSubmit(); return f.dataset.mvsave; }); await P.waitForTimeout(1500);
  r = await P.evaluate(id => { const d = window.__fs.store.get('totw/matchnotes'), j = d && JSON.parse(d.j); return {saved:j && j.byMatch[id], shown:(document.querySelector('#mvBox .mv-note') || {}).textContent}; }, mid);
  ok(r.saved && /Lineout/.test(r.saved.text) && r.saved.by && /Lineout/.test(r.shown || ''), 'a coach note saves (coach-only record) and shows on the card: ' + JSON.stringify(r).slice(0, 200));
  // ERGS Live: the same note on the match page
  await P.waitForTimeout(600); const L = await open(b, 'coach', {ctx}); await L.goto('http://app.test/#m.' + mid); await L.waitForTimeout(5000);
  r = await L.evaluate(() => { const t = document.querySelector('#mNoteIn'); return t ? {v:t.value, open:t.closest('details').open} : null; });
  ok(r && /Lineout/.test(r.v) && r.open, 'ERGS Live shows the same note on that match, opened: ' + JSON.stringify(r));
  await L.evaluate(() => { document.querySelector('#mNoteIn').value = 'Changed on Live.'; document.querySelector('#mNoteForm').requestSubmit(); }); await L.waitForTimeout(1500);
  r = await L.evaluate(id => JSON.parse(window.__fs.store.get('totw/matchnotes').j).byMatch[id], mid);
  ok(r && r.text === 'Changed on Live.', 'and saving it on ERGS Live updates the same record: ' + JSON.stringify(r));
  // a player: the videos, never the notes
  await L.waitForTimeout(600); const Q = await open(b, 'player', {ctx}); await Q.goto('http://app.test/app/'); await Q.settle(3000); await Q.waitForTimeout(1500);
  r = await Q.evaluate(() => ({menu:[...document.querySelectorAll('#menuList h3, #menuList .t, #menuList b')].some(x => /video analysis/i.test(x.textContent))})); await Q.nav('anl'); await Q.waitForTimeout(2500);
  const r3 = await Q.evaluate(() => { const b = document.querySelector('#mvBox'); return b ? {cards:b.querySelectorAll('.mv-card').length, note:!!b.querySelector('.mv-note, [data-mvnote], textarea'), links:b.querySelectorAll('.mv-card a[href]').length, priv:Object.keys((window.__ev('Cloud').docs['totw/matchnotes'] || {})).length} : null; });
  ok(r.menu && r3 && r3.cards >= 1 && r3.links === r3.cards && !r3.note && !r3.priv, 'a player gets Video analysis with the videos and no coach notes: ' + JSON.stringify(r) + JSON.stringify(r3));
  await P.bringToFront(); await P.screenshot({path:process.argv[2] + '/match-videos.png', scale:'css'});
  console.log('     errors', P.errs.concat(L.errs, Q.errs).filter(e => !/reading 'set'/.test(e)).slice(0, 4)); await b.close(); })();
