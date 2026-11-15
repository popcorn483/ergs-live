// Match alerts (ERGS Live): a notification before kick-off, for anyone who asked; coaches are also told to start the match. Run by .github/workflows/kickoff.yml through the day.
// Every few minutes it reads the public fixture list; when one of our matches is about 15 minutes from kick-off and hasn't
// been started, it sends a notification to each phone that asked for that team (the bell in ERGS Live).
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
const get = async u => { const r = await fetch(u, {signal:AbortSignal.timeout(20000)}); if (!r.ok) throw new Error(r.status + ' ' + u); return r.json(); };
async function fixtures(){ const d = await get(BASE + 'live/state'); return (JSON.parse(d.fields.json.stringValue).matches) || []; }
async function phones(){ const out = []; let tok = '';
  do { const d = await get(BASE + 'pushsubs?pageSize=300' + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''));
    for (const x of d.documents || []){ try { const f = x.fields || {}; out.push({id:x.name.split('/').pop(), sub:JSON.parse(f.sub.stringValue), teams:((f.teams.arrayValue || {}).values || []).map(v => v.stringValue), at:+(f.at.integerValue || f.at.doubleValue || 0), coach:!!(f.coach && f.coach.booleanValue)}); } catch(e){} }
    tok = d.nextPageToken || ''; } while (tok);
  return out.filter(p => Date.now() - p.at < 120*864e5).slice(0, 5000); }

async function main(){
  if (!PRIV && !DRY){ console.log('No VAPID_PRIVATE secret yet: kick-off reminders are not switched on. Nothing sent.'); return; }
  let webpush = null; if (!DRY){ webpush = (await import('web-push')).default; webpush.setVapidDetails(SITE, PUB, PRIV); }
  let sent = {}; try { sent = JSON.parse(fs.readFileSync(SENT_FILE, 'utf8')); } catch(e){}
  const end = Date.now() + RUN_MIN*60e3;
  for (;;){
    const now = Date.now();
    try {
      const list = (await fixtures()).filter(m => due(m, now) && !sent[m.id + '|' + m.ko]);
      if (list.length){
        const ph = await phones();
        for (const m of list){
          const code = teamCode(m.team), to = ph.filter(p => p.teams.includes(code) || (code === 'Other' && p.teams.length)), msg = message(m, now, false), msgC = message(m, now, true); let ok = 0, bad = 0;
          for (const p of to){ if (DRY){ ok++; continue; } try { await webpush.sendNotification(p.sub, JSON.stringify(p.coach ? msgC : msg), {TTL:1200, urgency:'high'}); ok++; } catch(e){ bad++; console.log('  not delivered to ' + p.id.slice(0, 6) + ': ' + (e.statusCode || e.message)); } }
          console.log(new Date(now).toISOString() + ' ' + msg.title + ' -> ' + ok + ' phone(s)' + (bad ? ', ' + bad + ' failed' : ''));
          sent[m.id + '|' + m.ko] = now;
        }
        for (const k of Object.keys(sent)) if (now - sent[k] > 3*864e5) delete sent[k];
        fs.writeFileSync(SENT_FILE, JSON.stringify(sent));
      }
    } catch(e){ console.log('check failed: ' + e.message); }
    if (Date.now() + EVERY_S*1000 > end) break;
    await new Promise(r => setTimeout(r, EVERY_S*1000));
  }
}
if (import.meta.url === 'file://' + process.argv[1]) main();
