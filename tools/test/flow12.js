// Play IQ: the rugby laws as a game of their own, and inside Mixed and Sudden death.
const { chromium, devices } = require('playwright'); const { open } = require('./real.js');
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => { const b = await chromium.launch(); const ctx = await b.newContext(Object.assign({}, devices['iPhone 14'], {viewport:{width:390, height:900}}));
  const P = await open(b, 'player', {ctx}); await P.goto('http://app.test/app/'); await P.settle(3000);
  let r = await P.evaluate(() => { const ev = window.__ev, laws = ev('piqLaws')(), C = {plays:[], terms:ev('piqTerms')(), laws, usedP:new Set(), usedT:new Set(), usedL:new Set()}, bad = [], seen = {}, fams = new Set();
    for (let i = 0; i < 400; i++){ const k = ev('PIQ_LAW_KINDS')[i % 4], R = ev('piqRound')(k, C); seen[R.kind] = (seen[R.kind] || 0) + 1;
      if (!R.opts || R.opts.length < 2 || new Set(R.opts).size !== R.opts.length || R.ans < 0 || R.opts[R.ans] !== R.answer || !R.learn || !R.after) bad.push(R.kind + ': ' + JSON.stringify(R.opts) + ' ans ' + R.ans);
      if ((R.kind === 'lawWatch' || R.kind === 'lawRef' || R.kind === 'lawName') && !(R.anim && R.anim.frames.length > 1 && R.anim.frames.every(f => !f.caption && !(f.draw || []).some(d => d.t === 'text')))) bad.push(R.kind + ' clip');
      if (R.kind === 'lawRef'){ const f = ev('piqRefFam'); if (R.opts.filter((o, j) => j !== R.ans && f(o) === f(R.answer)).length) bad.push('lawRef two ways of saying the same decision: ' + JSON.stringify(R.opts)); fams.add(R.answer); }
      if (R.kind === 'lawRule' && new RegExp(R.answer.split(/[:(]/)[0].trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(R.card)) bad.push('lawRule gives it away: ' + R.answer); }
    return {n:laws.length, seen, bad:bad.slice(0, 5), decisions:fams.size, mixed:ev('piqKinds')('mixed', 10).reduce((a, k) => { const g = k === 'play' ? 'play' : /^law/.test(k) ? 'law' : 'term'; a[g] = (a[g] || 0) + 1; return a; }, {}), mixedNoPlays:ev('piqKinds')('mixed', 0).filter(k => /^law/.test(k)).length, lawsMode:ev('piqKinds')('laws', 10).every(k => /^law/.test(k))}; });
  ok(r.n >= 20 && !r.bad.length && Object.keys(r.seen).length === 4, `${r.n} laws make four kinds of question; 400 made, every one with one right answer and no giveaway: ${JSON.stringify(r.seen)} ${r.bad.join(' ; ')}`);
  ok(r.mixed.play === 4 && r.mixed.law === 4 && r.mixed.term === 4 && r.mixedNoPlays === 6 && r.lawsMode, 'Mixed is a third plays, a third laws, a third terms (half laws with no playbook); the laws game is all laws: ' + JSON.stringify(r.mixed));
  await P.nav('library'); await P.waitForTimeout(1200); await P.evaluate(() => window.__ev('playIQ')()); await P.waitForTimeout(2000);
  r = await P.evaluate(() => [...document.querySelectorAll('#tagModal .piq-modes button, #tagModal [data-piqm]')].map(x => x.innerText.replace(/\s+/g, ' ').trim()));
  ok(r.some(t => /RUGBY LAWS/i.test(t)), 'the lobby has a Rugby laws game: ' + r.join(' | ').slice(0, 200));
  await P.screenshot({path:process.argv[2] + '/ui/piq-lobby.png', scale:'css'});
  await P.evaluate(() => { const b = [...document.querySelectorAll('#tagModal button')].find(x => /Rugby laws/i.test(x.innerText)); b.click(); }); await P.waitForTimeout(600);
  await P.evaluate(() => { const b = [...document.querySelectorAll('#tagModal button')].find(x => /^(play|start)/i.test(x.innerText.trim())); if (b) b.click(); }); await P.waitForTimeout(2500);
  r = await P.evaluate(() => { const m = document.querySelector('#tagModal'); return {tag:(m.querySelector('#piqTag') || {}).innerText, q:(m.querySelector('#piqQ') || {}).innerText, opts:[...m.querySelectorAll('#piqOpts button')].map(x => x.innerText)}; });
  ok(/RUGBY LAWS/i.test(r.tag || '') && r.opts.length >= 2, 'and a round of it plays: ' + JSON.stringify(r).slice(0, 220));
  await P.waitForTimeout(1500); await P.screenshot({path:process.argv[2] + '/ui/piq-law-round.png', scale:'css'});
  await P.evaluate(() => document.querySelector('#piqOpts button').click()); await P.waitForTimeout(1200); await P.screenshot({path:process.argv[2] + '/ui/piq-law-after.png', scale:'css'});
  console.log('     errors', P.errs.filter(e => !/reading 'set'/.test(e)).slice(0, 4)); await b.close(); })();
