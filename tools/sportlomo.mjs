// Shared Ulster Rugby (SportLoMo) helpers for the newsfeed importer (same parsing as cup-import.mjs).
import fs from 'node:fs';
export const SITE = 'https://ulsterrugby.sportlomo.com', UA = 'Mozilla/5.0 (ERGS Live competition tables; +https://popcorn483.github.io/ergs-live/)';
const LOCAL = process.env.COMPS_LOCAL || '';   // testing: read saved pages from this folder instead of the web
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function get(path, body){
  if (LOCAL){ const f = LOCAL + '/' + path.replace(/[^a-z0-9]/gi, '_') + (body ? '_post' : ''); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; }
  for (let i = 0; i < 3; i++){ try { const r = await fetch(SITE + path, {method:body ? 'POST' : 'GET', headers:Object.assign({'user-agent':UA}, body ? {'content-type':'application/x-www-form-urlencoded'} : {}), body});
      if (r.ok) return await r.text(); } catch(e){} await sleep(2000 * (i + 1)); }
  throw new Error('Could not fetch ' + path);
}
export const dec = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&#0?39;|&rsquo;|&#8217;/g, '’').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
// "Enniskillen Royal GS 1st XV" -> "Enniskillen Royal GS"; "Coleraine Grammar School Medallion A" -> "Coleraine Grammar School"
export const school = n => dec(n).replace(/\s+(1st|2nd|3rd|4th)\s*XV$/i, '').replace(/\s+Medallion(\s+[AB])?(\s+XV)?$/i, '').replace(/\s+U1[2-8]$/i, '').trim();
export const iso = d => { const m = String(d || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
export function parseComp(html, url, kind){
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
