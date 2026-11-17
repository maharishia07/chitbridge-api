#!/usr/bin/env node
/**
 * list-standard.cjs — THE GUARD: a column-header row that is not a CBList mount fails the run (docs/design/list-standard, DECISIONS.md "FROZEN").
 *
 * Athi, 2026-10-02: *"whenever such type of control established anywhere, it is a must that column adjustable should be there, and also,
 * the scrolling should be allowed only below the column header … create a control in place so i don't need to repeat."*  So the rule is
 * enforced where he cannot see it: over app.html, accounts.html (and every file they load) and the Labs, ANY element that draws a column
 * header — role="columnheader", a .lhead, or a <thead> — must belong to a CBList mount. The only place that may write one is
 * app/list-ctl.js itself; a page that hand-draws a header (and so would have to draw its own resize handle, its own sticky header, its own
 * chooser) is named here and fails.
 *
 *  EXCEPTIONS  printed documents and rendered content, each by name with its reason. They are not lists a person sorts or resizes: the bill
 *              slip, the final-accounts printout, a markdown table inside an AI answer.
 *  DEBT        hand-drawn tables that are NOT yet CBList mounts and are outside the nine lists this change moved (Task · Waiting · Day book ·
 *              Dues · Ledgers · Cheques · Suppliers · Customers · Platform). Recorded by name so the run is honest, and a RATCHET like
 *              list-controls.cjs: a header that is not listed fails (a new hand-drawn list is caught the day it is written); a name that is
 *              listed but no longer draws one fails too (take it out — the number only goes down). Do not add a name without Athi.
 *
 * ZEBRA (Athi, 2026-10-09: "in the CRM and ledger each line to show in alternate colors?"): one rule in the unit (every other data row, a THEME TOKEN shade, group heads · hover · selected stay
 * distinct) and one rule for the ledger / statement tables (cap-books.js) — checked here in source and on the lab's real DOM; e2e/a11y-contrast.cjs measures the shade in all 16 themes.
 *
 * It reads SOURCE (comments blanked, strings kept: the markup lives in strings) because the pages paint after a sign-in the harness
 * cannot give every screen; then, on the real DOM, it checks the lab: every columnheader in list-lab.html sits inside a .cbl mount.
 * e2e/list-unit-breaks.cjs proves a hand-drawn header anywhere is caught.
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = process.env.CBL_ROOT || path.join(__dirname, '..', 'public');

/* ── what is allowed to draw a header ── */
const UNIT = new Set(['app/list-ctl.js']);

/* ── EXCEPTIONS: printed documents and rendered content — file::function → why ── */
const EXCEPTIONS = {
  'app/chit-sheet.js::linesHTML': 'the BILL SLIP: the lines of one frozen invoice (Item · Qty · Price · Total), a printed document. Not a list a person sorts or resizes.',
  'app/chit-sheet.js::gstHTML': 'the BILL SLIP: the GST summary of one frozen invoice (rate · taxable · CGST · SGST), a printed document.',
  'app/cap-books.js::bkTable': 'the FINAL ACCOUNTS printout: trial balance, profit and loss and balance sheet are statements with a totals foot, read top to bottom and printed.',
  'app/cap-books.js::statementHTML': 'a party STATEMENT printout (opening … running balance … closing), a printed document.',
  'app/country-profiles.js::invoiceHTML': 'the sample e-invoice a country pack would issue (Item · Qty · Price · Rate · Tax · Total): a printed-document preview of one frozen sample, like the bill slip.',
  'app/cap-books.js::bkPlHeadHTML': 'the PROFIT AND LOSS statement on screen (income, costs, profit with this year and last year): a statement with a totals foot read top to bottom, like bkTable. Not a list a person sorts or resizes. (Athi 17 Nov)',
  'app/cap-books.js::bkBS': 'the BALANCE SHEET on screen (assets, liabilities, equity with a check line): a statement, like bkTable. (Athi 17 Nov)',
  'app/cap-books.js::bkLockRowsPaint': 'the 12-MONTH lock calendar: one fixed row per month of the year in calendar order. Not a list a person sorts or resizes. (Athi 17 Nov)',
  'app/cap-bank-home.js::bankHomeGridHtml': 'the bank ACCOUNT-BY-MONTH matrix: accounts down, months across, a fixed grid. Not a list a person sorts or resizes. (Athi 17 Nov)',
  'app/cap-books-overview.js::ovTable': 'the data table under an MIS chart (the chart in figures, for screen readers): fixed order of the chart. (Athi 17 Nov)',
  'app/cap-mis-pictures.js::pcTable': 'the data table under an MIS picture (the picture in figures): fixed order of the chart. (Athi 17 Nov)',
  'app/bank-preview-ui.js::painter': 'the statement lines of the Bank-to-books preview (the no-login demo and the in-app Add sheet): the lines of ONE statement, a read-only preview in a fixed order with the questions each asks, like a printed statement. Not a list a person sorts or resizes.',
  'app/bank-demo-report.js::paintBooks': 'the no-login bank demo: the bank-account ledger the sample statement would produce (Date · What · In · Out · Balance), a read-only statement preview in running-balance order.',
  'app.html::_aiMd': 'the markdown renderer for an AI answer: a table the model wrote is content, not a list of the shop\'s records.',
};

