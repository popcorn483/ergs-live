// Real data layer on the fake database, two devices: likes, photo tags, a score request, a headshot, the rules check, a full database.
const { chromium } = require('playwright'); const { open, fmt } = require('./real.js');
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => { const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1300, height:1000}});
  const A = await open(b, 'admin', {ctx}), P = await open(b, 'player', {ctx}); const ME = 'adam.armstrong0@example.com';
  await A.addInitScript(() => { window.__deny = ['audit']; });   // the audit rule hasn't been published (as now, for real)
  await A.goto('http://app.test/app/'); await A.waitForTimeout(9000); await P.goto('http://app.test/app/'); await P.waitForTimeout(9000); await A.cost(); await P.cost();
  const doc = (pg, path) => pg.evaluate(p => { const v = window.__fs.store.get(p); return v === undefined ? null : JSON.parse(JSON.stringify(v)); }, path);
  // ---- the rules check: the admin is told the activity log can't be read
  const banner = await A.evaluate(() => { const b = document.querySelector('#rcNote'); return b ? b.innerText.replace(/\s+/g, ' ').slice(0, 160) : null; });
  ok(banner && /activity log/i.test(banner), 'admin sees the "publish the rules" note, naming the activity log: ' + banner);
  // ---- likes: the player likes two photos, unlikes one (one write each, no delete); the coach's device sees it on Photos
  console.log('likes'); await P.nav('photos'); await P.waitForTimeout(1500); await P.cost();
  await P.evaluate(async () => { const lk = window.__ev('lkToggle'); await lk({id:'phA', name:'a.jpg'}, 'S1'); await lk({id:'phB', name:'b.jpg'}, 'S1'); await lk({id:'phA', name:'a.jpg'}, 'S1'); });
  await P.waitForTimeout(600); let c = await P.cost(); let d = await doc(P, 'likes/' + ME);
  ok(d && d.p && d.p.phB && !d.p.phA && d.p.ph0, 'likes record has phB, not phA, and still the earlier likes: ' + Object.keys(d.p).slice(0, 4).join(',') + '…');
  ok(c.wr.likes === 3 && c.writes === 3, '3 changes = 3 writes (it was 4 writes and a delete): ' + JSON.stringify(c.wr));
  await A.nav('photos'); await A.waitForTimeout(2500); let n = await A.evaluate(() => { const m = window.__ev('lkCounts')().get('phB'); return m ? m.n : 0; }); ok(n === 1, 'the coach’s device counts the like on phB: ' + n);
  await P.evaluate(async () => { await window.__ev('lkToggle')({id:'phB', name:'b.jpg'}, 'S1'); }); await A.waitForTimeout(21000); await A.evaluate(() => window.__ev('phFresh')()); await A.waitForTimeout(1500);
  n = await A.evaluate(() => { const m = window.__ev('lkCounts')().get('phB'); return m ? m.n : 0; }); ok(n === 0, 'after the unlike (and a refresh on Photos) it is gone on the coach’s device: ' + n); c = await A.cost(); console.log('     coach on Photos, with two refreshes:', fmt(c));
  // ---- photo tags: tag, then untag the only new one; a coach removes another
  console.log('tags'); await P.evaluate(async () => { await window.__ev('tgAdd')({id:'phZ', name:'z.jpg'}, 0.4, 0.5); }); await P.waitForTimeout(500); d = await doc(P, 'phtags/' + ME); ok(d.p.phZ && d.p.ph0, 'tag saved alongside the earlier ones');
  await P.evaluate(async () => { await window.__ev('tgRemove')({id:'phZ'}); }); await P.waitForTimeout(500); d = await doc(P, 'phtags/' + ME); ok(d && !d.p.phZ && d.p.ph0, 'tag removed, record kept');
  await A.waitForTimeout(21000); await A.evaluate(() => window.__ev('phFresh')()); await A.waitForTimeout(1500);
  ok(await A.evaluate(me => window.__ev('tgOn')('ph0').some(x => x.email === me), ME), 'coach sees the player tagged on ph0');
  await A.evaluate(async me => { await window.__ev('tgCoachRemove')(me, 'ph0'); }, ME); await A.waitForTimeout(600); d = await doc(A, 'phtags/' + ME); ok(d && !d.p.ph0 && Object.keys(d.p).length === 4, 'coach removed one tag; the other four stay: ' + Object.keys(d.p).join(','));
  await P.waitForTimeout(21000); await P.evaluate(() => window.__ev('phFresh')()); await P.waitForTimeout(1500); ok(await P.evaluate(() => !window.__ev('TG').mine.ph0), 'the player’s device drops it after a refresh');
  // ---- headshot: the player sends one; the admin's home page says so without fetching every headshot
  console.log('headshot'); await A.nav('menu'); await A.waitForTimeout(800); await A.cost();
  // (the rules allow one a season: a second is refused until a coach lets them send another)
  const again = await P.evaluate(async me => { try { await window.ERGS_AUTH.setAccess('headshots', me, {status:'pending', photo:'data:image/jpeg;base64,AAAA', season:'2026-27', at:Date.now(), name:'Adam Armstrong', team:'U12'}); return 'saved'; } catch(e){ return e.code; } }, ME);
  ok(again === 'not_granted', 'a second headshot in a season is refused: ' + again); await P.evaluate(() => (window.__denied || []).splice(0));
  await A.evaluate(async me => { await window.ERGS_AUTH.setAccess('headshots', me, {status:'open', reset:Date.now(), by:'ergsrugby@gmail.com'}); }, ME); await A.waitForTimeout(1200);
  let note0 = await A.evaluate(() => { const n = document.querySelector('#hsNote'); return n && !n.hidden ? n.innerText.replace(/\s+/g, ' ') : null; }); ok(note0 && /1 headshot /.test(note0), 'after a coach lets them send another, one is left waiting: ' + note0); await A.cost();
  await P.evaluate(async me => { await window.ERGS_AUTH.setAccess('headshots', me, {status:'pending', photo:'data:image/jpeg;base64,AAAA', season:'2026-27', at:Date.now(), name:'Adam Armstrong', team:'U12'}); }, ME);
  await A.waitForTimeout(1500); const note = await A.evaluate(() => { const n = document.querySelector('#hsNote'); return n && !n.hidden ? n.innerText.replace(/\s+/g, ' ') : null; }); ok(note && /2 headshots/.test(note), 'admin home: ' + note); c = await A.cost(); ok((c.by.headshots || 0) <= 2, 'which cost ' + (c.by.headshots || 0) + ' headshot read(s)');
  // ---- a score request, with the database refusing writes (as on Saturday night), then working
  console.log('score request'); const mid = await P.evaluate(() => { const m = window.__int.Cloud.matches.find(x => x.status === 'FT' && x.team === 'U14' && !(x.events || []).length) || window.__int.Cloud.matches.find(x => x.status === 'FT'); return m && m.id; });
  await P.evaluate(async ([me, mid]) => { await window.ERGS_AUTH.setAccess('pstats', me, {g:{[mid]:{p:1, pos:'9', sc:{try:1}, scAt:Date.now()}}, name:'Adam Armstrong', team:'U14', at:Date.now()}); }, [ME, mid]);
  await A.waitForTimeout(2000); let pend = await A.evaluate(() => window.__ev('srqPending')().map(r => [r.em, r.m.id])); console.log('     pending:', JSON.stringify(pend));
  if (pend.length){ await A.evaluate(() => { window.__quota = true; }); const msg = await A.evaluate(async () => { const r = window.__ev('srqPending')()[0]; try { await window.__ev('srqDecide')(r, true); return 'saved'; } catch(e){ return window.__ev('srqWhy')(e); } });
    ok(/storage is full|quota/i.test(msg), 'with the database refusing writes the coach is told why: ' + msg);
    await A.evaluate(() => { window.__quota = false; }); const res = await A.evaluate(async () => { const r = window.__ev('srqPending')()[0]; try { await window.__ev('srqDecide')(r, true); return 'saved'; } catch(e){ return String(e && e.message); } });
    await A.waitForTimeout(800); const st = JSON.parse((await doc(A, 'live/state')).json), m = st.matches.find(x => x.id === pend[0][1]);
    ok(res === 'saved' && (m.events || []).some(e => e.claim === pend[0][0] && e.k === 'try'), 'then it saves: the try is on the result (' + res + ')'); { const left = await A.evaluate(() => window.__ev('srqPending')().map(r => r.em)); ok(left.length === pend.length - 1 && !left.includes(pend[0][0]), 'and that request is no longer waiting (left: ' + left.join(', ') + ')'); } }
  else ok(false, 'no pending score request was found for match ' + mid);
  console.log('errors', A.errs.concat(P.errs).filter(e => !/reading 'set'/.test(e)).slice(0, 6), [...new Set(A.cons.concat(P.cons))].slice(0, 6));
  await b.close(); })();
