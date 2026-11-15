// ERGS Live (the scoreboard) with the real fb.js on the fake database: press through the tabs, menus and a match; report errors.
// usage: node walklive.js <role> [phone]
const { chromium, devices } = require('playwright'); const { open, fmt } = require('./real.js');
const role = process.argv[2] || 'out', phone = process.argv[3] === 'phone';
(async () => { const b = await chromium.launch();
  const ctx = await b.newContext(phone ? Object.assign({}, devices['Pixel 7']) : {viewport:{width:1366, height:900}}); const p = await open(b, role, {ctx}); p.on('dialog', d => d.dismiss().catch(() => {}));
  let seenE = 0, seenC = 0, cur = 'opening', n = 0; const found = new Map();
  const check = async () => { const E = p.errs.slice(seenE), C = p.cons.slice(seenC); seenE = p.errs.length; seenC = p.cons.length; const den = await p.evaluate(() => (window.__denied || []).splice(0)).catch(() => []);
    const add = (k, m) => { const key = k + '|' + String(m).slice(0, 120); if (!found.has(key)){ found.set(key, 1); console.log(`  [${k}] at ${cur}: ${String(m).slice(0, 300)}`); } };
    E.forEach(e => add('script error', e)); C.filter(c => !/Failed to load resource|net::ERR|favicon/.test(c)).forEach(c => add('console error', c)); [...new Set(den)].forEach(d => add('refused by the rules', d)); };
  await p.addInitScript(() => { try { sessionStorage.setItem('ergs.liveOK', '1'); } catch(e){} });   // stay on ERGS Live (coaches are otherwise sent on to the team app)
  await p.goto('http://app.test/?live'); await p.waitForTimeout(7000); await check();
  console.log(`== ERGS Live as ${role}${phone ? ' (phone)' : ''}: ${await p.evaluate(() => document.title)} | ${await p.evaluate(() => (document.querySelector('#view') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 140))}`);
  const closeAll = async () => { for (let i = 0; i < 4; i++){ const o = await p.evaluate(() => { const m = [...document.querySelectorAll('#modal, .modal, dialog[open], .drawer, #drawer')].filter(x => !x.hidden && x.offsetParent !== null); if (!m.length) return 0; const x = m[m.length - 1].querySelector('[data-close], .x, [aria-label="Close"], .modal-x, .dr-x'); if (x) x.click(); else document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); return 1; }); if (!o) break; await p.waitForTimeout(150); } };
  const sel = 'button:not([disabled]), [role="tab"], summary, select, a[href^="#"], [data-open], [data-v]';
  for (let round = 0; round < 3; round++){
    const total = Math.min(await p.$$eval(sel, e => e.filter(x => x.offsetParent !== null).length), 70);
    for (let i = 0; i < total; i++){
      const label = await p.evaluate(([sel, i]) => { const L = [...document.querySelectorAll(sel)].filter(x => x.offsetParent !== null), el = L[i]; if (!el) return null; const t = (el.getAttribute('aria-label') || el.textContent || el.id || '').trim().replace(/\s+/g, ' ').slice(0, 40);
        if (/sign out|log out|delete|remove|clear|reset|sign in|refresh|install|team app|open the app/i.test(t)) return 'skip:' + t; if (el.tagName === 'SELECT'){ if (el.options.length > 1){ el.selectedIndex = (el.selectedIndex + 1) % el.options.length; el.dispatchEvent(new Event('change', {bubbles:true})); } return 'select:' + t; } el.click(); return t || el.tagName; }, [sel, i]).catch(e => 'ERR ' + e.message.slice(0, 60));
      if (label === null) break; n++; cur = label; await p.waitForTimeout(220); if (!/app\.test\/(\?live)?(#.*)?$/.test(p.url())){ await p.goto('http://app.test/?live'); await p.waitForTimeout(2500); } await check(); await closeAll(); }
    // open the first match card, then go round again inside it
    if (round === 0){ await p.evaluate(() => { const c = document.querySelector('[data-open], .card[data-id], .match, .m-card'); if (c) c.click(); }); await p.waitForTimeout(800); cur = 'a match'; await check(); } else if (round === 1){ await p.goto('http://app.test/?live'); await p.waitForTimeout(2500); } }
  console.log(`pressed ${n}; ${found.size ? found.size + ' thing(s) found' : 'nothing found'}`); await b.close(); })();
