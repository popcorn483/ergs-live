// Access checks: what people without a login left behind (found on request, deleted on request); the sizes panel; the rules note for a coach who isn't the admin account.
const { chromium } = require('playwright'); const { open, fmt } = require('./real.js');
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => { const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1300, height:1000}});
  const A = await open(b, 'admin', {ctx}); await A.goto('http://app.test/app/'); await A.settle(3000);
  await A.evaluate(() => { const F = window.__fs, now = Date.now(); F.set('likes/left.school@example.com', {p:{ph1:{t:now, s:'S1', n:'a.jpg'}}, name:'Left School', at:now}); F.set('pstats/left.school@example.com', {g:{}, name:'Left School', team:'U14', at:now});
    F.set('headshots/left.school@example.com', {photo:'data:image/jpeg;base64,AAAA', status:'ok', season:'2025-26', at:now, name:'Left School'}); F.set('phtags/nm-no-login-yet', {p:{ph2:{t:now}}, name:'No Login Yet', at:now}); });
  await A.nav('people'); await A.settle(2500); await A.cost();
  const has = await A.evaluate(() => { const d = document.querySelector('#dxBox'); if (!d) return null; d.open = true; return {btn:!!d.querySelector('#dxLeftGo'), text:d.innerText.replace(/\s+/g, ' ').slice(0, 500)}; });
  ok(has && has.btn, 'Access checks has the “Left behind” section: ' + (has ? has.text.slice(0, 200) : 'no checks panel'));
  ok(has && /How full the shared documents are/.test(has.text) || await A.evaluate(() => /How full/.test(document.querySelector('#dxBox').innerText)), 'and the sizes of the shared documents');
  await A.evaluate(() => document.querySelector('#dxLeftGo').click()); await A.settle(2500); let c = await A.cost();
  let out = await A.evaluate(() => document.querySelector('#dxLeftOut').innerText.replace(/\s+/g, ' ').slice(0, 400));
  ok(/left\.school@example\.com/.test(out) && /headshot sent in/.test(out) && /match record/.test(out) && /photo likes/.test(out) && !/no-login-yet|No Login Yet/.test(out), 'it finds the three records and leaves alone the tags made by name: ' + out.slice(0, 230));
  console.log('     looking cost:', fmt(c));
  await A.evaluate(() => document.querySelector('#dxLeftDel').click()); await A.waitForTimeout(300); await A.evaluate(() => document.querySelector('#askGo').click()); await A.settle(2500);
  const left = await A.evaluate(() => ['likes/left.school@example.com', 'pstats/left.school@example.com', 'headshots/left.school@example.com', 'phtags/nm-no-login-yet', 'likes/adam.armstrong0@example.com'].map(p => window.__fs.store.has(p)));
  ok(JSON.stringify(left) === '[false,false,false,true,true]', 'deleting removes those three and nothing else: ' + JSON.stringify(left));
  out = await A.evaluate(() => document.querySelector('#dxLeftOut').innerText.replace(/\s+/g, ' ').slice(0, 200)); ok(/Nothing is left behind/.test(out), 'and it then says: ' + out);
  console.log('     errors', A.errs.filter(e => !/reading 'set'/.test(e)).slice(0, 5), [...new Set(A.cons)].slice(0, 5), 'refused:', await A.evaluate(() => (window.__denied || []).splice(0)));
  // a full-access coach who isn't the admin account isn't told to publish rules because of the activity log (which only the admin account may read)
  const ctx2 = await b.newContext({viewport:{width:1300, height:1000}}); const C = await open(b, 'coach', {ctx:ctx2}); await C.goto('http://app.test/app/'); await C.settle(3500);
  const st = await C.evaluate(() => ({full:window.__ev('isAdminCoach')(), note:(() => { const n = document.querySelector('#rcNote'); return n && !n.hidden ? n.innerText.replace(/\s+/g, ' ').slice(0, 120) : null; })(), missing:window.__ev('RC').missing}));
  ok(!st.note, `a coach (full access: ${st.full}) sees no “publish the rules” note: ${st.note} ${JSON.stringify(st.missing)}`);
  await b.close(); })();
