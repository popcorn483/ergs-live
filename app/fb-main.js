// ERGS Rugby on GitHub: connects the app's data layer to Firebase, with the same coach logins as ERGS Live.
// The app asks for "db", "user", "assets" and "downloads"; this module answers with Firebase-backed versions.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, doc, getDoc, setDoc, deleteDoc, onSnapshot, collection, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const CFG = window.ERGS_CONFIG || {};
const app = initializeApp(CFG.firebase), fs = getFirestore(app), auth = getAuth(app);
const ADMIN = String(CFG.admin || '').toLowerCase();
const LIVE = doc(fs, 'live', 'state');
const enc = d => ({j: JSON.stringify(d === undefined ? null : d), u: Date.now()});
const dec = s => { if (!s.exists()) return null; const v = s.data(); if (typeof v.j === 'string'){ try { return JSON.parse(v.j); } catch(e){ return null; } } return v; };
const err = e => { const c = String(e && e.code || ''); const x = new Error(e && e.message || c); x.code = /permission/.test(c) ? 'not_granted' : /unavailable|network/.test(c) ? 'unavailable' : /resource-exhausted/.test(c) ? 'quota_exceeded' : 'invalid_argument'; return x; };

let USER = null, EMAIL = '', ROLE = 'public', PLAYER = null, COACH = null;   // COACH: this coach's record (name, scope: admin / all / a squad)   // PLAYER: this player's access (team, what they can see)
const authReady = new Promise(res => { let first = true; onAuthStateChanged(auth, async u => {
  USER = u; EMAIL = u && u.email ? u.email.toLowerCase() : ''; ROLE = 'public';
  if (EMAIL){
    if (EMAIL === ADMIN) ROLE = 'coach';
    // C2k accounts: @c2ken.net and @c2kni.net are the same person, so a login added under either address works for both
    const twin = /@c2ken\.net$/.test(EMAIL) ? EMAIL.replace(/@c2ken\.net$/, '@c2kni.net') : /@c2kni\.net$/.test(EMAIL) ? EMAIL.replace(/@c2kni\.net$/, '@c2ken.net') : '';
    const look = async col => { for (const e of [EMAIL, twin].filter(Boolean)){ try { const s = await getDoc(doc(fs, col, e)); if (s.exists()){ EMAIL = e; return s.data() || {}; } } catch(err){} } return null; };
    if (ROLE !== 'coach'){ const c = await look('coaches'); if (c){ ROLE = 'coach'; COACH = c; } }
    if (ROLE !== 'coach'){ const p = await look('players'); if (p){ ROLE = 'player'; PLAYER = p; } }
  }
  // not on a list yet: leave a request so the coaches see them waiting (needs the requests rule in Firebase)
  if (EMAIL && ROLE === 'public'){ try { await setDoc(doc(fs, 'requests', EMAIL), {name:(USER.displayName || '').slice(0, 100), photo:(USER.photoURL || '').slice(0, 500), at:Date.now()}); } catch(e){} }
  if (first){ first = false; res(); } else location.reload();
}); });
getRedirectResult(auth).catch(() => {});

/* live/state holds ERGS Live's matches and school crests; the app sees them as "matches" and "schools" collections */
let liveCache = null; const liveSubs = new Set();
let liveUnsub = null;
function liveListen(){ if (liveUnsub) return; liveUnsub = onSnapshot(LIVE, s => { liveCache = decState(s) || {matches:[], schools:{}}; liveSubs.forEach(f => f()); }, e => liveSubs.forEach(f => f(e)));
  // VEO and photo links are private (team/veo): coaches and players see them merged into the matches
  authReady.then(() => { if (ROLE !== 'coach' && ROLE !== 'player') return; onSnapshot(doc(fs, 'team', 'veo'), s => { const v = dec(s) || {}; MEDIA = {byMatch:v.byMatch || {}, photos:v.photos || {}}; if (liveCache) liveSubs.forEach(f => f()); }, () => {}); }); }
