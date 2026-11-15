// syntax-check every inline script of a page: node syn.js <file.html>
const fs = require('fs'), vm = require('vm'); const html = fs.readFileSync(process.argv[2], 'utf8'); let i = 0, n = 0, bad = 0;
const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g; let m;
while ((m = re.exec(html))){ const attrs = m[1] || ''; if (/\bsrc=/.test(attrs)) continue; n++; const line = html.slice(0, m.index).split('\n').length;
  try { if (/type="module"/.test(attrs)) continue; new vm.Script(m[2], {filename:'script@' + line}); } catch(e){ bad++; console.log('SYNTAX ERROR in script starting at line', line, ':', e.message, (e.stack || '').split('\n').slice(0, 3).join(' | ')); } }
console.log(n + ' inline scripts, ' + bad + ' with errors');
