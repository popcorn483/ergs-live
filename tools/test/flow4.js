// Real data layer on the fake database: what happens when the database can't be reached or has stopped answering, and the checks
// that keep a device's copy and the database in step.
const { chromium } = require('playwright'); const { open, fmt } = require('./real.js');
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) process.exitCode = 1; };
const APP = 'http://app.test/app/', ME = 'adam.armstrong0@example.com';
const keys = pg => pg.evaluate(() => new Promise(res => { const o = indexedDB.open('ergs-cache', 1); o.onupgradeneeded = () => o.result.createObjectStore('kv'); o.onerror = () => res(['ERR']);
  o.onsuccess = () => { const tx = o.result.transaction('kv', 'readonly'), rq = tx.objectStore('kv').getAllKeys(); tx.oncomplete = () => { res(rq.result); o.result.close(); }; }; }));
const doc = (pg, path) => pg.evaluate(p => { const v = window.__fs.store.get(p); return v === undefined ? null : JSON.parse(JSON.stringify(v)); }, path);
const errs = pg => pg.errs.filter(e => !/reading 'set'/.test(e)).concat([...new Set(pg.cons)].filter(c => !/Failed to load resource|net::ERR/.test(c)));
(async () => { const b = await chromium.launch();
  const only = process.argv[2] || '';
  if (!only || only === 'A'){
  console.log('A. the admin opens the app with no connection');
  { const ctx = await b.newContext({viewport:{width:1300, height:1000}}); const A = await open(b, 'admin', {ctx}); await A.addInitScript(() => { window.__offline = true; });
    await A.goto(APP); await A.waitForTimeout(5000);
    let st = await A.evaluate(() => { const C = window.__int.Cloud; return {mode:C.mode, role:C.role, lr:!!C.loaded['team/roster'], r:C.docs['team/roster'] === undefined ? 'undefined' : C.docs['team/roster'] === null ? 'null' : 'data', lm:!!C.loaded.matches, nm:(C.matches || []).length, q:window.__fs.queued(), log:window.__meter.log.filter(x => x[1] === 'offline').length}; });
    ok(st.role === 'coach' && !st.lr && st.r === 'undefined' && !st.lm, `nothing is taken as loaded (role ${st.role}; squad list: ${st.r}; matches loaded: ${st.lm}); the device made ${st.log} guesses, none passed on`);
    ok(!st.q.some(q => /team\/|requests\/|drills\/|faces\//.test(q)), 'nothing is waiting to be saved over the shared data: ' + JSON.stringify(st.q));
    const r = await A.evaluate(async () => { try { await window.__int.Cloud.set('team/roster', {players:[{id:'x', f:'New', l:'Player'}]}); return 'saved'; } catch(e){ return e.code || e.message; } });
    st.q = await A.evaluate(() => window.__fs.queued()); ok(r === 'not_loaded' && !st.q.some(q => /team\/roster/.test(q)), 'saving the squad list before it has arrived is refused: ' + r);
    const dr = await A.evaluate(async () => { const out = []; for (const f of [() => ERGS_AUTH.drillSync(0), () => ERGS_AUTH.probe('posts'), () => ERGS_AUTH.ids('faces'), () => ERGS_AUTH.recent('audit', 5), () => ERGS_AUTH.listWhere('headshots', 'status', 'removed')]){ try { const v = await f(); out.push('answered:' + JSON.stringify(v).slice(0, 20)); } catch(e){ out.push(e.code); } } return out; });
    ok(dr.every(x => x === 'unavailable'), 'look-ups answered from the empty device are refused, not believed: ' + dr.join(', '));
    await A.waitForTimeout(9500); let bar = await A.evaluate(() => { const b = document.querySelector('#netBar'); return b && !b.hidden ? b.innerText.replace(/\s+/g, ' ') : null; });
    ok(bar && /can’t reach/.test(bar), 'after 12 seconds the app says so: ' + bar);
    await A.evaluate(() => window.__fs.offline(false)); await A.waitForTimeout(5000);
    st = await A.evaluate(() => { const C = window.__int.Cloud, b = document.querySelector('#netBar'); return {lr:!!C.loaded['team/roster'], np:((C.docs['team/roster'] || {}).players || []).length, nm:(C.matches || []).length, bar:!!(b && !b.hidden), store:((window.__fs.store.get('team/roster') || {}).j || '').length, none:C.loaded['team/nomsAdj'], noneV:C.docs['team/nomsAdj']}; });
    ok(st.lr && st.np > 100 && st.nm > 5 && !st.bar, `back online: the squad list (${st.np} players) and ${st.nm} matches arrive, and the notice goes`);
    ok(st.store > 1000, 'the squad list in the database is untouched (' + st.store + ' characters)');
    console.log('     errors', errs(A).slice(0, 5)); await ctx.close(); } }
  if (!only || only === 'B'){
  console.log('B. a player: an ordinary visit, then one with no connection, then one with the day’s reads used up');
  { const ctx = await b.newContext({viewport:{width:420, height:900}}); const P = await open(b, 'player', {ctx}); await P.goto(APP); await P.settle(4000);
    const k0 = await keys(P); ok(k0.includes('w:' + ME + ':posts'), 'the device keeps a copy: ' + k0.join(', '));
    const req0 = await doc(P, 'requests/' + ME); await P.close();
    const P2 = await open(b, 'player', {ctx}); await P2.addInitScript(() => { window.__offline = true; }); await P2.goto(APP); await P2.waitForTimeout(6000);
    let st = await P2.evaluate(() => ({role:window.__int.Cloud.role, err:window.ERGS_AUTH.accessErr, q:window.__fs.queued(), gate:(document.querySelector('#rqForm') || document.querySelector('#gate') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 260)}));
    ok(st.role === 'public' && /unavailable/.test(st.err), 'no connection: the access check fails (' + st.err + ') and they aren’t taken for a new person');
    ok(!st.q.some(q => /requests\//.test(q)), 'no sign-in request is written for them: ' + JSON.stringify(st.q));
    ok(/couldn’t reach its database/.test(st.gate), 'they are told why: ' + st.gate.slice(0, 170));
    const k1 = await keys(P2); ok(k1.includes('w:' + ME + ':posts'), 'and the device’s copy is kept for next time'); await P2.close();
    const P3 = await open(b, 'player', {ctx}); await P3.addInitScript(() => { window.__quotaRead = true; }); await P3.goto(APP); await P3.waitForTimeout(5000);
    st = await P3.evaluate(() => ({role:window.__int.Cloud.role, err:window.ERGS_AUTH.accessErr, gate:(document.querySelector('#rqForm') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 260), wr:window.__meter.log.filter(x => x[1] === 'write').map(x => x[2])}));
    const req1 = await doc(P3, 'requests/' + ME);
    ok(st.role === 'public' && /exhausted/.test(st.err) && /free allowance/.test(st.gate), 'reads used up: ' + st.gate.slice(0, 190));
    ok(JSON.stringify(req0) === JSON.stringify(req1) && !st.wr.some(w => /requests/.test(w)), 'and no sign-in request is written (it used to put every player and coach among the people waiting): ' + JSON.stringify(st.wr));
    console.log('     errors', errs(P3).slice(0, 5)); await ctx.close(); } }
  if (!only || only === 'C'){
  console.log('C. the device’s copy is checked against the database');
  { const ctx = await b.newContext({viewport:{width:1300, height:1000}}); const A = await open(b, 'admin', {ctx}), P = await open(b, 'player', {ctx});
    await A.goto(APP); await A.settle(4000); await P.goto(APP); await P.settle(4000); await P.cost();
    const news = pg => pg.evaluate(() => (window.__ev('NEWS').all || []).map(p => p.id));
    const before = await news(P), victim = before[5];
    // an older copy of the app posts (no "u" on it) and deletes a post outright
    await A.evaluate(v => { window.__fs.set('posts/oldstyle1', {at:Date.now(), by:'coach0@example.com', byName:'Coach', team:'*', text:'Training is OFF tonight', links:[], pin:false}); window.__fs.del('posts/' + v); }, victim);
    await P.waitForTimeout(2500); let now = await news(P); ok(!now.includes('oldstyle1') && now.includes(victim), 'a post from an older copy of the app isn’t seen while the page stays open (it carries no time mark)');
    await P.reload(); await P.settle(4000); now = await news(P); let c = await P.cost();
    ok(now.includes('oldstyle1') && !now.includes(victim), 'on opening the app again the count doesn’t match, everything is read again, and both changes are there');
    console.log('     that visit:', fmt(c));
    await P.reload(); await P.settle(4000); c = await P.cost(); ok((c.by.posts || 0) <= 3, 'the visit after that reads ' + (c.by.posts || 0) + ' for Team news'); console.log('     that visit:', fmt(c));
    // a document that doesn't exist is still reported as not existing (and counts as loaded)
    const none = await P.evaluate(async () => { const C = window.__int.Cloud; C.sub('team/no-such-thing'); await new Promise(r => setTimeout(r, 900)); return [C.loaded['team/no-such-thing'], C.docs['team/no-such-thing']]; });
    ok(none[0] === true && none[1] === null, 'a shared document that really doesn’t exist arrives as "not there": ' + JSON.stringify(none));
    // one save, one notice to the app (the database confirms a save with a second message, which isn't passed on)
    const n = await A.evaluate(async () => { const C = window.__int.Cloud; let k = 0; const off = C.on(() => k++); const cur = JSON.parse(JSON.stringify(C.docs['team/notes'] || {})); cur.t = Date.now(); await C.set('team/notes', cur); await new Promise(r => setTimeout(r, 400)); off(); return k; });
    ok(n === 1, 'saving a shared document tells the app once, not twice: ' + n);
    console.log('     errors', errs(A).concat(errs(P)).slice(0, 5)); await ctx.close(); } }
  if (!only || only === 'D'){
  console.log('D. likes and tags: only the change is written');
  { const ctx = await b.newContext({viewport:{width:420, height:900}}); const P = await open(b, 'player', {ctx}); await P.goto(APP); await P.settle(3000); await P.nav('photos'); await P.settle(2500);
    await P.evaluate(async () => { await window.__ev('lkToggle')({id:'phA', name:'a.jpg'}, 'S1'); }); await P.waitForTimeout(300);
    // the same person likes another photo on a second phone; this phone hasn't heard yet
    await P.evaluate(me => { const d = JSON.parse(JSON.stringify(window.__fs.store.get('likes/' + me))); d.p.phOther = {t:Date.now(), s:'S1', n:'o.jpg'}; d.at = Date.now(); window.__fs.set('likes/' + me, d); }, ME);
    await P.evaluate(async () => { await window.__ev('lkToggle')({id:'phA', name:'a.jpg'}, 'S1'); }); await P.waitForTimeout(300);
    let d = await doc(P, 'likes/' + ME); ok(d.p.phOther && !d.p.phA && d.p.ph0, 'taking a like away leaves a like made on another phone: ' + Object.keys(d.p).join(','));
    await P.evaluate(async () => { await window.__ev('tgAdd')({id:'phQ', name:'q.jpg'}, 0.4, 0.5); }); await P.waitForTimeout(300); d = await doc(P, 'phtags/' + ME); const had = d.p.phQ && d.p.phQ.x === 0.4;
    await P.evaluate(async () => { await window.__ev('tgAdd')({id:'phQ', name:'q.jpg'}); }); await P.waitForTimeout(300); d = await doc(P, 'phtags/' + ME);
    ok(had && d.p.phQ && !('x' in d.p.phQ) && !('y' in d.p.phQ) && d.p.ph0, 'tagging again without a position takes the old position off: ' + JSON.stringify(d.p.phQ));
    // signing out clears what the device keeps
    const k0 = await keys(P); await P.evaluate(() => window.ERGS_AUTH.signOut()).catch(() => {}); await P.waitForTimeout(3500);
    const dbs = await P.evaluate(async () => (await indexedDB.databases()).map(x => x.name)); const k1 = dbs.includes('ergs-cache') ? await keys(P) : [];
    ok(k0.length > 0 && !k1.some(k => /^w:/.test(k)), `signing out clears the device’s copy (it held ${k0.join(', ')}; now ${k1.join(', ') || 'nothing'})`);
    console.log('     errors', errs(P).slice(0, 5)); await ctx.close(); } }
  if (!only || only === 'E'){
  console.log('E. ERGS Live with no connection');
  { const ctx = await b.newContext({viewport:{width:1300, height:1000}}); const L = await open(b, 'out', {ctx}); await L.addInitScript(() => { window.__offline = true; try { sessionStorage.setItem('ergs.liveOK', '1'); } catch(e){} });
    await L.goto('http://app.test/?live'); await L.waitForTimeout(5000); const view = () => L.evaluate(() => (document.querySelector('#view') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 200));
    let v = await view(); ok(!/No match|no matches|No fixtures/i.test(v), 'no empty scoreboard is shown while it can’t be reached: “' + v.slice(0, 80) + '”');
    await L.waitForTimeout(8500); v = await view(); ok(/Couldn’t reach the scoreboard/.test(v), 'after 12 seconds: ' + v.slice(0, 100));
    await L.evaluate(() => window.__fs.offline(false)); await L.waitForTimeout(3000); v = await view(); ok(!/Couldn’t reach/.test(v) && v.length > 60, 'back online, the scoreboard fills in: ' + v.slice(0, 110));
    console.log('     errors', errs(L).slice(0, 5)); await ctx.close(); } }
  await b.close(); })();
