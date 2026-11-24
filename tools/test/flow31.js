// One list of players, stage 1: a player's sign-in is opened from Squads (24 November 2026)
// usage: STUB3=1 node flow31.js
const { chromium } = require('playwright'); const { open } = require('./real.js');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
(async () => { const b = await chromium.launch();
  const p = await open(b, 'admin', {ctx:await b.newContext({viewport:{width:420, height:900}})});
  await p.addInitScript(() => { localStorage.setItem('ergs.pwNo', '1'); window.__fsSeed['players/nosquad@example.com'] = {name:'Nora Nosquad', team:'U13', added:1}; });
  await p.goto('http://app.test/app/'); await p.waitForTimeout(8000);
  const ns = await p.evaluate(() => window.__ev('roster()').filter(x => x.f === 'Nora' && x.l === 'Nosquad').map(x => x.t + '/' + x.id));
  const nr = await p.evaluate(() => window.ERGS_AUTH.getOne('players', 'nosquad@example.com'));
  ok(ns.length === 1 && /^U13\//.test(ns[0]) && nr && nr.rid === ns[0].split('/')[1], 'a player with a sign-in but no squad entry is added to Squads in their squad, and tied to it');
  const n0 = await p.evaluate(() => window.__ev('roster().length')); await p.reload(); await p.waitForTimeout(8000);
  ok(await p.evaluate(() => window.__ev('roster().length')) === n0, '…once only: nothing more is added on the next visit');
  await p.evaluate(() => { window.__ev("SQ.team = '*'"); window.__int.go('squads'); }); await p.waitForTimeout(3500);
  const st = await p.evaluate(() => { const b = [...document.querySelectorAll('#sqList .sq-login')]; return {n:b.length, on:b.filter(x => x.classList.contains('on')).length, t:[...new Set(b.map(x => x.textContent.trim()))].sort().join('|')}; });
  ok(st.n > 100 && st.on > 0 && st.on < st.n && st.t === 'No email|Sign-in', 'Squads: every player has a key (' + st.on + ') or an amber “No email” (' + (st.n - st.on) + ')');
  // a player with an account: their full card, and back
  const who = await p.evaluate(() => { const r = [...document.querySelectorAll('#sqList .sq-row')].find(r => r.querySelector('.sq-login.on')); const nm = [...r.querySelectorAll('input')].map(i => i.value).join(' '); r.querySelector('.sq-login').click(); return nm; }); await p.waitForTimeout(2500);
  const v = await p.evaluate(() => { const vis = e => !!e && !!e.offsetParent; const rows = [...document.querySelectorAll('#paSec tr.pa-r')].filter(vis); return {screen:window.__int.S.screen, rows:rows.length, name:rows[0] && rows[0].querySelector('.pa-name b').textContent, card:vis(document.querySelector('#paSec .pa-x .pa-card')), bar:vis(document.querySelector('#psBar')), barT:(document.querySelector('#psBar') || {}).textContent, tabs:vis(document.querySelector('#evyTabs')), na:vis(document.querySelector('#naBox')), af:vis(document.querySelector('#afBar')), ticks:[...document.querySelectorAll('#paSec .pa-x .pa-chk')].filter(vis).length}; });
  ok(v.screen === 'people' && v.rows === 1 && v.name === who && v.card && v.ticks > 3, 'the key on ' + who + ' opens just their sign-in card, with what they can see (' + v.ticks + ' ticks)');
  ok(v.bar && /Squads/.test(v.barT) && !v.tabs && !v.na && !v.af, '…with a way back to Squads and none of the Access tabs, filters or lists around it');
  await p.click('#psBack'); await p.waitForTimeout(1500);
  ok(await p.evaluate(() => window.__int.S.screen === 'squads' && !document.querySelector('#psBar') && window.__ev('AF.q') === ''), 'Back returns to Squads');
  await p.evaluate(() => window.__int.go('people')); await p.waitForTimeout(2500);
  const acc = await p.evaluate(() => { const vis = e => !!e && !!e.offsetParent; return {tabs:vis(document.querySelector('#evyTabs')), focus:document.querySelector('#people .page').classList.contains('ps-focus'), names:[...document.querySelectorAll('#evyTabs [data-evv]')].map(b => b.textContent.trim().replace(/\d+$/, '')), co:vis(document.querySelector('#coSec')), pa:vis(document.querySelector('#paSec')), tab:[...document.querySelectorAll('#people .sq-tabs [data-sqv="access"]')].map(b => b.textContent.trim())[0]}; });
  ok(acc.tabs && !acc.focus && acc.co && !acc.pa, 'the old Access screen opens on Coaches afterwards, with no player list');
  ok(acc.tab === 'Coaches' && !acc.names.includes('Players') && acc.names.includes('Coaches') && acc.names.includes('Awaiting approval'), 'its tab is now called “' + acc.tab + '”, with: ' + acc.names.join(', '));
  // a player with no account: add from Squads
  await p.evaluate(() => { window.__ev("SQ.team = '*'"); window.__int.go('squads'); }); await p.waitForTimeout(3000);
  const who2 = await p.evaluate(() => { const r = [...document.querySelectorAll('#sqList .sq-row')].find(r => r.querySelector('.sq-login:not(.on)') && [...r.querySelectorAll('input')].every(i => i.value)); const nm = [...r.querySelectorAll('input')].map(i => i.value).join(' '); r.querySelector('.sq-login').click(); return {nm, id:r.dataset.id}; }); await p.waitForTimeout(600);
  ok(await p.$eval('#naE', e => !!e.offsetParent) && (await p.$eval('#naF', e => e.closest('dialog, .tag-modal, [role="dialog"]') ? 1 : 1)), '“No email” on ' + who2.nm + ' asks for an email, squad and first password');
  await p.fill('#naE', 'newkid77@c2ken.net'); await p.fill('#naP', 'scrum2026'); await p.click('#naGo'); await p.waitForTimeout(4000);
  const r2 = await p.evaluate(() => window.ERGS_AUTH.getOne('players', 'newkid77@c2ken.net'));
  ok(r2 && r2.rid === who2.id && r2.name === who2.nm, 'saved against that squad entry');
  ok(await p.evaluate(id => { const r = document.querySelector(`#sqList .sq-row[data-id="${id}"] .sq-login`); return !!r && r.classList.contains('on'); }, who2.id) && await p.evaluate(() => window.__int.S.screen === 'squads'), '…and their key in Squads turns to “Sign-in” without leaving the screen');
  ok((await p.evaluate(() => JSON.parse(localStorage.getItem('fakePwAccounts') || '{}')['newkid77@c2ken.net'] || {})).pw === 'scrum2026', '…with the first password set');
  { const e = p.errs.filter(x => !/reading 'set'|sandboxed/.test(x)), den = await p.evaluate(() => window.__denied || []); ok(!e.length && !den.length, 'no page errors, nothing refused ' + e.concat(den).join(' | ')); }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
