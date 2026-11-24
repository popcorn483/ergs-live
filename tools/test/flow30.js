// Nominated players join the squad list, under their squad (24 November 2026)
// usage: STUB3=1 node flow30.js
const { chromium } = require('playwright'); const { open } = require('./real.js');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
(async () => { const b = await chromium.launch();
  const p = await open(b, 'admin', {ctx:await b.newContext({viewport:{width:420, height:900}})});
  await p.addInitScript(() => { localStorage.setItem('ergs.pwNo', '1'); const d = new Date().toISOString().slice(0, 10), n = (id, name, team) => ({id, name, team, date:d, opp:'Portora', at:1});
    window.__fsSeed['team/noms'] = {j:JSON.stringify({list:[n('a', 'Finn Maguire', 'U14 B'), n('b', 'Rory Elliott', '2XV'), n('c', 'Sam Smith', 'U14'), n('e', 'Kit Nobody', '')]})};
    window.__fsSeed['team/nomsArc'] = {j:JSON.stringify({list:[n('d', 'Finn Maguire', 'U14'), {id:'old', name:'Old Boy', team:'1XV', date:'2024-10-05'}]})}; });
  await p.goto('http://app.test/app/'); await p.waitForTimeout(5000);
  await p.waitForTimeout(3000);
  // nominated names join the squad list
  const rs = await p.evaluate(() => window.__ev('roster()').filter(x => /^(Finn Maguire|Rory Elliott|Kit Nobody|Old Boy)$/.test(x.f + ' ' + x.l)).map(x => [x.f + ' ' + x.l, x.t, x.xv || ''].join('/')).sort().join(' | '));
  ok(rs === 'Finn Maguire/U14/ | Kit Nobody// | Rory Elliott/SENIOR/2XV', 'nominated players are added to Squads under their squad, once each, not last season’s: ' + rs);
  ok(await p.evaluate(() => window.__ev('roster()').filter(x => x.f === 'Sam' && x.l === 'Smith').length) === 1, 'someone already in Squads is not added again');
  await p.evaluate(() => { const c = window.__int.Cloud.docs['team/roster']; return window.__int.Cloud.set('team/roster', Object.assign({}, c, {players:c.players.filter(x => (x.f + ' ' + x.l) !== 'Rory Elliott')})); }); await p.waitForTimeout(5000);
  ok(await p.evaluate(() => !window.__ev('roster()').some(x => (x.f + ' ' + x.l) === 'Rory Elliott')), 'a nominated player removed from Squads stays removed');
  { const e = p.errs.filter(x => !/reading 'set'|sandboxed/.test(x)), den = await p.evaluate(() => window.__denied || []); ok(!e.length && !den.length, 'no page errors, nothing refused ' + e.concat(den).join(' | ')); }
  await p.evaluate(() => { window.__ev("SQ.team = '*'"); window.__int.go('squads'); }); await p.waitForTimeout(3000);
  ok(await p.evaluate(() => { const r = [...document.querySelectorAll('#sqList .sq-row')].find(r => [...r.querySelectorAll('input')].map(i => i.value).join(' ') === 'Finn Maguire'); return !!r && /No email/.test(r.querySelector('.sq-login').textContent); }), 'in Squads the nominated player is marked “No email”');
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
