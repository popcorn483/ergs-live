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
  // two children: a switch at the top of the hub
  { const q = await start(b, 'coach', ['r100', 'r101']);
    const k2 = await q.evaluate(() => { const r = window.__ev("roster().find(x => x.id === 'r101')"); return r && r.f; });
    const tabs = await q.$$eval('#gdHub .gd-kid', e => e.map(x => x.textContent));
    ok(tabs.length === 2 && new RegExp(kid.f + '’s rugby').test(await q.$eval('#gdHub .gd-h', e => e.textContent)), 'two children linked: a switch with both (' + tabs.join(' / ') + '), first one showing');
    await q.click('#gdHub .gd-kid[data-gdkid="r101"]'); await q.waitForTimeout(300);
    ok(new RegExp(k2 + '’s rugby').test(await q.$eval('#gdHub .gd-h', e => e.textContent)) && await q.$eval('#gdHub .gd-kid[data-gdkid="r101"]', e => e.getAttribute('aria-selected') === 'true'), 'tapping ' + k2 + ' shows ' + k2 + '’s hub');
    await q.reload(); await q.waitForTimeout(5000);
    ok(new RegExp(k2 + '’s rugby').test(await q.$eval('#gdHub .gd-h', e => e.textContent)), '…and it is remembered next time');
    { const e = q.errs.filter(x => !/reading 'set'/.test(x)); ok(!e.length, 'two children: no page errors ' + e.join(' | ')); } await q.close(); }
  // the head coach links and unlinks a coach in Access
  const a = await start(b, 'admin', '');
  await a.evaluate(() => window.__int.go('people')); await a.waitForTimeout(3000);
  await a.evaluate(() => [...document.querySelectorAll('#people button')].find(b => b.offsetParent && /^\s*Coaches/i.test(b.textContent)).click()); await a.waitForTimeout(1500);
  const em = 'coach0@example.com', seen = s => a.evaluate(s => { const e = document.querySelector(s); return !!e && !!e.offsetParent; }, s), rec = () => a.evaluate(em => window.ERGS_AUTH.getOne('coaches', em).then(c => c && [].concat(c.parentOf || []).join()), em);
  await a.click(`#coSec [data-coopen="${em}"]`); await a.waitForTimeout(1500);
  ok(await seen('#coSec .co-kids #coKidBtn') && /Add their child/.test(await a.$eval('#coKidBtn', e => e.textContent)), 'Access › Coaches: tap a coach and the card has “Also a parent” with “Add their child”, on screen');
  await a.click('#coKidBtn'); await a.waitForTimeout(500);
  ok(await seen('#cpList .cp-it') && await a.$eval('#cpGo', e => e.disabled), 'it lists the squad, and Save waits for a choice');
  await a.fill('#cpQ', kid.l); await a.waitForTimeout(200); await a.evaluate(() => [...document.querySelectorAll('#cpList .cp-it')].find(b => !b.hidden && b.dataset.rid === 'r100').click()); await a.fill('#cpQ', ''); await a.click('#cpList .cp-it[data-rid="r101"]'); await a.click('#cpGo'); await a.waitForTimeout(2500);
  ok(await rec() === 'r100,r101', 'both children saved on the coach’s record');
  ok(/Parent of/.test(await a.$eval(`#coSec tr[data-row="${em}"] .pa-name small`, e => e.textContent)) && await a.$$eval('#coSec .co-kids li', e => e.length) === 2, 'the row says whose parent they are, and the card lists both');
  await a.click('#coKidBtn'); await a.waitForTimeout(400); await a.click('#cpNone'); await a.waitForTimeout(2500);
  ok(!(await rec()) && !(await a.$('#coSec .co-kids li')), '“Not a parent” takes the links off');
  await a.click(`#coSec [data-coopen="${em}"]`); await a.waitForTimeout(800); await a.evaluate(() => document.querySelector('#coSec tr[data-row] [data-coopen]').click()); await a.waitForTimeout(1500);
  ok(await seen('#coSec .co-kids #coKidBtn'), 'the head coach’s own row has it too');
  { const e = a.errs.filter(x => !/reading 'set'/.test(x)), den = await a.evaluate(() => window.__denied || []); ok(!e.length && !den.length, 'head coach: no page errors, nothing refused ' + e.concat(den).join(' | ')); }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
