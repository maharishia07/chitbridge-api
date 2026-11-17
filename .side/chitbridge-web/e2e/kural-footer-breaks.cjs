/* kural-footer-breaks.cjs — BREAK EACH KURAL-FOOTER GUARD ONCE, RUN ITS HARNESS, RESTORE FROM A COPY (never git checkout).
 * A guard that has never been seen to fail is a guard that may not be there: each line below damages the footer (public/app/kural.js), a page
 * that mounts it, or the data, in exactly the way e2e/kural-footer.cjs exists to catch, and the harness must go red. The ones the decision names
 * come first: Tamil prose shown · inside the head · beside a warning · in a dialog · not closable · in a message.
 * BREAK_ONLY=<text> runs just the breaks whose name contains it · BREAK_CHECK=1 only checks that every anchor still matches the source exactly
 * once (fast — nothing is run). Exit 0 only when every break was caught. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const W = path.join(__dirname, '..');
const BR = require('./lib/break-run.cjs');
/* the checks run from a throw-away copy of the checkout (BR.site): the repo's own public/, index.html and e2e/shots are never touched, so a kill cannot leave them broken */
const SITE = BR.site(W); process.on('exit', () => SITE.dispose());
const K = 'public/app/kural.js', DATA = 'public/app/kurals.json', ACC = 'public/accounts.html', CRM = 'public/crm.html', IDX = 'index.html', MSG = 'public/app/cap-messages.js', CRMJS = 'public/app/cap-crm.js';
const H = 'e2e/kural-footer.cjs';
const BREAKS = [
  /* the decision's own rules */
  ['a Tamil prose line is shown beside the English', K, `esc(m.text) + '</span>'`, `esc(m.text) + ' · இதன் பொருள் தமிழில்</span>'`, H],
  /* two layers keep it out (createBand's host, and paint()'s own move-out-of-head repair), so the break replaces the repair with a move INTO the head */
  ['the band is drawn inside the page head', K, `    if (EL.closest(HEAD_SEL)) (HOST && !HOST.closest(HEAD_SEL) ? HOST : doc.body).appendChild(EL);`, `    var _hd = doc.querySelector(HEAD_SEL); if (_hd) _hd.appendChild(EL);`, H],
  ['the band stays beside a warning (amber / red chips are not looked for)', K, `var BLOCK_SEL = '.cbl-chip.warn,.cbl-chip.bad,[role="alert"],`, `var BLOCK_SEL = '[role="alert"],`, H],
  ['the band stays in a dialog', K, `.pe-bad,.pe-warn,dialog[open],.modalback,#modal.on'`, `.pe-bad,.pe-warn,.modalback,#modal.on'`, H],
  ['✕ closes nothing for the day', K, `      lsSet('kural.hidden', today());\n      paint();`, `      paint();`, H],
  ['a hidden kural is back after a reload (the day is not kept)', K, `    return lsGet('kural.hidden') === today();`, `    return false;`, H],
  ['a kural is written into an outgoing message', MSG, `/* app/cap-messages.js — REPLIES:`, `/* kural: every message ends with a verse. app/cap-messages.js — REPLIES:`, H],
  /* by space */
  ['wide: the meaning drops below even when there is room', K, `display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:4px 22px;min-width:0;cursor:default}`, `display:flex;flex-direction:column;flex-wrap:wrap;align-items:center;justify-content:center;gap:4px 22px;min-width:0;cursor:default}`, H],
  ['a narrow laptop keeps them side by side', K, `@container cbk (max-width:1100px){`, `@container cbk (max-width:10px){`, H],
  ['the phone never takes turns', K, `}, 7000);`, `}, 70000000);`, H],
  ['Less motion still moves it by itself', K, `if (!(phone && !still() && !PAUSED)) {`, `if (!(phone && !PAUSED)) {`, H],
  ['a tap does not switch', K, `  function swap() {\n    if (!EL ||`, `  function swap() {\n    return;\n    if (!EL ||`, H],
  ['the band takes no room off the window (the page overflows)', K, `doc.documentElement.style.setProperty('--cbk-h', h + 'px');`, `void h;`, H],
  /* the look */
  ['an italic meaning', K, `'.cbk .cbk-m{font-size:calc(15px * var(--k,1));`, `'.cbk .cbk-m{font-style:italic;font-size:calc(15px * var(--k,1));`, H],
  ['a colour literal (amber) instead of a token', K, `color:var(--k-muted);white-space:nowrap}',`, `color:#E0A020;white-space:nowrap}',`, H],
  ['the verse is too faint to read', K, `'.cbk .cbk-v{font:600 calc(16px * var(--k,1))/1.55 "Noto Serif Tamil","Noto Sans Tamil",var(--f-ui,system-ui),sans-serif;color:var(--k-ink)}',`, `'.cbk .cbk-v{font:600 calc(16px * var(--k,1))/1.55 "Noto Serif Tamil","Noto Sans Tamil",var(--f-ui,system-ui),sans-serif;color:var(--k-faint)}',`, H],
  /* the data and the pages */
  ['the page copy of kurals.json drifts from the kit', DATA, `Effort brings prosperity; lack of effort brings poverty.`, `Effort brings prosperity; lack of effort brings poverty!`, H],
  ['the excluded list loses 552', DATA, `"no": 552,`, `"no": 553,`, H],
  ['Accounts does not mount the footer', ACC, `<script src="/app/kural.js"></script>   <!-- CBKural: the kural footer — ONE band at the foot of every CB page, mounted here the way CBAvatar is -->`, ``, H],
  ['CRM does not mount the footer', CRM, `<script src="/app/kural.js"></script>   <!-- CBKural: the kural footer — one band at the foot, outside the head; never in a message -->`, ``, H],
  ['the index page does not mount the footer', IDX, `<script src="/app/kural.js"></script>       <!-- CBKural: the kural band; the shell gives it its place -->`, ``, H],
  ['every Accounts view shows the same kural', ACC, `if (window.CBKural) CBKural.set(KURAL_OF[nav[0]] || 'accounts');`, `if (window.CBKural) CBKural.set('accounts');`, H],
  ['the CRM follow-ups page shares the parties kural', CRMJS, `segments[0] === 'followups' ? 'crm-party' : 'crm-parties'`, `segments[0] === 'followups' ? 'crm-parties' : 'crm-parties'`, H],
];
const ONLY = process.env.BREAK_ONLY || '';
if (process.env.BREAK_CHECK) {
  let bad = 0;
  for (const [name, rel, a2] of BREAKS) { const n = fs.readFileSync(path.join(W, rel), 'utf8').replace(/\r\n/g, '\n').split(a2.replace(/\r?\n/g, '\n')).length - 1; if (n !== 1) { bad++; console.log('  ??  ' + name + ': anchor x' + n); } }
  console.log('\n  ' + (BREAKS.length - bad) + '/' + BREAKS.length + ' anchors match once'); process.exit(bad ? 1 : 0);
}
let good = 0, ran = 0, unanchored = 0;
for (let [name, rel, a, b, harness] of BREAKS) {
  if (ONLY && name.indexOf(ONLY) < 0) continue;
  ran++;
  const f = path.join(SITE.dir, rel);
  const s = fs.readFileSync(f, 'utf8');
  if (/\r\n/.test(s)) { a = a.replace(/\r?\n/g, '\r\n'); b = b.replace(/\r?\n/g, '\r\n'); }
  const n = s.split(a).length - 1;
  if (n !== 1) { console.log('  ??  ' + name + ': anchor x' + n + ' — this break measured NOTHING'); unanchored++; continue; }
  try {
    fs.writeFileSync(f, s.split(a).join(b));
    const r = cp.spawnSync(process.execPath, [harness], { cwd: SITE.dir, encoding: 'utf8', timeout: 400000, env: Object.assign({}, process.env, { KURAL_SHOTS: process.env.KURAL_SHOTS || require('os').tmpdir() }) });
    const xx = (r.stdout || '').split('\n').filter((l) => /^\s+XX/.test(l));
    const caught = r.status !== 0 && xx.length > 0;
    if (caught) good++;
    console.log((caught ? '  ok  ' : '  XX  ') + 'broken: ' + name + ' → ' + (caught ? 'caught: ' + xx[0].trim().slice(0, 150) : 'NOT caught (exit ' + r.status + ')'));
  } finally { fs.writeFileSync(f, s); }   /* back to the original inside the copy for the next break */
}
console.log('\n  ' + good + '/' + ran + ' breaks caught' + (unanchored ? ', ' + unanchored + ' unanchored' : ''));
process.exitCode = good === ran && !unanchored ? 0 : 1;