/* ── DEBT: hand-drawn headers that are still to move (the ratchet) — file::function → what it is ──
   All of them sit OUTSIDE the nine lists this change moved (Task · Waiting · Day book · Dues · Ledgers · Cheques · Suppliers · Customers ·
   Platform). Each is a read-only summary or an input grid inside a screen, not yet declared as a CBList. */
const DEBT = {
  'app/cap-catalogue.js::_cfRun': 'the product import preview (In your file · What to do with it · Why): a one-off check list in a form (moved out of app.html by T3-CATALOGUE, acc8d951)',
  'app.html::prodBomTab': 'a product\'s bill of materials (components, qty): a small table in the product detail',
  'app.html::prodInvoiceTab': 'a product\'s invoice-line sheet (Description · HSN · Qty · Rate · Discount): a document-like table in the product detail',
  'app.html::prodHistoryTab': 'a product\'s version history (Version · From · What changed · Who) in the product detail',
  'app.html::prodTaxPreviewHTML': 'the tax preview of a product: a small summary table in the product detail',
  'app/cap-admin.js::misFriction': 'the MIS "queue, oldest first" table: a report band on the MIS screen',
  'app/cap-admin.js::intProfileMapHTML': 'the connector\'s field map (what we look for, where it came from): a fixed settings card',
  'app/cap-admin.js::intStreamsHTML': 'the connector streams card (Stream · What travels · Owner): a fixed settings card',
  'app/cap-admin.js::workRoutingHTML': 'work routing (Kind of work · Folder · Person · Team): an input grid in Settings',
  'app/cap-books.js::payPaint': 'the payment allocation form (a bill, its due, what to apply): inputs per bill inside the Receive payment modal',
  'app/cap-catsetup.js::id': 'the tax register of the catalogue set-up (Product · slab · price): a read-only audit table',
  'app/cap-match.js::matchDetail': 'the three-way match detail (Line · counted · invoiced): a read-only comparison table',
  'app/cap-register.js::rgHead': 'the RAIDA register (15 columns, in a modal): a hand-drawn .lhead list, next to move',
  'conversion-lab.html::markup': 'Lab: the conversion tables (items, prices, rates), inputs per row',
  'offer-lab-next.html::markup': 'Lab: a static table', 'offer-lab-next.html::percentTableHTML': 'Lab: the percent table',
  'offer-lab-next.html::paintPriceOvBody': 'Lab: a price-override input grid', 'offer-lab-next.html::g3': 'Lab: a preview table',
  'offer-lab-next.html::cartPreviewHTML': 'Lab: the cart preview table', 'offer-lab-next.html::outLine': 'Lab: an output table', 'offer-lab-next.html::outQty': 'Lab: an output table',
  'product-lab.html::paintRows': 'Lab: the product table (inputs per row)', 'product-lab.html::paintReview': 'Lab: the review table',
};

/* ── the scan ── */
function blank(src) {                          /* comments erased, strings kept (the markup lives in strings) */
  let out = '', i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/' && src[i - 1] !== ':') { const e = src.indexOf('\n', i); const n = e < 0 ? src.length : e; out += ' '.repeat(n - i); i = n; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const n = e < 0 ? src.length : e + 2; out += src.slice(i, n).replace(/[^\n]/g, ' '); i = n; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    out += c; i++;
  }
  return out;
}
const MARKERS = [
  ['columnheader', /role=\\?["']columnheader/g],
  ['.lhead', /class=\\?["'][^"']*\blhead\b/g],
  ['<thead>', /<thead\b/g],
];
function walk(d, out) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/^(docs|vendor|cmdb|illustrations|pics|engine)$/.test(e.name)) walk(p, out); } else out.push(p); } return out; }

