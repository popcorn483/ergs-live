// Builds a database fixture at about the real size, from the coach test double's data plus generated people, for the fake Firestore.
const fs = require('fs'), vm = require('vm');
const win = {__fbResolve(){}, addEventListener(){}, location:{href:'http://app.test/', origin:'http://app.test', pathname:'/', hash:'', search:''}};
const sb = {window:win, console, setTimeout, clearTimeout, Date, JSON, Math, Object, Array, String, Promise, Set, Map, performance:{now:() => 0}, localStorage:{getItem(){ return null; }, setItem(){}}, sessionStorage:{getItem(){ return null; }, setItem(){}}, location:win.location, document:{}, navigator:{}};
sb.self = sb; vm.createContext(sb); vm.runInContext(fs.readFileSync(__dirname + '/mockfb-sc-co.js', 'utf8'), sb);
const cols = win.__store.cols, ADMIN = 'ergsrugby@gmail.com', now = Date.now(), DAY = 864e5;
const enc = d => ({j:JSON.stringify(d), u:now - 5*DAY}), seed = {};
const rnd = (() => { let s = 12345; return () => { s = (s*1664525 + 1013904223) % 4294967296; return s/4294967296; }; })();
const FN = ['Adam','Ben','Callum','Daniel','Ethan','Finn','George','Harry','Isaac','Jack','Kyle','Liam','Matthew','Noah','Oscar','Patrick','Quinn','Ryan','Sam','Tom','Amy','Beth','Cara','Emma','Grace','Holly','Katie','Lucy','Molly','Niamh'];
const LN = ['Armstrong','Boyd','Clarke','Dunn','Elliott','Ferguson','Graham','Hamilton','Irvine','Johnston','Kerr','Little','Maguire','Noble','Owens','Patterson','Reid','Scott','Thompson','Wilson'];
const TEAMS = ['U12','U13','U14','MEDS','2XV','1XV','SG'];
const N_PLAYERS = +process.env.PLAYERS || 150;
// roster and players
const roster = [], people = [];
for (let i = 0; i < N_PLAYERS; i++){ const f = FN[i % FN.length], l = LN[Math.floor(i/FN.length) % LN.length] + (i >= 600 ? i : ''), t = TEAMS[i % TEAMS.length], id = 'r' + (100 + i), em = `${f}.${l}${i}@example.com`.toLowerCase();
  roster.push({id, f, l, t}); people.push({em, name:f + ' ' + l, team:t, rid:id}); }
