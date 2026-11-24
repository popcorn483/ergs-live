// ERGS Rugby on GitHub: connects the app's data layer to Firebase, with the same coach logins as ERGS Live.
// The app asks for "db", "user", "assets" and "downloads"; this module answers with Firebase-backed versions.
import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, doc, getDoc, getDocs, getAggregateFromServer, count, sum, where, documentId, setDoc, deleteDoc, deleteField, onSnapshot, collection, runTransaction, query, orderBy, limit } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, updatePassword, EmailAuthProvider, linkWithCredential } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const CFG = window.ERGS_CONFIG || {};
const app = initializeApp(CFG.firebase), fs = getFirestore(app), auth = getAuth(app);
const ADMIN = String(CFG.admin || '').toLowerCase();
const LIVE = doc(fs, 'live', 'state');
/* sign in with an email link: for school (C2k) accounts that can't use Google sign-in for outside apps.
   They type their email, get a link in that inbox, and opening it signs them in here (no Google sign-in involved). */
const LINK_KEY = 'ergs.linkEmail';
let LINK_ERR = '';
const linkDone = (async () => {
  const href = location.href; if (!isSignInWithEmailLink(auth, href)) return;
  let email = ''; try { email = localStorage.getItem(LINK_KEY) || ''; } catch(e){}
  // an invite a coach sent carries the address (le=), so opening it on any phone or computer signs straight in
  if (!email){ try { const u = new URL(href), inner = u.searchParams.get('continueUrl'); email = u.searchParams.get('le') || (inner ? new URL(inner).searchParams.get('le') : '') || ''; } catch(e){} }
  // opened on a different device or browser from the one that asked: confirm the address
  if (!email) email = (window.prompt('Confirm your email address to finish signing in') || '').trim();
  // tidy the address bar first, so the reload after signing in doesn't reuse the link
  try { const u = new URL(href); ['apiKey', 'oobCode', 'mode', 'continueUrl', 'lang', 'tenantId', 'le', 'inv'].forEach(k => u.searchParams.delete(k)); history.replaceState(null, '', u.pathname + u.search + u.hash); } catch(e){}
  if (!email) { LINK_ERR = 'Sign-in wasn’t finished: no email address was given. Ask for a new link.'; return; }
  try { await signInWithEmailLink(auth, email.toLowerCase(), href); try { localStorage.removeItem(LINK_KEY); sessionStorage.setItem('ergs.askPw', '1'); } catch(e){} }
  catch(e){ const c = String(e && e.code || ''); LINK_ERR = /invalid-action-code|expired/.test(c) ? 'That sign-in link has expired or was already used. Ask for a new one.' : /invalid-email/.test(c) ? 'That email address doesn’t match the one the link was sent to. Ask for a new link.' : 'Signing in with the link didn’t work. Ask for a new one.'; }
})();
async function sendLink(email, back, invite){
  email = String(email || '').trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ const x = new Error('Enter your full email address.'); x.code = 'auth/invalid-email'; throw x; }
  let url = back || (location.origin + location.pathname);
  if (invite) url += (url.includes('?') ? '&' : '?') + 'inv=1&le=' + encodeURIComponent(email);   // a coach inviting someone: the link carries their address, and nothing is stored on the coach's device
  await sendSignInLinkToEmail(auth, email, {url, handleCodeInApp:true});
  if (!invite){ try { localStorage.setItem(LINK_KEY, email); } catch(e){} }
  return email;
}
const linkMsg = e => { const c = String(e && e.code || ''); return /operation-not-allowed|admin-restricted/.test(c) ? 'Email-link sign-in isn’t switched on yet. A coach needs to turn it on in Firebase (Authentication › Sign-in method › Email/Password › Email link).'
  : /invalid-email/.test(c) ? 'Enter your full email address.' : /quota|too-many/.test(c) ? 'Today’s sign-in emails have run out: the app’s free Firebase plan can only send 5 a day for everyone. If this is a Gmail or other Google account, use Sign in with Google instead. Otherwise try again tomorrow.' : /unauthorized-continue-uri|unauthorized-domain/.test(c) ? 'This site isn’t on Firebase’s authorised domains list yet. A coach needs to add it in Firebase › Authentication › Settings.' : 'The link couldn’t be sent. Check your connection and try again.'; };

/* C2k password sign-in (decision of 18 November 2026): a player whose C2k address is already on a player profile types it,
   sets a password the first time, and is straight in; after that it's the address and that password. No email is needed.
   Only for player profiles: an unproved password account never gets coach access (here or in the Firebase rules), and one
   whose address isn't on a player profile is removed again at once. "Forgot password" sends a reset email to their inbox,
   which also gives the address back to its owner if someone else set a password on it first. */
const C2K = e => /@c2k(en|ni)\.net$/i.test(String(e || ''));
// (an account that also has Google on it belongs to whoever owns the address: Firebase doesn't always mark those verified)
const pwOnly = u => !!u && !u.emailVerified && (u.providerData || []).some(p => p.providerId === 'password') && !(u.providerData || []).some(p => p.providerId === 'google.com');   // signed in with a password nobody has proved
let PW_HOLD = false;   // creating an account: hold the reload until the profile check has been made
const PW_ERR = (c, x) => { const e = new Error(x || c); e.code = c; return e; };
async function pwProfile(email){
  const twin = /@c2ken\.net$/.test(email) ? email.replace(/@c2ken\.net$/, '@c2kni.net') : email.replace(/@c2kni\.net$/, '@c2ken.net');
  for (const e of [email, twin]){ try { if ((await getDoc(doc(fs, 'players', e))).exists()) return true; } catch(x){ const c = String(x && x.code || x); if (!/permission/.test(c)) throw PW_ERR('check-failed'); } }
  return false; }
