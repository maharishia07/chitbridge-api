/* manual-entry-breaks.cjs — BREAK EACH ＋ ENTRY GUARD ONCE, RUN ITS HARNESS, RESTORE FROM A COPY (never git checkout).
 * A guard that has never been seen to fail may not be there. Each line damages cap-entry.js in exactly the way manual-entry.cjs exists
 * to catch — the two the task names first: a page that COMPUTES a line's amount, and Save enabled while the entry is unbalanced.
 * BREAK_ONLY=<text> runs just the breaks whose name contains it · BREAK_CHECK=1 only checks every anchor matches once.
 * Exit 0 only when every break was caught. Same runner as cb-accounts-breaks.cjs. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const W = path.join(__dirname, '..');
const BR = require('./lib/break-run.cjs');
/* the checks run from a throw-away copy of the checkout (BR.site): the repo's own public/, index.html and e2e/shots are never touched, so a kill cannot leave them broken */
const SITE = BR.site(W); process.on('exit', () => SITE.dispose());
const ENT = 'public/app/cap-entry.js', ENP = 'public/app/cap-entry-preview.js', A = 'e2e/manual-entry.cjs';
const BREAKS = [
  /* the two the task names */
  ["the page computes a line's amount", ENT, "        l.dr_minor ? esc(bkMoney(l.dr_minor, c)) : '',", "        l.dr_minor ? esc(bkMoney(Math.round(l.dr_minor * 1.18), c)) : '',", A],
  ['Save is on while the server says it does not balance', ENT, `return !!(pv && pv.balanced === true && !(pv.refusals || []).length`, `return !!(pv && !(pv.refusals || []).length`, A],
  /* the rest */
  ['Save is on while the server refuses the entry', ENT, `&& !(pv.refusals || []).length && !EN.pvBusy`, `&& !EN.pvBusy`, A],
  ["the page sends a different amount than was typed", ENP, "    b.amount_minor = bkMoneyMinor(EN.v.amount);", "    b.amount_minor = bkMoneyMinor(EN.v.amount) + 1;", A],
  ['a locked month is not refused at the date', ENP, `EN.dateRef = r && r.code === 'PERIOD_LOCKED' ? enWords(r.refusals, r.code).slice(0, 1) : [];`, `EN.dateRef = [];`, A],
  /* three layers stand in the way of a second post (the page's EN.saving, bkOnce, and api()'s own in-flight lock): the break removes all three */
  ["a double tap posts twice", ENT, "  await bkOnce('entry-save', btn, async function () {\n    /* R106: a money promise asks first, INSIDE the busy guard (a second press while the question is open is dropped — the R102b lesson) */\n    var question = enAskWords();\n    if (question && typeof CBAction !== 'undefined' && (await CBAction.ask(question)) !== true) return;\n    await enSaveWrite();\n  });\n}\n/** the one write: POST /events with the sheet's client_ref; then the Saved screen, the Day book and the opener are told — a refusal shows under the preview */\nasync function enSaveWrite() {\n  EN.saving = true;\n  var body = enBody();\n  body.client_ref = EN.ref;\n  if (EN.photo) body.attachment = EN.photo;\n  try {\n    var reply = await api('booksEventPost', { body: body });", "  await (function (k, b, fn) { return fn(); })('entry-save', btn, async function () {\n    /* R106: a money promise asks first, INSIDE the busy guard (a second press while the question is open is dropped — the R102b lesson) */\n    var question = enAskWords();\n    if (question && typeof CBAction !== 'undefined' && (await CBAction.ask(question)) !== true) return;\n    await enSaveWrite();\n  });\n}\n/** the one write: POST /events with the sheet's client_ref; then the Saved screen, the Day book and the opener are told — a refusal shows under the preview */\nasync function enSaveWrite() {\n  var body = enBody();\n  body.client_ref = EN.ref;\n  if (EN.photo) body.attachment = EN.photo;\n  try {\n    var reply = await api('booksEventPost', { body: body, params: { n: Math.random() } });", A],
  ['a retry loses its client_ref', ENT, `body.client_ref = EN.ref;`, `body.client_ref = bkRef();`, A],
  ["Save posts to the wrong route", ENT, "    var reply = await api('booksEventPost', { body: body });", "    var reply = await api('booksPreview', { body: body });", A],
  ["Reverse posts without asking first", ENT, "  confirmAsk(\n    tx('Reverse this entry?'),", "  (function (a, b, c, go) { go(); })(\n    tx('Reverse this entry?'),", A],
  ["a line does not name the rule that placed it", ENT, "    esc(l.rule || '') +", "    esc('') +", A],
  ["a line does not name its type", ENT, "    esc(tx(l.type || '')) +", "    esc('') +", A],
  ['a warning has no fix button', ENT, `'<button type="button" data-testid="en-wfix-'`, `'<i hidden data-testid="en-wfix-'`, A],
  ['the word accounting reaches the screen', ENT, `'Which lines?'`, `'Which accounting lines?'`, A],
  ["the journal sheet is wider than the phone", ENT, "grid-template-columns:minmax(0,1fr) 84px minmax(0,132px) 44px", "grid-template-columns:260px 84px minmax(0,132px) 44px", A],
  /* the real shapes (api #20) */
  ["the journal sends lines the server does not read", ENT, "      o[item.side === 'cr' ? 'cr_minor' : 'dr_minor'] = bkMoneyMinor(item.amt);", "      o.amount_minor = bkMoneyMinor(item.amt);\n      o.side = item.side;", A],
  ['the voucher is shown without its kind', ENT, `kind: r.voucher.type }`, `kind: '' }`, A],
  ['an event with a route of its own is offered on the sheet', ENT, `e.preview !== false && !e.route`, `true`, A],
  ['the page reads the server\'s refusals as nothing', ENT, `refusals: enWords(r.refusals, r.code),`, `refusals: [],`, A],
  ['an alert() sneaks in', ENT, `function enClose() {`, `function enClose() { alert('hi');`, A],
];
const ONLY = process.env.BREAK_ONLY || '';
if (process.env.BREAK_CHECK) {
  let bad = 0;
  for (const [name, rel, a2] of BREAKS) { const n = fs.readFileSync(path.join(W, rel), 'utf8').replace(/\r\n/g, '\n').split(a2.replace(/\r?\n/g, '\n')).length - 1; if (n !== 1) { bad++; console.log('  ??  ' + name + ': anchor x' + n); } }
  console.log('\n  ' + (BREAKS.length - bad) + '/' + BREAKS.length + ' anchors match once'); process.exit(bad ? 1 : 0);
}
/* The parent is red on main for its own reasons (its stand-in lacks reversed_by), so "exit != 0" proves nothing: a break counts only when it
   adds an XX line, or a crash, that the UNBROKEN run does not have (2026-11-13). */
