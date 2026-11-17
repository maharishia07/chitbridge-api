/* crm-breaks.cjs — BREAK EACH CB CRM GUARD ONCE, RUN ITS HARNESS, RESTORE FROM A COPY (never git checkout).
 * A guard that has never been seen to fail is a guard that may not be there: each line below damages the page in exactly the way
 * crm.cjs exists to catch, and the harness must go red. The five the task names — a both-roles party drawn twice, a merged party
 * listed, Message offered to a local party, mail offered with the preference off, a per-row fetch — come first.
 * BREAK_ONLY=<text> runs just the breaks whose name contains it · BREAK_CHECK=1 only checks that every anchor still matches the
 * source exactly once (fast — nothing is run). Exit 0 only when every break was caught. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const W = path.join(__dirname, '..');
const BR = require('./lib/break-run.cjs');
/* the checks run from a throw-away copy of the checkout (BR.site): the repo's own public/, index.html and e2e/shots are never touched, so a kill cannot leave them broken */
const SITE = BR.site(W); process.on('exit', () => SITE.dispose());
const PAGE = 'public/crm.html', HOME = 'public/app/cap-crm.js', REC = 'public/app/cap-crm-record.js', TLF = 'public/app/cap-crm-timeline.js';
const H = 'e2e/crm.cjs';
const BREAKS = [
  /* the five the task names */
  ['a both-roles party is drawn twice', HOME, "    if (seen) {\n      (item.roles || []).forEach(", "    if (false && seen) {\n      (item.roles || []).forEach(", H],
  ['a merged party is listed', HOME, "    if (!item || item.merged_into) return;", "    if (!item) return;", H],
  ['Message is offered to a local party', REC, "  else if (p.on_chitbridge) {\n    primary = '<button data-cbsid=\"CRM006-B06\"", "  else if (true) {\n    primary = '<button data-cbsid=\"CRM006-B06\"", H],
  ['Mail is offered with the preference off', REC, "  if (e && e.may === false) return e.why || tx('They asked not to be mailed');", "  if (false) return e.why || tx('They asked not to be mailed');", H],
  ['a row fetches its own record (a per-row fetch)', HOME, `function crmPartyCell(p) {\n`, `function crmPartyCell(p) {\n  api('crmParty', { params: { id: p.party_id } }).catch(function () {});\n`, H],
  /* money is read, never computed */
  ['the page works out a tax on the dues', HOME, "  if (p.balance_minor == null) return p.dues && p.dues.cost_hidden", "  var _gst = p.balance_minor * 1.18;\n  if (p.balance_minor == null) return p.dues && p.dues.cost_hidden", H],
  ['the page sums the dues of every party', HOME, `function crmNotices() {\n`, `function crmNotices() {\n  var _tot = CRM.rows.reduce(function (a, p) { return a + (p.balance_minor || 0); }, 0);\n`, H],
  /* the frozen look */
  ['a column header is drawn by hand', HOME, `function crmHome(frame) {\n`, `function crmHome(frame) {\n  var _h = '<thead><tr><th>Party</th></tr></thead>';\n`, H],
  ['a banner row sits above the list (the head grows past 20%)', HOME, "  node.innerHTML = '<div id=\"crm_list\" data-testid=\"crm-list\"></div>';", "  node.innerHTML = '<div style=\"height:90px\">banner</div><div id=\"crm_list\" data-testid=\"crm-list\"></div>';", H],
  ['the page draws its own avatar', PAGE, "<div id=\"shell\" data-testid=\"crm-shell\"></div>", "<div id=\"shell\" data-testid=\"crm-shell\"><b class=\"avatar\">A</b></div>", H],
  ['the phone overflows', PAGE, `  .content,.rec{padding-left:16px;padding-right:16px}`, `  .content,.rec{padding-left:16px;padding-right:16px;min-width:700px}`, H],
  /* who sees what */
  ['a viewer is offered every action', HOME, `function crmEdit() { return crmRole() !== 'viewer'; }`, `function crmEdit() { return true; }`, H],
  ['a co-assist is treated as the owner', HOME, `function crmOwner() { return SESSION.role === 'entity'; }`, `function crmOwner() { return true; }`, H],
  ['a co-assist\'s follow-ups default to Everyone', HOME, `  var def = crmOwner() ? 'all' : 'mine';`, `  var def = 'all';`, H],
  /* the ledger */
  ['the late-dues alert shows with the Ledger off', HOME, `  if (CRM.ledger && du > 0)`, `  if (du > 0)`, H],
  ['the Dues column is drawn with the Ledger off', HOME, `  if (CRM.ledger) cols.push({ key: 'dues'`, `  if (true) cols.push({ key: 'dues'`, H],
  ['the Ledger section ignores the switch', REC, `    if (CRM.ledger) secs.push(crmSec('ledger'`, `    if (true) secs.push(crmSec('ledger'`, H],
  /* the words and the states */
  ['a migration answer is shown as a plain failure', HOME, "  if (st === 503) return { title: tx('Calls and follow-ups start after an update.')", "  if (false) return { title: tx('Calls and follow-ups start after an update.')", H],
  ['a failed list shows the server\'s own message', HOME, `  return { title: tx("Couldn't load " + what + "."), sub: tx('Check the connection and try again.') };`, `  return { title: tx("Couldn't load " + what + "."), sub: (e && e.message) || '' };`, H],
  ['the Fix address button is dropped from Next', REC, `btn('fixaddr', 'Fix address', true, '', 'crm-next-fix')`, `''`, H],
  ['a minted party shows a Network ID', REC, "(!minted && p.bridge_id ? cell('Network ID', p.bridge_id, '—', 'crm-id-bridge') : '')", "cell('Network ID', p.bridge_id || 'CB00LOCAL0', '—', 'crm-id-bridge')", H],
  ['the timeline reads the whole history in one go', TLF, "      next = more ? T.next : '',", "      next = '',", H],
  ['the timeline lists kinds that have nothing', TLF, "(T.counts[item[0]] == null || T.counts[item[0]] > 0)", "(true)", H],
  ['the unread dot is gone', REC, `(unread ? '<span class="udot" title="' + esc(tx('Unread')) + '"></span> ' : '')`, `''`, H],
  ['an internal message is not tagged', REC, `(e.kind === 'message_internal' ? '<span class="tagi">' + esc(tx('internal')) + '</span>' : '')`, `''`, H],
  ['a long call is not cut short', REC, "text.length > CRM_LONG ?", "text.length > 99999 ?", H],
  ['Done does not send done:true', HOME, "  fudone: function (control, id, value, event) {\n    event.stopPropagation();\n    return crmFuAct(id, { done: true });", "  fudone: function (control, id, value, event) {\n    event.stopPropagation();\n    return crmFuAct(id, { snoozed: true });", H],
  ['the log sheet saves a follow-up as manual', REC, `source: 'interaction' } });`, `source: 'manual' } });`, H],
  ['the edit sheet keeps one tax id', 'public/app/cap-books.js', "var taxes = r.tax_ids && r.tax_ids.length ? r.tax_ids : [{}];", "var taxes = r.tax_ids && r.tax_ids.length ? [r.tax_ids[0]] : [{}];", H],
  ['the page is no longer named CRM', PAGE, `<title>CRM</title>`, `<title>Accounts</title>`, H],
  ['the word accounting reaches the page', PAGE, `<div class="brand-name label">CRM</div>`, `<div class="brand-name label">CRM accounting</div>`, H],
  /* the lists round (2026-10-09): the handle is never an e-mail · the stripe · the whole frame in the first paint */
  ['an internal .cr handle is shown as an e-mail', HOME, `  if (!/@[^@.\\s]+\\.(cr|br)$/i.test(s)) return s;`, `  if (true) return s;`, H],
  ['the zebra stripe is gone', 'public/app/list-ctl.js', "var zb = count++ % 2 === 1;", "var zb = false; count++;", H],
  ['the first paint is not the whole frame (the menu waits for the data)', PAGE, `  crmRoute(true);`, `  /* crmRoute(true); */`, H],
  ['an alert() sneaks in', HOME, `function crmOwner() {`, `function crmOwner() { alert('hi');`, H],
  ['the one-shop gate is not attached', PAGE, `CBOnePerson.attach({ quiet: true, who: () => MINE,`, `void ({ quiet: true, who: () => MINE,`, H],
];
const ONLY = process.env.BREAK_ONLY || '';
if (process.env.BREAK_CHECK) {
  let bad = 0;
  for (const [name, rel, a2] of BREAKS) { const n = BR.locate(fs.readFileSync(path.join(W, rel), 'utf8'), a2).n; if (n !== 1) { bad++; console.log('  ??  ' + name + ': anchor x' + n); } }
  console.log('\n  ' + (BREAKS.length - bad) + '/' + BREAKS.length + ' anchors match once'); process.exit(bad ? 1 : 0);
}
/* Each break runs the paired check through e2e/lib/break-run.cjs: it stops at the FIRST red line the unbroken check does not already print (so a break
   gets its verdict in seconds, not after the whole walk), and a check that is already red on main cannot "catch" anything by its old red lines. */
