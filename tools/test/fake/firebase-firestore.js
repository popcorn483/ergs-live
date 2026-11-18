// Test double for Cloud Firestore: an in-memory database (kept in IndexedDB between reloads) that counts reads, writes and
// deletes the way Firestore bills them, including the extra reads its security rules make (exists()/get() lookups), and
// refuses what the real rules (firestore.rules) would refuse, field checks included. Seed: window.__fsSeed = {'col/id': data, …}.
// It can also be "offline" (window.__offline before loading, or __fs.offline(true/false)): look-ups fail or answer from an empty
// device, listeners are told a document "doesn't exist" (from the device), and saves wait: what the real SDK does.
const W = window, ADMIN = 'ergsrugby@gmail.com';
const idb = (mode, fn) => new Promise((res, rej) => { const o = indexedDB.open('fakefs', 1); o.onupgradeneeded = () => o.result.createObjectStore('kv'); o.onerror = () => rej(o.error);
  o.onsuccess = () => { const tx = o.result.transaction('kv', mode), rq = fn(tx.objectStore('kv')); tx.oncomplete = () => { res(rq && rq.result); o.result.close(); }; tx.onerror = () => { rej(tx.error); o.result.close(); }; }; });
let store = new Map();
{ let saved = null; try { saved = await idb('readonly', st => st.get('store')); } catch(e){}
  if (saved) store = new Map(saved); else if (W.__fsSeed){ store = new Map(Object.entries(W.__fsSeed)); try { await idb('readwrite', st => st.put([...store.entries()], 'store')); } catch(e){} } }
let saveT = 0; const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => { idb('readwrite', st => st.put([...store.entries()], 'store')).catch(() => {}); }, 150); };
const NET = {off:!!W.__offline, queue:[]}, OFFD = () => W.__offDelay || 400;
W.__fs = {get store(){ return store; }, persist, set(path, data){ applySet(path, data); }, del(path){ applyDel(path); },
  offline(on){ const was = NET.off; NET.off = !!on; if (was && !on) goOnline(); else if (!was && on) wentOffline(); }, get isOffline(){ return NET.off; }, queued(){ return NET.queue.map(q => (q.del ? 'delete ' : 'set ') + q.ref.path); }};

/* ---------- the meter ---------- */
const M = W.__meter = {reads:0, rules:0, writes:0, deletes:0, log:[], mark:0,
  since(){ const l = this.log.slice(this.mark); this.mark = this.log.length; return l; } };
const note = (kind, what, n, rules) => { if (kind === 'read') M.reads += n; else if (kind === 'write') M.writes += n; else if (kind === 'delete') M.deletes += n; M.rules += rules || 0; M.log.push([Math.round(performance.now()), kind, what, n, rules || 0]); };

/* ---------- who is asking, and what the rules allow ---------- */
const me = () => { const u = W.__fakeUser; return u && u.email ? u.email.toLowerCase() : ''; }, uidOf = () => (W.__fakeUser && W.__fakeUser.uid) || '';
const twins = e => [...new Set([e, e.replace(/@c2ken\.net$/, '@c2kni.net'), e.replace(/@c2kni\.net$/, '@c2ken.net')])];
const who = () => { const e0 = me(), fu = W.__fakeUser || {}, pwo = !!fu.pwOnly, e = pwo && !/@c2k(en|ni)\.net$/.test(e0) ? '' : e0;   // a C2k password sign-in nobody has proved: player profiles only (firestore.rules: pwC2k)
  const admin = !pwo && e === ADMIN, onList = col => !!e && twins(e).some(x => store.has(col + '/' + x)), coach = !pwo && (admin || onList('coaches')), player = onList('players');
  const p = e ? store.get('players/' + e) : null, alias = p && p.aliasOf ? String(p.aliasOf).toLowerCase() : '';
  const own = id => !!e && !!id && twins(e).includes(id), mine = id => own(id) || (!!e && !!id && id === alias);
  return {e, admin, coach, player, squad:coach || player, signedIn:!!e && !pwo, own:id => (!pwo || !/^(coaches)$/.test(W.__col || '')) && own(id), mine:id => (!pwo || !/^(coaches)$/.test(W.__col || '')) && (pwo && W.__col === 'requests' ? own(id) : mine(id)), pwo,
    costCoach:admin || !e ? 0 : 1,
    // the rules as published now try "coach" first; the reordered rules (window.__rules2) try the free checks and "player" first
    costSquad:admin || !e ? 0 : W.__rules2 ? (player ? 1 : 2) : (coach ? 1 : 2),
    costOwn:id => admin || !e ? 0 : W.__rules2 ? (id === e ? 0 : coach ? 1 : 2) : 1}; };
