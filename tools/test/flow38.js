// One install: ERGS Live and the team app share one home-screen app, which always opens on the team app (28 November 2026)
// usage: STUB3=1 node flow38.js
const fs = require('fs'); const { chromium } = require('playwright'); const { open } = require('./real.js');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
(async () => { const root = __dirname + '/../../', man = JSON.parse(fs.readFileSync(root + 'manifest.webmanifest', 'utf8'));
  ok(!fs.existsSync(root + 'app/manifest.webmanifest') && man.name === 'ERGS Rugby' && man.scope === './', 'there is one install file, at the top of the site, called “' + man.name + '”');
  ok(man.start_url === './app/' && new URL(man.id, new URL(man.start_url, 'https://x.test/ergs-live/')).pathname === '/ergs-live/', 'it starts on the team app, and keeps the identity of the ERGS Live install people already have');
  ok((man.shortcuts || []).map(s => s.url).join() === './?side=live,./app/', 'holding the icon offers ' + (man.shortcuts || []).map(s => s.short_name).join(' and '));
  const b = await chromium.launch();
  const page = async (installed) => { const p = await open(b, 'public', {ctx:await b.newContext({viewport:{width:400, height:800}})}); if (installed) await p.addInitScript(() => { try { Object.defineProperty(navigator, 'standalone', {get:() => true}); } catch(e){} }); return p; };
  const fresh = p => p.evaluate(() => sessionStorage.removeItem('ergs.sideSeen'));   // the installed app has been closed and opened again
  { const p = await page(true); await p.goto('http://app.test/'); await p.waitForTimeout(3000);
    ok(new URL(p.url()).pathname === '/app/', 'an icon installed earlier from ERGS Live also opens the team app, first time');
    ok(await p.evaluate(() => document.querySelector('link[rel="manifest"]').href) === 'http://app.test/manifest.webmanifest', 'the team app uses the same install file, so it is the same app');
    await p.goto('http://app.test/?live'); await p.waitForTimeout(2000); ok(new URL(p.url()).pathname === '/', 'going to ERGS Live from the team app stays on ERGS Live');
    await p.goto('http://app.test/'); await p.waitForTimeout(2000); ok(new URL(p.url()).pathname === '/', '…including its plain address, while the app stays open');
    await fresh(p); await p.goto('http://app.test/'); await p.waitForTimeout(3000); ok(new URL(p.url()).pathname === '/app/', 'next time the icon is tapped it is the team app again, even though ERGS Live was used last');
    await fresh(p); await p.goto('http://app.test/?m=abc123'); await p.waitForTimeout(2000); ok(new URL(p.url()).pathname === '/' && /m=abc123/.test(p.url()), 'a shared match link always opens that match');
    await fresh(p); await p.goto('http://app.test/?side=live'); await p.waitForTimeout(2000); ok(new URL(p.url()).pathname === '/' && !/side=/.test(p.url()), 'the “ERGS Live” shortcut opens ERGS Live');
    await p.close(); }
  { const p = await page(false); await p.goto('http://app.test/app/'); await p.waitForTimeout(2500); await fresh(p); await p.goto('http://app.test/'); await p.waitForTimeout(2500);
    ok(new URL(p.url()).pathname === '/', 'in an ordinary browser tab nothing is redirected: the ERGS Live address shows ERGS Live'); await p.close(); }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
