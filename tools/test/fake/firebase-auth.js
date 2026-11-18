// test double for Firebase Auth: the signed-in person comes from window.__fakeUser
const W = window, subs = new Set();
// C2k password accounts (kept in localStorage, so they last across reloads like real ones): {email: {pw, verified}}
const PWK = 'fakePwAccounts', pwAcc = () => { try { return JSON.parse(localStorage.getItem(PWK)) || {}; } catch(e){ return {}; } }, pwSave = o => localStorage.setItem(PWK, JSON.stringify(o));
const pwUser = email => ({email, uid:'pw_' + email, displayName:'', emailVerified:false, pwOnly:true, providerData:[{providerId:'password'}],
  async delete(){ const a = pwAcc(); delete a[email]; pwSave(a); W.__fakeUser = null; sessionStorage.removeItem('fakePwUser'); subs.forEach(f => f(null)); }});
try { const k = sessionStorage.getItem('fakePwUser'); if (k) W.__fakePwStart = k; } catch(e){}
const pwStart = () => { if (W.__fakePwStart && !W.__fakeUser){ W.__fakeUser = pwUser(W.__fakePwStart); } };
const pwOn = email => { W.__fakeUser = pwUser(email); sessionStorage.setItem('fakePwUser', email); sessionStorage.removeItem('fakeSignedOut'); subs.forEach(f => f(W.__fakeUser)); return {user:W.__fakeUser}; };
const aerr = c => { const e = new Error(c); e.code = c; return e; };
export async function createUserWithEmailAndPassword(auth, email, pw){ const a = pwAcc(); if (a[email] || (W.__fakeTaken || []).includes(email)) throw aerr('auth/email-already-in-use'); a[email] = {pw}; pwSave(a); return pwOn(email); }
export async function signInWithEmailAndPassword(auth, email, pw){ const a = pwAcc(); if (!a[email] || a[email].pw !== pw) throw aerr('auth/invalid-credential'); return pwOn(email); }
export async function sendPasswordResetEmail(auth, email){ W.__resetSent = email; }
export async function updatePassword(u, pw){ const a = pwAcc(); a[u.email] = {pw}; pwSave(a); u.providerData = (u.providerData || []).concat([{providerId:'password'}]); }
const AUTH = {get currentUser(){ return W.__fakeUser || null; }};
export function getAuth(){ return AUTH; }
export class GoogleAuthProvider { setCustomParameters(){} }
export async function signInWithPopup(){ }
export async function signInWithRedirect(){ }
export async function getRedirectResult(){ return null; }
export function onAuthStateChanged(auth, cb){ pwStart(); subs.add(cb); setTimeout(() => cb(AUTH.currentUser), 0); return () => subs.delete(cb); }
export async function signOut(){ W.__fakeUser = null; W.__fakePwStart = ''; try { sessionStorage.removeItem('fakePwUser'); } catch(e){} try { sessionStorage.setItem('fakeSignedOut', '1'); } catch(e){} subs.forEach(f => f(null)); }
export async function sendSignInLinkToEmail(){ }
export function isSignInWithEmailLink(){ return false; }
export async function signInWithEmailLink(){ }
