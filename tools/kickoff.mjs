// Match alerts (ERGS Live). Run by .github/workflows/kickoff.yml, which keeps one copy of this watching all day.
// Every few minutes it reads the public fixture list and compares it with what it saw last time. A phone that asked (the bell
// in ERGS Live) is told, for the teams and the kinds of news it chose:
//   ko      about 15 minutes before kick-off (a coach's also says to open ERGS Live and press Kick off)
//   ft      the score at full time
//   chg     a match postponed, cancelled, back on, or moved to a new time or venue
//   team    the line-up for a coming match going up
//   photos  anything a coach's app puts in the short public queue (pushq): today, a new photo album
// It needs one secret, VAPID_PRIVATE, which proves the notifications come from ERGS Live. Without it the job does nothing.
import fs from 'node:fs';
const PUB = 'BA9NLSI-WJiIH_vQ5UxTKmkbeZem57vXJKMfRFdzzpY0FQd7aumvKuCmg3lqPlyUdhJI23L2oUupCeGSZxEvz9U';
const PRIV = (process.env.VAPID_PRIVATE || '').trim();
const BASE = 'https://firestore.googleapis.com/v1/projects/ergs-live/databases/(default)/documents/';
const SITE = 'https://popcorn483.github.io/ergs-live/';
const SENT_FILE = process.argv[2] || '.kickoff-sent.json';
const RUN_MIN = +(process.env.RUN_MIN || 33), EVERY_S = +(process.env.EVERY_S || 150);
const AHEAD = 16*60e3, LATE = 10*60e3;          // remind from 16 minutes before until 10 minutes after the time set
const DRY = !!process.env.DRY;

