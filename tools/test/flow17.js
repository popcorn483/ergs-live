// C2k password sign-in (18 November 2026), and the installed app opening on the role they picked
// usage: STUB3=1 node flow17.js
const { chromium } = require('playwright'); const { open } = require('./real.js');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
(async () => { const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:420, height:900}});
  // a pupil on a profile: players/pupil1@c2ken.net
  await ctx.addInitScript(() => { window.__fsSeed = window.__fsSeed || {}; });
  const p = await open(b, 'out', {ctx});
  await p.addInitScript(() => { const s = window.__fsSeed || {}; s['players/pupil1@c2ken.net'] = {name:'Pip Pupil', team:'U14', added:1}; s['coaches/teach1@c2ken.net'] = {name:'Mr Teach', scope:'admin'}; s['players/teach1@c2ken.net'] = {name:'T', team:'U14'}; });
  await p.goto('http://app.test/app/'); await p.waitForTimeout(2500);
  // the grid, then Player
  ok(await p.$('[data-join="player"]'), 'signed out: "Who are you?"');
  await p.click('[data-join="player"]'); await p.waitForTimeout(300);
  ok(await p.$('#jnPwF'), 'player sign-in shows email + password');
  // reopen: straight to the player sign-in
  await p.reload(); await p.waitForTimeout(2500);
  ok(await p.$('#jnPwF'), 'reopened: starts on the player sign-in');
  // not on a profile
  await p.fill('#jnPwE', 'nobody9@c2ken.net'); await p.fill('#jnPwP', 'secret1'); await p.click('#jnPwGo'); await p.waitForTimeout(500);
  ok(!(await p.$eval('#jnPwC', e => e.hidden)), 'unknown address: asks for the password again (first time)');
  await p.fill('#jnPwC', 'secret1'); await p.click('#jnPwGo'); await p.waitForTimeout(1500);
  ok(/isn’t on a player profile/.test(await p.$eval('#jnPwM', e => e.textContent)), 'not on a profile: refused, ' + await p.$eval('#jnPwM', e => e.textContent));
  ok(!(await p.evaluate(() => JSON.parse(localStorage.getItem('fakePwAccounts') || '{}')['nobody9@c2ken.net'])), 'not on a profile: the account was removed again');
  // a coach's C2k address that is also a player: player only
  // mismatch
  await p.fill('#jnPwE', 'pupil1@c2ken.net'); await p.fill('#jnPwP', 'secret1'); await p.click('#jnPwGo'); await p.waitForTimeout(500);
  await p.fill('#jnPwC', 'secret2'); await p.click('#jnPwGo'); await p.waitForTimeout(500);
  ok(/aren’t the same/.test(await p.$eval('#jnPwM', e => e.textContent)), 'two different passwords: refused');
  await p.fill('#jnPwC', 'secret1'); await p.click('#jnPwGo'); await p.waitForTimeout(4500);
  const role = await p.evaluate(() => window.__int && window.__int.Cloud.role); ok(role === 'player', 'on a profile: straight in as a player (' + role + ')');
  // sign out and back in with the password
  await p.evaluate(() => window.ERGS_AUTH.signOut()); await p.waitForTimeout(2500);
  await p.goto('http://app.test/app/'); await p.waitForTimeout(2500);
  await p.fill('#jnPwE', 'pupil1@c2ken.net'); await p.fill('#jnPwP', 'wrong99'); await p.click('#jnPwGo'); await p.waitForTimeout(500);
  await p.fill('#jnPwC', 'wrong99'); await p.click('#jnPwGo'); await p.waitForTimeout(800);
  ok(/already has an account/.test(await p.$eval('#jnPwM', e => e.textContent)), 'wrong password: says so, offers Forgot password');
  await p.click('#jnPwF2'); await p.waitForTimeout(300); ok(await p.evaluate(() => window.__resetSent) === 'pupil1@c2ken.net', 'Forgot password sends the reset email');
  await p.fill('#jnPwE', 'pupil1@c2ken.net'); await p.fill('#jnPwP', 'secret1'); await p.click('#jnPwGo'); await p.waitForTimeout(4500);
  { const r = await p.evaluate(() => [window.__int && window.__int.Cloud.role, (document.querySelector('#jnPwM')||{}).textContent, sessionStorage.getItem('fakePwUser')]); ok(r[0] === 'player', 'returning: email + password lets them in ' + JSON.stringify(r)); }
  await p.evaluate(() => window.ERGS_AUTH.signOut()); await p.waitForTimeout(2500);
  // a coach's C2k address (also on a player profile): never coach access with a password
  await p.goto('http://app.test/app/'); await p.waitForTimeout(2500);
  await p.fill('#jnPwE', 'teach1@c2ken.net'); await p.fill('#jnPwP', 'secret1'); await p.click('#jnPwGo'); await p.waitForTimeout(400); await p.fill('#jnPwC', 'secret1'); await p.click('#jnPwGo'); await p.waitForTimeout(4500);
  ok(await p.evaluate(() => window.__int && window.__int.Cloud.role) === 'player', 'teacher\'s C2k address with a password: player, not coach');
  ok(!(await p.evaluate(() => window.ERGS_AUTH.admin)), '…and not admin');
  { const e = p.errs.filter(x => !/reading 'set'/.test(x));  /* the 3D stand-in's own harmless error */ ok(!e.length, 'no page errors (3D stub aside) ' + e.join(' | ')); }
  // a player who came in by an emailed link is offered a password
  { const p2 = await open(b, 'player', {ctx:await b.newContext({viewport:{width:420, height:900}})});
    await p2.addInitScript(() => { if (!sessionStorage.getItem('t.once')){ sessionStorage.setItem('t.once', '1'); sessionStorage.setItem('ergs.askPw', '1'); } const s = window.__fsSeed || {}; s['players/linky@c2ken.net'] = {name:'Lin Ky', team:'U14', added:1}; window.__fakeUser = {email:'linky@c2ken.net', uid:'uidl', displayName:'Lin', emailVerified:true, providerData:[{providerId:'emailLink'}]}; });
    await p2.goto('http://app.test/app/'); await p2.waitForTimeout(4000);
    ok(await p2.$('.pwset'), 'link sign-in: "Set a password" is offered');
    await p2.fill('#pwsP', 'abcdef'); await p2.fill('#pwsC', 'abcdef'); await p2.click('#pwsGo'); await p2.waitForTimeout(500);
    ok(!(await p2.$('.pwset')) && (await p2.evaluate(() => JSON.parse(localStorage.getItem('fakePwAccounts') || '{}')['linky@c2ken.net'])), 'password saved');
    await p2.reload(); await p2.waitForTimeout(3000); ok(!(await p2.$('.pwset')), 'not asked again'); }
  // ERGS Live, installed app, signed out: goes to the team app's sign-in unless Supporter was picked
  { const c3 = await b.newContext({viewport:{width:420, height:900}}); const p3 = await open(b, 'out', {ctx:c3});
    await p3.addInitScript(() => { sessionStorage.setItem('fakeSignedOut', '1'); const mm = window.matchMedia.bind(window); window.matchMedia = q => /display-mode: standalone/.test(q) && !window.__notInst ? {matches:true, addEventListener(){}, addListener(){}} : mm(q); });
    await p3.goto('http://app.test/'); await p3.waitForTimeout(4000); ok(/\/app\/$/.test(new URL(p3.url()).pathname), 'installed ERGS Live, signed out, nothing picked: opens the sign-in (' + p3.url() + ')');
    await p3.evaluate(() => localStorage.setItem('ergs.joinAs', 'supporter')); await p3.goto('http://app.test/'); await p3.waitForTimeout(4000);
    ok(new URL(p3.url()).pathname === '/', 'picked Supporter: stays on ERGS Live');
    await p3.evaluate(() => localStorage.setItem('ergs.joinAs', 'player')); await p3.goto('http://app.test/?live'); await p3.waitForTimeout(3000);
    ok(new URL(p3.url()).pathname === '/', '?live link: stays on ERGS Live');
    const p4 = await open(b, 'out', {ctx:await b.newContext()}); await p4.addInitScript(() => sessionStorage.setItem('fakeSignedOut', '1'));
    await p4.goto('http://app.test/'); await p4.waitForTimeout(4000); ok(new URL(p4.url()).pathname === '/', 'a plain link in a browser (not the installed app): ERGS Live for everyone'); }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); })();
