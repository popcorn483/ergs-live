// ERGS Live: a match for a B team (24 November 2026)
// usage: node flow25.js
const { chromium } = require('playwright'); const { open } = require('./real.js');
const lv = (p, fn, arg) => p.evaluate(src => window.__lv(src), '(' + fn.toString() + ')(' + JSON.stringify(arg === undefined ? null : arg) + ')');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
(async () => { const b = await chromium.launch(); const p = await open(b, 'coach', {ctx:await b.newContext({viewport:{width:420, height:900}})});
  await p.addInitScript(() => { try { sessionStorage.setItem('ergs.liveOK', '1'); } catch(e){} });
  await p.goto('http://app.test/?live'); await p.waitForTimeout(6000);
  await lv(p, async () => { await save(d => { d.matches = d.matches.filter(m => m.id !== 'bA'); d.matches.push({id:'bA', team:'U14', home:'ERGS', away:'Portora', us:'H', status:'FT', ftAt:Date.now() - 3600e3, ko:new Date(Date.now() - 2*3600e3).toISOString().slice(0, 16), code:'union', final:[12, 7], finalSet:true, events:[]}); }, 'bA'); });
  const openForm = async () => { await lv(p, () => { matchForm(DATA.matches.find(m => m.id === 'bA')); }); await p.waitForTimeout(700); };
  await openForm();
  ok(await p.$('#fSq') && await p.$eval('#fSq', e => e.value) === '' && await p.$eval('#fTeam', e => e.value) === 'U14', 'Edit details: an A / B / C choice beside Our team, on A');
  await p.selectOption('#fSq', 'B'); await p.evaluate(() => { const f = document.querySelector('#fSq').closest('form') || document.querySelector('#fSq').closest('.dlg, dialog, #modal'); const go = [...f.querySelectorAll('button')].filter(x => /save|update|done/i.test(x.textContent)).pop(); go.click(); }); await p.waitForTimeout(1500);
  let m = await lv(p, () => { const x = DATA.matches.find(y => y.id === 'bA'); return {team:x.team, code:teamCode(x.team), sq:teamSq(x.team), score:score(x)}; });
  ok(m.team === 'U14 B' && m.code === 'U14' && m.sq === 'B', 'saved as "' + m.team + '", still an Under 14 match (' + m.code + ')');
  ok(m.score.join('-') === '12-7', 'the score is untouched');
  await lv(p, () => { V.open = 'bA'; V.openAt = Date.now(); render(); }); await p.waitForTimeout(800);
  ok(/U14 B/.test(await p.$eval('.mv-code', e => e.textContent)) && /Under 14 B/.test(await p.$eval('.mv-name', e => e.textContent)), 'the match screen says U14 B · Under 14 B');
  await lv(p, () => { V.open = null; render(); }); await p.waitForTimeout(600);
  ok(/U14 B/.test(await p.$eval('#view', e => e.textContent)), 'and so does the match list');
  await openForm(); ok(await p.$eval('#fSq', e => e.value) === 'B' && await p.$eval('#fTeam', e => e.value) === 'U14', 'opening Edit details again keeps B');
  await p.selectOption('#fSq', ''); await p.evaluate(() => { const f = document.querySelector('#fSq').closest('form') || document.querySelector('#fSq').closest('.dlg, dialog, #modal'); [...f.querySelectorAll('button')].filter(x => /save|update|done/i.test(x.textContent)).pop().click(); }); await p.waitForTimeout(1500);
  ok(await lv(p, () => DATA.matches.find(y => y.id === 'bA').team) === 'U14', 'back to the A team: "U14"');
  ok(await lv(p, () => [teamSq('U14B'), teamSq('1XV B'), teamSq('Meds C'), teamSq('JG'), teamSq('SG'), teamSq('U13'), teamSq('')].join('|')) === 'B|B|C||||', 'names are read correctly (U14B, 1XV B, Meds C; not JG, SG, U13)');
  { const e = p.errs, den = await p.evaluate(() => window.__denied || []); ok(!e.length && !den.length, 'no page errors, nothing refused ' + e.concat(den).join(' | ')); }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
