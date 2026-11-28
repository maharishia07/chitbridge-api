/**
 * one-figure-party-statement.test.cjs — ONE-FIGURE RC12 (Athi 28 Nov 2026, batch 1141): a party's statement is assembled ONE way (books.partyStatement); GET /party/:id/statement calls it.
 * Two carried totals: the route's closing_minor and books.partyStatement's closing_minor (the second assembler's old reader), against the HAND figure; a mutation (the route builds its own input again) goes red.
 * HAND (INR paise): supplier Kumar Traders: bill 2026-10-02 Rs 1,000.00 + 5% 50.00 = 105,000 paise on credit; bill 2026-10-06 Rs 400.00 + 20.00 = 42,000 paise on credit → owed 147,000, closing -147,000 (a creditor's balance is Cr).
 * GOLDEN: the route's answer BEFORE the change (taken from develop): opening 0 · 2 lines · closing as hand — carried in GOLDEN below; the change must not move it.
 * Run: node tests/one-figure-party-statement.test.cjs   (BOOKS_ENGINES_SRC=<chitbridge-engines/src>)
 * OWNER cb-accounting · CALLS lib/books.partyStatement · routes/books.js GET /party/:id/statement
 */
'use strict';
const fs = require('fs'), path = require('path');
const { rig, counter } = require('./support/books-manual-rig.cjs');
const H = require('./support/books-harness.cjs');
const { ok, eq, done } = counter();
const GOLDEN = { opening_minor: 0, closing_minor: -147000, dr: [0, 0], cr: [105000, 42000] };
(async () => {
  console.log('\n══ ONE-FIGURE RC12 — a party statement has ONE assembler ══\n');
  const R = await rig(); if (!R) return;
  const { q, X, SHOP, SUPP } = R;
  const buy = (date, taxable, tax, ref) => X.B.postEntry(X.db, SHOP, { type: 'purchase_bill', ref, date, currency: 'INR', party: SUPP, by_rate: [{ rate: 5, taxable, igst: tax }], paid: {}, round_off: 0, source_ref: 'pur:' + ref });
  await buy('2026-10-02', 1000, 50, 'P1'); await buy('2026-10-06', 400, 20, 'P2');
  const route = (await q('GET', '/party/' + SUPP + '/statement?from=2026-04-01&to=2026-10-31')).body;
  const own = await X.B.partyStatement(X.db, SHOP, SUPP, 'creditors', '2026-04-01', '2026-10-31');
  eq('the route: opening · closing · line count (golden from develop)', [route.opening_minor, route.closing_minor, (route.lines || []).length], [GOLDEN.opening_minor, GOLDEN.closing_minor, 2]);
  eq('the route: Dr and Cr per line (golden)', [(route.lines || []).map((l) => l.dr_minor), (route.lines || []).map((l) => l.cr_minor)], [GOLDEN.dr, GOLDEN.cr]);
  ok('books.partyStatement (the other reader) closes the same: ' + (own && own.closing_minor), own && own.closing_minor === route.closing_minor && own.opening_minor === route.opening_minor && own.rows.length === route.lines.length, JSON.stringify(own && [own.opening_minor, own.closing_minor, own.rows.length]));
  const noRole = await X.B.partyStatement(X.db, SHOP, SUPP, null, '2026-04-01', '2026-10-31');
  ok('without a role (the route\'s call) the same figures', noRole && noRole.closing_minor === route.closing_minor);
  /* the structure: ONE assembler — no second statementInput and no engine partyStatement call outside books.js */
  const src = (f) => fs.readFileSync(path.join(H.API, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const callers = [];
  for (const d of ['lib', 'routes', 'middleware']) for (const f of fs.readdirSync(path.join(H.API, d))) if (f.endsWith('.js') && !/^(ledger|books|tax-engine\.browser)\.js$/.test(f) && /ledger\(\)\.partyStatement\(|function statementInput\(/.test(src(d + '/' + f))) callers.push(d + '/' + f);
  ok('no second assembler of the statement input outside lib/books.js', callers.length === 0, callers.join(' '));
  /* mutation: a route that builds its own input from a changed rule leaves the one reader → the two totals part */
  const real = X.B.partyStatement;
  X.B.partyStatement = async (...a) => { const r = await real(...a); return Object.assign({}, r, { closing_minor: r.closing_minor + 1 }); };
  const bad = (await q('GET', '/party/' + SUPP + '/statement?from=2026-04-01&to=2026-10-31')).body;
  X.B.partyStatement = real;
  ok('mutation (the one reader moves the closing) shows on the route: the route reads it', bad.closing_minor === route.closing_minor + 1, JSON.stringify(bad.closing_minor));
  R.close(); done();
})().catch((e) => { console.error(e); process.exit(1); });
