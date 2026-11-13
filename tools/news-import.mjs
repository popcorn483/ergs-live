// Rugby newsfeed for ERGS Live: headlines from public RSS feeds, international / pro fixtures and results,
// and local club rugby (Ulster Towns Cup, Enniskillen RFC, Clogher Valley and their leagues) from Ulster Rugby.
//
// from ESPN's public scoreboard. Run by a GitHub workflow every hour; writes news.json (only real changes are committed).
// Each source is optional: if one fails, the rest still come through and the last good items are kept.
import fs from 'node:fs';
import {SITE, get as slGet, dec as slDec, parseComp, sleep} from './sportlomo.mjs';
const OUT = process.argv[2] || 'news.json';
const FEEDS = [
  ['BBC Sport', 'https://feeds.bbci.co.uk/sport/rugby-union/rss.xml'],
  ['BBC Sport NI', 'https://feeds.bbci.co.uk/sport/rugby-union/irish/rss.xml'],
  ['RTÉ', 'https://www.rte.ie/feeds/rss/?index=/sport/rugby/'],
];
const LEAGUES = [   // ESPN league ids
  [289234, 'Internationals'], [180659, 'Six Nations'], [164205, 'Rugby World Cup'], [270557, 'United Rugby Championship'],
  [271937, 'Champions Cup'], [272073, 'Challenge Cup'], [267979, 'Premiership'], [244293, 'Rugby Championship'],
];
const LOG = []; const say = (...a) => { console.log(...a); LOG.push(a.join(' ')); };
const UA = {'user-agent':'ERGS-Live-newsfeed/1.0 (+https://popcorn483.github.io/ergs-live/)'};
const get = async (u, j) => { const r = await fetch(u, {headers:UA, signal:AbortSignal.timeout(20000)}); if (!r.ok) throw new Error(r.status + ' ' + u); return j ? r.json() : r.text(); };
const dec = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&#8217;/g, '’').replace(/&#8216;/g, '‘').replace(/&#822[01];/g, '"').replace(/&#8211;/g, '–').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/\s+/g, ' ').trim();
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? m[1] : ''; };
const RUGBY = /rugby|ulster|leinster|munster|connacht|six nations|urc|test|scrum|try|lions|all blacks|springboks|wallabies|farrell|premiership|champions cup|ireland|schools/i;
async function feeds(){
  const out = [], log = [];
  for (const [src, url] of FEEDS){
    try { const x = await get(url); const items = x.split(/<item[\s>]/i).slice(1).map(it => {
        const t = dec(tag(it, 'title')), link = dec(tag(it, 'link')) || (it.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || '', d = Date.parse(dec(tag(it, 'pubDate')) || dec(tag(it, 'dc:date')) || '');
        const img = (it.match(/<media:thumbnail[^>]*url="([^"]+)"/i) || it.match(/<media:content[^>]*url="([^"]+)"/i) || it.match(/<enclosure[^>]*url="([^"]+\.(?:jpe?g|png|webp)[^"]*)"/i) || it.match(/<img[^>]*src="([^"]+)"/i) || [])[1] || '';
        return {t, url:link.trim(), src, at:isNaN(d) ? 0 : d, img:img.replace(/&amp;/g, '&'), sum:dec(tag(it, 'description')).slice(0, 220)}; })
        .filter(i => i.t && /^https?:/.test(i.url) && (src !== 'RugbyPass' || RUGBY.test(i.t + ' ' + i.sum)));
      out.push(...items); log.push(`${src}: ${items.length}`); }
    catch(e){ log.push(`${src}: failed (${e.message})`); }
  }
  say('News feeds:', log.join(' · '));
  const seen = new Set(), now = Date.now();
  return out.filter(i => !i.at || now - i.at < 10*864e5).sort((a, b) => b.at - a.at).filter(i => { const k = i.t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').slice(0, 60); if (seen.has(k) || seen.has(i.url)) return false; seen.add(k); seen.add(i.url); return true; }).slice(0, 60);
}
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');
async function games(){
  const out = [], log = [], from = new Date(Date.now() - 7*864e5), to = new Date(Date.now() + 14*864e5);
  for (const [id, name] of LEAGUES){
    try { // the current round, then day by day around today (ESPN's rugby scoreboard won't take a date range)
      const evs = []; const add = j => (j.events || []).forEach(e => { if (!evs.some(x => x.id === e.id)) evs.push(e); }); let lgName = '';
      try { const j0 = await get(`https://site.api.espn.com/apis/site/v2/sports/rugby/${id}/scoreboard`, true); add(j0); lgName = (j0.leagues || [])[0]?.name || ''; } catch(e){}
      for (let d = new Date(from); d <= to; d = new Date(+d + 864e5)){ try { add(await get(`https://site.api.espn.com/apis/site/v2/sports/rugby/${id}/scoreboard?dates=${ymd(d)}`, true)); } catch(e){} }
      const j = {events:evs, leagues:[{name:lgName || name}]};
      const ev = (j.events || []).map(e => { const c = (e.competitions || [])[0] || {}, cs = c.competitors || [], h = cs.find(x => x.homeAway === 'home') || cs[0] || {}, a = cs.find(x => x.homeAway === 'away') || cs[1] || {}, st = (e.status || c.status || {}).type || {};
        const tm = x => ({n:(x.team || {}).displayName || (x.team || {}).name || '', s:(x.team || {}).abbreviation || '', logo:(x.team || {}).logo || ((x.team || {}).logos || [])[0]?.href || ''});
        return {lg:(j.leagues || [])[0]?.name || name, id:String(e.id), date:e.date, h:tm(h), a:tm(a), hs:st.state === 'pre' ? null : +h.score, as:st.state === 'pre' ? null : +a.score, state:st.state || '', detail:st.shortDetail || st.detail || '', venue:(c.venue || {}).fullName || '', url:((e.links || []).find(l => /gamecast|summary/i.test((l.rel || []).join(' ') + l.text)) || {}).href || ''}; })
        .filter(g => g.h.n && g.a.n);
      out.push(...ev); log.push(`${name}: ${ev.length}${ev.length ? '' : ' (keys ' + Object.keys(j).join(',') + '; events ' + (j.events || []).length + ')'}`); }
    catch(e){ log.push(`${name}: failed (${e.message})`); }
  }
  say('Fixtures/results:', log.join(' · '));
  const seen = new Set(); return out.filter(g => !seen.has(g.id) && seen.add(g.id)).sort((a, b) => a.date.localeCompare(b.date));
}

// Local club rugby from Ulster Rugby (SportLoMo): the Towns Cup and any club competition Fermanagh/Tyrone clubs play in
const LOCAL_CLUBS = /enniskillen|clogher|fermanagh|lisnaskea|omagh|dungannon|cooke|cookstown|strabane|monaghan|armagh/i, OURS = /enniskillen|clogher/i;
async function clubs(){
  const log = [], out = [], names = [];
  try {
    const home = await slGet('/'), season = home.match(/<option value="(\d+)"\s*selected>([^<]*)<\/option>/) || [];
    if (!season[1]) throw new Error('no season');
    const gj = JSON.parse(await slGet('/wp-admin/admin-ajax.php?action=comp', `seasonid=${season[1]}&userid=6941`) || '{}');
    const groups = ((gj.data || [])[0] || []).filter(g => !/school|youth|age grade|women|girl|mini|u1[0-9]|tag|touch/i.test(g.group_name || ''));
    log.push('groups: ' + groups.map(g => g.group_name).join(' | '));
    for (const g of groups){
      const lj = JSON.parse(await slGet('/wp-admin/admin-ajax.php?action=competitions', `resetgroup=&group=${g.group_id}&groups=${g.group_id}&action=competitions&userid=6941&season=${season[1]}`) || '{}');
      const links = [...String(lj.competitions || '').matchAll(/href="https:\/\/ulsterrugby\.sportlomo\.com(\/(league|competition_fixtures_results)\/\d+\/)"[^>]*>([\s\S]*?)<\/a>/g)].map(x => ({path:x[1], kind:x[2] === 'league' ? 'league' : 'ko', name:slDec(x[3]), group:g.group_name}));
      names.push(...links.map(l => `${g.group_name} › ${l.name}`));
      for (const l of links){
        if (/friendl|women|girl|u1[0-9]|u2[01]|youth|vets?|veteran/i.test(l.name)) continue;
        await sleep(600);
        try { const c = parseComp(await slGet(l.path), SITE + l.path, l.kind); c.name = c.name || l.name; c.group = l.group;
          const teams = c.table.map(r => r.n).concat(c.games.flatMap(x => [x.h, x.a]));
          const towns = /towns?\s*cup|fermanagh/i.test(c.name), local = teams.some(t => OURS.test(t));
          if (!towns && !local) continue;
          // keep it small: the table, and games in the last 3 weeks / next 6 weeks (all of them for the Towns Cup)
          const lo = new Date(Date.now() - 21*864e5).toISOString().slice(0, 10), hi = new Date(Date.now() + 42*864e5).toISOString().slice(0, 10);
          c.games = c.games.filter(x => towns || !x.date || (x.date >= lo && x.date <= hi));
          c.towns = towns; c.ours = teams.filter(t => OURS.test(t)).filter((t, i, a) => a.indexOf(t) === i);
          out.push(c); } catch(e){ log.push('skip ' + l.name); }
      }
    }
  } catch(e){ log.push('clubs failed: ' + e.message); }
  say('Club rugby:', log.join(' · '), `· kept ${out.length}`);
  return {comps:out.sort((a, b) => (b.towns - a.towns) || a.name.localeCompare(b.name, undefined, {numeric:true})), seen:names.slice(0, 400)};
}

// TheSportsDB (free tier): recent results and next fixtures for the main competitions
const TSDB_WANT = /six nations|united rugby championship|urc|champions cup|challenge cup|premiership|autumn nations|nations championship|rugby championship|world cup|international|test match|super rugby|top 14/i;
async function tsdb(){
  const out = [], log = [], B = 'https://www.thesportsdb.com/api/v1/json/3/';
  try {
    const all = await get(B + 'search_all_leagues.php?s=Rugby', true), lgs = (all.countries || all.leagues || []).filter(l => TSDB_WANT.test(l.strLeague || '') && !/women|u20|sevens|7s/i.test(l.strLeague || ''));
    log.push('leagues: ' + lgs.map(l => `${l.strLeague} (${l.idLeague})`).join(', '));
    for (const l of lgs.slice(0, 14)){
      for (const kind of ['eventspastleague', 'eventsnextleague']){
        try { const j = await get(`${B}${kind}.php?id=${l.idLeague}`, true), ev = j.events || j.results || [];
          ev.forEach(e => { const date = e.strTimestamp ? e.strTimestamp.replace(/\+00:00$/, '') + 'Z' : (e.dateEvent ? e.dateEvent + 'T' + (e.strTime || '12:00:00').slice(0, 8) + 'Z' : ''); if (!date || !e.strHomeTeam) return;
            const done = e.intHomeScore != null && e.intHomeScore !== '' && /finish|ft|match finished/i.test(e.strStatus || 'FT') || (kind === 'eventspastleague' && e.intHomeScore != null && e.intHomeScore !== '');
            out.push({lg:l.strLeague, id:'t' + e.idEvent, date, h:{n:e.strHomeTeam, s:'', logo:e.strHomeTeamBadge || ''}, a:{n:e.strAwayTeam, s:'', logo:e.strAwayTeamBadge || ''}, hs:done ? +e.intHomeScore : null, as:done ? +e.intAwayScore : null, state:done ? 'post' : 'pre', detail:done ? 'FT' : '', venue:e.strVenue || '', url:''}); });
          await new Promise(r => setTimeout(r, 1200)); } catch(err){ log.push(`${l.strLeague} ${kind}: failed (${err.message})`); }
      }
    }
  } catch(e){ log.push('failed: ' + e.message); }
  say('TheSportsDB:', log.join(' · '), `· ${out.length} games`);
  return out;
}
let old = {}; try { old = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch(e){}
const [news, gm0, ts, cl] = await Promise.all([feeds(), games(), tsdb(), clubs()]);
// only games from the last 10 days and the next 3 weeks (ESPN sometimes hands back last season's round)
const lo = Date.now() - 10*864e5, hi = Date.now() + 21*864e5, key = g => (g.h.n + '|' + g.a.n + '|' + g.date.slice(0, 10)).toLowerCase();
const gm = [], gk = new Set(); for (const g of gm0.concat(ts)){ const t = Date.parse(g.date); if (isNaN(t) || t < lo || t > hi || gk.has(key(g))) continue; gk.add(key(g)); gm.push(g); } gm.sort((a, b) => a.date.localeCompare(b.date));
const out = {news:news.length ? news : old.news || [], games:gm.length ? gm : (old.games || []).filter(g => { const t = Date.parse(g.date); return t > lo && t < hi; }), clubs:cl.comps.length ? cl.comps : old.clubs || [], clubComps:cl.seen.length ? cl.seen : old.clubComps || []};
out.log = LOG.map(x => x.slice(0, 1500));
if (JSON.stringify([out.news, out.games, out.clubs, out.log]) === JSON.stringify([old.news, old.games, old.clubs, old.log])){ console.log('No change'); process.exit(0); }
out.updated = new Date().toISOString(); fs.writeFileSync(OUT, JSON.stringify(out)); console.log(`Written: ${out.news.length} headlines, ${out.games.length} games, ${out.clubs.length} club competitions.`);
