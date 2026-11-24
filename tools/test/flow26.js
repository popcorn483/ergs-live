// Team app: every coach and player sees the recording of every match; the Coach access group survives a failing step (24 November 2026)
// usage: STUB3=1 node flow26.js
const { chromium } = require('playwright'); const { open } = require('./real.js');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const URL = 'https://app.veo.co/matches/20261121-test/';
const start = async (b, role, withVeo) => { const p = await open(b, role, {ctx:await b.newContext({viewport:{width:420, height:900}})});
  await p.addInitScript(([w, u]) => { localStorage.setItem('ergs.pwNo', '1'); if (w && window.__fsSeed) window.__fsSeed['team/veo'] = {j:JSON.stringify({byMatch:{mNoLive:u}})}; }, [withVeo, URL]);
  await p.goto('http://app.test/app/'); await p.waitForTimeout(4500);
  const id = await p.evaluate(() => { const m = window.__int.Cloud.matches.find(m => m.status === 'FT'); return m && m.id; });
  return {p, id}; };
(async () => { const b = await chromium.launch();
  for (const role of ['player', 'coach']){ const {p, id} = await start(b, role, true);
    ok(!!id, role + ': a finished match exists (' + id + ')');
    await p.evaluate(() => window.__int.go('live')); await p.waitForTimeout(1500);
    const links = await p.evaluate(() => [...document.querySelectorAll('#liveList a.veo-link')].map(a => a.href));
    ok(links.includes(URL), role + ': Live scores list shows "Watch on VEO" for a match that only has a recording in the private record');
    await p.evaluate(id => { const T = window.__ev; T("LV").open = id; T("renderLive")(); }, id); await p.waitForTimeout(800);
    ok(await p.evaluate(u => { const a = document.querySelector('#veoOut a'); return !!a && a.href === u && !document.querySelector('#veoBox').hidden; }, URL), role + ': the match screen has the Watch button');
    { const e = p.errs.filter(x => !/reading 'set'/.test(x)); ok(!e.length, role + ': no page errors ' + e.join(' | ')); } }
  // Coach access group: an earlier home-screen step throwing must not lose it
  { const {p} = await start(b, 'coach', false);
    const r = await p.evaluate(async () => { const T = window.__ev; const keep = T("rcHome"); T("rcHome = function(){ throw new Error('boom (test)'); }"); try { T("renderMenu")(); } catch(e){} await new Promise(r => setTimeout(r, 300));
      const out = {grp:!!document.querySelector('#coachGrp'), flat:[...document.querySelectorAll('#menuList > li')].filter(li => li.id !== 'coachGrp' && /^(Graphics|Squads|Coach toolkit|Training drills)$/.test(((li.querySelector('.t') || {}).textContent || '').trim())).length, err:/boom/.test(window.__menuErr || '')}; window.__k = keep; T("rcHome = window.__k"); return out; });
    ok(r.grp && !r.flat, 'a failing home-screen step: Coach access is still grouped (' + JSON.stringify(r) + ')');
    ok(r.err, '…and the failure is still reported'); }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