async function pwIn(email, pw, confirm){
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw PW_ERR('auth/invalid-email');
  if (!C2K(email)) throw PW_ERR('not-c2k');
  if (String(pw || '').length < 6) throw PW_ERR('auth/weak-password');
  if (!confirm){
    try { await signInWithEmailAndPassword(auth, email, pw); return 'in'; }
    catch(e){ const c = String(e && e.code || ''); if (/invalid-credential|user-not-found|wrong-password|invalid-login/.test(c)) throw PW_ERR('pw-unknown'); throw e; } }
  if (confirm !== pw) throw PW_ERR('pw-mismatch');
  PW_HOLD = true;
  let cred; try { cred = await createUserWithEmailAndPassword(auth, email, pw); }
  catch(e){ PW_HOLD = false; const c = String(e && e.code || ''); if (/email-already-in-use/.test(c)) throw PW_ERR('pw-taken'); throw e; }
  let ok = false, bad = null; try { ok = await pwProfile(email); } catch(e){ bad = e; }
  // not on a player profile (18 November 2026): the account stays, and the app asks for their name and squad and sends that to
  // the coaches, who let them in (the request is marked as coming from an address nobody has proved)
  if (!ok && !bad){ try { localStorage.setItem(LINK_KEY, email); localStorage.setItem('ergs.joinAs', 'player'); localStorage.setItem('ergs.gqIntent', '0'); } catch(e){}
    PW_HOLD = false; location.reload(); return 'ask'; }
  if (!ok){ try { await cred.user.delete(); } catch(e){ try { await signOut(auth); } catch(x){} }
    setTimeout(() => { PW_HOLD = false; }, 800);   // let the signed-out state settle without a reload
    throw bad || PW_ERR('not-on-profile'); }
  try { localStorage.setItem(LINK_KEY, email); } catch(e){}
  PW_HOLD = false; location.reload(); return 'new'; }
/* staff (coaches, parents) with email + password (18 November 2026). There is no first-time password here: a member of staff proves
   their address once with Google or an emailed link, and then sets a password inside the app (pwSet). Firebase removes any
   password nobody had proved when the link or Google sign-in completes, so the only password left on the account is the one they
   chose. Their account is then verified, so the rules give them their usual access with it. */
async function staffIn(email, pw){
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw PW_ERR('auth/invalid-email');
  if (!pw) throw PW_ERR('staff-nopw');
  try { await signInWithEmailAndPassword(auth, email, pw); }
  catch(e){ const c = String(e && e.code || ''); if (/invalid-credential|user-not-found|wrong-password|invalid-login|invalid-password/.test(c)) throw PW_ERR('staff-nopw'); throw e; }
  try { localStorage.setItem(LINK_KEY, email); } catch(e){}
  return 'in'; }
/* a coach sets a player's first password for them (24 November 2026). Only for a school C2k address, the same as a player choosing
   their own. The account is made on a second, throwaway connection, so the coach stays signed in as themselves. */
async function pwMake(email, pw){
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw PW_ERR('auth/invalid-email');
  if (!C2K(email)) throw PW_ERR('not-c2k');
  if (String(pw || '').length < 6) throw PW_ERR('auth/weak-password');
  const app2 = initializeApp(CFG.firebase, 'mk' + Date.now());
  try { const a2 = getAuth(app2); await createUserWithEmailAndPassword(a2, email, pw); try { await signOut(a2); } catch(e){} return 'made'; }
  catch(e){ if (/email-already-in-use/.test(String(e && e.code || ''))) throw PW_ERR('pw-taken'); throw e; }
  finally { try { await deleteApp(app2); } catch(e){} } }
async function pwReset(email){ email = String(email || '').trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw PW_ERR('auth/invalid-email');
  await sendPasswordResetEmail(auth, email, {url:location.origin + location.pathname}); return email; }
async function pwSet(pw){ const u = auth.currentUser; if (!u) throw PW_ERR('signed-out'); if (String(pw || '').length < 6) throw PW_ERR('auth/weak-password');
  // signed in with Google only: add a password to the same account; otherwise change the one it has
  if ((u.providerData || []).some(p => p.providerId === 'password')) await updatePassword(u, pw); else await linkWithCredential(u, EmailAuthProvider.credential(u.email, pw));
  try { localStorage.removeItem('ergs.pwNo'); } catch(e){} try { sessionStorage.removeItem('ergs.askPw'); } catch(e){} }
const pwMsg = e => { const c = String(e && e.code || '');
  return c === 'not-c2k' ? 'Passwords are for school C2k addresses (ending @c2ken.net). For any other email, use Google or a sign-in link.'
    : c === 'pw-unknown' ? 'First time here? Type the same password again below to set it. (Been here before? That password didn’t match.)'
    : c === 'staff-nopw' ? 'That email and password don’t match. Not set a password yet? Sign in once with Google or a sign-in link, and the app lets you choose one. Forgotten it? Tap “Forgot password”.'
    : /requires-recent-login/.test(c) ? 'For safety, sign out, sign back in with Google or a sign-in link, and set the password straight away.'
    : c === 'pw-mismatch' ? 'The two passwords aren’t the same. Type them again.'
    : c === 'pw-taken' ? 'This address already has an account, and that isn’t its password. Never set one, or forgotten it? Tap “Forgot password”.'
    : c === 'not-on-profile' ? 'You can’t sign in yet: this email hasn’t been added to a player profile. Ask a coach to add your C2k email, then try again.'
    : c === 'check-failed' ? 'Your profile couldn’t be checked just now. Check your signal and try again.'
    : /weak-password/.test(c) ? 'Use at least 6 characters for your password.'
    : /invalid-email/.test(c) ? 'Enter your full email address.'
    : /too-many-requests/.test(c) ? 'Too many tries. Wait a few minutes, or tap “Forgot password”.'
    : /operation-not-allowed/.test(c) ? 'Password sign-in isn’t switched on yet. A coach needs to turn on Email/Password in Firebase (Authentication › Sign-in method).'
    : /network/.test(c) ? 'No connection. Check your signal and try again.'
    : /quota|exceeded/.test(c) ? 'Today’s emails from the app have run out. Try again tomorrow.'
    : 'That didn’t work. Try again.'; };

