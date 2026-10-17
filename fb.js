// Firebase connection for ERGS Live. Loaded as a module; exposes window.FB to app.js.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, doc, onSnapshot, runTransaction, getDoc, setDoc, deleteDoc, collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
const cfg = (window.ERGS_CONFIG || {}).firebase;
if (cfg && cfg.apiKey && !/PASTE/.test(cfg.apiKey)){
  const app = initializeApp(cfg), db = getFirestore(app), auth = getAuth(app);
  const ref = doc(db, 'live', 'state');
  const parse = snap => { if (!snap.exists()) return null; const d = snap.data(); try { return JSON.parse(d.json); } catch(e){ return null; } };
  window.FB = {
    onState(cb, err){ return onSnapshot(ref, s => cb(parse(s), s.exists()), err); },
    save(fn){ return runTransaction(db, async tx => { const s = await tx.get(ref); const next = fn(parse(s)); tx.set(ref, {json:JSON.stringify(next), updated:next.updated || Date.now()}); }); },
    onAuth(cb){ return onAuthStateChanged(auth, cb); },
    async signIn(){ const p = new GoogleAuthProvider(); p.setCustomParameters({prompt:'select_account'}); try { await signInWithPopup(auth, p); } catch(e){ if (/popup-blocked|operation-not-supported/.test(e.code || '')) await signInWithRedirect(auth, p); else throw e; } },
    signOut(){ return signOut(auth); },
    async isCoach(email){ return (await getDoc(doc(db, 'coaches', email))).exists(); },
    async listCoaches(){ return (await getDocs(collection(db, 'coaches'))).docs.map(d => d.id).sort(); },
    addCoach(email){ return setDoc(doc(db, 'coaches', email), {added:Date.now()}); },
    removeCoach(email){ return deleteDoc(doc(db, 'coaches', email)); }
  };
}
window.dispatchEvent(new Event('fb-ready'));
