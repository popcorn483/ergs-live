// test double for fb-main.js: in-memory store, signed in as the admin
const ADMIN = 'ergsrugby@gmail.com';
const now = Date.now();
const store = {};
const TEAM = {
  maint: {reqClear1:1}, roster: {players:[{id:'r1', f:'Sam', l:'Smith', t:'U14'}, {id:'r2', f:'Ben', l:'Jones', t:'U14'}, {id:'r3', f:'Amy', l:'Boyd', t:'SG'}, {id:'r4', f:'Tom', l:'Roster', t:'U14'}], tabs:['U14', 'SG']},
};
const cols = {
  team: TEAM,
  players: {'sam@example.com': {name:'Sam Smith', team:'U14', rid:'r1', added:now - 9e6}, 'loose@example.com': {name:'Zed Loose', team:'U13'}},
  coaches: {'kelly@example.com': {name:'Coach Kelly', scope:'U14'}},
  requests: {'mum@example.com': {kind:'guardian', name:'Mary Roster', child:'Tom Roster', squad:'U14', sent:now - 6e5, at:now - 6e5}, 'ben.j@example.com': {name:'Ben Jones', squad:'U14', pos:'9', sent:now - 6e5, at:now - 6e5}, 'fan@example.com': {name:'A Fan', kind:'supporter', at:now - 3e7}},
  members: {u1: {email:'sam@example.com', name:'Sam Smith', seen:now - 3e5}, u9: {email:'gone@example.com', name:'Gone Person', seen:now - 9e8}, u0: {email:ADMIN, name:'ERGS', seen:now}},
  headshots: {},
  matches: (() => { const d = new Date(), iso = (dd, t) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dd); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0') + 'T' + t; };
    const E = 'Enniskillen Royal Grammar School';
    return {a1:{team:'1XV', home:E, away:'Portora Royal School', us:'H', ko:iso(0, '10:30'), status:'FT', final:[24, 12], comp:'Schools Cup', venue:'Eisenhower Playing Fields', created:1},
      a2:{team:'U14', home:'Omagh Academy', away:E, us:'A', ko:iso(0, '11:00'), status:'FT', final:[17, 17], comp:'Friendly', created:2},
      a3:{team:'Senior Girls', home:E, away:'Dalriada', us:'H', ko:iso(0, '12:00'), status:'FT', final:[5, 19], created:3},
      a4:{team:'U12', home:E, away:'Royal School Dungannon', us:'H', ko:iso(0, '13:00'), status:'2H', final:[10, 7], created:4},
      a6:{team:'U13', home:E, away:'Belfast Royal Academy', us:'H', ko:iso(0, '09:00'), status:'pre', created:6, events:[]},
      a8:{team:'1XV', home:'Coleraine Grammar School', away:E, us:'A', ko:iso(-1, '14:00'), status:'FT', final:[17, 15], finalSet:true, created:8}, a9:{team:'U14', home:E, away:'Royal School Dungannon', us:'H', ko:iso(-3, '14:00'), koTbc:true, status:'pre', created:9}, a5:{team:'2XV', home:'Campbell College', away:E, us:'A', ko:iso(1, '14:00'), status:'FT', final:[12, 31], created:5}}; })(),
  piq: (() => { const d = new Date(), t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())), day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y = t.getUTCFullYear(), w = y + '-W' + String(Math.ceil(((t - Date.UTC(y, 0, 1))/864e5 + 1)/7)).padStart(2, '0');
    return {'sam@example.com':{name:'Sam Smith', team:'U14', week:w, best:2400, wk:2100, sd:9, sdWk:7, games:4}, 'ben@example.com':{name:'Ben Jones', team:'U14', week:w, best:1800, wk:1800, sd:4, sdWk:4, games:2},
      'amy@example.com':{name:'Amy Boyd', team:'SG', week:w, best:2600, wk:2600, sd:12, sdWk:12, games:5}, 'old@example.com':{name:'Old Timer', team:'MEDS', week:'2026-W30', best:3100, wk:3100, sd:20, sdWk:20, games:9}}; })(),
};
window.__store = {store, cols};
const subs = new Set(); const emit = () => subs.forEach(f => f());
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const snapOf = (id, data) => ({id, exists: data != null, data: () => clone(data)});
const get = path => { const [c, id] = path.split('/'); return (cols[c] || {})[id]; };
const put = (path, d) => { const [c, id] = path.split('/'); (cols[c] = cols[c] || {})[id] = d; emit(); };
const del = path => { const [c, id] = path.split('/'); if (cols[c]) delete cols[c][id]; emit(); };
const makeDoc = path => ({ id:path.split('/')[1], path,
  async get(){ if (path === 'team/access') return snapOf('access', {ok:true}); return snapOf(path.split('/')[1], get(path)); },
  async set(d){ put(path, clone(d)); }, async delete(){ del(path); },
  onSnapshot(cb){ const f = () => cb(snapOf(path.split('/')[1], path === 'team/access' ? {ok:true} : get(path))); subs.add(f); setTimeout(f, 0); return () => subs.delete(f); } });
