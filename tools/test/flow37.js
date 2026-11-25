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
  // the popup for adding a score
  const dlg = async (k, s) => { await lv(p, a => openEv(DATA.matches.find(y => y.id === 'tlA'), a[0], a[1]), [k, s]); await p.waitForTimeout(400);
    return p.evaluate(() => { const d = document.querySelector('.ev-head').closest('dialog, .dialog, [role="dialog"]') || document.body, vis = e => !!e && !!e.offsetParent; return {ico:!!document.querySelector('.ev-ico svg') && vis(document.querySelector('.ev-ico')), h:document.querySelector('.ev-head h2').textContent, side:document.querySelector('.ev-head p').textContent, seg:[...document.querySelectorAll('[data-seg="res"] button')].filter(vis).length, btns:[...document.querySelectorAll('.ev-a .btn')].filter(vis).map(b => b.textContent.trim()), inputs:[...document.querySelectorAll('.ev-row input')].filter(vis).length, svg:document.querySelector('.ev-ico').innerHTML.length}; }); };
  const t1 = await dlg('try', 'H'); ok(t1.ico && t1.h === 'Try' && /ERGS.*\+5/.test(t1.side) && t1.btns.join() === 'Cancel,Next: conversion' && t1.inputs === 2, 'adding a try: a picture, “Try”, the side and +5, the player and minute, and two buttons');
  await p.fill('#evWho', 'Gus Hart'); await p.click('#evGo'); await p.waitForTimeout(500);
  const c1 = await p.evaluate(() => ({h:document.querySelector('.ev-head h2').textContent, cls:document.querySelector('.ev-head').className, seg:document.querySelectorAll('[data-seg="res"] button').length, btns:[...document.querySelectorAll('.ev-a .btn')].map(b => b.textContent.trim()), svg:document.querySelector('.ev-ico').innerHTML.length}));
  ok(c1.h === 'Conversion' && / con/.test(c1.cls) && c1.svg !== t1.svg && !c1.seg && c1.btns.join() === 'No kick,Missed,Scored', 'then the conversion: its own picture, and just No kick / Missed / Scored (no separate Scored/Missed switch)');
  await p.click('#evMiss'); await p.waitForTimeout(1500);
  ok((await lv(p, () => DATA.matches.find(y => y.id === 'tlA').events.slice(-2).map(e => e.k + ':' + e.p + (e.miss ? ':miss' : '')))).join() === 'try:Gus Hart,con:Cal Weir:miss', 'Missed saves the try and a missed conversion by the remembered kicker');
  const y1 = await dlg('yc', 'A'); ok(y1.ico && y1.h === 'Yellow card' && y1.btns.join() === 'Cancel,Add', 'a card has its own picture and one Add button'); await p.click('#evSkip'); await p.waitForTimeout(300);
  ok(!p.errs.length, 'no page errors ' + p.errs.join(' | '));
  await lv(p, () => save(d => { d.matches = d.matches.filter(m => m.id !== 'tlA'); }));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