const enc = d => ({j: JSON.stringify(d === undefined ? null : d), u: Date.now()});
const dec = s => { if (!s.exists()) return null; const v = s.data(); if (typeof v.j === 'string'){ try { return JSON.parse(v.j); } catch(e){ return null; } } return v; };
const err = e => { const c = String(e && e.code || ''); const x = new Error(e && e.message || c); x.code = /permission/.test(c) ? 'not_granted' : /unavailable|network/.test(c) ? 'unavailable' : /resource-exhausted/.test(c) ? 'quota_exceeded' : 'invalid_argument'; return x; };
window.__ergsErr = e => err(e);

let ALIAS = '', ALIAS_REL = '', ALIAS_NAME = '';   // signed in with a player's second email (EMAIL is then their main one)
let USER = null, EMAIL = '', ROLE = 'public', PLAYER = null, COACH = null, CO_ALIAS = '', ACCESS_ERR = '';   // ACCESS_ERR: the access check itself was refused (usually old Firebase rules)   // COACH: this coach's record (name, scope: admin / all / a squad)   // PLAYER: this player's access (team, what they can see)
let WAIT_ON = false, REJECTED = false;
// The look-ups at sign-in each get ten seconds (18 November 2026). On a poor connection one of them could go unanswered for a very
// long time, and the app sat on "can't reach its database" with nothing to press. Now the first one that gets no answer ends the
// check, and the person sees "We couldn't check your access" with Try again.
const SLOW_MS = window.__slowMs || 10000;
const slow = p => new Promise((res, rej) => { const t = setTimeout(() => rej({code:'unavailable'}), SLOW_MS); p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); }); });
const authReady = new Promise(res => { let first = true; onAuthStateChanged(auth, async u => {
  if (first){ await linkDone; if ((auth.currentUser || null) !== (u || null)) return; }   // a sign-in link being opened: let it finish, then go with the account it signed in
  USER = u; EMAIL = u && u.email ? u.email.toLowerCase() : ''; ROLE = 'public'; ACCESS_ERR = ''; CO_ALIAS = '';
  if (EMAIL){
    const PWO = pwOnly(u);   // an unproved password sign-in: player profiles only, or a request to become a player (never coach)
    if (EMAIL === ADMIN && !PWO) ROLE = 'coach';
    // C2k accounts: @c2ken.net and @c2kni.net are the same person, so a login added under either address works for both
    const twin = /@c2ken\.net$/.test(EMAIL) ? EMAIL.replace(/@c2ken\.net$/, '@c2kni.net') : /@c2kni\.net$/.test(EMAIL) ? EMAIL.replace(/@c2kni\.net$/, '@c2ken.net') : '';
    const down = () => /unavailable/.test(ACCESS_ERR);   // no answer: don't keep asking
    const look = async col => { for (const e of [EMAIL, twin].filter(Boolean)){ if (down()) break; try { const s = await slow(getDoc(doc(fs, col, e))); if (s.exists()){ EMAIL = e; return s.data() || {}; } } catch(err){ const c = String(err && err.code || err); if (e === EMAIL || !/permission/.test(c)) ACCESS_ERR = c; } } return null; };
    if (ROLE !== 'coach' && !PWO){ let c = await look('coaches');
      // a coach's other email: coaches/<other> just points at their main record, and they are that coach whichever email they use
      if (c && c.aliasOf){ const main = String(c.aliasOf).toLowerCase(); try { const s = await slow(getDoc(doc(fs, 'coaches', main))); if (s.exists() || main === ADMIN){ CO_ALIAS = EMAIL; EMAIL = main; c = s.exists() ? s.data() || {} : {}; } } catch(e){} }
      if (c){ ROLE = 'coach'; COACH = c; } }
    if (ROLE !== 'coach' && !down()){ let p = await look('players');
      // a second sign-in email: players/<second> just points at the player's main record, and they act as that player
      if (p && p.aliasOf){ const main = String(p.aliasOf).toLowerCase(); ALIAS_REL = p.rel === 'guardian' ? 'guardian' : 'self'; ALIAS_NAME = String(p.gname || ''); p = null; try { const s = await slow(getDoc(doc(fs, 'players', main))); if (s.exists()){ ALIAS = EMAIL; EMAIL = main; p = s.data() || {}; } } catch(e){ ACCESS_ERR = String(e && e.code || e); } }
      // a parent signed in before their child, so their email is the main one: a coach marks it (mainRel) and they get the parent's view
      if (p && !ALIAS && p.mainRel === 'guardian'){ ALIAS = EMAIL; ALIAS_REL = 'guardian'; ALIAS_NAME = String(p.gname || ''); }
      if (p){ ROLE = 'player'; PLAYER = p; } }
  }
  if (ROLE !== 'public') ACCESS_ERR = '';
  // not on a list yet: leave a request so the coaches see them waiting (needs the requests rule in Firebase).
  // Not when the check itself didn't get an answer (no connection, or the database's daily allowance is used up): they may well be
  // on a list, and a request would put a coach or player among the people waiting for access.
  if (EMAIL && ROLE === 'public' && (!pwOnly(u) || C2K(EMAIL)) && (!ACCESS_ERR || /permission/.test(ACCESS_ERR))){ try { let had = null; let hadErr = false; try { const r0 = await slow(getDoc(doc(fs, 'requests', EMAIL))); had = r0.exists() ? r0.data() : null; } catch(x){ hadErr = /unavailable/.test(String(x && x.code || '')); }   // keep the name, squad and position they told us
    REJECTED = !!(had && had.rejected);   // a coach rejected this request: it isn't sent again (the rules refuse it too)
    // (not waited for: a write is only confirmed when the server answers, and with no signal that held up the whole app)
    if (!REJECTED && !hadErr) setDoc(doc(fs, 'requests', EMAIL), Object.assign({photo:(USER.photoURL || '').slice(0, 500), at:Date.now()}, pwOnly(u) ? {pw:true} : {}, had && had.sent ? {} : {name:(USER.displayName || '').slice(0, 100)}), {merge:true}).catch(() => {}); } catch(e){} }
  if (ROLE === 'public' && !ACCESS_ERR) wipeCache();   // nothing of the team's is kept on a device whose owner has no access (any more); not when the check simply failed
  // waiting for a coach to let them in: watch their own place on the two lists, and the moment they are added the app opens
  // for them by itself (no refreshing). Two small listeners, only while they wait.
  if (EMAIL && ROLE === 'public' && !WAIT_ON && (!pwOnly(u) || C2K(EMAIL))){ WAIT_ON = true; const me = EMAIL, tw = /@c2ken\.net$/.test(me) ? me.replace(/@c2ken\.net$/, '@c2kni.net') : /@c2kni\.net$/.test(me) ? me.replace(/@c2kni\.net$/, '@c2ken.net') : '';
    const inNow = kind => { try { const t = +sessionStorage.getItem('ergs.justInAt') || 0; if (Date.now() - t < 60000) return; sessionStorage.setItem('ergs.justInAt', Date.now()); sessionStorage.setItem('ergs.justIn', kind); } catch(e){} location.reload(); };
    setTimeout(() => { for (const e of [me, tw].filter(Boolean)) for (const kind of ['coaches', 'players']){ try { onSnapshot(doc(fs, kind, e), s => { if (s.exists() && auth.currentUser && (auth.currentUser.email || '').toLowerCase() === me) inNow(kind); }, () => {}); } catch(x){} } }, 1500); }
  if (first){ first = false; res(); } else if (!PW_HOLD) location.reload();
}); });
getRedirectResult(auth).catch(() => {});