/* the files in scope: the app shell, CB Accounts, CB CRM, every module they load, and the Labs */
function scope() {
  const files = [];
  for (const f of ['app.html', 'accounts.html', 'crm.html']) files.push(f);
  for (const e of fs.readdirSync(path.join(ROOT, 'app'))) if (/\.js$/.test(e)) files.push('app/' + e);
  for (const e of fs.readdirSync(ROOT)) if (/lab.*\.html$/.test(e)) files.push(e);
  /* T2-LABS: a lab's own module (public/lab/*.js — the Combo Lab moved there) is the Labs too */
  if (fs.existsSync(path.join(ROOT, 'lab'))) for (const e of fs.readdirSync(path.join(ROOT, 'lab'))) if (/\.js$/.test(e)) files.push('lab/' + e);
  return files.filter((f) => fs.existsSync(path.join(ROOT, f)));
}
function findHeaders() {
  const found = [];   /* { file, key, kind, line } */
  for (const rel of scope()) {
    if (UNIT.has(rel)) continue;
    const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
    const isHtml = /\.html$/.test(rel);
    /* an .html file is scanned as markup + its inline <script> blocks; only the scripts are blanked (a comment in them can mention a header) */
    const src = isHtml ? raw.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/g, (m, js) => m.replace(js, blank(js))).replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' ')) : blank(raw);
    const fns = []; const fre = /function\s+([A-Za-z0-9_$]+)\s*\(/g; let m;
    while ((m = fre.exec(src))) fns.push({ name: m[1], at: m.index });
    const scripts = []; if (isHtml) { const sre = /<script\b[^>]*>([\s\S]*?)<\/script>/g; while ((m = sre.exec(src))) scripts.push([m.index, m.index + m[0].length]); }
    let ord = 0;
    for (const [kind, re] of MARKERS) {
      re.lastIndex = 0;
      while ((m = re.exec(src))) {
        const at = m.index, line = src.slice(0, at).split('\n').length;
        const inScript = !isHtml || scripts.some(([a, b]) => at >= a && at < b);
        let fn = null; if (inScript) for (const f of fns) if (f.at <= at) fn = f.name;
        found.push({ file: rel, key: rel + '::' + (inScript ? (fn || '<top>') : 'markup'), kind, line });
        ord++;
      }
    }
  }
  return found;
}

let fails = 0;
const say = (s) => console.log(s);
const found = findHeaders();
const byKey = new Map();
for (const h of found) { const e = byKey.get(h.key) || { key: h.key, kinds: new Set(), lines: [] }; e.kinds.add(h.kind); e.lines.push(h.line); byKey.set(h.key, e); }

if (process.argv.includes('--list')) { for (const e of byKey.values()) say(e.key + '  [' + [...e.kinds].join(' ') + ']  lines ' + e.lines.join(',')); process.exit(0); }

say('\n══ LIST STANDARD — every column header is a CBList mount ══\n');
say('  scanned ' + scope().length + ' file(s): app.html, accounts.html, app/*.js, the Labs — ' + found.length + ' header marker(s) outside app/list-ctl.js in ' + byKey.size + ' place(s)\n');

/* 1 · the exceptions and the debt must still be true */
const exceptionKeys = new Set(Object.keys(EXCEPTIONS));
let nEx = 0, nDebt = 0;
const noMount = [];
for (const e of byKey.values()) {
  if (exceptionKeys.has(e.key)) { nEx++; continue; }
  if (DEBT[e.key]) { nDebt++; continue; }
  noMount.push({ key: e.key, show: e });
}
/* QA-154: places not yet in EXCEPTIONS or DEBT are recorded in e2e/scanner-known.json; only a NEW one fails */
const RK = require('./lib/known-findings.cjs').ratchet('list-standard', noMount, { owner: 'ux-locale' });
say('  ' + RK.line.trim() + '\n');
for (const it of RK.fresh) {
  const e = it.show;
  fails++;
  say('  ✗ NEW ' + e.key + '  (' + [...e.kinds].join(' ') + ', line ' + e.lines.join(',') + ')  draws a column header that is not a CBList mount.');
  say('       Mount it: CBList.mount(el, { key, rows, columns, … }) (app/list-ctl.js). The unit draws the header, the drag handles, ⚙ columns and the');
  say('       sticky scroll for you. If it is a printed document, name it in EXCEPTIONS with its reason; never in DEBT without Athi.');
}
for (const key of Object.keys(EXCEPTIONS)) {
  {
  if (!byKey.has(key)) { fails++; say('  ✗ EXCEPTIONS names ' + key + ', which no longer draws a header. Remove the line — a stale exception forgives nothing.'); }
  }
}
for (const k of Object.keys(DEBT)) {
  if (!byKey.has(k)) { fails++; say('  ✗ DEBT names ' + k + ', which no longer draws a header — good. Remove it from DEBT: the number only goes down.'); }
  if (EXCEPTIONS[k]) { fails++; say('  ✗ ' + k + ' is in BOTH EXCEPTIONS and DEBT. Pick one.'); }
}

