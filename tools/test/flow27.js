// Drills: "why we do this", the reason under the pitch while it plays, and the coaching clips bank (24 November 2026)
// usage: STUB3=1 node flow27.js
const { chromium } = require('playwright'); const { open } = require('./real.js');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const start = async (b, role, vp, seed) => { const p = await open(b, role, {ctx:await b.newContext({viewport:vp || {width:1200, height:900}})});
  await p.addInitScript(seed => { localStorage.setItem('ergs.pwNo', '1'); if (seed && window.__fsSeed) window.__fsSeed['team/coachclips'] = {j:JSON.stringify({clips:[{id:'c1', url:'https://youtu.be/abcdefghijk', title:'Tackle technique for juniors', note:'Watch how low the tackler gets.', tags:['Tackling'], drill:'', at:1}], updated:1})}; }, seed); await p.route('**/i.ytimg.com/**', r => r.fulfill({status:200, contentType:'image/gif', body:Buffer.from('R0lGODlhAQABAAAAACw=', 'base64')})); await p.route(/youtube\.com\/oembed/, r => r.fulfill({status:200, contentType:'application/json', headers:{'access-control-allow-origin':'*'}, body:'{"title":"Tackle technique for juniors"}'})); await p.route('**/youtube-nocookie.com/**', r => r.fulfill({status:200, contentType:'text/html', body:'<p>video</p>'}));
  await p.goto('http://app.test/app/'); await p.waitForTimeout(4500); return p; };
