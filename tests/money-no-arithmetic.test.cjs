'use strict';
/**
 * tests/money-no-arithmetic.test.cjs — "IT CANNOT COMPUTE, THE COMPUTE ENGINE DOES IT, AFTERWARDS EVERYTHING IS DATA" (ACC-206, Athi 2026-10-30).
 *
 * OWNS      the scan that keeps money arithmetic out of the files that carry money from the engine to the chit: lib/send-money.js, lib/money-check.js,
 *           lib/chit-proposal.js (the change order, RAIL-106) and every send step of routes/chits.js (async function send…). A sum, a difference, a product,
 *           a quotient on a money figure, a reduce(), a hand rounding or a percentage is a SECOND CALCULATION and fails here, under any name.
 *           ALSO (G2) every lib/*.js and routes/*.js by hit count per file against tests/money-scan-baseline.json; the shapes live in ONE list, tests/lib/money-scan.cjs.
 * CALLED BY scripts/guards.cjs · cited by lib/send-money.js and lib/money-check.js headers.
 * FLOW      read each file (comments stripped) → cut the scanned bodies → every suspect pattern → minus the NAMED exceptions (each with its backlog id)
 * CARD      14-accounting/README
 *
 * ⚠️ An exception is a known, pre-existing line with a backlog item that moves it into the engine. A new one is never added here to make the test green.
 * Proof it bites: run with MONEY_SCAN_SELFTEST=1 — a planted `gross - savings` is scanned and must be found.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { code, bodyOf, hitsIn: scanBody, treeFiles, countsOver } = require('./lib/money-scan.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('   ok   ' + name); }
  else { fail++; console.log('   FAIL ' + name + (detail ? '\n          ' + detail : '')); }
};

/** every top-level `async function send…(` / `function send…(` in a text → [name, body] */
const sendSteps = (text) => [...text.matchAll(/^(?:async )?function (send\w*)\(/gm)].map((match) => [match[1], bodyOf(text, match[0])]);

/** the known lines, each a backlog item that moves it into the engine (ACCOUNTING-BACKLOG, P2) */
const EXCEPTIONS = [
  { file: 'lib/chit-proposal.js', where: 'priceOneLine', line: 'Number(amounts.price) * Number(amounts.quantity)', backlog: 'ACC-253', why: 'the line total of a seller-priced round (price x quantity) before the engine prices the round' }
];

/** the suspect hits in a body, minus the named exceptions above */
const hitsIn = (file, body) => scanBody(file, body, EXCEPTIONS);
const said = (hits) => hits.map((h) => h.pattern + ': ' + h.text).join('\n          ');

console.log('\n══ NO MONEY ARITHMETIC BETWEEN THE ENGINE AND THE CHIT (ACC-206) ══\n');

for (const file of ['lib/send-money.js', 'lib/money-check.js', 'lib/chit-proposal.js']) {
  const hits = hitsIn(file, code(file));
  ok(file + ' holds no sum, difference, product, quotient, reduce, rounding or percentage on money', hits.length === 0, said(hits));
}

const chits = code('routes/chits.js');
const steps = sendSteps(chits);
ok('routes/chits.js: the send steps were found (sendMoney, sendIssued, sendQuotation among them)', ['sendMoney', 'sendIssued', 'sendQuotation'].every((name) => steps.some(([n]) => n === name)), steps.map(([n]) => n).join(', '));
for (const [name, body] of steps) {
  const hits = hitsIn('routes/chits.js', body || '');
  if (hits.length) ok('routes/chits.js ' + name + ' holds no money arithmetic', false, said(hits));
}
ok('routes/chits.js: no send step (' + steps.length + ') holds money arithmetic outside the named exceptions', steps.every(([, body]) => hitsIn('routes/chits.js', body || '').length === 0));
ok('routes/chits.js: the second calculation that was removed stays removed (moneyOfLines, keepOffer)', !/function (?:moneyOfLines|keepOffer)\(/.test(chits));

for (const ex of EXCEPTIONS) {
  const text = code(ex.file);
  ok('named exception ' + ex.backlog + ' (' + ex.file + ' ' + ex.where + ') is still where it was — when it moves into the engine, delete its row here', text.includes(ex.line), ex.why);
}

/**
 * the WIDENED scan (ACC-206 G2): every lib/*.js and routes/*.js, by hit count per file against tests/money-scan-baseline.json.
 * A file not in the baseline holds NO hit (a new file with `total + tax` goes red); a baselined file may not gain one. The count only goes DOWN:
 * when an owner moves a line into the engine, lower its number (never raise one — a new line is a second calculation). The KNOWN_LINES are the
 * named, pre-existing lines of the files the plan lists (PLAN-ACC-206 §2e), each with the backlog item that moves it; the rest of the baseline
 * is aggregation over rows and engine copies, widened per owner.
 */
const BASELINE = JSON.parse(fs.readFileSync(path.join(__dirname, 'money-scan-baseline.json'), 'utf8'));
const KNOWN_LINES = [
  { file: 'lib/offers-live.js', line: 'parts.reduce((amount, entry) => amount + (Number(entry.off) || 0), 0)', backlog: 'CAT-255', why: 'sums the offer parts of a line itself' },
  { file: 'lib/books-hooks.js', line: 'rows.reduce((sum, item) => sum + item.taxable + item.cgst', backlog: 'ACC-351', why: 'by-rate total re-adds the bill heads' },
  { file: 'lib/books-hooks.js', line: 'roundMoney(total - byRate.total)', backlog: 'ACC-352', why: 'round-off derived by subtraction' },
  { file: 'routes/catalogue.js', line: 'items.reduce((s, item) => s + item.total, 0)', backlog: 'CAT-243', why: 'network order total summed in the route' },
  { file: 'routes/catalogue.js', line: 'items.reduce((sum, item) => sum + item.price * item.qty, 0)', backlog: 'CAT-243', why: 'network order total (price x qty) in the route' },
  { file: 'routes/catalogue.js', line: 'sitems.reduce((sum, item) => sum + item.price * item.qty, 0)', backlog: 'CAT-243', why: 'fragment total (price x qty) in the route' }
];
const overBaseline = (counts) => Object.keys(counts).filter((file) => counts[file] > (BASELINE[file] || 0)).map((file) => file + ' has ' + counts[file] + ' (baseline ' + (BASELINE[file] || 0) + ')');

const treeCounts = countsOver(treeFiles(), code);
const over = overBaseline(treeCounts);
ok('lib/ and routes/ (' + Object.keys(treeCounts).length + ' files with hits): no file gains a money-arithmetic hit, no new file holds one', over.length === 0, over.join('\n          '));
for (const known of KNOWN_LINES) {
  ok('known line ' + known.backlog + ' (' + known.file + ') is still where it was — when it moves into the engine, delete its row here and lower the baseline', code(known.file).includes(known.line), known.why);
}
{
  const planted = { 'lib/zz-new-file.js': 'const owed = total + tax;\n' };
  const found = overBaseline(countsOver(Object.keys(planted), (file) => planted[file]));
  ok('the widened scan bites: a bare `total + tax` in a NEW file is red', found.length === 1 && /zz-new-file/.test(found[0]), found.join(', '));
  ok('the known list stays green: the real tree is not over the baseline', over.length === 0);
}

/* the scan bites: a planted second calculation under a new name is found */
{
  const planted = 'function sendPlanted(st) {\n  const left = st.gross - st.savings;\n  const owed = lines.reduce((a, b) => a + b, 0);\n  return left * 1.18;\n}\n';
  const found = hitsIn('routes/chits.js', planted).map((h) => h.pattern);
  ok('the scan bites: a planted `gross - savings` and a reduce() under a new function name are both found', found.includes('money operator') && found.includes('reduce()'), found.join(', '));
  if (process.env.MONEY_SCAN_SELFTEST) {
    const hits = hitsIn('routes/chits.js', planted);
    assert.ok(hits.length >= 2, 'self-test: the planted calculation must be found');
  }
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