/* =============================== READING LESS, AND NEVER GUESSING ===============================
   Firestore's free plan allows 50,000 document reads a day, and every listener and look-up is charged, plus the documents its
   security rules check on each request. So this layer keeps reads down without the app having to think about it:
   - team/* documents are listened to together (one query for up to 30) instead of one listener, and one rules check, each;
   - each access list (players, coaches, requests, headshots…) has ONE shared live copy: the first use reads it, every later
     listFull / listRaw / list / aliases / getOne is answered from it, and it is always current;
   - collections with a document per person (likes, photo tags, match records, read receipts) and Team news are kept on the
     device (IndexedDB), and only documents written since the last look are fetched.
   And it never passes on a guess. When the database can't be reached, Firestore answers from what the device holds, which for a
   page that has just opened is nothing: every document "doesn't exist" and every list is "empty". The app would take that for
   the truth, show empty screens, and could then save over the real thing. So nothing is handed to the app until the server
   itself has answered (listen, fresh). */
const cp = v => Array.isArray(v) ? v.map(cp) : v && typeof v === 'object' ? (typeof v.toMillis === 'function' ? v : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cp(x)]))) : v;   // a copy that shares strings (photos are big), so callers can change what they get
// a look-up answered from the device and not the server is refused (with no connection Firestore answers a query with an empty list)
const fresh = s => { if (s && s.metadata && s.metadata.fromCache){ const e = new Error('The database could not be reached.'); e.code = 'unavailable'; throw e; } return s; };
// a listener: nothing is passed on until the server has answered once; after that every real change is, and news that is only
// about the connection, or about a save being confirmed, is not
function listen(ref, next, error){ let synced = false, last;
  return onSnapshot(ref, {includeMetadataChanges:true}, s => { const list = typeof s.docChanges === 'function';
    if (!synced){ if (s.metadata && s.metadata.fromCache) return; synced = true; if (!list) last = s.exists() ? JSON.stringify(s.data()) : null; }
    else if (list){ if (!s.docChanges().length) return; }
    else { const k = s.exists() ? JSON.stringify(s.data()) : null; if (k === last) return; last = k; }
    next(s); }, error); }

/* ---------- team/* together ---------- */
const TB = {want:new Map(), pending:[], t:0};
function teamListen(id, cb, onErr){
  let w = TB.want.get(id); const reg = {cb, onErr};
  if (!w){ w = {regs:new Set(), seen:false, data:null}; TB.want.set(id, w); TB.pending.push(id); clearTimeout(TB.t); TB.t = setTimeout(teamFlush, 20); }
  w.regs.add(reg);
  if (w.seen) setTimeout(() => { if (w.regs.has(reg)) cb(w.data); }, 0);   // already known: answer straight away
  return () => { w.regs.delete(reg); };
}
function teamFlush(){ const ids = TB.pending.splice(0);
  const tell = (id, data) => { const w = TB.want.get(id); if (!w) return; w.seen = true; w.data = data; w.regs.forEach(r => { try { r.cb(data); } catch(e){ console.error(e); } }); };
  for (let i = 0; i < ids.length; i += 30){ const part = ids.slice(i, i + 30); let first = true;
    listen(query(collection(fs, 'team'), where(documentId(), 'in', part)), s => {
      if (first){ first = false; const got = new Map(s.docs.map(d => [d.id, d])); part.forEach(id => tell(id, got.has(id) ? dec(got.get(id)) : null)); }   // the first answer says which exist and which don't
      else s.docChanges().forEach(c => tell(c.doc.id, c.type === 'removed' ? null : dec(c.doc))); },   // after that, only the documents that changed
      e => part.forEach(id => TB.want.get(id).regs.forEach(r => { try { r.onErr && r.onErr(e); } catch(x){} }))); } }

