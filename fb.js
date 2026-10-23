// Firebase connection for ERGS Live. Loaded as a module; exposes window.FB to app.js.
// C2k: @c2ken.net and @c2kni.net are the same person
const c2kTwin = e => /@c2ken\.net$/.test(e || '') ? e.replace(/@c2ken\.net$/, '@c2kni.net') : /@c2kni\.net$/.test(e || '') ? e.replace(/@c2kni\.net$/, '@c2ken.net') : '';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, doc, onSnapshot, runTransaction, getDoc, setDoc, deleteDoc, collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
const cfg = (window.ERGS_CONFIG || {}).firebase;
if (cfg && cfg.apiKey && !/PASTE/.test(cfg.apiKey)){
  const app = initializeApp(cfg), db = getFirestore(app), auth = getAuth(app);
  const ref = doc(db, 'live', 'state');
  /* sign in with an email link: for school (C2k) accounts that can't use Google sign-in for outside apps.
     They type their email, get a link in that inbox, and opening it signs them in here (no Google sign-in involved). */
  const LINK_KEY = 'ergs.linkEmail';
  let LINK_ERR = '';
  const linkDone = (async () => {
    const href = location.href; if (!isSignInWithEmailLink(auth, href)) return;
    let email = ''; try { email = localStorage.getItem(LINK_KEY) || ''; } catch(e){}
    // opened on a different device or browser from the one that asked: confirm the address
    if (!email) email = (window.prompt('Confirm your email address to finish signing in') || '').trim();
    // tidy the address bar first, so the reload after signing in doesn't reuse the link
    try { const u = new URL(href); ['apiKey', 'oobCode', 'mode', 'continueUrl', 'lang', 'tenantId'].forEach(k => u.searchParams.delete(k)); history.replaceState(null, '', u.pathname + u.search + u.hash); } catch(e){}
    if (!email) { LINK_ERR = 'Sign-in wasn’t finished: no email address was given. Ask for a new link.'; return; }
    try { await signInWithEmailLink(auth, email.toLowerCase(), href); try { localStorage.removeItem(LINK_KEY); } catch(e){} }
    catch(e){ const c = String(e && e.code || ''); LINK_ERR = /invalid-action-code|expired/.test(c) ? 'That sign-in link has expired or was already used. Ask for a new one.' : /invalid-email/.test(c) ? 'That email address doesn’t match the one the link was sent to. Ask for a new link.' : 'Signing in with the link didn’t work. Ask for a new one.'; }
  })();
  async function sendLink(email, back){
    email = String(email || '').trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ const x = new Error('Enter your full email address.'); x.code = 'auth/invalid-email'; throw x; }
    const url = back || (location.origin + location.pathname);
    await sendSignInLinkToEmail(auth, email, {url, handleCodeInApp:true});
    try { localStorage.setItem(LINK_KEY, email); } catch(e){}
    return email;
  }
  const linkMsg = e => { const c = String(e && e.code || ''); return /operation-not-allowed|admin-restricted/.test(c) ? 'Email-link sign-in isn’t switched on yet. A coach needs to turn it on in Firebase (Authentication › Sign-in method › Email/Password › Email link).'
    : /invalid-email/.test(c) ? 'Enter your full email address.' : /quota|too-many/.test(c) ? 'Today’s sign-in emails have run out: the app’s free Firebase plan can only send 5 a day for everyone. If this is a Gmail or other Google account, use Sign in with Google instead. Otherwise try again tomorrow.' : /unauthorized-continue-uri|unauthorized-domain/.test(c) ? 'This site isn’t on Firebase’s authorised domains list yet. A coach needs to add it in Firebase › Authentication › Settings.' : 'The link couldn’t be sent. Check your connection and try again.'; };
  
  const parse = snap => { if (!snap.exists()) return null; const d = snap.data(); try { return JSON.parse(d.json); } catch(e){ return null; } };
  window.FB = {
    onState(cb, err){ return onSnapshot(ref, s => cb(parse(s), s.exists()), err); },
    save(fn){ return runTransaction(db, async tx => { const s = await tx.get(ref); const next = fn(parse(s)); tx.set(ref, {json:JSON.stringify(next), updated:next.updated || Date.now()}); }); },
    onAuth(cb){ let first = true; return onAuthStateChanged(auth, async u => { if (first){ first = false; await linkDone; if (u === null && auth.currentUser) return; } cb(u); }); },
    sendLink, linkMsg, get linkErr(){ return LINK_ERR; },
    async signIn(){ const p = new GoogleAuthProvider(); p.setCustomParameters({prompt:'select_account'}); try { await signInWithPopup(auth, p); } catch(e){ if (/popup-blocked|operation-not-supported/.test(e.code || '')) await signInWithRedirect(auth, p); else throw e; } },
    signOut(){ return signOut(auth); },
    async isCoach(email){ let s = await getDoc(doc(db, 'coaches', email)); if (!s.exists() && c2kTwin(email)) s = await getDoc(doc(db, 'coaches', c2kTwin(email))); if (!s.exists()) return false; const d = s.data() || {}; return d.perms && d.perms.scoring === false ? 'noscore' : true; },   // a coach without scoring sees ERGS Live like a player
    // someone signed in who isn't a coach or player: note them as a supporter so the coaches see them (a request they already made is left alone)
    async noteSupporter(){ const u = auth.currentUser; if (!u || !u.email) return; const id = u.email.toLowerCase(), ref = doc(db, 'requests', id);
      try { const s = await getDoc(ref); if (!s.exists()) await setDoc(ref, {name:(u.displayName || id.split('@')[0]).slice(0, 100), photo:(u.photoURL || '').slice(0, 500), at:Date.now(), kind:'supporter'});
        else if ((s.data() || {}).kind === 'supporter') await setDoc(ref, {at:Date.now(), photo:(u.photoURL || '').slice(0, 500)}, {merge:true}); } catch(e){} },
    // a supporter's own sign-in record: which squads they follow (follow: [] means every squad)
    async myRequest(){ const u = auth.currentUser; if (!u || !u.email) return null; try { const s = await getDoc(doc(db, 'requests', u.email.toLowerCase())); return s.exists() ? s.data() : null; } catch(e){ return null; } },
    async setFollow(list){ const u = auth.currentUser; if (!u || !u.email) throw new Error('signin'); const id = u.email.toLowerCase(), ref = doc(db, 'requests', id), s = await getDoc(ref);
      if (s.exists()) await setDoc(ref, {follow:list}, {merge:true}); else await setDoc(ref, {name:(u.displayName || id.split('@')[0]).slice(0, 100), photo:(u.photoURL || '').slice(0, 500), at:Date.now(), kind:'supporter', follow:list}); },
    async isPlayer(email){ if ((await getDoc(doc(db, 'players', email))).exists()) return true; return !!c2kTwin(email) && (await getDoc(doc(db, 'players', c2kTwin(email)))).exists(); },
    // private VEO links (team/veo, readable by coaches and players only)
    onVeo(cb){ return onSnapshot(doc(db, 'team', 'veo'), s => { let v = {}; if (s.exists()){ try { v = JSON.parse(s.data().j) || {}; } catch(e){} } cb(v.byMatch || {}, v.photos || {}); }, () => cb({}, {})); },
    setVeo(id, url){ return this.setMedia('byMatch', id, url); },
    setPhotos(id, url){ return this.setMedia('photos', id, url); },
    setMedia(kind, id, url){ const r = doc(db, 'team', 'veo'); return runTransaction(db, async tx => { const s = await tx.get(r); let v = {byMatch:{}}; if (s.exists()){ try { v = JSON.parse(s.data().j) || v; } catch(e){} } v[kind] = v[kind] || {}; if (url) v[kind][id] = url; else delete v[kind][id]; v.updated = Date.now(); tx.set(r, {j:JSON.stringify(v), u:Date.now()}); }); },
    // Team of the Week nominations (team/noms): coaches nominate up to 4 players after each match; the main app collates them
    onNoms(cb){ return onSnapshot(doc(db, 'team', 'noms'), s => { let v = {}; if (s.exists()){ try { v = JSON.parse(s.data().j) || {}; } catch(e){} } cb(Array.isArray(v.list) ? v.list : []); }, () => cb([])); },
    setNoms(mid, list){ const r = doc(db, 'team', 'noms'); return runTransaction(db, async tx => { const s = await tx.get(r); let v = {list:[]}; if (s.exists()){ try { v = JSON.parse(s.data().j) || v; } catch(e){} } v.list = (Array.isArray(v.list) ? v.list : []).filter(x => x.mid !== mid).concat(list); v.updated = Date.now(); tx.set(r, {j:JSON.stringify(v), u:Date.now()}); }); },
    // opposition notes: private coach notes against each school (stored with Team of the Week, which only coaches can read)
    onOppNotes(cb){ return onSnapshot(doc(db, 'totw', 'oppnotes'), s => { let v = {}; if (s.exists()){ try { v = JSON.parse(s.data().j) || {}; } catch(e){} } cb(v.bySchool || {}); }, () => cb({})); },
    setOppNote(key, note){ const r = doc(db, 'totw', 'oppnotes'); return runTransaction(db, async tx => { const s = await tx.get(r); let v = {bySchool:{}}; if (s.exists()){ try { v = JSON.parse(s.data().j) || v; } catch(e){} } v.bySchool = v.bySchool || {}; if (note && note.text) v.bySchool[key] = note; else delete v.bySchool[key]; v.updated = Date.now(); tx.set(r, {j:JSON.stringify(v), u:Date.now()}); }); },
    // headshots shown in the score animations: small public copies, made when a coach records a score
    async face(key){ try { const s = await getDoc(doc(db, 'faces', key)); return s.exists() ? (s.data().d || '') : ''; } catch(e){ return ''; } },
    setFace(key, d){ return setDoc(doc(db, 'faces', key), {d, u:Date.now()}); },
    async image(id){ const s = await getDoc(doc(db, 'images', id)); return s.exists() ? (s.data().d || '') : ''; },
    async listCoaches(){ return (await getDocs(collection(db, 'coaches'))).docs.map(d => d.id).sort(); },
    addCoach(email){ return setDoc(doc(db, 'coaches', email), {added:Date.now()}); },
    removeCoach(email){ return deleteDoc(doc(db, 'coaches', email)); },
    // any team/* record kept by the main app as JSON in "j" (team/photos: the season folders in Google Drive)
    async teamDoc(name){ try { const r = await getDoc(doc(db, 'team', name)); if (!r.exists()) return null; return JSON.parse(r.data().j || 'null'); } catch(e){ return null; } },
    // team sheets and player profiles kept by the main app (stored as JSON in the "j" field)
    async listTeams(){ const dj = d => { try { return JSON.parse(d.j); } catch(e){ return null; } };
      const sh = await getDocs(collection(db, 'sheets')); const sheets = sh.docs.map(x => Object.assign({id:x.id}, dj(x.data()) || {})).sort((a, b) => (b.created || 0) - (a.created || 0));
      let roster = []; try { const r = await getDoc(doc(db, 'team', 'roster')); if (r.exists()){ const v = dj(r.data()); roster = v && Array.isArray(v.players) ? v.players : []; } } catch(e){}
      return {sheets, roster}; }
  };
}
window.dispatchEvent(new Event('fb-ready'));
