// Training drills: the old app copies the premade drills into the database (as happened for real); coaches change a few things;
// then the new app moves to "premade drills come with the app". Checks nothing a coach made or changed is lost, and what it costs.
const { chromium } = require('playwright'); const { open, fmt } = require('./real.js'); const SP = __dirname;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => { const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1300, height:1000}});
  // ---- 1. the old app: a database with no drills; the admin opens Training drills and the app copies every premade drill in
  // the app as it was before the move (commit 3909ccb), checked out beside these scripts the first time this runs
  if (!require('fs').existsSync(SP + '/oldtree')) require('child_process').execSync('git worktree add --detach "' + SP + '/oldtree" 3909ccb', {cwd:require('path').resolve(SP, '../..'), stdio:'ignore'});
  let A = await open(b, 'admin', {ctx, root:SP + '/oldtree'});
  await A.addInitScript(() => { const s = window.__fsSeed; if (s){ Object.keys(s).forEach(k => { if (k.startsWith('drills/')) delete s[k]; }); s['team/drills'] = {j:JSON.stringify({}), u:1}; } });
  await A.goto('http://app.test/app/'); await A.waitForTimeout(6000); await A.nav('drills');
  let n = 0; for (let i = 0; i < 40; i++){ await A.waitForTimeout(3000); const k = await A.evaluate(() => [...window.__fs.store.keys()].filter(x => x.startsWith('drills/')).length); const m = await A.evaluate(() => JSON.parse(window.__fs.store.get('team/drills').j)); if (k === n && m.pack7 >= 2 && m.str8 >= 1) break; n = k; }
  const meta0 = await A.evaluate(() => JSON.parse(window.__fs.store.get('team/drills').j)); console.log('old app copied in', n, 'premade drills; flags', JSON.stringify({seedV:meta0.seedV, fit6:meta0.fit6, pack7:meta0.pack7, str8:meta0.str8}));
  const oldList = await A.evaluate(() => window.__int.drillList().map(d => d.id)); ok(oldList.length === n, 'the old app lists ' + oldList.length);
  // ---- 2. what coaches did since: made one, deleted one, hid one, changed the levels of one, edited one; and one is an older copy of a premade drill
  const ids = await A.evaluate(() => [...window.__fs.store.keys()].filter(x => x.startsWith('drills/')).map(x => x.slice(7)).sort());
  const pick = k => ids[Math.floor(ids.length*k)]; const T = {del:pick(0.11), hide:pick(0.23), lv:pick(0.37), edit:pick(0.51), stale:pick(0.67)};
  await A.evaluate(T => { const F = window.__fs, get = id => JSON.parse(F.store.get('drills/' + id).j), put = (id, v) => F.set('drills/' + id, {j:JSON.stringify(v), u:Date.now()});
    put('custom1', {drill:{title:'Our own lineout drill', drill:true, code:'union', age:'u16', showB:true, use:['A1'], cones:[], posts:[], tags:['Lineout'], grp:'forwards', desc:'Made by a coach', mins:10, frames:get(T.hide).drill.frames}, updated:Date.now()});
    F.del('drills/' + T.del);
    let d = get(T.hide); d.drill.hidden = true; delete d.pre; d.updated = Date.now(); put(T.hide, d);
    d = get(T.lv); d.drill.lv = ['Senior Girls']; d.updated = Date.now(); put(T.lv, d);            // levels changed (pre:1 is kept by that save)
    d = get(T.edit); d.drill.title = 'EDITED BY A COACH'; delete d.pre; d.updated = Date.now(); put(T.edit, d);
    d = get(T.stale); d.drill.frames[0].caption = 'an older wording'; put(T.stale, d);                // an untouched copy of an older version
    const m = JSON.parse(F.store.get('team/drills').j); delete m.rev; F.set('team/drills', {j:JSON.stringify(m), u:Date.now()}); }, T);
  await A.waitForTimeout(4000); const before = await A.evaluate(() => [...window.__fs.store.keys()].filter(x => x.startsWith('drills/')).length);   // (time for the test database to be written to disk before this page closes) console.log('database now holds', before, 'drill documents', JSON.stringify(T));
  await A.close();
  // ---- 3. the new app: the admin just opens it (the home page). The one-off move runs by itself.
  A = await open(b, 'admin', {ctx}); await A.goto('http://app.test/app/'); await A.waitForTimeout(3500); let c0 = await A.cost(); console.log('  admin opening the new app:', fmt(c0));
  let meta = null; for (let i = 0; i < 60; i++){ await A.waitForTimeout(2000); meta = await A.evaluate(() => JSON.parse(window.__fs.store.get('team/drills').j)); if (meta.built && meta.tidy) break; }
  const left = await A.evaluate(() => [...window.__fs.store.keys()].filter(x => x.startsWith('drills/')).map(x => x.slice(7)).sort());
  let c = await A.cost(); console.log('  the move cost:', fmt(c));
  ok(meta.built === 1 && meta.tidy === 1, 'team/drills says built and tidy');
  ok(JSON.stringify(meta.gone) === JSON.stringify([T.del]), 'the deleted premade drill is on the gone list: ' + JSON.stringify(meta.gone));
  ok(JSON.stringify(left) === JSON.stringify(['custom1', T.hide, T.lv, T.edit].sort()), 'the database keeps only what coaches made or changed: ' + JSON.stringify(left));
  // ---- 4. the list is the same as before, with the coach's changes
  await A.nav('drills'); await A.waitForTimeout(5000);
  const L = await A.evaluate(() => window.__int.drillList().map(d => ({id:d.id, title:d.title, hidden:!!d.hidden, lv:d.lv || [], cap:d.frames[0].caption}))); const by = Object.fromEntries(L.map(d => [d.id, d]));
  ok(L.length === before, 'the admin sees ' + L.length + ' drills (the database held ' + before + ')');
  ok(!by[T.del], 'the deleted one is still gone'); ok(by.custom1 && by.custom1.title === 'Our own lineout drill', 'the coach’s own drill is there');
  ok(by[T.hide] && by[T.hide].hidden, 'the hidden one is still hidden'); ok(by[T.lv] && JSON.stringify(by[T.lv].lv) === '["Senior Girls"]', 'the changed levels are kept');
  ok(by[T.edit] && by[T.edit].title === 'EDITED BY A COACH', 'the edited one keeps the edit'); ok(by[T.stale] && by[T.stale].cap !== 'an older wording', 'the older copy was replaced by the current premade drill');
  ok(new Set(oldList.filter(id => id !== T.del)).size === L.filter(d => d.id !== 'custom1').length && oldList.filter(id => id !== T.del).every(id => by[id]), 'every other premade drill is listed, none twice');
  c = await A.cost(); console.log('  admin opening Training drills afterwards:', fmt(c));
  // ---- 5. a player, on a device that has never opened drills
  const P = await open(b, 'player', {ctx});
  // (the two pages share one browser, so forget the drills the admin's page kept: this player's device has never opened them)
  await A.evaluate(() => new Promise(res => { const o = indexedDB.open('ergs-cache', 1); o.onsuccess = () => { const tx = o.result.transaction('kv', 'readwrite'); tx.objectStore('kv').delete('drills'); tx.oncomplete = () => { o.result.close(); res(); }; }; }));
  await P.goto('http://app.test/app/'); await P.waitForTimeout(8000); await P.cost();
  ok(await P.evaluate(() => [...document.querySelectorAll('#menuList .menu-item .t')].some(x => x.textContent.trim() === 'Training drills')), 'a player has Training drills on the home page');
  await P.nav('drills'); await P.waitForTimeout(6000); ok(await P.shown() === 'drills', 'and can open it'); c = await P.cost(); console.log('  player opening Training drills for the first time:', fmt(c));
  const PL = await P.evaluate(() => window.__int.drillList().map(d => d.id)); ok(PL.length === L.length, 'the player’s device has the same ' + PL.length + ' drills to choose from');
  console.log('  what the player sees:', (await P.evaluate(() => document.querySelector('#drills').innerText.replace(/\s+/g, ' ').slice(0, 260))));
  // ---- 6. changes after the move: delete a premade drill, hide another; the player's device follows
  const T2 = {del:pick(0.8), hide:pick(0.9)};
  await A.evaluate(async T2 => { const I = window.__int; await I.Cloud.del('drills/' + T2.del); const d = I.Cloud.drills.find(x => x.id === T2.hide); const q = JSON.parse(JSON.stringify(d.drill)); q.hidden = true; await I.Cloud.set('drills/' + T2.hide, {drill:q, updated:Date.now()}); }, T2);
  await A.waitForTimeout(4000); meta = await A.evaluate(() => JSON.parse(window.__fs.store.get('team/drills').j));
  ok(meta.gone.includes(T2.del) && meta.gone.includes(T.del), 'deleting a premade drill adds it to the gone list'); ok(!(await A.evaluate(id => window.__fs.store.has('drills/' + id), T2.del)), 'nothing is written for it');
  ok(await A.evaluate(id => window.__fs.store.has('drills/' + id), T2.hide), 'hiding a premade drill saves a copy of it');
  const AL = await A.evaluate(() => window.__int.drillList().map(d => d.id)); ok(AL.length === L.length - 1 && !AL.includes(T2.del), 'admin now lists ' + AL.length);
  await P.waitForTimeout(3000); const PL2 = await P.evaluate(() => window.__int.drillList().map(d => ({id:d.id, hidden:!!d.hidden})));
  ok(PL2.length === AL.length && !PL2.some(d => d.id === T2.del) && PL2.find(d => d.id === T2.hide).hidden, 'the player’s device followed both changes'); c = await P.cost(); console.log('  which cost the player:', fmt(c));
  // ---- 7. reopen: nothing to fetch
  await P.reload(); await P.waitForTimeout(8000); await P.cost(); await P.nav('drills'); await P.waitForTimeout(5000); c = await P.cost(); console.log('  player reopening the app and Training drills:', fmt(c));
  ok((await P.evaluate(() => window.__int.drillList().length)) === AL.length, 'same list after reopening');
  console.log('errors', A.errs.concat(P.errs).filter(e => !/reading 'set'/.test(e)).slice(0, 6), [...new Set(A.cons.concat(P.cons))].slice(0, 6));
  await b.close(); })();