/* ---------- one live copy of each access list ---------- */
const LISTS = new Map();   // kind -> {docs, loaded, ready, unsub}
function liveList(kind){
  let L = LISTS.get(kind); if (L) return L.ready;
  L = {docs:[], loaded:false, unsub:null}; LISTS.set(kind, L);
  L.ready = new Promise((res, rej) => { let first = true;
    L.unsub = listen(collection(fs, kind), s => { L.docs = s.docs.map(d => Object.assign({id:d.id}, d.data())).sort((a, b) => a.id.localeCompare(b.id)); L.loaded = true; if (first){ first = false; res(L); } },
      e => { if (LISTS.get(kind) === L) LISTS.delete(kind); try { L.unsub && L.unsub(); } catch(x){} if (first){ first = false; rej(err(e)); } }); });
  return L.ready;
}
// left in the background for five minutes: stop listening (coming back would otherwise re-read every list); the next use reads afresh.
// (A list that is still on its way is left alone: someone is waiting for it.)
{ let t = 0; document.addEventListener('visibilitychange', () => { clearTimeout(t); if (document.hidden) t = setTimeout(() => { LISTS.forEach((L, kind) => { if (!L.loaded) return; try { L.unsub && L.unsub(); } catch(e){} LISTS.delete(kind); }); }, 5*60e3); }); }
// one document: from the live list when there is one; otherwise looked up once and remembered for a few seconds (screens ask repeatedly)
const ONE = new Map(), oneKey = (kind, id) => kind + '/' + String(id).toLowerCase(), oneDrop = (kind, id) => ONE.delete(oneKey(kind, id));
async function getOneDoc(kind, id){
  const L = LISTS.get(kind), lid = String(id).toLowerCase(); if (L && L.loaded){ const d = L.docs.find(x => x.id === lid); return d ? cp(d) : null; }
  const k = oneKey(kind, id); let hit = ONE.get(k);
  if (!hit || Date.now() - hit.at >= 15000){ hit = {at:Date.now(), p:getDoc(doc(fs, kind, lid)).then(s => s.exists() ? Object.assign({id:s.id}, s.data()) : null, e => { if (ONE.get(k) === hit) ONE.delete(k); throw err(e); })}; ONE.set(k, hit); }
  return cp(await hit.p);
}

/* ---------- kept on the device: only what changed is fetched ---------- */
const kv = (mode, fn) => new Promise((res, rej) => { try { const o = indexedDB.open('ergs-cache', 1); o.onupgradeneeded = () => o.result.createObjectStore('kv'); o.onerror = () => rej(o.error);
  o.onsuccess = () => { try { const tx = o.result.transaction('kv', mode), rq = fn(tx.objectStore('kv')); tx.oncomplete = () => { res(rq && rq.result); o.result.close(); }; tx.onerror = tx.onabort = () => { rej(tx.error); o.result.close(); }; } catch(e){ rej(e); } }; } catch(e){ rej(e); } });
// what the device keeps is cleared when its owner signs out, or turns out not to have access (a shared computer shouldn't hold on to it)
const wipeCache = () => new Promise(res => { let done = false; const fin = () => { if (!done){ done = true; res(); } };
  try { const r = indexedDB.deleteDatabase('ergs-cache'); r.onsuccess = r.onerror = r.onblocked = fin; } catch(e){ fin(); } setTimeout(fin, 1500); });
const INC_FIELD = {likes:'at', phtags:'at', pstats:'at', reads:'at', posts:'u'};   // the field that changes on every write of a document of that kind
const INC_BACK = 15*60e3;   // each look goes back 15 minutes, for a device whose clock is a little out
// Likes and photo tags change in bursts (one person likes ten photos) and many people have them open, so they aren't listened to
// live: a live listener charges every open device for every single change. They are fetched when asked (ERGS_AUTH.refresh), and
// a document that changed ten times since the last look costs one read, not ten.
const INC_ASK = {likes:1, phtags:1};
/* Is the device's copy still what the database holds? The database is asked what the collection adds up to: how many documents,
   and the total of their time marks. That is one read, and it comes out different if anything at all is missing, extra or out of
   date on the device: a document deleted outright, one written by something that doesn't mark the time (an older copy of the
   app, the Firebase console), or a change from a phone whose clock is wrong. Then, and only then, everything is read again.
   Team news is checked every time the app opens and on coming back to it; the others every six hours. As a last resort the
   whole lot is read again after 30 days (7 if the adding-up isn't available). */
