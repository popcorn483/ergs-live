// Rejecting a request (18 November 2026): it leaves Waiting for access for good, and the person is told
// usage: STUB3=1 node flow19.js
const { chromium } = require('playwright'); const { open } = require('./real.js');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const WHO = 'public0@example.com';
(async () => { const b = await chromium.launch();
  // the coach
  const p = await open(b, 'admin', {ctx:await b.newContext({viewport:{width:1100, height:900}})});
  await p.addInitScript(() => { const s = window.__fsSeed || {}; localStorage.setItem('ergs.pwNo', '1'); s['requests/noway@example.com'] = {name:'Nora Way', squad:'U14', sent:Date.now() - 5000, at:Date.now() - 5000, iam:'player'}; });
  await p.goto('http://app.test/app/'); await p.waitForTimeout(4000);
  await p.evaluate(() => window.__int.go('people')); await p.waitForTimeout(2500);
  const row = '[data-rq="noway@example.com"]';
  ok(await p.$(row), 'coach: the request is under Waiting for access');
  ok(await p.$eval(row + ' [data-rqx]', e => e.textContent) === 'Reject', '…with a Reject button');
  ok(!(await p.$(row + ' [data-rqalt]')), '…and no "Second email…" button');
  await p.click(row + ' [data-rqx]'); await p.waitForTimeout(400);
  await p.evaluate(() => { const bs = [...document.querySelectorAll('button')].filter(x => x.textContent.trim() === 'Reject' && !x.closest('[data-rq]')); bs[bs.length - 1].click(); }); await p.waitForTimeout(2500);
  const r = await p.evaluate(() => window.ERGS_AUTH.getOne('requests', 'noway@example.com'));
  ok(r && r.rejected === true && r.name === 'Nora Way', 'rejected: the request is kept, marked rejected');
  ok(!(await p.$(row)), '…and is off the waiting list');
  ok(/Rejected \(1\)/.test(await p.evaluate(() => (document.querySelector('.rq-rej summary') || {}).textContent || '')), '…and listed under Rejected (1)');
  await p.evaluate(() => { document.querySelector('.rq-rej').open = true; document.querySelector('[data-rj] button').click(); }); await p.waitForTimeout(2500);
  ok(!(await p.evaluate(() => window.ERGS_AUTH.getOne('requests', 'noway@example.com'))), '"Let them ask again" removes it');
  { const e = p.errs.filter(x => !/reading 'set'/.test(x)); ok(!e.length, 'no page errors (3D stub aside) ' + e.join(' | ')); }
  // the person who was rejected
  const q = await open(b, 'public', {ctx:await b.newContext({viewport:{width:420, height:900}})});
  await q.addInitScript(() => { const s = window.__fsSeed || {}, em = (window.__fakeUser || {}).email; if (em) s['requests/' + em] = {name:'Pat Public', squad:'U14', sent:1, at:1, rejected:true, rejAt:Date.now()}; localStorage.setItem('ergs.joinAs', 'player'); });
  await q.goto('http://app.test/app/'); await q.waitForTimeout(4500);
  ok(/wasn’t approved/.test(await q.evaluate(() => (document.querySelector('#rqForm h2') || {}).textContent || '')), 'rejected person: told the request wasn’t approved');
  ok(!(await q.$('#rqfN')), '…with no form to send again');
  const out = await q.evaluate(async () => { const A = window.ERGS_AUTH, o = []; try { await A.setAccess('requests', A.email, {name:'Try Again', sent:Date.now()}); o.push('allowed'); } catch(e){ o.push('refused'); } try { await A.remove('requests', A.email); o.push('allowed'); } catch(e){ o.push('refused'); }
    const r = await A.getOne('requests', A.email); o.push(r && r.rejected && r.at === 1 ? 'untouched' : 'changed'); return o.join(','); });
  ok(out === 'refused,refused,untouched', 'they cannot re-send or remove it, and opening the app left it alone (' + out + ')');
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
