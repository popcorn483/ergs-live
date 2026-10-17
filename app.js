(() => {
'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const uid = () => Math.random().toString(36).slice(2, 10);
const CFG = window.ERGS_CONFIG || {};
const RAW = {matches:[], schools:{}, crest:window.ERGS_CREST || ''};   // last snapshot from the database
const DATA = clone(RAW);                           // what gets shown
const MAIN_APP = CFG.mainApp || 'https://claude.ai/artifact/5Xp2Q4mof4rU3NYuzrAhsK';
const OUR_RX = /\b(ergs|enniskillen)\b/i;
const PTS = {try:5, con:2, pen:3, dg:3, pt:7};
const EVK = {try:['Try','T'], con:['Conversion','C'], pen:['Penalty goal','P'], dg:['Drop goal','DG'], pt:['Penalty try','PT'], yc:['Yellow card','YC'], rc:['Red card','RC'], note:['','']};
const ptsOf = e => e.miss ? 0 : (PTS[e.k] || 0);
function shiftDemo(D){ if (!D.demo) return; const now = Date.now(); D.updated = now - 200*1000; for (const m of D.matches){ if (m.koIn != null) m.ko = new Date(now + m.koIn*864e5).toISOString().slice(0, 10) + 'T' + (m.koTime || '10:30'); if (m.clock && m.clock.runFor != null) m.clock.since = now - m.clock.runFor*1000; for (const e of m.events || []) if (e.ago != null) e.ts = now - e.ago*1000; }  }
shiftDemo(DATA);

/* ---------- page shell ---------- */
document.body.insertAdjacentHTML('beforeend', `
<div class="wrap">
  <header><img id="crestImg" alt="Enniskillen Royal Grammar School crest"><h1>ERGS <span>Live</span></h1><span class="sp"></span><span class="pill live">Live scores</span></header>
  <div class="coachbar" id="coachBar" hidden></div>
  <div class="demo" id="demoBar" hidden><span><b>Preview with example matches.</b> Real scores replace these once coaches start scoring here.</span><button type="button" id="demoTry">Show a try landing</button></div>
  <nav class="tabs" id="tabs" aria-label="Sections"><button type="button" data-v="matches">Matches</button><button type="button" data-v="fixtures">Fixtures</button><button type="button" data-v="results">Results</button></nav>
  <main id="view" aria-live="polite"></main>
  <footer><span>Enniskillen Royal Grammar School Rugby · no sign-in needed</span><span><span id="autoNote" hidden>Refreshes every 30 seconds during a match · </span><span id="updated"></span></span></footer>
</div>
<div class="fx" id="fx" hidden aria-live="assertive"><div class="fx-band"></div><div class="fx-burst" id="fxBurst"></div><div class="fx-in"><div class="fx-crest" id="fxCrest"></div><div class="fx-kind" id="fxKind"></div><div class="fx-who" id="fxWho"></div><div class="fx-score" id="fxScore"></div></div></div>
<div class="modal" id="modal" hidden><div class="dialog" id="dialog" role="dialog" aria-modal="true"></div></div>
<div class="saving" id="saving" hidden><span class="spin"></span><span id="savingT">Sending to everyone…</span></div>
<div class="toast" id="toast" hidden role="status"></div>`);
$('#crestImg').src = DATA.crest;
let toastT = 0;
function toast(t){ const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, Math.max(3200, t.length * 60)); }

/* ---------- helpers ---------- */
const isLive = m => m.status === '1H' || m.status === 'HT' || m.status === '2H';
const usOf = m => m.us || (OUR_RX.test(m.home) ? 'H' : OUR_RX.test(m.away) ? 'A' : '');
function score(m){ let h = 0, a = 0, any = false; for (const e of m.events || []){ const p = ptsOf(e); if (p) any = true; if (e.s === 'H') h += p; else if (e.s === 'A') a += p; } return !any && Array.isArray(m.final) ? [+m.final[0], +m.final[1]] : [h, a]; }
const elapsed = m => { const c = m.clock || {}; return Math.max(0, (c.base || 0) + (c.running && c.since ? (Date.now() - c.since)/1000 : 0)); };
const mm = s => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; };
const minuteNow = m => m.status === 'pre' ? 0 : Math.max(1, Math.ceil(elapsed(m)/60));
const kot = m => { const t = Date.parse(m.ko); return isNaN(t) ? 0 : t; };
const when = (m, long) => { if (!kot(m)) return ''; const d = new Date(kot(m)); const day = d.toLocaleDateString('en-GB', long ? {weekday:'long', day:'numeric', month:'long'} : {weekday:'short', day:'numeric', month:'short'}); return m.koTbc ? day : day + ', ' + d.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'}); };
function clockText(m){ if (m.status === 'HT') return 'Half time'; if (m.status === 'FT') return 'Full time'; if (m.status === 'pre') return when(m) || 'Not started'; return mm(elapsed(m)) + (m.clock && !m.clock.running ? ' · paused' : ''); }
const compLine = m => [m.team, m.comp, m.round].filter(Boolean).join(' · ');
const school = n => OUR_RX.test(n) ? {crest:DATA.crest, color:'#1C2342'} : (DATA.schools || {})[schoolKey(n)] || (DATA.schools || {})[n] || null;
function schoolKey(n){ return String(n || '').toLowerCase().replace(/[’'`.]/g, '').replace(/\b(1st|2nd|3rd|xv|vii|7s|u1\d|medallion|girls|boys|the)\b/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
const initials = n => { const w = String(n || '?').replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(x => x && !/^(the|of|and|school|college|academy|grammar|high|royal|xv|1st|2nd|u\d+)$/i.test(x)); return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '?').slice(0, 2)).toUpperCase(); };
function crest(name, cls){ const s = school(name); if (s && s.crest) return `<span class="crest ${cls || ''}"><img alt="" src="${esc(s.crest)}"></span>`; return `<span class="crest ini ${cls || ''}" style="--c:${esc(s && s.color || '#3A4466')}">${esc(initials(name))}</span>`; }
const sorted = m => (m.events || []).slice().sort((a, b) => (a.m - b.m) || (a.ts - b.ts));
const label = e => e.k === 'note' ? (e.p || '') : EVK[e.k][0] + (e.miss ? ' missed' : '') + (e.p ? ' · ' + e.p : '');
function resultOf(m){ const us = usOf(m); if (m.status !== 'FT' || !us) return null; const [h, a] = score(m), f = us === 'H' ? h : a, g = us === 'H' ? a : h; return {r:f > g ? 'W' : f < g ? 'L' : 'D', f, g, opp:us === 'H' ? m.away : m.home}; }
const resPill = r => r ? `<span class="res ${r.r}">${r.r === 'W' ? 'Won' : r.r === 'L' ? 'Lost' : 'Drew'}</span>` : '';

/* ---------- views ---------- */
const UI = (() => { try { const u = JSON.parse(sessionStorage.getItem('ergsLive.ui') || 'null'); sessionStorage.removeItem('ergsLive.ui'); return u; } catch(e){ return null; } })();
const V = {tab:UI && UI.tab || 'matches', open:UI && UI.open || null};
let COACH = false, ART = null;
const prev = new Map();
function bins(m, s){
  if (m.status === 'pre' || m.status === 'FT') return '';
  return sorted(m).filter(e => e.s === s && (e.k === 'yc' || e.k === 'rc')).map(e => {
    if (e.k === 'rc') return `<span class="bin rc"><i></i>${esc(e.p || 'Red card')}</span>`;
    const left = (e.at || 0) + (m.code === 'sevens' ? 120 : 600) - elapsed(m); if (left <= 0) return '';
    return `<span class="bin yc"><i></i>${esc(e.p || 'Sin bin')} <b data-bin="${esc(m.id)}|${esc(e.id)}">${mm(left)}</b></span>`; }).join('');
}
function board(m, full){
  const [h, a] = score(m), p = prev.get(m.id); prev.set(m.id, [h, a]);
  const hc = (school(m.home) || {}).color || '#3A4466', ac = (school(m.away) || {}).color || '#3A4466';
  const last = sorted(m).filter(e => e.k !== 'note' || e.p).slice(-3).reverse(), run = isLive(m) && m.clock && m.clock.running;
  return `<${full ? 'div' : 'button type="button" data-open="' + esc(m.id) + '"'} class="sb${isLive(m) ? '' : ' quiet'}" style="--hc:${esc(hc)};--ac:${esc(ac)}">
    <div class="sb-meta">${esc([compLine(m), m.status === '1H' ? '1st half' : m.status === '2H' ? '2nd half' : '', full ? m.venue : ''].filter(Boolean).join(' · '))}</div>
    <div class="sb-main"><div class="side">${crest(m.home, 'big')}<b>${esc(m.home)}</b><div class="bins">${bins(m, 'H')}</div></div>
      <div class="score"><span class="${h > a ? 'lead' : ''}${p && p[0] !== h ? ' bump' : ''}">${h}</span><span class="dash">–</span><span class="${a > h ? 'lead' : ''}${p && p[1] !== a ? ' bump' : ''}">${a}</span></div>
      <div class="side">${crest(m.away, 'big')}<b>${esc(m.away)}</b><div class="bins">${bins(m, 'A')}</div></div></div>
    <span class="clock">${run ? '<span class="dot"></span>' : ''}<span data-clock="${esc(m.id)}">${esc(clockText(m))}</span>${m.status === 'FT' ? ' ' + resPill(resultOf(m)) : ''}</span>
    ${!full && last.length ? `<div class="last3">${last.map(e => `<div><span>${e.m}′</span><span>${esc(label(e))}${e.k !== 'note' ? ' (' + esc(e.s === 'H' ? m.home : m.away) + ')' : ''}</span></div>`).join('')}</div><span class="tap">Tap for the full timeline</span>` : ''}
  </${full ? 'div' : 'button'}>`;
}
function row(m){
  const d = new Date(kot(m)), us = usOf(m), opp = us === 'A' ? m.home : m.away, r = resultOf(m);
  const right = isLive(m) ? `<span class="pill live" data-clock="${esc(m.id)}">${esc(clockText(m))}</span>` : r ? `${resPill(r)} <b>${r.f}–${r.g}</b>` : '';
  return `<button type="button" class="row" data-open="${esc(m.id)}"><span class="cd"><b>${kot(m) ? d.getDate() : '–'}</b><span>${kot(m) ? esc(d.toLocaleDateString('en-GB', {weekday:'short'})) : ''}</span></span>${crest(opp)}
    <span class="ri"><b>${esc((m.team ? m.team + ' ' : '') + (us === 'A' ? '@ ' : 'v ') + opp)}</b><span>${esc([m.koTbc ? 'Kick-off to be confirmed' : kot(m) ? d.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'}) : '', us === 'H' ? 'Home' : us === 'A' ? 'Away' : '', m.comp, m.venue].filter(Boolean).join(' · '))}</span></span>
    <span class="rr">${right}</span></button>`;
}
function viewMatches(){
  const live = DATA.matches.filter(isLive), now = Date.now();
  const next = DATA.matches.filter(m => m.status === 'pre' && kot(m) > now - 6*3600e3).sort((a, b) => kot(a) - kot(b)).slice(0, 4);
  const undated = COACH ? DATA.matches.filter(m => m.status === 'pre' && !kot(m)) : [];
  const done = DATA.matches.filter(m => m.status === 'FT').sort((a, b) => kot(b) - kot(a)).slice(0, 5);
  return `<div class="sec">${live.length ? 'Live now' : 'No match in play'}</div>${live.length ? `<div class="board">${live.map(m => board(m)).join('')}</div>` : `<div class="empty">No ERGS match is in play right now. The score appears here the moment one kicks off.${COACH ? ' Open a fixture below and press Kick off.' : ''}</div>`}
    <div class="sec">Coming up</div>${next.length + undated.length ? `<div class="list">${next.concat(undated).map(row).join('')}</div>` : `<div class="empty">No fixtures announced yet.${COACH ? ' Add a match or import the fixtures list.' : ''}</div>`}
    <div class="sec">Latest results</div>${done.length ? `<div class="list">${done.map(row).join('')}</div>` : '<div class="empty">No results yet.</div>'}`;
}
function viewFixtures(){
  const now = Date.now(), up = DATA.matches.filter(m => m.status !== 'FT' && kot(m) > now - 6*3600e3).sort((a, b) => kot(a) - kot(b));
  if (!up.length) return '<div class="empty">No upcoming fixtures yet.</div>';
  let out = '', cur = '';
  for (const m of up){ const k = new Date(kot(m)).toLocaleDateString('en-GB', {month:'long', year:'numeric'}); if (k !== cur){ if (cur) out += '</div>'; out += `<div class="month">${esc(k)}</div><div class="list">`; cur = k; } out += row(m); }
  return out + '</div>';
}
function viewResults(){
  const res = DATA.matches.filter(m => m.status === 'FT').sort((a, b) => kot(b) - kot(a)), rs = res.map(m => [m, resultOf(m)]).filter(x => x[1]);
  if (!rs.length) return '<div class="empty">No results yet.</div>';
  const W = rs.filter(x => x[1].r === 'W').length, L = rs.filter(x => x[1].r === 'L').length, D = rs.length - W - L;
  const by = new Map(); rs.forEach(([m, r]) => { const k = schoolKey(r.opp) || r.opp, o = by.get(k) || {n:r.opp, p:0, w:0, d:0, l:0, f:0, a:0}; o.p++; o[r.r.toLowerCase()]++; o.f += r.f; o.a += r.g; by.set(k, o); });
  return `<div class="sum"><div><b>${rs.length}</b><span>Played</span></div><div class="w"><b>${W}</b><span>Won</span></div><div><b>${D}</b><span>Drawn</span></div><div class="l"><b>${L}</b><span>Lost</span></div></div>
    <div class="sec">Results</div><div class="list">${res.map(row).join('')}</div>
    <div class="sec">Record against each school</div>
    <div class="tbl"><table><thead><tr><th>School</th><th>P</th><th>W</th><th>D</th><th>L</th><th class="hide-s">For</th><th class="hide-s">Against</th></tr></thead><tbody>
    ${[...by.values()].sort((a, b) => b.p - a.p || a.n.localeCompare(b.n)).map(o => `<tr><td><span class="who">${crest(o.n)}${esc(o.n)}</span></td><td>${o.p}</td><td>${o.w}</td><td>${o.d}</td><td>${o.l}</td><td class="hide-s">${o.f}</td><td class="hide-s">${o.a}</td></tr>`).join('')}</tbody></table></div>`;
}
function coachPanel(m){
  if (!COACH || DATA.demo) return '';
  const b = (act, t, cls) => `<button type="button" class="btn ${cls || ''}" data-act="${act}">${t}</button>`;
  let clock = '';
  if (m.status === 'pre') clock = b('ko', 'Kick off', 'primary');
  if (m.status === '1H') clock = b('ht', 'Half time', 'primary');
  if (m.status === 'HT') clock = b('2h', 'Start 2nd half', 'primary');
  if (m.status === '2H') clock = b('ft', 'Full time', 'primary');
  if (m.status === '1H' || m.status === '2H') clock += b('pause', m.clock && m.clock.running ? 'Pause clock' : 'Restart clock') + b('minus', '−1 min', 'ghost') + b('plus', '+1 min', 'ghost');
  if (m.status === 'FT') clock = b('reopen', 'Reopen match');
  const pad = ['H', 'A'].map(s => `<div class="col"><div class="side-h">${crest(s === 'H' ? m.home : m.away)}<span>${esc(s === 'H' ? m.home : m.away)}</span></div>${['try','con','pen','dg','pt','yc','rc'].map(k => `<button type="button" class="btn ${PTS[k] ? 'pts' : 'card'} ${k}" data-ev="${k}" data-side="${s}" ${m.status === 'pre' || m.status === 'FT' ? 'disabled' : ''}><span>${EVK[k][0]}</span><small>${PTS[k] ? '+' + PTS[k] : '■'}</small></button>`).join('')}</div>`).join('');
  return `<div class="box coach"><h3>Match clock</h3><div class="ctrl">${clock}</div></div>
    <div class="box coach"><h3>Score</h3><div class="pad">${pad}</div>${m.status === 'pre' ? '<p class="hint">Press Kick off first.</p>' : ''}</div>
    <div class="box coach"><h3>Commentary</h3><form class="inline" id="noteForm"><input class="input" id="noteIn" maxlength="140" placeholder="Big turnover at the breakdown" aria-label="Commentary line"><button class="btn" type="submit">Post</button></form></div>
    <div class="box coach"><h3>Match video</h3><form class="inline" id="veoForm"><input class="input" id="veoIn" type="url" placeholder="https://app.veo.co/matches/…" aria-label="VEO link" value="${esc(m.veo || '')}"><button class="btn" type="submit">Save</button></form></div>
    <div class="box coach"><h3>Match</h3><div class="ctrl">${b('edit', 'Edit details')}${b('share', 'Copy match link')}${m.status === 'FT' ? b('copyres', 'Copy result') : ''}${b('del', 'Delete match', 'ghost danger')}</div></div>`;
}
function viewMatch(m){
  const evs = sorted(m), t = [0, 0], run = new Map(); evs.forEach(e => { const p = ptsOf(e); if (e.s === 'H') t[0] += p; if (e.s === 'A') t[1] += p; run.set(e, t.join('–')); });
  const kicks = []; for (const s of ['H', 'A']){ const by = {}; evs.filter(e => e.s === s && ['con','pen','dg'].includes(e.k)).forEach(e => { const k = e.p || 'Kicker'; const r = by[k] = by[k] || [0, 0]; r[1]++; if (!e.miss) r[0]++; }); Object.entries(by).forEach(([k, r]) => kicks.push(`<div class="kick"><span>${esc(k)} <small>${esc(s === 'H' ? m.home : m.away)}</small></span><b>${r[0]}/${r[1]}</b></div>`)); }
  const canX = COACH && !DATA.demo;
  return `<button class="back" type="button" data-home>All matches</button>${isLive(m) || m.status === 'FT' ? board(m, true) : `<div class="sb quiet"><div class="sb-meta">${esc(compLine(m))}</div><div class="sb-main"><div class="side">${crest(m.home, 'big')}<b>${esc(m.home)}</b></div><div class="score" style="font-size:40px;color:var(--dim)">v</div><div class="side">${crest(m.away, 'big')}<b>${esc(m.away)}</b></div></div><span class="clock" style="border-color:var(--rule)">${esc(when(m, true) || 'Date to be confirmed')}</span></div>`}
    ${coachPanel(m)}
    ${m.venue && m.status === 'pre' ? `<div class="box"><h3>Venue</h3><div>${esc(m.venue)}</div></div>` : ''}
    ${m.veo && !canX ? `<div class="box"><h3>Match video</h3><a class="veo" href="${esc(m.veo)}" target="_blank" rel="noopener">Watch on VEO</a></div>` : ''}
    ${kicks.length ? `<div class="box"><h3>Goal kicking</h3>${kicks.join('')}</div>` : ''}
    <div class="box"><h3>Match timeline</h3>${evs.length ? `<ul class="tl">${evs.slice().reverse().map(e => `<li class="${e.miss ? 'miss' : ''}${canX ? ' x' : ''}"><span class="mn">${e.m}′</span><span class="ic ${e.k}">${e.k === 'note' ? '…' : EVK[e.k][1]}</span><span class="tx"><b>${esc(label(e))}</b> <span>${e.k === 'note' ? '' : esc(e.s === 'H' ? m.home : m.away)}</span></span><span class="run">${ptsOf(e) ? run.get(e) : ''}</span>${canX ? `<button type="button" class="rm" data-rm="${esc(e.id)}" aria-label="Remove this entry">×</button>` : ''}</li>`).join('')}</ul>` : `<p style="margin:0;color:var(--mute)">${m.status === 'pre' ? 'The timeline fills in once the match kicks off.' : 'Final score only.'}</p>`}</div>`;
}
function coachBar(){
  const bar = $('#coachBar'); bar.hidden = !COACH; if (!COACH) return;
  bar.innerHTML = DATA.demo
    ? `<span><b>Coach view.</b> The matches below are examples. Clear them to start real scoring; supporters will see your matches straight away.</span><button type="button" class="btn primary" data-act="cleardemo">Clear the examples</button>`
    : `<span><b>Coach view.</b> Every change goes live for everyone watching.</span><div class="ctrl"><button type="button" class="btn primary" data-act="new">New match</button><button type="button" class="btn" data-act="past">Add a past result</button><button type="button" class="btn" data-act="import">Import fixtures</button><button type="button" class="btn" data-act="schools">School crests</button>${ADMIN ? '<button type="button" class="btn" data-act="coaches">Coaches</button>' : ''}<button type="button" class="btn" data-act="tomain">Copy for main app</button><a class="btn ghost" href="${MAIN_APP}" target="_blank" rel="noopener">Main app</a><button type="button" class="btn ghost" data-act="signout">Sign out</button></div>`;
  if (READY && !HAS_DOC) bar.innerHTML = `<span><b>Coach view.</b> The scoreboard is empty. Bring across the matches from the Claude page to start.</span><button type="button" class="btn primary" data-act="seed">Set up the scoreboard</button><button type="button" class="btn ghost" data-act="signout">Sign out</button>`;
}
function render(){
  const m = V.open && DATA.matches.find(x => x.id === V.open);
  if (V.open && !m) V.open = null;
  $('#demoBar').hidden = !DATA.demo || COACH;
  coachBar();
  $('#tabs').hidden = !!m;
  $$('#tabs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === V.tab));
  $('#view').innerHTML = m ? viewMatch(m) : V.tab === 'fixtures' ? viewFixtures() : V.tab === 'results' ? viewResults() : viewMatches();
  $$('[data-open]').forEach(b => b.onclick = () => { V.open = b.dataset.open; try { history.replaceState(null, '', '#m.' + V.open); } catch(e){} render(); scrollTo(0, 0); });
  $$('[data-home]').forEach(b => b.onclick = () => { V.open = null; try { history.replaceState(null, '', location.pathname + location.search); } catch(e){} render(); });
  $$('[data-act]').forEach(b => b.onclick = () => act(b.dataset.act, m));
  $$('[data-ev]').forEach(b => b.onclick = () => openEv(m, b.dataset.ev, b.dataset.side));
  $$('[data-rm]').forEach(b => b.onclick = () => { const e = m.events.find(x => x.id === b.dataset.rm); ask('Remove this entry?', `${label(e)} at ${e.m}′ will come off the timeline and the score for everyone.`, 'Remove', () => save(d => { const x = d.matches.find(y => y.id === m.id); x.events = x.events.filter(y => y.id !== e.id); }, m.id)); });
  const nf = $('#noteForm'); if (nf) nf.onsubmit = ev => { ev.preventDefault(); const t = $('#noteIn').value.trim(); if (!t) return; save(d => { const x = d.matches.find(y => y.id === m.id); x.events.push({id:uid(), k:'note', s:'', p:t.slice(0, 140), m:minuteNow(m), at:Math.round(elapsed(m)), ts:Date.now()}); }, m.id); };
  const vf = $('#veoForm'); if (vf) vf.onsubmit = ev => { ev.preventDefault(); const v = $('#veoIn').value.trim(); if (v && !/^https:\/\//i.test(v)){ toast('Paste the full link, starting with https://'); return; } save(d => { d.matches.find(y => y.id === m.id).veo = v; }, m.id); };
}
$$('#tabs button').forEach(b => b.onclick = () => { V.tab = b.dataset.v; render(); });
setInterval(() => {
  $$('[data-clock]').forEach(el => { const m = DATA.matches.find(x => x.id === el.dataset.clock); if (m){ const t = clockText(m); if (el.textContent !== t) el.textContent = t; } });
  $$('[data-bin]').forEach(el => { const [mid, eid] = el.dataset.bin.split('|'), m = DATA.matches.find(x => x.id === mid), e = m && m.events.find(x => x.id === eid); if (m && e) el.textContent = mm((e.at || 0) + (m.code === 'sevens' ? 120 : 600) - elapsed(m)); });
}, 1000);

/* ---------- saving: a transaction on the shared scoreboard; every phone gets it within a second ---------- */
let saving = false, READY = false, HAS_DOC = false, EMAIL = '', ADMIN = false;
async function save(fn, keepOpen){
  if (!COACH || !window.FB || saving) return;
  if (keepOpen !== undefined) V.open = keepOpen;
  saving = true; const t = setTimeout(() => { if (saving) $('#saving').hidden = false; }, 400);
  try { await FB.save(cur => { const next = clone(cur || {matches:[], schools:{}}); fn(next); next.updated = Date.now(); return next; }); }
  catch(e){ const c = e && (e.code || '');
    if (/permission/.test(c)){ toast(ADMIN ? `The database refused the save. In Firebase → Firestore → Rules, check the admin email reads ${CFG.admin} and press Publish.` : 'The database refused the save: your account isn’t on the coaches list. Ask the admin to add you.'); }
    else if (/unavailable|network/.test(c)) toast('No signal. That change didn’t save; try again.');
    else toast('That didn’t save. Try again.'); console.error(e); }
  finally { clearTimeout(t); saving = false; $('#saving').hidden = true; render(); }
}

/* ---------- dialogs ---------- */
function openDialog(html, onOpen){ $('#dialog').innerHTML = html; $('#modal').hidden = false; $$('#dialog [data-close]').forEach(b => b.onclick = closeDialog); if (onOpen) onOpen($('#dialog')); const f = $('#dialog input, #dialog button.btn.primary'); f && f.focus(); }
function closeDialog(){ $('#modal').hidden = true; $('#dialog').innerHTML = ''; if (pendingRender){ pendingRender = false; render(); } }
let pendingRender = false;
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeDialog(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeDialog(); });
function ask(title, text, ok, fn){ openDialog(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="dlg-a"><button type="button" class="btn ghost" data-close>Cancel</button><button type="button" class="btn primary" id="askOk">${esc(ok)}</button></div>`, d => d.querySelector('#askOk').onclick = () => { closeDialog(); fn(); }); }
function seg(name, opts, val){ return `<div class="seg" data-seg="${name}">${opts.map(([v, t]) => `<button type="button" data-v="${v}" aria-pressed="${v === val}">${t}</button>`).join('')}</div>`; }
function wireSegs(d){ d.querySelectorAll('[data-seg]').forEach(s => s.querySelectorAll('button').forEach(b => b.onclick = () => { s.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); s.dataset.val = b.dataset.v; s.dispatchEvent(new Event('change')); })); d.querySelectorAll('[data-seg]').forEach(s => { const p = s.querySelector('[aria-pressed="true"]'); s.dataset.val = p ? p.dataset.v : ''; }); }

/* scoring */
function openEv(m, k, s, pending){
  const team = s === 'H' ? m.home : m.away, kick = k === 'con' || k === 'pen' || k === 'dg', after = !!pending;
  const ours = usOf(m) === s, players = ours && Array.isArray(m.players) ? m.players : [];
  const used = new Set(); sorted(m).forEach(e => { if (e.s === s && e.p && e.k !== 'note') used.add(e.p); });
  const lastKicker = kick ? sorted(m).filter(e => e.s === s && (e.k === 'con' || e.k === 'pen') && e.p).pop() : null;
  openDialog(`<h2>${after ? 'Conversion attempt' : EVK[k][0]}</h2><p>${esc(team)}${PTS[k] ? ` · +${PTS[k]} if scored` : ''}</p>
    ${kick ? `<div class="field"><span class="label">Kick</span>${seg('res', [['ok','Scored'],['miss','Missed']], 'ok')}</div>` : ''}
    ${players.length ? `<div class="chips">${players.map(p => `<button type="button" class="chip" data-name="${esc(p.name)}"><i>${esc(p.n || '')}</i><span>${esc(p.name)}</span></button>`).join('')}</div>` : ''}
    <div class="field"><label class="label" for="evWho">${players.length ? 'Or type a name' : kick ? 'Kicker (optional)' : 'Player (optional)'}</label><input class="input" id="evWho" maxlength="40" list="evNames" autocomplete="off" value="${esc(lastKicker ? lastKicker.p : '')}"><datalist id="evNames">${[...used].map(n => `<option value="${esc(n)}">`).join('')}</datalist></div>
    <div class="field" style="max-width:140px"><label class="label" for="evMin">Minute</label><input class="input" id="evMin" type="number" min="0" max="120" value="${minuteNow(m)}"></div>
    <div class="dlg-a"><button type="button" class="btn ghost" id="evSkip">${after ? 'Skip' : 'Cancel'}</button><button type="button" class="btn primary" id="evGo">${k === 'try' ? 'Next: conversion' : 'Add'}</button></div>`, d => {
    wireSegs(d);
    d.querySelectorAll('.chip').forEach(c => c.onclick = () => { d.querySelector('#evWho').value = c.dataset.name; d.querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', x === c)); });
    const commit = list => save(dd => { const x = dd.matches.find(y => y.id === m.id); list.forEach(e => x.events.push(e)); }, m.id);
    d.querySelector('#evSkip').onclick = () => { closeDialog(); if (after) commit(pending); };
    d.querySelector('#evGo').onclick = () => {
      const ev = {id:uid(), k, s, p:d.querySelector('#evWho').value.trim().slice(0, 40), m:Math.max(0, Math.min(120, parseInt(d.querySelector('#evMin').value, 10) || 0)), at:Math.round(elapsed(m)), ts:Date.now()};
      if (kick && d.querySelector('[data-seg="res"]').dataset.val === 'miss') ev.miss = true;
      closeDialog();
      if (k === 'try') openEv(m, 'con', s, [ev]);
      else commit((pending || []).concat([ev]));
    };
  });
}
/* match details */
const COMPS = ['Ulster Schools’ Cup','Ulster Schools’ Bowl','Ulster Schools’ Shield','Ulster Schools’ Plate','Medallion Shield','Medallion Plate','Medallion Bowl','Subsidiary Cup','Ulster Schools’ Girls’ Cup','Friendly'];
const TEAMS = ['1st XV','2nd XV','3rd XV','Medallion XV','U14 XV','U13 XV','Girls 1st XV','Girls 7s'];
function matchForm(m, past){
  const isNew = !m; m = m || {home:'ERGS', away:'', us:'H', team:'1st XV', comp:'', round:'', venue:'', ko:'', code:'union', half:35, veo:'', players:[]};
  let ko = m.ko && !m.koTbc ? m.ko.slice(0, 16) : m.ko ? m.ko.slice(0, 10) + 'T12:00' : ''; if (!ko){ const d = new Date(); d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0); ko = new Date(d - d.getTimezoneOffset()*60000).toISOString().slice(0, 16); }
  const noPts = !(m.events || []).some(e => ptsOf(e)), showFinal = past || (m.status === 'FT' && noPts), fin = Array.isArray(m.final) ? m.final : ['', ''];
  const opps = Object.values(DATA.schools || {}).map(s => s.name).filter(Boolean);
  openDialog(`<h2>${isNew ? (past ? 'Add a past result' : 'New match') : 'Match details'}</h2>
    <div class="row2"><div class="field"><label class="label" for="fHome">Home team</label><input class="input" id="fHome" list="oppNames" maxlength="50" value="${esc(m.home)}"></div><div class="field"><label class="label" for="fAway">Away team</label><input class="input" id="fAway" list="oppNames" maxlength="50" value="${esc(m.away)}"></div></div>
    <datalist id="oppNames">${opps.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    <div class="row2"><div class="field"><span class="label">ERGS are</span>${seg('us', [['H','Home'],['A','Away']], usOf(m) || 'H')}</div><div class="field"><label class="label" for="fTeam">Our team</label><input class="input" id="fTeam" list="teamNames" maxlength="30" value="${esc(m.team || '')}"><datalist id="teamNames">${TEAMS.map(t => `<option value="${esc(t)}">`).join('')}</datalist></div></div>
    <div class="row2"><div class="field"><label class="label" for="fComp">Competition</label><input class="input" id="fComp" list="compNames" maxlength="50" value="${esc(m.comp || '')}"><datalist id="compNames">${COMPS.map(t => `<option value="${esc(t)}">`).join('')}</datalist></div><div class="field"><label class="label" for="fRound">Round</label><input class="input" id="fRound" maxlength="30" value="${esc(m.round || '')}" placeholder="Quarter-final"></div></div>
    <div class="row2"><div class="field"><label class="label" for="fVenue">Venue</label><input class="input" id="fVenue" maxlength="50" value="${esc(m.venue || '')}"></div><div class="field"><label class="label" for="fKo">Kick-off</label><input class="input" id="fKo" type="datetime-local" value="${esc(ko)}"></div></div>
    <div class="row2"><div class="field"><span class="label">Code</span>${seg('code', [['union','15s'],['sevens','7s']], m.code || 'union')}</div><div class="field"><label class="label" for="fHalf">Half length (min)</label><input class="input" id="fHalf" type="number" min="3" max="45" value="${esc(m.half || 35)}"></div></div>
    ${showFinal ? `<div class="row2"><div class="field"><label class="label" for="fHs">Home score</label><input class="input" id="fHs" type="number" min="0" value="${esc(fin[0])}"></div><div class="field"><label class="label" for="fAs">Away score</label><input class="input" id="fAs" type="number" min="0" value="${esc(fin[1])}"></div></div>` : ''}
    ${past ? '' : `<div class="field"><label class="label" for="fPlayers">Our players for the scorer’s buttons (one per line, e.g. “10 Kristen Fee”)</label><textarea class="input" id="fPlayers" rows="4" placeholder="Paste from the main app: Squads, Copy for live scoring">${esc((m.players || []).map(p => (p.n ? p.n + ' ' : '') + p.name).join('\n'))}</textarea></div>`}
    <div class="field"><label class="label" for="fVeo">VEO link (optional)</label><input class="input" id="fVeo" type="url" maxlength="300" value="${esc(m.veo || '')}" placeholder="https://app.veo.co/matches/…"></div>
    <div class="dlg-a"><button type="button" class="btn ghost" data-close>Cancel</button><button type="button" class="btn primary" id="fGo">${isNew ? (past ? 'Add result' : 'Create match') : 'Save'}</button></div>`, d => {
    wireSegs(d);
    const halfIn = d.querySelector('#fHalf'); d.querySelector('[data-seg="code"]').addEventListener('change', e => { const v = e.target.dataset.val; if (+halfIn.value === 35 || +halfIn.value === 7) halfIn.value = v === 'sevens' ? 7 : 35; });
    d.querySelector('[data-seg="us"]').addEventListener('change', () => { const h = d.querySelector('#fHome'), a = d.querySelector('#fAway'), v = d.querySelector('[data-seg="us"]').dataset.val; if ((v === 'A' && OUR_RX.test(h.value)) || (v === 'H' && OUR_RX.test(a.value))){ const t = h.value; h.value = a.value; a.value = t; } });
    d.querySelector('#fGo').onclick = () => {
      const g = id => d.querySelector(id) ? d.querySelector(id).value.trim() : '';
      const f = {home:g('#fHome'), away:g('#fAway'), us:d.querySelector('[data-seg="us"]').dataset.val, team:g('#fTeam'), comp:g('#fComp'), round:g('#fRound'), venue:g('#fVenue'), ko:g('#fKo'), koTbc:false, code:d.querySelector('[data-seg="code"]').dataset.val, half:Math.max(3, Math.min(45, +g('#fHalf') || 35)), veo:g('#fVeo')};
      if (!f.home || !f.away){ toast('Enter both team names.'); return; }
      if (f.veo && !/^https:\/\//i.test(f.veo)){ toast('The VEO link must start with https://'); return; }
      if (d.querySelector('#fPlayers')) f.players = g('#fPlayers').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map((l, i) => { const mm2 = l.match(/^(\d{1,2})[.)]?\s+(.+)$/); return mm2 ? {n:+mm2[1], name:mm2[2].replace(/\s*\([^)]*\)\s*$/, '').trim()} : {n:i + 1, name:l.replace(/\s*\([^)]*\)\s*$/, '').trim()}; });
      if (d.querySelector('#fHs')){ if (g('#fHs') === '' || g('#fAs') === ''){ toast('Enter both scores.'); return; } f.final = [+g('#fHs'), +g('#fAs')]; }
      closeDialog();
      if (isNew){ const id = uid(); save(dd => dd.matches.push(Object.assign({id, status:past ? 'FT' : 'pre', clock:{base:0, since:0, running:false}, events:[], created:Date.now()}, f)), past ? null : id); }
      else save(dd => Object.assign(dd.matches.find(y => y.id === m.id), f), m.id);
    };
  });
}
/* coach actions */
function act(a, m){
  const now = Date.now(), el = () => elapsed(m), upd = fn => save(d => fn(d.matches.find(y => y.id === m.id)), m.id);
  switch (a){
    case 'cleardemo': return ask('Start real scoring?', 'This removes all the example matches for everyone. You can then add your fixtures.', 'Clear the examples', () => save(d => { d.demo = false; d.matches = []; d.schools = {}; }, null));
    case 'new': return matchForm(null);
    case 'signout': return FB.signOut().then(() => { COACH = false; ADMIN = false; render(); toast('Signed out.'); });
    case 'coaches': return coachesDialog();
    case 'tomain': return copy('ERGSLIVE1:' + JSON.stringify({matches:RAW.matches || [], at:Date.now()}), 'Copied. In the main app: Live scores, Import from ERGS Live, paste.');
    case 'seed': return fetch('seed.json', {cache:'no-store'}).then(r => r.ok ? r.json() : {matches:[], schools:{}}).catch(() => ({matches:[], schools:{}})).then(seed => save(d => { d.matches = seed.matches || []; d.schools = seed.schools || {}; d.demo = false; }, null));
    case 'past': return matchForm(null, true);
    case 'import': return importDialog();
    case 'schools': return schoolsDialog();
    case 'edit': return matchForm(m);
    case 'ko': return upd(x => { x.status = '1H'; x.clock = {base:0, since:now, running:true}; });
    case 'ht': return upd(x => { x.status = 'HT'; x.clock = {base:el(), since:0, running:false}; });
    case '2h': return upd(x => { x.status = '2H'; x.clock = {base:Math.max(el(), (+x.half || 35)*60), since:now, running:true}; });
    case 'ft': return ask('Blow full time?', 'The clock stops and the match moves to Results for everyone.', 'Full time', () => upd(x => { x.status = 'FT'; x.clock = {base:el(), since:0, running:false}; }));
    case 'pause': return upd(x => { const r = x.clock && x.clock.running; x.clock = r ? {base:el(), since:0, running:false} : {base:el(), since:now, running:true}; });
    case 'minus': return upd(x => { x.clock = {base:Math.max(0, el() - 60), since:now, running:!!(x.clock && x.clock.running)}; });
    case 'plus': return upd(x => { x.clock = {base:el() + 60, since:now, running:!!(x.clock && x.clock.running)}; });
    case 'reopen': return upd(x => { x.status = '2H'; x.clock = Object.assign({}, x.clock, {running:false}); });
    case 'del': return ask('Delete this match?', `${m.home} v ${m.away} and its timeline will be removed for everyone.`, 'Delete', () => save(d => { d.matches = d.matches.filter(y => y.id !== m.id); }, null));
    case 'share': { const link = location.origin + location.pathname + '#m.' + m.id; copy(link, 'Match link copied. Anyone can open it, no sign-in needed.'); return; }
    case 'copyres': { const [h, aa] = score(m), sc = s => ['try','pt','con','pen','dg'].map(k => { const l = sorted(m).filter(e => e.s === s && e.k === k && !e.miss); if (!l.length) return ''; const names = l.map(e => e.p ? e.p.split(/\s+/).pop() : '').filter(Boolean); return ({try:'Try',pt:'Pen try',con:'Con',pen:'Pen',dg:'DG'})[k] + (names.length ? ': ' + names.join(', ') : ' ' + l.length); }).filter(Boolean).join('\n');
      copy(`${m.home} ${h} – ${aa} ${m.away}\n${compLine(m)}\n\n${m.home}\n${sc('H')}\n\n${m.away}\n${sc('A')}`.trim(), 'Result copied. Paste it into the full-time graphic in the main app.'); return; }
  }
}
function copy(text, ok){ try { navigator.clipboard.writeText(text).then(() => toast(ok), () => showCopy(text)); } catch(e){ showCopy(text); } }
function showCopy(text){ openDialog(`<h2>Copy this</h2><textarea class="input" rows="6" readonly id="copyBox">${esc(text)}</textarea><div class="dlg-a"><button type="button" class="btn primary" data-close>Done</button></div>`, d => { const t = d.querySelector('#copyBox'); t.focus(); t.select(); }); }

/* ---------- school crests ---------- */
function fileToImage(file){ return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('img')); im.src = r.result; }; r.onerror = rej; r.readAsDataURL(file); }); }
function shrink(im, max){ const k = Math.min(1, max/Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.naturalWidth*k)); c.height = Math.max(1, Math.round(im.naturalHeight*k)); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); return c; }
function mainColour(c){ const x = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, B = new Map(); for (let i = 0; i < x.length; i += 16){ if (x[i+3] < 170) continue; const r = x[i], g = x[i+1], b = x[i+2], mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx > 235 && mn > 220) continue; const k = (r >> 5) << 6 | (g >> 5) << 3 | (b >> 5), w = 1 + (mx - mn)/60, o = B.get(k) || {w:0, r:0, g:0, b:0, n:0}; o.w += w; o.r += r; o.g += g; o.b += b; o.n++; B.set(k, o); } const best = [...B.values()].sort((a, b) => b.w - a.w)[0]; if (!best) return '#3A4466'; return '#' + [best.r, best.g, best.b].map(v => Math.round(v/best.n).toString(16).padStart(2, '0')).join(''); }
function schoolsDialog(){
  const names = new Set(); DATA.matches.forEach(m => [m.home, m.away].forEach(n => { if (n && !OUR_RX.test(n)) names.add(n); }));
  Object.values(DATA.schools || {}).forEach(s => s.name && names.add(s.name));
  const list = [...names].sort();
  openDialog(`<h2>School crests</h2><p>Add each school’s crest once and it shows on every match against them. Small images keep the page quick for supporters.</p>
    ${list.length ? `<div class="schs">${list.map(n => { const s = school(n) || {}; return `<div class="sch">${crest(n)}<span>${esc(n)}</span><label class="btn ghost small">Crest<input type="file" accept="image/*" hidden data-crest="${esc(n)}"></label><input type="color" value="${esc(s.color || '#3A4466')}" data-col="${esc(n)}" aria-label="Colour for ${esc(n)}"></div>`; }).join('')}</div>` : '<div class="empty">Add a match first; its opponent appears here.</div>'}
    <div class="dlg-a"><button type="button" class="btn primary" data-close>Done</button></div>`, d => {
    d.querySelectorAll('[data-crest]').forEach(inp => inp.onchange = async () => { const f = inp.files[0]; if (!f) return; const n = inp.dataset.crest;
      try { const im = await fileToImage(f), c = shrink(im, 96), url = c.toDataURL('image/webp', 0.85), col = mainColour(c); closeDialog(); save(dd => { dd.schools = dd.schools || {}; const k = schoolKey(n); dd.schools[k] = Object.assign({}, dd.schools[k], {name:n, crest:url, color:(dd.schools[k] || {}).color || col}); }); }
      catch(e){ toast('That image could not be opened.'); } });
    d.querySelectorAll('[data-col]').forEach(inp => inp.onchange = () => { const n = inp.dataset.col; closeDialog(); save(dd => { dd.schools = dd.schools || {}; const k = schoolKey(n); dd.schools[k] = Object.assign({name:n}, dd.schools[k], {color:inp.value}); }); });
  });
}

/* ---------- import fixtures ---------- */
const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
function seasonYear(mon){ const now = new Date(), start = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1; return mon >= 7 ? start : start + 1; }
function parseDate(s){
  s = String(s || '').trim().toLowerCase(); if (!s) return '';
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  m = s.match(/(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?/); if (m){ const mo = +m[2] - 1; let y = m[3] ? +m[3] : seasonYear(mo); if (y < 100) y += 2000; if (mo >= 0 && mo < 12) return `${y}-${String(mo + 1).padStart(2,'0')}-${m[1].padStart(2,'0')}`; }
  m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,})\.?(?:\s+(\d{4}))?/); if (m){ const mo = MONTHS.indexOf(m[2].slice(0,3)); if (mo >= 0){ const y = m[3] ? +m[3] : seasonYear(mo); return `${y}-${String(mo + 1).padStart(2,'0')}-${m[1].padStart(2,'0')}`; } }
  m = s.match(/([a-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/); if (m){ const mo = MONTHS.indexOf(m[1].slice(0,3)); if (mo >= 0){ const y = m[3] ? +m[3] : seasonYear(mo); return `${y}-${String(mo + 1).padStart(2,'0')}-${m[2].padStart(2,'0')}`; } }
  return '';
}
function parseTime(s){ s = String(s || '').toLowerCase(); let m = s.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?/); if (m){ let h = +m[1]; if (m[3] === 'pm' && h < 12) h += 12; if (m[3] === 'am' && h === 12) h = 0; if (h < 24) return `${String(h).padStart(2,'0')}:${m[2]}`; }
  m = s.match(/\b(\d{1,2})\s*(am|pm)\b/); if (m){ let h = +m[1]; if (m[2] === 'pm' && h < 12) h += 12; return `${String(h).padStart(2,'0')}:00`; } return ''; }
const haOf = s => { s = String(s || '').trim().toLowerCase(); return /^(h|home)$/.test(s) ? 'H' : /^(a|away)$/.test(s) ? 'A' : ''; };
function parseFixtureText(text){
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean); if (!lines.length) return [];
  const delim = lines.some(l => l.includes('|')) ? '|' : lines.some(l => l.includes('\t')) ? '\t' : lines.filter(l => l.includes(',')).length >= lines.length*0.6 ? ',' : null;
  const split = l => l.split(delim).map(x => x.trim().replace(/^"|"$/g, ''));
  const out = [];
  if (delim){
    let idx = null; const head = split(lines[0]).map(h => h.toLowerCase());
    if (head.some(h => /date/.test(h)) && head.some(h => /opp|vs|versus|against|^v$|team|fixture/.test(h))){
      const find = rx => head.findIndex(h => rx.test(h));
      idx = {date:find(/date|day/), time:find(/time|ko|kick/), team:find(/^team|squad|age|^xv/), opp:find(/opp|vs|versus|against|^v$|fixture/), ha:find(/h\/a|home|^ha$|^venue type/), venue:find(/venue|ground|location|where/), comp:find(/comp|cup|league|type/)};
      lines.shift();
    }
    for (const l of lines){ const c = split(l); let f;
      if (idx) f = {date:parseDate(c[idx.date]), time:parseTime(idx.time >= 0 ? c[idx.time] : c[idx.date]), team:idx.team >= 0 ? c[idx.team] : '', opp:idx.opp >= 0 ? c[idx.opp] : '', ha:idx.ha >= 0 ? haOf(c[idx.ha]) : '', venue:idx.venue >= 0 ? c[idx.venue] : '', comp:idx.comp >= 0 ? c[idx.comp] : ''};
      else f = {date:parseDate(c[0]), team:c[1] || '', opp:c[2] || '', ha:haOf(c[3]), time:parseTime(c[4] || c[0]), comp:c[5] || '', venue:c[6] || ''};
      f.opp = (f.opp || '').replace(/^(v|vs)\.?\s+/i, '').trim();
      if (f.date && f.opp) out.push(f); }
  } else {
    for (const l of lines){ const date = parseDate(l), vs = l.match(/\b(?:v|vs|versus)\.?\s+(.+?)(?:\s*\((h|a|home|away)\)|\s+(?:home|away)\b|\s+\d{1,2}[:.]\d{2}|$)/i);
      if (!date || !vs) continue; const ha = (l.match(/\((h|a|home|away)\)/i) || l.match(/\b(home|away)\b/i) || [])[1];
      const before = l.slice(0, l.toLowerCase().indexOf(vs[0].toLowerCase())).replace(/^.*?\d{4}|^.*?\d{1,2}(?:st|nd|rd|th)?\s+[a-z]{3,}\.?/i, '').trim();
      out.push({date, time:parseTime(l), team:before.replace(/^[,\-–:]+|[,\-–:]+$/g, '').trim(), opp:vs[1].trim(), ha:haOf(ha), venue:'', comp:''}); }
  }
  return out;
}
/* =============================== READING TEAM SHEETS (photos and PDFs) =============================== */
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
function loadScript(src){ return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('script')); document.head.appendChild(s); }); }
let pdfReady = null;
function pdfLib(){
  if (!pdfReady){ pdfReady = (async () => { await loadScript(PDFJS + 'pdf.min.js'); await loadScript(PDFJS + 'pdf.worker.min.js'); const lib = window.pdfjsLib; lib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; return lib; })(); pdfReady.catch(() => { pdfReady = null; }); }
  return pdfReady;
}
const isPdf = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
async function fileToImages(file, lim, maxPages){
  const types = lim.mediaTypes || [];
  if (isPdf(file)){
    if (types.includes('application/pdf') && file.size <= lim.maxInputBytes) return [file];
    const lib = await pdfLib(), doc = await lib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise, out = [];
    for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++){
      const pg = await doc.getPage(i), v0 = pg.getViewport({scale:1}), vp = pg.getViewport({scale:Math.min(2.5, 1800/Math.max(v0.width, v0.height))});
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      await pg.render({canvasContext:x, viewport:vp}).promise; out.push(await canvasBlob(c, 'image/jpeg', 0.86));
    }
    return out;
  }
  if (types.includes(file.type) && file.size <= lim.maxInputBytes) return [file];
  return [await canvasBlob(imageToCanvas(await fileToImage(file), 1800), 'image/jpeg', 0.88)];
}
function canvasBlob(c, type, q){ return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('blob')), type, q)); }
function imageToCanvas(im, max){ return shrink(im, max); }
function importDialog(){
  openDialog(`<h2>Import fixtures</h2><p>Paste the fixtures list or upload a CSV${SAMPLE ? ', photo or PDF' : ''}. One line per fixture works best, e.g. <b>Sat 7 Feb 2026 | 1st XV | Banbridge Academy | H | 10:30 | Schools’ Bowl</b>.</p>
    <div class="ctrl"><label class="btn">Upload ${SAMPLE ? 'photo, PDF or CSV' : 'CSV'}<input type="file" id="impFile" accept="${SAMPLE ? 'image/*,application/pdf,' : ''}.csv,.txt,text/csv,text/plain" multiple hidden></label></div>
    <textarea class="input" id="impText" rows="5" aria-label="Fixtures list"></textarea>
    <div class="ctrl"><button type="button" class="btn" id="impRead">Read the list</button><span class="hint" id="impMsg" aria-live="polite"></span></div>
    <div id="impPrev"></div>
    <div class="dlg-a"><button type="button" class="btn ghost" data-close>Cancel</button><button type="button" class="btn primary" id="impAdd" disabled>Add fixtures</button></div>`, d => {
    let rows = [];
    const msg = t => d.querySelector('#impMsg').textContent = t;
    const show = list => { rows = list.map(r => Object.assign({on:!exists(r)}, r)); d.querySelector('#impPrev').innerHTML = rows.length ? `<div class="tbl"><table><thead><tr><th></th><th>Date</th><th>KO</th><th>Team</th><th>Opponent</th><th>H/A</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td><input type="checkbox" data-i="${i}" ${r.on ? 'checked' : ''} aria-label="Include"></td><td>${esc(new Date(r.date + 'T12:00').toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'}))}</td><td>${esc(r.time || 'TBC')}</td><td>${esc(r.team || '–')}</td><td>${esc(r.opp)}${exists(r) ? ' <small>(already added)</small>' : ''}</td><td>${esc(r.ha || '–')}</td></tr>`).join('')}</tbody></table></div>` : '';
      d.querySelectorAll('[data-i]').forEach(c => c.onchange = () => { rows[+c.dataset.i].on = c.checked; count(); }); count(); };
    const count = () => { const n = rows.filter(r => r.on).length; const b = d.querySelector('#impAdd'); b.disabled = !n; b.textContent = `Add ${n} ${n === 1 ? 'fixture' : 'fixtures'}`; };
    d.querySelector('#impRead').onclick = async () => { const t = d.querySelector('#impText').value.trim(); if (!t){ msg('Paste the list first.'); return; }
      let r = parseFixtureText(t); if (r.length){ msg(`Found ${r.length} fixtures. Untick any you don’t want.`); show(r); return; }
      if (!SAMPLE){ msg('That list couldn’t be read. Use one line per fixture: date | team | opponent | H or A | time.'); return; }
      try { r = await readWithClaude(t, null, msg); msg(r.length ? `Found ${r.length} fixtures.` : 'No fixtures were found.'); show(r); } catch(e){ msg(sampleErr(e)); } };
    d.querySelector('#impFile').onchange = async e => { const files = [...e.target.files]; e.target.value = ''; let r = [];
      const texts = files.filter(f => /\.(csv|txt)$/i.test(f.name) || /^text\//.test(f.type)), pics = files.filter(f => !texts.includes(f));
      for (const f of texts){ const t = await f.text(); const got = parseFixtureText(t); if (got.length) r = r.concat(got); else d.querySelector('#impText').value += t; }
      if (pics.length && SAMPLE){ try { r = r.concat(await readWithClaude('', pics, msg)); } catch(err){ msg(sampleErr(err)); } }
      if (r.length){ msg(`Found ${r.length} fixtures. Untick any you don’t want.`); show(r); } };
    d.querySelector('#impAdd').onclick = () => { const pick = rows.filter(r => r.on); if (!pick.length) return; closeDialog();
      save(dd => pick.forEach((r, i) => { const us = r.ha || 'H', sev = /7s|vii|sevens/i.test(r.team + ' ' + r.comp);
        dd.matches.push({id:uid(), home:us === 'H' ? 'ERGS' : r.opp, away:us === 'H' ? r.opp : 'ERGS', us, team:r.team, comp:r.comp, round:'', venue:r.venue, ko:r.date + 'T' + (r.time || '12:00'), koTbc:!r.time, code:sev ? 'sevens' : 'union', half:sev ? 7 : 35, veo:'', status:'pre', clock:{base:0, since:0, running:false}, events:[], created:Date.now() + i}); }), null); };
  });
}
function exists(r){ return DATA.matches.some(m => { const opp = usOf(m) === 'A' ? m.home : m.away; return (m.ko || '').slice(0, 10) === r.date && schoolKey(opp) === schoolKey(r.opp); }); }
let SAMPLE = null;
function sampleErr(e){ const c = e && e.code; return c === 'not_granted' ? 'Reading photos needs your permission. Allow it when asked, or paste the list.' : c === 'rate_limited' ? 'Too many requests just now. Wait a minute and try again.' : 'That couldn’t be read. Try again, or paste the list.'; }
async function readWithClaude(text, files, onMsg){
  const lim = (await SAMPLE.limits()).images; let imgs = [];
  if (files && files.length){ if (!lim) throw {code:'images_unavailable'}; for (const f of files){ onMsg(`Preparing ${f.name}…`); try { imgs = imgs.concat(await fileToImages(f, lim, 6)); } catch(e){ onMsg(`${f.name} could not be opened.`); } } imgs = imgs.slice(0, lim.maxCount || 5); }
  onMsg('Reading the fixtures… this can take up to a minute.');
  const today = new Date().toISOString().slice(0, 10);
  const r = await SAMPLE.json(`Extract every rugby fixture for Enniskillen Royal Grammar School (ERGS) from ${imgs.length ? 'these images' : 'this text'}. Today is ${today}; the season runs August to June, so infer missing years from that.
For each fixture give: date (YYYY-MM-DD), kick-off time (HH:MM 24-hour, or ""), our team ("1st XV", "U14", "Medallion XV", "Girls 7s"…, or ""), the opponent's name, homeAway ("H", "A" or ""), venue ("" if not given) and competition (or "").
Leave out byes, training and anything that is not a match. Reply with only JSON: {"fixtures":[{"date":"2026-02-07","time":"10:30","team":"1st XV","opponent":"Banbridge Academy","homeAway":"H","venue":"","competition":"Ulster Schools' Bowl"}]}${text ? '\n\nThe list:\n' + text.slice(0, 20000) : ''}`, imgs.length ? {images:imgs} : {});
  return (r && Array.isArray(r.fixtures) ? r.fixtures : []).map(f => ({date:/^\d{4}-\d{2}-\d{2}$/.test(f.date || '') ? f.date : parseDate(f.date), time:/^\d{2}:\d{2}$/.test(f.time || '') ? f.time : parseTime(f.time), team:String(f.team || ''), opp:String(f.opponent || ''), ha:haOf(f.homeAway), venue:String(f.venue || ''), comp:String(f.competition || '')})).filter(f => f.date && f.opp);
}

/* ---------- score animation for supporters ---------- */
const fx = $('#fx'), Q = []; let busy = false;
function playFx(){
  const nx = Q.shift(); if (!nx){ busy = false; return; } busy = true;
  const [m, e] = nx, team = e.s === 'H' ? m.home : m.away, [h, a] = score(m);
  const lab = e.k === 'try' ? 'TRY!' : e.k === 'pt' ? 'PENALTY TRY' : e.k === 'con' ? 'CONVERTED' : e.k === 'pen' ? 'PENALTY GOAL' : e.k === 'dg' ? 'DROP GOAL' : e.k === 'yc' ? 'YELLOW CARD' : 'RED CARD';
  fx.className = 'fx k-' + e.k; fx.style.setProperty('--tc', e.k === 'yc' ? '#F3C443' : e.k === 'rc' ? '#E5483B' : ((school(team) || {}).color || '#3A4466'));
  $('#fxCrest').innerHTML = crest(team, 'huge');
  $('#fxKind').innerHTML = lab.split('').map((c, i) => `<span style="--i:${i}">${c === ' ' ? '&nbsp;' : esc(c)}</span>`).join('');
  $('#fxWho').textContent = [e.p, team].filter(Boolean).join(' · ');
  $('#fxScore').textContent = ptsOf(e) ? `${m.home} ${h} – ${a} ${m.away}` : '';
  const burst = $('#fxBurst'); burst.innerHTML = '';
  if (ptsOf(e)) for (let i = 0; i < 28; i++){ const s = document.createElement('i'), ang = Math.random()*Math.PI*2, d = 140 + Math.random()*260; s.style.cssText = `--x:${Math.cos(ang)*d}px;--y:${Math.sin(ang)*d}px;--d:${(Math.random()*.25).toFixed(2)}s;--s:${(.6 + Math.random()*.9).toFixed(2)}`; burst.appendChild(s); }
  fx.hidden = false; void fx.offsetWidth; fx.classList.add('on');
  try { if (navigator.vibrate && ptsOf(e)) navigator.vibrate([120, 60, 120]); } catch(err){}
  const close = () => { fx.classList.remove('on'); fx.classList.add('off'); setTimeout(() => { fx.hidden = true; fx.classList.remove('off'); playFx(); }, 420); };
  clearTimeout(playFx.t); playFx.t = setTimeout(close, ptsOf(e) ? 3000 : 2300); fx.onclick = () => { clearTimeout(playFx.t); close(); };
}
function newSinceLastLook(){
  let seen = null; try { seen = JSON.parse(localStorage.getItem('ergsLive.seen') || 'null'); } catch(e){}
  const now = {};
  for (const m of DATA.matches.filter(isLive)){ now[m.id] = (m.events || []).map(e => e.id);
    if (!COACH && seen && seen[m.id]) for (const e of sorted(m)) if (!seen[m.id].includes(e.id) && e.k !== 'note' && !e.miss && Date.now() - (e.ts || 0) < 15*60e3) Q.push([m, e]); }
  try { localStorage.setItem('ergsLive.seen', JSON.stringify(now)); } catch(e){}
  if (Q.length && !busy){ busy = true; setTimeout(playFx, 500); }
}
$('#demoTry').onclick = () => {
  const m = DATA.matches.find(isLive); if (!m) return;
  const e = {id:'d' + Date.now(), k:'try', s:'H', p:'Example player', m:minuteNow(m), at:Math.round(elapsed(m)), ts:Date.now()};
  m.events.push(e); V.open = null; V.tab = 'matches'; render(); Q.push([m, e]); if (!busy) playFx();
};

/* ---------- coaches list (admin only) ---------- */
async function coachesDialog(){
  let list = []; try { list = await FB.listCoaches(); } catch(e){ toast('Couldn’t load the coaches list.'); return; }
  openDialog(`<h2>Coaches</h2><p>People who can score. They sign in with this Google account.</p>
    <div class="schs">${[CFG.admin].concat(list.filter(x => x !== CFG.admin)).filter(Boolean).map(e => `<div class="sch" style="grid-template-columns:minmax(0,1fr) auto"><span>${esc(e)}${e === CFG.admin ? ' <small>(admin)</small>' : ''}</span>${e === CFG.admin ? '' : `<button type="button" class="btn ghost small danger" data-rmc="${esc(e)}">Remove</button>`}</div>`).join('')}</div>
    <form class="inline" id="addC"><input class="input" id="addCIn" type="email" placeholder="coach@gmail.com" aria-label="Coach's Google email"><button class="btn" type="submit">Add</button></form>
    <div class="dlg-a"><button type="button" class="btn primary" data-close>Done</button></div>`, d => {
    d.querySelector('#addC').onsubmit = async ev => { ev.preventDefault(); const e = d.querySelector('#addCIn').value.trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)){ toast('Enter their full email address.'); return; }
      try { await FB.addCoach(e); closeDialog(); coachesDialog(); toast(e + ' can now score.'); } catch(err){ toast('Couldn’t add them. Only the admin can.'); } };
    d.querySelectorAll('[data-rmc]').forEach(b => b.onclick = async () => { try { await FB.removeCoach(b.dataset.rmc); closeDialog(); coachesDialog(); } catch(err){ toast('Couldn’t remove them.'); } });
  });
}

/* ---------- start ---------- */
function stamp(){ $('#updated').textContent = DATA.updated ? 'Last update ' + new Date(DATA.updated).toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'}) : ''; }
const hm = location.hash.match(/^#m\.([A-Za-z0-9_-]+)$/); if (hm) V.open = hm[1];
$('#view').innerHTML = '<div class="empty">Connecting to the scoreboard…</div>';
$('#tabs').hidden = true;
function applyState(s){
  const base = {matches:[], schools:{}, crest:window.ERGS_CREST || ''};
  Object.keys(RAW).forEach(k => delete RAW[k]); Object.assign(RAW, base, s || {}, {crest:window.ERGS_CREST || (s && s.crest) || ''});
  const d = clone(RAW); d.demo = false; Object.keys(DATA).forEach(k => delete DATA[k]); Object.assign(DATA, d);
  if (V.open && !DATA.matches.some(m => m.id === V.open) && !READY) V.open = null;
  READY = true; stamp(); newSinceLastLook();
  if (!$('#modal').hidden) pendingRender = true; else render();
}
// footer: coach sign-in
const signLink = document.createElement('button'); signLink.type = 'button'; signLink.className = 'linkish'; signLink.textContent = 'Coach sign in';
$('footer').appendChild(signLink);
signLink.onclick = async () => { try { await FB.signIn(); } catch(e){ toast(/popup/.test(e && e.code || '') ? 'Allow pop-ups for this site, then try again.' : 'Sign-in didn’t finish. Try again.'); } };
function boot(){
  const FB = window.FB;
  if (!FB){ $('#view').innerHTML = '<div class="empty">The scoreboard isn’t connected yet. (Setup: add the Firebase details to config.js.)</div>'; return; }
  FB.onState((s, exists) => { HAS_DOC = exists; applyState(s); }, err => { console.error(err); $('#view').innerHTML = '<div class="empty">Couldn’t reach the scoreboard. Check your signal; it reconnects by itself.</div>'; });
  FB.onAuth(async user => {
    EMAIL = user && user.email ? user.email.toLowerCase() : ''; ADMIN = !!EMAIL && EMAIL === String(CFG.admin || '').toLowerCase();
    let ok = ADMIN; if (EMAIL && !ok){ try { ok = await FB.isCoach(EMAIL); } catch(e){ ok = false; } }
    COACH = ok; signLink.hidden = !!EMAIL;
    if (EMAIL && !ok) toast(`Signed in as ${EMAIL}, which isn’t a coach. The admin is ${CFG.admin}.`);
    if (READY) render();
  });
}
if (window.FB) boot(); else window.addEventListener('fb-ready', boot, {once:true});
setTimeout(() => { if (!window.FB) boot(); }, 8000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && READY) render(); });
})();