const INC_OFTEN = {posts:1};
const INCS = new Map();   // kind -> the one shared watcher (however many parts of the app are listening)
function watchInc(kind, cb, n, onErr){
  let W = INCS.get(kind); const sub = {cb, n:n || 100, onErr};
  if (!W){ W = incStart(kind, sub.n); INCS.set(kind, W); }
  W.subs.add(sub); if (W.sent) setTimeout(() => { if (W.subs.has(sub)) W.tell(sub); }, 0); if (W.err) setTimeout(() => { if (W.subs.has(sub) && W.err) sub.onErr && sub.onErr(W.err); }, 0);
  return () => { W.subs.delete(sub); };
}
function incStart(kind, n){
  const field = INC_FIELD[kind], key = 'w:' + EMAIL + ':' + kind, col = collection(fs, kind), CAP = Math.min(1000, Math.max(50, n || 100));   // as many as the app shows: the newest CAP
  const W = {subs:new Set(), sent:false, err:null, tell:null, refresh:null}; let docs = new Map(), live = new Set(), st = {seen:0, clock:0, full:0, off:null, chk:0, tally:0}, keepT = 0, checkedAt = 0;
  W.tell = sub => { try { sub.cb([...docs.entries()].map(([id, d]) => Object.assign({id}, cp(d))).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, sub.n)); } catch(e){ console.error(e); } };
  const emit = () => { W.sent = true; W.err = null; W.subs.forEach(W.tell); };
  const fail = e => { W.err = window.__ergsErr ? window.__ergsErr(e) : e; W.subs.forEach(sub => { try { sub.onErr && sub.onErr(W.err); } catch(x){} }); };
  const refusal = e => /permission/.test(String(e && e.code || ''));
  // a look that didn't work when the device already has a copy to show: the copy stands, and only a refusal is passed on
  const soft = e => { if (refusal(e)) fail(e); };
  // kept on the device: straight away after a full fetch (it was the costly one), a moment after later changes, and when the page is left
  const put = () => { clearTimeout(keepT); keepT = 0; kv('readwrite', o => o.put({docs:[...docs.entries()], seen:st.seen, clock:st.clock, full:st.full, off:st.off || null, chk:st.chk || 0, tally:st.tally || 0}, key)).catch(() => {}); };
  const keep = now => { clearTimeout(keepT); if (now) put(); else keepT = setTimeout(put, 300); };
  addEventListener('pagehide', () => { if (keepT) put(); });
  const since = () => Math.max(1, Math.min(st.seen || st.clock || Date.now(), st.clock || st.seen || Date.now()) - INC_BACK);
  // what the collection adds up to: [how many documents, the total of each time mark]. tally: the database's (one read); mine: the device's copy
  const marks = field === 'at' ? ['at'] : ['at', field];
  const tally = async () => { const spec = {n:count()}; marks.forEach(f => { spec[f] = sum(f); }); const d = (await getAggregateFromServer(col, spec)).data(); return [+d.n || 0].concat(marks.map(f => +d[f] || 0)); };
  const mine = () => { const t = [docs.size].concat(marks.map(() => 0)); docs.forEach(v => marks.forEach((f, i) => { if (typeof v[f] === 'number') t[i + 1] += v[f]; })); return t; };
  // in step: the database's figures less the device's are what they were when the device last read everything (normally nothing;
  // the difference is the documents the copy doesn't hold: older than the newest CAP, or with no time on them)
  const inStep = t => { const m = mine(), off = st.off || []; return t.every((x, i) => Math.abs(x - m[i] - (off[i] || 0)) < (i ? 500 : 0.5)); };   // (the count exactly; the totals to within half a second)
  // everything (the newest CAP), read afresh: the device's copy is then the database's
  const full = async () => { const s = fresh(await getDocs(query(col, orderBy('at', 'desc'), limit(CAP))));
    docs = new Map(s.docs.map(d => [d.id, d.data()])); live = new Set(); let mx = 0; docs.forEach(v => { if ((+v[field] || 0) > mx) mx = +v[field]; });
    let off = null; try { const t = await tally(), m = mine(); off = t.map((x, i) => x - m[i]); } catch(e){}
    st = {seen:mx, clock:Date.now(), full:Date.now(), off, chk:Date.now(), tally:off ? 1 : 0}; checkedAt = Date.now(); keep(true); emit(); };
  const due = () => Date.now() - (INC_OFTEN[kind] ? checkedAt : Math.max(checkedAt, st.chk || 0)) > (INC_OFTEN[kind] ? 10*60e3 : 6*3600e3);
  const check = async () => { if (!due()) return; checkedAt = Date.now();
    try { let ok = inStep(await tally());
      // not in step: a change may simply have been on its way, so look once more before reading it all again
      if (!ok){ await new Promise(r => setTimeout(r, 3000)); if (INC_ASK[kind]) take(fresh(await getDocs(q())).docs, false); ok = inStep(await tally()); }
      if (ok){ st.chk = Date.now(); st.tally = 1; keep(); } else await full(); } catch(e){} };
  let looked = false; document.addEventListener('visibilitychange', () => { if (!document.hidden && looked && INC_OFTEN[kind]) check(); });
  // a document that was in view and now isn't: deleted, or rewritten by a device whose clock is slow. Ask which.
  const left = id => getDoc(doc(fs, kind, id)).then(s => { if (s.exists()) docs.set(id, s.data()); else docs.delete(id); keep(); emit(); }, () => {});
  const take = (list, liveView) => { let ch = false; const now = new Set();
    list.forEach(d => { const v = d.data(), old = docs.get(d.id); now.add(d.id); if (!old || JSON.stringify(old) !== JSON.stringify(v)){ docs.set(d.id, v); ch = true; } if ((+v[field] || 0) > st.seen) st.seen = +v[field]; });
    if (liveView){ if (list.length < CAP) live.forEach(id => { if (!now.has(id)) left(id); }); live = now; }
    st.clock = Date.now(); keep(); if (ch || !W.sent) emit(); };
  const q = () => query(col, where(field, '>', since()), orderBy(field, 'desc'), limit(CAP));
  let asked = 0, asking = null;
  // look again now (at most every 20 seconds); a kind that is listened to live is always current, so there is nothing to do
  W.refresh = () => { if (!INC_ASK[kind] || !W.sent) return Promise.resolve(); if (asking) return asking; if (Date.now() - asked < 20000) return Promise.resolve(); asked = Date.now();
    asking = getDocs(q()).then(s => take(fresh(s).docs, false)).catch(soft).then(() => { asking = null; }); return asking; };
  const follow = () => {
    if (INC_ASK[kind]){ asked = Date.now(); getDocs(q()).then(s => { take(fresh(s).docs, false); looked = true; return check(); }).catch(soft); return; }
    let first = true; live = new Set();
    // (a listener that the database stops, other than by refusing, is started again in five minutes: the daily allowance may be back)
    listen(q(), s => { take(s.docs, true); if (first){ first = false; looked = true; check(); } }, e => { soft(e); if (!refusal(e)) setTimeout(follow, 5*60e3); }); };
  (async () => { let c = null; try { c = await kv('readonly', o => o.get(key)); } catch(e){}
    const have = !!(c && Array.isArray(c.docs) && c.full && c.full <= Date.now());
    if (have){ docs = new Map(c.docs); st = {seen:c.seen || 0, clock:c.clock || 0, full:c.full, off:Array.isArray(c.off) ? c.off : null, chk:c.chk || 0, tally:c.tally || 0}; emit(); }   // what the device has shows at once
    if (have && Date.now() - c.full < (c.tally ? 30 : 7)*864e5) return follow();
    try { await full(); looked = true; if (INC_ASK[kind]) asked = Date.now(); else follow(); }
    catch(e){ if (have){ soft(e); follow(); } else { INCS.delete(kind); fail(e); } }
  })();
  return W;
}

