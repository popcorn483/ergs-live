// Go through the players with no email and add them quickly, one after another (24 November 2026)
// usage: STUB3=1 node flow34.js
const { chromium } = require('playwright'); const { open } = require('./real.js');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
(async () => { const b = await chromium.launch(); const p = await open(b, 'admin', {ctx:await b.newContext({viewport:{width:420, height:900}})});
  await p.addInitScript(() => { localStorage.setItem('ergs.pwNo', '1'); const d = new Date().toISOString().slice(0, 10), n = (id, name, team) => ({id, name, team, date:d, at:1});
    window.__fsSeed['team/noms'] = {j:JSON.stringify({list:[n('a', 'Aaron Able', 'U12'), n('b', 'Bobby Baker', 'U12'), n('c', 'Colm Carter', 'U13'), n('d', 'Dara Devine', 'U14')]})}; });
  await p.goto('http://app.test/app/'); await p.waitForTimeout(8000);
  await p.evaluate(() => { window.__ev("SQ.team = '*'"); window.__int.go('squads'); }); await p.waitForTimeout(3000);
  ok(await p.$eval('#sqQuick', e => !!e.offsetParent), 'Squads has “Add emails”, on screen'); await p.click('#sqQuick'); await p.waitForTimeout(800);
  const who = () => p.$eval('.nq-who', e => e.textContent.replace(/\s+/g, ' ')), prog = () => p.$eval('.nq-prog', e => e.textContent), get = em => p.evaluate(em => window.ERGS_AUTH.getOne('players', em), em);
  const total = +(await prog()).match(/of (\d+)/)[1];
  ok(/Aaron Able ?Under 12/.test(await who()) && /^1 of/.test(await prog()) && await p.evaluate(() => document.activeElement.id === 'nqE'), 'it starts with the first player, squad by squad, cursor in the email box: ' + await who() + ' (' + await prog() + ')');
  await p.fill('#nqE', 'aable123'); ok(/aable123@c2ken\.net/.test(await p.$eval('#nqEg', e => e.textContent)), 'a school username on its own is shown as the full address');
  await p.press('#nqE', 'Enter'); await p.waitForTimeout(2500);
  const a = await get('aable123@c2ken.net'); ok(a && a.name === 'Aaron Able' && a.team === 'U12' && !!a.rid, 'Enter saves them as an Under 12 player, tied to their squad entry');
  ok(/Bobby Baker/.test(await who()) && /^2 of .*1 added/.test(await prog()) && await p.evaluate(() => document.activeElement.id === 'nqE' && document.activeElement.value === ''), '…and the next player is up straight away: ' + await who());
  await p.click('#nqSkip'); await p.waitForTimeout(500); ok(/Colm Carter/.test(await who()), 'Skip moves on without saving');
  await p.fill('#nqE', 'not an email@'); await p.press('#nqE', 'Enter'); await p.waitForTimeout(400); ok(/doesn’t look like/.test(await p.$eval('#nqMsg', e => e.textContent)) && /Colm Carter/.test(await who()), 'a bad address is refused and stays on the same player');
  await p.evaluate(() => document.querySelector('.nq-more').open = true); await p.fill('#nqP', 'ruck2026'); await p.fill('#nqE', 'Colm.Carter@gmail.com'); await p.press('#nqE', 'Enter'); await p.waitForTimeout(2500);
  ok((await get('colm.carter@gmail.com') || {}).name === 'Colm Carter' && !(await p.evaluate(() => JSON.parse(localStorage.getItem('fakePwAccounts') || '{}')['colm.carter@gmail.com'])), 'a full Google address works too, and gets no password');
  ok(await p.$eval('#nqP', e => e.value) === 'ruck2026', 'the first password is kept for the next player');
  let skipped = 1; while (!/Dara Devine/.test(await who())){ await p.click('#nqSkip'); await p.waitForTimeout(300); skipped++; }
  await p.fill('#nqE', 'ddevine456'); await p.press('#nqE', 'Enter'); await p.waitForTimeout(2500);
  ok((await p.evaluate(() => JSON.parse(localStorage.getItem('fakePwAccounts') || '{}')['ddevine456@c2ken.net'] || {})).pw === 'ruck2026' && await p.evaluate(() => window.__int.Cloud.role === 'coach'), 'a school address gets that first password, and the head coach stays signed in');
  await p.click('#nqDone'); await p.waitForTimeout(2500);
  ok(await p.evaluate(() => document.querySelector('#tagModal').hidden), 'Finish closes it');
  await p.waitForTimeout(1500); const keys = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#sqList .sq-row')].map(r => [[...r.querySelectorAll('input')].map(i => i.value).join(' '), r.querySelector('.sq-login') ? r.querySelector('.sq-login').textContent.trim() : ''])));
  ok(keys['Aaron Able'] === 'Sign-in' && keys['Dara Devine'] === 'Sign-in' && keys['Colm Carter'] === 'Sign-in' && keys['Bobby Baker'] === 'No email', 'back in Squads the three added have a sign-in; the skipped player still shows “No email”');
  await p.click('#sqQuick'); await p.waitForTimeout(800); ok(+(await prog()).match(/of (\d+)/)[1] === total - 3 && /Bobby Baker/.test(await who()), 'starting again picks up with who is left (' + (total - 3) + ')'); await p.click('#nqDone'); await p.waitForTimeout(500);
  { const e = p.errs.filter(x => !/reading 'set'|sandboxed/.test(x)), den = await p.evaluate(() => window.__denied || []); ok(!e.length && !den.length, 'no page errors, nothing refused ' + e.concat(den).join(' | ')); }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