say('  ' + nEx + ' printed document(s) / rendered content, named:');
for (const k of Object.keys(EXCEPTIONS)) say('    · ' + k.padEnd(40) + EXCEPTIONS[k]);
say('\n  ' + nDebt + ' hand-drawn header(s) still to move (the ratchet — it only goes down):');
for (const k of Object.keys(DEBT)) say('    · ' + k.padEnd(40) + DEBT[k]);

/* 2 · the unit itself is the only writer, and it writes the header the standard asks for */
/* the unit is list-ctl.js plus its parts (shrink W2, 2026-11-17: the stylesheet moved to list-ctl-css.js): the checks below read the whole unit */
const unitSrc = ['list-ctl.js', 'list-ctl-css.js', 'list-ctl-click.js', 'list-ctl-wire.js'].map((p) => fs.readFileSync(path.join(ROOT, 'app/' + p), 'utf8')).join('\n');
const unitHeader = /role=\\?"columnheader|role="columnheader/.test(unitSrc) && /cbl-rz/.test(unitSrc) && /aria-sort/.test(unitSrc) && /position:sticky;top:0/.test(unitSrc);
if (!unitHeader) { fails++; say('  ✗ app/list-ctl.js no longer draws a sticky columnheader with a resize handle and aria-sort.'); }

