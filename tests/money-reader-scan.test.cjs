'use strict';
/**
 * tests/money-reader-scan.test.cjs — ACC-206 G1: NO READER OF A BILL'S TOTAL TAKES THE RAW COPY, ONLY THE ONE PICK.
 *
 * OWNS      the scan over lib/*.js and routes/*.js (comments stripped) for a READ of a raw total copy (total_value, money.total, the invoice's TotInvVal): SQL `summary_json->>'total_value'` /
 *           `-> 'total_value'`, the detail column `d.total_value`, and the JS reads `summary.total_value`, `summary_json.total_value`, `s.total_value`.
 *           A hit is judged against ALLOWED: each entry is a file + the exact code fragment + WHY it is not a reader of the shown total + its backlog id.
 *           The pick lives in lib/counter-bill.js (pickOf, billTotalSql, taxableOf); that file is the one place the raw copies are read.
 * CALLED BY scripts/guards.cjs
 * CARD      14-accounting/README
 * ⚠️ Writers (the chit's own summary being built, INSERT/UPDATE of chit_detail) are named, not hidden: a new entry is never added to make this green.
 *    The web twin (public/app*.js reading `.total_value`) is G1-web, not here. Proof it bites: SCAN_SELFTEST=1 plants one read of each shape.
 */
const fs = require('fs');
const path = require('path');
const API = path.join(__dirname, '..');

