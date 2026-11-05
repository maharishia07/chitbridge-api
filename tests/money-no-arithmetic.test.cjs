'use strict';
/**
 * tests/money-no-arithmetic.test.cjs — "IT CANNOT COMPUTE, THE COMPUTE ENGINE DOES IT, AFTERWARDS EVERYTHING IS DATA" (ACC-206, Athi 2026-10-30).
 *
 * OWNS      the scan that keeps money arithmetic out of the files that carry money from the engine to the chit: lib/send-money.js, lib/money-check.js,
 *           lib/chit-proposal.js (the change order, RAIL-106) and every send step of routes/chits.js (async function send…). A sum, a difference, a product,
 *           a quotient on a money figure, a reduce(), a hand rounding or a percentage is a SECOND CALCULATION and fails here, under any name.
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

const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('   ok   ' + name); }
  else { fail++; console.log('   FAIL ' + name + (detail ? '\n          ' + detail : '')); }
};

/** a file's code with its comments taken out (a comment may name arithmetic; only code is judged) */
const code = (file) => fs.readFileSync(path.join(API, file), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** a top-level function's text: from its signature to the first line that is a lone closing brace */
const bodyOf = (text, signature) => {
  const at = text.indexOf(signature);
  if (at < 0) return null;
  const rest = text.slice(at);
  return rest.slice(0, rest.indexOf('\n}\n') + 2);
};

/** every top-level `async function send…(` / `function send…(` in a text → [name, body] */
const sendSteps = (text) => [...text.matchAll(/^(?:async )?function (send\w*)\(/gm)].map((match) => [match[1], bodyOf(text, match[0])]);

const MONEY = '(?:total|net|gross|tax|amount|price|taxable|savings|discount|value|sum|paid|due|money)';
/** the shapes a second calculation takes */
const SUSPECTS = [
  { name: 'reduce()', re: /\.reduce\(/ },
  { name: 'hand rounding', re: new RegExp('\\bMath\\.(?:round|floor|ceil)\\(.*' + MONEY + '|' + MONEY + '.*\\bMath\\.(?:round|floor|ceil)\\(', 'i') },
  { name: 'toFixed', re: /\.toFixed\(/ },
  { name: 'percent', re: /[*/]\s*100\b/ },
  { name: 'money operator', re: new RegExp('\\b\\w*' + MONEY + '\\w*\\s*[-+*/]\\s*(?:\\(?\\s*Number\\()?\\s*[\\w.]*' + MONEY, 'i') },
  { name: 'money operator (qty x price)', re: new RegExp('\\b\\w*(?:qty|quantity)\\w*\\)?\\s*\\*|\\*\\s*\\(?\\s*(?:Number\\()?\\s*\\w*(?:qty|quantity)', 'i') }
];

/** the known lines, each a backlog item that moves it into the engine (ACCOUNTING-BACKLOG, P2) */
const EXCEPTIONS = [
  { file: 'routes/chits.js', where: 'sendBillCopyFor', line: 'parts.reduce((sum, item) => sum + (Number(item && item.amount) || 0), 0)', backlog: 'ACC-252', why: 'bill_received.total = the sum of the payment parts on the buyer copy of a counter bill' },
  { file: 'lib/chit-proposal.js', where: 'priceOneLine', line: 'Number(amounts.price) * Number(amounts.quantity)', backlog: 'ACC-253', why: 'the line total of a seller-priced round (price x quantity) before the engine prices the round' }
];

/** the suspect hits in a body, minus the named exceptions → [{ pattern, text }] */
function hitsIn(file, body) {
  const lines = body.split('\n');
  const hits = [];
  for (const text of lines) {
    if (EXCEPTIONS.some((ex) => ex.file === file && text.includes(ex.line))) continue;
    for (const s of SUSPECTS) if (s.re.test(text)) hits.push({ pattern: s.name, text: text.trim().slice(0, 160) });
  }
  return hits;
}
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
