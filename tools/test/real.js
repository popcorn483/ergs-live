// Runs the real app with the real fb-main.js against the fake Firestore, and reports what each step costs.
// usage: node real.js <role> [screens,comma] [idleSeconds]     role: admin | coach | player | public | out
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'); const ROOT = process.env.ROOTDIR || path.resolve(__dirname, '../..'), APP = ROOT + '/app', SP = __dirname;   // ROOT: the repository
const USERS = {admin:{email:'ergsrugby@gmail.com', uid:'uid150', displayName:'ERGS'}, coach:{email:'coach0@example.com', uid:'uidc0', displayName:'Coach Armstrong'}, player:{email:'adam.armstrong0@example.com', uid:'uid0', displayName:'Adam Armstrong'}, public:{email:'nobody@example.com', uid:'uidx', displayName:'No Body'}, out:null,
  guardian:{email:'parent0@example.com', uid:'uidg', displayName:'Mrs Armstrong'}, squadcoach:{email:'coach4@example.com', uid:'uidc4', displayName:'Coach Elliott'}};
const TYPES = {'.js':'text/javascript', '.html':'text/html', '.json':'application/json', '.css':'text/css', '.webmanifest':'application/json', '.png':'image/png', '.svg':'image/svg+xml'};
async function open(b, role, opts){ opts = opts || {}; const root = opts.root || ROOT;
  const ctx = opts.ctx || await b.newContext({viewport:opts.viewport || {width:1300, height:1000}}); const p = await ctx.newPage(); const errs = [], cons = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') cons.push(m.text().slice(0, 200)); else if (/drills tidy/.test(m.text())) console.log('     [app] ' + m.text().slice(0, 300)); });
  await p.addInitScript(u => { if (!sessionStorage.getItem('fakeSignedOut')) window.__fakeUser = u; }, USERS[role]);
  if (process.env.RULES2) await p.addInitScript(() => { window.__rules2 = true; });
  await p.addInitScript({path:SP + '/fake/seed.js'});
  await p.route('**/*', r => { const u = new URL(r.request().url());
    if (u.hostname === 'www.gstatic.com' && /firebasejs/.test(u.pathname)){ const f = SP + '/fake/' + path.basename(u.pathname); return r.fulfill({body:fs.readFileSync(f), contentType:'text/javascript'}); }
    if (u.hostname === 'app.test' && /vendor\/three/.test(u.pathname) && process.env.NO3) return r.abort();   // the 3D library can't be fetched
    if (u.hostname === 'app.test' && /vendor\/three/.test(u.pathname) && process.env.STUB3) return r.fulfill({body:fs.readFileSync(SP + '/three-stub.js'), contentType:'text/javascript'});   // no 3D drawing (it is very slow without a graphics card)
    if (u.hostname === 'app.test'){ let f = u.pathname; if (f.endsWith('/')) f += 'index.html'; const fp = path.join(root, f); if (!(fs.existsSync(fp) && fs.statSync(fp).isFile())) return r.fulfill({status:404, body:''});
      let body = fs.readFileSync(fp); if (f === '/app/index.html'){ const M = '/* =============================== A CLEAN HOME SCREEN: running the club lives in Settings'; body = body.toString().replace(M, "window.__int = {Cloud, S, drillList, drillMeta, get TW(){ return TW; }, twCur, get BUILT(){ return typeof BUILT === 'object' ? BUILT : null; }, go}; window.__ev = c => eval(c);\n" + M); }
      if (f === '/app.js') body = body.toString().replace('/* =============================== WHO IS SCORING', 'window.__lv = c => eval(c);\n/* =============================== WHO IS SCORING');   // a way in for the checks (ERGS Live keeps everything private)
      return r.fulfill({body, contentType:TYPES[path.extname(fp)] || 'application/octet-stream'}); }
    if (/three/.test(u.pathname) && process.env.NO3) return r.abort();
    if (/three/.test(u.pathname)) return r.fulfill({body:fs.readFileSync((process.env.STUB3 ? SP + '/three-stub.js' : ROOT + '/app/vendor/three.min.js')), contentType:'text/javascript'});   // the real three.js (the stub raises a harmless error of its own)
    if (/mp4-muxer/.test(u.pathname)) return r.fulfill({body:fs.readFileSync(ROOT + '/app/vendor/mp4-muxer.js'), contentType:'text/javascript'});
    return r.fulfill({status:200, body:''}); });
  p.nav = s => p.evaluate(s => { const b = document.createElement('button'); b.dataset.go = s; document.body.appendChild(b); b.click(); b.remove(); }, s);
  p.shown = () => p.$$eval('section.screen', e => e.filter(x => !x.hidden).map(x => x.id).join(','));
  // what was read and written since the last call, grouped by collection
  p.cost = async () => { const r = await p.evaluate(() => { const M = window.__meter; if (!M) return null; const l = M.since(); return {l, denied:(window.__denied || []).splice(0)}; }); if (!r) return {reads:0, rules:0, writes:0, by:{}, denied:[], detail:[]};
    const by = {}, wr = {}; let reads = 0, rules = 0, writes = 0; r.l.forEach(([t, kind, what, n, ru]) => { if (kind === 'offline') return; const col = what.replace(/^(get|list|listen|update|count|tally|set|delete|tx get|tx set|tx delete) /, '').split(/[\/ ]/)[0]; rules += ru; if (kind === 'read'){ reads += n; by[col] = (by[col] || 0) + n; } else { writes += n; wr[col] = (wr[col] || 0) + n; } });
    return {reads, rules, writes, by, wr, denied:r.denied, detail:r.l}; };
  // wait until the app has started and the database has been quiet for a few seconds. Judged inside the page (so a busy page, which
  // also holds up the question, isn't mistaken for a quiet one) and on three looks in a row.
  p.settle = async (quiet, max) => { quiet = quiet || 3000; max = max || 60000; const t0 = Date.now(); let calm = 0, lastN = -1; await p.waitForTimeout(800);
    while (Date.now() - t0 < max){ const r = await p.evaluate(() => { const M = window.__meter, I = window.__int, l = M ? M.log : []; return {n:M ? l.length : -1, idle:l.length ? performance.now() - l[l.length - 1][0] : performance.now(), up:!!(I && I.Cloud.role !== 'pending') || !document.querySelector('script[src*="fb-main"]')}; }).catch(() => null);
      if (r && r.up && r.n >= 0 && r.n === lastN && r.idle >= quiet) calm++; else calm = 0; lastN = r ? r.n : -1; if (calm >= 3) break; await p.waitForTimeout(350); } };
  p.errs = errs; p.cons = cons; return p; }
