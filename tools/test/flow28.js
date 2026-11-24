// Play library and drills: a squad's own list plus the full library to add from; starting lists; cleaner cards (24 November 2026)
// usage: STUB3=1 node flow28.js
const { chromium } = require('playwright'); const { open } = require('./real.js');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const start = async (b, role, books) => { const p = await open(b, role, {ctx:await b.newContext({viewport:{width:1200, height:900}})});
  await p.addInitScript(bk => { localStorage.setItem('ergs.pwNo', '1'); if (bk && window.__fsSeed) window.__fsSeed['team/books'] = {j:JSON.stringify({byTeam:bk})}; }, books || null);
  await p.goto('http://app.test/app/'); await p.waitForTimeout(4500); return p; };
const lib = async (p, sc) => { await p.evaluate(sc => window.__int.go(sc), sc); await p.waitForTimeout(2200); };
const vis = (p, sc) => p.evaluate(sc => [...document.querySelectorAll('#' + sc + ' .card')].filter(c => c.offsetParent).map(c => c.dataset.tk || c.querySelector('h3').textContent), sc);
const T = (p, code) => p.evaluate(c => window.__ev(c), code);
(async () => { const b = await chromium.launch();
  const p = await start(b, 'admin'); await lib(p, 'library');
  // starting lists
  const def = await p.evaluate(() => { const E = window.__ev; const shared = E("sharedPlays().filter(p => !p._hidden)"); return {senior:E("bookOf('SENIOR').plays.length"), seniorWant:shared.filter(q => E("callsOf")(q.id, q).includes('Senior calls')).length, meds:E("bookOf('MEDS').plays.length"), medsWant:shared.filter(q => E("callsOf")(q.id, q).includes('Medallion calls')).length, u14:E("bookOf('U14').plays.length"), presetIn:E("bookOf('SENIOR').plays.some(k => /^(preset|pro):/.test(k))"), dr:E("['U12','U14','MEDS','SENIOR','SG'].map(t => bookOf(t).drills.join('+')).join(' ')"), lane:E("bkLane()")}; });
  ok(def.senior === def.seniorWant && def.senior > 0 && !def.presetIn, 'Senior Rugby starts with the Senior calls from our playbook (' + def.senior + '), and no example or professional plays');
  ok(def.meds === def.medsWant, 'the Medallions start with the Medallion calls (' + def.meds + ')');
  ok(def.u14 === 0, 'every other squad starts with no plays (U14: ' + def.u14 + ')');
  ok(def.dr.split(' ').every(x => x === def.lane), 'every squad’s drills start with Lane passing only (' + def.dr + ')');
  // the two tabs
  ok(await p.evaluate(() => { const t = [...document.querySelectorAll('#bookBar .bk2-tabs button b')].map(x => x.textContent); return t.length === 2 && /playbook$/.test(t[0]) && t[1] === 'Play library'; }), 'two tabs: the squad’s playbook and the Play library');
  await p.selectOption('#bkTeam', 'U14'); await p.waitForTimeout(1200);
  ok((await vis(p, 'library')).length === 0 && /Under 14 playbook is empty/.test(await p.$eval('#bkEmpty', e => e.textContent)), 'Under 14: empty, with a way into the library');
  await p.click('#bkAll'); await p.waitForTimeout(1200);
  const all = await vis(p, 'library'); ok(all.length >= 40, 'Play library: every play (' + all.length + ')');
  const cardInfo = await p.evaluate(() => { const c = [...document.querySelectorAll('#library .card[data-tk]')].find(c => c.offsetParent); const btns = [...c.querySelectorAll('.card-a > *')].filter(x => x.offsetParent).map(x => x.textContent.trim()); return {btns, meta:!!(c.querySelector('.meta') && c.querySelector('.meta').offsetParent), tags:[...c.querySelectorAll('.tag-row .tag')].filter(x => x.offsetParent).length, tk:c.dataset.tk}; });
  ok(cardInfo.btns[0] === 'Preview' && /^\+ Add to Under 14/.test(cardInfo.btns[1]) && cardInfo.btns.length <= 3, 'a library card: ' + cardInfo.btns.join(' | '));
  ok(!cardInfo.meta && cardInfo.tags === 0, 'no frame counts and no tags on the card (' + cardInfo.tags + ' tags)');
  ok(await p.evaluate(() => { const g = id => { const e = document.querySelector(id); return !!e && e.offsetParent !== null; }; return !g('#callTabs') && !g('#lbChips') && g('#clnF'); }), 'call systems and tags are behind one Filters & tools button');
  await p.click('#clnF'); await p.waitForTimeout(200); ok(await p.evaluate(() => document.querySelector('#callTabs').offsetParent !== null && document.querySelector('#lbChips').offsetParent !== null), '…which opens them');
  await p.click('#clnF');
  // add a play to the U14 playbook
  await p.evaluate(tk => { [...document.querySelectorAll('#library .card[data-tk]')].find(c => c.dataset.tk === tk).querySelector('.bk-btn').click(); }, cardInfo.tk); await p.waitForTimeout(1500);
  const bk = await T(p, "(Cloud.docs['team/books'] || {}).byTeam.U14");
  ok(bk && bk.plays.length === 1 && bk.plays[0] === cardInfo.tk && bk.pset === true && !bk.dset, 'added: Under 14 now has that one play ' + JSON.stringify(bk));
  await p.evaluate(() => document.querySelector('#bookBar [data-bkm="mine"]').click()); await p.waitForTimeout(1200);
  const mine = await vis(p, 'library'); ok(mine.length === 1 && mine[0] === cardInfo.tk, 'the Under 14 playbook tab shows just that play');
  ok(await p.evaluate(() => [...document.querySelectorAll('#library .lib-sec')].filter(e => e.offsetParent).length === 1), '…under one heading (empty sections are not shown)');
  // take a play out of the Seniors' starting list: the rest stay
  await p.selectOption('#bkTeam', 'SENIOR'); await p.waitForTimeout(1200);
  await p.evaluate(() => { [...document.querySelectorAll('#library .card[data-tk]')].find(c => c.offsetParent).querySelector('.bk-btn').click(); }); await p.waitForTimeout(1500);
  const sn = await T(p, "(Cloud.docs['team/books'] || {}).byTeam.SENIOR");
  ok(sn && sn.pset && sn.plays.length === def.senior - 1, 'removing one Senior call keeps the other ' + (def.senior - 1));
  // drills
  await lib(p, 'drills'); await p.selectOption('#bkDTeam', 'U14'); await p.waitForTimeout(1500);
  let dv = await vis(p, 'drills'); ok(dv.length === 1 && /lane passing/i.test(dv[0]), 'Under 14 drills: Lane passing only (' + dv.join(', ') + ')');
  await p.evaluate(() => document.querySelector('#drBookBar [data-bkd="all"]').click()); await p.waitForTimeout(2000);
  ok(await p.evaluate(() => /830|8\d\d/.test(document.querySelector('#drState').textContent)), 'Drill library: every drill (' + (await p.$eval('#drState', e => e.textContent)).trim() + ')');
  const dName = await p.evaluate(() => { const c = [...document.querySelectorAll('#drList .dr-card')].find(c => c.offsetParent && !/lane passing/i.test(c.querySelector('h3').textContent) && c.querySelector('.bk-btn')); c.querySelector('.bk-btn').click(); return c.querySelector('h3').textContent; }); await p.waitForTimeout(1500);
  const bd = await T(p, "(Cloud.docs['team/books'] || {}).byTeam.U14");
  ok(bd.dset === true && bd.drills.length === 2 && bd.plays.length === 1, 'added “' + dName + '”: Under 14 drills are Lane passing and that one ' + JSON.stringify(bd.drills));
  await p.evaluate(() => document.querySelector('#drBookBar [data-bkd="mine"]').click()); await p.waitForTimeout(1500);
  dv = await vis(p, 'drills'); ok(dv.length === 2, 'the Under 14 drills tab shows both');
  ok(await p.evaluate(() => { const c = document.querySelector('#drList .dr-card'); const m = [...c.querySelectorAll('.meta span')].filter(x => x.offsetParent).length, lv = [...c.querySelectorAll('.tag.call')].filter(x => x.offsetParent).length; return m <= 2 && lv === 0 && ![...c.querySelectorAll('.tag')].some(x => x.offsetParent); }), 'drill cards: who it is for and how long; no tags');
  { const e = p.errs.filter(x => !/reading 'set'/.test(x)), den = await p.evaluate(() => window.__denied || []); ok(!e.length && !den.length, 'coach: no page errors, nothing refused ' + e.concat(den).join(' | ')); }
  // players
  const team = await (async () => { const q = await start(b, 'player'); const t = await q.evaluate(() => window.ERGS_AUTH.player && window.ERGS_AUTH.player.team); await q.close(); return t; })();
  { const q = await start(b, 'player'); await lib(q, 'library');
    const want = team === 'SENIOR' ? def.senior : team === 'MEDS' ? def.meds : 0, got = (await vis(q, 'library')).length;
    ok(got === want, 'a ' + team + ' player with nothing added yet sees ' + got + ' plays (' + (want ? 'the starting list' : 'none: no automatic plays') + ')');
    await lib(q, 'drills'); const d = await vis(q, 'drills'); ok(d.length === 1 && /lane passing/i.test(d[0]), '…and Lane passing as their only drill (' + d.join(', ') + ')');
    ok(!(await q.$('#bookBar .bk2-tabs')) && !(await q.$('#drBookBar')), '…with no library tab'); await q.close(); }
  { const tk = (await T(p, "sharedPlays().filter(p => !p._hidden)[0].id")), q = await start(b, 'player', {[team]:{plays:[tk], pset:true, drills:['pre-lane-passing', 'pre-box-passing'], dset:true}}); await lib(q, 'library');
    const pv = await vis(q, 'library'); ok(pv.length === 1 && pv[0] === tk, 'once the coach has chosen, the player sees exactly the squad’s playbook (' + pv.length + ')');
    ok(/playbook/.test(await q.$eval('#bookBar', e => e.textContent)), '…headed with the squad’s name');
    { const e = q.errs.filter(x => !/reading 'set'/.test(x)); ok(!e.length, 'player: no page errors ' + e.join(' | ')); } }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