let MEDIA = {byMatch:{}, photos:{}};
async function setMedia(id, veo, photos){
  const r = doc(fs, 'team', 'veo');
  await runTransaction(fs, async tx => { const s = await tx.get(r); const v = dec(s) || {}; v.byMatch = v.byMatch || {}; v.photos = v.photos || {};
    if (veo) v.byMatch[id] = veo; else delete v.byMatch[id];
    if (photos) v.photos[id] = photos; else delete v.photos[id];
    v.updated = Date.now(); tx.set(r, enc(v)); }); }
async function liveTx(fn){ try { await runTransaction(fs, async tx => { const s = await tx.get(LIVE); const cur = decLive(s) || {matches:[], schools:{}, demo:false}; cur.matches = cur.matches || []; cur.schools = cur.schools || {}; fn(cur); cur.updated = Date.now(); tx.set(LIVE, {json:JSON.stringify(cur), updated:cur.updated}); }); } catch(e){ throw err(e); } }
const decLive = s => { if (!s.exists()) return null; const v = s.data(); try { return JSON.parse(v.json); } catch(e){ return null; } };
// live/state uses the field "json" (ERGS Live's format)
function decState(s){ return decLive(s); }

function virtualDocs(name){
  const st = liveCache || {matches:[], schools:{}};
  if (name === 'matches') return (st.matches || []).map(m => { const d = Object.assign({}, m); const id = d.id; delete d.id; d.veo = MEDIA.byMatch[id] || d.veo || ''; d.photos = MEDIA.photos[id] || d.photos || ''; return {id, d}; });
  if (name === 'schools') return Object.entries(st.schools || {}).map(([id, v]) => ({id, d:v}));
  return [];
}
const snapOf = (id, data) => ({id, exists: data !== null && data !== undefined, data: () => data === null || data === undefined ? undefined : JSON.parse(JSON.stringify(data))});

function makeDoc(path){
  const [col, id] = path.split('/');
  const virt = col === 'matches' || col === 'schools';
  return {
    id, path,
    async get(){
      if (path === 'team/access') return snapOf('access', ROLE === 'coach' || ROLE === 'player' ? {ok:true} : null);
      if (virt){ const s = await getDoc(LIVE).catch(e => { throw err(e); }); liveCache = decState(s) || {matches:[], schools:{}}; const x = virtualDocs(col).find(v => v.id === id); return snapOf(id, x ? x.d : null); }
      try { return snapOf(id, dec(await getDoc(doc(fs, col, id)))); } catch(e){ throw err(e); }
    },
    async set(data){
      data = JSON.parse(JSON.stringify(data));
      if (col === 'matches'){ const veo = data.veo || '', ph = data.photos || ''; delete data.veo; delete data.photos;
        if (veo !== (MEDIA.byMatch[id] || '') || ph !== (MEDIA.photos[id] || '')){ try { await setMedia(id, veo, ph); } catch(e){ throw err(e); } } }
      if (col === 'matches') return liveTx(st => { const i = st.matches.findIndex(m => m.id === id), m = Object.assign({}, data, {id}); if (i >= 0) st.matches[i] = m; else st.matches.push(m); });
      if (col === 'schools') return liveTx(st => { st.schools[id] = data; });
      if (col === 'members') data = Object.assign({}, data, {name:USER && USER.displayName || '', email:EMAIL, photo:USER && USER.photoURL || ''});
      try { await setDoc(doc(fs, col, id), enc(data)); } catch(e){ throw err(e); }
    },
    async delete(){
      if (col === 'matches') return liveTx(st => { st.matches = st.matches.filter(m => m.id !== id); });
      if (col === 'schools') return liveTx(st => { delete st.schools[id]; });
      try { await deleteDoc(doc(fs, col, id)); } catch(e){ throw err(e); }
    },
    onSnapshot(cb, onErr){
      if (path === 'team/access'){ setTimeout(() => cb(snapOf('access', ROLE === 'coach' || ROLE === 'player' ? {ok:true} : null)), 0); return () => {}; }
      if (virt){ liveListen(); const f = e => { if (e) return onErr && onErr(err(e)); const x = virtualDocs(col).find(v => v.id === id); cb(snapOf(id, x ? x.d : null)); }; liveSubs.add(f); if (liveCache) f(); return () => liveSubs.delete(f); }
      return onSnapshot(doc(fs, col, id), s => cb(snapOf(id, dec(s))), e => onErr && onErr(err(e)));
    }
  };
}
function makeQuery(name, opts){
  const q = {
    orderBy(field, dir){ return makeQuery(name, Object.assign({}, opts, {field, dir})); },
    limit(n){ return makeQuery(name, Object.assign({}, opts, {n})); },
    where(){ return q; },
    doc(id){ return makeDoc(name + '/' + id); },
    onSnapshot(cb, onErr){
      const out = list => { if (opts.field){ const k = opts.field, s = opts.dir === 'desc' ? -1 : 1; list.sort((a, b) => ((a.d[k] || 0) > (b.d[k] || 0) ? 1 : (a.d[k] || 0) < (b.d[k] || 0) ? -1 : 0)*s); }
        if (opts.n) list = list.slice(0, opts.n); cb({docs:list.map(x => snapOf(x.id, x.d)), size:list.length}); };
      if (name === 'matches' || name === 'schools'){ liveListen(); const f = e => { if (e) return onErr && onErr(err(e)); out(virtualDocs(name)); }; liveSubs.add(f); if (liveCache) f(); return () => liveSubs.delete(f); }
      return onSnapshot(collection(fs, name), s => out(s.docs.map(d => ({id:d.id, d:dec(d)})).filter(x => x.d)), e => onErr && onErr(err(e)));
    }
  };
  return q;
}
const DB = {doc:makeDoc, collection:name => makeQuery(name, {})};