const BASE = BR.baseline(A, { cwd: SITE.dir });
console.log('  baseline ' + A + ' (unbroken, ' + BASE.runs + ' runs): exit ' + BASE.status + ', ' + BASE.xx.length + ' XX line(s) already red, ignored');
BASE.xx.forEach((l) => console.log('      red on main: ' + l.slice(0, 120)));
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
    const v = BR.verdict(harness, BASE, { cwd: SITE.dir, timeout: 400000 });
    const caught = BR.caught(v, BASE);
    if (caught) good++;
    console.log((caught ? '  ok  ' : '  XX  ') + 'broken: ' + name + ' → ' + (caught ? 'caught' + (v.early ? ' at once' : '') + (v.rechecked ? ' (crash, confirmed twice)' : '') + ' (' + v.secs + ' s): ' + (v.xx[0] || 'harness crashed: ' + v.stderr).slice(0, 150) : 'NOT caught (exit ' + v.status + ', ' + v.secs + ' s)'));
  } finally { fs.writeFileSync(f, s); }   /* back to the original inside the copy for the next break */
}
console.log('\n  ' + good + '/' + ran + ' breaks caught' + (unanchored ? ', ' + unanchored + ' unanchored' : ''));
process.exitCode = good === ran && !unanchored ? 0 : 1;