const openDrill = (p, rx) => p.evaluate(async rx => { const T = window.__ev, d = (window.__dl || (window.__dl = window.__ev("PRE_DRILLS().concat(PRE_DRILLS2(), PRE_DRILLS3(), PRE_DRILLS4(), PRE_DRILLS5())"))).find(d => new RegExp(rx, 'i').test((d.tags || []).join(' ')) && d.frames.length > 2); T("openDrill")(d); await new Promise(r => setTimeout(r, 1500)); return {id:d.id, title:d.title, tags:d.tags, caps:d.frames.map(f => f.caption || '')}; }, rx);
(async () => { const b = await chromium.launch();
  const p = await start(b, 'coach'); const d = await openDrill(p, 'Tackling');
  ok(d && d.id, 'a tackling drill opens: ' + d.title);
  const w = await p.evaluate(() => { const el = document.querySelector('#drInfoWhy'); return el ? {txt:el.textContent, stars:(el.querySelector('.dw-stars') || {}).textContent, lis:el.querySelectorAll('ul li').length} : null; });
  ok(w && /Why we do this drill/.test(w.txt) && /safest tackle/.test(w.txt), 'the drill has a "Why we do this drill" panel, written for tackling');
  ok(/In a match/.test(w.txt) && /small things/.test(w.txt) && w.lis >= 3, '…with "In a match" and the small things that make it work (' + w.lis + ')');
  ok(/How useful: Very high/.test(w.txt) && w.stars === '★★★★★', '…and how useful it is (' + w.stars + ')');
  // (the 3D stub stops the app's own draw loop in this harness, so the strip is asked for directly, as the loop does)
  const strip = pg => pg.evaluate(() => window.__ev("drillWhyStrip(S.play, S.cur)")); await strip(p);
  const s1 = await p.evaluate(() => { const el = document.querySelector('#stageWhy'); return el && !el.hidden ? el.querySelector('.sw-why span').textContent : ''; });
  ok(s1.length > 20, 'under the pitch: "Why ' + s1.slice(0, 70) + '…"');
  const seq = await p.evaluate(async () => { const T = window.__ev, out = []; const n = T("S.play.frames.length"); for (let i = 0; i < Math.min(n, 5); i++){ T("selectFrame")(i); T("drillWhyStrip(S.play, S.cur)"); await new Promise(r => setTimeout(r, 100)); out.push(document.querySelector('#stageWhy .sw-why span').textContent); } return out; });
  ok(new Set(seq).size > 1 && seq.every(x => x.length > 15), 'the reason changes with the step (' + new Set(seq).size + ' different in ' + seq.length + ' steps)');
  const all = await p.evaluate(() => { const T = window.__ev, L = (window.__dl || (window.__dl = window.__ev("PRE_DRILLS().concat(PRE_DRILLS2(), PRE_DRILLS3(), PRE_DRILLS4(), PRE_DRILLS5())"))); let bad = 0, def = 0; L.forEach(d => { const w = T("drillWhy")(d); if (!w.why || !w.match || w.small.length < 3 || !(w.v >= 2 && w.v <= 5)) bad++; if (!w.tags.length) def++; }); return {n:L.length, bad, def}; });
  ok(all.n > 100 && !all.bad, 'every drill has one: ' + all.n + ' drills, ' + all.bad + ' incomplete (' + all.def + ' use the general wording)');
  // switch the strip off
  await p.evaluate(() => { document.querySelector('#dwOn').click(); }); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.querySelector('#stageWhy').hidden), 'the tick box switches the strip off');
  await p.evaluate(() => { document.querySelector('#dwOn').click(); }); await p.waitForTimeout(300); await strip(p);
  // coaching clips: add one for Tackling from the drill
  ok(await p.$('#ccAddHere'), 'coach: "Add a clip" on the drill');
  await p.click('#ccAddHere'); await p.waitForTimeout(400);
  ok(await p.$eval('[data-ct="Tackling"]', e => e.getAttribute('aria-pressed')) === 'true', 'the form starts with the drill’s skills ticked');
  await p.click('#ccGo'); await p.waitForTimeout(200); ok(/full link/.test(await p.$eval('#ccMsg', e => e.textContent)), 'no link: asked for one');
  await p.fill('#ccUrl', 'https://www.youtube.com/watch?v=abcdefghijk'); await p.dispatchEvent('#ccUrl', 'change'); await p.waitForTimeout(700);
  ok(await p.$eval('#ccTitle', e => e.value) === 'Tackle technique for juniors', 'the video’s own title is filled in');
  await p.fill('#ccNote', 'Watch how low the tackler gets, and where the head goes.'); await p.click('#ccGo'); await p.waitForTimeout(1500);
  const saved = await p.evaluate(() => (window.__int.Cloud.docs['team/coachclips'] || {}).clips);
  ok(saved && saved.length === 1 && saved[0].tags.includes('Tackling') && !saved[0].drill, 'saved to the bank under Tackling');
  ok(await p.$('#dwClips .cc-card'), 'the clip shows on the drill');
  await p.click('#dwClips .cc-card'); await p.waitForTimeout(500);
  ok(await p.evaluate(() => { const f = document.querySelector('#tagModal iframe'); return !!f && /youtube-nocookie\.com\/embed\/abcdefghijk/.test(f.src) && /Watch how low/.test(document.querySelector('#tagModal').textContent); }), 'tapping it plays the video in the app, with what to look for');
  await p.click('#ccDone'); await p.waitForTimeout(300); ok(!(await p.$('#tagModal iframe')), 'closing the box stops the video');
  // another tackling drill gets it too; a passing-only drill does not
  const other = await p.evaluate(async id => { const T = window.__ev, L = (window.__dl || (window.__dl = window.__ev("PRE_DRILLS().concat(PRE_DRILLS2(), PRE_DRILLS3(), PRE_DRILLS4(), PRE_DRILLS5())"))); const d2 = L.find(d => d.id !== id && (d.tags || []).includes('Tackling')), d3 = L.find(d => (d.tags || []).includes('Passing') && !(d.tags || []).includes('Tackling'));
    T("openDrill")(d2); await new Promise(r => setTimeout(r, 1200)); const a = document.querySelectorAll('#dwClips .cc-card').length; T("openDrill")(d3); await new Promise(r => setTimeout(r, 1200)); return [a, document.querySelectorAll('#dwClips .cc-card').length]; }, d.id);
  ok(other[0] === 1 && other[1] === 0, 'it appears on other tackling drills (' + other[0] + ') and not on a passing drill (' + other[1] + ')');
  { const e = p.errs.filter(x => !/reading 'set'/.test(x)), den = await p.evaluate(() => window.__denied || []); ok(!e.length && !den.length, 'coach: no page errors, nothing refused ' + e.concat(den).join(' | ')); }
  // a player: sees the why, the clip and the bank, and cannot add
  const q = await start(b, 'player', {width:420, height:900}, true);
  { const r = await q.evaluate(async () => { try { await window.__ev("Cloud.set('team/coachclips', {clips:[]})"); return 'allowed'; } catch(e){ return 'refused'; } }); await q.waitForTimeout(500);
    ok(r === 'refused' && await q.evaluate(() => window.__ev("ccAll().length")) === 1, 'a player cannot change the bank (' + r + ')'); }
  await openDrill(q, 'Tackling'); await q.waitForTimeout(800);
  ok(await q.$('#drInfoWhy') && await q.$('#dwClips .cc-card') && !(await q.$('#ccAddHere')), 'player: sees the why and the clip, with no Add button');
  await strip(q);
  ok(await q.evaluate(() => { const el = document.querySelector('#stageWhy'); return !!el && !el.hidden && getComputedStyle(el.querySelector('.sw-cap')).display !== 'none'; }), 'on a phone the strip also carries the step’s caption (it is hidden on the pitch there)');
  await q.evaluate(() => window.__ev("ccBank")()); await q.waitForTimeout(400);
  ok(await q.evaluate(() => /Tackling/.test((document.querySelector('#tagModal .cc-sec h4') || {}).textContent || '') && !document.querySelector('#ccAdd') && !document.querySelector('.cc-find')), 'player: the full bank, grouped by skill, read-only');
  { const e = q.errs.filter(x => !/reading 'set'/.test(x)); ok(!e.length, 'player: no page errors ' + e.join(' | ')); }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
