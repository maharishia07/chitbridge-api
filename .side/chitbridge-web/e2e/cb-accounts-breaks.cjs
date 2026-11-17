/* cb-accounts-breaks.cjs — BREAK EACH CB ACCOUNTS GUARD ONCE, RUN ITS HARNESS, RESTORE FROM A COPY (never git checkout).
 * A guard that has never been seen to fail is a guard that may not be there: each line below damages the page (or the index
 * tile) in exactly the way the harness exists to catch, and the harness must go red. The four the task names — a view missing
 * from the sidebar, a per-row balance fetch, the Active badge shown while off, the gate not attached — come first.
 * BREAK_ONLY=<text> runs just the breaks whose name contains it. Exit 0 only when every break was caught. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const W = path.join(__dirname, '..');
const BR = require('./lib/break-run.cjs');
/* the checks run from a throw-away copy of the checkout (BR.site): the repo's own public/, index.html and e2e/shots are never touched, so a kill cannot leave them broken */
const SITE = BR.site(W); process.on('exit', () => SITE.dispose());
const CAPB = 'public/app/cap-books.js', LCTL = 'public/app/list-ctl.js';
const AV = 'public/app/avatar.js';   /* the avatar is CBAvatar now: its Profile link and its sign-out live here, not on the page */
const PAGE = 'public/accounts.html', SHELL = 'public/app/accounts-shell.js', FRAME = 'public/app/page-frame.js';   /* SHELL-ONE: ⌂ Home is the frame's */   /* N18: the index tile is a manifest card now (e2e/index-page.cjs); its breaks left with it */
const A = 'e2e/cb-accounts.cjs';
const BREAKS = [
  /* the four the task names */
  ['a view goes missing from the sidebar (Bills)', PAGE, "  ['bills', 'Unpaid bills', 'M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h4'],\n", "", A],
  ['a balance is fetched per row', CAPB, `BK.lt.bal = rr[1];`, `BK.lt.bal = rr[1]; (BK.lt.model || []).forEach(function (b) { b.groups.forEach(function (g) { g.accts.forEach(function (a) { api('booksLedger', { params: { account: a.code }, query: bkRange('lg') }).catch(function () {}); }); }); });`, A],
  ['the one-shop gate is not attached', PAGE, `CBOnePerson.attach({ quiet: true, who: () => MINE,`, `void ({ quiet: true, who: () => MINE,`, A],
  /* party ledgers (docs/design/party-ledgers/CLOUD-TASK.md) */
  ['a statement is fetched per party row', CAPB, `function bkLtParties(ctrl) {\n`, `function bkLtParties(ctrl) {\n  Object.keys(BK.dues || {}).forEach(function (k) { api('booksStatement', { params: { id: k } }).catch(function () {}); });\n`, A],
  ['a row does not name its party', CAPB, "var partyName = line.party_id ? bkPartyLabel(line.party_id, line.party_name) : line.party_name || '';", "var partyName = line.party_id ? '' : line.party_name || '';", A],
  ['the cashier is not marked "rung by"', CAPB, `esc(tx('rung by')) + ' ' + esc(s.by)`, `esc(s.by)`, A],
  /* the rest of the page's guards */
  ['a co-assist is offered Switch on', PAGE, `const isOwner = () => SESSION.role === 'entity';`, `const isOwner = () => true;`, A],
  ['Switch on is sent before the owner confirms', PAGE, "        ask: confirmAsk,\n        working: () => {\n          node.disabled = true;", "        ask: (t, bd, ok, go) => go(),\n        working: () => {\n          node.disabled = true;", A],
  ['a failed read is mistaken for a Ledger that is off', PAGE, "    if (e && e.status === 404) return offCard();\n", "    return offCard();\n", A],
  ['Sign out keeps the session (the avatar\'s sign-out, public/app/avatar.js)', AV, `      root.localStorage.removeItem('cb_sess');\n`, ``, A],
  ['Home goes somewhere else (the frame\'s ⌂ Home, public/app/page-frame.js)', FRAME, "homeHref: opts.homeHref || '/',", "homeHref: opts.homeHref || '/app.html',", A],
  ['Profile goes somewhere else (the avatar\'s Profile link)', AV, `o.profileHref || PROFILE_HREF`, `o.profileHref || '/app.html#/app/settings'`, A],
  ['a code the design never named vanishes', CAPB, `title = g ? g[1] : 'Other';`, `title = g ? g[1] : 'Other'; if (!g) return;`, A],
  ['the step chip is decided by the page, not the server', PAGE, `data-step="\${esc(b.step || '')}">\${esc(b.label)}</span>`, `data-step="\${esc(b.step || '')}">\${esc(b.step)}</span>`, A],
  ['the phone overflows', LCTL, `.cbl .cbl-grid{min-width:0}.cbl .cbl-hdr{display:none}`, `.cbl .cbl-grid{min-width:900px}.cbl .cbl-hdr{display:none}`, A],
  ['the sidebar stays wide on a phone', PAGE, `  .side{width:64px}\n  .side .label,#toggleNav{display:none}`, `  .side .label,#toggleNav{display:none}`, A],
  ['a table scrolls sideways instead of folding into cards', PAGE, `#bk_body table.bktab thead{display:none}`, ``, A],
  /* ── ONE TABLE (docs/design/one-table): the Ledgers' folder tree and party leaves ── */
  ['ONE the ledger tree lists the per-party accounts as leaves', CAPB, "return !item.is_group && !/^(1300|2100)-/.test(String(item.code));", "return !item.is_group && true;", A],
  ['ONE the control account hides its parties', CAPB, `if (kids && open) (n.t === 'ledger' ? n.parties : n.kids).forEach(`, `if (false) (n.t === 'ledger' ? n.parties : n.kids).forEach(`, A],
  ['ONE the parties and the ledger may disagree unsaid', CAPB, "    if (figures.check && !figures.check.agree) {", "    if (false) {", A],
  /* the Ledgers quick fixes + the To do home (2026-10-03) */
  ['FIX the kind word is said twice (Expense · Expense)', CAPB, "} else if (s.ref || s.chit_id) out += (said ? ' ' : ' · ' + (text ? esc(text) + ' ' : '')) + bkBillPart(s, tid);\n  return out + bkRecordedHTML", "} else if (s.ref || s.chit_id) out += ' · ' + (text ? esc(text) + ' ' : '') + bkBillPart(s, tid);\n  return out + bkRecordedHTML", A],
  ['FIX a balance is written with a minus', CAPB, `return bkMoney(Math.abs(v), c) + (v ?`, `return bkMoney(v, c) + (v ?`, A],
  ['FIX the party is repeated inside an entry on its own ledger', CAPB, "(item.party_name && !noParty ? ' · '", "(item.party_name ? ' · '", A],
  ['FIX the date boxes come back', CAPB, `return '<div id="lg_out" data-testid="lg_out"></div>';`, `return bkRangeHTML('lg', 'bkLtLoad()') + '<div id="lg_out" data-testid="lg_out"></div>';`, A],
  ['FIX the sideways scroll returns (a wide Details column)', CAPB, `Math.max(240, Math.min(560, avail - (112 + (ctrl ? 250 : 160) + 160) - 12))`, `1400`, A],
  /* ── THE LEDGERS PAGE (docs/design/ledgers-page, 2026-10-03) ── */
  ['LP the tree clips a long name instead of wrapping it', CAPB, `'#bk_lt .tn .nm{min-width:0;overflow-wrap:normal;`, `'#bk_lt .tn .nm{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;overflow-wrap:normal;`, A],
  ['LP the figures are not in one aligned column', CAPB, `white-space:nowrap;text-align:end;min-width:var(--am-w,12ch)`, `white-space:nowrap;text-align:start;min-width:var(--am-w,12ch)`, A],
  ['LP the chosen ledger is a solid block', CAPB, `background:color-mix(in srgb,var(--blue-tint-bg,var(--blue-t,#E4EEFA)) 60%,transparent);`, `background:var(--blue-2,#174A87);`, A],
  ['LP every node is a tab stop', CAPB, "' tabindex=\"-1\" data-testid=\"' +\n      esc(tid) +", "' tabindex=\"0\" data-testid=\"' +\n      esc(tid) +", A],
  ['LP the arrow keys do nothing in the tree', CAPB, "      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {\n        event.preventDefault();\n        var innerNode", "      if (false) {\n        event.preventDefault();\n        var innerNode", A],
  ['LP the find box marks nothing', CAPB, "  var i = String(s).toLowerCase().indexOf(text.toLowerCase());\n  if (i < 0) return esc(s);\n  return esc(s.slice(0, i)) + '<mark>'", "  return esc(s);\n  var i = String(s).toLowerCase().indexOf(text.toLowerCase());\n  if (i < 0) return esc(s);\n  return esc(s.slice(0, i)) + '<mark>'", A],
  ['LP the pane cannot be resized', CAPB, `function bkLtWidth(w, quiet) {\n`, `function bkLtWidth(w, quiet) {\n  return;\n`, A],
  ['LP a banner row sits above the list (the head grows past 20%)', CAPB, `return '<div id="lg_out" data-testid="lg_out"></div>';`, `return '<div style="height:90px">banner</div><div id="lg_out" data-testid="lg_out"></div>';`, A],
  ['LP the figures are said twice', CAPB, "    head.chips.push({ tid: 'lg-sum', text: figures.text });\n", "    head.chips.push({ tid: 'lg-sum', text: figures.text }); head.chips.push({ tid: 'lg-sum', text: figures.text });\n", A],
  ['LP a party ledger keeps its Party column', CAPB, `  if (ctrl) cols.push({ key: 'party',`, `  if (true) cols.push({ key: 'party',`, A],
  ['LP an amount is written with a minus', CAPB, `esc(bkMoney(l.dr_minor, c) + ' ' + tx('Dr'))`, `esc('-' + bkMoney(l.dr_minor, c) + ' ' + tx('Dr'))`, A],
  ['LP the open ledger is not bold in its own entry', CAPB, "return mine && String(item.code) === String(mine) ?", "return false && String(item.code) === String(mine) ?", A],
  ['LP the last ledger is not remembered', CAPB, `function bkLtPrefsSave() {\n`, `function bkLtPrefsSave() {\n  return;\n`, A],
  ['LP the tree squeezes the list on a narrow laptop (no overlay)', CAPB, `#bk_lt:not(.folded) .lt-tree{position:absolute;inset:0 auto 0 0;`, `#bk_lt:not(.folded) .lt-tree{position:static;inset:0 auto 0 0;`, A],
  ['LP ‹ is missing on a phone ledger', CAPB, `data-lt="back" data-testid="lt-back" aria-label="' + esc(tx('Back to all ledgers')) + '">‹</button>'`, `data-lt="back" data-testid="lt-back" style="display:none" aria-label="' + esc(tx('Back to all ledgers')) + '">‹</button>'`, A],
  ['LP the Statement button opens nothing', CAPB, `try { window.open('/crm.html#/party/'`, `try { void ('/crm.html#/party/'`, A],
  ['LP an agreement chip is drawn without the API\'s date', CAPB, "    if (agreedUpTo) head.chips.push({ tid: 'lg-agreed'", "    if (true) head.chips.push({ tid: 'lg-agreed'", A],
  ['SHELL-ONE the page draws a Home of its own beside the frame\'s', PAGE, `<h1 id="title">Accounts</h1>`, `<h1 id="title">Accounts</h1><a class="home" href="/" data-testid="acc-home">⌂ Home</a>`, A],
  ['LP the page title row stays above the open ledger (head past 20%)', PAGE, `body.lg-on.lg-sel .titlebar{display:none}`, `body.lg-on.lg-sel .titlebar{display:flex}`, A],
  ['LP a balance is read per ledger (a per-leaf fetch)', CAPB, `function bkLtBal(code) {\n`, `function bkLtBal(code) {\n  api('booksLedger', { params: { account: code }, query: bkRange('lg') }).catch(function () {});\n`, A],
  ['LP the list is not held inside its pane (it runs under the kural footer)', CAPB, `'#bk_lt #lg_out{flex:1 1 auto;min-height:0}',`, `'#bk_lt #lg_out{flex:0 0 auto}',`, A],
  ['LP the opened entry offers no Reverse', CAPB, `actions: typeof enReverse === 'function' ? [{ id: 'reverse', icon: '↩', label: 'Reverse this entry', tid: 'lg-reverse',`, `actions: false ? [{ id: 'reverse', icon: '↩', label: 'Reverse this entry', tid: 'lg-reverse',`, A],
  ['TODO the To do view is not first in the sidebar', PAGE, `const NAV = [\n  ['todo', 'To do',`, `const NAV = [\n  ['x', 'To do',`, A],
  ['ONE the ledger rows draw their own table', CAPB, `  return CBList.mount(el, {\n    key: 'ledger-' + kind,`, `  el.innerHTML = '<table class=bktab><tbody><tr><td>x</td></tr></tbody></table>';\n  return CBList.mount(document.createElement('div'), {\n    key: 'ledger-' + kind,`, A],
  ['ONE an entry has no next level', CAPB, "  var e = bkLgEntry(line),\n    ownsParty", "  var e = null,\n    ownsParty", A],
  ['ONE a bill number opens no sheet in the ledger', CAPB, `function bkBillPart(s, tid) {\n`, `function bkBillPart(s, tid) {\n  s = Object.assign({}, s, { chit_id: null });\n`, A],
  ['the word accounting reaches the screen', PAGE, `<span class="brand-name">Accounts</span>`, `<span class="brand-name">Accounts accounting</span>`, A],
  ['an alert() sneaks in', PAGE, `function navTo(k){`, `function navTo(k){ alert('hi');`, A],
  ['the Switch on call is copied into the page', PAGE, `call: (on) => CBLedger.call({ api: api }, on),`, `call: (on) => api('booksEnable', { body: {} }),`, A],
];
const ONLY = process.env.BREAK_ONLY || '';
/* BREAK_CHECK=1 only checks that every anchor still matches the source exactly once (fast — nothing is run) */
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
  /* ⚠️ CRLF-SAFE (2026-10-02): a Windows checkout (core.autocrlf) has \r\n, and a two-line anchor written with \n matched
     nothing there — the break was skipped as "anchor x0" and the run still exited 0. Anchors follow the file's own endings. */
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
console.log('\n  ' + good + '/' + ran + ' breaks caught');
process.exitCode = good === ran ? 0 : 1;
