// Staff email + password (18 November 2026): a coach sets a password after a Google/link sign-in, then signs in with it
// usage: STUB3=1 node flow18.js
const { chromium } = require('playwright'); const { open } = require('./real.js');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const role = p => p.evaluate(() => window.__int && window.__int.Cloud.role);
(async () => { const b = await chromium.launch();
  // 1. a coach signed in with Google, no password yet: offered one
  const ctx = await b.newContext({viewport:{width:420, height:900}});
  const p = await open(b, 'coach', {ctx});
  await p.addInitScript(() => { const u = window.__fakeUser; if (u){ u.emailVerified = true; u.providerData = [{providerId:'google.com'}].concat(JSON.parse(localStorage.getItem('fakePwAccounts') || '{}')[u.email] ? [{providerId:'password'}] : []); } });
  await p.goto('http://app.test/app/'); await p.waitForTimeout(4500);
  ok(await role(p) === 'coach', 'Google sign-in: coach');
  ok(await p.$('.pwset'), 'coach with no password: "Set a password" is offered');
  await p.fill('#pwsP', 'coachpw1'); await p.fill('#pwsC', 'coachpw2'); await p.click('#pwsGo'); await p.waitForTimeout(300);
  ok(/aren’t the same/.test(await p.$eval('#pwsM', e => e.textContent)), 'two different passwords: refused');
  await p.fill('#pwsC', 'coachpw1'); await p.click('#pwsGo'); await p.waitForTimeout(500);
  const acc = await p.evaluate(() => JSON.parse(localStorage.getItem('fakePwAccounts') || '{}')['coach0@example.com']);
  ok(!(await p.$('.pwset')) && acc && acc.pw === 'coachpw1' && acc.verified, 'password added to the Google account ' + JSON.stringify(acc));
  ok(await p.evaluate(() => window.__linked) === 'coach0@example.com', '…by linking it (not replacing a password)');
  ok(await p.$eval('#pwTop', e => !e.hidden), 'Password button by Sign out');
  await p.click('#pwTop'); await p.waitForTimeout(200); ok(/Change your password/.test(await p.$eval('#pwsH', e => e.textContent)), '…opens "Change your password"');
  await p.click('#pwsN'); await p.waitForTimeout(200);
  await p.reload(); await p.waitForTimeout(3500); ok(!(await p.$('.pwset')), 'has a password: not asked again');

  // 2. signed out: Coach › email + password
  await p.evaluate(() => window.ERGS_AUTH.signOut()); await p.waitForTimeout(1500);
  await p.goto('http://app.test/app/'); await p.waitForTimeout(2500);
  if (await p.$('[data-join="coach"]')) { await p.click('[data-join="coach"]'); await p.waitForTimeout(300); }
  ok(await p.$('#jnSpF'), 'coach sign-in shows email + password');
  ok(await p.$('#jnG'), '…and still Continue with Google');
  ok(!(await p.$('#jnPwC')), '…with no "choose a password" box (staff set it inside the app)');
  await p.fill('#jnSpE', 'coach0@example.com'); await p.fill('#jnSpP', 'wrongpw'); await p.click('#jnSpGo'); await p.waitForTimeout(600);
  ok(/don’t match/.test(await p.$eval('#jnSpM', e => e.textContent)), 'wrong password: says so');
  await p.click('#jnSpF2'); await p.waitForTimeout(300); ok(await p.evaluate(() => window.__resetSent) === 'coach0@example.com', 'Forgot password sends the reset email');
  await p.fill('#jnSpE', 'coach0@example.com'); await p.fill('#jnSpP', 'coachpw1'); await p.click('#jnSpGo'); await p.waitForTimeout(4500);
  ok(await role(p) === 'coach', 'email + password: in as a coach (' + await role(p) + ')');
  ok(!(await p.$('.pwset')), '…and not asked to set a password');

  // 3. an address with no password: told to sign in with Google or a link first; nothing is created
  await p.evaluate(() => window.ERGS_AUTH.signOut()); await p.waitForTimeout(1500);
  await p.goto('http://app.test/app/'); await p.waitForTimeout(2500);
  if (await p.$('[data-join="coach"]')) { await p.click('[data-join="coach"]'); await p.waitForTimeout(300); }
  await p.fill('#jnSpE', 'coach4@example.com'); await p.fill('#jnSpP', 'whatever1'); await p.click('#jnSpGo'); await p.waitForTimeout(600);
  ok(/Sign in once with Google or a sign-in link/.test(await p.$eval('#jnSpM', e => e.textContent)), 'no password yet: explains how to get one');
  ok(!(await p.evaluate(() => JSON.parse(localStorage.getItem('fakePwAccounts') || '{}')['coach4@example.com'])), '…and no account is made');
  { const e = p.errs.filter(x => !/reading 'set'/.test(x)); ok(!e.length, 'no page errors (3D stub aside) ' + e.join(' | ')); }

  // 4. "Not now" is remembered on this device
  { const p2 = await open(b, 'squadcoach', {ctx:await b.newContext({viewport:{width:420, height:900}})});
    await p2.addInitScript(() => { const u = window.__fakeUser; if (u){ u.emailVerified = true; u.providerData = [{providerId:'google.com'}].concat(JSON.parse(localStorage.getItem('fakePwAccounts') || '{}')[u.email] ? [{providerId:'password'}] : []); } });
    await p2.goto('http://app.test/app/'); await p2.waitForTimeout(4500);
    ok(await p2.$('.pwset'), 'another coach: offered'); await p2.click('#pwsN'); await p2.waitForTimeout(200);
    await p2.reload(); await p2.waitForTimeout(3500); ok(!(await p2.$('.pwset')), '"Not now": not asked again on this device'); }

  // 5. a player is not offered one unless they came in by a link (unchanged)
  { const p3 = await open(b, 'player', {ctx:await b.newContext({viewport:{width:420, height:900}})});
    await p3.goto('http://app.test/app/'); await p3.waitForTimeout(4000); ok(!(await p3.$('.pwset')), 'player with Google: not offered (unchanged)'); }
  // 6. ERGS Live's Sign in button: always "Who are you?", whatever was picked before
  for (const was of ['supporter', 'coach']){ const p4 = await open(b, 'out', {ctx:await b.newContext({viewport:{width:420, height:900}})});
    await p4.addInitScript(w => { sessionStorage.setItem('fakeSignedOut', '1'); if (!localStorage.getItem('ergs.joinAs')) localStorage.setItem('ergs.joinAs', w); }, was);
    await p4.goto('http://app.test/?live'); await p4.waitForTimeout(3500);
    await p4.evaluate(() => document.querySelector('.signin-btn').click()); await p4.waitForTimeout(3500);
    ok(/\/app\/$/.test(new URL(p4.url()).pathname) && await p4.$('[data-join="coach"]') && await p4.$('.jn-tile.sup') && !(await p4.$('#jnSpF')), 'picked ' + was + ' before, Sign in on ERGS Live: "Who are you?" (' + p4.url() + ')');
    ok(await p4.evaluate(() => localStorage.getItem('ergs.joinAs')) === was, '…and the earlier choice is kept');
    ok(!(await p4.$('.dlg #lkGoogle, #lkGoogle')), '…no separate sign-in box'); }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