export function teamCode(t){
  const x = String(t || '').toLowerCase().replace(/[’'.]/g, '').replace(/\s+/g, ' ').trim(); if (!x) return '';
  const girls = /\b(girl|girls|women|ladies|sg|jg)\b/.test(x);
  if (girls) return /\b(junior|jg|u1[2-5]|under 1[2-5]|minis?)\b/.test(x) ? 'JG' : 'SG';
  if (/\b(meds?|medallions?)\b/.test(x)) return 'Meds';
  const u = x.match(/\b(?:u|under ?)(1[2-9])s?\b/); if (u) return ['12','13','14','16'].includes(u[1]) ? 'U' + u[1] : u[1] === '15' ? 'Meds' : 'U16';
  if (/\b(1st|first|1)\s*(xv|15s?)\b|\b1xv\b|\bseniors?\b/.test(x)) return '1XV';
  if (/\b(2nd|second|2)\s*(xv|15s?)\b|\b2xv\b/.test(x)) return '2XV';
  if (/\b(3rd|third|3)\s*(xv|15s?)\b|\b3xv\b/.test(x)) return '3XV';
  return 'Other';
}
// kick-off times are typed as UK clock time with no zone: work out the real moment, summer time or not
export function ukTime(ko){
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(String(ko || '')); if (!m) return 0;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/London', hourCycle:'h23', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'}).formatToParts(new Date(asUtc)).map(x => [x.type, x.value]));
  return asUtc - (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - asUtc);
}
export const due = (m, now) => { if (!m || m.status !== 'pre' || m.off || m.koTbc) return false; const t = ukTime(m.ko); return !!t && t - now <= AHEAD && now - t <= LATE; };
export function message(m, now, coach){
  const mins = Math.round((ukTime(m.ko) - now)/60000), ours = m.us || (/enniskillen|ergs/i.test(m.away || '') && !/enniskillen|ergs/i.test(m.home || '') ? 'A' : 'H');
  const opp = ours === 'A' ? m.home : m.away, t = String(m.ko).slice(11, 16), where = m.venue ? ' at ' + m.venue : ours === 'A' ? ' (away)' : ' (home)';
  return {title:(m.team ? m.team + ' ' : '') + (ours === 'A' ? '@ ' : 'v ') + (opp || 'opposition') + (mins > 1 ? ': kick-off in ' + mins + ' min' : ': kick-off time'),
    body:coach ? 'Open ERGS Live and press Kick off when the match starts (' + t + '), then keep the score.' : 'Kick-off ' + t + where + '. Follow the score live on ERGS Live.', tag:'ko-' + m.id, url:SITE + '#m.' + m.id};
}
const ourSide = m => m.us || (/enniskillen|ergs/i.test(m.away || '') && !/enniskillen|ergs/i.test(m.home || '') ? 'A' : 'H');
const label = m => (m.team ? m.team + ' ' : '') + (ourSide(m) === 'A' ? '@ ' : 'v ') + ((ourSide(m) === 'A' ? m.home : m.away) || 'opposition');
const whenTxt = ko => { const t = ukTime(ko); return t ? new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/London', weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).format(new Date(t)) : 'time to be confirmed'; };
const PTS = {try:5, con:2, pen:3, dg:3, pt:7};
export function score(m){ let h = 0, a = 0, any = false; for (const e of m.events || []){ const p = e.miss ? 0 : (PTS[e.k] || 0); if (p) any = true; if (e.s === 'H') h += p; else if (e.s === 'A') a += p; } return Array.isArray(m.final) && (m.finalSet || !any) ? [+m.final[0] || 0, +m.final[1] || 0] : [h, a]; }
const shot = m => ({st:m.status || '', ko:m.koTbc ? '' : (m.ko || ''), off:m.off || '', v:m.venue || '', np:(m.players || []).length});

// What is new since the last look. snap: what each match looked like then ({} the very first time, when nothing is sent).
export function news(matches, snap, now, first){
  const out = [], next = {};
  for (const m of matches || []){ if (!m || !m.id) continue; const was = snap[m.id], is = shot(m), t = ukTime(m.ko), url = SITE + '#m.' + m.id, code = teamCode(m.team); next[m.id] = is;
    if (first || !was) continue;   // a match seen for the first time is only noted: a result typed in afterwards must not ping anyone
    if (was.st !== 'FT' && is.st === 'FT' && t && Math.abs(now - t) < 8*3600e3){ const [h, a] = score(m), us = ourSide(m) === 'A' ? a : h, them = ourSide(m) === 'A' ? h : a;
      out.push({kind:'ft', code, tag:'ft-' + m.id, url, title:'Full time: ' + label(m), body:'ERGS ' + us + '–' + them + (us > them ? '. A win.' : us < them ? '.' : '. A draw.')}); }
    if (is.st === 'pre' && (!t || (t > now - 3600e3 && t - now < 21*864e5))){
      if (!was.off && is.off) out.push({kind:'chg', code, tag:'chg-' + m.id, url, title:(is.off === 'cancelled' ? 'Cancelled: ' : 'Postponed: ') + label(m), body:'Was ' + whenTxt(was.ko || m.ko) + '.'});
      else if (was.off && !is.off) out.push({kind:'chg', code, tag:'chg-' + m.id, url, title:'Back on: ' + label(m), body:whenTxt(m.ko) + (m.venue ? ' at ' + m.venue : '') + '.'});
      else if (!is.off && was.ko && is.ko && was.ko !== is.ko) out.push({kind:'chg', code, tag:'chg-' + m.id, url, title:'New time: ' + label(m), body:'Now ' + whenTxt(m.ko) + ' (was ' + whenTxt(was.ko) + ').'});
      else if (!is.off && is.v && was.v !== is.v && (was.v || is.v)) out.push({kind:'chg', code, tag:'chg-' + m.id, url, title:'Venue changed: ' + label(m), body:'Now at ' + is.v + (was.v ? ' (was ' + was.v + ')' : '') + '.'});
      if (!is.off && was.np < 10 && is.np >= 10) out.push({kind:'team', code, tag:'team-' + m.id, url, title:'Team named: ' + label(m), body:whenTxt(m.ko) + '. Tap to see the line-up.'});
    } }
  return {out, next};
}
const get = async u => { const r = await fetch(u, {signal:AbortSignal.timeout(20000)}); if (!r.ok) throw new Error(r.status + ' ' + u); return r.json(); };
async function fixtures(){ const d = await get(BASE + 'live/state'); return (JSON.parse(d.fields.json.stringValue).matches) || []; }
const str = v => (v && (v.stringValue || '')) || '', num = v => v ? +(v.integerValue || v.doubleValue || 0) : 0;
async function phones(){ const out = []; let tok = '';
  do { const d = await get(BASE + 'pushsubs?pageSize=300' + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''));
    for (const x of d.documents || []){ try { const f = x.fields || {}; out.push({id:x.name.split('/').pop(), sub:JSON.parse(f.sub.stringValue), teams:((f.teams.arrayValue || {}).values || []).map(v => v.stringValue), at:num(f.at), coach:!!(f.coach && f.coach.booleanValue),
        kinds:f.kinds ? ((f.kinds.arrayValue || {}).values || []).map(v => v.stringValue) : ['ko']}); } catch(e){} }   // a phone registered before there was a choice asked for kick-off only
    tok = d.nextPageToken || ''; } while (tok);
  return out.filter(p => Date.now() - p.at < 120*864e5).slice(0, 5000); }
