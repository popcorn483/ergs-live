// ERGS Live on a narrow phone: the scorer line and the big word can always be read (28 November 2026)
// usage: node flow41.js
const { chromium } = require('playwright'); const { open } = require('./real.js');
const lv = (p, fn, arg) => p.evaluate(src => window.__lv(src), '(' + fn.toString() + ')(' + JSON.stringify(arg === undefined ? null : arg) + ')');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
(async () => { const b = await chromium.launch(); const p = await open(b, 'coach', {ctx:await b.newContext({viewport:{width:360, height:700}})});
  await p.addInitScript(() => { try { sessionStorage.setItem('ergs.liveOK', '1'); } catch(e){} }); await p.goto('http://app.test/?live'); await p.waitForTimeout(4000);
  const show = async (k, name, home, extra) => { await lv(p, a => { const m = {id:'tvA', team:'1XV', home:a[2], away:a[2] === 'ERGS' ? 'Portora' : 'ERGS', status:'1H', code:'union', events:[Object.assign({id:'t1', k:a[0], s:'H', p:a[1], m:4, ts:1}, a[3] || {})]}; Q.length = 0; Q.push([m, m.events[0]]); playFx(); }, [k, name, home, extra]);
    await p.waitForFunction(() => document.querySelector('#fx.on') && document.getAnimations().length > 3); await p.waitForTimeout(60);
    await p.evaluate(() => { document.getAnimations().forEach(a => { a.pause(); a.currentTime = 3000; }); if (window.FX3D && FX3D.cur) FX3D.cur.seek(3); }); await p.waitForTimeout(60);
    const r = await p.evaluate(() => { const q = s => document.querySelector(s), R = e => e.getBoundingClientRect(), w = q('#fxWho'), k = q('#fxKind'), cs = getComputedStyle(w), bg = cs.backgroundColor.match(/[\d.]+/g).map(Number), fg = cs.color.match(/[\d.]+/g).map(Number), wr = R(w), kr = R(k), words = [...k.querySelectorAll('.w')].map(R);
      return {who:w.textContent, bgA:bg.length > 3 ? bg[3] : 1, bgDark:bg[0] + bg[1] + bg[2] < 120, fgLight:fg[0] + fg[1] + fg[2] > 500, whoIn:wr.left >= 0 && wr.right <= innerWidth + .5, whoOp:+cs.opacity, kind:k.textContent, kindIn:(words.length ? words : [kr]).every(x => x.left >= -1 && x.right <= innerWidth + 1), lines:Math.round(wr.height / parseFloat(cs.lineHeight))}; });
    await p.evaluate(() => { document.getAnimations().forEach(a => a.play()); document.querySelector('#fx').click(); }); await p.waitForTimeout(800); return r; };
  for (const [k, name, home, extra, label] of [['try', 'Cal Weir', 'ERGS', null, 'a try'], ['try', 'Christopher Montgomery-Armstrong', 'ERGS', null, 'a try by a very long name'], ['try', 'Opposition Player', 'Royal School Dungannon', null, 'an opposition try'], ['con', 'Cal Weir', 'ERGS', null, 'a conversion'], ['con', 'Cal Weir', 'ERGS', {miss:true}, 'a missed conversion'], ['pen', 'Cal Weir', 'ERGS', null, 'a penalty goal'], ['dg', 'Cal Weir', 'ERGS', null, 'a drop goal'], ['pt', '', 'ERGS', null, 'a penalty try']]){
    const r = await show(k, name, home, extra);
    ok(r.whoOp > .9 && r.bgA > .8 && r.bgDark && r.fgLight && r.whoIn && (!name || r.who.includes(name.toUpperCase()) || r.who.includes(name)) && r.who.includes(home), label + ': “' + r.who + '” is light text on its own dark plate, inside the screen' + (r.lines > 1 ? ' (' + r.lines + ' lines)' : ''));
    ok(r.kindIn, label + ': “' + r.kind.replace(/\s+/g, ' ') + '” fits the width of a 360px phone'); }
  ok(!p.errs.length, 'no page errors ' + p.errs.join(' | '));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
