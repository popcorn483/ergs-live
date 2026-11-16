// One coach, several emails (other emails open the same coach; two coach entries can be merged); and someone waiting is let in the moment they are approved.
const { chromium } = require('playwright'); const { open } = require('./real.js');
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => { const b = await chromium.launch();
  // 1. waiting, then approved: the app opens by itself
  let ctx = await b.newContext(); const N = await open(b, 'public', {ctx}); await N.goto('http://app.test/app/'); await N.settle(3000); await N.waitForTimeout(2000);
  let r = await N.evaluate(() => { window.__mark = 1; return window.ERGS_AUTH.role; });
  const AD = await open(b, 'admin', {ctx}); await AD.goto('http://app.test/app/'); await AD.settle(3000); await AD.evaluate(() => window.ERGS_AUTH.setAccess('coaches', 'nobody@example.com', {name:'No Body', scope:'all', added:Date.now()})); await AD.waitForTimeout(800);
  await N.evaluate(() => { window.__fs.set('coaches/nobody@example.com', {name:'No Body', scope:'all', added:Date.now()}); }).catch(() => {});
  await N.waitForTimeout(4000); await N.settle(3000);
  const r2 = await N.evaluate(() => ({mark:window.__mark || 0, role:window.ERGS_AUTH.role, toast:[...document.querySelectorAll('.toast, #toast')].map(x => x.textContent).join('|')}));
  ok(r === 'public' && !r2.mark && r2.role === 'coach', `waiting (${r}) → approved while the page is open → it reloaded itself and they are a ${r2.role}; it says: ${r2.toast.slice(0, 80)}`);
  await ctx.close();
  // 2. an "other email" signs in as the main coach
  ctx = await b.newContext(); const Q = await ctx.newPage(); await Q.close();
  const A2 = await open(b, 'public', {ctx}); await A2.addInitScript(() => { const S = window.__fsSeed; if (S) S['coaches/nobody@example.com'] = {aliasOf:'coach4@example.com', added:Date.now()}; });
  await A2.goto('http://app.test/app/'); await A2.settle(3000);
  r = await A2.evaluate(() => ({role:ERGS_AUTH.role, email:ERGS_AUTH.email, alias:ERGS_AUTH.coachAlias, name:(ERGS_AUTH.coach || {}).name, scope:(ERGS_AUTH.coach || {}).scope}));
  ok(r.role === 'coach' && r.email === 'coach4@example.com' && r.alias === 'nobody@example.com' && r.name, 'a coach’s other email opens the same coach: ' + JSON.stringify(r));
  await ctx.close();
  // 3. the admin adds another email and merges two entries
  ctx = await b.newContext({viewport:{width:1300, height:1000}}); const P = await open(b, 'admin', {ctx}); await P.goto('http://app.test/app/'); await P.settle(3000); await P.nav('people'); await P.waitForTimeout(2500);
  await P.evaluate(() => document.querySelector('#coSec [data-coopen="coach3@example.com"]').click()); await P.waitForTimeout(1500);
  r = await P.evaluate(() => { const c = document.querySelector('#coSec .co-alt'); return c ? {t:c.innerText.replace(/\s+/g, ' ').slice(0, 160), opts:c.querySelectorAll('.co-alt-m option').length} : null; });
  ok(r && /main email/i.test(r.t) && r.opts > 5, 'opening a coach shows their emails, a box to add one and the merge list: ' + JSON.stringify(r));
  await P.evaluate(() => { const f = document.querySelector('#coSec .co-alt-f'); f.querySelector('input').value = 'Coach3.Home@Example.com'; f.requestSubmit(); }); await P.waitForTimeout(2000);
  r = await P.evaluate(() => ({doc:window.__fs.store.get('coaches/coach3.home@example.com'), row:(document.querySelector('#coSec tr[data-row="coach3@example.com"] .co-alt-n') || {}).textContent, rows:document.querySelectorAll('#coSec tr[data-row]').length, li:[...document.querySelectorAll('#coSec .co-alt-l li')].map(x => x.innerText.replace(/\s+/g, ' '))}));
  ok(r.doc && r.doc.aliasOf === 'coach3@example.com' && /\+1 more email/.test(r.row || '') && r.li.length === 2, 'another email added; it is not a coach of its own in the list: ' + JSON.stringify(r).slice(0, 300)); const rows0 = r.rows;
  await P.evaluate(() => { const s = document.querySelector('#coSec .co-alt-m select'); s.value = 'coach5@example.com'; document.querySelector('#coSec [data-comerge]').click(); }); await P.waitForTimeout(400);
  await P.evaluate(() => document.querySelector('#askGo').click()); await P.waitForTimeout(2500);
  r = await P.evaluate(() => ({d5:window.__fs.store.get('coaches/coach5@example.com'), d3:window.__fs.store.get('coaches/coach3@example.com'), rows:document.querySelectorAll('#coSec tr[data-row]').length, row5:!!document.querySelector('#coSec tr[data-row="coach5@example.com"]'), n:(document.querySelector('#coSec tr[data-row="coach3@example.com"] .co-alt-n') || {}).textContent}));
  ok(r.d5 && r.d5.aliasOf === 'coach3@example.com' && !r.d5.scope && r.d3.name && r.rows === rows0 - 1 && !r.row5 && /\+2 more/.test(r.n || ''), 'two coach entries merged into one: ' + JSON.stringify(r).slice(0, 300));
  await P.evaluate(() => window.__ev('ERGS_AUTH').remove('coaches', 'coach3@example.com')); await P.waitForTimeout(800);
  r = await P.evaluate(() => [...window.__fs.store.keys()].filter(k => /coaches\/coach(3|5|3\.home)@/.test(k)));
  ok(!r.length, 'removing the coach removes their other emails too: ' + JSON.stringify(r));
  console.log('     errors', P.errs.slice(0, 4)); await b.close(); })();
