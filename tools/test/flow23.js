// ERGS Live: a coach changes who scored after full time (24 November 2026)
// usage: node flow23.js
const { chromium } = require('playwright'); const { open } = require('./real.js');
const lv = (p, fn, arg) => p.evaluate(src => window.__lv(src), '(' + fn.toString() + ')(' + JSON.stringify(arg === undefined ? null : arg) + ')');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const go = async (b, role) => { const p = await open(b, role, {ctx:await b.newContext({viewport:{width:420, height:900}})});
  await p.addInitScript(() => { try { sessionStorage.setItem('ergs.liveOK', '1'); } catch(e){} });
  await p.goto('http://app.test/?live'); await p.waitForTimeout(6000); return p; };
(async () => { const b = await chromium.launch(); const p = await go(b, 'coach');
  // a finished match with a try, a missed conversion and a penalty
  await lv(p, async () => { await save(d => { d.matches = d.matches.filter(m => m.id !== 'edA'); d.matches.push({id:'edA', team:'1XV', home:'ERGS', away:'Portora', status:'FT', ftAt:Date.now() - 3600e3, date:new Date().toISOString().slice(0, 10), code:'union',
      events:[{id:'t1', k:'try', s:'H', p:'Wrong Name', m:12, ts:1}, {id:'c1', k:'con', s:'H', p:'A Kicker', m:13, miss:true, ts:2}, {id:'p1', k:'pen', s:'A', p:'', m:30, ts:3}]}); }, 'edA'); V.open = 'edA'; V.openAt = Date.now(); render(); });
  await p.waitForTimeout(1500);
  ok(await p.$('[data-edev="t1"]'), 'full time: each timeline entry has a pencil');
  await p.click('[data-edev="t1"]'); await p.waitForTimeout(500);
  ok(await p.$eval('#edWho', e => e.value) === 'Wrong Name' && await p.$eval('#edMin', e => e.value) === '12', 'it opens with the player and minute as recorded');
  await p.fill('#edWho', 'Right Name'); await p.fill('#edMin', '14'); await p.click('#edGo'); await p.waitForTimeout(1500);
  let m = await lv(p, () => { const x = DATA.matches.find(y => y.id === 'edA'); return {ev:x.events, st:x.status, sc:score(x), scorer:!!x.scorer}; });
  const t = m.ev.find(e => e.id === 't1');
  ok(t.p === 'Right Name' && t.m === 14 && t.k === 'try' && t.ts === 1, 'saved: same entry, new player and minute ' + JSON.stringify(t));
  ok(m.st === 'FT' && m.ev.length === 3 && m.sc.join('-') === '5-3', 'the match stays at full time, same score (' + m.sc.join('-') + ')');
  ok(/Right Name/.test(await p.$eval('.tl', e => e.textContent)) && !/Wrong Name/.test(await p.$eval('#view', e => e.textContent)), 'the timeline and scorers show the new name');
  // a missed kick that actually went over
  await p.click('[data-edev="c1"]'); await p.waitForTimeout(400); await p.click('[data-seg="res"] [data-v="ok"]'); await p.click('#edGo'); await p.waitForTimeout(1500);
  m = await lv(p, () => { const x = DATA.matches.find(y => y.id === 'edA'); return {c:x.events.find(e => e.id === 'c1'), sc:score(x)}; });
  ok(!m.c.miss && m.sc.join('-') === '7-3', 'a kick marked missed can be changed to scored: ' + m.sc.join('-'));
  // open and save without touching anything: nothing changes (a missed kick stays missed)
  await lv(p, () => save(d => { d.matches.find(y => y.id === 'edA').events.find(e => e.id === 'c1').miss = true; }, 'edA')); await p.waitForTimeout(800);
  await p.click('[data-edev="c1"]'); await p.waitForTimeout(400); await p.click('#edGo'); await p.waitForTimeout(1200);
  ok(await lv(p, () => DATA.matches.find(y => y.id === 'edA').events.find(e => e.id === 'c1').miss === true), 'saving without changes leaves a missed kick missed');
  // the opposition's penalty: add a name
  await p.click('[data-edev="p1"]'); await p.waitForTimeout(400); await p.fill('#edWho', 'Their 10'); await p.click('#edGo'); await p.waitForTimeout(1200);
  ok(await lv(p, () => DATA.matches.find(y => y.id === 'edA').events.find(e => e.id === 'p1').p) === 'Their 10', 'an entry with no name can be given one');
  { const e = p.errs, den = await p.evaluate(() => window.__denied || []); ok(!e.length && !den.length, 'no page errors, nothing refused by the rules ' + e.concat(den).join(' | ')); }
  // a supporter has no pencil
  const q = await go(b, 'out'); await lv(q, () => { V.open = 'edA'; V.openAt = Date.now(); render(); }); await q.waitForTimeout(1000);
  ok(!(await q.$('[data-edev]')) && !(await q.$('[data-rm]')), 'a supporter sees no pencil');
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
