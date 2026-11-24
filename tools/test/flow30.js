// Nominated players show in Access › Players under their squad, even with no account (24 November 2026)
// usage: STUB3=1 node flow30.js
const { chromium } = require('playwright'); const { open } = require('./real.js');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
(async () => { const b = await chromium.launch();
  const p = await open(b, 'admin', {ctx:await b.newContext({viewport:{width:420, height:900}})});
  await p.addInitScript(() => { localStorage.setItem('ergs.pwNo', '1'); const d = new Date().toISOString().slice(0, 10), n = (id, name, team) => ({id, name, team, date:d, opp:'Portora', at:1});
    window.__fsSeed['team/noms'] = {j:JSON.stringify({list:[n('a', 'Finn Maguire', 'U14 B'), n('b', 'Rory Elliott', '2XV'), n('c', 'Sam Smith', 'U14'), n('e', 'Kit Nobody', '')]})};
    window.__fsSeed['team/nomsArc'] = {j:JSON.stringify({list:[n('d', 'Finn Maguire', 'U14'), {id:'old', name:'Old Boy', team:'1XV', date:'2024-10-05'}]})}; });
  await p.goto('http://app.test/app/'); await p.waitForTimeout(5000);
  await p.evaluate(() => window.__int.go('people')); await p.waitForTimeout(3000);
  await p.evaluate(() => [...document.querySelectorAll('#people button')].find(b => b.offsetParent && /^\s*Players/i.test(b.textContent)).click()); await p.waitForTimeout(2000);
  const groups = () => p.evaluate(() => { const box = document.querySelector('#naBox'); return box && box.offsetParent ? [...box.querySelectorAll('.na-g')].filter(g => !g.hidden).map(g => g.querySelector('summary').textContent.replace(/\s+/g, ' ').trim().replace(/ \d+$/, '') + ': ' + [...g.querySelectorAll('.na-r')].filter(x => !x.hidden).map(x => x.querySelector('b').textContent).join(', ')) : null; });
  const shown = () => p.$$eval('#naBox .na-r', e => e.filter(x => !x.hidden && x.offsetParent).map(x => x.querySelector('b').textContent));
  const sq = await p.evaluate(() => { const acc = new Set(Object.keys(window.__fsSeed).filter(k => k.startsWith('players/')).map(k => window.__fsSeed[k].rid).filter(Boolean)); return window.__ev('roster()').filter(x => !acc.has(x.id)).map(x => ({id:x.id, n:(x.f + ' ' + x.l).trim(), t:x.t})); });
  let g = await groups();
  ok(g && g.some(x => /^Under 14: .*Finn Maguire/.test(x)) && g.some(x => /^Senior Rugby: .*Rory Elliott/.test(x)), 'Access › Players lists nominated players under their squad: ' + (g || []).map(x => x.split(':')[0]).join(' | '));
  ok(g && g.some(x => /^No squad: .*Kit Nobody/.test(x)), 'a nomination with no team goes under “No squad”');
  ok(g && !g.join().includes('Sam Smith'), 'someone already in Access is not listed again');
  ok(g && !g.join().includes('Old Boy'), 'a past season’s nominations are left out');
  const one = sq.find(x => x.t === 'U13') || sq[0]; console.log('       (squad list has ' + sq.length + ' players with no account in the test data)');
  if (one){ ok(g.join().includes(one.n), 'a player in the squad list with no account is listed: ' + one.n);
    ok(await p.$$eval('#naBox details.na-g', e => e.length > 0 && e.every(x => !x.open)), 'each squad is folded shut until opened, so the screen stays short');
    await p.fill('#afQ', one.n.toLowerCase()); await p.waitForTimeout(300); ok((await shown()).join() === one.n && /In the squad list/.test(await p.$eval('#naBox .na-r:not([hidden]) small', e => e.textContent)), 'searching opens the squad and finds them, marked “In the squad list”'); await p.fill('#afQ', ''); await p.waitForTimeout(300); }
  await p.fill('#afQ', 'finn'); await p.waitForTimeout(300);
  ok((await shown()).join() === 'Finn Maguire' && /Nominated 2 times/.test(await p.$eval('#naBox .na-r:not([hidden]) small', e => e.textContent)), 'the search finds a nominated player, with how often (B team counted with the Under 14s)');
  await p.fill('#afQ', ''); await p.selectOption('#afTeam', 'SENIOR'); await p.waitForTimeout(300);
  ok((await shown()).includes('Rory Elliott') && !(await shown()).includes('Finn Maguire'), 'the squad filter applies to them too');
  await p.selectOption('#afTeam', ''); await p.fill('#afQ', 'finn'); await p.waitForTimeout(300);
  await p.click('#naBox .na-r:not([hidden]) [data-naadd]'); await p.waitForTimeout(500);
  ok(await p.$eval('#naT', e => e.value) === 'U14' && await p.$eval('#naE', e => !!e.offsetParent), '“Add email” asks for the email, with the squad filled in and a first password if needed');
  await p.fill('#naE', 'finn@gmail.com'); await p.fill('#naP', 'rugby123'); await p.click('#naGo'); await p.waitForTimeout(600);
  ok(/C2k/.test(await p.$eval('#naMsg', e => e.textContent)) && !(await p.evaluate(() => window.ERGS_AUTH.getOne('players', 'finn@gmail.com'))), 'a password with a non-school email is refused, nothing saved');
  await p.fill('#naE', 'fmaguire123@c2ken.net'); await p.click('#naGo'); await p.waitForTimeout(3500);
  const rec = await p.evaluate(() => window.ERGS_AUTH.getOne('players', 'fmaguire123@c2ken.net'));
  ok(rec && rec.name === 'Finn Maguire' && rec.team === 'U14', 'saved as an Under 14 player');
  const au = await p.evaluate(() => ({acc:JSON.parse(localStorage.getItem('fakePwAccounts') || '{}')['fmaguire123@c2ken.net'], me:window.__fakeUser && window.__fakeUser.email, role:window.__int.Cloud.role}));
  ok(au.acc && au.acc.pw === 'rugby123', 'their first password is set');
  ok(au.role === 'coach' && !/fmaguire/.test(au.me || ''), '…and the head coach is still signed in as themselves');
  await p.fill('#afQ', 'finn'); await p.waitForTimeout(600);
  ok(!(await shown()).includes('Finn Maguire'), '…and they drop off the no-account list');
  if (one){ await p.fill('#afQ', one.n.toLowerCase()); await p.waitForTimeout(400); await p.click('#naBox .na-r:not([hidden]) [data-naadd]'); await p.waitForTimeout(400); await p.fill('#naE', 'squad.kid@example.com'); await p.click('#naGo'); await p.waitForTimeout(3500);
    const r2 = await p.evaluate(() => window.ERGS_AUTH.getOne('players', 'squad.kid@example.com')), n2 = await p.evaluate(() => window.__ev('roster().length'));
    ok(r2 && r2.rid === one.id && r2.team === one.t, 'a squad-list player added with no password is tied to their squad entry');
    ok(n2 === await p.evaluate(() => window.__ev('roster().length')) && (await p.evaluate(n => window.__ev('roster()').filter(x => (x.f + ' ' + x.l).trim() === n).length, one.n)) === 1, '…with no second copy made in the squad list'); }
  await p.fill('#afQ', ''); await p.waitForTimeout(200);
  // nominated names join the squad list
  const rs = await p.evaluate(() => window.__ev('roster()').filter(x => /^(Finn Maguire|Rory Elliott|Kit Nobody|Old Boy)$/.test(x.f + ' ' + x.l)).map(x => [x.f + ' ' + x.l, x.t, x.xv || ''].join('/')).sort().join(' | '));
  ok(rs === 'Finn Maguire/U14/ | Kit Nobody// | Rory Elliott/SENIOR/2XV', 'nominated players are added to Squads under their squad, once each, not last season’s: ' + rs);
  ok(await p.evaluate(() => window.__ev('roster()').filter(x => x.f === 'Sam' && x.l === 'Smith').length) === 1, 'someone already in Squads is not added again');
  await p.evaluate(() => { const c = window.__int.Cloud.docs['team/roster']; return window.__int.Cloud.set('team/roster', Object.assign({}, c, {players:c.players.filter(x => (x.f + ' ' + x.l) !== 'Rory Elliott')})); }); await p.waitForTimeout(5000);
  ok(await p.evaluate(() => !window.__ev('roster()').some(x => (x.f + ' ' + x.l) === 'Rory Elliott')), 'a nominated player removed from Squads stays removed');
  { const e = p.errs.filter(x => !/reading 'set'|sandboxed/.test(x)), den = await p.evaluate(() => window.__denied || []); ok(!e.length && !den.length, 'no page errors, nothing refused ' + e.concat(den).join(' | ')); }
  const c = await open(b, 'squadcoach', {ctx:await b.newContext({viewport:{width:420, height:900}})}); await c.addInitScript(() => localStorage.setItem('ergs.pwNo', '1')); await c.goto('http://app.test/app/'); await c.waitForTimeout(5000);
  ok(!(await c.$('#naBox')), 'a squad coach does not get the list');
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
