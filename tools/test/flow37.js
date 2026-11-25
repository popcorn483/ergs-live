// ERGS Live on a phone: timeline split by side, score pad labels left and points right (25 November 2026)
// usage: node flow37.js
const { chromium } = require('playwright'); const { open } = require('./real.js');
const lv = (p, fn, arg) => p.evaluate(src => window.__lv(src), '(' + fn.toString() + ')(' + JSON.stringify(arg === undefined ? null : arg) + ')');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
(async () => { const b = await chromium.launch(); const p = await open(b, 'coach', {ctx:await b.newContext({viewport:{width:390, height:844}})});
  await p.addInitScript(() => { try { sessionStorage.setItem('ergs.liveOK', '1'); } catch(e){} }); await p.goto('http://app.test/?live'); await p.waitForTimeout(6000);
  await lv(p, async () => { await save(d => { d.matches = d.matches.filter(m => m.id !== 'tlA'); d.matches.push({id:'tlA', team:'MEDS', home:'ERGS', away:'Royal School Dungannon', status:'1H', clock:{running:true, base:0, at:Date.now() - 900e3}, startAt:Date.now() - 900e3, date:new Date().toISOString().slice(0, 10), code:'union',
    events:[{id:'1', k:'try', s:'H', p:'Christopher Montgomery-Armstrong', m:4, ts:1}, {id:'2', k:'con', s:'H', p:'Cal Weir', m:5, ts:2}, {id:'3', k:'pen', s:'A', p:'Opposition Player', m:9, ts:3}, {id:'4', k:'try', s:'A', p:'', m:12, ts:4}, {id:'5', k:'con', s:'A', p:'Opposition Player', m:13, miss:true, ts:5}, {id:'6', k:'note', s:'', p:'Huge defensive set on our own line.', m:14, ts:6}]}); }, 'tlA'); V.open = 'tlA'; V.openAt = Date.now(); render(); });
  await p.waitForTimeout(2000);
  const tl = await p.evaluate(() => [...document.querySelectorAll('.tl li')].map(li => { const tx = li.querySelector('.tx'), b = tx.querySelector('b'), ic = li.querySelector('.ic'), r = e => e.getBoundingClientRect(); return {cls:li.className, b:b.textContent, sub:(tx.querySelector('span') || {}).textContent || '', h:Math.round(r(li).height), align:getComputedStyle(tx).textAlign, icRight:r(ic).left > r(tx).left, over:li.scrollWidth > li.clientWidth + 1 || r(tx).left < r(li).left, bLines:Math.round(r(b).height / parseFloat(getComputedStyle(b).lineHeight || 18))}; }));
  const H = tl.filter(x => /\bsH\b/.test(x.cls)), A = tl.filter(x => /\bsA\b/.test(x.cls)), N = tl.filter(x => !/\bs[HA]\b/.test(x.cls));
  ok(H.length === 2 && H.every(x => x.align !== 'right' && !x.icRight), 'home entries sit on the left, badge first');
  ok(A.length === 3 && A.every(x => x.align === 'right' && x.icRight), 'away entries are right-aligned, badge on the right');
  ok(tl.find(x => x.b === 'Cal Weir').sub === 'Conversion · ERGS' && tl.find(x => x.b === 'Try').sub === 'Royal School Dungannon' && tl.some(x => x.b === 'Opposition Player' && /^Conversion missed · /.test(x.sub)), 'each entry is the player, then the event and team under it (no player: just the event)');
  ok(H.concat(A).every(x => x.h <= 56 && x.bLines <= 1 && !x.over), 'every entry stays two short lines, even a very long name, and nothing runs off the side (tallest ' + Math.max(...tl.map(x => x.h)) + 'px)');
  ok(N.length === 1 && /Huge defensive set/.test(N[0].b), 'a commentary line is unchanged');
  const pad = await p.evaluate(() => [...document.querySelectorAll('.pad .btn')].map(b => { const s = b.querySelector('span'), sm = b.querySelector('small'), r = e => e.getBoundingClientRect(); return {k:s.textContent, left:Math.round(r(s).left - r(b).left), right:Math.round(r(b).right - r(sm).right), one:r(s).height < 30, al:getComputedStyle(s).textAlign, cut:s.scrollWidth > s.clientWidth + 1}; }));
  ok(pad.length === 14 && pad.every(x => x.al === 'left' && x.one && !x.cut), 'score pad: every label is left-aligned on one line and not cut short (Conversion, Penalty goal…)');
  ok(new Set(pad.map(x => x.left)).size <= 2 && new Set(pad.map(x => x.right)).size <= 2, '…with the points lined up down the right edge');
  ok(!p.errs.length, 'no page errors ' + p.errs.join(' | '));
  await lv(p, () => save(d => { d.matches = d.matches.filter(m => m.id !== 'tlA'); }));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
