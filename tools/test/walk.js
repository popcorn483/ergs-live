// Walks every screen as one kind of user, with the real data layer on the fake database, pressing what can be pressed.
// Reports script errors, console errors, and anything the database rules would have refused.
// usage: node walk.js <role> [phone]
const { chromium, devices } = require('playwright'); const { open, fmt } = require('./real.js'); const fs = require('fs'); const SP = __dirname;
const role = process.argv[2] || 'admin', phone = process.argv[3] === 'phone', deep = process.env.DEEP !== '0';
const SCREENS = process.env.ONLY ? process.env.ONLY.split(',') : ['menu', 'news', 'photos', 'library', 'terms', 'laws', 'drills', 'anl', 'live', 'squads', 'people', 'graphics', 'totw', 'xv', 'fxg', 'rsg', 'mdg', 'noms', 'editor'];
(async () => { const b = await chromium.launch();
  const ctx = await b.newContext(phone ? Object.assign({}, devices['Pixel 7']) : {viewport:{width:1366, height:900}}); const p = await open(b, role, {ctx});
  p.on('dialog', d => d.dismiss().catch(() => {}));
  const found = []; let seenE = 0, seenC = 0; const where = {cur:'start'};
  const check = async () => { const E = p.errs.slice(seenE), C = p.cons.slice(seenC); seenE = p.errs.length; seenC = p.cons.length; const den = await p.evaluate(() => (window.__denied || []).splice(0)).catch(() => []);
    const add = (k, m) => { found.push([k, where.cur, m]); console.log(`  [${k}] at ${where.cur}: ${String(m).slice(0, 300)}`); };
    E.filter(e => !/reading 'set'/.test(e)).forEach(e => add('script error', e)); C.filter(c => !/Failed to load resource|net::ERR|favicon/.test(c)).forEach(c => add('console error', c)); [...new Set(den)].forEach(d => add('refused by the rules', d)); };
  await p.goto('http://app.test/app/'); await p.waitForTimeout(9000); where.cur = 'opening'; await check();
  const home = await p.shown(); console.log(`== ${role}${phone ? ' (phone)' : ''}: starts on "${home}"; home lists: ${(await p.$$eval('#menuList .menu-item .t', e => e.filter(x => x.offsetParent !== null).map(x => x.textContent.trim()))).join(' | ')}`);
  const closeAll = async () => { for (let i = 0; i < 4; i++){ const open = await p.evaluate(() => { const m = [...document.querySelectorAll('.modal, #tagModal, #askModal, #matchModal, dialog[open], #phView')].filter(x => !x.hidden && x.offsetParent !== null); if (!m.length) return 0;
      const x = m[m.length - 1].querySelector('[data-close], .x, .modal-x, [aria-label="Close"], #tagClose, .dlg-x, .ph-x, #phClose'); if (x) x.click(); else document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); return m.length; }); if (!open) break; await p.waitForTimeout(150); } };
  const visited = [], presses = {};
  for (const sc of SCREENS){ where.cur = sc; await p.nav(sc); await p.waitForTimeout(1800); const vis = await p.shown(); await check(); if (vis !== sc){ visited.push(sc + '→' + vis); continue; } visited.push(sc);
    if (process.env.SHOTS) await p.screenshot({path:`${SP}/walk/${role}${phone ? '-ph' : ''}-${sc}.png`});
    if (!deep) continue;
    // press everything pressable on this screen (tabs, chips, buttons), a bounded number, closing whatever opens
    const sel = `#${sc} button:not([disabled]), #${sc} [role="tab"], #${sc} summary, #${sc} select`;
    const pressed = []; presses[sc] = pressed;
    const n = Math.min(await p.$$eval(sel, e => e.filter(x => x.offsetParent !== null).length), +process.env.MAXCLICK || 45);
    for (let i = 0; i < n; i++){
      const label = await p.evaluate(([sel, i]) => { const L = [...document.querySelectorAll(sel)].filter(x => x.offsetParent !== null), el = L[i]; if (!el) return null; const t = (el.getAttribute('aria-label') || el.textContent || el.id || '').trim().replace(/\s+/g, ' ').slice(0, 40);
        if (/sign out|log out|delete everything|reset|remove all|clear all/i.test(t) || el.dataset.go === 'back' || el.dataset.go === 'menu') return 'skip:' + t; if (el.tagName === 'SELECT'){ if (el.options.length > 1){ el.selectedIndex = (el.selectedIndex + 1) % el.options.length; el.dispatchEvent(new Event('change', {bubbles:true})); } return 'select:' + t; } el.click(); return t || el.tagName; }, [sel, i]).catch(e => 'ERR ' + e.message.slice(0, 80));
      if (label === null) break; pressed.push(label); if (process.env.TRACE) console.log('   press', sc, '›', label, '→', await p.shown()); where.cur = sc + ' › ' + label; await p.waitForTimeout(260); await check(); await closeAll(); if ((await p.shown()) !== sc){ await p.nav(sc); await p.waitForTimeout(500); } }
    where.cur = sc + ' (after pressing)'; await check(); console.log(`  . ${sc}: ${pressed.length} pressed`); }
  where.cur = 'end'; await p.nav('menu'); await p.waitForTimeout(800); await check();
  console.log('screens:', visited.map(v => v + (presses[v] ? ' (' + presses[v].length + ' pressed)' : '')).join(', '));
  const uniq = new Map(); found.forEach(([k, w, m]) => { const key = k + '|' + m.slice(0, 140); if (!uniq.has(key)) uniq.set(key, [k, w, m, 1]); else uniq.get(key)[3]++; });
  console.log(uniq.size ? `${uniq.size} thing(s) found:` : 'nothing found'); [...uniq.values()].forEach(([k, w, m, n]) => console.log(`  [${k}] at ${w}${n > 1 ? ' (x' + n + ')' : ''}: ${m.slice(0, 300)}`));
  await b.close(); })();
