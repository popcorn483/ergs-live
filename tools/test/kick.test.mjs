// The match-alert job's "what is new" logic, checked without sending anything:  node tools/test/kick.test.mjs
import { news, wants, ukTime, score } from '../kickoff.mjs';
let bad = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };
const now = ukTime('2026-11-21T11:40'), base = {id:'m1', team:'Medallions', home:'Enniskillen Royal GS', away:'Omagh Academy', us:'H', ko:'2026-11-21T10:30', status:'2H', events:[{s:'H', k:'try'}, {s:'H', k:'con'}, {s:'A', k:'pen'}], players:new Array(15).fill({name:'x'})};
const fut = {id:'m2', team:'Under 14', home:'Portora', away:'ERGS', us:'A', ko:'2026-11-28T10:00', status:'pre', venue:'Portora pitches', players:[]};
let r = news([base, fut], {}, now, true); ok(r.out.length === 0 && r.next.m1.st === '2H', 'the first look only takes note: nothing is sent');
let snap = r.next;
r = news([Object.assign({}, base, {status:'FT'}), fut], snap, now); ok(r.out.length === 1 && r.out[0].kind === 'ft' && /Full time: Medallions v Omagh Academy/.test(r.out[0].title) && /ERGS 7–3\. A win\./.test(r.out[0].body), 'full time: ' + r.out[0].title + ' | ' + r.out[0].body);
ok(news([Object.assign({}, base, {status:'FT'}), fut], r.next, now).out.length === 0, 'and only once');
ok(news([{id:'old', team:'1st XV', home:'ERGS', away:'X', ko:'2026-10-03T10:30', status:'FT', final:[10, 5]}], snap, now).out.length === 0, 'a past result typed in afterwards pings nobody');
r = news([base, Object.assign({}, fut, {off:'postponed'})], snap, now); ok(r.out.length === 1 && r.out[0].kind === 'chg' && /^Postponed: Under 14 @ Portora/.test(r.out[0].title), 'postponed: ' + r.out[0].title + ' | ' + r.out[0].body);
r = news([base, fut], r.next, now); ok(r.out.length === 1 && /^Back on:/.test(r.out[0].title), 'back on: ' + r.out[0].title);
r = news([base, Object.assign({}, fut, {ko:'2026-11-28T11:30'})], snap, now); ok(r.out.length === 1 && /^New time:/.test(r.out[0].title) && /Now Sat,? 28 Nov,? 11:30 \(was Sat,? 28 Nov,? 10:00\)/.test(r.out[0].body), 'new time: ' + r.out[0].body);
r = news([base, Object.assign({}, fut, {venue:'Mullaghmeen'})], snap, now); ok(r.out.length === 1 && /^Venue changed:/.test(r.out[0].title) && /Now at Mullaghmeen \(was Portora pitches\)/.test(r.out[0].body), 'venue: ' + r.out[0].body);
r = news([base, Object.assign({}, fut, {players:new Array(23).fill({name:'y'})})], snap, now); ok(r.out.length === 1 && r.out[0].kind === 'team' && /^Team named: Under 14 @ Portora/.test(r.out[0].title), 'team named: ' + r.out[0].title + ' | ' + r.out[0].body);
const old = {teams:['Meds'], kinds:['ko']}, all = {teams:['Meds', 'U14'], kinds:['ko', 'ft', 'chg', 'team', 'photos']};
ok(!wants(old, {kind:'ft', code:'Meds'}) && wants(old, {kind:'ko', code:'Meds'}) && wants(all, {kind:'ft', code:'Meds'}) && !wants(all, {kind:'ft', code:'1XV'}) && wants(all, {kind:'photos', code:'*'}), 'each phone gets only the kinds and teams it chose');
ok(score({final:[12, 7], finalSet:true, events:[{s:'H', k:'try'}]}).join() === '12,7', 'a typed final score wins over the timeline');
process.exit(bad ? 1 : 0);