/* images: stored in Firestore, referenced as "fsimg:<id>" */
const IMGC = new Map();
window.__fsimg = src => { const id = String(src).slice(6); if (!IMGC.has(id)) IMGC.set(id, getDoc(doc(fs, 'images', id)).then(s => { const v = s.exists() ? s.data() : null; if (!v || !v.d) throw new Error('missing'); return v.d; })); return IMGC.get(id); };
const toDataURL = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
async function shrinkBlob(blob){
  if (blob.size < 700000 || !/^image\//.test(blob.type)) return blob;
  const url = URL.createObjectURL(blob), im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  let s = Math.min(1, 1400/Math.max(im.naturalWidth, im.naturalHeight)), out = blob;
  for (let k = 0; k < 5 && out.size >= 700000; k++){ const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth*s); c.height = Math.round(im.naturalHeight*s); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    out = await new Promise(r => c.toBlob(r, blob.type === 'image/png' ? 'image/webp' : 'image/jpeg', 0.85)); s *= 0.75; }
  URL.revokeObjectURL(url); return out;
}
const ASSETS = {
  async upload(blob){ const b = await shrinkBlob(blob); const d = await toDataURL(b); const id = Math.random().toString(16).slice(2) + Date.now().toString(16);
    try { await setDoc(doc(fs, 'images', id), {d, t:b.type, u:Date.now()}); } catch(e){ throw err(e); }
    IMGC.set(id, Promise.resolve(d)); return {id, url:'fsimg:' + id, sizeBytes:b.size, contentType:b.type}; },
  async list(){ return {assets:[], usage:{}}; },
  async delete(id){ try { await deleteDoc(doc(fs, 'images', String(id).replace(/^fsimg:/, ''))); } catch(e){} }
};
/* <img src="fsimg:…"> anywhere on the page gets swapped for the stored picture */
function fixImg(el){ const s = el.getAttribute('src'); if (!s || !s.startsWith('fsimg:')) return; el.removeAttribute('src'); window.__fsimg(s).then(d => { el.src = d; }).catch(() => {}); }
new MutationObserver(ms => ms.forEach(m => { if (m.type === 'attributes') fixImg(m.target); else m.addedNodes.forEach(n => { if (n.nodeType !== 1) return; if (n.tagName === 'IMG') fixImg(n); n.querySelectorAll && n.querySelectorAll('img[src^="fsimg:"]').forEach(fixImg); }); }))
  .observe(document.documentElement, {subtree:true, childList:true, attributes:true, attributeFilter:['src']});