const BASES = {};
const baseOf = (h) => { if (!BASES[h]) { BASES[h] = BR.baseline(h, { cwd: SITE.dir }); console.log('  baseline ' + h + ' (unbroken): exit ' + BASES[h].status + ', ' + BASES[h].xx.length + ' XX line(s) already red, ignored, ' + BASES[h].secs + ' s'); BASES[h].xx.forEach((l) => console.log('      red on main: ' + l.slice(0, 120))); } return BASES[h]; };
let good = 0, ran = 0, unanchored = 0;
for (let [name, rel, a, b, harness] of BREAKS) {
  if (ONLY && name.indexOf(ONLY) < 0) continue;
  ran++;
  const f = path.join(SITE.dir, rel);
  const s = fs.readFileSync(f, 'utf8');
  if (/\r\n/.test(s)) { a = a.replace(/\r?\n/g, '\r\n'); b = b.replace(/\r?\n/g, '\r\n'); }
  const loc = BR.locate(s, a), n = loc.n;
  if (n !== 1) { console.log('  ??  ' + name + ': anchor x' + n + ' — this break measured NOTHING'); unanchored++; continue; }
  try {
    fs.writeFileSync(f, loc.apply(b));
    const base = baseOf(harness), v = BR.verdict(harness, base, { cwd: SITE.dir, timeout: 400000 });
    const caught = BR.caught(v, base);
    if (caught) good++;
    console.log((caught ? '  ok  ' : '  XX  ') + 'broken: ' + name + ' → ' + (caught ? 'caught' + (v.early ? ' at once' : '') + (v.rechecked ? ' (crash, confirmed twice)' : '') + ' (' + v.secs + ' s): ' + (v.xx[0] || 'harness crashed: ' + v.stderr).slice(0, 150) : 'NOT caught (exit ' + v.status + ', ' + v.secs + ' s)'));
  } finally { fs.writeFileSync(f, s); }   /* back to the original inside the copy for the next break */
}
console.log('\n  ' + good + '/' + ran + ' breaks caught' + (unanchored ? ', ' + unanchored + ' unanchored' : ''));
process.exitCode = good === ran && !unanchored ? 0 : 1;
