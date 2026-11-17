/* app-syntax.cjs — every inline <script> block of app.html must PARSE. 2026-09-06: a relabel shipped `'Space Mono'` inside a single-quoted
   string; render-smoke (which exercises functions, not the whole document) said 35 passed, Vercel deployed, and the app was a blank page
   for everyone until the next push. This is the check that would have refused the commit: node's own parser on each block. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const f = path.join(__dirname, '..', 'public', 'app.html'); const s = fs.readFileSync(f, 'utf8');
const re = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g; let m, i = 0, bad = 0;
while ((m = re.exec(s))) { i++; try { new vm.Script(m[1], { filename: 'block' + i + '.js' }); } catch (e) { bad++; const line = Number((e.stack.match(/block\d+\.js:(\d+)/) || [])[1] || 0); const before = s.slice(0, m.index).split('\n').length; console.log('  ✗ app.html inline script ' + i + ': ' + e.message + ' — app.html line ' + (before + line - 1)); } }
console.log(bad ? '══ app syntax · ' + bad + ' block(s) do not parse ══' : '══ app syntax · ' + i + ' inline block(s) parse ══');
process.exit(bad ? 1 : 0);