// who may read: "own" = the person the document belongs to, or a coach (a whole collection of those: coaches only)
const RD = {pushsubs:'all', pushq:'all', live:'all', viewers:'all', coaches:'own', requests:'own', headshots:'own', avail:'own', players:'own', team:'squad', plays:'squad', images:'squad', totw:'coach', drills:'squad', analysis:'squad', faces:'all',
  piq:'squad', notify:'signed', posts:'squad', reads:'own', pstats:'own', likes:'squad', phtags:'squad', audit:'admin', sponsors:'coach', sheets:'coach', members:'coach'};
function allow(path, write, isCol){ W.__col = path.split('/')[0]; const parts = path.split('/'), col = parts[0], id = isCol ? null : parts[1], U = who(), r = RD[col] || 'coach';
  if ((W.__deny || []).includes(col)) return {ok:false, cost:0};
  switch (r){
    case 'all': return {ok:true, cost:0};
    case 'signed': return {ok:U.signedIn || (U.pwo && !!U.e), cost:0};
    case 'admin': return {ok:U.admin, cost:0};
    case 'coach': return {ok:U.coach, cost:U.costCoach};
    case 'squad': return {ok:U.squad, cost:U.costSquad};
    case 'own': return {ok:U.coach || U.mine(id), cost:U.costOwn(id)};
  } return {ok:false, cost:0}; }
// who may write, and what a write must look like: firestore.rules, line for line (cur: the document now, next: as it would be; null = delete)
const isStr = x => typeof x === 'string', isNum = x => typeof x === 'number', isMapV = x => !!x && typeof x === 'object' && !Array.isArray(x) && !('__ts' in x);
const only = (o, list) => Object.keys(o).every(k => list.includes(k)), size = x => isStr(x) || Array.isArray(x) ? x.length : isMapV(x) ? Object.keys(x).length : 0;
const changed = (a, b) => [...new Set(Object.keys(a || {}).concat(Object.keys(b || {})))].filter(k => JSON.stringify((a || {})[k]) !== JSON.stringify((b || {})[k]));
const reqOK = d => only(d, ['name', 'photo', 'at', 'squad', 'pos', 'sent', 'resend', 'kind', 'follow', 'child', 'coachOf', 'iam', 'pw']) && (!('iam' in d) || ['player', 'guardian', 'coach', 'supporter'].includes(d.iam)) && (!('follow' in d) || (Array.isArray(d.follow) && d.follow.length <= 12)) && (!('kind' in d) || ['', 'supporter', 'guardian', 'coach'].includes(d.kind))
  && (!('coachOf' in d) || (Array.isArray(d.coachOf) && d.coachOf.length <= 8)) && (!('child' in d) || (isStr(d.child) && d.child.length < 80)) && (!('squad' in d) || (isStr(d.squad) && d.squad.length < 20)) && (!('pos' in d) || (isStr(d.pos) && d.pos.length < 4)) && isStr(d.name) && d.name.length < 120;