/* 2b · ZEBRA: the unit stripes its rows from a token; the statement tables carry the same stripe; no page paints a stripe of its own */
const zUnit = /\.cbl-row\.z,\.cbl \.cbl-lrec\.z\{background:var\(--cl-zebra\)\}/.test(unitSrc) && /--cl-zebra:var\(--zebra,color-mix\(in srgb,var\(--cl-ink\) \d+%,var\(--cl-card\)\)\)/.test(unitSrc) && /\((?:zb|zebra) \? ' z' : ''\)/.test(unitSrc);
if (!zUnit) { fails++; say('  ✗ app/list-ctl.js no longer stripes its rows from a theme token (.cbl-row.z · --cl-zebra, with a z class on every other data row, grid and lines).'); }
else say('  ✓ the unit stripes every other row from --cl-zebra (the theme\'s --zebra, else ink mixed into the card): no raw colour');
const booksSrc = fs.readFileSync(path.join(ROOT, 'app/cap-books.js'), 'utf8');
if (!/\.bktab tbody tr:nth-child\(even\)\{background:var\(--zebra,color-mix\(in srgb,var\(--ink\) \d+%,var\(--card\)\)\)\}/.test(booksSrc)) { fails++; say('  ✗ app/cap-books.js: the ledger / statement tables (.bktab) are no longer striped from the same token.'); }
else say('  ✓ the ledger and statement tables (.bktab) carry the same stripe');
/* 2c · THE STRIPE IS VISIBLE (Athi: "no difference, it has to be visible"): 9% ink (Strong, the default), not the 4% it was; the person's Row stripes choice (Off · Light · Strong) drives the same token */
{
  const pct = (unitSrc.match(/--cl-zebra:var\(--zebra,color-mix\(in srgb,var\(--cl-ink\) (\d+)%/) || [])[1];
  if (!(Number(pct) >= 8 && Number(pct) <= 10)) { fails++; say('  ✗ the stripe is ' + pct + '% ink - it must be about 9% so it is visible at a glance.'); } else say('  ✓ the stripe is ' + pct + '% ink (visible)');
  const avSrc = fs.readFileSync(path.join(ROOT, 'app/avatar.js'), 'utf8');
  if (!(/data-stripes="off"\]\{--zebra:transparent\}/.test(avSrc) && /data-stripes="light"\]\{--zebra:color-mix/.test(avSrc) && /STRIPES = \[\s*\['off'/.test(avSrc))) { fails++; say('  ✗ app/avatar.js no longer drives the one --zebra token from Row stripes: Off · Light · Strong.'); } else say('  ✓ the avatar menu\'s Row stripes (Off · Light · Strong) drives the one --zebra token');
}
/* 2d · A GROUP HEADING LOOKS LIKE A HEADING (C12): a full-width tinted band from a theme token, small upper-case title, rows indented, foldable */
{
  const band = /\.cbl \.cbl-group\{[^}]*background:var\(--cl-gband\)[^}]*text-transform:uppercase/.test(unitSrc) && /--cl-gband:color-mix\(in srgb,var\(--cl-blue\) \d+%,var\(--cl-page\)\)/.test(unitSrc) && /\.cbl-row\.ing>:first-child\{padding-inline-start:\d+px/.test(unitSrc) && /aria-expanded="'\s*\+\s*!shut/.test(unitSrc);
  if (!band) { fails++; say('  ✗ app/list-ctl.js: a group heading is no longer a tinted upper-case band with indented rows and a fold (aria-expanded).'); } else say('  ✓ a group heading is a tinted band (token, upper-case title), its rows are indented, and it folds');
}
{
  const rawStripe = scope().filter((f) => /\.html$|\.js$/.test(f) && !/list-ctl\.js$|cap-books\.js$/.test(f)).filter((f) => /(tr|\.cbl-row|\.cbl-lrec)[^{}]*:nth-(child|of-type)\((even|odd|2n)/.test(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/var _AI_MDCSS\s*=\s*'.*';/, '')));   /* the AI answer's own markdown stylesheet is rendered content, not a list */
  rawStripe.forEach((f) => { if (/accounts\.html$/.test(f)) return; fails++; say('  ✗ ' + f + ' paints a stripe of its own — the unit and cap-books.js own it (accounts.html only keeps it on the phone card, from the same token).'); });
}

/* 3 · on the real DOM: every columnheader on the lab belongs to a mount */
(async () => {
  let pw = null; try { pw = require('@playwright/test'); } catch (_) {}
  if (pw) {
    const { serve } = require('./lib/serve.cjs');
    const S = await serve(ROOT), b = await pw.chromium.launch();
    try {
      const p = await b.newPage({ viewport: { width: 1366, height: 768 } });
      await p.goto(S.url('/list-lab.html')); await p.waitForSelector('.cbl-row, .cbl-lrec');
      for (const k of ['daybook', 'dues', 'big']) {
        await p.click('[data-plist="' + k + '"]'); await p.waitForTimeout(100);
        const r = await p.evaluate(() => {
          const all = [].slice.call(document.querySelectorAll('[role=columnheader], .lhead, thead'));
          return { n: all.length, stray: all.filter((e) => !e.closest('.cbl')).length, handles: [].slice.call(document.querySelectorAll('[role=columnheader]')).filter((h) => !h.querySelector('.cbl-rz')).length };
        });
        if (r.n === 0 || r.stray || r.handles) { fails++; say('  ✗ the lab (' + k + '): ' + r.n + ' header(s), ' + r.stray + ' outside a mount, ' + r.handles + ' without a resize handle'); }
        else say('  ✓ the lab (' + k + '): ' + r.n + ' header element(s), all inside a CBList mount, each with a resize handle');
        const z = await p.evaluate(() => { const bg = (e) => getComputedStyle(e).backgroundColor, rs = [].slice.call(document.querySelectorAll('.cbl-row:not(.sel), .cbl-lrec:not(.sel)')); return rs.length < 3 ? null : { a: bg(rs[0]), b: bg(rs[1]), c: bg(rs[2]) }; });
        if (z && !(z.a === z.c && z.a !== z.b)) { fails++; say('  ✗ the lab (' + k + '): rows do not alternate (' + z.a + ' / ' + z.b + ' / ' + z.c + ')'); }
        else if (z) say('  ✓ the lab (' + k + '): rows alternate (' + z.a + ' / ' + z.b + ')');
      }
    } finally { await b.close(); S.close(); }
  }
  say('\n  ' + (fails ? fails + ' failure(s)' : 'every column header is a CBList mount (or a named printed document), ' + nDebt + ' recorded to move') + '\n');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
