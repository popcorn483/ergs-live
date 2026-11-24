// A coach who is also a parent: coach access, plus the parent hub for their child (24 November 2026)
// usage: STUB3=1 node flow29.js
const { chromium } = require('playwright'); const { open } = require('./real.js');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const start = async (b, role, rid) => { const p = await open(b, role, {ctx:await b.newContext({viewport:{width:420, height:900}})});
  await p.addInitScript(rid => { localStorage.setItem('ergs.pwNo', '1'); const s = window.__fsSeed; if (rid && s && s['coaches/coach0@example.com']) s['coaches/coach0@example.com'].parentOf = rid; }, rid || '');
  await p.goto('http://app.test/app/'); await p.waitForTimeout(5000); return p; };
(async () => { const b = await chromium.launch();
  { const p = await start(b, 'coach', '');
    ok(!(await p.evaluate(() => { const e = document.querySelector('#gdHub'); return !!e && !e.hidden; })), 'a coach with no child linked: no parent hub'); await p.close(); }
  const p = await start(b, 'coach', 'r100');
  const kid = await p.evaluate(() => { const r = window.__ev("roster().find(x => x.id === 'r100')"); return r && {f:r.f, l:r.l, t:r.t}; });
  const hub = await p.evaluate(() => { const e = document.querySelector('#gdHub'); return e && !e.hidden ? e.textContent.replace(/\s+/g, ' ') : ''; });
  ok(kid && new RegExp(kid.f + '’s rugby').test(hub) && /Your child/.test(hub), 'linked to ' + (kid && kid.f) + ': Home shows “' + hub.slice(0, 60) + '…”');
  ok(/Proud moments/.test(hub) && /games?/.test(hub), '…with the season numbers and Proud moments');
  const st = await p.evaluate(() => ({role:window.__int.Cloud.role, grp:!!document.querySelector('#coachGrp'), edit:window.__int.Cloud.canEdit, mine:window.__ev("myPlayer()") === null, lib:window.__ev("allowed('library') && allowed('drills') && allowed('squads')")}));
  ok(st.role === 'coach' && st.grp && st.edit && st.lib, 'they are still a coach: Coach access, playbook, drills and squads all there');
  ok(st.mine, '…and are not treated as a player anywhere else');
  { const e = p.errs.filter(x => !/reading 'set'/.test(x)); ok(!e.length, 'coach-parent: no page errors ' + e.join(' | ')); }
  // the head coach links and unlinks a coach in Access
  const a = await start(b, 'admin', '');
  await a.evaluate(() => window.__int.go('people')); await a.waitForTimeout(3000);
  const has = await a.evaluate(() => { const b = [...document.querySelectorAll('.co-par')]; return {n:b.length, t:b.map(x => x.textContent)[0]}; });
  ok(has.n >= 1 && /Also a parent\?/.test(has.t), 'Access: each coach has “Also a parent?” (' + has.n + ')');
  const em = await a.evaluate(() => { const li = [...document.querySelectorAll('.acc-list li')].find(li => li.querySelector('.co-par') && /coach0@example\.com/.test(li.textContent)); li.querySelector('.co-par').click(); return 'coach0@example.com'; }); await a.waitForTimeout(500);
  ok(await a.$('#cpList .cp-it') && await a.$eval('#cpGo', e => e.disabled), 'it lists the squad, and Save waits for a choice');
  await a.fill('#cpQ', kid.l); await a.waitForTimeout(200); await a.evaluate(() => [...document.querySelectorAll('#cpList .cp-it')].find(b => !b.hidden && b.dataset.rid === 'r100').click()); await a.click('#cpGo'); await a.waitForTimeout(1500);
  ok(await a.evaluate(em => window.ERGS_AUTH.getOne('coaches', em).then(c => c && c.parentOf), em) === 'r100', 'saved on the coach’s record');
  await a.waitForTimeout(1500); ok(await a.evaluate(() => [...document.querySelectorAll('.co-par')].some(b => /^Parent of /.test(b.textContent))), 'the button now says whose parent they are');
  await a.evaluate(() => [...document.querySelectorAll('.co-par')].find(b => /^Parent of /.test(b.textContent)).click()); await a.waitForTimeout(400); await a.click('#cpNone'); await a.waitForTimeout(1500);
  ok(!(await a.evaluate(em => window.ERGS_AUTH.getOne('coaches', em).then(c => c && c.parentOf), em)), '“Not a parent” takes the link off');
  { const e = a.errs.filter(x => !/reading 'set'/.test(x)), den = await a.evaluate(() => window.__denied || []); ok(!e.length && !den.length, 'head coach: no page errors, nothing refused ' + e.concat(den).join(' | ')); }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