const COACH_W = ['coaches', 'players', 'team', 'plays', 'images', 'totw', 'drills', 'analysis', 'notify', 'sponsors', 'sheets'];
function canWrite(path, cur, next){ W.__col = path.split('/')[0]; const parts = path.split('/'), col = parts[0], id = parts[1], U = who(), del = next === null, create = cur === undefined && !del, update = cur !== undefined && !del;
  if ((W.__deny || []).includes(col)) return false;
  if (COACH_W.includes(col)) return U.coach;
  if (create && U.coach && ['headshots', 'avail', 'piq', 'reads', 'pstats', 'likes'].includes(col)) return true;   // a coach moving a record to a new email
  if (col === 'pushq') return U.coach && (del || (create && id.length < 80 && only(next, ['k', 'team', 'title', 'body', 'url', 'at']) && isStr(next.title) && next.title.length < 121 && isStr(next.body) && next.body.length < 241 && typeof next.at === 'number'));
  if (col === 'pushsubs') return del || (id.length < 80 && only(next, ['sub', 'teams', 'at', 'coach', 'kinds']) && (!('kinds' in next) || (Array.isArray(next.kinds) && next.kinds.length <= 8)) && isStr(next.sub) && next.sub.length < 2500 && Array.isArray(next.teams) && next.teams.length <= 20 && typeof next.at === 'number' && (!('coach' in next) || (next.coach === true && U.coach)) && (!cur || cur.sub === next.sub));
  switch (col){
    case 'live': return !del && U.coach && isStr(next.json) && next.json.length < 900000;
    case 'viewers': return del || (parts[1].length < 80 && parts[3].length < 40 && only(next, ['at', 'exp']));
    case 'requests': if (del) return (!U.pwo && (U.own(id) || U.mine(id)) && !(cur && cur.rejected === true)) || U.coach; if (U.coach) return true; if (!U.mine(id) || !reqOK(next)) return false;
      if (cur && cur.rejected === true) return false;   // rejected by a coach: closed to its owner
      if (U.pwo && !(next.pw === true && !next.kind && (next.iam || 'player') === 'player' && !('coachOf' in next) && !('child' in next) && !('follow' in next))) return false;   // pwAskOK
      return create || !('sent' in cur) || (next.sent || 0) === cur.sent || cur.resend === true || Date.now() - cur.sent > 3600000;
    case 'headshots': if (del) return U.coach; if (update && U.coach) return true; if (!(U.player && U.mine(id))) return false;
      if (next.status === 'pending' && isStr(next.photo) && next.photo.length < 950000 && isStr(next.season) && (cur === undefined || cur.status === 'open' || cur.season !== next.season)) return true;
      if (update && changed(cur, next).every(k => k === 'seen')) return true;
      return next.status === 'removed' && next.photo === '' && isStr(next.season);
    case 'avail': if (del) return U.coach; return U.player && U.mine(id) && only(next, ['m', 'name', 'team', 'rid', 'at']) && size(next.m) < 60;
    case 'faces': if (del) return U.coach; return U.coach && isStr(next.d) && next.d.length < 120000;
    case 'piq': if (del) return U.coach; return U.squad && U.mine(id) && only(next, ['name', 'team', 'week', 'best', 'wk', 'sd', 'sdWk', 'games', 'updated']) && isStr(next.name) && next.name.length < 60
      && isNum(next.best) && next.best <= 20000 && isNum(next.wk) && next.wk <= 20000 && isNum(next.sd) && next.sd <= 1000 && isNum(next.sdWk) && next.sdWk <= 1000;
    case 'posts': if (del) return U.coach; return U.coach && isStr(next.text) && next.text.length < 4000 && isNum(next.at);
    case 'reads': if (del) return U.coach; return U.squad && U.mine(id) && only(next, ['p', 'g', 'name', 'at']) && size(next.p || {}) < 400 && size(next.g || {}) < 400;
    case 'pstats': if (del) return U.coach; return U.squad && U.mine(id) && only(next, ['g', 'name', 'team', 'at']) && isMapV(next.g) && size(next.g) <= 150 && isStr(next.name) && next.name.length < 80;
    case 'likes': if (del) return U.own(id) || U.coach || U.mine(id); return U.squad && U.mine(id) && only(next, ['p', 'name', 'at']) && isMapV(next.p) && size(next.p) <= 500 && isNum(next.at);
    case 'phtags': if (del) return U.own(id) || U.coach || U.mine(id); return (U.coach || (U.player && U.mine(id))) && only(next, ['p', 'name', 'at']) && isMapV(next.p) && size(next.p) <= 400 && isNum(next.at);
    case 'audit': if (del) return U.admin; return create && U.coach && only(next, ['at', 'by', 'act', 'who', 'det']) && next.by === U.e && isNum(next.at) && isStr(next.act) && next.act.length < 100 && isStr(next.who) && next.who.length < 150 && isStr(next.det) && next.det.length < 400;
    case 'members': return (U.squad && uidOf() === id) || (del && U.coach);
  } return false; }
const wcost = col => { const U = who(); return COACH_W.concat(['live', 'faces', 'posts', 'audit']).includes(col) ? U.costCoach : U.costSquad; };
const denied = what => { const e = new Error('Missing or insufficient permissions. (' + what + ')'); e.code = 'permission-denied'; (W.__denied = W.__denied || []).push(what); return e; };
const usedUp = () => { const e = new Error('Quota exceeded.'); e.code = 'resource-exhausted'; return e; };   // window.__quotaRead: the day's reads are used up
const offErr = what => { const e = new Error('Failed to get document because the client is offline. (' + what + ')'); e.code = 'unavailable'; return e; };