const PATTERNS = [
  ['sql header copy', /summary_json\s*-?>>?\s*'total_value'/],
  ['sql detail column', /\bd\.total_value\b/],
  ['js summary read', /\bsummary(?:_json)?\??\.total_value\b/],
  ['js flat summary read', /\bs\.total_value\b/],
  ['js bracket read', /\[\s*['"]total_value['"]\s*\]/],
  /* the other two stored copies of the same figure (ACC-206 review): the header's money.total and the invoice's TotInvVal */
  ['js money.total read', /\bmoney\??\.total\b/],
  ['sql money total', /'money'\s*-?>>?\s*'total'|\{money,total\}/],
  ['invoice TotInvVal read', /\bTotInvVal\b/]
];
const ALLOWED = [
  { file: 'lib/counter-bill.js', any: true, why: 'the one pick: pickOf / billTotalSql / storedCopies read the raw copies here and nowhere else' },
  { file: 'lib/chit-proposal.js', has: "UPDATE chit_detail SET total_value = $3", why: 'writer: the change order stores the engine total it was handed (ACC-206 A)' },
  { file: 'lib/cost.js', has: 'SELECT d.total_value, d.currency_code, h.summary_json', why: 'C1: selected only as the last arm when the header holds no money block (basis as placed); the pick is counterBill.taxableOf' },
  { file: 'lib/credit-cap.js', has: "h.summary_json -> 'total_value' AS legacy_total", why: 'selects the three copies and hands them to pickOf (credit-cap.js:58), no total of its own' },
  { file: 'lib/forms.js', has: "billTotalSql('h', 'd.total_value')", why: 'C4: the header pick, the detail column only as its last arm and never for a withheld copy (billTotalSql guards it)' },
  { file: 'lib/forms.js', has: 'summary.total_value || null', why: 'C4: orderTotalOf: row.total_value is already the header pick; the summary figure is the last arm, and a withheld copy returns null before it' },
  { file: 'lib/kyb.js', has: "billTotalSql('h', 'd.total_value')", why: 'C4: the header pick, the detail column only as its last arm and never for a withheld copy (billTotalSql guards it)' },
  /* the invoice / money.total copies: producers, writers and checks of ONE carried document are not readers of the shown total */
  { file: 'lib/tax.js', any: true, why: 'the engine (vendored tax pack): it PRODUCES TotInvVal and money.total, the one calculation' },
  { file: 'lib/tax-engine.browser.js', any: true, why: 'the same engine, browser build: produces the figures' },
  { file: 'lib/tax-lines.js', has: 'v.TotInvVal', why: 'maps the engine\'s invoice answer into the money block (a producer step, no second figure)' },
  { file: 'lib/tax-copy.js', has: 'TotInvVal: paid', why: 'a counter note builds its own invoice ValDtls from the paid figure (writer)' },
  { file: 'lib/send-money.js', any: true, why: 'writer: pairs the engine figures into the chit (pair table, stamps) at send, ACC-206 A' },
  { file: 'lib/chit-proposal.js', has: 'priced2.block.total', why: 'writer: the change order stores the engine block total (ACC-206 A)' },
  { file: 'lib/issued-invoice.js', any: true, why: 'a CHECK: compares one issued invoice\'s TotInvVal with the sum of its own heads and names a difference; no total is shown' },
  { file: 'lib/bill-paper.js', has: 'invoice.ValDtls.TotInvVal', why: 'a validity test (is the carried invoice a number-bearing one), not a figure shown' },
  { file: 'lib/books-hooks.js', has: 'invoice.ValDtls.TotInvVal', why: 'the books post the frozen invoice\'s OWN total (R6 "both ledgers post what the invoice says"): the standing copy, the first arm of pickOf\'s order; the mismatch against money.total is raised by lib/money-check' },
  { file: 'lib/gst-returns.js', has: 'toPaise_(money.total)', why: 'the return line\'s own tax-lines money document (engine output), not a chit copy' },
  { file: 'lib/credit-cap.js', has: "'TotInvVal' AS invoice_total", why: 'selects the three copies and hands them to pickOf (credit-cap.js:58): no total of its own' },
  { file: 'lib/credit-cap.js', has: 'TotInvVal: row.invoice_total', why: 'rebuilds the header shape from the selected copies for pickOf' },
  { file: 'lib/credit-cap.js', has: 'valDtls.TotInvVal', why: 'a counter note\'s two carried figures handed on (invoice_total, refund_total), compared by the cap, not computed' },
  { file: 'lib/money-check.js', has: "money: 'summary_json.money.total'", why: 'a label: the field path the mismatch ticket names, not a read' },
  { file: 'routes/chits.js', has: 'total: money.total', why: 'the send\'s answer echoes the engine money block it just stored (writer side, ACC-206 A)' },
  { file: 'routes/chits.js', has: 'invoice.ValDtls.TotInvVal', why: 'hasInvoiceTotal: a shape test that the carried invoice holds a number (the CTR-211 verdict path), not a figure shown' },
  { file: 'lib/money-check.js', has: "total_value: 'summary_json.total_value'", why: 'a label: the field path the mismatch ticket names, not a read' },
  { file: 'lib/mint.js', has: 'x.summary_json && x.summary_json.total_value', why: 'writer: mint copies the sender summary into the receiver detail row' },
  { file: 'routes/catalogue.js', has: 'summary_json.total_value', why: 'writer: the order edge stores the figure it just built (CAT-243 / ORD-70 own the order writers)' },
  { file: 'routes/chits.js', has: 'summary.total_value', why: 'writer: the send builds summary.total_value from the engine money block (routes/chits.js summary step, ACC-206 A)' }
];

/** a file's code with its comments taken out (a comment may name the field; only code is judged) */
const codeOf = (text) => text.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

/** every raw read in `text` as { pattern, line } the allow-list does not cover */
function unallowed(file, text) {
  const out = [];
  codeOf(text).split('\n').forEach((line, i) => {
    for (const [name, re] of PATTERNS) {
      if (!re.test(line)) continue;
      const covered = ALLOWED.some((a) => a.file === file && (a.any || line.includes(a.has)));
      if (!covered) out.push({ pattern: name, line: i + 1, text: line.trim().slice(0, 120) });
    }
  });
  return out;
}

if (process.env.SCAN_SELFTEST) {
  const planted = {
    sql: "SELECT (ch.summary_json->>'total_value')::numeric AS v FROM chit_header ch",
    detail: 'SELECT d.total_value FROM chit_detail d',
    js: 'const t = chit.summary_json.total_value;',
    flat: 'return s.total_value;',
    bracket: "const t = summary['total_value'];",
    money: 'return chit.summary_json.money.total;',
    sqlmoney: "SELECT h.summary_json #> '{money,total}' FROM chit_header h",
    invoice: 'const t = business.invoice.ValDtls.TotInvVal;'
  };
  let bad = 0;
  for (const [k, line] of Object.entries(planted)) { const hit = unallowed('lib/planted.js', line); if (hit.length !== 1) { bad += 1; console.log('SELFTEST FAIL ' + k); } }
  const quiet = unallowed('lib/planted.js', "// summary.total_value in a comment\n/* d.total_value */ const x = 1;");
  if (quiet.length) { bad += 1; console.log('SELFTEST FAIL comment fired'); }
  console.log(bad ? 'selftest: ' + bad + ' FAILED' : 'selftest: every shape found, comments quiet');
  process.exit(bad ? 1 : 0);
}

let failed = 0, scanned = 0;
for (const dir of ['lib', 'routes']) {
  for (const name of fs.readdirSync(path.join(API, dir)).filter((n) => n.endsWith('.js'))) {
    const file = dir + '/' + name;
    scanned += 1;
    for (const hit of unallowed(file, fs.readFileSync(path.join(API, file), 'utf8'))) {
      failed += 1;
      console.log('   FAIL ' + file + ':' + hit.line + ' reads the raw total (' + hit.pattern + '): ' + hit.text + '\n          read it through lib/counter-bill (pickOf / billTotalSql), or name it in ALLOWED with its backlog id');
    }
  }
}
console.log(failed ? 'money-reader-scan: ' + failed + ' raw reads' : 'money-reader-scan: ' + scanned + ' files, no raw read of the bill total outside the one pick (' + ALLOWED.length + ' named)');
process.exit(failed ? 1 : 0);