const fmt = c => `${String(c.reads + c.rules).padStart(5)} reads (${c.reads} documents + ${c.rules} for the rules)` + (c.writes ? `, ${c.writes} writes` : '') + '   ' + Object.entries(c.by).sort((a, b) => b[1] - a[1]).map(([k, n]) => k + ' ' + n).join(', ') + (c.writes ? '   | wrote: ' + Object.entries(c.wr).map(([k, n]) => k + ' ' + n).join(', ') : '') + (c.denied.length ? '\n        REFUSED: ' + [...new Set(c.denied)].join('; ') : '');
module.exports = {open, fmt, USERS};
if (require.main === module) (async () => { const role = process.argv[2] || 'admin', screens = (process.argv[3] || '').split(',').filter(Boolean), idle = +(process.argv[4] || 0);
  const b = await chromium.launch(); const p = await open(b, role);
  await p.goto('http://app.test/app/'); await p.settle(4000); let tot = 0; const step = async tag => { const c = await p.cost(); tot += c.reads + c.rules; console.log(tag.padEnd(22), fmt(c)); if (process.env.DETAIL) c.detail.forEach(d => console.log('      ', d[1].padEnd(6), d[2], 'x' + d[3], d[4] ? '+' + d[4] : '')); };
  console.log('== ' + role + ' (' + await p.shown() + ')'); await step('open the app');
  if (process.env.RELOAD){ for (let k = 0; k < +process.env.RELOAD; k++){ await p.waitForTimeout(1500); await p.reload(); await p.settle(4000); await step('open again (' + (k + 2) + ')'); } }
  if (idle){ await p.waitForTimeout(idle*1000); await step(`idle ${idle}s`); }
  for (const sc of screens){ await p.nav(sc); await p.settle(2500, 30000); const vis = await p.shown(); await step(sc + (vis === sc ? '' : ' (shown ' + vis + ')')); await p.nav('menu'); await p.settle(2000, 20000); await step('  back to home'); }
  console.log('total'.padEnd(22), tot, '  page errors', p.errs.filter(e => !/reading 'set'/.test(e)).slice(0, 6), 'console errors', [...new Set(p.cons)].slice(0, 6)); await b.close(); })();
