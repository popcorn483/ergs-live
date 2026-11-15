// Real fb-main.js against the fake Firestore, two devices at once: a coach (admin) and a player. Team news, likes, tags.
const { chromium } = require('playwright'); const { open, fmt } = require('./real.js');
const ok = (c, m) => console.log((c ? '  ok   ' : '  FAIL ') + m);
(async () => { const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1300, height:1000}});
  const A = await open(b, 'admin', {ctx}), P = await open(b, 'player', {ctx});
  await A.goto('http://app.test/app/'); await A.waitForTimeout(7000); await P.goto('http://app.test/app/'); await P.waitForTimeout(8000);
  await A.cost(); await P.cost();
  const store = (pg, path) => pg.evaluate(p => { const v = window.__fs.store.get(p); return v === undefined ? null : JSON.parse(JSON.stringify(v)); }, path);
  // ---- Team news: the coach posts; the player sees it without re-reading every post
  await A.nav('news'); await A.waitForTimeout(1500);
  await A.click('#nwNew, [data-nwnew], .nw-new').catch(async () => { await A.evaluate(() => { const b = [...document.querySelectorAll('#news button')].find(x => /new post|write|post/i.test(x.textContent)); if (b) b.click(); }); });
  await A.waitForTimeout(500); await A.fill('#nwText', 'Training is on the back pitch tonight.'); await A.click('#nwPost'); await A.waitForTimeout(1500);
  const posts = await A.evaluate(() => [...window.__fs.store.entries()].filter(([k, v]) => k.startsWith('posts/') && /back pitch/.test(v.text || '')).map(([k, v]) => [k, v.u > 0, v.del]));
  ok(posts.length === 1 && posts[0][1] === true && posts[0][2] === false, 'post written with u and del:false ' + JSON.stringify(posts));
  let c = await P.cost(); ok(c.reads <= 3, 'player got the new post for ' + c.reads + ' read(s): ' + JSON.stringify(c.by));
  await P.nav('news'); await P.waitForTimeout(1500); ok(await P.evaluate(() => document.querySelector('#news').innerText.includes('back pitch')), 'player sees the post in Team news'); c = await P.cost(); console.log('     player opening news:', fmt(c));
  // edit
  await A.evaluate(() => { const b = document.querySelector('#news [data-nwe]'); b && b.click(); }); await A.waitForTimeout(500); await A.fill('#nwText', 'Training is on the FRONT pitch tonight.'); await A.click('#nwPost'); await A.waitForTimeout(1500);
  ok(await P.evaluate(() => document.querySelector('#news').innerText.includes('FRONT pitch')), 'player sees the edit'); c = await P.cost(); ok(c.reads <= 2, 'the edit cost the player ' + c.reads + ' read(s)');
  // delete (soft)
  const id = posts[0][0].split('/')[1];
  await A.evaluate(id => { const b = document.querySelector(`#news [data-nwx="${id}"]`); b && b.click(); }, id); await A.waitForTimeout(500);
  await A.evaluate(() => { const y = [...document.querySelectorAll('#askModal button, .modal button')].find(x => /^delete$/i.test(x.textContent.trim())); y && y.click(); }); await A.waitForTimeout(1500);
  const d = await store(A, 'posts/' + id); ok(d && d.del === true && d.text === '', 'deleted post is marked, with its text emptied: ' + JSON.stringify(d).slice(0, 120));
  ok(!(await A.evaluate(() => document.querySelector('#news').innerText.includes('FRONT pitch'))), 'gone from the coach’s list');
  ok(!(await P.evaluate(() => document.querySelector('#news').innerText.includes('FRONT pitch'))), 'gone from the player’s list');
  // a reload: the player's device still doesn't show it and reads almost nothing
  await P.reload(); await P.waitForTimeout(8000); c = await P.cost(); console.log('     player reopening:', fmt(c));
  await P.nav('news'); await P.waitForTimeout(1200); ok(!(await P.evaluate(() => document.querySelector('#news').innerText.includes('FRONT pitch'))), 'still gone after reopening');
  ok(await P.evaluate(() => document.querySelector('#news').innerText.includes('Training update number 0')), 'older posts are still there after reopening');
  console.log('coach errors', A.errs.filter(e => !/reading 'set'/.test(e)).slice(0, 5), 'player errors', P.errs.filter(e => !/reading 'set'/.test(e)).slice(0, 5), [...new Set(A.cons.concat(P.cons))].slice(0, 5));
  await b.close(); })();