/* live/state holds ERGS Live's matches and school crests; the app sees them as "matches" and "schools" collections */
let liveCache = null; const liveSubs = new Set();
let liveUnsub = null;
let liveBytes = 0;   // how big the scoreboard document is (it has a limit, and it is sent whole to every open device on each change)
function liveListen(){ if (liveUnsub) return; liveUnsub = listen(LIVE, s => { try { liveBytes = s.exists() ? new Blob([s.data().json || '']).size : 0; } catch(e){} liveCache = decState(s) || {matches:[], schools:{}}; liveSubs.forEach(f => f()); }, e => liveSubs.forEach(f => f(e)));
  // VEO and photo links are private (team/veo): coaches and players see them merged into the matches
  authReady.then(() => { if (ROLE !== 'coach' && ROLE !== 'player') return; teamListen('veo', d => { const v = d || {}; MEDIA = {byMatch:v.byMatch || {}, photos:v.photos || {}}; if (liveCache) liveSubs.forEach(f => f()); }, () => {}); }); }
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
      if (col === 'members') data = Object.assign({}, data, {name:USER && USER.displayName || '', email:EMAIL, login:ALIAS || EMAIL, via:ALIAS ? ALIAS_REL : '', photo:USER && USER.photoURL || ''});   // login: the email actually used (a second email or a guardian's)
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
      if (col === 'team') return teamListen(id, d => cb(snapOf(id, d)), e => onErr && onErr(err(e)));
      return listen(doc(fs, col, id), s => cb(snapOf(id, dec(s))), e => onErr && onErr(err(e)));
    }
  };
}
let membersCache = {};
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
      return listen(collection(fs, name), s => { const list = s.docs.map(d => ({id:d.id, d:dec(d)})).filter(x => x.d); if (name === 'members') list.forEach(x => { membersCache[x.id] = x.d; });   // so names and pictures aren't looked up again one by one
        out(list); }, e => onErr && onErr(err(e)));
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
  get email(){ return EMAIL; }, get alias(){ return ALIAS; }, get aliasRel(){ return ALIAS ? ALIAS_REL : ''; }, get aliasName(){ return ALIAS_NAME; }, get accessErr(){ return ACCESS_ERR; }, get role(){ return ROLE; }, get player(){ return PLAYER; }, get coach(){ return EMAIL === ADMIN ? Object.assign({}, COACH || {}, {scope:'admin'}) : COACH; },
  // second sign-in emails live in players/ but aren't players in their own right: listFull leaves them out, aliases() lists them
  async listFull(kind){ const all = await window.ERGS_AUTH.listRaw(kind); return kind === 'players' || kind === 'coaches' ? all.filter(d => !d.aliasOf) : all; },
  // a coach's other emails (coaches/<other> = {aliasOf: main}); coachAlias is the email this coach actually signed in with, when it isn't their main one
  async coachAliases(){ return (await window.ERGS_AUTH.listRaw('coaches')).filter(d => d.aliasOf); }, get coachAlias(){ return CO_ALIAS; },
  async aliases(){ return (await window.ERGS_AUTH.listRaw("players")).filter(d => d.aliasOf); },
  // live: the newest n docs of a collection (Team news), newest first; returns a stop function
  // (likes, photo tags, match records, read receipts and Team news are kept on the device: only what changed since last time is fetched)
  watch(kind, cb, n, err){ if (INC_FIELD[kind]) return watchInc(kind, cb, n, err); return listen(query(collection(fs, kind), orderBy('at', 'desc'), limit(n || 100)), s => cb(s.docs.map(d => Object.assign({id:d.id}, d.data()))), e => err && err(window.__ergsErr ? window.__ergsErr(e) : e)); },
  // training drills changed since a time (0 = all of them): read once, not listened to, so opening the app doesn't re-read every drill
  async drillSync(since){ try { const s = fresh(await getDocs(since > 0 ? query(collection(fs, 'drills'), where('u', '>', since)) : collection(fs, 'drills'))); return s.docs.map(d => ({id:d.id, u:+(d.data() || {}).u || 0, d:dec(d)})).filter(x => x.d); } catch(e){ throw err(e); } },
  watchDoc(kind, id, cb){ return listen(doc(fs, kind, String(id).toLowerCase()), s => cb(s.exists() ? s.data() : null), () => cb(null)); },
  async listRaw(kind){ return cp((await liveList(kind)).docs); },   // the shared live copy: read once, then free and always current
  // likes and photo tags: fetch what has changed since the last look (see INC_ASK); resolves when it is in
  refresh(kind){ const W = INCS.get(kind); return W ? W.refresh() : Promise.resolve(); },
  // the newest n documents of a collection, read once (the activity log)
  async recent(kind, n){ try { const s = fresh(await getDocs(query(collection(fs, kind), orderBy('at', 'desc'), limit(n || 100)))); return s.docs.map(d => Object.assign({id:d.id}, d.data())); } catch(e){ throw err(e); } },
  // the ids of every document in a collection, read once (a one-off tidy)
  async ids(kind){ return (await window.ERGS_AUTH.once(kind)).map(d => d.id); },
  // a few documents of a collection by id (up to 30), in one look-up
  async some(kind, ids){ ids = [...new Set((ids || []).filter(Boolean).map(x => String(x).toLowerCase()))].slice(0, 30); if (!ids.length) return [];
    try { return fresh(await getDocs(query(collection(fs, kind), where(documentId(), 'in', ids)))).docs.map(d => Object.assign({id:d.id}, d.data())); } catch(e){ throw err(e); } },
  // every document of a collection, read once and not listened to (a check a coach asks for)
  async once(kind){ try { return fresh(await getDocs(collection(fs, kind))).docs.map(d => Object.assign({id:d.id}, d.data())); } catch(e){ throw err(e); } },
  // the scoreboard document: its size, and how much of that is school crests
  liveInfo(){ const st = liveCache || {}; let crest = 0; try { crest = new Blob([JSON.stringify(st.schools || {})]).size; } catch(e){} return {bytes:liveBytes, limit:900000, matches:(st.matches || []).length, schools:Object.keys(st.schools || {}).length, crestBytes:crest}; },
  // can this collection be read at all? One document is enough to find out (the Firebase rules check)
  async probe(kind){ try { fresh(await getDocs(query(collection(fs, kind), limit(1)))); return true; } catch(e){ throw err(e); } },
  // the documents of a collection where a field has a value, read once (from the live list when that is already here)
  async listWhere(kind, field, value){ const L = LISTS.get(kind); if (L && L.loaded) return cp(L.docs.filter(d => d[field] === value));
    try { const s = fresh(await getDocs(query(collection(fs, kind), where(field, '==', value)))); return s.docs.map(d => Object.assign({id:d.id}, d.data())); } catch(e){ throw err(e); } },
  // the documents of a collection where a field has a value, live (headshots waiting for approval); returns a stop function
  watchWhere(kind, field, value, cb, onErr){ return listen(query(collection(fs, kind), where(field, '==', value)), s => cb(s.docs.map(d => Object.assign({id:d.id}, d.data()))), e => onErr && onErr(err(e))); },
  // setAccess merges what it is given into the document, field by field. Give a field this value to take it out instead: one like
  // or one photo tag is removed that way, without rewriting the rest from a copy that may be out of date.
  gone:deleteField(),
  async setAccess(kind, email, data){ oneDrop(kind, email); try { await setDoc(doc(fs, kind, email.toLowerCase()), data, {merge:true}); } catch(e){ throw err(e); } try { window.__afterSet && window.__afterSet(kind, email.toLowerCase(), data); } catch(e){} }, get admin(){ return EMAIL && EMAIL === ADMIN; }, adminEmail:ADMIN,
  async signIn(){ const p = new GoogleAuthProvider(); p.setCustomParameters({prompt:'select_account'}); try { await signInWithPopup(auth, p); } catch(e){ if (/popup-blocked|operation-not-supported/.test(e.code || '')) await signInWithRedirect(auth, p); else throw e; } },
  async signOut(){ await wipeCache(); return signOut(auth); },
  pwIn, staffIn, pwReset, pwSet, pwMake, pwMsg, get pwNo(){ try { return localStorage.getItem('ergs.pwNo') === '1'; } catch(e){ return false; } }, setPwNo(){ try { localStorage.setItem('ergs.pwNo', '1'); } catch(e){} }, get rejected(){ return REJECTED; }, get unproved(){ return pwOnly(auth.currentUser); }, get hasPw(){ const u = auth.currentUser; return !!u && (u.providerData || []).some(p => p.providerId === 'password'); }, get askPw(){ try { return sessionStorage.getItem('ergs.askPw') === '1'; } catch(e){ return false; } }, noAskPw(){ try { sessionStorage.removeItem('ergs.askPw'); } catch(e){} },
  sendLink, linkMsg, get linkErr(){ return LINK_ERR; }, get linkEmail(){ try { return localStorage.getItem(LINK_KEY) || ''; } catch(e){ return ''; } },
  async getOne(kind, id){ return getOneDoc(kind, id); },
  async list(kind){ return (await liveList(kind)).docs.map(d => d.id); },
  async add(kind, email){ oneDrop(kind, email); try { await setDoc(doc(fs, kind, email.toLowerCase()), {added:Date.now(), by:EMAIL}); } catch(e){ throw err(e); } },
  async remove(kind, email){ oneDrop(kind, email); try { await deleteDoc(doc(fs, kind, email.toLowerCase())); } catch(e){ throw err(e); }
    // removing a player also removes their second sign-in email
    if (kind === 'coaches'){ try { for (const a of await window.ERGS_AUTH.coachAliases()) if (String(a.aliasOf).toLowerCase() === email.toLowerCase()) await deleteDoc(doc(fs, 'coaches', a.id)); } catch(e){} }
    if (kind === 'players'){ try { for (const a of await window.ERGS_AUTH.aliases()) if (String(a.aliasOf).toLowerCase() === email.toLowerCase()) await deleteDoc(doc(fs, 'players', a.id)); } catch(e){} } },
  async removeDoc(kind, id){ oneDrop(kind, id); try { await deleteDoc(doc(fs, kind, String(id))); } catch(e){ throw err(e); } },   // ids that aren't emails (members are keyed by sign-in id)
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