// the short public queue a coach's app writes to (a new photo album, for one)
async function queue(){ const d = await get(BASE + 'pushq?pageSize=50'); return (d.documents || []).map(x => { const f = x.fields || {}; return {id:x.name.split('/').pop(), kind:str(f.k) || 'photos', code:str(f.team), title:str(f.title).slice(0, 120), body:str(f.body).slice(0, 240), url:str(f.url), at:num(f.at)}; }); }
export const wants = (p, n) => p.kinds.includes(n.kind) && (!n.code || n.code === '*' || p.teams.includes(n.code) || (n.code === 'Other' && p.teams.length));

async function main(){
  if (!PRIV && !DRY){ console.log('No VAPID_PRIVATE secret yet: match alerts are not switched on. Nothing sent.'); return; }
  let webpush = null; if (!DRY){ webpush = (await import('web-push')).default; webpush.setVapidDetails(SITE, PUB, PRIV); }
  let S = {}; try { S = JSON.parse(fs.readFileSync(SENT_FILE, 'utf8')); } catch(e){}
  if (!S.sent){ S = {sent:S && typeof S === 'object' && !S.snap ? S : {}, snap:null, q:{}}; }   // (an older file held only the kick-off list)
  S.q = S.q || {};
  const save = () => { try { fs.writeFileSync(SENT_FILE, JSON.stringify(S)); } catch(e){} };
  const end = Date.now() + RUN_MIN*60e3; let lap = 0;
  for (;;){
    const now = Date.now(), hr = +new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/London', hourCycle:'h23', hour:'2-digit'}).format(new Date(now));
    if (hr >= 6 && hr < 21) try {   // overnight the watch idles: no matches, no reading of the database
      const all = await fixtures(), todo = [];
      for (const m of all.filter(m => due(m, now) && !S.sent[m.id + '|' + m.ko])){ const a = message(m, now, false), c = message(m, now, true); todo.push({kind:'ko', code:teamCode(m.team), title:a.title, body:a.body, coachBody:c.body, tag:a.tag, url:a.url, ttl:1200, mark:() => { S.sent[m.id + '|' + m.ko] = now; }}); }
      const nw = news(all, S.snap || {}, now, !S.snap); S.snap = nw.next; nw.out.forEach(n => todo.push(Object.assign({ttl:6*3600}, n)));
      if (lap % 2 === 0){ try { for (const q of await queue()){ if (S.q[q.id] || !q.title) continue; S.q[q.id] = now; if (now - q.at < 3*3600e3) todo.push(Object.assign({ttl:12*3600, tag:'q-' + q.id}, q, {url:/^https:\/\/popcorn483\.github\.io\//.test(q.url) ? q.url : SITE})); } } catch(e){ console.log('queue not read: ' + e.message); } }
      if (todo.length){
        const ph = await phones();
        for (const n of todo){ const to = ph.filter(p => wants(p, n)); let ok = 0, bad = 0;
          for (const p of to){ if (DRY){ ok++; continue; } try { await webpush.sendNotification(p.sub, JSON.stringify({title:n.title, body:p.coach && n.coachBody ? n.coachBody : n.body, tag:n.tag, url:n.url}), {TTL:n.ttl, urgency:n.kind === 'ko' ? 'high' : 'normal'}); ok++; } catch(e){ bad++; console.log('  not delivered to ' + p.id.slice(0, 6) + ': ' + (e.statusCode || e.message)); } }
          console.log(new Date(now).toISOString() + ' [' + n.kind + '] ' + n.title + ' -> ' + ok + ' phone(s)' + (bad ? ', ' + bad + ' failed' : '')); if (n.mark) n.mark(); }
      }
      for (const k of Object.keys(S.sent)) if (now - S.sent[k] > 3*864e5) delete S.sent[k];
      for (const k of Object.keys(S.q)) if (now - S.q[k] > 5*864e5) delete S.q[k];
      save();
    } catch(e){ console.log('check failed: ' + e.message); }
    lap++;
    if (Date.now() + EVERY_S*1000 > end) break;
    await new Promise(r => setTimeout(r, EVERY_S*1000));
  }
}
if (import.meta.url === 'file://' + process.argv[1]) main();
