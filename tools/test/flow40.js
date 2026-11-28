// ERGS Live: five different try animations, taken in turn through a match (28 November 2026)
// usage: node flow40.js
const { chromium } = require('playwright'); const { open } = require('./real.js');
const lv = (p, fn, arg) => p.evaluate(src => window.__lv(src), '(' + fn.toString() + ')(' + JSON.stringify(arg === undefined ? null : arg) + ')');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
(async () => { const b = await chromium.launch(); const p = await open(b, 'coach', {ctx:await b.newContext({viewport:{width:390, height:780}})});
  await p.addInitScript(() => { try { sessionStorage.setItem('ergs.liveOK', '1'); } catch(e){} }); await p.goto('http://app.test/?live'); await p.waitForTimeout(6000);
  const order = await lv(p, () => { const ev = (i, k, s) => ({id:'t' + i, k, s, p:'Gus Hart', m:i, ts:i}), m = {id:'tvA', team:'1XV', home:'ERGS', away:'Portora', status:'1H', code:'union', events:[ev(1, 'try', 'H'), ev(2, 'con', 'H'), ev(3, 'try', 'A'), ev(4, 'try', 'H'), ev(5, 'pen', 'A'), ev(6, 'try', 'H'), ev(7, 'try', 'A'), ev(8, 'try', 'H'), ev(9, 'pt', 'H')]};
    return {tries:m.events.filter(e => e.k === 'try').map(e => tryVar(m, e)), again:m.events.filter(e => e.k === 'try').map(e => tryVar(m, e)), pt:tryVar(m, m.events[8]), all:TRY_VARS.slice(), other:tryVar(Object.assign({}, m, {id:'tvB'}), m.events[0])}; });
  ok(order.all.length === 5 && new Set(order.tries.slice(0, 5)).size === 5, 'five try animations (' + order.all.join(', ') + '), and the first five tries of a match use all five: ' + order.tries.slice(0, 5).join(' → '));
  ok(order.tries[5] === order.tries[0] && order.tries.every((v, i) => !i || v !== order.tries[i - 1]), 'the sixth try comes back round to the first; no two tries in a row look the same');
  ok(order.tries.join() === order.again.join(), 'the same try always plays the same animation, so everyone watching sees the same one');
  ok(order.pt === 'posts', 'a penalty try is always the one under the posts');
  for (const v of order.all){
    await lv(p, v => { TRY_FORCE = v; const m = {id:'tvA', team:'1XV', home:'ERGS', away:'Portora', status:'1H', code:'union', events:[{id:'t1', k:'try', s:'H', p:'Gus Hart', m:4, ts:1}]}; Q.length = 0; Q.push([m, m.events[0]]); playFx(); }, v);
    await p.waitForFunction(() => document.querySelector('#fx.on .fx-try') && document.getAnimations().length > 5); await p.waitForTimeout(60);
    const at = ms => p.evaluate(ms => document.getAnimations().forEach(a => { a.pause(); a.currentTime = ms; }), ms);
    const snap = () => p.evaluate(() => { const r = e => e.getBoundingClientRect(), sc = document.querySelector('#fx .fx-try'), bl = r(sc.querySelector('.fx-tball')), s = r(sc), cs = e => getComputedStyle(e); return {v:sc.dataset.tryv, x:Math.round(bl.left + bl.width / 2 - s.left), y:Math.round(s.bottom - (bl.top + bl.height / 2)), op:+cs(sc.querySelector('.fx-tball')).opacity, crest:+cs(sc.querySelector('.fx-trycrest')).opacity, kind:document.querySelector('#fxKind').textContent, who:document.querySelector('#fxWho').textContent, extra:sc.querySelectorAll('.fx-flag, .fx-tposts, .fx-def, .fx-hop, .fx-streak, .fx-trail').length}; });
    await at(450); const a = await snap(); await at(900); const g = await snap(); await at(2300); const e = await snap();
    const moved = Math.hypot(a.x - g.x, a.y - g.y);
    ok(a.v === v && a.op === 1 && moved > 40 && g.y < 70 && e.crest > .9 && /TRY!/.test(e.kind) && /Gus Hart/.test(e.who) && (v === 'dive' ? !a.extra : a.extra > 0), v + ': the ball travels ' + Math.round(moved) + 'px in and is grounded on the turf at 0.9s, then the crest, TRY! and the scorer' + (v === 'dive' ? '' : ' (with its own props)'));
    await p.evaluate(() => { document.getAnimations().forEach(a => a.play()); document.querySelector('#fx').click(); }); await p.waitForTimeout(700); }
  await lv(p, () => { TRY_FORCE = ''; });
  ok(!p.errs.length, 'no page errors ' + p.errs.join(' | '));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
