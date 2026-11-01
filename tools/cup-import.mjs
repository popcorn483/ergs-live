// Fetches the Ulster Rugby (SportLoMo) competitions ERGS follow and writes comps.json for ERGS Live.
// Run by .github/workflows/comps.yml every couple of hours; the app reads comps.json from the same site, so supporters
// see official tables, results and fixtures without anyone typing them in.
// Picks up, for the current season: the Danske Bank Schools Cup (groups, qualifiers, knockout rounds) and the
// Medallion Shield / Plate / Bowl / Trophy (groups or knockout). Friendlies are ignored.
import fs from 'node:fs';
const SITE = 'https://ulsterrugby.sportlomo.com', UA = 'Mozilla/5.0 (ERGS Live competition tables; +https://popcorn483.github.io/ergs-live/)', OUT = process.argv[2] || 'comps.json';
const LOCAL = process.env.COMPS_LOCAL || '';   // testing: read saved pages from this folder instead of the web
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(path, body){
  if (LOCAL){ const f = LOCAL + '/' + path.replace(/[^a-z0-9]/gi, '_') + (body ? '_post' : ''); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; }
  for (let i = 0; i < 3; i++){ try { const r = await fetch(SITE + path, {method:body ? 'POST' : 'GET', headers:Object.assign({'user-agent':UA}, body ? {'content-type':'application/x-www-form-urlencoded'} : {}), body});
      if (r.ok) return await r.text(); } catch(e){} await sleep(2000 * (i + 1)); }
  throw new Error('Could not fetch ' + path);
}
const dec = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&#0?39;|&rsquo;|&#8217;/g, '’').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
// "Enniskillen Royal GS 1st XV" -> "Enniskillen Royal GS"; "Coleraine Grammar School Medallion A" -> "Coleraine Grammar School"
const school = n => dec(n).replace(/\s+(1st|2nd|3rd|4th)\s*XV$/i, '').replace(/\s+Medallion(\s+[AB])?(\s+XV)?$/i, '').replace(/\s+U1[2-8]$/i, '').trim();
const iso = d => { const m = String(d || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
function parseComp(html, url, kind){
  const title = dec((html.match(/<h3>([\s\S]*?)<\/h3>/) || [])[1] || '').replace(/^League Table\s+/i, '');
  const table = [];
  const tb = (html.match(/<tbody class="second">([\s\S]*?)<\/tbody>/) || [])[1] || '';
  for (const tr of tb.match(/<tr>[\s\S]*?<\/tr>/g) || []){ const c = (tr.match(/<td>([\s\S]*?)<\/td>/g) || []).map(x => dec(x)); if (c.length >= 7) table.push({pos:+c[0], n:school(c[1]), P:+c[2], W:+c[3], D:+c[4], L:+c[5], Pts:+c[c.length - 1]}); }
  const games = []; let date = '';
  const re = /<div class="compheader">\s*<div class="expand-item"><label>([^<]*)<\/label>|<ul class="column-seven table-body ([^"]*)">([\s\S]*?)<\/ul>/g; let m;
  while ((m = re.exec(html))){
    if (m[1] != null){ date = iso(m[1]); continue; }
    const cls = m[2], r = m[3], li = c => { const x = r.match(new RegExp('<li class="[^"]*\\b' + c + '\\b[^"]*"><span class="data">([\\s\\S]*?)</span></li>')); return x ? x[1] : null; };
    if (/date-section/.test(cls)){ const d = dec(li('league-date')); if (d) date = iso(d); continue; }
    const h = li('team1'), a = li('team2'); if (!h || !a) continue;
    const sc = (r.match(/<span class="score-value">([^<]*)<\/span>[\s\S]*?<span class="score-value">([^<]*)<\/span>/) || []).slice(1).map(dec);
    const pt = s => { const x = String(s || '').match(/^(\d+)\s*(?:\((\d*)\))?$/); return x ? {s:+x[1], t:x[2] === '' || x[2] == null ? null : +x[2]} : null; };
    const H = pt(sc[0]), A = pt(sc[1]), venue = dec(li('tmore'));
    const g = {date, time:dec(li('time')), h:school(h), a:school(a), venue:/^(TBC)?$/i.test(venue) ? '' : venue};
    if (H && A && /result/.test(cls)) Object.assign(g, {hs:H.s, as:A.s, ht:H.t, at:A.t}); games.push(g);
  }
  return {name:title, kind, url, table, games};
}
const which = name => /friendl/i.test(name) ? '' : /\b3XV\b|\bU1[2-8]\b|girls/i.test(name) ? '' : /medallion/i.test(name) ? 'meds' : /schools cup/i.test(name) ? 'cup' : '';
async function main(){
  const home = await get('/');
  const season = (home.match(/<option value="(\d+)"\s*selected>([^<]*)<\/option>/) || []);
  if (!season[1]) throw new Error('No season found on the SportLoMo home page');
  const groupsJson = JSON.parse(await get('/wp-admin/admin-ajax.php?action=comp', `seasonid=${season[1]}&userid=6941`) || '{}');
  const boys = ((groupsJson.data || [])[0] || []).find(g => /schools boys/i.test(g.group_name || '')); if (!boys) throw new Error('No Schools Boys group');
  const listJson = JSON.parse(await get('/wp-admin/admin-ajax.php?action=competitions', `resetgroup=&group=${boys.group_id}&groups=${boys.group_id}&action=competitions&userid=6941&season=${season[1]}`) || '{}');
  const links = [...String(listJson.competitions || '').matchAll(/href="https:\/\/ulsterrugby\.sportlomo\.com(\/(league|competition_fixtures_results)\/\d+\/)"[^>]*>([\s\S]*?)<\/a>/g)].map(x => ({path:x[1], kind:x[2] === 'league' ? 'league' : 'ko', name:dec(x[3])})).filter(x => which(x.name));
  const comps = {cup:[], meds:[]};
  for (const l of links){ await sleep(LOCAL ? 0 : 700); try { const c = parseComp(await get(l.path), SITE + l.path, l.kind); c.name = c.name || l.name; comps[which(l.name)].push(c); } catch(e){ console.error('skipped', l.name, e.message); } }
  for (const k of Object.keys(comps)) comps[k].sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric:true}));
  const y = +(season[2].match(/20\d\d/) || [0])[0], out = {season:`${y}/${String((y + 1) % 100).padStart(2, '0')}`, source:'Ulster Rugby fixtures & results (SportLoMo)', comps};
  let old = null; try { old = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch(e){}
  if (old && JSON.stringify(Object.assign({}, old, {updated:0})) === JSON.stringify(Object.assign({}, out, {updated:0}))){ console.log('No change.'); return; }
  out.updated = new Date().toISOString(); fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log(`Written: ${comps.cup.length} Schools Cup and ${comps.meds.length} Medallion competitions, season ${out.season}.`);
}
main().catch(e => { console.error(e.message); process.exit(1); });
