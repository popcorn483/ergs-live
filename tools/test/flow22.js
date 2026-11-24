// ERGS Live: who sees the full-screen score animations (24 November 2026)
// usage: node flow22.js
const { chromium } = require('playwright'); const { open } = require('./real.js');
const lv = (p, fn, arg) => p.evaluate(src => window.__lv(src), '(' + fn.toString() + ')(' + JSON.stringify(arg === undefined ? null : arg) + ')');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const setup = async (b, role) => { const p = await open(b, role, {ctx:await b.newContext({viewport:{width:420, height:900}})});
  await p.addInitScript(() => { try { sessionStorage.setItem('ergs.liveOK', '1'); } catch(e){} });
  await p.goto('http://app.test/?live'); await p.waitForTimeout(6000);
  // two matches in play, already "seen" by this page
  await lv(p, () => { const mk = (id, team) => ({id, team, home:'ERGS', away:'Portora', status:'1H', date:new Date().toISOString().slice(0, 10), events:[{id:id + 'e0', k:'try', s:'H', p:'A Player', ts:Date.now() - 20*60e3}], code:'union'});
    DATA.matches = DATA.matches.filter(m => !/^fx/.test(m.id)).concat([mk('fxA', '1XV'), mk('fxB', 'U14')]); V.open = null; LOOK_LIVE = true; LOOK_AT = 0; Q.length = 0; newSinceLastLook(); });
  return p; };
// a new try in match `id`; returns what the supporter got
const score = (p, id, openId) => lv(p, async ([id, openId]) => { V.open = openId; Q.length = 0; busy = false; document.querySelector('#toast').hidden = true; const fx = document.querySelector('#fx'); if (fx) fx.hidden = true;
  const m = DATA.matches.find(x => x.id === id); m.events.push({id:id + 'e' + Date.now(), k:'try', s:'H', p:'B Runner', ts:Date.now()}); LOOK_LIVE = true; LOOK_AT = 0; newSinceLastLook();
  await new Promise(r => setTimeout(r, 1200)); const fx2 = document.querySelector('#fx'), t = document.querySelector('#toast');
  return {full:!!(fx2 && !fx2.hidden), line:t.hidden ? '' : t.textContent}; }, [id, openId]);
(async () => { const b = await chromium.launch();
  { const p = await setup(b, 'out');   // a supporter
    let r = await score(p, 'fxA', null); ok(!r.full && /Try \(1XV\): B Runner, ERGS · ERGS 10–0 Portora/.test(r.line), 'match list: no full animation, one line instead ("' + r.line + '")');
    r = await score(p, 'fxA', 'fxA'); ok(r.full && !r.line, 'on that match’s own screen: the full animation');
    await p.evaluate(() => { const fx = document.querySelector('#fx'); fx.click(); }); await p.waitForTimeout(700);
    r = await score(p, 'fxB', 'fxA'); ok(!r.full && /Try \(U14\)/.test(r.line), 'on another match’s screen: one line for this one ("' + r.line + '")');
    r = await lv(p, async () => { V.open = null; Q.length = 0; busy = false; document.querySelector('#toast').hidden = true; const m = DATA.matches.find(x => x.id === 'fxA'); m.status = 'FT'; m.ftAt = Date.now(); LOOK_LIVE = true; LOOK_AT = 0; newSinceLastLook(); await new Promise(r => setTimeout(r, 1200)); const fx = document.querySelector('#fx'), t = document.querySelector('#toast'); return {full:!fx.hidden, line:t.hidden ? '' : t.textContent}; });
    ok(!r.full && /Full time \(1XV\): ERGS \d+–0 Portora/.test(r.line), 'full time from the match list: one line ("' + r.line + '")');
    { const e = p.errs; ok(!e.length, 'no page errors ' + e.join(' | ')); } }
  { const p = await setup(b, 'coach');   // a coach who is scoring match A
    await lv(p, () => { const m = DATA.matches.find(x => x.id === 'fxA'); m.scorer = {k:meKey(), n:'Me', at:Date.now()}; });
    let r = await score(p, 'fxA', 'fxA'); ok(!r.full && !r.line, 'the scorer, on the match they are scoring: nothing at all');
    r = await score(p, 'fxB', 'fxA'); ok(!r.full && /Try \(U14\)/.test(r.line), 'the scorer, a score in another match: one line');
    r = await score(p, 'fxB', 'fxB'); ok(!r.full && /Try \(U14\)/.test(r.line), 'the scorer, even on that other match’s screen: one line, no animation');
    r = await lv(p, async () => { V.open = 'fxA'; Q.length = 0; busy = false; document.querySelector('#toast').hidden = true; const m = DATA.matches.find(x => x.id === 'fxA'); m.status = 'FT'; m.ftAt = Date.now(); delete m.scorer; LOOK_LIVE = true; LOOK_AT = 0; newSinceLastLook(); await new Promise(r => setTimeout(r, 1200)); const fx = document.querySelector('#fx'), t = document.querySelector('#toast'); return {full:!fx.hidden, line:t.hidden ? '' : t.textContent}; });
    ok(!r.full && !r.line, 'the scorer blowing full time: no celebration over the scoring screen');
    await lv(p, () => { const m = DATA.matches.find(x => x.id === 'fxA'); m.ftAt = Date.now() - 11*60e3; });
    r = await score(p, 'fxB', 'fxB'); ok(r.full, 'ten minutes after their match ended they are a supporter again: full animation on a match screen');
    { const e = p.errs; ok(!e.length, 'no page errors ' + e.join(' | ')); } }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
