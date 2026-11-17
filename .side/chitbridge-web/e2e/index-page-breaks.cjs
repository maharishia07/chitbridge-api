/* index-page-breaks.cjs — break each index-page guard once, run the harness, restore FROM A COPY (never git checkout).
 * N18: the index is the shell's Home (index.html + public/app/manifest.json); e2e/index-page.cjs is the harness.   */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const W = path.join(__dirname, '..');
const BR = require('./lib/break-run.cjs');
/* the checks run from a throw-away copy of the checkout (BR.site): the repo's own public/, index.html and e2e/shots are never touched, so a kill cannot leave them broken */
const SITE = BR.site(W); process.on('exit', () => SITE.dispose());
const IDX = 'index.html', MAN = 'public/app/manifest.json';
const BREAKS = [
  ['a hand-written card sneaks in', IDX, `<div id="shell"></div>`, `<div id="shell"></div><a class="cbsh-box" href="/till.html">Till</a>`],
  ['a built card links into the workshop', MAN, `"route": "/till.html"`, `"route": "/app.html#/app/till"`],
  ['a workshop chip grows a route', MAN, `"id": "delivery", "name": "Delivery", "route": null`, `"id": "delivery", "name": "Delivery", "route": "/crm.html"`],
  ['the rail invents a number', IDX, `if (!rail || !rail.facts) return;`, `if (!rail || !rail.facts) return railPaint({ figures: { open: 0 } });`],
  ['an alert loses its fix button', IDX, `+ '<a class="fix" href="' + esc(fixHref) + '"' + (fixBlank ? ' target="_blank" rel="noopener"' : '') + '>' + esc(fixText) + '</a></div>' });`, `+ '</div>' });`],
  ['the 404 reaches the screen', IDX, `  }).catch(function(e){
    if (g !== GEN || !e || e.status !== 422 || !e.data) return;`, `  }).catch(function(e){
    if (e && e.status === 404) alert_('ledger-err', 'bad', '!', 'Error ' + e.status, '', 'Retry', '/');
    if (g !== GEN || !e || e.status !== 422 || !e.data) return;`],
  ['the page mounts the bar, not Home', IDX, `    host: null,`, `    host: { bar: true },`],
  ['the signed-out row grows a second door', IDX, `<button class="fix" data-testid="signed-out-go">Sign in</button>`, `<a class="fix" href="/app.html#/login" data-testid="signed-out-go">Sign in</a>`],
  ['the word accounting reaches the page', IDX, `<h3>Your work</h3>`, `<h3>Your work (accounting)</h3>`],
  ['the rail overflows a phone', IDX, `.rail{border:1px solid var(--line);border-radius:14px;background:var(--card);padding:14px 20px 16px;`, `.rail{min-width:600px;border:1px solid var(--line);border-radius:14px;background:var(--card);padding:14px 20px 16px;`],
];
/* BREAK_ONLY=<text> runs just the breaks whose name contains it */
const ONLY = process.env.BREAK_ONLY || '';
/* The parent walk is already red on main (budget lines lag), so "exit != 0 and some XX" proves nothing: a break counts only when it adds an
   XX line the UNBROKEN run does not print (2026-11-13). */
const H = 'e2e/index-page.cjs';
const BASE = BR.baseline(H, { cwd: SITE.dir });
console.log('  baseline ' + H + ' (unbroken, ' + BASE.runs + ' runs): exit ' + BASE.status + ', ' + BASE.xx.length + ' XX line(s) already red, ignored');
BASE.xx.forEach((l) => console.log('      red on main: ' + l.slice(0, 120)));
let good = 0, ran = 0;
for (const [name, rel, a, b] of BREAKS) {
  if (ONLY && name.indexOf(ONLY) < 0) continue;
  ran++;
  const f = path.join(SITE.dir, rel);
  const s = fs.readFileSync(f, 'utf8'); const n = s.split(a).length - 1;
  if (n !== 1) { console.log('  ??  ' + name + ': anchor x' + n); continue; }
  try {
    fs.writeFileSync(f, s.split(a).join(b));
    const v = BR.verdict(H, BASE, { cwd: SITE.dir, timeout: 300000 });
    const caught = BR.caught(v, BASE);
    if (caught) good++;
    console.log((caught ? '  ok  ' : '  XX  ') + 'broken: ' + name + ' → ' + (caught ? 'caught' + (v.early ? ' at once' : '') + (v.rechecked ? ' (crash, confirmed twice)' : '') + ' (' + v.secs + ' s): ' + (v.xx[0] || 'harness crashed: ' + v.stderr).slice(0, 150) : 'NOT caught (exit ' + v.status + ', ' + v.secs + ' s)'));
  } finally { fs.writeFileSync(f, s); }   /* back to the original inside the copy for the next break */
}
console.log('\n  ' + good + '/' + ran + ' breaks caught');
process.exitCode = good === ran ? 0 : 1;