// keep the test double's own people too
Object.entries(cols.players || {}).forEach(([em, d]) => { seed['players/' + em] = d; });
people.forEach(p => { seed['players/' + p.em] = {name:p.name, team:p.team, rid:p.rid, added:now - 60*DAY, access:now - 30*DAY}; });
Object.entries(cols.coaches || {}).forEach(([em, d]) => { seed['coaches/' + em] = d; });
// a parent signed in with their own email, linked to the first player
seed['players/parent0@example.com'] = {aliasOf:people[0].em, rel:'guardian', gname:'Mrs Armstrong', added:now - 20*DAY};
for (let i = 0; i < 10; i++) seed[`coaches/coach${i}@example.com`] = {name:'Coach ' + LN[i], scope:i < 2 ? 'all' : TEAMS[i % TEAMS.length], added:now - 90*DAY};
if (process.env.WAITING) Object.entries(cols.requests || {}).forEach(([em, d]) => { seed['requests/' + em] = d; });   // people waiting for access: only when asked for
for (let i = 0; i < 35; i++) seed[`requests/fan${i}@example.com`] = {name:'Supporter ' + i, kind:'supporter', at:now - i*DAY};
// headshots: 100 approved, 2 waiting (a small picture; real ones are about 30 KB each)
const PIC = 'data:image/jpeg;base64,' + 'A'.repeat(2000);
people.slice(0, 100).forEach((p, i) => { seed['headshots/' + p.em] = {photo:PIC, status:i < 2 ? 'pending' : 'ok', season:'2026-27', at:now - i*3600e3, name:p.name, team:p.team}; });
// everyone who has signed in
people.concat([{em:ADMIN, name:'ERGS'}]).forEach((p, i) => { seed['members/uid' + i] = enc({role:'player', seen:now - i*3600e3, name:p.name, email:p.em, login:p.em, via:'', photo:''}); });
for (let i = 0; i < 50; i++) seed['members/gone' + i] = enc({role:'player', seen:now - (40 + i)*DAY, name:'Old ' + i, email:`old${i}@example.com`, login:`old${i}@example.com`});
// team docs (the test double's, plus a full roster and squads)
const team = Object.assign({}, cols.team || {});
team.roster = {players:roster.concat((team.roster && team.roster.players) || []), tabs:TEAMS};
team.drills = Object.assign({seeded:true, seedV:5, fit6:1, pack7:2, str8:1, tags:['Passing','Tackle','Ruck','Kicking','Fitness','Solo','Stretch']}, process.env.OLD_DRILLS ? {} : {built:1, tidy:1, gone:[]});
team.settings = team.settings || {}; team.maint = Object.assign({reqClear1:1}, team.maint || {});
['squads','notes','tags','roles','books','noms','nomsArc','nomsAdj','nomsDone','mplan','papprove','photos','trophies','maint','email','veo'].forEach(k => { if (!(k in team)) team[k] = {}; });
Object.entries(team).forEach(([k, d]) => { seed['team/' + k] = k === 'maint' ? d : enc(d); });   // team/maint is written with plain fields
['boys','girls'].forEach(k => { seed['totw/' + k] = enc((cols.totw || {})[k] || {}); });
// matches -> live/state
const matches = Object.entries(cols.matches || {}).map(([id, d]) => Object.assign({}, d, {id}));
seed['live/state'] = {json:JSON.stringify({matches, schools:cols.schools || {}, demo:false, updated:now}), updated:now};
// Team news: 60 posts; read receipts for 100 players
for (let i = 0; i < 60; i++) seed['posts/p' + i] = {text:'Training update number ' + i + '. Bring boots and a gum shield.', at:now - i*DAY/2, by:ADMIN, byName:'ERGS', team:i % 3 ? '' : TEAMS[i % TEAMS.length]};
people.slice(0, 100).forEach((p, i) => { seed['reads/' + p.em] = {p:Object.fromEntries(Array.from({length:20}, (_, k) => ['p' + k, now - k*DAY])), name:p.name, at:now - i*3600e3}; });
// match records, likes and photo tags
people.slice(0, 100).forEach((p, i) => { seed['pstats/' + p.em] = {g:{a1:{p:1, pos:'9', at:now - DAY}}, name:p.name, team:p.team, at:now - (i + 1)*3600e3}; });
Object.entries(cols.pstats || {}).forEach(([em, d]) => { seed['pstats/' + em] = d; });
people.slice(0, 80).forEach((p, i) => { seed['likes/' + p.em] = {p:Object.fromEntries(Array.from({length:10}, (_, k) => ['ph' + ((i + k) % 40), now - k*DAY])), name:p.name, at:now - (i + 1)*3600e3}; });
people.slice(0, 50).forEach((p, i) => { seed['phtags/' + p.em] = {p:Object.fromEntries(Array.from({length:5}, (_, k) => ['ph' + ((i*3 + k) % 40), [0.5, 0.5]])), name:p.name, at:now - (i + 1)*3600e3}; });
Object.entries(cols.piq || {}).forEach(([em, d]) => { seed['piq/' + em] = d; });
people.slice(0, 60).forEach((p, i) => { seed['piq/' + p.em] = {name:p.name, team:p.team, week:'2026-W46', best:1000 + i*10, wk:900 + i, sd:5, sdWk:3, games:3, updated:now - i*3600e3}; });
people.slice(0, 40).forEach((p, i) => { seed['avail/' + p.em] = {m:{a6:'y'}, name:p.name, team:p.team, rid:p.rid, at:now - i*3600e3}; });
// training drills (800, a simple shape), plays, sponsors, team sheets, video analysis
const frame = {dur:1, caption:'', kick:false, lift:[], down:[], pose:{}, pos:{A1:[0, 0], A2:[2, 2]}, ball:{carrier:'A1', x:0, y:0}, draw:[]};
const N_DRILLS = process.env.OLD_DRILLS ? 800 : 12;   // after the tidy the database holds only what coaches made or changed
for (let i = 0; i < N_DRILLS; i++) seed['drills/dr' + String(i).padStart(4, '0')] = enc({drill:{title:'Drill ' + i, drill:true, code:'union', age:'u16', showB:true, use:['A1', 'A2'], cones:[], posts:[], tags:[i % 2 ? 'Passing' : 'Tackle'], grp:'all', desc:'A drill.', mins:10, frames:[frame, frame]}, updated:now - 10*DAY, pre:1});
for (let i = 0; i < 30; i++) seed['plays/pl' + i] = enc({play:{title:'Play ' + i, code:'union', age:'u16', use:['A1', 'A2'], frames:[frame, frame]}, group:'Coach plays', order:i, updated:now - 20*DAY});
for (let i = 0; i < 8; i++) seed['sponsors/sp' + i] = enc({name:'Sponsor ' + i});
for (let i = 0; i < 40; i++) seed['sheets/sh' + i] = enc({tag:TEAMS[i % TEAMS.length], date:'2026-11-0' + (1 + i % 9), created:now - i*DAY, players:roster.slice(i, i + 15).map((p, k) => ({f:p.f, l:p.l, n:k + 1, t:p.t}))});
for (let i = 0; i < 12; i++) seed['analysis/an' + i] = enc({title:'Clip ' + i, created:now - i*DAY, team:TEAMS[i % TEAMS.length], notes:[]});
seed['notify/cfg'] = {on:false};
for (let i = 0; i < 120; i++) seed['audit/' + (now - i*3600e3) + '-x' + i] = {at:now - i*3600e3, by:ADMIN, act:'Approved or added a player', who:'Someone ' + i, det:'Team: Under 14'};
const by = {}; Object.keys(seed).forEach(k => { const c = k.split('/')[0]; by[c] = (by[c] || 0) + 1; });
fs.writeFileSync(__dirname + '/fake/seed.js', 'window.__fsSeed = ' + JSON.stringify(seed) + ';\nwindow.__seedPeople = ' + JSON.stringify(people.slice(0, 5)) + ';');
console.log(JSON.stringify(by), (fs.statSync(__dirname + '/fake/seed.js').size/1e6).toFixed(2) + ' MB');