/* ---------- values ---------- */
export class Timestamp { constructor(ms){ this.ms = ms; } static fromMillis(ms){ return new Timestamp(ms); } static now(){ return new Timestamp(Date.now()); } toMillis(){ return this.ms; } toDate(){ return new Date(this.ms); } }
const ST = {__st:1}; export const serverTimestamp = () => ST;
const DEL = {__del:1}; export const deleteField = () => DEL;
const toStore = v => v === ST ? {__ts:Date.now()} : v === DEL ? {__del:1} : v instanceof Timestamp ? {__ts:v.ms} : Array.isArray(v) ? v.map(toStore) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, toStore(x)])) : v;
const fromStore = v => Array.isArray(v) ? v.map(fromStore) : v && typeof v === 'object' ? ('__ts' in v ? new Timestamp(v.__ts) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fromStore(x)]))) : v;
const cmpVal = v => v instanceof Timestamp ? v.ms : v && typeof v === 'object' && '__ts' in v ? v.__ts : v;

/* ---------- references and queries ---------- */
export function getFirestore(){ return {type:'fs'}; }
export function doc(parent, ...segs){ const path = (parent && (parent.type === 'col' || parent.type === 'doc') ? parent.path + '/' : '') + segs.join('/'); return {type:'doc', path, id:path.split('/').pop()}; }
export function collection(parent, ...segs){ const path = (parent && parent.type === 'doc' ? parent.path + '/' : '') + segs.join('/'); return {type:'col', path, cons:[]}; }
export function query(col, ...cons){ return {type:'col', path:col.path, cons:(col.cons || []).concat(cons)}; }
export const where = (field, op, value) => ({c:'where', field, op, value});
export const orderBy = (field, dir) => ({c:'orderBy', field, dir:dir || 'asc'});
export const limit = n => ({c:'limit', n});
export const documentId = () => '__name__';
const fieldOf = (id, d, f) => f === '__name__' ? id : cmpVal(d[f]);
function run(q){ const pre = q.path + '/', out = [];
  for (const [k, d] of store){ if (!k.startsWith(pre) || k.indexOf('/', pre.length) >= 0) continue; out.push([k.slice(pre.length), d]); }
  let rows = out; const ords = [];
  for (const c of q.cons){
    if (c.c === 'where'){ const v = cmpVal(c.value); if (c.op === 'in' && c.value.length > 30) throw Object.assign(new Error('"in" takes at most 30 values'), {code:'invalid-argument'});
      rows = rows.filter(([id, d]) => { const x = fieldOf(id, d, c.field); if (x === undefined) return false;
      return c.op === '==' ? x === v : c.op === '>' ? typeof x === typeof v && x > v : c.op === '>=' ? typeof x === typeof v && x >= v : c.op === '<' ? typeof x === typeof v && x < v : c.op === '<=' ? typeof x === typeof v && x <= v : c.op === 'in' ? c.value.includes(x) : c.op === 'array-contains' ? Array.isArray(x) && x.includes(v) : false; });
      if (c.op !== '==' && c.op !== 'in' && c.op !== 'array-contains' && !ords.some(o => o.field === c.field)) ords.push({field:c.field, dir:'asc', implied:true}); }
    else if (c.c === 'orderBy'){ const i = ords.findIndex(o => o.field === c.field); if (i >= 0) ords[i] = {field:c.field, dir:c.dir}; else ords.push({field:c.field, dir:c.dir}); } }
  for (const o of ords) rows = rows.filter(([id, d]) => fieldOf(id, d, o.field) !== undefined);   // an ordered query leaves out documents without that field
  rows.sort((a, b) => { for (const o of ords){ const x = fieldOf(a[0], a[1], o.field), y = fieldOf(b[0], b[1], o.field); if (x !== y) return (x > y ? 1 : -1)*(o.dir === 'desc' ? -1 : 1); } return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
  const lim = q.cons.find(c => c.c === 'limit'); if (lim) rows = rows.slice(0, lim.n);
  return rows; }
const META = (fromCache, pending) => ({fromCache:!!fromCache, hasPendingWrites:!!pending});
const dsnap = (ref, d, meta) => ({id:ref.id, ref, metadata:meta || META(false), exists:() => d !== undefined, data:() => d === undefined ? undefined : fromStore(d), get:f => d === undefined ? undefined : fromStore(d[f])});
const qsnap = (q, rows, meta, changes) => { const docs = rows.map(([id, d]) => dsnap({type:'doc', path:q.path + '/' + id, id}, d, meta));
  return {docs, size:docs.length, empty:!docs.length, metadata:meta || META(false), forEach:f => docs.forEach(f), docChanges:() => changes || docs.map(d => ({type:'added', doc:d}))}; };
const desc = q => q.path + (q.cons && q.cons.length ? ' [' + q.cons.map(c => c.c === 'where' ? `${c.field} ${c.op} ${Array.isArray(c.value) ? c.value.length + ' ids' : typeof cmpVal(c.value) === 'number' && cmpVal(c.value) > 1e11 ? 'time' : cmpVal(c.value)}` : c.c === 'orderBy' ? 'by ' + c.field : 'limit ' + c.n).join(', ') + ']' : '');

/* ---------- reads ---------- */
const later = ms => new Promise(r => setTimeout(r, ms || 2));
export async function getDoc(ref){ if (NET.off){ await later(OFFD()); if (NET.off) throw offErr('get ' + ref.path); } await later(); if (W.__quotaRead) throw usedUp(); const a = allow(ref.path, false); if (!a.ok) throw denied('get ' + ref.path); note('read', 'get ' + ref.path, 1, a.cost); return dsnap(ref, store.get(ref.path)); }
export const getDocFromServer = getDoc;
export async function getDocs(q){ if (NET.off){ await later(OFFD()); if (NET.off){ note('offline', 'list (answered from the device: empty) ' + desc(q), 0, 0); return qsnap(q, [], META(true)); } }
  await later(); if (W.__quotaRead) throw usedUp(); const a = allow(q.path, false, true); if (!a.ok) throw denied('list ' + q.path); const rows = run(q); note('read', 'list ' + desc(q), Math.max(1, rows.length), a.cost); return qsnap(q, rows); }
export async function getDocsFromServer(q){ if (NET.off){ await later(OFFD()); if (NET.off) throw offErr('list ' + q.path); } return getDocs(q); }
export async function getCountFromServer(q){ if (NET.off){ await later(OFFD()); if (NET.off) throw offErr('count ' + q.path); } await later(); if (W.__quotaRead) throw usedUp(); const a = allow(q.path, false, true); if (!a.ok) throw denied('count ' + q.path); const n = run(q).length; note('read', 'count ' + desc(q), Math.max(1, Math.ceil(n/1000)), a.cost); return {data:() => ({count:n})}; }
// what a collection adds up to: count() and sum(field), one read for up to 1,000 documents
export const count = () => ({agg:'count'}), sum = f => ({agg:'sum', f}), average = f => ({agg:'avg', f});
export async function getAggregateFromServer(q, spec){ if (NET.off){ await later(OFFD()); if (NET.off) throw offErr('tally ' + q.path); } await later(); if (W.__quotaRead) throw usedUp(); const a = allow(q.path, false, true); if (!a.ok) throw denied('tally ' + q.path);
  const rows = run(q), num = (d, f) => { const v = cmpVal(d[f]); return typeof v === 'number' ? v : null; }, out = {};
  for (const k in spec){ const s = spec[k]; if (s.agg === 'count') out[k] = rows.length; else { const vs = rows.map(([, d]) => num(d, s.f)).filter(v => v !== null); out[k] = s.agg === 'sum' ? vs.reduce((t, v) => t + v, 0) : vs.length ? vs.reduce((t, v) => t + v, 0)/vs.length : null; } }
  note('read', 'tally ' + desc(q), Math.max(1, Math.ceil(rows.length/1000)), a.cost); return {data:() => out}; }
const listeners = new Set();
// what a listener sees: a document's value, or a list's rows
const stateOf = L => L.isDoc ? store.get(L.ref.path) : run(L.ref);
const keyOf = (L, st) => L.isDoc ? JSON.stringify(st === undefined ? null : st) : new Map(st.map(([id, d]) => [id, JSON.stringify(d)]));
const sameKey = (L, a, b) => { if (L.isDoc) return a === b; if (a.size !== b.size) return false; for (const [id, j] of a){ if (b.get(id) !== j) return false; } return true; };
function deliver(L, st, meta){ const key = keyOf(L, st);
  if (L.isDoc){ L.last = key; L.cb(dsnap(L.ref, st, meta)); return; }
  const was = L.last || new Map(), ch = [], mk = (id, d) => dsnap({type:'doc', path:L.ref.path + '/' + id, id}, d, meta);
  st.forEach(([id, d]) => { const j = was.get(id); if (j === undefined) ch.push({type:'added', doc:mk(id, d)}); else if (j !== key.get(id)) ch.push({type:'modified', doc:mk(id, d)}); });
  was.forEach((j, id) => { if (!key.has(id)) ch.push({type:'removed', doc:mk(id, JSON.parse(j))}); });
  L.last = key; L.cb(qsnap(L.ref, st, meta, ch)); }
function sync(L){   // the server answers this listener for the first time
  if (W.__quotaRead){ L.dead = true; listeners.delete(L); L.onErr && L.onErr(usedUp()); return; }
  const a = allow(L.ref.path, false, !L.isDoc); if (!a.ok){ L.dead = true; listeners.delete(L); L.onErr && L.onErr(denied('listen ' + (L.isDoc ? L.ref.path : desc(L.ref)))); return; }
  let st; try { st = stateOf(L); } catch(e){ L.dead = true; listeners.delete(L); L.onErr && L.onErr(e); return; }
  const key = keyOf(L, st), had = L.started; L.synced = true; L.started = true;
  note('read', 'listen ' + (L.isDoc ? L.ref.path : desc(L.ref)), L.isDoc ? 1 : Math.max(1, st.length), a.cost);
  if (had && sameKey(L, L.last, key) && !L.meta) return;   // what the device guessed was right, and this listener doesn't hear news that is only about the connection
  deliver(L, st, META(false)); }
export function onSnapshot(ref, a, b, c){
  const hasOpt = typeof a !== 'function', cb = hasOpt ? b : a, onErr = hasOpt ? c : b, isDoc = ref.type === 'doc';
  const L = {ref, cb, onErr, isDoc, meta:!!(hasOpt && a && a.includeMetadataChanges), last:null, dead:false, synced:false, started:false};
  listeners.add(L);
  setTimeout(() => { if (L.dead) return;
    if (!NET.off) return sync(L);
    // no connection: after a while the SDK answers from the device, which has nothing ("doesn't exist" / an empty list)
    setTimeout(() => { if (L.dead || L.synced || !NET.off) return; L.started = true; note('offline', 'listen (answered from the device: nothing) ' + (isDoc ? ref.path : desc(ref)), 0, 0); deliver(L, isDoc ? undefined : [], META(true)); }, OFFD()); }, 2);
  return () => { L.dead = true; listeners.delete(L); }; }
function goOnline(){ for (const L of [...listeners]){ if (!L.dead && !L.synced) sync(L); } fanOut();
  const q = NET.queue.splice(0); q.forEach(w => { try { w.del ? doDelete(w.ref) : doSet(w.ref, w.data, w.opt); w.res(); } catch(e){ w.rej(e); } }); }
function wentOffline(){ for (const L of [...listeners]){ if (L.dead || !L.synced || !L.meta) continue; const st = stateOf(L); L.isDoc ? L.cb(dsnap(L.ref, st, META(true))) : L.cb(qsnap(L.ref, st, META(true), [])); } }
let fanQueued = false; const fanSoon = () => { if (fanQueued) return; fanQueued = true; setTimeout(() => { fanQueued = false; fanOut(); }, 0); };
function fanOut(){ if (NET.off) return; for (const L of [...listeners]){ if (L.dead || !L.synced) continue;
  let st; try { st = stateOf(L); } catch(e){ continue; } const key = keyOf(L, st); if (sameKey(L, L.last, key)) continue;
  let n = 1; if (!L.isDoc){ n = 0; for (const [id, j] of key){ if (L.last.get(id) !== j) n++; } }
  if (n) note('read', 'update ' + (L.isDoc ? L.ref.path : desc(L.ref)), n, 0); deliver(L, st, META(false, L.pend)); } }
// a save from this page is shown at once and then confirmed: listeners that asked for it hear a second time, with nothing changed but "confirmed"
let echoT = 0; const echoSoon = () => { clearTimeout(echoT); echoT = setTimeout(() => { for (const L of [...listeners]){ if (L.dead || !L.synced || !L.meta || NET.off) continue; const st = stateOf(L); L.isDoc ? L.cb(dsnap(L.ref, st, META(false))) : L.cb(qsnap(L.ref, st, META(false), [])); } }, 9); };

/* ---------- writes ---------- */
// other pages in the same browser are other devices: they hear about every write
const BC = new BroadcastChannel('fakefs');
BC.onmessage = e => { const m = e.data; if (m.del) store.delete(m.path); else store.set(m.path, m.v); fanSoon(); };
// {merge:true} merges maps field by field, all the way down (arrays and other values are replaced; deleteField() takes a field out), as Firestore does
const isMap = x => x && typeof x === 'object' && !Array.isArray(x) && !('__ts' in x) && !('__del' in x);
const isDel = x => !!x && typeof x === 'object' && '__del' in x;
const strip = v => isMap(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => !isDel(x)).map(([k, x]) => [k, strip(x)])) : v;
const deepMerge = (a, b) => { const o = Object.assign({}, a); for (const k in b){ if (isDel(b[k])) delete o[k]; else o[k] = isMap(a[k]) && isMap(b[k]) ? deepMerge(a[k], b[k]) : strip(b[k]); } return o; };
const merged = (path, data, merge) => { const cur = store.get(path), v = toStore(data); return merge ? deepMerge(cur || {}, v) : v; };
function applySet(path, data, merge){ const nu = merged(path, data, merge); store.set(path, nu); persist(); BC.postMessage({path, v:nu}); fanSoon(); echoSoon(); }
function applyDel(path){ store.delete(path); persist(); BC.postMessage({path, del:true}); fanSoon(); echoSoon(); }
function doSet(ref, data, opt){ const col = ref.path.split('/')[0], next = merged(ref.path, data, opt && opt.merge);
  if (!canWrite(ref.path, store.get(ref.path), next)) throw denied('write ' + ref.path);
  if (W.__quota){ const e = new Error('Quota exceeded.'); e.code = 'resource-exhausted'; throw e; }
  applySet(ref.path, data, opt && opt.merge); note('write', 'set ' + ref.path, 1, wcost(col)); }
function doDelete(ref){ const col = ref.path.split('/')[0]; if (!canWrite(ref.path, store.get(ref.path), null)) throw denied('delete ' + ref.path); applyDel(ref.path); note('delete', 'delete ' + ref.path, 1, wcost(col)); }
const queued = (ref, data, opt, del) => new Promise((res, rej) => { NET.queue.push({ref, data, opt, del, res, rej}); note('offline', (del ? 'delete' : 'set') + ' waiting for a connection ' + ref.path, 0, 0); });
export async function setDoc(ref, data, opt){ if (NET.off) return queued(ref, data, opt, false); try { doSet(ref, data, opt); } catch(e){ await later(); throw e; } await later(6); }
export async function deleteDoc(ref){ if (NET.off) return queued(ref, null, null, true); try { doDelete(ref); } catch(e){ await later(); throw e; } await later(6); }
export async function runTransaction(fs, fn){ if (NET.off){ await later(OFFD()); if (NET.off) throw offErr('transaction'); } await later(); const writes = [];
  const tx = { async get(ref){ const a = allow(ref.path, false); if (!a.ok) throw denied('tx get ' + ref.path); note('read', 'tx get ' + ref.path, 1, a.cost); return dsnap(ref, store.get(ref.path)); },
    set(ref, data, opt){ writes.push([ref, data, opt]); return tx; }, update(ref, data){ writes.push([ref, data, {merge:true}]); return tx; }, delete(ref){ writes.push([ref, null]); return tx; } };
  const out = await fn(tx);
  for (const [ref, data, opt] of writes){ const col = ref.path.split('/')[0], next = data === null ? null : merged(ref.path, data, opt && opt.merge);
    if (!canWrite(ref.path, store.get(ref.path), next)) throw denied('tx write ' + ref.path); if (W.__quota){ const e = new Error('Quota exceeded.'); e.code = 'resource-exhausted'; throw e; }
    if (data === null){ applyDel(ref.path); note('delete', 'tx delete ' + ref.path, 1, wcost(col)); } else { applySet(ref.path, data, opt && opt.merge); note('write', 'tx set ' + ref.path, 1, wcost(col)); } }
  await later(6); return out; }