const makeQuery = name => { const q = { orderBy(){ return q; }, limit(){ return q; }, where(){ return q; }, doc(id){ return makeDoc(name + '/' + id); },
  onSnapshot(cb){ const f = () => { const c = cols[name] || {}; const docs = Object.entries(c).map(([id, d]) => snapOf(id, d)); cb({docs, size:docs.length}); }; subs.add(f); setTimeout(f, 0); return () => subs.delete(f); } }; return q; };
const DB = {doc:makeDoc, collection:makeQuery};
const listFull = async k => Object.entries(cols[k] || {}).map(([id, d]) => Object.assign({id}, clone(d))).sort((a, b) => a.id.localeCompare(b.id));
cols.phtags = {'sam@example.com': {p:{I1:{t:1}, I2:{t:2}, I3:{t:3}, I4:{t:4}, I5:{t:5}}, name:'Sam Smith', at:1}};
cols.matches = Object.assign(cols.matches || {}, {mNoLive:{home:'Enniskillen Royal Grammar School', away:'Omagh Academy', us:'H', team:'U14', ko:new Date(Date.now() - 3*864e5).toISOString().slice(0, 16), status:'FT', final:[24, 10], events:[], created:9}});
cols.pstats = {'sam@example.com': {name:'Sam Smith', team:'U14', at:5, g:{mNoLive:{p:1, st:'s', pos:'7', c:{}, n:'', at:5, sc:{try:2, con:1}, scAt:5}}}};
window.ERGS_AUTH = {
  watchDoc(kind, id, cb){ const f = () => cb(clone((cols[kind] || {})[String(id).toLowerCase()]) || null); subs.add(f); setTimeout(f, 0); return () => subs.delete(f); },
  watch(kind, cb, ms, err){ const f = () => cb(Object.entries(cols[kind] || {}).map(([id, d]) => Object.assign({id}, clone(d)))); subs.add(f); setTimeout(f, 0); return () => subs.delete(f); },
  email:ADMIN, accessErr:'', role:'coach', player:null, coach:{scope:'admin'}, admin:true, adminEmail:ADMIN,
  listFull: async k => (await listFull(k)).filter(d => k !== 'players' || !d.aliasOf), async aliases(){ return (await listFull('players')).filter(d => d.aliasOf); }, async list(k){ return (await listFull(k)).map(x => x.id); },
  async setAccess(kind, email, data){ cols[kind] = cols[kind] || {}; cols[kind][email.toLowerCase()] = Object.assign({}, cols[kind][email.toLowerCase()] || {}, clone(data)); emit(); },
  async getOne(kind, id){ const d = (cols[kind] || {})[String(id).toLowerCase()]; return d ? Object.assign({id}, clone(d)) : null; },
  async add(kind, email){ cols[kind][email] = {added:Date.now()}; emit(); },
  async remove(kind, email){ (window.__rm = window.__rm || []).push(kind + ':' + email + ' ' + new Error().stack.split('\n').slice(2, 4).join(' / ')); delete (cols[kind] || {})[email.toLowerCase()]; emit(); },
  async removeDoc(kind, id){ delete (cols[kind] || {})[id]; emit(); },
  async signIn(){}, signOut(){},
  raw:{fs:{}, doc:(fs, k, id) => ({k, id}), async setDoc(r, data, o){ cols[r.k][r.id] = Object.assign({}, o && o.merge ? cols[r.k][r.id] || {} : {}, clone(data)); emit(); }, async getDoc(){}, enc:x => x}
};
const USERAPI = { async canEdit(){ return true; }, async isOwner(){ return true; }, async can(){ return true; }, async id(){ return 'u0'; }, async me(){ return {id:'u0', name:'ERGS', avatarUrl:''}; }, async profiles(){ return {}; }, async search(){ return []; } };
window.__fbResolve({ async use(n){ if (n === 'db') return DB; if (n === 'user') return USERAPI; if (n === 'downloads') return null; return null; } });
