'use strict';
/**
 * tests/money-reader-scan.test.cjs — ACC-206 G1: NO READER OF A BILL'S TOTAL TAKES THE RAW COPY, ONLY THE ONE PICK.
 *
 * OWNS      the scan over lib/*.js and routes/*.js (comments stripped) for a READ of the header's raw total copy: SQL `summary_json->>'total_value'` /
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
  ['js bracket read', /\[\s*['"]total_value['"]\s*\]/]
];
const ALLOWED = [
  { file: 'lib/counter-bill.js', any: true, why: 'the one pick: pickOf / billTotalSql / storedCopies read the raw copies here and nowhere else' },
  { file: 'lib/chit-proposal.js', has: "UPDATE chit_detail SET total_value = $3", why: 'writer: the change order stores the engine total it was handed (ACC-206 A)' },
  { file: 'lib/cost.js', has: 'SELECT d.total_value, d.currency_code, h.summary_json', why: 'C1: selected only as the last arm when the header holds no money block (basis as placed); the pick is counterBill.taxableOf' },
  { file: 'lib/credit-cap.js', has: "h.summary_json -> 'total_value' AS legacy_total", why: 'selects the three copies and hands them to pickOf (credit-cap.js:58), no total of its own' },
  { file: 'lib/forms.js', has: 'COALESCE(${counterBill.billTotalSql', why: 'C4: the header pick first, the detail column only where no copy says' },
  { file: 'lib/forms.js', has: 'row.total_value != null ? row.total_value : s.total_value || null', why: 'C4: row.total_value is already the header pick; s.total_value is the last arm for a form with no header total' },
  { file: 'lib/kyb.js', has: 'COALESCE(${counterBill.billTotalSql', why: 'C4: the header pick first, the detail column only where no copy says' },
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
    bracket: "const t = summary['total_value'];"
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