let membersCache = {};
const USERAPI = {
  async canEdit(){ return ROLE === 'coach'; },
  async isOwner(){ return EMAIL === ADMIN; },
  async can(){ return ROLE === 'coach'; },
  async id(){ return USER ? USER.uid : null; },
  async me(){ return {id:USER ? USER.uid : '', name:USER && USER.displayName || EMAIL, avatarUrl:USER && USER.photoURL || ''}; },
  async profiles(ids){ const out = {}; for (const id of ids || []){ if (!membersCache[id]){ try { membersCache[id] = dec(await getDoc(doc(fs, 'members', id))) || {}; } catch(e){ membersCache[id] = {}; } } const m = membersCache[id]; out[id] = {name:m.name || m.email || '', avatarUrl:m.photo || '', email:m.email || ''}; } return out; },
  async search(){ return []; }
};
const DOWNLOADS = { async save({filename, data}){ const a = document.createElement('a'); a.href = URL.createObjectURL(data); a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); } };

window.ERGS_AUTH = {
  get email(){ return EMAIL; }, get role(){ return ROLE; }, get player(){ return PLAYER; }, get coach(){ return EMAIL === ADMIN ? Object.assign({}, COACH || {}, {scope:'admin'}) : COACH; },
  async listFull(kind){ const out = []; await new Promise((res, rej) => { const u = onSnapshot(collection(fs, kind), s => { s.docs.forEach(d => out.push(Object.assign({id:d.id}, d.data()))); u(); res(); }, e => { rej(err(e)); }); }); return out.sort((a, b) => a.id.localeCompare(b.id)); },
  async setAccess(kind, email, data){ try { await setDoc(doc(fs, kind, email.toLowerCase()), data, {merge:true}); } catch(e){ throw err(e); } }, get admin(){ return EMAIL && EMAIL === ADMIN; }, adminEmail:ADMIN,
  async signIn(){ const p = new GoogleAuthProvider(); p.setCustomParameters({prompt:'select_account'}); try { await signInWithPopup(auth, p); } catch(e){ if (/popup-blocked|operation-not-supported/.test(e.code || '')) await signInWithRedirect(auth, p); else throw e; } },
  signOut(){ return signOut(auth); },
  async getOne(kind, id){ try { const s = await getDoc(doc(fs, kind, String(id).toLowerCase())); return s.exists() ? Object.assign({id:s.id}, s.data()) : null; } catch(e){ throw err(e); } },
  async list(kind){ const out = []; await new Promise((res, rej) => { const u = onSnapshot(collection(fs, kind), s => { s.docs.forEach(d => out.push(d.id)); u(); res(); }, e => { rej(err(e)); }); }); return out.sort(); },
  async add(kind, email){ try { await setDoc(doc(fs, kind, email.toLowerCase()), {added:Date.now(), by:EMAIL}); } catch(e){ throw err(e); } },
  async remove(kind, email){ try { await deleteDoc(doc(fs, kind, email.toLowerCase())); } catch(e){ throw err(e); } },
  raw:{fs, doc, setDoc, getDoc, enc}
};
window.__fbResolve({
  async use(name){
    await authReady;
    if (name === 'db') return USER ? DB : null;
    if (name === 'user') return USER ? USERAPI : null;
    if (name === 'assets') return ROLE === 'coach' ? ASSETS : null;
    if (name === 'downloads') return DOWNLOADS;
    return null;   // "sample" (reading photos with Claude) isn't available off Claude
  }
});
