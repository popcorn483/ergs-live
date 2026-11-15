// test double for Firebase Auth: the signed-in person comes from window.__fakeUser
const W = window, subs = new Set();
const AUTH = {get currentUser(){ return W.__fakeUser || null; }};
export function getAuth(){ return AUTH; }
export class GoogleAuthProvider { setCustomParameters(){} }
export async function signInWithPopup(){ }
export async function signInWithRedirect(){ }
export async function getRedirectResult(){ return null; }
export function onAuthStateChanged(auth, cb){ subs.add(cb); setTimeout(() => cb(AUTH.currentUser), 0); return () => subs.delete(cb); }
export async function signOut(){ W.__fakeUser = null; try { sessionStorage.setItem('fakeSignedOut', '1'); } catch(e){} subs.forEach(f => f(null)); }
export async function sendSignInLinkToEmail(){ }
export function isSignInWithEmailLink(){ return false; }
export async function signInWithEmailLink(){ }
